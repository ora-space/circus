import { issueNumber, UsageError, type Command } from '../lib/context.ts';
import { formatSlash } from '../lib/slash.ts';

const usage = `rerun N <repo>#<PR>...
    在运行 issue #N 评论 /rerun，由 bot 重跑产品仓库 PR 上失败的 CI（PR 可以写成 desktop#123 或链接）。
    PR 描述要写 Refs ora-space/circus#N；只有运行 issue 的作者、assignee 和有写权限的人的命令生效。`;

const PULL = /^([\w.-]+#\d+|https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+\/?)$/;

export const command: Command = {
  usage,
  run(args, ctx) {
    const n = issueNumber(args[0], usage);
    const pulls = args.slice(1);
    if (!pulls.length) throw new UsageError(usage);
    const bad = pulls.filter((a) => !PULL.test(a));
    if (bad.length) throw new UsageError(`rerun: 不是 PR：${bad.join(' ')}（写成 desktop#123 或 PR 链接）`);
    ctx.gh(['issue', 'comment', String(n), '-R', ctx.repo, '--body-file', '-'], formatSlash([{ verb: 'rerun', args: pulls }]));
  },
};
