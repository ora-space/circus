import { parseArgs } from 'node:util';
import type { Command } from '../lib/context.ts';
import { epicOf } from '../lib/deps.ts';
import { graphql } from '../lib/gh.ts';
import { describeIdentity, whoami } from '../lib/identity.ts';
import { parentOf } from '../lib/run.ts';

const usage = `brief [--mine]
    先说明你是谁（owner 还是成员），再列出未关闭的 issue，分五组：
      待关闭（我创建的）：有已合并的关联 PR、被 bot 重新打开过、或 parent 已关闭的运行 issue，最优先处理；
      等我跟进（我创建的，status:needs-author）：owner 已回复、决定或提出要求；
      owner 是"等我处理"：所有人的 status:needs-owner 和 status:in-review；成员是"等 owner"：我创建的 status:needs-owner；
      其余我负责的（我是作者或 assignee）；其他。
    每组画成树：子事项（正文"总事项：#N"）和运行 issue 挂在所属 issue 下；组内按优先级排序；
    有未完成依赖的标出"等待"。--mine 不列"其他"。空的分组不显示。`;

export interface ListedIssue {
  number: number;
  title: string;
  author: string;
  assignees: string[];
  labels: string[];
  body: string;
  waitingOn: number[]; // open issues this one is blocked by
  mergedPrs: string[]; // merged PRs that reference it, e.g. ora-space/desktop#12
  reopenedByBot: boolean; // a close was undone (no summary, or not the author)
}

const mine = (i: ListedIssue, me: string) => i.author === me || i.assignees.includes(me);

// p0 first, unprioritized last, then by number.
function rank(i: ListedIssue): number {
  const p = i.labels.map((l) => /^priority:p(\d)$/.exec(l)?.[1]).find(Boolean);
  return (p === undefined ? 9 : Number(p)) * 1e9 + i.number;
}

// What an issue hangs under: the parent of a run, or the epic of a sub-item.
const upOf = (i: ListedIssue) => parentOf(i.body) ?? epicOf(i.body);

// Why an open issue of mine looks done; empty when nothing says so. `open` is every open
// issue number, so a run whose parent is missing from it has a closed parent.
export function closeHints(i: ListedIssue, open: Set<number>): string[] {
  const hints: string[] = [];
  if (i.mergedPrs.length) hints.push(`PR ${i.mergedPrs.join(' ')} 已合并`);
  if (i.reopenedByBot) hints.push('被 bot 重新打开，补总结后关闭');
  const parent = parentOf(i.body);
  if (parent !== null && !open.has(parent)) hints.push(`parent #${parent} 已关闭`);
  return hints;
}

function describe(i: ListedIssue, nested: boolean, hints: string[] = []): string {
  const notes: string[] = [...hints];
  const up = upOf(i);
  if (!nested && up !== null) notes.push(parentOf(i.body) !== null ? `运行 → #${up}` : `总事项 #${up}`);
  if (i.waitingOn.length) notes.push(`等待 ${i.waitingOn.map((n) => `#${n}`).join(' ')}`);
  const who = `@${i.author}${i.assignees.length ? ` → ${i.assignees.map((a) => `@${a}`).join(' ')}` : ''}`;
  const labels = i.labels.length ? ` [${i.labels.join(' ')}]` : '';
  return `#${i.number} ${i.title}${notes.length ? `（${notes.join('；')}）` : ''}  ${who}${labels}`;
}

// The issues of one section as a forest; an issue nests only under an issue of the same section.
export function tree(list: ListedIssue[], hintsOf: (i: ListedIssue) => string[] = () => []): string[] {
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
    out.push(depth === 0 ? `- ${describe(i, false, hintsOf(i))}` : `${prefix}${last ? '└─ ' : '├─ '}${describe(i, true, hintsOf(i))}`);
    const kids = children.get(i.number) ?? [];
    const next = depth === 0 ? '  ' : prefix + (last ? '   ' : '│  ');
    kids.forEach((k, idx) => walk(k, next, idx === kids.length - 1, depth + 1));
  };
  for (const i of list) if (parent.get(i.number) == null) walk(i, '', true, 0);
  return out;
}

