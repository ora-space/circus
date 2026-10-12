import { parseArgs } from 'node:util';
import type { Command } from '../lib/context.ts';
import { epicOf } from '../lib/deps.ts';
import { graphql } from '../lib/gh.ts';
import { describeIdentity, whoami } from '../lib/identity.ts';
import { parentOf } from '../lib/run.ts';

const usage = `brief [--mine]
    先说明你是谁（owner 还是成员），再列出未关闭的 issue，分三组：我创建的、等 owner 的（status:needs-owner）；其余我负责的（我是作者或 assignee）；
    其他。每组画成树：子事项（正文"总事项：#N"）和运行 issue 挂在所属 issue 下；组内按优先级排序；
    有未完成依赖的标出"等待"。--mine 不列"其他"。`;

export interface ListedIssue {
  number: number;
  title: string;
  author: string;
  assignees: string[];
  labels: string[];
  body: string;
  waitingOn: number[]; // open issues this one is blocked by
}

const mine = (i: ListedIssue, me: string) => i.author === me || i.assignees.includes(me);

// p0 first, unprioritized last, then by number.
function rank(i: ListedIssue): number {
  const p = i.labels.map((l) => /^priority:p(\d)$/.exec(l)?.[1]).find(Boolean);
  return (p === undefined ? 9 : Number(p)) * 1e9 + i.number;
}

// What an issue hangs under: the parent of a run, or the epic of a sub-item.
const upOf = (i: ListedIssue) => parentOf(i.body) ?? epicOf(i.body);

function describe(i: ListedIssue, nested: boolean): string {
  const notes: string[] = [];
  const up = upOf(i);
  if (!nested && up !== null) notes.push(parentOf(i.body) !== null ? `运行 → #${up}` : `总事项 #${up}`);
  if (i.waitingOn.length) notes.push(`等待 ${i.waitingOn.map((n) => `#${n}`).join(' ')}`);
  const who = `@${i.author}${i.assignees.length ? ` → ${i.assignees.map((a) => `@${a}`).join(' ')}` : ''}`;
  const labels = i.labels.length ? ` [${i.labels.join(' ')}]` : '';
  return `#${i.number} ${i.title}${notes.length ? `（${notes.join('；')}）` : ''}  ${who}${labels}`;
}

// The issues of one section as a forest; an issue nests only under an issue of the same section.
export function tree(list: ListedIssue[]): string[] {
  const byNumber = new Map(list.map((i) => [i.number, i]));
  const up = (n: number) => {
    const u = upOf(byNumber.get(n)!);
    return u !== null && u !== n && byNumber.has(u) ? u : null;
  };
  // Cycles in the written relations would hide issues; every issue on one becomes a root.
  const parent = new Map<number, number | null>();
  for (const i of list) {
    const seen = new Set([i.number]);
    let cur = up(i.number);
    while (cur !== null && !seen.has(cur)) {
      seen.add(cur);
      cur = up(cur);
    }
    parent.set(i.number, cur === null ? up(i.number) : null);
  }
  const children = new Map<number, ListedIssue[]>();
  for (const i of list) {
    const p = parent.get(i.number);
    if (p != null) children.set(p, [...(children.get(p) ?? []), i]);
  }
  const out: string[] = [];
  const walk = (i: ListedIssue, prefix: string, last: boolean, depth: number) => {
    out.push(depth === 0 ? `- ${describe(i, false)}` : `${prefix}${last ? '└─ ' : '├─ '}${describe(i, true)}`);
    const kids = children.get(i.number) ?? [];
    const next = depth === 0 ? '  ' : prefix + (last ? '   ' : '│  ');
    kids.forEach((k, idx) => walk(k, next, idx === kids.length - 1, depth + 1));
  };
  for (const i of list) if (parent.get(i.number) == null) walk(i, '', true, 0);
  return out;
}

export function format(issues: ListedIssue[], me: string, onlyMine: boolean): string {
  const sorted = [...issues].sort((a, b) => rank(a) - rank(b));
  // Only issues I opened: what I am blocked on, not everyone's queue (the board shows that).
  const waiting = sorted.filter((i) => i.author === me && i.labels.includes('status:needs-owner'));
  const rest = sorted.filter((i) => !waiting.includes(i));
  const sections: [string, ListedIssue[]][] = [
    ['等 owner（我创建的）', waiting],
    [`我负责的（@${me}）`, rest.filter((i) => mine(i, me))],
  ];
  if (!onlyMine) sections.push(['其他', rest.filter((i) => !mine(i, me))]);
  return sections
    .map(([title, list]) => [`## ${title} (${list.length})`, ...tree(list), ''].join('\n'))
    .join('\n')
    .trimEnd();
}

interface Node {
  number: number;
  title: string;
  body: string;
  author: { login: string } | null;
  assignees: { nodes: { login: string }[] };
  labels: { nodes: { name: string }[] };
  blockedBy: { nodes: { number: number; state: string }[] };
}

const QUERY = `query($o: String!, $r: String!, $after: String) { repository(owner: $o, name: $r) {
  issues(states: OPEN, first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes {
    number title body author { login } assignees(first: 20) { nodes { login } } labels(first: 30) { nodes { name } }
    blockedBy(first: 30) { nodes { number state } } } } } }`;

export function fetchOpen(run: Parameters<typeof graphql>[0], repo: string): ListedIssue[] {
  const [o, r] = repo.split('/');
  const out: ListedIssue[] = [];
  let after: string | null = null;
  do {
    const page: { repository: { issues: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: Node[] } } } = graphql(
      run,
      QUERY,
      { o, r, after },
    );
    const { pageInfo, nodes } = page.repository.issues;
    for (const n of nodes) {
      out.push({
        number: n.number,
        title: n.title,
        body: n.body,
        author: n.author?.login ?? 'ghost',
        assignees: n.assignees.nodes.map((a) => a.login),
        labels: n.labels.nodes.map((l) => l.name),
        waitingOn: n.blockedBy.nodes
          .filter((b) => b.state === 'OPEN')
          .map((b) => b.number)
          .sort((a, b) => a - b),
      });
    }
    after = pageInfo.hasNextPage ? pageInfo.endCursor : null;
  } while (after);
  return out;
}

export const command: Command = {
  usage,
  run(args, ctx) {
    const { values } = parseArgs({ args, options: { mine: { type: 'boolean', default: false } } });
    const id = whoami(ctx);
    ctx.out(describeIdentity(id) + '\n');
    ctx.out(format(fetchOpen(ctx.gh, ctx.repo), id.login, values.mine));
  },
};
