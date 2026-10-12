import { test } from 'node:test';
import assert from 'node:assert/strict';
import { command, type ListedIssue } from './index.ts';
import { fakeContext } from '../lib/testing.ts';

const issues: ListedIssue[] = [
  { number: 1, title: 'theirs', author: { login: 'bob' }, assignees: [], labels: [], body: '' },
  { number: 2, title: 'helping', author: { login: 'bob' }, assignees: [{ login: 'me' }], labels: [{ name: 'repo:desktop' }], body: '' },
  { number: 3, title: 'mine', author: { login: 'me' }, assignees: [], labels: [{ name: 'run' }], body: 'Parent: #2' },
];
const respond = (args: string[]) => (args[0] === 'api' ? 'me\n' : JSON.stringify(issues));

test('brief puts my issues first', () => {
  const { ctx, lines } = fakeContext(respond);
  command.run([], ctx);
  assert.equal(
    lines.join('\n'),
    [
      '## 我负责的（@me） (2)',
      '- #2 helping  @bob → @me [repo:desktop]',
      '- #3 mine（运行 → #2）  @me [run]',
      '',
      '## 其他 (1)',
      '- #1 theirs  @bob',
    ].join('\n'),
  );
});

test('brief --mine hides other issues', () => {
  const { ctx, lines } = fakeContext(respond);
  command.run(['--mine'], ctx);
  assert.doesNotMatch(lines.join('\n'), /其他|theirs/);
});
