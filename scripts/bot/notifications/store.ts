import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import { hash, revisions, stillValid, type Candidate, type Cause, type Snapshot } from './rules.ts';
import type { NotificationConfig } from './config.ts';
import { candidates } from './rules.ts';
import { formatMessage } from './message.ts';
import type { Sender } from './feishu.ts';

export interface Record {
  id: string; candidates: Candidate[]; state: 'pending' | 'sent' | 'obsolete'; attempts: number; error?: string;
}
export interface State { version: 2; snapshots: { [n: string]: Snapshot & { waitingForExecution?: boolean } }; records: Record[]; sources: string[] }
export const emptyState = (): State => ({ version: 2, snapshots: {}, records: [], sources: [] });
export interface StateStore { state: State; save(): void; close(): void }
// Production best-effort delivery keeps only this invocation's candidates and identities.
export function memoryStore(): StateStore {
  return { state: emptyState(), save() {}, close() {} };
}
export function fileStore(path: string): StateStore {
  mkdirSync(dirname(path), { recursive: true });
  const lock = `${path}.lock`;
  let fd: number;
  try { fd = openSync(lock, 'wx'); } catch { throw new Error('通知状态文件已被占用；确认无进程使用后再移除 .lock'); }
  try {
    const raw = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : emptyState();
    if (![1,2].includes(raw.version) || !raw.snapshots || !Array.isArray(raw.records) || !Array.isArray(raw.sources)) throw new Error('通知状态文件格式错误');
    const state = raw as State;
    if (raw.version === 1) {
      state.version = 2;
      for (const record of state.records) for (const c of record.candidates) {
        if (!['status','status-reviewer'].includes(c.guard.kind)) continue;
        const [status, revision] = (c.guard.value ?? '').split(':');
        c.guard.value = status;
        if (status === 'in-review') c.guard.revision = revision;
        c.guard.handoffId = c.source;
        if (state.snapshots[c.issue]?.status === status) state.snapshots[c.issue].handoffId = c.source;
      }
    }
    return {
      state,
      save() { writeFileSync(`${path}.new`, JSON.stringify(state, null, 2)); renameSync(`${path}.new`, path); },
      close() { closeSync(fd); unlinkSync(lock); },
    };
  } catch (e) { closeSync(fd); unlinkSync(lock); throw e; }
}
export function enqueue(store: StateStore, before: Snapshot[], after: Snapshot[], cause: Cause, config: NotificationConfig): void {
  const replay = store.state.sources.includes(cause.id);
  const pending: Candidate[] = [];
  for (const s of after) {
    const previous = cause.kind === 'opened' && cause.issue === s.number ? undefined
      : before.find(b => b.number === s.number) ?? store.state.snapshots[s.number];
    const historic = store.state.snapshots[s.number];
    const newRequest = !replay && (!previous || previous.status !== s.status || previous.open !== s.open
      || ((cause.issue === undefined || cause.issue === s.number) && cause.requests?.includes(`status:${s.status}`)));
    const current = { ...s, handoffId: newRequest ? cause.id : historic?.handoffId,
      reviewVersion: s.status !== 'in-review' ? undefined : newRequest
        ? s.prsKnown === false ? undefined : revisions(s)
        : historic?.reviewVersion ?? (historic?.status === 'in-review' && historic.prsKnown !== false ? revisions(historic) : undefined) };
    const waited = !!historic?.waitingForExecution || !!previous?.blockers.length;
    const priorReview = historic && previous?.status === 'in-review' && s.status === 'in-review'
      && cause.requests?.includes('status:in-review') ? historic : previous;
    const previousWithHistory = previous && { ...previous, waitingForExecution: waited, reviewVersion: historic?.reviewVersion,
      prs: priorReview?.prs ?? previous.prs, prsKnown: priorReview?.prsKnown };
    if (!replay) {
      const generated = candidates(previousWithHistory, current, cause, config).filter(c => {
        const needed = c.key === 'parent_summary_invalidated_by_run_reopen' ? 'last_run_closed'
          : c.key === 'lgtm_invalidated_by_revision' ? 'lgtm_added' : undefined;
        return !needed || store.state.records.some(r => r.state === 'sent' && r.candidates.some(p => p.issue === s.number && p.key === needed));
      });
      pending.push(...generated);
    }
    store.state.snapshots[s.number] = { ...current, waitingForExecution: !!s.blockers.length ||
      !!(s.status !== 'none' && waited) };
  }
  const groups = new Map<string, Candidate[]>();
  for (const c of pending) {
    const key = `${c.issue}:${c.recipient}`;
    const group = groups.get(key) ?? [];
    if (!group.some(p => p.key === c.key)) group.push(c);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    const id = hash([cause.id, group[0].issue, group[0].recipient]);
    if (!store.state.records.some(r => r.id === id)) store.state.records.push({ id, candidates: group, state: 'pending', attempts: 0 });
  }
  if (!replay) store.state.sources.push(cause.id);
  store.save(); // Persist before any network send. Never replay business operations to retry.
}
function configured(c: Candidate, config: NotificationConfig): boolean {
  if (c.key.startsWith('initialStatus.')) return !!config.initialStatus[c.key.slice(14) as keyof typeof config.initialStatus];
  if (c.key.startsWith('statusTransitions.')) return !!config.statusTransitions[c.key.slice(18)];
  return !!config.events[c.key as keyof typeof config.events];
}
export async function flush(
  store: StateStore, config: NotificationConfig, sender: Sender,
  refresh: (n: number) => Snapshot, report: (message: string) => void,
): Promise<{ sent: number; failed: number; obsolete: number }> {
  const result = { sent: 0, failed: 0, obsolete: 0 };
  if (!config.enabled) return result;
  const groups = new Map<string, { identity: string; records: Record[]; candidates: Candidate[] }>();
  const currentSnapshot = (n: number) => ({ ...refresh(n), handoffId: store.state.snapshots[n]?.handoffId });
  const validCandidate = (c: Candidate, s: Snapshot) => {
    if (!configured(c, config) || !s.open || (c.guard.handoffId && c.guard.handoffId !== s.handoffId)) return false;
    if (['status','status-reviewer'].includes(c.guard.kind)) {
      const owners = config.ownerRecipients.map(u=>u.toLowerCase());
      const reviewer = s.parent !== null && s.author.toLowerCase() !== c.recipient && s.assignees.some(u=>u.toLowerCase()===c.recipient);
      if (s.status === 'needs-author' && s.author.toLowerCase() !== c.recipient) return false;
      if (s.status === 'needs-owner' && !owners.includes(c.recipient)) return false;
      if (s.status === 'in-review' && !owners.includes(c.recipient) && !reviewer) return false;
    }
    if (['lgtm','no-lgtm','revision'].includes(c.guard.kind) && !config.ownerRecipients.includes(c.recipient)) return false;
    if (c.guard.revision && s.prsKnown === false) throw new Error('无法核实待审版本，保留通知待重试');
    return stillValid(c, s);
  };
  for (const record of store.state.records.filter(r => r.state === 'pending')) {
    try {
      const current = currentSnapshot(record.candidates[0].issue);
      const valid = record.candidates.filter(c => validCandidate(c, current));
      if (!valid.length) { record.state = 'obsolete'; result.obsolete++; store.save(); continue; }
      const identity = await sender.identity(valid[0].recipient);
      // Two GitHub accounts may map to one Feishu user: exclude actor identity too.
      const actorIdentity = sender.hasRecipient?.(valid[0].actor) === false ? undefined
        : await sender.identity(valid[0].actor);
      if (actorIdentity === identity) { record.state = 'obsolete'; result.obsolete++; store.save(); continue; }
      const key = `${current.number}:${identity}:${valid[0].source}`;
      const group = groups.get(key) ?? { identity, records: [], candidates: [] };
      group.records.push(record); group.candidates.push(...valid); groups.set(key, group);
    } catch (e) {
      record.attempts++; record.error = e instanceof Error ? e.message : '通知验证失败';
      result.failed++; store.save(); report(`通知 #${record.candidates[0].issue} 未送达：${record.error}`);
    }
  }
  for (const group of groups.values()) {
    try {
      // A prior network lookup could take time; recheck immediately before sending.
      const s = currentSnapshot(group.candidates[0].issue);
      const valid = group.candidates.filter(c => validCandidate(c, s));
      const deliverable = group.records.filter(r => {
        if (r.candidates.some(c => valid.includes(c))) return true;
        r.state = 'obsolete'; result.obsolete++; return false;
      });
      if (!valid.length) {
        store.save(); continue;
      }
      const text = formatMessage(s, valid);
      for (const r of deliverable) { r.attempts++; delete r.error; }
      store.save();
      await sender.send(group.identity, text, hash(deliverable.map(r => r.id).sort()));
      for (const r of deliverable) r.state = 'sent';
      result.sent++; store.save(); report(`通知 #${s.number} 已发送`);
    } catch (e) {
      for (const r of group.records) r.error = e instanceof Error ? e.message : '通知发送失败';
      result.failed++; store.save(); report(`通知 #${group.candidates[0].issue} 未送达：${group.records[0].error}`);
    }
  }
  return result;
}
