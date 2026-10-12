import { test } from 'node:test';
import assert from 'node:assert/strict';
import { command, type ListedIssue } from './index.ts';
import { fakeContext } from '../lib/testing.ts';

const issue = (number: number, title: string, author: string, labels: string[] = [], extra: Partial<ListedIssue> = {}): ListedIssue => ({
  number,
  title,
  author: { login: author },
  assignees: [],
  labels: labels.map((name) => ({ name })),
  body: '',
  ...extra,
});

const issues: ListedIssue[] = [
  issue(1, 'theirs', 'bob', ['status:needs-owner']),
  issue(2, 'helping', 'bob', ['repo:desktop'], { assignees: [{ login: 'me' }] }),
  issue(3, 'mine', 'me', ['run'], { body: 'Parent: #2' }),
  issue(4, 'blocked', 'me', ['status:needs-owner', 'priority:p1']),
  issue(5, 'urgent', 'me', ['priority:p0']),
];
const respond = (args: string[]) => (args[0] === 'api' ? 'me\n' : JSON.stringify(issues));

test('brief: my issues waiting on the owner first, then mine by priority, then others', () => {
  const { ctx, lines } = fakeContext(respond);
  command.run([], ctx);
  assert.equal(
    lines.join('\n'),
    [
      '## 等 owner（我创建的） (1)',
      '- #4 blocked  @me [status:needs-owner priority:p1]',
      '',
      '## 我负责的（@me） (3)',
      '- #5 urgent  @me [priority:p0]',
      '- #2 helping  @bob → @me [repo:desktop]',
      '- #3 mine（运行 → #2）  @me [run]',
      '',
      '## 其他 (1)',
      '- #1 theirs  @bob [status:needs-owner]',
    ].join('\n'),
  );
});

test('brief --mine hides other issues', () => {
  const { ctx, lines } = fakeContext(respond);
  command.run(['--mine'], ctx);
  assert.doesNotMatch(lines.join('\n'), /其他|theirs/);
});
