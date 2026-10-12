import { test } from 'node:test';
import assert from 'node:assert/strict';
import { command, composeBody } from './index.ts';
import { fakeContext, flag } from '../lib/testing.ts';
import { UsageError } from '../lib/context.ts';

test('composeBody appends labels after the body', () => {
  assert.equal(composeBody('  text \n', ['repo:desktop', 'repo:specs']), 'text\n\nLabels: repo:desktop repo:specs');
  assert.equal(composeBody('', ['repo:desktop']), 'Labels: repo:desktop');
  assert.equal(composeBody('text', []), 'text');
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

test('new rejects missing title and unknown labels', () => {
  const { ctx, calls } = fakeContext();
  assert.throws(() => command.run([], ctx), UsageError);
  assert.throws(() => command.run(['--title', 'T', '--label', 'repo:nope'], ctx), UsageError);
  assert.equal(calls.length, 0);
});
