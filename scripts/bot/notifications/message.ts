import type { Candidate, Snapshot } from './rules.ts';

interface Notice { heading: string; change: string; action: string }
const notices: Record<string, Notice> = {
  'needs-author': { heading: '需要你跟进', change: '事项已交回你处理。', action: '查看最新交接要求，继续处理并在事项中回复结果。' },
  'needs-owner': { heading: '需要你决策', change: '事项正在等待你的意见或决定。', action: '查看待决问题，在事项中回复结论；需要作者继续处理时，将事项交回作者。' },
  'in-review': { heading: '请审查交付', change: '有一份交付正在等待你审查。', action: '查看交付及关联 PR，在 GitHub 留下审查意见；是否合并由负责人决定。' },
  owner_request_updated: { heading: '需要你决策', change: '事项发起了新一轮决策请求。', action: '查看最新请求并回复结论。' },
  author_request_updated: { heading: '需要你跟进', change: '事项再次交回你处理，有新的交接请求。', action: '查看本次交接要求，继续处理并回复结果。' },
  review_requested_for_new_revision: { heading: '请审查新版本', change: '交付已有新版本，并重新请求审查。', action: '按当前版本审查交付，不沿用旧版本的审查结论。' },
  review_requested_again_same_revision: { heading: '请重新审查', change: '事项明确发起了新一轮审查请求。', action: '查看最新请求及当前交付，在 GitHub 回复审查意见。' },
  participant_assigned: { heading: '邀请你参与', change: '你已被指派参与此事项。', action: '查看事项目标、当前进展及依赖，确认你负责的工作。' },
  reviewer_assigned_during_review: { heading: '请审查交付', change: '你已被指定为此执行任务的审查人。', action: '查看交付及关联 PR，在 GitHub 回复审查意见。' },
  participant_left: { heading: '请调整协作安排', change: '一位协作者退出了此事项。', action: '检查尚未完成的工作，确认是否需要重新安排人员。' },
  reviewer_left_during_review: { heading: '请调整审查安排', change: '一位审查人退出了本轮审查。', action: '确认是否需要安排其他审查人；负责人仍可审查。' },
  participant_removed: { heading: '协作指派已撤回', change: '你在此事项中的协作指派已被移除。', action: '查看调整说明，确认是否需要交接尚未完成的工作。' },
  reviewer_removed_during_review: { heading: '审查指派已撤回', change: '你在此执行任务中的审查指派已被移除。', action: '查看调整说明，确认本轮审查安排。' },
  lgtm_added: { heading: '请确认交付结果', change: '交付已获得审查认可。', action: '核对审查意见和审过的版本，再决定是否合并。' },
  lgtm_withdrawn: { heading: '审查认可已撤回', change: '此前的审查认可已被撤回。', action: '查看撤回原因，不再依据旧认可合并。' },
  lgtm_invalidated_by_revision: { heading: '旧审查结论已失效', change: '交付版本发生变化，旧版本的认可不再适用。', action: '确认当前版本的审查安排后，再决定是否合并。' },
  last_blocker_closed: { heading: '可以继续推进', change: '最后一个未完成的依赖已完成。', action: '检查依赖结果，确认并恢复你负责的工作。' },
  last_blocker_removed: { heading: '可以继续推进', change: '最后一个未完成的依赖关系已解除。', action: '检查调整后的执行前提，确认并恢复你负责的工作。' },
  execution_resumed_after_handoff: { heading: '可以继续推进', change: '依赖已解除，交接等待也已结束。', action: '按最新安排继续你负责的工作。' },
  blocker_added: { heading: '请检查新增依赖', change: '执行任务出现了新的未完成依赖。', action: '查看依赖，确认受影响部分及是否需要调整执行安排。' },
  blocker_reopened: { heading: '请检查依赖变化', change: '此前已完成的依赖被重新打开。', action: '查看依赖的新情况，确认对当前工作的影响。' },
  blocker_replaced: { heading: '请检查依赖变化', change: '等待中的依赖有所增加或调整。', action: '检查最新依赖集合，确认受影响部分的安排。' },
  issue_reopened: { heading: '请确认恢复执行', change: '事项已重新打开。', action: '查看重开原因，确认下一步工作及执行安排。' },
  run_reopened: { heading: '请确认恢复执行', change: '执行任务已重新打开。', action: '查看重开原因，确认需要继续完成的工作。' },
  parent_summary_invalidated_by_run_reopen: { heading: '请重新确认收尾', change: '执行任务重新打开，先前的收尾判断已失效。', action: '检查尚未完成的工作，更新事项的后续安排。' },
  run_reopened_with_closed_parent: { heading: '请完成执行任务收尾', change: '执行任务已重开，但所属事项已经关闭。', action: '确认是否还需处理，在执行任务中写总结并按协议收尾。' },
  last_run_closed: { heading: '请汇总执行成果', change: '最后一个执行任务已结束，所属事项仍未关闭。', action: '汇总成果，确认是否完成；需要关闭时先写总结。' },
  parent_closed_with_open_runs: { heading: '请完成执行任务收尾', change: '所属事项已经关闭，你的执行任务仍未结束。', action: '检查剩余工作，在执行任务中写总结并按协议收尾。' },
};
const line = (text: string) => text.replace(/[\r\n\t]+/g, ' ').trim();
const statusNames: Record<string, string> = {
  none: '未设置交接状态', 'needs-author': '等待作者跟进', 'needs-owner': '等待负责人决策', 'in-review': '等待审查',
};
const request = (status: string, actor: string) => status === 'in-review' ? `${actor}需要你 review 当前交付。`
  : status === 'needs-owner' ? `${actor}需要你给出意见或决策。` : `${actor}需要你继续处理此事项。`;
