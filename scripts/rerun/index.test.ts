import { test } from 'node:test';
import assert from 'node:assert/strict';
import { command } from './index.ts';
import { fakeContext } from '../lib/testing.ts';
import { UsageError } from '../lib/context.ts';

test('rerun posts a /rerun comment on the run issue', () => {
  const { ctx, calls } = fakeContext();
  command.run(['18', 'desktop#7', 'https://github.com/ora-space/cloud/pull/9'], ctx);
  assert.deepEqual(calls[0].args, ['issue', 'comment', '18', '-R', 'ora-space/circus', '--body-file', '-']);
  assert.equal(calls[0].input, '/rerun desktop#7 https://github.com/ora-space/cloud/pull/9');
});

test('rerun rejects anything but PRs before commenting', () => {
  const { ctx, calls } = fakeContext();
  assert.throws(() => command.run(['18', '#7'], ctx), /不是 PR/);
  assert.throws(() => command.run(['18'], ctx), UsageError);
  assert.equal(calls.length, 0);
});