const WAITING_ON_OWNER = ['status:needs-owner', 'status:in-review'];

export function format(issues: ListedIssue[], me: string, onlyMine: boolean, owner = false): string {
  const sorted = [...issues].sort((a, b) => rank(a) - rank(b));
  const open = new Set(issues.map((i) => i.number));
  // Only the author closes an issue, so only mine can be in this group; it comes first.
  const hints = (i: ListedIssue) => (i.author === me ? closeHints(i, open) : []);
  const closable = sorted.filter((i) => hints(i).length);
  // The owner sees everyone's issues waiting on them: that is the owner's queue. A member sees
  // only their own issues waiting on the owner, not everyone's queue.
  const waiting = sorted.filter(
    (i) =>
      !closable.includes(i) &&
      (owner ? i.labels.some((l) => WAITING_ON_OWNER.includes(l)) : i.author === me && i.labels.includes('status:needs-owner')),
  );
  // The owner answered on my issue; it is my move.
  const answered = sorted.filter((i) => !closable.includes(i) && i.author === me && i.labels.includes('status:needs-author'));
  const rest = sorted.filter((i) => !closable.includes(i) && !waiting.includes(i) && !answered.includes(i));
  const sections: [string, ListedIssue[]][] = [
    ['待关闭（我创建的）', closable],
    ['等我跟进（owner 已回复）', answered],
    [owner ? '等我处理（owner：所有 needs-owner 和 in-review）' : '等 owner（我创建的）', waiting],
    [`我负责的（@${me}）`, rest.filter((i) => mine(i, me))],
  ];
  if (!onlyMine) sections.push(['其他', rest.filter((i) => !mine(i, me))]);
  // Empty groups are left out; with nothing at all, say so.
  const shown = sections.filter(([, list]) => list.length);
  if (!shown.length) return '没有未关闭的 issue';
  return shown
    .map(([title, list]) => [`## ${title} (${list.length})`, ...tree(list, hints), ''].join('\n'))
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
  timelineItems: {
    nodes: (
      | { __typename: 'CrossReferencedEvent'; source: { __typename: string; number?: number; merged?: boolean; repository?: { nameWithOwner: string } } }
      | { __typename: 'ReopenedEvent'; actor: { __typename: string } | null }
    )[];
  };
}

const QUERY = `query($o: String!, $r: String!, $after: String) { repository(owner: $o, name: $r) {
  issues(states: OPEN, first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes {
    number title body author { login } assignees(first: 20) { nodes { login } } labels(first: 30) { nodes { name } }
    blockedBy(first: 30) { nodes { number state } }
    timelineItems(last: 50, itemTypes: [CROSS_REFERENCED_EVENT, REOPENED_EVENT]) { nodes { __typename
      ... on CrossReferencedEvent { source { __typename ... on PullRequest { number merged repository { nameWithOwner } } } }
      ... on ReopenedEvent { actor { __typename } } } } } } } }`;

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
      const events = n.timelineItems.nodes;
      const mergedPrs = events.flatMap((e) =>
        e.__typename === 'CrossReferencedEvent' && e.source.__typename === 'PullRequest' && e.source.merged
          ? [e.source.repository!.nameWithOwner === repo ? `#${e.source.number}` : `${e.source.repository!.nameWithOwner}#${e.source.number}`]
          : [],
      );
      // The latest reopen decides: a person reopening after the bot means it is not done.
      const reopens = events.filter((e) => e.__typename === 'ReopenedEvent');
      const last = reopens.at(-1);
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
        mergedPrs: [...new Set(mergedPrs)],
        reopenedByBot: last?.__typename === 'ReopenedEvent' && last.actor?.__typename === 'Bot',
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
    ctx.out(format(fetchOpen(ctx.gh, ctx.repo), id.login, values.mine, id.owner));
  },
};
