import { parseArgs } from 'node:util';
import { UsageError, type Command } from '../lib/context.ts';
import { familyOf } from '../lib/labels.ts';

const usage = `new --title T [--label L]... [--body-file F]
    新建 issue 并输出链接。--label 写进正文，由 bot 在 issue 打开时打上（只限可由正文设置的 label）；
    --body-file - 读 stdin。`;

// Labels cannot be passed to `gh issue create`: the bot reverts labels it did not set.
// They go into the body, where the bot matches them when the issue opens.
export function composeBody(body: string, labels: string[]): string {
  const text = body.trim();
  if (!labels.length) return text;
  return `${text}${text ? '\n\n' : ''}Labels: ${labels.join(' ')}`;
}

export const command: Command = {
  usage,
  run(args, ctx) {
    const { values } = parseArgs({
      args,
      options: {
        title: { type: 'string' },
        label: { type: 'string', multiple: true, default: [] },
        'body-file': { type: 'string' },
      },
    });
    if (!values.title) throw new UsageError(usage);
    for (const l of values.label) {
      if (!familyOf(l)?.fromBody) throw new UsageError(`new: ${l} 不是可由正文设置的 label`);
    }
    const body = composeBody(values['body-file'] ? ctx.read(values['body-file']) : '', values.label);
    const url = ctx.gh(['issue', 'create', '-R', ctx.repo, '--title', values.title, '--body-file', '-'], body);
    ctx.out(url.trim());
  },
};
