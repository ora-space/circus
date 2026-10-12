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
