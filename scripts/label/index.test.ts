import { test } from 'node:test';
import assert from 'node:assert/strict';
import { command } from './index.ts';
import { fakeContext } from '../lib/testing.ts';
import { UsageError } from '../lib/context.ts';

test('label posts slash commands as a comment', () => {
  const { ctx, calls } = fakeContext();
  command.run(['5', 'repo:desktop', '-repo:specs'], ctx);
  assert.deepEqual(calls[0].args, ['issue', 'comment', '5', '-R', 'ora-space/circus', '--body-file', '-']);
  assert.equal(calls[0].input, '/unlabel repo:specs\n/label repo:desktop');
});

test('label rejects unregistered labels before commenting', () => {
  const { ctx, calls } = fakeContext();
  assert.throws(() => command.run(['5', 'status:ready'], ctx), /未登记/);
  assert.throws(() => command.run(['5'], ctx), UsageError);
  assert.throws(() => command.run(['x', 'repo:desktop'], ctx), UsageError);
  assert.equal(calls.length, 0);
});

test('label --sha names the reviewed commit next to an lgtm', () => {
  const { ctx, calls } = fakeContext();
  command.run(['5', '+review:lgtm', '--sha', 'a1b2c3d'], ctx);
  assert.equal(calls[0].input, '审过 commit a1b2c3d\n\n/label review:lgtm');
  assert.throws(() => command.run(['5', '+review:lgtm', '--sha', 'main'], ctx), /--sha/);
  assert.throws(() => command.run(['5', '+review:lgtm', '--sha'], ctx), /--sha/);
  assert.equal(calls.length, 1);
});
