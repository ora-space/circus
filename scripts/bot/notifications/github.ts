import { api, apiList, graphql, type Gh } from '../../lib/gh.ts';
import type { Snapshot, Pull, Cause } from './rules.ts';
import { referencedIssues, authorize } from '../handle.ts';
import { parseSlash } from '../../lib/slash.ts';
import type { Issue } from '../github.ts';
import type { GitHub } from '../github.ts';
import { hasSummary, closedForAuthor, splitSummary } from '../../lib/summary.ts';

// Only actual GitHub PR objects with an exact circus reference are trusted, never prose claiming a merge.
export function linkedPulls(run: Gh, repo: string, n: number): Pull[] {
  const timeline = apiList<any>(run, `repos/${repo}/issues/${n}/timeline?per_page=100`);
  const urls = new Set<string>();
  for (const event of timeline) {
    const url = event.source?.issue?.pull_request?.url;
    if (event.event === 'cross-referenced' && typeof url === 'string' && /^https:\/\/api\.github\.com\/repos\/ora-space\/[\w.-]+\/pulls\/\d+$/.test(url)) urls.add(url);
  }
  const prs: Pull[] = [];
  for (const url of urls) {
    const pr = api<any>(run, 'GET', url);
    const sourceRepo = pr.base?.repo?.full_name;
    // Local #N references only apply inside circus; product repos must name ora-space/circus#N.
    const body = sourceRepo === repo ? pr.body : (pr.body ?? '').replace(/\b(?:refs|fixes|fixed|closes|closed|resolves|resolved)\s*:?\s+#\d+/gi, '');
    if (!referencedIssues(body, repo).includes(n)) continue;
    prs.push({ key: `${sourceRepo}#${pr.number}`, sha: pr.head.sha,
      state: pr.merged ? 'merged' : pr.state === 'closed' ? 'closed' : 'open', url: pr.html_url });
  }
  return prs.sort((a,b)=>a.key.localeCompare(b.key));
}

// Recover the human behind a bot-applied slash command using GitHub's authenticated reaction.
// No natural language classification or --actor override in the live observer.
export function observedCause(run: Gh, repo: string, issue: Issue, before: Snapshot | undefined): Cause | undefined {
  const timeline = apiList<any>(run, `repos/${repo}/issues/${issue.number}/timeline?per_page=100`);
  const relevant = [...timeline].reverse().find(e => ['labeled', 'unlabeled', 'assigned', 'unassigned', 'closed', 'reopened'].includes(e.event));
  if (!relevant) return undefined;
  let source = relevant;
  let kind: Cause['kind'] = relevant.event === 'closed' ? 'closed' : relevant.event === 'reopened' ? 'reopened' : 'sync';
  let requests: string[] = [];
  if (relevant.actor?.type !== 'Bot' && kind === 'sync') return undefined; // Hand-edited labels/assignees are reverted by protocol.
  if (relevant.actor?.type === 'Bot') {
    const comments = timeline.filter(e => e.event === 'commented' && e.user?.type !== 'Bot' && parseSlash(e.body ?? '').length);
    source = undefined;
    for (const comment of [...comments].reverse()) {
      const reactions = apiList<any>(run, `repos/${repo}/issues/comments/${comment.id}/reactions?per_page=100`);
      if (reactions.some(r => r.content === '+1' && r.user?.login === relevant.actor.login)) { source = comment; break; }
    }
    if (!source) return undefined;
    const actor = source.user.login;
    const commands = parseSlash(source.body);
    let writer: boolean | undefined;
    const permitted = () => writer ??= ['admin', 'write'].includes(api<any>(run, 'GET', `repos/${repo}/collaborators/${actor}/permission`).permission);
    // Reconstruct the permission-relevant pre-state for reviewers when handing R back to A.
    const permissionIssue = before ? { ...issue, labels: before.status === 'none' ? [] : [{ name: `status:${before.status}` }] } : issue;
    const allowed = commands.filter(cmd => authorize(cmd, actor, permissionIssue, permitted) === null);
    if (allowed.length !== commands.length) return undefined;
    requests = allowed.filter(c => c.verb === 'label').flatMap(c => c.args).filter(l => issue.labels.some(x=>x.name===l));
    kind = 'command';
  }
  const actor = source.user?.login ?? source.actor?.login;
  if (!actor || (source.user?.type ?? source.actor?.type) === 'Bot') return undefined;
  if (kind === 'closed' && (!hasSummary(issue.body) || (actor !== issue.user.login && !closedForAuthor(splitSummary(issue.body).summary, issue.user.login)))) return undefined;
  return { id: `timeline:${repo}:${issue.number}:${source.id}`, actor, kind, requests,
    issue: issue.number,
    sourceUrl: source.html_url ?? `https://github.com/${repo}/issues/${issue.number}` };
}

function dependencyCause(run: Gh, repo: string, n: number): Cause | undefined {
  const [owner,name] = repo.split('/');
  const data = graphql<any>(run, `query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){issue(number:$n){
    timelineItems(last:1,itemTypes:[BLOCKED_BY_ADDED_EVENT,BLOCKED_BY_REMOVED_EVENT]){nodes{
      ... on BlockedByAddedEvent{id actor{login __typename}}
      ... on BlockedByRemovedEvent{id actor{login __typename}}
    }}
  }}}`, {o:owner,r:name,n});
  const event = data.repository.issue.timelineItems.nodes[0];
  if (!event?.actor || event.actor.__typename === 'Bot') return undefined;
  return {id:`dependency:${event.id}`,actor:event.actor.login,kind:'sync',issue:n};
}

export function changeCause(run: Gh, gh: GitHub, repo: string, before: Snapshot, after: Snapshot, known: {[n:string]:Snapshot} = {}): Cause | undefined {
  for (const pr of after.prs) {
    const previous=before.prs.find(p=>p.key===pr.key);
    if(previous?.state==='open' && pr.state!=='open') {
      const [sourceRepo,number]=pr.key.split('#');
      const timeline=apiList<any>(run,`repos/${sourceRepo}/issues/${number}/timeline?per_page=100`);
      const event=[...timeline].reverse().find(e=>['closed','merged'].includes(e.event) && e.actor?.type!=='Bot');
      if(event?.actor?.login)return {id:`pr:${pr.key}:${event.id}`,actor:event.actor.login,kind:'pr',sourceUrl:pr.url};
      return undefined;
    }
  }
  if (before.parentOpen !== after.parentOpen && after.parent !== null) return observedCause(run,repo,gh.getIssue(after.parent),undefined);
  const changedRuns = after.runs.filter(r=>before.runs.some(old=>old.number===r.number && old.open!==r.open));
  if (changedRuns.length) return observedCause(run,repo,gh.getIssue(changedRuns[0].number),undefined);
  const removed = before.blockers.filter(n=>!after.blockers.includes(n));
  for (const n of removed) if (known[n]?.open && gh.getIssue(n).state === 'closed') return observedCause(run,repo,gh.getIssue(n),known[n]);
  const added = after.blockers.filter(n=>!before.blockers.includes(n));
  if (added.length) for (const n of added) {
    const origin=known[n] && !known[n].open ? observedCause(run,repo,gh.getIssue(n),known[n]) : undefined;
    if(origin?.kind==='reopened')return origin;
  }
  if (removed.length || added.length) {
    const dependency=dependencyCause(run,repo,after.number);
    if(dependency)return dependency;
  }
  return observedCause(run,repo,gh.getIssue(after.number),before);
}
