import { test } from 'node:test';
import assert from 'node:assert/strict';
import { command } from './index.ts';
import { fakeContext } from '../lib/testing.ts';
import { UsageError } from '../lib/context.ts';

test('assign posts slash commands as a comment', () => {
  const { ctx, calls } = fakeContext();
  command.run(['#9', '@bob', '+carol', '-@dave'], ctx);
  assert.deepEqual(calls[0].args, ['issue', 'comment', '9', '-R', 'ora-space/circus', '--body-file', '-']);
  assert.equal(calls[0].input, '/unassign @dave\n/assign @bob @carol');
});

test('assign needs at least one user', () => {
  const { ctx } = fakeContext();
  assert.throws(() => command.run(['9'], ctx), UsageError);
});
