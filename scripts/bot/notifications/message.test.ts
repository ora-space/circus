import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatMessage } from './message.ts';
import { state } from './testing.ts';
import type { Candidate } from './rules.ts';

const candidate = (key: string, value?: string): Candidate => ({ key, issue: 95, recipient: 'alice', actor: 'owner',
  reason: '通知原因', source: 'comment:20', url: 'https://github.com/ora-space/circus/issues/95#issuecomment-20',
  title: '消息标题', guard: { kind: 'status', value } });

test('author handoff has plain-language action, current title, actor and separate issue/comment links', () => {
  const message = formatMessage(state({ number: 95, title: '飞书通知', status: 'needs-author',
    url: 'https://github.com/ora-space/circus/issues/95' }), [candidate('statusTransitions.in-review->needs-author', 'needs-author')]);
  assert.match(message, /^【需要你跟进】Circus/);
  assert.match(message, /事项：#95 飞书通知/);
  assert.match(message, /当前状态：等待作者跟进/);
  assert.match(message, /发生了什么\n• 事项已交回你处理/);
  assert.match(message, /你需要做\n• 查看最新交接要求/);
  assert.match(message, /发起人：@owner/);
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
  assert.equal(message.split('你已被指定').length, 2);
});

test('dependency completion and removal distinguish done work from removed dependency', () => {
  const done = formatMessage(state(), [candidate('last_blocker_closed')]);
  const removed = formatMessage(state(), [candidate('last_blocker_removed')]);
  assert.match(done, /依赖已完成/);
  assert.match(removed, /依赖关系已解除/);
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
