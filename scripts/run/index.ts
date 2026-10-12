import { parseArgs } from 'node:util';
import { issueNumber, UsageError, type Command } from '../lib/context.ts';
import { runBody } from '../lib/run.ts';

const usage = `run N [--title T] [--body-file F]
    为 #N 开一个运行 issue（正文首行 Parent: #N），输出链接。bot 打上 run、挂为 #N 的子 issue，
    你不在 #N 的 assignee 里时补上。标题默认"运行：<#N 的标题>"。
    --body-file 读 UTF-8 文件；- 为 stdin（Windows 勿用管道喂中文）。`;

export const command: Command = {
  usage,
  run(args, ctx) {
    const { values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      options: { title: { type: 'string' }, 'body-file': { type: 'string' } },
    });
    const n = issueNumber(positionals[0], usage);
    if (positionals.length > 1) throw new UsageError(usage);
    const title = values.title ?? `运行：${ctx.gh(['issue', 'view', String(n), '-R', ctx.repo, '--json', 'title', '--jq', '.title']).trim()}`;
    const body = runBody(n, values['body-file'] ? ctx.read(values['body-file']) : '');
    ctx.out(ctx.gh(['issue', 'create', '-R', ctx.repo, '--title', title, '--body-file', '-'], body).trim());
  },
};
