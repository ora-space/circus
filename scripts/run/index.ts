import { parseArgs } from 'node:util';
import { issueNumber, UsageError, type Command } from '../lib/context.ts';
import { api, apiList } from '../lib/gh.ts';
import { runBody, runKind } from '../lib/run.ts';

const usage = `run N [--preflight] [--title T] [--body-file F]
    为 #N 开一个运行 issue（正文首行 Parent: #N），输出链接。bot 打上 run、挂为 #N 的子 issue，
    你不在 #N 的 assignee 里时补上。标题默认"运行：<#N 的标题>"。
    --preflight：#N 还在等未完成的依赖（如未拍板的决策）时先做，首行写 Parent: #N (preflight)；
    bot 打 preflight 而不是 run，依赖都关闭后自动转为 run。#N 没有未完成的依赖时按普通运行处理。
    #N 是 type:decision 时不能开；#N 依赖未关闭的 type:decision 时必须加 --preflight。
    --body-file 读 UTF-8 文件；- 为 stdin（Windows 勿用管道喂中文）。`;

export const command: Command = {
  usage,
  run(args, ctx) {
    const { values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      options: { title: { type: 'string' }, 'body-file': { type: 'string' }, preflight: { type: 'boolean', default: false } },
    });
    const n = issueNumber(positionals[0], usage);
    if (positionals.length > 1) throw new UsageError(usage);
    const parent = api<{ number: number; title: string; state: string; labels: { name: string }[] }>(ctx.gh, 'GET', `repos/${ctx.repo}/issues/${n}`);
    const blockers = apiList<{ number: number; state: string; labels: { name: string }[] }>(
      ctx.gh,
      `repos/${ctx.repo}/issues/${n}/dependencies/blocked_by?per_page=100`,
    );
    const kind = runKind(parent, blockers, values.preflight);
    if ('refused' in kind) throw new Error(kind.refused);
    if (kind.decisions.length) {
      throw new Error(`#${n} 依赖未关闭的决策 ${kind.decisions.map((d) => `#${d}`).join(' ')}，只能开 preflight：加上 --preflight。`);
    }
    const title = values.title ?? `运行：${parent.title}`;
    const body = runBody(n, values['body-file'] ? ctx.read(values['body-file']) : '', values.preflight);
    ctx.out(ctx.gh(['issue', 'create', '-R', ctx.repo, '--title', title, '--body-file', '-'], body).trim());
  },
};
