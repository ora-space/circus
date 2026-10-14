import { handle, referencedIssues, type Event } from '../handle.ts';
import type { GitHub, Issue } from '../github.ts';
import type { Board } from '../../lib/board.ts';
import { parentOf } from '../../lib/run.ts';
import { hasSummary, closedForAuthor, splitSummary } from '../../lib/summary.ts';
import { parseSlash } from '../../lib/slash.ts';
import type { NotificationConfig, Status } from './config.ts';
import { enqueue, type StateStore } from './store.ts';
import { type Snapshot, type Cause, type Pull } from './rules.ts';

export function snapshot(gh: GitHub, repo: string, n: number, pulls?: (n: number) => Pull[]): Snapshot {
  const issue = gh.getIssue(n);
  const parent = parentOf(issue.body);
  return {
    number: n, title: issue.title, url: `https://github.com/${repo}/issues/${n}`, author: issue.user.login,
    open: issue.state === 'open', status: (issue.labels.find(l => l.name.startsWith('status:'))?.name.slice(7) ?? 'none') as Status,
    assignees: issue.assignees.map(a => a.login), parent, parentOpen: parent === null || gh.getIssue(parent).state === 'open',
    blockers: gh.blockedBy(n).filter(i => i.state === 'open').map(i => i.number).sort((a,b) => a-b),
    runs: gh.subIssues(n).filter(i => parentOf(i.body) === n).map(i => ({ number: i.number, author: i.user.login, open: i.state === 'open' })),
    lgtm: issue.labels.some(l => l.name === 'review:lgtm'), prs: pulls?.(n) ?? [],
  };
}
export function eventCause(event: Event): Cause {
  const p = event.payload;
  const kind = event.name === 'issue_comment' ? 'command' : event.name.startsWith('pull_request') ? 'pr'
    : ['opened', 'closed', 'reopened'].includes(p.action) ? p.action : 'sync';
  return { id: `${event.name}:${p.action}:${p.comment?.id ?? p.pull_request?.id ?? p.issue?.id}:${p.comment?.created_at ?? p.issue?.updated_at ?? p.pull_request?.updated_at ?? ''}`,
    actor: p.sender?.login ?? '', kind, issue: p.issue?.number, sourceUrl: p.comment?.html_url ?? p.pull_request?.html_url };
}
function validClose(issue: Issue, actor: string) {
  return hasSummary(issue.body) && (actor === issue.user.login || closedForAuthor(splitSummary(issue.body).summary, issue.user.login));
}
export function relevantIssues(event: Event, gh: GitHub, repo: string): number[] {
  const p = event.payload;
  const seeds: number[] = p.issue ? [p.issue.number] : p.pull_request ? referencedIssues(p.pull_request.body, repo) : [];
  const out = new Set(seeds);
  for (const n of seeds) {
    const issue = gh.getIssue(n);
    const parent = parentOf(issue.body);
    if (parent !== null) out.add(parent);
    for (const item of gh.subIssues(n)) out.add(item.number);
    for (const item of gh.blocking(n)) out.add(item.number);
  }
  return [...out];
}
export function observeHandle(
  event: Event, gh: GitHub, repo: string, store: StateStore, config: NotificationConfig, board?: Board,
  pulls?: (n: number) => Pull[],
): void {
  const p = event.payload;
  // Corrections and echo events must not masquerade as successful work handoffs.
  const supported = (event.name === 'issue_comment' && p.action === 'created' && parseSlash(p.comment?.body ?? '').length > 0)
    || (event.name === 'issues' && ['opened', 'closed', 'reopened'].includes(p.action))
    || (event.name === 'pull_request_target' && p.action === 'closed' && p.pull_request?.merged);
  if (!config.enabled || !supported || p.sender?.type === 'Bot' || p.issue?.pull_request) return handle(event, gh, board);
  const cause = eventCause(event);
  const ns = relevantIssues(event, gh, repo);
  const before = ns.map(n => snapshot(gh, repo, n, pulls));
  const changed = p.issue?.number;
  // GitHub delivers lifecycle events after the state has changed. Reconstruct the pre-event graph.
  if (event.name === 'issues' && ['closed', 'reopened'].includes(p.action)) {
    const wasOpen = p.action === 'closed';
    for (const s of before) {
      if (s.number === changed) s.open = wasOpen;
      if (s.parent === changed) s.parentOpen = wasOpen;
      for (const run of s.runs) if (run.number === changed) run.open = wasOpen;
      if (gh.blockedBy(s.number).some(b => b.number === changed)) {
        s.blockers = wasOpen ? [...new Set([...s.blockers, changed])].sort((a,b)=>a-b) : s.blockers.filter(n => n !== changed);
      }
    }
  }
  for (const s of before) store.state.snapshots[s.number] ??= s;
  store.save(); // A failing mutation/read can be reconciled against this pre-operation baseline.
  const requests: string[] = [];
  let failure: unknown;
  try { handle(event, gh, board, { acceptedLabel: (_n, l) => requests.push(l) }); }
  catch (e) { failure = e; }
  try {
    const after = ns.map(n => snapshot(gh, repo, n, pulls));
    if (event.name === 'issues' && p.action === 'closed' && !validClose(p.issue, cause.actor)) {
      // Illegal close followed by reopen is a correction, not a restored task.
      for (const s of after) store.state.snapshots[s.number] = s;
      store.save();
    } else {
      if (p.pull_request?.merged) {
        const pr: Pull = { key: `${repo}#${p.pull_request.number}`, sha: p.pull_request.head?.sha ?? '', state: 'merged', url: p.pull_request.html_url };
        for (const s of after) {
          const prior = before.find(x => x.number === s.number)!;
          prior.prs = [...prior.prs.filter(x => x.key !== pr.key), { ...pr, state: 'open' }];
          s.prs = [...s.prs.filter(x => x.key !== pr.key), pr];
        }
      }
      enqueue(store, p.action === 'opened' ? before.filter(s => s.number !== changed) : before, after,
        { ...cause, requests }, config);
    }
  } catch (e) { failure ??= e; }
  if (failure) throw failure;
}

// Read-only reconciliation for local polling / missed events. Initialize without broadcasting history.
export function reconcile(store: StateStore, current: Snapshot[], cause: Cause, config: NotificationConfig): void {
  const old = current.map(s => store.state.snapshots[s.number]).filter(Boolean);
  enqueue(store, old, current, cause, config);
}
