import { test } from 'node:test';
import assert from 'node:assert/strict';
import { command, format, tree, type ListedIssue } from './index.ts';
import { fakeContext } from '../lib/testing.ts';

const issue = (number: number, title: string, author: string, extra: Partial<ListedIssue> = {}): ListedIssue => ({
  number,
  title,
  author,
  assignees: [],
  labels: [],
  body: '',
  waitingOn: [],
  ...extra,
});

test('brief: my issues waiting on the owner first, then mine by priority, then others', () => {
  const issues = [
    issue(1, 'theirs', 'bob', { labels: ['status:needs-owner'] }),
    issue(2, 'helping', 'bob', { assignees: ['me'], labels: ['repo:desktop'] }),
    issue(4, 'blocked', 'me', { labels: ['status:needs-owner', 'priority:p1'] }),
    issue(5, 'urgent', 'me', { labels: ['priority:p0'] }),
  ];
  assert.equal(
    format(issues, 'me', false),
    [
      '## 等 owner（我创建的） (1)',
      '- #4 blocked  @me [status:needs-owner priority:p1]',
      '',
      '## 我负责的（@me） (2)',
      '- #5 urgent  @me [priority:p0]',
      '- #2 helping  @bob → @me [repo:desktop]',
      '',
      '## 其他 (1)',
      '- #1 theirs  @bob [status:needs-owner]',
    ].join('\n'),
  );
  assert.doesNotMatch(format(issues, 'me', true), /其他|theirs/);
});

test('tree nests sub-items and runs, marks waits, and notes parents outside the section', () => {
  const lines = tree([
    issue(11, '总事项', 'a'),
    issue(13, '部署', 'a', { body: '关联总事项 #11。' }),
    issue(18, '验收', 'a', { body: '总事项：#11', waitingOn: [13, 14] }),
    issue(20, '运行：部署', 'b', { body: 'Parent: #13', labels: ['run'] }),
    issue(21, '运行：别处', 'b', { body: 'Parent: #99' }),
    issue(22, '另一个子项', 'b', { body: '总事项：#98' }),
  ]);
  assert.deepEqual(lines, [
    '- #11 总事项  @a',
    '  ├─ #13 部署  @a',
    '  │  └─ #20 运行：部署  @b [run]',
    '  └─ #18 验收（等待 #13 #14）  @a',
    '- #21 运行：别处（运行 → #99）  @b',
    '- #22 另一个子项（总事项 #98）  @b',
  ]);
});

test('tree survives cycles in written relations', () => {
  const lines = tree([issue(1, 'a', 'x', { body: '总事项：#2' }), issue(2, 'b', 'x', { body: '总事项：#1' })]);
  assert.deepEqual(lines, ['- #1 a（总事项 #2）  @x', '- #2 b（总事项 #1）  @x']);
});

test('brief pages through GraphQL and keeps only open blockers', () => {
  const page = (nodes: unknown[], next: string | null) =>
    JSON.stringify({ data: { repository: { issues: { pageInfo: { hasNextPage: next !== null, endCursor: next }, nodes } } } });
  const node = (number: number, blockers: [number, string][] = []) => ({
    number,
    title: `t${number}`,
    body: '',
    author: { login: 'me' },
    assignees: { nodes: [] },
    labels: { nodes: [] },
    blockedBy: { nodes: blockers.map(([n, state]) => ({ number: n, state })) },
  });
  const { ctx, calls, lines } = fakeContext((args, input) => {
    if (args[1] === 'user') return 'me\n';
    if (args[1] === 'repos/ora-space/circus') return '{"push":false}';
    return JSON.parse(input!).variables.after ? page([node(2)], null) : page([node(1, [[5, 'OPEN'], [3, 'CLOSED'], [2, 'OPEN']])], 'c1');
  });
  command.run(['--mine'], ctx);
  assert.equal(calls.length, 4);
  assert.match(lines[0], /^你是 @me（成员）/);
  assert.match(lines[1], /- #1 t1（等待 #2 #5）  @me\n- #2 t2  @me/);
});
