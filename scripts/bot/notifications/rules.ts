import { createHash } from 'node:crypto';
import type { NotificationConfig, Status } from './config.ts';

export interface Run { number: number; author: string; open: boolean }
export interface Pull { key: string; sha: string; state: 'open' | 'merged' | 'closed'; url: string }
export interface Snapshot {
  number: number; title: string; url: string; author: string; open: boolean; status: Status; assignees: string[];
  parent: number | null; parentOpen: boolean; blockers: number[]; runs: Run[]; lgtm: boolean; prs: Pull[];
}
export interface Cause {
  id: string; actor: string; kind: 'opened' | 'command' | 'closed' | 'reopened' | 'sync' | 'pr';
  issue?: number;
  requests?: string[]; // Only accepted labels, after a successful write. Never parse arbitrary comment prose.
  sourceUrl?: string;
}
export interface Candidate {
  key: string; issue: number; recipient: string; reason: string; actor: string; source: string; url: string; title: string;
  guard: { kind: string; value?: string; target?: number };
}
export const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const canonical = (xs: string[]) => [...new Set(xs.map(x => x.toLowerCase()))];
const active = (s: Snapshot) => s.runs.filter(r => r.open);
const reviewers = (s: Snapshot) => s.parent !== null ? s.assignees.filter(u => u.toLowerCase() !== s.author.toLowerCase()) : [];
const executors = (s: Snapshot) => {
  const runs = active(s).map(r => r.author);
  return runs.length ? runs : s.parent !== null ? [s.author] : s.assignees.length ? s.assignees : [s.author];
};
const revisions = (s: Snapshot) => hash(s.prs.map(p => [p.key, p.sha]).sort());
export function candidates(before: Snapshot | undefined, after: Snapshot, cause: Cause, config: NotificationConfig): Candidate[] {
  if (!config.enabled || !cause.actor || cause.actor.endsWith('[bot]')) return [];
  const out: Candidate[] = [];
  const add = (key: string, users: string[], reason: string, guard: Candidate['guard']) => {
    const enabled = key.startsWith('initialStatus.') ? config.initialStatus[key.slice(14) as Status]
      : key.startsWith('statusTransitions.') ? config.statusTransitions[key.slice(18)]
      : config.events[key as keyof typeof config.events];
    if (!enabled) return;
    for (const recipient of canonical(users).filter(u => u !== cause.actor.toLowerCase())) {
      const actualGuard = guard.kind === 'status' && after.status === 'in-review' && after.parent !== null && !config.ownerRecipients.includes(recipient)
        ? { ...guard, kind: 'status-reviewer' } : guard;
      out.push({ key, issue: after.number, recipient, reason, guard: actualGuard, actor: cause.actor.toLowerCase(),
        source: cause.id, url: cause.sourceUrl ?? after.url, title: after.title });
    }
  };
  const handoff = (key: string) => {
    const users = after.status === 'needs-author' ? [after.author] : after.status === 'in-review'
      ? [...config.ownerRecipients, ...reviewers(after)] : config.ownerRecipients;
    const reason = after.status === 'needs-author' ? '请跟进已回复的结论或修改要求'
      : after.status === 'in-review' ? '请审查当前交付（是否合并仍由 owner 决定）' : '请回复、决策或授权';
    add(key, users, reason, { kind: 'status', value: `${after.status}:${revisions(after)}` });
  };
  if (!before) {
    if (cause.kind === 'opened' && after.open && (after.parent === null || after.parentOpen)) handoff(`initialStatus.${after.status}`);
    return out;
  }
  if (after.open && after.parent !== null && !after.parentOpen) {
    if (before.parentOpen || (!before.open && cause.kind === 'reopened')) {
      add(before.parentOpen ? 'parent_closed_with_open_runs' : 'run_reopened_with_closed_parent', [after.author],
        'parent 已关闭，请为仍打开的运行写总结并收尾', { kind: 'closed-parent' });
    }
    return out;
  }
  if (!after.open) return out; // Closed issues only cause actions on dependents / parent / runs.
  if (!before.open && cause.kind === 'reopened') {
    add(after.parent === null ? 'issue_reopened' : 'run_reopened', executors(after),
      '事项已重新打开，请确认恢复执行的安排', { kind: 'open' });
  } else if (before.open && cause.kind !== 'opened') {
    if (before.status !== after.status && !['closed', 'reopened'].includes(cause.kind)) {
      handoff(`statusTransitions.${before.status}->${after.status}`);
    } else if (before.status === after.status && (cause.issue === undefined || cause.issue === after.number) && cause.requests?.includes(`status:${after.status}`)) {
      handoff(after.status === 'in-review' ? revisions(before) !== revisions(after)
        ? 'review_requested_for_new_revision' : 'review_requested_again_same_revision'
        : after.status === 'needs-owner' ? 'owner_request_updated' : 'author_request_updated');
    }
  }
  const assigned = after.assignees.filter(u => !canonical(before.assignees).includes(u.toLowerCase()));
  if (after.parent === null && cause.kind !== 'opened') add('participant_assigned', assigned, '请参与此事项，先查看当前阶段与依赖', { kind: 'assigned' });
  if (after.parent !== null && before.status === 'in-review' && after.status === 'in-review') {
    add('reviewer_assigned_during_review', assigned.filter(u => u !== after.author), '请审查此运行的交付', { kind: 'reviewer' });
  }
  const removed = before.assignees.filter(u => !canonical(after.assignees).includes(u.toLowerCase()));
  const activity = after.parent !== null ? before.status === 'in-review' : before.status === 'none' && !before.blockers.length;
  if (activity) for (const user of removed) {
    const self = user.toLowerCase() === cause.actor.toLowerCase();
    add(after.parent !== null ? self ? 'reviewer_left_during_review' : 'reviewer_removed_during_review'
      : self ? 'participant_left' : 'participant_removed', self ? [after.author] : [user],
      self ? '协作者已退出，请确认剩余安排' : '你此前的执行或审查指派已撤回', { kind: 'removed', value: user.toLowerCase() });
  }
  if (after.status === 'in-review') {
    if (!before.lgtm && after.lgtm) add('lgtm_added', config.ownerRecipients, '已有审查认可，请检查审过版本后决定是否合并', { kind: 'lgtm', value: revisions(after) });
    if (before.lgtm && !after.lgtm && before.status === after.status && !cause.requests?.includes('status:in-review')) {
      add('lgtm_withdrawn', config.ownerRecipients, '旧审查认可已撤回，请勿依据旧认可合并', { kind: 'no-lgtm' });
    }
    if (before.lgtm && revisions(before) !== revisions(after)) {
      add('lgtm_invalidated_by_revision', config.ownerRecipients, '交付版本已变化，旧审查认可不再适用', { kind: 'revision', value: revisions(after) });
    }
  }
  if (before.blockers.length && !after.blockers.length && after.status === 'none') {
    add(cause.kind === 'closed' ? 'last_blocker_closed' : 'last_blocker_removed', executors(after),
      '最后一个未完成依赖已解除，请确认恢复执行', { kind: 'ready' });
  } else if (!after.blockers.length && before.status !== 'none' && after.status === 'none') {
    // Only resume when a prior blocking wait exists, supplied by persisted history.
    if ((before as Snapshot & { waitingForExecution?: boolean }).waitingForExecution) {
      add('execution_resumed_after_handoff', executors(after), '依赖已解除且交接等待已结束，请恢复执行', { kind: 'ready' });
    }
  }
  const addedBlockers = after.blockers.filter(n => !before.blockers.includes(n));
  if (addedBlockers.length && active(after).length) {
    add(cause.kind === 'reopened' ? 'blocker_reopened' : before.blockers.length ? 'blocker_replaced' : 'blocker_added',
      active(after).map(r => r.author), '执行前提出现新的未完成依赖，请检查受影响部分', { kind: 'blocked' });
  }
  if (active(before).length && !active(after).length && after.status === 'none' && !after.blockers.length) {
    add('last_run_closed', [after.author], '最后一个运行已结束，请汇总成果并决定后续（事项尚未自动完成）', { kind: 'summary' });
  }
  if (!active(before).length && active(after).length && cause.kind === 'reopened') {
    add('parent_summary_invalidated_by_run_reopen', [after.author], '运行已重新打开，先前的收尾判断已失效', { kind: 'runs-open' });
  }
  for (const pr of after.prs) {
    const old = before.prs.find(p => p.key === pr.key);
    if (old?.state === 'open' && pr.state === 'merged') add('pr_merged', [after.author],
      `PR ${pr.key} 已合并，请检查剩余交付并总结；不代表全部完成`, { kind: 'pr', value: `${pr.key}:merged` });
    if (old?.state === 'open' && pr.state === 'closed' && before.status === 'in-review') add('review_pr_closed_without_merge',
      [after.author, ...config.ownerRecipients, ...reviewers(after)], `PR ${pr.key} 未合并即关闭，请处理并撤回失效审查`, { kind: 'pr', value: `${pr.key}:closed` });
  }
  if (before.status === 'in-review') for (const pr of before.prs.filter(p => p.state === 'open' && !after.prs.some(q => q.key === p.key))) {
    add('review_pr_reference_removed', [...config.ownerRecipients, ...reviewers(before)], `PR ${pr.key} 的待审引用已撤回`, { kind: 'pr-removed', value: pr.key });
  }
  return out;
}