const transitionActions: Record<string, string> = {
  'needs-owner->in-review': '查看本轮决策结论及交付内容，在关联 PR 中给出审查意见。',
  'needs-author->in-review': '查看作者本轮处理结果及当前交付，在关联 PR 中给出审查意见。',
  'in-review->needs-owner': '查看审查过程中提出的待决问题，在事项中回复决定。',
  'needs-author->needs-owner': '查看作者本轮跟进后提出的问题，在事项中回复意见或决定。',
  'in-review->needs-author': '查看本轮审查意见，处理需要修改或回复的内容，并反馈结果。',
  'needs-owner->needs-author': '查看负责人本轮回复的结论或要求，继续处理并反馈结果。',
};
function notice(c: Candidate): Notice {
  const actor = `@${line(c.actor)}`;
  if (c.key.startsWith('statusTransitions.')) {
    const transition = c.key.slice('statusTransitions.'.length);
    const [before, after] = transition.split('->');
    const base = notices[after];
    if (!base || !statusNames[before]) return fallback(c);
    return { ...base, change: `状态由「${statusNames[before]}」变为「${statusNames[after]}」；${request(after, actor)}`,
      action: transitionActions[transition] ?? base.action };
  }
  if (c.key.startsWith('initialStatus.')) {
    const status = c.key.slice('initialStatus.'.length), base = notices[status];
    return base ? { ...base, change: `${actor}创建事项时将状态设为「${statusNames[status]}」；${request(status, actor)}` } : fallback(c);
  }
  const base = notices[c.key] ?? fallback(c);
  const changes: Record<string, string> = {
    owner_request_updated: `状态仍为「等待负责人决策」；${actor}发起了新一轮请求，需要你再次给出意见或决策。`,
    author_request_updated: `状态仍为「等待作者跟进」；${actor}再次交回事项，需要你处理本次的新要求。`,
    review_requested_for_new_revision: `状态仍为「等待审查」；${actor}提交了新版本并重新请求你 review。`,
    review_requested_again_same_revision: `状态仍为「等待审查」；${actor}明确发起新一轮请求，需要你重新 review 当前交付。`,
    participant_assigned: `${actor}将你指派为此事项的协作者。`,
    reviewer_assigned_during_review: `状态仍为「等待审查」；${actor}将你指定为审查人，需要你 review 当前交付。`,
    participant_left: `${actor}退出了此事项的协作。`,
    reviewer_left_during_review: `${actor}退出了本轮审查。`,
    participant_removed: `${actor}撤回了你在此事项中的协作指派。`,
    reviewer_removed_during_review: `${actor}撤回了你在此执行任务中的审查指派。`,
    lgtm_added: `${actor}已给出审查认可，需要你核对版本并决定是否合并。`,
    lgtm_withdrawn: `${actor}撤回了此前的审查认可，不能再依据旧认可合并。`,
  };
  return { ...base, change: changes[c.key] ?? base.change };
}
const fallback = (c: Candidate): Notice => ({ heading: '需要你处理', change: line(c.reason), action: '查看事项和相关记录，确认下一步处理。' });

export function formatMessage(snapshot: Snapshot, candidates: Candidate[]): string {
  // An assignment merged with a review request should ask for review only.
  const hasReview = candidates.some(c => c.guard.value === 'in-review' || c.key === 'reviewer_assigned_during_review'
    || c.key.startsWith('review_requested_'));
  const selected = hasReview ? candidates.filter(c => c.key !== 'participant_assigned') : candidates;
  const details = selected.map(notice);
  const unique = (values: string[]) => [...new Set(values)];
  const headings = unique(details.map(n => n.heading));
  const status = !snapshot.open ? '已关闭' : snapshot.parent !== null && !snapshot.parentOpen ? '所属事项已关闭，待收尾'
    : snapshot.status === 'needs-author' ? '等待作者跟进' : snapshot.status === 'needs-owner' ? '等待负责人决策'
    : snapshot.status === 'in-review' ? '等待审查' : snapshot.blockers.length ? '等待依赖' : '进行中';
  const urls = unique(selected.map(c => c.url).filter(url => url !== snapshot.url));
  return [
    `【${headings.length === 1 ? headings[0] : '需要你处理'}】Circus`,
    `${snapshot.parent === null ? '事项' : '执行任务'}：#${snapshot.number} ${line(snapshot.title).slice(0, 200)}`,
    `当前状态：${status}`, '',
    '发生了什么', ...unique(details.map(n => n.change)).map(s => `• ${s}`), '',
    '你需要做', ...unique(details.map(n => n.action)).map(s => `• ${s}`), '',
    '查看事项：', snapshot.url,
    ...(urls.length ? ['查看相关交接：', ...urls] : []),
  ].join('\n');
}
