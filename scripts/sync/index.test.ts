import { test } from 'node:test';
import assert from 'node:assert/strict';
import { command } from './index.ts';
import { canonicalRemote } from '../lib/remote.ts';
import { fakeContext } from '../lib/testing.ts';

const FORK = [
  'origin\tgit@github.com:alice/circus.git (fetch)',
  'origin\tgit@github.com:alice/circus.git (push)',
  'upstream\thttps://github.com/ora-space/circus (fetch)',
  'upstream\thttps://github.com/ora-space/circus (push)',
].join('\n');

test('canonicalRemote matches https and ssh URLs of the canonical repo only', () => {
  assert.equal(canonicalRemote(FORK, 'ora-space/circus'), 'upstream');
  assert.equal(canonicalRemote('origin\tgit@github.com:ora-space/circus.git (fetch)', 'ora-space/circus'), 'origin');
  assert.equal(canonicalRemote('origin\thttps://github.com/ora-space/circus-x (fetch)', 'ora-space/circus'), undefined);
});

// Scripted git: answers by the joined args, records every call, fails the ones listed.
function fakeGit(answers: Record<string, string>, failing: string[] = []) {
  const calls: string[] = [];
  const run = (args: string[]) => {
    const key = args.join(' ');
    calls.push(key);
    if (failing.includes(key)) throw new Error('fatal: Not possible to fast-forward, aborting.\nmore');
    return answers[key] ?? '';
  };
  return { run, calls };
}

test('sync on main in a fork: fast-forwards main and pushes it to the fork', () => {
  const g = fakeGit({ 'remote -v': FORK, 'rev-parse --abbrev-ref HEAD': 'main\n', remote: 'origin\nupstream\n' });
  const { ctx, lines } = fakeContext(undefined, { git: g.run });
  command.run([], ctx);
  assert.deepEqual(g.calls, [
    'remote -v',
    'fetch -q upstream main',
    'rev-parse --abbrev-ref HEAD',
    'merge -q --ff-only upstream/main',
    'remote',
    'push -q origin refs/remotes/upstream/main:refs/heads/main',
  ]);
  assert.deepEqual(lines, ['main 已对齐 upstream/main', 'fork（origin）的 main 已对齐 upstream/main']);
});

test('sync on a feature branch updates main without touching the branch', () => {
  const g = fakeGit({
    'remote -v': 'origin\thttps://github.com/ora-space/circus (fetch)',
    'rev-parse --abbrev-ref HEAD': 'feat/x\n',
    'rev-list --left-right --count HEAD...origin/main': '2\t5\n',
  });
  const { ctx, lines } = fakeContext(undefined, { git: g.run });
  command.run([], ctx);
  assert.ok(g.calls.includes('fetch -q origin main:main'));
  assert.ok(!g.calls.some((c) => c.startsWith('merge') || c.startsWith('push')));
  assert.equal(lines[1], '当前在 feat/x 分支：领先 origin/main 2 个提交，落后 5 个；是否 rebase 自行决定');
});

test('sync adds the canonical remote when missing and reports a diverged main', () => {
  const g = fakeGit(
    { 'remote -v': 'origin\thttps://github.com/alice/circus (fetch)', 'rev-parse --abbrev-ref HEAD': 'main', remote: 'origin\nupstream' },
    ['merge -q --ff-only upstream/main'],
  );
  const { ctx, lines } = fakeContext(undefined, { git: g.run });
  command.run([], ctx);
  assert.equal(g.calls[1], 'remote add upstream https://github.com/ora-space/circus.git');
  assert.equal(lines[1], '本地 main 无法快进到 upstream/main，请手动处理：fatal: Not possible to fast-forward, aborting.');
});

test('sync fails loudly when the canonical repo cannot be fetched', () => {
  const g = fakeGit({ 'remote -v': FORK }, ['fetch -q upstream main']);
  const { ctx } = fakeContext(undefined, { git: g.run });
  assert.throws(() => command.run([], ctx), /fast-forward/);
});