export function stillValid(c: Candidate, s: Snapshot): boolean {
  if (!s.open) return false;
  if (s.parent !== null && !s.parentOpen) return c.guard.kind === 'closed-parent';
  switch (c.guard.kind) {
    case 'status': return c.guard.value === `${s.status}:${revisions(s)}`;
    case 'status-reviewer': return c.guard.value === `${s.status}:${revisions(s)}` && s.assignees.map(u=>u.toLowerCase()).includes(c.recipient);
    case 'assigned': return s.assignees.map(u => u.toLowerCase()).includes(c.recipient);
    case 'reviewer': return s.status === 'in-review' && s.assignees.map(u => u.toLowerCase()).includes(c.recipient);
    case 'removed': return !s.assignees.map(u => u.toLowerCase()).includes(c.guard.value!);
    case 'lgtm': return s.status === 'in-review' && s.lgtm && revisions(s) === c.guard.value;
    case 'no-lgtm': return s.status === 'in-review' && !s.lgtm;
    case 'revision': return s.status === 'in-review' && revisions(s) === c.guard.value;
    case 'ready': return s.status === 'none' && !s.blockers.length;
    case 'blocked': return s.blockers.length > 0 && active(s).some(r => r.author.toLowerCase() === c.recipient);
    case 'summary': return s.status === 'none' && !s.blockers.length && !active(s).length;
    case 'runs-open': return active(s).length > 0;
    case 'closed-parent': return !s.parentOpen;
    case 'pr': return s.prs.some(p => `${p.key}:${p.state}` === c.guard.value);
    case 'pr-removed': return !s.prs.some(p => p.key === c.guard.value);
    default: return true;
  }
}
