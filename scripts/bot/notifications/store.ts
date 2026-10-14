import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import { hash, stillValid, type Candidate, type Cause, type Snapshot } from './rules.ts';
import type { NotificationConfig } from './config.ts';
import { candidates } from './rules.ts';
import type { Sender } from './feishu.ts';

export interface Record {
  id: string; candidates: Candidate[]; state: 'pending' | 'sent' | 'obsolete'; attempts: number; error?: string;
}
export interface State { version: 1; snapshots: { [n: string]: Snapshot & { waitingForExecution?: boolean } }; records: Record[]; sources: string[] }
export const emptyState = (): State => ({ version: 1, snapshots: {}, records: [], sources: [] });
export interface StateStore { state: State; save(): void; close(): void }
export function fileStore(path: string): StateStore {
  mkdirSync(dirname(path), { recursive: true });
  const lock = `${path}.lock`;
  let fd: number;
  try { fd = openSync(lock, 'wx'); } catch { throw new Error('通知状态文件已被占用；确认无进程使用后再移除 .lock'); }
  try {
    const state: State = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : emptyState();
    if (state.version !== 1 || !state.snapshots || !Array.isArray(state.records) || !Array.isArray(state.sources)) throw new Error('通知状态文件格式错误');
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
    const waited = !!historic?.waitingForExecution || !!previous?.blockers.length;
    const previousWithHistory = previous && { ...previous, waitingForExecution: waited,
      prs: historic && previous.status === 'in-review' && s.status === 'in-review' && cause.requests?.includes('status:in-review')
        ? historic.prs : previous.prs };
    if (!replay) {
      const generated = candidates(previousWithHistory, s, cause, config).filter(c => {
        const needed = c.key === 'parent_summary_invalidated_by_run_reopen' ? 'last_run_closed'
          : c.key === 'lgtm_invalidated_by_revision' ? 'lgtm_added' : undefined;
        return !needed || store.state.records.some(r => r.state === 'sent' && r.candidates.some(p => p.issue === s.number && p.key === needed));
      });
      pending.push(...generated);
    }
    store.state.snapshots[s.number] = { ...s, waitingForExecution: !!s.blockers.length ||
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
  for (const record of store.state.records.filter(r => r.state === 'pending')) {
    try {
      const current = refresh(record.candidates[0].issue);
      const valid = record.candidates.filter(c => configured(c, config) && stillValid(c, current));
      if (!valid.length) { record.state = 'obsolete'; result.obsolete++; store.save(); continue; }
      const identity = await sender.identity(valid[0].recipient);
      // Two GitHub accounts may map to one Feishu user: exclude actor identity too.
      let actorIdentity: string | undefined;
      try { actorIdentity = await sender.identity(valid[0].actor); } catch { /* An unbound actor has no mapped notification identity. */ }
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
      const s = refresh(group.candidates[0].issue);
      const valid = group.candidates.filter(c => stillValid(c, s));
      if (!valid.length) {
        for (const r of group.records) r.state = 'obsolete';
        result.obsolete += group.records.length; store.save(); continue;
      }
      const reasons = [...new Set(valid.map(c => c.reason))];
      const review = reasons.some(r => r.includes('请审查'));
      const selected = review ? reasons.filter(r => !r.startsWith('请参与')) : reasons;
      const text = `circus #${s.number}：${s.title.slice(0, 200)}\n${selected.join('\n')}\n${valid[0].url}`;
      for (const r of group.records) { r.attempts++; delete r.error; }
      store.save();
      await sender.send(group.identity, text, hash(group.records.map(r => r.id).sort()));
      for (const r of group.records) r.state = 'sent';
      result.sent++; store.save(); report(`通知 #${s.number} 已发送`);
    } catch (e) {
      for (const r of group.records) r.error = e instanceof Error ? e.message : '通知发送失败';
      result.failed++; store.save(); report(`通知 #${group.candidates[0].issue} 未送达：${group.records[0].error}`);
    }
  }
  return result;
}
