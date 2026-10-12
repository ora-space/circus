import { parseArgs } from 'node:util';
import { issueNumber, UsageError, type Command } from '../lib/context.ts';
import { whoami } from '../lib/identity.ts';
import { forAuthorLine, withSummary } from '../lib/summary.ts';

const usage = `close N --title T --summary-file F [--not-planned] [--for-author REASON]
    关闭 #N：改成能概括结果的标题，把详细总结写到正文最前面（原正文保留在分隔线下），再关闭。
    只有作者关闭自己的 issue；别人的 issue 应在里面提醒作者收尾。确需代关时加 --for-author 写明理由，
    总结第一行会记下"由 @你 代作者 @作者 关闭：理由"。
    先用 show N 把整个 issue 读一遍再写总结。--summary-file 读 UTF-8 文件；- 为 stdin（Windows 勿用管道喂中文）。`;

export const command: Command = {
  usage,
  run(args, ctx) {
    const { values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      options: {
        title: { type: 'string' },
        'summary-file': { type: 'string' },
        'not-planned': { type: 'boolean', default: false },
        'for-author': { type: 'string' },
      },
    });
    const n = issueNumber(positionals[0], usage);
    if (!values.title || !values['summary-file']) throw new UsageError(usage);
    let summary = ctx.read(values['summary-file']).trim();
    if (!summary) throw new UsageError('close: 总结不能为空');

    const { body, author } = JSON.parse(ctx.gh(['issue', 'view', String(n), '-R', ctx.repo, '--json', 'body,author'])) as {
      body: string;
      author: { login: string };
    };
    const me = whoami(ctx).login;
    if (me !== author.login) {
      const reason = values['for-author']?.trim();
      if (!reason) {
        throw new UsageError(
          `close: #${n} 的作者是 @${author.login}，应由作者关闭。请在 issue 里提醒作者总结后关闭；确需代关时加 --for-author "<理由>"。`,
        );
      }
      summary = `${forAuthorLine(me, author.login, reason)}\n\n${summary}`;
    }
    // Edit before closing: the bot reopens issues closed without a summary.
    ctx.gh(['issue', 'edit', String(n), '-R', ctx.repo, '--title', values.title, '--body-file', '-'], withSummary(body, summary));
    ctx.gh(['issue', 'close', String(n), '-R', ctx.repo, '--reason', values['not-planned'] ? 'not planned' : 'completed']);
    ctx.out(`#${n} 已关闭：${values.title}`);
  },
};
