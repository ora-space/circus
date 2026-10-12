import type { Command } from '../lib/context.ts';
import { ensureCanonical, pushForkMain, tryGit } from '../lib/remote.ts';

const usage = `sync
    每个会话开始时运行：从 ora-space/circus 拉取 main，把本地 main 快进到最新；
    origin 是 fork 时，顺手把 fork 的 main 也推到最新。只做快进，不覆盖本地改动。`;

export const command: Command = {
  usage,
  run(_args, ctx) {
    const { remote: up, added } = ensureCanonical(ctx.git, [], ctx.repo);
    if (added) ctx.out(`已添加 remote ${up} → ${ctx.repo}`);
    // A failed fetch means the session works on a stale copy; let the caller tell the owner.
    ctx.git(['fetch', '-q', up, 'main']);
    const ref = `${up}/main`;

    const branch = ctx.git(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
    if (branch === 'main') {
      const err = tryGit(ctx.git, ['merge', '-q', '--ff-only', ref]);
      ctx.out(err ? `本地 main 无法快进到 ${ref}，请手动处理：${err}` : `main 已对齐 ${ref}`);
    } else {
      // Updates the main ref without touching the checked-out branch; refuses non-fast-forward.
      const err = tryGit(ctx.git, ['fetch', '-q', up, 'main:main']);
      ctx.out(err ? `本地 main 无法快进到 ${ref}：${err}` : `main 已对齐 ${ref}`);
      const [ahead, behind] = ctx.git(['rev-list', '--left-right', '--count', `HEAD...${ref}`]).trim().split(/\s+/);
      ctx.out(`当前在 ${branch} 分支：领先 ${ref} ${ahead} 个提交，落后 ${behind} 个；是否 rebase 自行决定`);
    }

    const fork = pushForkMain(ctx.git, [], up);
    if (fork) ctx.out(fork);
  },
};
