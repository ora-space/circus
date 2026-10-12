import { issueNumber, UsageError, type Command } from '../lib/context.ts';
import { isKnown } from '../lib/labels.ts';
import { formatSlash, fromSigned } from '../lib/slash.ts';

const usage = `label N [+]L... -L...
    在 #N 评论 /label、/unlabel，由 bot 修改 label。只有 issue 作者和有写权限的人的命令生效。`;

export const command: Command = {
  usage,
  run(args, ctx) {
    const n = issueNumber(args[0], usage);
    const commands = fromSigned(args.slice(1), 'label', 'unlabel');
    if (!commands.length) throw new UsageError(usage);
    const unknown = commands.flatMap((c) => c.args).filter((l) => !isKnown(l));
    if (unknown.length) throw new UsageError(`label: 未登记的 label：${unknown.join(' ')}`);
    ctx.gh(['issue', 'comment', String(n), '-R', ctx.repo, '--body-file', '-'], formatSlash(commands));
  },
};
