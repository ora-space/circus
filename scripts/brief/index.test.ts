import { test } from 'node:test';
import assert from 'node:assert/strict';
import { command, format, newReplies, tree, type ListedIssue } from './index.ts';
import { fakeContext } from '../lib/testing.ts';

const issue = (number: number, title: string, author: string, extra: Partial<ListedIssue> = {}): ListedIssue => ({
  number,
  title,
  author,
  assignees: [],
  labels: [],
  body: '',
  waitingOn: [],
  mergedPrs: [],
  reopenedByBot: false,
  comments: [],
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

test('brief: issues of mine that look done come first, others\' never', () => {
  const issues = [
    issue(1, 'merged', 'me', { mergedPrs: ['#22', 'ora-space/desktop#5'], labels: ['status:in-review'] }),
    issue(2, 'reopened', 'me', { reopenedByBot: true, labels: ['status:needs-owner'] }),
    issue(3, '运行：旧事', 'me', { body: 'Parent: #99' }),
    issue(4, 'their merged', 'bob', { mergedPrs: ['#23'], assignees: ['me'] }),
    issue(5, 'plain', 'me'),
  ];
  assert.equal(
    format(issues, 'me', true),
    [
      '## 待关闭（我创建的） (3)',
      '- #1 merged（PR #22 ora-space/desktop#5 已合并）  @me [status:in-review]',
      '- #2 reopened（被 bot 重新打开，补总结后关闭）  @me [status:needs-owner]',
      '- #3 运行：旧事（parent #99 已关闭；运行 → #99）  @me',
      '',
      '## 我负责的（@me） (2)',
      '- #4 their merged  @bob → @me',
      '- #5 plain  @me',
    ].join('\n'),
  );
});

test('brief for the owner: everyone\'s issues waiting on the owner come right after the closable ones', () => {
  const issues = [
    issue(1, 'theirs waits', 'bob', { labels: ['status:needs-owner'] }),
    issue(2, 'their review', 'bob', { labels: ['status:in-review', 'priority:p0'] }),
    issue(3, 'mine waits', 'me', { labels: ['status:needs-owner'] }),
    issue(4, 'mine merged', 'me', { labels: ['status:in-review'], mergedPrs: ['#9'] }),
    issue(5, 'plain', 'bob'),
  ];
  assert.equal(
    format(issues, 'me', false, true),
    [
      '## 待关闭（我创建的） (1)',
      '- #4 mine merged（PR #9 已合并）  @me [status:in-review]',
      '',
      '## 等我处理（owner：所有 needs-owner 和 in-review） (3)',
      '- #2 their review  @bob [status:in-review priority:p0]',
      '- #1 theirs waits  @bob [status:needs-owner]',
      '- #3 mine waits  @me [status:needs-owner]',
      '',
      '## 其他 (1)',
      '- #5 plain  @bob',
    ].join('\n'),
  );
});

test('brief: issues of mine the owner answered come right after the closable ones', () => {
  const issues = [
    issue(1, 'answered', 'me', { labels: ['status:needs-author'] }),
    issue(2, 'their answered', 'bob', { labels: ['status:needs-author'], assignees: ['me'] }),
    issue(3, 'waiting', 'me', { labels: ['status:needs-owner'] }),
  ];
  assert.equal(
    format(issues, 'me', true),
    [
      '## 等我跟进（owner 已回复） (1)',
      '- #1 answered  @me [status:needs-author]',
      '',
      '## 等 owner（我创建的） (1)',
      '- #3 waiting  @me [status:needs-owner]',
      '',
      '## 我负责的（@me） (1)',
      '- #2 their answered  @bob → @me [status:needs-author]',
    ].join('\n'),
  );
  assert.equal(format([], 'me', false), '没有未关闭的 issue');
});

test('brief marks people\'s replies after my latest comment on issues I am responsible for', () => {
  const c = (author: string, body = 'text', bot = false) => ({ author, bot, body });
  const mineReplied = issue(1, 'mine', 'me', { comments: [c('bob'), c('me'), c('bob'), c('owner', '/label status:needs-author'), c('bot', 'x', true), c('owner', '结论如下')] });
  assert.equal(newReplies(mineReplied, 'me'), 2);
  assert.equal(newReplies(issue(2, 'quiet', 'me', { comments: [c('bob'), c('me')] }), 'me'), 0);
  const text = format([mineReplied, issue(3, 'theirs', 'bob', { comments: [c('carol')] })], 'me', false);
  assert.match(text, /- #1 mine（2 条新回复，用 updates 1 查看）  @me/);
  assert.match(text, /- #3 theirs  @bob/);
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
    comments: { nodes: [] },
    timelineItems: {
      nodes: [
        { __typename: 'CrossReferencedEvent', source: { __typename: 'PullRequest', number: 7, merged: number === 1, repository: { nameWithOwner: 'ora-space/circus' } } },
        { __typename: 'CrossReferencedEvent', source: { __typename: 'Issue' } },
        { __typename: 'ReopenedEvent', actor: { __typename: 'Bot' } },
        { __typename: 'ReopenedEvent', actor: { __typename: number === 1 ? 'Bot' : 'User' } },
      ],
    },
  });
  const { ctx, calls, lines } = fakeContext((args, input) => {
    if (args[1] === 'user') return 'me\n';
    if (args[1] === 'repos/ora-space/circus') return '{"push":false}';
    return JSON.parse(input!).variables.after ? page([node(2)], null) : page([node(1, [[5, 'OPEN'], [3, 'CLOSED'], [2, 'OPEN']])], 'c1');
  });
  command.run(['--mine'], ctx);
  assert.equal(calls.length, 4);
  assert.match(lines[0], /^你是 @me（成员）/);
  assert.match(lines[1], /## 待关闭（我创建的） \(1\)\n- #1 t1（PR #7 已合并；被 bot 重新打开，补总结后关闭；等待 #2 #5）  @me/);
  assert.match(lines[1], /## 我负责的（@me） \(1\)\n- #2 t2  @me/);
});
