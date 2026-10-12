import { parseArgs } from 'node:util';
import type { Command } from '../lib/context.ts';

const usage = `brief [--mine]
    列出未关闭的 issue：我负责的（我是作者或 assignee）在前，其余在后。--mine 只看我负责的。`;

export interface ListedIssue {
  number: number;
  title: string;
  author: { login: string };
  assignees: { login: string }[];
  labels: { name: string }[];
}

const mine = (i: ListedIssue, me: string) => i.author.login === me || i.assignees.some((a) => a.login === me);

function line(i: ListedIssue): string {
  const who = `@${i.author.login}${i.assignees.length ? ` → ${i.assignees.map((a) => `@${a.login}`).join(' ')}` : ''}`;
  const labels = i.labels.length ? ` [${i.labels.map((l) => l.name).join(' ')}]` : '';
  return `- #${i.number} ${i.title}  ${who}${labels}`;
}

export function format(issues: ListedIssue[], me: string, onlyMine: boolean): string {
  const sections: [string, ListedIssue[]][] = [[`我负责的（@${me}）`, issues.filter((i) => mine(i, me))]];
  if (!onlyMine) sections.push(['其他', issues.filter((i) => !mine(i, me))]);
  return sections
    .map(([title, list]) => [`## ${title} (${list.length})`, ...list.map(line), ''].join('\n'))
    .join('\n')
    .trimEnd();
}

export const command: Command = {
  usage,
  run(args, ctx) {
    const { values } = parseArgs({ args, options: { mine: { type: 'boolean', default: false } } });
    const me = ctx.gh(['api', 'user', '--jq', '.login']).trim();
    const issues = JSON.parse(
      ctx.gh(['issue', 'list', '-R', ctx.repo, '--state', 'open', '--limit', '1000', '--json', 'number,title,author,assignees,labels']),
    ) as ListedIssue[];
    ctx.out(format(issues, me, values.mine));
  },
};
