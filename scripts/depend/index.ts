import { issueNumber, UsageError, type Command } from '../lib/context.ts';
import { formatSlash, fromSigned } from '../lib/slash.ts';

const usage = `depend N [+]#M... -#M...
    在 #N 评论 /depend、/undepend，由 bot 把 #N 设为被 #M 阻塞（GitHub issue 依赖）或取消。
    只有 issue 作者和有写权限的人的命令生效。`;

export const command: Command = {
  usage,
  run(args, ctx) {
    const n = issueNumber(args[0], usage);
    const commands = fromSigned(args.slice(1), 'depend', 'undepend');
    if (!commands.length) throw new UsageError(usage);
    const bad = commands.flatMap((c) => c.args).filter((a) => !/^#?\d+$/.test(a));
    if (bad.length) throw new UsageError(`depend: 不是 issue 编号：${bad.join(' ')}`);
    ctx.gh(['issue', 'comment', String(n), '-R', ctx.repo, '--body-file', '-'], formatSlash(commands));
  },
};
