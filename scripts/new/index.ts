import { parseArgs } from 'node:util';
import { UsageError, type Command } from '../lib/context.ts';
import { dependLine, epicLine } from '../lib/deps.ts';
import { familyOf } from '../lib/labels.ts';

const usage = `new --title T [--label L]... [--depend N]... [--epic N] [--body-file F]
    新建 issue 并输出链接。--label、--depend 写进正文，由 bot 在 issue 打开时打上 label、设为依赖
    （只限可由正文设置的 label）；--epic 写"总事项：#N"，brief 据此画树。--body-file - 读 stdin。`;

// Labels cannot be passed to `gh issue create`: the bot reverts labels it did not set.
// They go into the body with the relations, where the bot reads them when the issue opens.
export function composeBody(body: string, labels: string[], depends: number[] = [], epic?: number): string {
  const lines = [
    ...(epic === undefined ? [] : [epicLine(epic)]),
    ...(depends.length ? [dependLine(depends)] : []),
    ...(labels.length ? [`Labels: ${labels.join(' ')}`] : []),
  ];
  const text = body.trim();
  if (!lines.length) return text;
  return `${text}${text ? '\n\n' : ''}${lines.join('\n')}`;
}

const issueRef = (arg: string) => {
  const m = /^#?(\d+)$/.exec(arg);
  if (!m) throw new UsageError(`new: ${arg} 不是 issue 编号`);
  return Number(m[1]);
};

export const command: Command = {
  usage,
  run(args, ctx) {
    const { values } = parseArgs({
      args,
      options: {
        title: { type: 'string' },
        label: { type: 'string', multiple: true, default: [] },
        depend: { type: 'string', multiple: true, default: [] },
        epic: { type: 'string' },
        'body-file': { type: 'string' },
      },
    });
    if (!values.title) throw new UsageError(usage);
    for (const l of values.label) {
      if (!familyOf(l)?.fromBody) throw new UsageError(`new: ${l} 不是可由正文设置的 label`);
    }
    const depends = values.depend.map(issueRef);
    const epic = values.epic === undefined ? undefined : issueRef(values.epic);
    const body = composeBody(values['body-file'] ? ctx.read(values['body-file']) : '', values.label, depends, epic);
    const url = ctx.gh(['issue', 'create', '-R', ctx.repo, '--title', values.title, '--body-file', '-'], body);
    ctx.out(url.trim());
  },
};
