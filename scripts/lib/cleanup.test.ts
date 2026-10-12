// Cleanup deletes branches, so these tests run against real git repositories.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanupIssue, parseWorktrees, reportCleanup, type LinkedPr } from './cleanup.ts';
import { git } from './gh.ts';
import { fakeContext } from './testing.ts';

const run = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

// A circus root with a product clone at ora-space/desktop: main plus branch fix/7-a in a
// worktree, one commit ahead of main. Returns the paths and the branch tip.
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'circus-cleanup-'));
  const dir = join(root, 'ora-space', 'desktop');
  mkdirSync(dir, { recursive: true });
  run(dir, 'init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'a.txt'), 'a\n');
  run(dir, 'add', '.');
  run(dir, 'commit', '-q', '-m', 'init');
  const wt = join(dir, '.worktrees', '7-a');
  run(dir, 'worktree', 'add', '-q', '-b', 'fix/7-a', wt);
  writeFileSync(join(wt, 'b.txt'), 'b\n');
  run(wt, 'add', '.');
  run(wt, 'commit', '-q', '-m', 'work');
  return { root, dir, wt, tip: run(wt, 'rev-parse', 'HEAD') };
}

const pr = (over: Partial<LinkedPr> = {}): LinkedPr => ({
  repo: 'ora-space/desktop',
  number: 5,
  state: 'MERGED',
  headRefName: 'fix/7-a',
  headRefOid: '',
  headOwner: 'me',
  ...over,
});

// gh double answering the issue timeline with these PRs.
function context(root: string, prs: LinkedPr[]) {
  const nodes = prs.map((p) => ({
    source: {
      __typename: 'PullRequest',
      number: p.number,
      state: p.state,
      headRefName: p.headRefName,
      headRefOid: p.headRefOid,
      headRepositoryOwner: p.headOwner ? { login: p.headOwner } : null,
      repository: { nameWithOwner: p.repo },
    },
  }));
  nodes.push({ source: { __typename: 'Issue' } } as never);
  return fakeContext(() => JSON.stringify({ data: { repository: { issue: { timelineItems: { nodes } } } } }), {
    root,
    git: git(root),
  }).ctx;
}

const hasBranch = (dir: string, b: string) => run(dir, 'branch', '--list', b) !== '';

test('removes my merged PR\'s clean worktree and branch', () => {
  const { root, dir, wt, tip } = setup();
  const result = cleanupIssue(context(root, [pr({ headRefOid: tip })]), 7, 'me');
  assert.deepEqual(result.skipped, []);
  assert.deepEqual(result.removed, [
    'ora-space/desktop#5 的分支 fix/7-a：worktree ora-space/desktop/.worktrees/7-a 和本地分支（ora-space/desktop）',
  ]);
  assert.ok(!existsSync(wt));
  assert.ok(!hasBranch(dir, 'fix/7-a'));
  assert.ok(hasBranch(dir, 'main'));
});

test('a branch without a worktree is removed too; dry-run only reports', () => {
  const { root, dir, wt, tip } = setup();
  run(dir, 'worktree', 'remove', wt);
  const ctx = context(root, [pr({ headRefOid: tip, state: 'CLOSED' })]);
  const preview = cleanupIssue(ctx, 7, 'me', true);
  assert.deepEqual(reportCleanup(preview, true), ['将清理 ora-space/desktop#5 的分支 fix/7-a：本地分支（ora-space/desktop）']);
  assert.ok(hasBranch(dir, 'fix/7-a'));
  cleanupIssue(ctx, 7, 'me');
  assert.ok(!hasBranch(dir, 'fix/7-a'));
});

test('someone else\'s PR is not touched or mentioned', () => {
  const { root, dir, tip } = setup();
  const result = cleanupIssue(context(root, [pr({ headRefOid: tip, headOwner: 'bob' }), pr({ headRefOid: tip, headOwner: null })]), 7, 'me');
  assert.deepEqual(result, { removed: [], skipped: [] });
  assert.ok(hasBranch(dir, 'fix/7-a'));
});

test('kept: open PR, extra local commits, dirty worktree, untracked files', () => {
  const cases: [string, (s: ReturnType<typeof setup>) => Partial<LinkedPr>, RegExp][] = [
    ['open', (s) => ({ headRefOid: s.tip, state: 'OPEN' }), /PR 还没结束/],
    [
      'extra commit',
      (s) => {
        writeFileSync(join(s.wt, 'c.txt'), 'c\n');
        run(s.wt, 'add', '.');
        run(s.wt, 'commit', '-q', '-m', 'not pushed');
        return { headRefOid: s.tip };
      },
      /有 1 个不在 PR 里的提交/,
    ],
    [
      'modified',
      (s) => {
        writeFileSync(join(s.wt, 'b.txt'), 'changed\n');
        return { headRefOid: s.tip };
      },
      /有未提交的改动或未跟踪的文件/,
    ],
    [
      'untracked',
      (s) => {
        writeFileSync(join(s.wt, 'new.txt'), 'x\n');
        return { headRefOid: s.tip };
      },
      /有未提交的改动或未跟踪的文件/,
    ],
  ];
  for (const [name, arrange, why] of cases) {
    const s = setup();
    const result = cleanupIssue(context(s.root, [pr(arrange(s))]), 7, 'me');
    assert.deepEqual(result.removed, [], name);
    assert.match(result.skipped[0], why, name);
    assert.ok(existsSync(s.wt) && hasBranch(s.dir, 'fix/7-a'), name);
  }
});

test('kept: PR head not available locally and no canonical remote to fetch it', () => {
  const s = setup();
  const result = cleanupIssue(context(s.root, [pr({ headRefOid: 'f'.repeat(40) })]), 7, 'me');
  assert.match(result.skipped[0], /取不到 PR 的提交/);
  assert.ok(hasBranch(s.dir, 'fix/7-a'));
});

test('kept: branch checked out in the main directory, or a worktree outside .worktrees/', () => {
  const s = setup();
  run(s.dir, 'worktree', 'remove', s.wt);
  run(s.dir, 'checkout', '-q', 'fix/7-a');
  let result = cleanupIssue(context(s.root, [pr({ headRefOid: s.tip })]), 7, 'me');
  assert.match(result.skipped[0], /分支检出在主目录/);

  const t = setup();
  run(t.dir, 'worktree', 'remove', t.wt);
  const elsewhere = join(t.root, 'elsewhere');
  run(t.dir, 'worktree', 'add', '-q', elsewhere, 'fix/7-a');
  result = cleanupIssue(context(t.root, [pr({ headRefOid: t.tip })]), 7, 'me');
  assert.match(result.skipped[0], /worktree 不在 .worktrees\/ 下/);
  assert.ok(existsSync(elsewhere) && hasBranch(t.dir, 'fix/7-a'));
});

test('no local branch or no clone: nothing to report', () => {
  const s = setup();
  assert.deepEqual(cleanupIssue(context(s.root, [pr({ headRefName: 'fix/8-b' }), pr({ repo: 'ora-space/cloud' })]), 7, 'me'), {
    removed: [],
    skipped: [],
  });
  assert.deepEqual(reportCleanup({ removed: [], skipped: [] }), ['没有要清理的本地工作']);
});

test('parseWorktrees reads porcelain blocks, main first', () => {
  assert.deepEqual(parseWorktrees('worktree /r\nHEAD 1\nbranch refs/heads/main\n\nworktree /r/.worktrees/x\nHEAD 2\ndetached\n'), [
    { path: '/r', branch: 'refs/heads/main' },
    { path: '/r/.worktrees/x', branch: null },
  ]);
});
