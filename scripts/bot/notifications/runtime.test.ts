import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runtime } from './runtime.ts';
import { fakeContext } from '../../lib/testing.ts';
import { resolve } from 'node:path';

test('production variable enables default-disabled configuration using Actions Secrets', () => {
  const f = fakeContext(undefined, { root: resolve('.'), env: {
    CIRCUS_NOTIFICATIONS_ENABLED: 'true', FEISHU_APP_ID: 'cli_test', FEISHU_APP_SECRET: 'test-secret',
    FEISHU_RECIPIENTS_JSON: '{"HappyAuratus":{"mobile":"+8613800000000"}}',
  } });
  const settings = runtime(f.ctx, {});
  assert.equal(settings.config.enabled, true);
  assert.equal(settings.sender?.hasRecipient?.('happyauratus'), true);
  assert.equal(f.calls.length, 0);
});

test('production kill switch needs no credentials and rejects ambiguous values', () => {
  const f = fakeContext(undefined, { root: resolve('.'), env: { CIRCUS_NOTIFICATIONS_ENABLED: 'false' } });
  assert.equal(runtime(f.ctx, {}).sender, undefined);
  f.ctx.env.CIRCUS_NOTIFICATIONS_ENABLED = 'yes';
  assert.throws(() => runtime(f.ctx, {}), /必须为 true 或 false/);
});

test('owner recipients come from a repository variable when set, overriding the JSON list', () => {
  const f = fakeContext(undefined, { root: resolve('.'), env: { CIRCUS_OWNER_RECIPIENTS: 'EricWvi, alice  bob,alice' } });
  assert.deepEqual(runtime(f.ctx, {}).config.ownerRecipients, ['ericwvi', 'alice', 'bob']);
  f.ctx.env.CIRCUS_OWNER_RECIPIENTS = '';
  assert.deepEqual(runtime(f.ctx, {}).config.ownerRecipients, []);
  f.ctx.env.CIRCUS_OWNER_RECIPIENTS = 'ok, not/valid';
  assert.throws(() => runtime(f.ctx, {}), /CIRCUS_OWNER_RECIPIENTS/);
});
