import { parseArgs } from 'node:util';
import { issueNumber, UsageError, type Command } from '../lib/context.ts';
import { withSummary } from '../lib/summary.ts';

const usage = `close N --title T --summary-file F [--not-planned]
    关闭 #N：改成能概括结果的标题，把详细总结写到正文最前面（原正文保留在分隔线下），再关闭。
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
      },
    });
    const n = issueNumber(positionals[0], usage);
    if (!values.title || !values['summary-file']) throw new UsageError(usage);
    const summary = ctx.read(values['summary-file']).trim();
    if (!summary) throw new UsageError('close: 总结不能为空');

    const body = ctx.gh(['issue', 'view', String(n), '-R', ctx.repo, '--json', 'body', '--jq', '.body']);
    // Edit before closing: the bot reopens issues closed without a summary.
    ctx.gh(['issue', 'edit', String(n), '-R', ctx.repo, '--title', values.title, '--body-file', '-'], withSummary(body, summary));
    ctx.gh(['issue', 'close', String(n), '-R', ctx.repo, '--reason', values['not-planned'] ? 'not planned' : 'completed']);
    ctx.out(`#${n} 已关闭：${values.title}`);
  },
};
