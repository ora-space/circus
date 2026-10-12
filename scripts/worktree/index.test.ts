import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { command, worktreeName } from './index.ts';
import { fakeContext } from '../lib/testing.ts';
import { UsageError } from '../lib/context.ts';

test('worktreeName accepts TYPE/[ISSUE-]SLUG only', () => {
  assert.equal(worktreeName('fix/42-startup-crash'), '42-startup-crash');
  assert.equal(worktreeName('docs/readme'), 'readme');
  for (const bad of ['fix/Startup', 'wip/x', 'fix/42_crash', 'fix/', 'fix/-x', 'startup-crash']) {
    assert.equal(worktreeName(bad), null, bad);
  }
});

const FORK_REMOTES = 'origin\thttps://github.com/alice/desktop.git (fetch)\nupstream\thttps://github.com/ora-space/desktop (fetch)';

// git double: answers by the args after `-C dir`, records calls, simulates clone.
function fakeGit(root: string, remotes = FORK_REMOTES) {
  const calls: string[] = [];
  const run = (args: string[]) => {
    const rest = args[0] === '-C' ? args.slice(2) : args;
    calls.push(rest.join(' ').replaceAll(root, '<root>'));
    if (rest[0] === 'clone') mkdirSync(join(rest[3], '.git'), { recursive: true });
    if (rest.join(' ') === 'remote -v') return remotes;
    if (rest[0] === 'remote') return remotes.split('\n').map((l) => l.split('\t')[0]).join('\n');
    if (rest.includes('--git-path')) return '.git/info/exclude\n';
    if (rest.includes('--short')) return 'abc1234\n';
    return '';
  };
  return { run, calls };
}

test('worktree in an existing fork clone: fetch upstream, refresh the fork, add the worktree', () => {
  const root = mkdtempSync(join(tmpdir(), 'circus-wt-'));
  const dir = join(root, 'ora-space', 'desktop');
  mkdirSync(join(dir, '.git', 'info'), { recursive: true });
  writeFileSync(join(dir, '.git', 'info', 'exclude'), '# keep');
  const g = fakeGit(root);
  const { ctx, calls, lines } = fakeContext(undefined, { root, git: g.run });
  command.run(['desktop', 'fix/42-startup-crash'], ctx);

  assert.equal(calls.length, 0);
  assert.deepEqual(g.calls, [
    'remote -v',
    'fetch -q upstream main',
    'remote',
    'push -q origin refs/remotes/upstream/main:refs/heads/main',
    'rev-parse --git-path info/exclude',
    `worktree add -q --no-track -b fix/42-startup-crash ${join('<root>', 'ora-space', 'desktop', '.worktrees', '42-startup-crash')} upstream/main`,
    'rev-parse --short upstream/main',
  ]);
  assert.equal(readFileSync(join(dir, '.git', 'info', 'exclude'), 'utf8'), '# keep\n/.worktrees/\n');
  assert.equal(lines.at(-1), 'ora-space/desktop/.worktrees/42-startup-crash（分支 fix/42-startup-crash，基于 upstream/main abc1234）');

  // Second worktree: exclude line is not duplicated.
  command.run(['desktop', 'feat/43-tray-menu'], ctx);
  assert.equal(readFileSync(join(dir, '.git', 'info', 'exclude'), 'utf8'), '# keep\n/.worktrees/\n');
});

test('worktree forks and clones a missing repo first', () => {
  const root = mkdtempSync(join(tmpdir(), 'circus-wt-'));
  const g = fakeGit(root, 'origin\thttps://github.com/alice/desktop.git (fetch)');
  const { ctx, calls, lines } = fakeContext((args) => (args[0] === 'api' ? 'alice\n' : ''), { root, git: g.run });
  command.run(['desktop', 'docs/readme'], ctx);
  assert.deepEqual(calls[0].args, ['repo', 'fork', 'ora-space/desktop', '--clone=false']);
  assert.equal(g.calls[0], `clone -q https://github.com/alice/desktop.git ${join('<root>', 'ora-space', 'desktop')}`);
  assert.equal(g.calls[2], 'remote add upstream https://github.com/ora-space/desktop.git');
  assert.equal(lines[0], '已 clone fork alice/desktop → ora-space/desktop');
});

test('worktree rejects bad arguments and existing worktrees', () => {
  const { ctx } = fakeContext();
  assert.throws(() => command.run(['desktop', 'my-branch'], ctx), UsageError);
  assert.throws(() => command.run(['desktop'], ctx), UsageError);
  const root = mkdtempSync(join(tmpdir(), 'circus-wt-'));
  mkdirSync(join(root, 'ora-space', 'desktop', '.git', 'info'), { recursive: true });
  mkdirSync(join(root, 'ora-space', 'desktop', '.worktrees', 'readme'), { recursive: true });
  const g = fakeGit(root);
  assert.throws(() => command.run(['desktop', 'docs/readme'], fakeContext(undefined, { root, git: g.run }).ctx), /已存在/);
  assert.ok(!g.calls.some((c) => c.startsWith('worktree')));
});
