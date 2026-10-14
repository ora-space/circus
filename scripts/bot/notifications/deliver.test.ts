import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deliverEvent } from './deliver.ts';
import { config, fixture } from './testing.ts';
import type { Sender } from './feishu.ts';
import type { Event } from '../handle.ts';

const event = (issue: unknown): Event => ({ name: 'issue_comment', payload: {
  action: 'created', issue, sender: { login: 'owner', type: 'User' },
  comment: { id: 20, created_at: '2026-10-14T12:00:00Z', body: '/label status:needs-author' },
} });
const sender = (send: Sender['send']): Sender => ({
  hasRecipient: login => login === 'alice', identity: async login => login, send,
});

test('direct event sends author handoff without any persistent state', async () => {
  const f = fixture(); const sent: string[] = [];
  await deliverEvent(event(f.issue), f.gh, 'ora-space/circus', config(),
    sender(async (_id, text) => { sent.push(text); }), () => {});
  assert.equal(sent.length, 1);
  assert.match(sent[0], /本地通知验证/);
  assert.deepEqual(f.issue.labels, [{ name: 'status:needs-author' }]);
});

test('failed Feishu send leaves business successful and is not retried by next invocation', async () => {
  const f = fixture(); let writes = 0, attempts = 0;
  const setLabels = f.gh.setLabels;
  f.gh.setLabels = (n, ls) => { writes++; setLabels(n, ls); };
  const failing = sender(async () => { attempts++; throw new Error('发送阶段失败'); });
  const lines: string[] = [];
  await deliverEvent(event(f.issue), f.gh, 'ora-space/circus', config(), failing, s => lines.push(s));
  assert.equal(writes, 1); assert.equal(attempts, 1);
  assert.ok(lines.some(s => s.includes('不进行跨运行补发')));
  await deliverEvent({ name: 'issue_comment', payload: {
    action: 'created', issue: f.issue, sender: { login: 'alice', type: 'User' },
    comment: { id: 21, body: '普通评论' },
  } }, f.gh, 'ora-space/circus', config(), failing, () => {});
  assert.equal(attempts, 1);
});

test('notification pre-read failure still executes the business command once', async () => {
  const f = fixture(); let reads = 0, writes = 0, sent = 0;
  const get = f.gh.getIssue, set = f.gh.setLabels;
  f.gh.getIssue = n => { if (++reads === 1) throw new Error('临时查询失败'); return get(n); };
  f.gh.setLabels = (n, ls) => { writes++; set(n, ls); };
  await deliverEvent(event(f.issue), f.gh, 'ora-space/circus', config(),
    sender(async () => { sent++; }), () => {});
  assert.equal(writes, 1); assert.equal(sent, 0);
  assert.deepEqual(f.issue.labels, [{ name: 'status:needs-author' }]);
});

test('business mutation errors remain failures in direct mode', async () => {
  const f = fixture(); let writes = 0;
  f.gh.setLabels = () => { writes++; throw new Error('业务写入失败'); };
  await assert.rejects(deliverEvent(event(f.issue), f.gh, 'ora-space/circus', config(),
    sender(async () => {}), () => {}), /业务写入失败/);
  assert.equal(writes, 1);
});
