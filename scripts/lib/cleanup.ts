// Removing local work for an issue once it is done. Deleting the wrong branch loses work,
// so every check below must pass before anything is removed; any doubt means skip.
//
// A local branch (and its worktree) goes away only when:
//   - a PR that references the issue has it as head, from the current account's fork;
//   - that PR is no longer open (merged, or closed);
//   - the branch has no commit missing from the PR's head;
//   - its worktree, if any, is under .worktrees/ and has no uncommitted or untracked files;
//   - it is not checked out in the clone's main directory.
import { existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Context } from './context.ts';
import { graphql } from './gh.ts';
import { canonicalRemote, tryGit } from './remote.ts';

export interface LinkedPr {
  repo: string; // owner/name
  number: number;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  headRefName: string;
  headRefOid: string;
  headOwner: string | null; // null when the head repository is gone
}

// PRs whose body, commits or comments reference the issue, from its timeline.
export function linkedPrs(ctx: Context, n: number): LinkedPr[] {
  const [o, r] = ctx.repo.split('/');
  type Source = {
    __typename: string;
    number?: number;
    state?: LinkedPr['state'];
    headRefName?: string;
    headRefOid?: string;
    headRepositoryOwner?: { login: string } | null;
    repository?: { nameWithOwner: string };
  };
  const data = graphql<{ repository: { issue: { timelineItems: { nodes: { source?: Source }[] } } } }>(
    ctx.gh,
    `query($o: String!, $r: String!, $n: Int!) { repository(owner: $o, name: $r) { issue(number: $n) {
      timelineItems(last: 100, itemTypes: [CROSS_REFERENCED_EVENT]) { nodes { ... on CrossReferencedEvent { source {
        __typename ... on PullRequest { number state headRefName headRefOid headRepositoryOwner { login } repository { nameWithOwner } } } } } } } } }`,
    { o, r, n },
  );
  const prs = new Map<string, LinkedPr>();
  for (const { source: s } of data.repository.issue.timelineItems.nodes) {
    if (s?.__typename !== 'PullRequest') continue;
    const pr: LinkedPr = {
      repo: s.repository!.nameWithOwner,
      number: s.number!,
      state: s.state!,
      headRefName: s.headRefName!,
      headRefOid: s.headRefOid!,
      headOwner: s.headRepositoryOwner?.login ?? null,
    };
    prs.set(`${pr.repo}#${pr.number}`, pr);
  }
  return [...prs.values()];
}

// Where a repository's clone lives: the circus checkout itself, or ora-space/<repo>.
export function cloneDir(ctx: Context, repo: string): string {
  return repo === ctx.repo ? ctx.root : join(ctx.root, ...repo.split('/'));
}

interface Worktree {
  path: string;
  branch: string | null; // refs/heads/... or null when detached
}

export function parseWorktrees(porcelain: string): Worktree[] {
  return porcelain
    .split(/\n\n+/)
    .filter((b) => b.trim())
    .map((block) => {
      const lines = block.split('\n');
      const path = lines.find((l) => l.startsWith('worktree '))!.slice('worktree '.length);
      const branch = lines.find((l) => l.startsWith('branch '))?.slice('branch '.length) ?? null;
      return { path, branch };
    });
}

export interface CleanupResult {
  removed: string[];
  skipped: string[];
}

function cleanupPr(ctx: Context, pr: LinkedPr, me: string, dryRun: boolean, result: CleanupResult): void {
  if (pr.headOwner !== me) return; // someone else's work
  const dir = cloneDir(ctx, pr.repo);
  const label = `${pr.repo}#${pr.number} 的分支 ${pr.headRefName}`;
  if (!existsSync(join(dir, '.git'))) return; // never cloned here
  const pre = ['-C', dir];
  const git = (args: string[]) => ctx.git([...pre, ...args]);
  const ref = `refs/heads/${pr.headRefName}`;
  if (tryGit(ctx.git, [...pre, 'rev-parse', '--verify', '--quiet', ref]) !== null) return; // no such local branch
  const skip = (why: string) => void result.skipped.push(`${label}：${why}`);

  if (pr.state === 'OPEN') return skip('PR 还没结束');
  // The local branch must be the PR's branch: everything on it is in the PR's head.
  if (tryGit(ctx.git, [...pre, 'cat-file', '-e', `${pr.headRefOid}^{commit}`]) !== null) {
    const up = canonicalRemote(git(['remote', '-v']), pr.repo);
    if (!up || tryGit(ctx.git, [...pre, 'fetch', '-q', up, `pull/${pr.number}/head`]) !== null) {
      return skip('取不到 PR 的提交，无法确认本地没有额外的工作');
    }
  }
  const extra = Number(git(['rev-list', '--count', ref, `^${pr.headRefOid}`]).trim());
  if (extra > 0) return skip(`本地分支有 ${extra} 个不在 PR 里的提交`);

  const worktrees = parseWorktrees(git(['worktree', 'list', '--porcelain']));
  const main = worktrees[0];
  if (main?.branch === ref) return skip('分支检出在主目录');
  const wt = worktrees.find((w) => w.branch === ref);
  const shown = (p: string) => relative(ctx.root, p).split(sep).join('/') || '.';
  if (wt) {
    const rel = relative(dir, wt.path);
    if (rel.split(sep)[0] !== '.worktrees') return skip(`worktree 不在 .worktrees/ 下：${wt.path}`);
    if (ctx.git(['-C', wt.path, 'status', '--porcelain']).trim()) return skip(`worktree ${shown(wt.path)} 有未提交的改动或未跟踪的文件`);
    if (!dryRun) git(['worktree', 'remove', wt.path]);
  }
  // -D: a squash or rebase merge leaves the branch unmerged in git's eyes; the checks above
  // already proved its commits are in the PR.
  if (!dryRun) git(['branch', '-D', pr.headRefName]);
  result.removed.push(`${label}：${wt ? `worktree ${shown(wt.path)} 和` : ''}本地分支（${shown(dir)}）`);
}

export function cleanupIssue(ctx: Context, n: number, me: string, dryRun = false): CleanupResult {
  const result: CleanupResult = { removed: [], skipped: [] };
  for (const pr of linkedPrs(ctx, n)) cleanupPr(ctx, pr, me, dryRun, result);
  return result;
}

export function reportCleanup(result: CleanupResult, dryRun = false): string[] {
  const lines: string[] = [];
  for (const r of result.removed) lines.push(`${dryRun ? '将清理' : '已清理'} ${r}`);
  for (const s of result.skipped) lines.push(`保留 ${s}`);
  return lines.length ? lines : ['没有要清理的本地工作'];
}
