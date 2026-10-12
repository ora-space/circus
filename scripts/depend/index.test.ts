import { test } from 'node:test';
import assert from 'node:assert/strict';
import { command } from './index.ts';
import { fakeContext } from '../lib/testing.ts';
import { UsageError } from '../lib/context.ts';

test('depend posts slash commands as a comment', () => {
  const { ctx, calls } = fakeContext();
  command.run(['18', '#13', '14', '-#15'], ctx);
  assert.deepEqual(calls[0].args, ['issue', 'comment', '18', '-R', 'ora-space/circus', '--body-file', '-']);
  assert.equal(calls[0].input, '/undepend #15\n/depend #13 #14');
});

test('depend rejects non-numbers before commenting', () => {
  const { ctx, calls } = fakeContext();
  assert.throws(() => command.run(['18', 'abc'], ctx), /不是 issue 编号/);
  assert.throws(() => command.run(['18'], ctx), UsageError);
  assert.equal(calls.length, 0);
});
