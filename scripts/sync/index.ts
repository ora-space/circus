import type { Command, Context } from '../lib/context.ts';

const usage = `sync
    每个会话开始时运行：从 ora-space/circus 拉取 main，把本地 main 快进到最新；
    origin 是 fork 时，顺手把 fork 的 main 也推到最新。只做快进，不覆盖本地改动。`;

// Name of the remote pointing at the canonical repository, by https or ssh URL.
export function canonicalRemote(remotes: string, repo: string): string | undefined {
  const escaped = repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const url = new RegExp(`github\\.com[:/]${escaped}(\\.git)?/?$`, 'i');
  for (const line of remotes.split('\n')) {
    const [name, address, kind] = line.trim().split(/\s+/);
    if (kind === '(fetch)' && url.test(address)) return name;
  }
  return undefined;
}

function tryGit(ctx: Context, args: string[]): string | null {
  try {
    ctx.git(args);
    return null;
  } catch (e) {
    return (e as Error).message.split('\n')[0];
  }
}

export const command: Command = {
  usage,
  run(_args, ctx) {
    let up = canonicalRemote(ctx.git(['remote', '-v']), ctx.repo);
    if (!up) {
      up = 'upstream';
      ctx.git(['remote', 'add', up, `https://github.com/${ctx.repo}.git`]);
      ctx.out(`已添加 remote ${up} → ${ctx.repo}`);
    }
    // A failed fetch means the session works on a stale copy; let the caller tell the owner.
    ctx.git(['fetch', '-q', up, 'main']);
    const ref = `${up}/main`;

    const branch = ctx.git(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
    if (branch === 'main') {
      const err = tryGit(ctx, ['merge', '-q', '--ff-only', ref]);
      ctx.out(err ? `本地 main 无法快进到 ${ref}，请手动处理：${err}` : `main 已对齐 ${ref}`);
    } else {
      // Updates the main ref without touching the checked-out branch; refuses non-fast-forward.
      const err = tryGit(ctx, ['fetch', '-q', up, 'main:main']);
      ctx.out(err ? `本地 main 无法快进到 ${ref}：${err}` : `main 已对齐 ${ref}`);
      const [ahead, behind] = ctx.git(['rev-list', '--left-right', '--count', `HEAD...${ref}`]).trim().split(/\s+/);
      ctx.out(`当前在 ${branch} 分支：领先 ${ref} ${ahead} 个提交，落后 ${behind} 个；是否 rebase 自行决定`);
    }

    if (up !== 'origin' && ctx.git(['remote']).split('\n').includes('origin')) {
      const err = tryGit(ctx, ['push', '-q', 'origin', `refs/remotes/${ref}:refs/heads/main`]);
      ctx.out(err ? `fork 的 main 未更新：${err}` : `fork（origin）的 main 已对齐 ${ref}`);
    }
  },
};
