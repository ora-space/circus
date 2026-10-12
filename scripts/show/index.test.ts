import { test } from 'node:test';
import assert from 'node:assert/strict';
import { command, type Comment, type Issue } from './index.ts';
import { fakeContext } from '../lib/testing.ts';

const issue: Issue = {
  number: 3,
  title: 'T',
  state: 'open',
  html_url: 'https://github.com/ora-space/circus/issues/3',
  body: 'body',
  user: { login: 'alice' },
  assignees: [{ login: 'bob' }],
  labels: [{ name: 'repo:desktop' }],
};
const comments: Comment[] = [
  { user: { login: 'bob' }, created_at: '2026-10-01T00:00:00Z', body: 'one' },
  { user: { login: 'alice' }, created_at: '2026-10-02T00:00:00Z', body: 'two' },
];

test('show prints the issue and every comment in order', () => {
  const { ctx, calls, lines } = fakeContext((args) => {
    if (args.includes('--paginate')) return comments.map((c) => JSON.stringify(c)).join('\n') + '\n';
    return JSON.stringify(issue);
  });
  command.run(['#3'], ctx);
  assert.deepEqual(calls[0].args, ['api', '-X', 'GET', 'repos/ora-space/circus/issues/3']);
  const text = lines.join('\n');
  assert.match(text, /^#3 T \[open\]/);
  assert.match(text, /作者 @alice · assignee @bob · label repo:desktop/);
  assert.ok(text.indexOf('评论 1/2 @bob') < text.indexOf('评论 2/2 @alice'));
});
