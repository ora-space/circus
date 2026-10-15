export const STATUSES = ['none', 'needs-owner', 'in-review', 'needs-author'] as const;
export type Status = typeof STATUSES[number];
export const EVENTS = [
  'owner_request_updated', 'author_request_updated', 'review_requested_for_new_revision', 'review_requested_again_same_revision',
  'participant_assigned', 'reviewer_assigned_during_review', 'participant_left', 'reviewer_left_during_review',
  'participant_removed', 'reviewer_removed_during_review', 'lgtm_added', 'lgtm_withdrawn', 'lgtm_invalidated_by_revision',
  'last_blocker_closed', 'last_blocker_removed', 'execution_resumed_after_handoff', 'blocker_added', 'blocker_reopened',
  'blocker_replaced', 'issue_reopened', 'run_reopened', 'parent_summary_invalidated_by_run_reopen',
  'run_reopened_with_closed_parent', 'last_run_closed', 'parent_closed_with_open_runs', 'preflight_promoted', 'pr_merged',
  'review_pr_closed_without_merge', 'review_pr_reference_removed',
] as const;
export type EventKey = typeof EVENTS[number];
export const PR_STATE_EVENTS: EventKey[] = ['pr_merged', 'review_pr_closed_without_merge', 'review_pr_reference_removed'];
export interface NotificationConfig {
  enabled: boolean;
  transport: 'feishu-app' | 'feishu-webhook';
  ownerRecipients: string[];
  initialStatus: Partial<Record<Status, boolean>>;
  statusTransitions: Record<string, boolean>;
  events: Partial<Record<EventKey, boolean>>;
}
const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
function switches(value: unknown, allowed: string[], path: string): Record<string, boolean> {
  if (value === undefined) return {};
  if (!object(value)) throw new Error(`${path}: 必须是对象`);
  for (const [key, flag] of Object.entries(value)) {
    if (!allowed.includes(key) || typeof flag !== 'boolean') throw new Error(`${path}.${key}: 未知设置或类型错误`);
  }
  return value as Record<string, boolean>;
}
export function parseConfig(value: unknown): NotificationConfig {
  if (!object(value)) throw new Error('通知配置必须是对象');
  const keys = ['enabled', 'transport', 'ownerRecipients', 'initialStatus', 'statusTransitions', 'events'];
  if (Object.keys(value).some(k => !keys.includes(k))) throw new Error('通知配置包含未知字段');
  if (typeof value.enabled !== 'boolean') throw new Error('enabled: 必须是布尔值');
  if (!['feishu-app', 'feishu-webhook'].includes(String(value.transport))) throw new Error('transport: 未支持的渠道');
  if (!Array.isArray(value.ownerRecipients) || value.ownerRecipients.some(x => typeof x !== 'string' || !/^[\w-]+$/.test(x))) {
    throw new Error('ownerRecipients: 必须是 GitHub login 数组');
  }
  const transitions = switches(value.statusTransitions, STATUSES.flatMap(a => STATUSES.map(b => `${a}->${b}`)), 'statusTransitions');
  for (const a of STATUSES) for (const b of STATUSES) {
    if ((a === b || b === 'none') && transitions[`${a}->${b}`]) throw new Error(`statusTransitions.${a}->${b}: 固定静默`);
  }
  const events = switches(value.events, [...EVENTS], 'events');
  if (PR_STATE_EVENTS.some(key => events[key])) throw new Error('PR 状态通知已停用；请通过 issue 标签交接（这些旧字段仅允许 false 或省略）');
  return {
    enabled: value.enabled, transport: value.transport as NotificationConfig['transport'],
    ownerRecipients: [...new Set(value.ownerRecipients.map(x => x.toLowerCase()))],
    initialStatus: switches(value.initialStatus, STATUSES.filter(s => s !== 'none'), 'initialStatus'),
    statusTransitions: transitions, events,
  };
}
