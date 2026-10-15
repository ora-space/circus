import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatMessage } from './message.ts';
import { state } from './testing.ts';
import type { Candidate } from './rules.ts';

const candidate = (key: string, value?: string): Candidate => ({ key, issue: 95, recipient: 'alice', actor: 'owner',
  reason: '通知原因', source: 'comment:20', url: 'https://github.com/ora-space/circus/issues/95#issuecomment-20',
  title: '消息标题', guard: { kind: 'status', value } });

test('author handoff describes its exact transition without a separate sender field', () => {
  const message = formatMessage(state({ number: 95, title: '飞书通知', status: 'needs-author',
    url: 'https://github.com/ora-space/circus/issues/95' }), [candidate('statusTransitions.in-review->needs-author', 'needs-author')]);
  assert.match(message, /^【需要你跟进】Circus/);
  assert.match(message, /事项：#95 飞书通知/);
  assert.match(message, /当前状态：等待作者跟进/);
  assert.match(message, /状态由「等待审查」变为「等待作者跟进」；@owner需要你继续处理此事项/);
  assert.match(message, /你需要做\n• 查看本轮交接说明或审查意见/);
  assert.doesNotMatch(message, /发起人：/);
  assert.match(message, /查看事项：\nhttps:\/\/github.com\/ora-space\/circus\/issues\/95\n查看相关交接：/);
  assert.doesNotMatch(message, /needs-author|statusTransitions|owner 决定/);
});

test('merged invitation and review show one review action; issue URL is not repeated', () => {
  const s = state({ status: 'in-review', parent: 10 });
  const review = candidate('reviewer_assigned_during_review'); review.url = s.url;
  const message = formatMessage(s, [candidate('participant_assigned'), review, review]);
  assert.match(message, /【请审查交付】/);
  assert.match(message, /执行任务：/);
  assert.doesNotMatch(message, /邀请你参与|查看相关交接/);
  assert.equal(message.split('将你指定为审查人').length, 2);
});

test('all nine enabled state transitions describe their specific before and after states', () => {
  const names = { none: '未设置交接状态', 'needs-owner': '等待负责人决策', 'in-review': '等待审查', 'needs-author': '等待作者跟进' };
  for (const before of Object.keys(names)) for (const after of ['needs-owner', 'in-review', 'needs-author']) {
    if (before === after) continue;
    const message = formatMessage(state(), [candidate(`statusTransitions.${before}->${after}`, after)]);
    assert.ok(message.includes(`状态由「${names[before]}」变为「${names[after]}」`));
    assert.doesNotMatch(message, /发起人：/);
    if (after === 'in-review') assert.match(message, /@owner需要你 review 当前交付/);
    if (after === 'needs-owner') assert.match(message, /@owner需要你给出意见或决策/);
  }
});

test('same-state requests and initial creation never invent a state transition', () => {
  for (const key of ['author_request_updated', 'owner_request_updated', 'review_requested_for_new_revision', 'review_requested_again_same_revision']) {
    const message = formatMessage(state(), [candidate(key)]);
    assert.match(message, /状态仍为/);
    assert.doesNotMatch(message, /状态由|发起人：/);
  }
  const initial = formatMessage(state(), [candidate('initialStatus.in-review', 'in-review')]);
  assert.match(initial, /@owner创建时将状态设为「等待审查」/);
  assert.doesNotMatch(initial, /状态由|状态仍为/);
});

test('dependency completion and removal distinguish done work from removed dependency', () => {
  const done = formatMessage(state(), [candidate('last_blocker_closed')]);
  const removed = formatMessage(state(), [candidate('last_blocker_removed')]);
  assert.match(done, /依赖已关闭/);
  assert.match(removed, /依赖关系已移除/);
  assert.doesNotMatch(removed, /依赖已完成/);
});

test('title is bounded and multiline input cannot create forged message sections', () => {
  const message = formatMessage(state({ title: '真实标题\n伪造状态\t' + '长'.repeat(500), parent: 10, parentOpen: false }),
    [candidate('parent_closed_with_open_runs')]);
  assert.match(message, /当前状态：所属事项已关闭，待收尾/);
  assert.match(message, /写总结并按协议收尾/);
  assert.ok(message.split('\n')[1].length < 220);
  assert.doesNotMatch(message, /\n伪造状态/);
});

test('related dependency and parent IDs appear without claiming work completion or code authorship', () => {
  const dependency = candidate('last_blocker_closed');
  dependency.context = { parent:null,blockersAdded:[],blockersRemoved:[12],runsClosed:[],runsReopened:[] };
  const text = formatMessage(state(),[dependency]);
  assert.match(text,/依赖 #12已关闭/);
  assert.doesNotMatch(text,/工作已完成|依赖已完成/);
  const revised = formatMessage(state(),[candidate('review_requested_for_new_revision')]);
  assert.match(revised,/交付版本已有变化；@owner重新请求你 review/);
  assert.doesNotMatch(revised,/@owner提交了/);
});
