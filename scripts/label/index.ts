import { issueNumber, UsageError, type Command } from '../lib/context.ts';
import { isKnown } from '../lib/labels.ts';
import { formatSlash, fromSigned } from '../lib/slash.ts';

const usage = `label N [+]L... -L... [--sha COMMIT]
    在 #N 评论 /label、/unlabel，由 bot 修改 label。issue 作者和有写权限的人可以改任何 label；
    别人的运行 issue 在 status:in-review 时，任何人都可以 review：+review:lgtm（要带 --sha 写明审过的 commit）、
    +status:needs-author、-review:lgtm。`;

export const command: Command = {
  usage,
  run(args, ctx) {
    const n = issueNumber(args[0], usage);
    const rest = args.slice(1);
    const at = rest.indexOf('--sha');
    const sha = at < 0 ? undefined : rest.splice(at, 2)[1];
    if (at >= 0 && !/^[0-9a-f]{7,40}$/.test(sha ?? '')) throw new UsageError(`label: --sha 要写 7–40 位的 commit SHA\n\n${usage}`);
    const commands = fromSigned(rest, 'label', 'unlabel');
    if (!commands.length) throw new UsageError(usage);
    const unknown = commands.flatMap((c) => c.args).filter((l) => !isKnown(l));
    if (unknown.length) throw new UsageError(`label: 未登记的 label：${unknown.join(' ')}`);
    const body = formatSlash(commands);
    ctx.gh(['issue', 'comment', String(n), '-R', ctx.repo, '--body-file', '-'], sha ? `审过 commit ${sha}\n\n${body}` : body);
  },
};
