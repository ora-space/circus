import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { UsageError, type Command } from '../lib/context.ts';
import { ensureCanonical, pushForkMain } from '../lib/remote.ts';

const usage = `worktree REPO TYPE/[ISSUE-]SLUG
    为产品仓库开一个新的 worktree：ora-space/REPO 不存在时先 fork 并 clone；拉取 upstream 最新 main，
    顺手把 fork 的 main 推到最新，在 ora-space/REPO/.worktrees/[ISSUE-]SLUG 基于它建分支 TYPE/[ISSUE-]SLUG。
    TYPE：feat fix refactor perf docs test chore build ci；ISSUE 是 circus issue 编号；SLUG 是小写英文短语，用 - 连接。
    例：worktree desktop fix/42-startup-crash`;

export const TYPES = ['feat', 'fix', 'refactor', 'perf', 'docs', 'test', 'chore', 'build', 'ci'];
const BRANCH = new RegExp(`^(${TYPES.join('|')})/((?:\\d+-)?[a-z0-9]+(?:-[a-z0-9]+)*)$`);
export const WORKTREES = '.worktrees';

// Worktree directory name for a branch: the branch without its type, e.g. 42-startup-crash.
export function worktreeName(branch: string): string | null {
  return BRANCH.exec(branch)?.[2] ?? null;
}

export const command: Command = {
  usage,
  run(args, ctx) {
    const [repo, branch] = args;
    const name = worktreeName(branch ?? '');
    if (args.length !== 2 || !/^[\w.-]+$/.test(repo) || !name) throw new UsageError(usage);
    const org = ctx.repo.split('/')[0];
    const canonical = `${org}/${repo}`;
    const dir = join(ctx.root, org, repo);
    const show = (p: string) => relative(ctx.root, p).split('\\').join('/');

    if (!existsSync(join(dir, '.git'))) {
      // Creates the fork if missing; a no-op when it exists.
      ctx.gh(['repo', 'fork', canonical, '--clone=false']);
      const login = ctx.gh(['api', 'user', '--jq', '.login']).trim();
      ctx.git(['clone', '-q', `https://github.com/${login}/${repo}.git`, dir]);
      ctx.out(`已 clone fork ${login}/${repo} → ${show(dir)}`);
    }

    const pre = ['-C', dir];
    const { remote: up } = ensureCanonical(ctx.git, pre, canonical);
    ctx.git([...pre, 'fetch', '-q', up, 'main']);
    const fork = pushForkMain(ctx.git, pre, up);
    if (fork) ctx.out(fork);

    // Keep worktrees out of the product repo's status without touching its .gitignore.
    const exclude = resolve(dir, ctx.git([...pre, 'rev-parse', '--git-path', 'info/exclude']).trim());
    const line = `/${WORKTREES}/`;
    const current = existsSync(exclude) ? readFileSync(exclude, 'utf8') : '';
    if (!current.split(/\r?\n/).includes(line)) {
      mkdirSync(dirname(exclude), { recursive: true });
      appendFileSync(exclude, `${current && !current.endsWith('\n') ? '\n' : ''}${line}\n`);
    }

    const path = join(dir, WORKTREES, name);
    if (existsSync(path)) throw new Error(`${show(path)} 已存在`);
    ctx.git([...pre, 'worktree', 'add', '-q', '--no-track', '-b', branch, path, `${up}/main`]);
    const base = ctx.git([...pre, 'rev-parse', '--short', `${up}/main`]).trim();
    ctx.out(`${show(path)}（分支 ${branch}，基于 ${up}/main ${base}）`);
  },
};
