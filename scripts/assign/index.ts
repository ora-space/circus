import { issueNumber, UsageError, type Command } from '../lib/context.ts';
import { formatSlash, fromSigned } from '../lib/slash.ts';

const usage = `assign N [+]@USER... -@USER...
    在 #N 评论 /assign、/unassign，由 bot 修改 assignee。作者、有写权限的人和现有 assignee 可以拉人；
    移除别人只有作者和有写权限的人可以，任何人可以移除自己。`;

export const command: Command = {
  usage,
  run(args, ctx) {
    const n = issueNumber(args[0], usage);
    const commands = fromSigned(args.slice(1), 'assign', 'unassign');
    if (!commands.length) throw new UsageError(usage);
    ctx.gh(['issue', 'comment', String(n), '-R', ctx.repo, '--body-file', '-'], formatSlash(commands));
  },
};
