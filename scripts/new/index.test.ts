import { test } from 'node:test';
import assert from 'node:assert/strict';
import { command, composeBody } from './index.ts';
import { fakeContext, flag } from '../lib/testing.ts';
import { UsageError } from '../lib/context.ts';

test('composeBody appends labels after the body', () => {
  assert.equal(composeBody('  text \n', ['repo:desktop', 'repo:specs']), 'text\n\nLabels: repo:desktop repo:specs');
  assert.equal(composeBody('', ['repo:desktop']), 'Labels: repo:desktop');
  assert.equal(composeBody('text', []), 'text');
  assert.equal(composeBody('text', ['repo:desktop'], [13, 14], 11), 'text\n\n总事项：#11\n依赖：#13 #14\nLabels: repo:desktop');
});

test('new creates the issue with labels in the body, never as --label', () => {
  const { ctx, calls, lines } = fakeContext(() => 'https://github.com/ora-space/circus/issues/7\n', {
    read: (p) => (p === 'body.md' ? '## 背景\nx' : ''),
  });
  command.run(['--title', 'T', '--label', 'repo:desktop', '--body-file', 'body.md'], ctx);
  assert.equal(calls.length, 1);
  assert.equal(flag(calls[0].args, '--title'), 'T');
  assert.ok(!calls[0].args.includes('--label'));
  assert.equal(calls[0].input, '## 背景\nx\n\nLabels: repo:desktop');
  assert.deepEqual(lines, ['https://github.com/ora-space/circus/issues/7']);
});

test('new writes --depend and --epic into the body', () => {
  const { ctx, calls } = fakeContext(() => 'url');
  command.run(['--title', 'T', '--depend', '#13', '--depend', '14', '--epic', '11'], ctx);
  assert.equal(calls[0].input, '总事项：#11\n依赖：#13 #14');
  assert.throws(() => command.run(['--title', 'T', '--depend', 'x'], ctx), /不是 issue 编号/);
});

test('new rejects missing title and unknown labels', () => {
  const { ctx, calls } = fakeContext();
  assert.throws(() => command.run([], ctx), UsageError);
  assert.throws(() => command.run(['--title', 'T', '--label', 'repo:nope'], ctx), UsageError);
  assert.equal(calls.length, 0);
});
