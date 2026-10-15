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
  lgtm_added: { heading: '交付已获审查认可', change: '你的交付已获得审查认可。', action: '查看审查意见；合并由负责人决定，无需额外操作。' },
  lgtm_withdrawn: { heading: '审查认可已撤回', change: '你的交付此前获得的审查认可已被撤回。', action: '查看撤回原因和审查意见，按需修改后重新请求审查。' },
  lgtm_invalidated_by_revision: { heading: '请重新审查', change: '作者重新请求审查，你此前的认可已失效。', action: '按当前版本重新审查，在 GitHub 回复审查意见。' },
  preflight_promoted: { heading: '决策已定，请核对交付', change: '所属事项的依赖都已关闭，执行任务由 preflight 转为正式执行。', action: '对照依赖的结论核对 PR：需要修改就改完后重新请求审查。' },
  last_blocker_closed: { heading: '可以继续推进', change: '最后一个未完成的依赖已关闭。', action: '查看依赖的总结，确认并恢复你负责的工作。' },
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
// "#97 的" rather than "#97的": a space between an issue number and the Chinese after it.
const spaced = (text: string) => text.replace(/(#\d+)(?=[\u4e00-\u9fff])/g, '$1 ');
const statusNames: Record<string, string> = {
  none: '进行中', 'needs-author': '等待作者跟进', 'needs-owner': '等待负责人决策', 'in-review': '等待审查',
};
const request = (status: string, actor: string) => status === 'in-review' ? `${actor}需要你 review 当前交付。`
  : status === 'needs-owner' ? `${actor}需要你给出意见或决策。` : `${actor}需要你继续处理此事项。`;
const transitionActions: Record<string, string> = {
  'needs-owner->in-review': '查看本轮交接说明及交付内容，在 GitHub 回复审查意见。',
  'needs-author->in-review': '查看本轮处理结果及当前交付，在 GitHub 回复审查意见。',
  'in-review->needs-owner': '查看本轮审查相关的待决请求，在事项中回复决定。',
  'needs-author->needs-owner': '查看本轮跟进后的待决请求，在事项中回复意见或决定。',
  'in-review->needs-author': '查看本轮交接说明或审查意见，处理需要修改或回复的内容。',
  'needs-owner->needs-author': '查看本轮交接结论或要求，继续处理并反馈结果。',
};
function notice(c: Candidate): Notice {
  const actor = `@${line(c.actor)} `;
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
    return base ? { ...base, change: `${actor}创建时将状态设为「${statusNames[status]}」；${request(status, actor)}` } : fallback(c);
  }
  const base = notices[c.key] ?? fallback(c);
  const numbers = (ns?: number[]) => ns?.length ? ns.map(n => `#${n}`).join('、') : '';
  const removed = numbers(c.context?.blockersRemoved), added = numbers(c.context?.blockersAdded);
  const closedRuns = numbers(c.context?.runsClosed), reopenedRuns = numbers(c.context?.runsReopened);
  const parent = c.context?.parent ? `所属事项 #${c.context.parent}` : '所属事项';
  const changes: Record<string, string> = {
    owner_request_updated: `状态仍为「等待负责人决策」；${actor}发起了新一轮请求，需要你再次给出意见或决策。`,
    author_request_updated: `状态仍为「等待作者跟进」；${actor}再次交回事项，需要你处理本次的新要求。`,
    review_requested_for_new_revision: `状态仍为「等待审查」，本轮交付版本已有变化；${actor}重新请求你 review。`,
    review_requested_again_same_revision: `状态仍为「等待审查」；${actor}明确发起新一轮请求，需要你重新 review 当前交付。`,
    participant_assigned: `${actor}将你指派为此事项的协作者。`,
    reviewer_assigned_during_review: `状态仍为「等待审查」；${actor}将你指定为审查人，需要你 review 当前交付。`,
    participant_left: `${actor}退出了此事项的协作。`,
    reviewer_left_during_review: `${actor}退出了本轮审查。`,
    participant_removed: `${actor}撤回了你在此事项中的协作指派。`,
    reviewer_removed_during_review: `${actor}撤回了你在此执行任务中的审查指派。`,
    lgtm_added: `${actor}给你的交付打了审查认可（lgtm）。`,
    lgtm_withdrawn: `${actor}撤回了对你交付的审查认可。`,
    lgtm_invalidated_by_revision: `${actor}重新请求审查，你此前给出的认可已失效，需要你重新 review 当前版本。`,
    preflight_promoted: `${parent}的依赖都已关闭，此执行任务已由 preflight 转为正式执行。`,
    last_blocker_closed: `最后一个未完成的依赖${removed ? ` ${removed}` : ''}已关闭，当前已无未完成依赖。`,
    last_blocker_removed: `最后的未完成依赖关系${removed ? ` ${removed}` : ''}已移除，当前已无未完成依赖。`,
    blocker_added: `新增未完成依赖${added ? ` ${added}` : ''}，当前执行任务受到影响。`,
    blocker_reopened: `依赖${added ? ` ${added}` : ''}由已关闭变为重新打开，当前执行任务受到影响。`,
    blocker_replaced: `未完成依赖已调整${added ? `：新增 ${added}` : ''}${removed ? `${added ? '；' : '：'}移除 ${removed}` : ''}，当前仍需等待依赖。`,
    issue_reopened: `${actor}将事项由已关闭变为重新打开，当前没有交接或依赖等待。`,
    run_reopened: `${actor}将执行任务由已关闭变为重新打开，当前没有交接或依赖等待。`,
    run_reopened_with_closed_parent: `${actor}重新打开了此执行任务，但${parent}已关闭。`,
    parent_closed_with_open_runs: `${parent}已关闭，此执行任务仍未结束。`,
    last_run_closed: `执行任务${closedRuns ? ` ${closedRuns}` : ''}已关闭，当前已无未结束的执行任务；此事项仍未关闭。`,
    parent_summary_invalidated_by_run_reopen: `执行任务${reopenedRuns ? ` ${reopenedRuns}` : ''}重新打开，先前的收尾判断已失效。`,
  };
  return { ...base, change: changes[c.key] ?? base.change };
}
const fallback = (c: Candidate): Notice => ({ heading: '需要你处理', change: line(c.reason), action: '查看事项和相关记录，确认下一步处理。' });

// What an agent handed the whole message should do after reading the issue's updates. Cases the
// protocol's "#N 有更新" already covers defer to it; the rest name the next command.
function agentStep(c: Candidate, n: number): string {
  switch (c.key) {
    case 'participant_assigned':
      return `确认分给你的那一块，用 \`node scripts/cli.ts run ${n}\` 开运行 issue 开始做，过程和 PR 都在运行 issue 里汇报。`;
    case 'preflight_promoted':
      return `读依赖 issue 的总结，对照结论核对本运行的 PR：需要改就改完 push，再 \`node scripts/cli.ts label ${n} +status:in-review\` 请人复审；不用改就在 #${n} 评论说明。`;
    case 'lgtm_added':
      return '不需要操作，等 owner 决定是否合并。';
    case 'last_blocker_closed': case 'last_blocker_removed': case 'execution_resumed_after_handoff':
      return `读已关闭依赖的总结，继续开发；还没有自己的运行 issue 就先 \`node scripts/cli.ts run ${n}\`。`;
    case 'blocker_added': case 'blocker_reopened': case 'blocker_replaced':
      return `读新增或重开的依赖，判断哪些工作要等它，在 #${n} 评论说明，不受影响的部分继续做。`;
    case 'last_run_closed':
      return `汇总各运行的总结，确认做完就按「关闭前先总结」关闭 #${n}；没做完就在 #${n} 说明还差什么。`;
    case 'parent_closed_with_open_runs': case 'run_reopened_with_closed_parent':
      return `parent 已关闭：为本运行写总结，用 \`node scripts/cli.ts close ${n} --title <结果> --summary-file <文件>\` 关闭。`;
    default:
      return 'AGENTS.md「"#N 有更新"」继续处理。';
  }
}

export function formatMessage(snapshot: Snapshot, candidates: Candidate[]): string {
  // An assignment merged with a review request should ask for review only.
  const hasReview = candidates.some(c => c.guard.value === 'in-review' || c.key === 'reviewer_assigned_during_review'
    || c.key.startsWith('review_requested_') || c.key === 'lgtm_invalidated_by_revision');
  // A request that cleared the reviewer's own lgtm says so more precisely than the plain request.
  const invalidated = candidates.some(c => c.key === 'lgtm_invalidated_by_revision');
  const selected = candidates.filter(c => !(hasReview && c.key === 'participant_assigned')
    && !(invalidated && (c.key.startsWith('review_requested_') || c.key === 'statusTransitions.in-review->in-review')));
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
    '发生了什么', ...unique(details.map(n => spaced(n.change))).map(s => `• ${s}`), '',
    '你需要做', ...unique(details.map(n => n.action)).map(s => `• ${s}`), '',
    '查看事项：', snapshot.url,
    ...(urls.length ? ['查看相关交接：', ...urls] : []), '',
    '交给 agent',
    ...unique(selected.map(c => agentStep(c, snapshot.number))).map(step =>
      `• 在 circus 目录运行 \`node scripts/cli.ts updates ${snapshot.number}\` 查看 ora-space/circus#${snapshot.number} 的最新动静，然后${step.startsWith('AGENTS') ? '按 ' : ''}${step}`),
  ].join('\n');
}
