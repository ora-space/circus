import { parseArgs } from 'node:util';
import type { Command } from '../lib/context.ts';
import { parentOf } from '../lib/run.ts';

const usage = `brief [--mine]
    列出未关闭的 issue，分三组：我创建的、等 owner 的（status:needs-owner）；其余我负责的（我是作者或 assignee）；
    其他。组内按优先级排序，运行 issue 标出 parent。--mine 不列"其他"。`;

export interface ListedIssue {
  number: number;
  title: string;
  author: { login: string };
  assignees: { login: string }[];
  labels: { name: string }[];
  body: string;
}

const mine = (i: ListedIssue, me: string) => i.author.login === me || i.assignees.some((a) => a.login === me);

function line(i: ListedIssue): string {
  const who = `@${i.author.login}${i.assignees.length ? ` → ${i.assignees.map((a) => `@${a.login}`).join(' ')}` : ''}`;
  const labels = i.labels.length ? ` [${i.labels.map((l) => l.name).join(' ')}]` : '';
  const parent = parentOf(i.body);
  return `- #${i.number} ${i.title}${parent === null ? '' : `（运行 → #${parent}）`}  ${who}${labels}`;
}

const has = (i: ListedIssue, label: string) => i.labels.some((l) => l.name === label);

// p0 first, unprioritized last, then by number.
function rank(i: ListedIssue): number {
  const p = i.labels.map((l) => /^priority:p(\d)$/.exec(l.name)?.[1]).find(Boolean);
  return (p === undefined ? 9 : Number(p)) * 1e9 + i.number;
}

export function format(issues: ListedIssue[], me: string, onlyMine: boolean): string {
  const sorted = [...issues].sort((a, b) => rank(a) - rank(b));
  // Only issues I opened: what I am blocked on, not everyone's queue (the board shows that).
  const waiting = sorted.filter((i) => i.author.login === me && has(i, 'status:needs-owner'));
  const rest = sorted.filter((i) => !waiting.includes(i));
  const sections: [string, ListedIssue[]][] = [
    ['等 owner（我创建的）', waiting],
    [`我负责的（@${me}）`, rest.filter((i) => mine(i, me))],
  ];
  if (!onlyMine) sections.push(['其他', rest.filter((i) => !mine(i, me))]);
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
      ctx.gh(['issue', 'list', '-R', ctx.repo, '--state', 'open', '--limit', '1000', '--json', 'number,title,author,assignees,labels,body']),
    ) as ListedIssue[];
    ctx.out(format(issues, me, values.mine));
  },
};
