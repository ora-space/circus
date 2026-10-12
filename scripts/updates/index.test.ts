import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildUpdates, command, type IssueInfo, type RunInfo, type TimelineEvent } from './index.ts';
import { fakeContext } from '../lib/testing.ts';

const issue: IssueInfo = { number: 28, title: '决策', state: 'open', user: { login: 'author' }, labels: [{ name: 'status:needs-author' }] };
const bot = { login: 'circus-bot[bot]', type: 'Bot' };
const person = (login: string) => ({ login, type: 'User' });

// The #28 shape: author asks, owner decides and hands it back.
const timeline: TimelineEvent[] = [
  { event: 'labeled', created_at: '2026-10-12T08:48:50Z', actor: bot, label: { name: 'status:needs-owner' } },
  { event: 'labeled', created_at: '2026-10-12T08:48:50Z', actor: bot, label: { name: 'repo:specs' } },
  { event: 'commented', created_at: '2026-10-12T08:57:27Z', user: person('author'), body: '补充前提' },
  { event: 'commented', created_at: '2026-10-12T09:10:09Z', user: person('owner'), body: '## owner 决定\n\n全部按推荐。' },
  { event: 'unlabeled', created_at: '2026-10-12T09:10:22Z', actor: bot, label: { name: 'status:needs-owner' } },
  { event: 'commented', created_at: '2026-10-12T09:15:49Z', user: person('owner'), body: '/label status:needs-author' },
  { event: 'labeled', created_at: '2026-10-12T09:16:05Z', actor: bot, label: { name: 'status:needs-author' } },
  {
    event: 'cross-referenced',
    created_at: '2026-10-12T09:17:00Z',
    actor: person('author'),
    source: { issue: { number: 80, title: 'ADR', state: 'closed', pull_request: { merged_at: '2026-10-12T09:18:00Z' }, repository: { full_name: 'ora-space/specs' } } },
  },
  { event: 'cross-referenced', created_at: '2026-10-12T09:17:30Z', actor: person('author'), source: { issue: { number: 19, title: 'x', state: 'open', repository: { full_name: 'ora-space/circus' } } } },
  { event: 'commented', created_at: '2026-10-12T09:18:30Z', user: bot, body: '提醒' },
];
const runs: RunInfo[] = [
  { number: 27, title: '运行：起草 ADR', state: 'open', updated_at: '2026-10-12T09:12:00Z', body: 'Parent: #28' },
  { number: 26, title: '运行：旧', state: 'closed', updated_at: '2026-10-12T08:00:00Z', body: 'Parent: #28' },
];

test('updates for the author: everything after their last comment, with the status trail', () => {
  assert.deepEqual(buildUpdates(issue, timeline, runs, 'author', false, 'ora-space/circus'), [
    '#28 决策 [open] 作者 @author · 当前 status：status:needs-author',
    '',
    'status 轨迹：',
    '  2026-10-12 08:48 + status:needs-owner',
    '  2026-10-12 09:10 - status:needs-owner',
    '  2026-10-12 09:16 + status:needs-author',
    '',
    '自你上次发言（2026-10-12 08:57）之后：',
    '--- 2026-10-12 09:10 @owner',
    '',
    '## owner 决定\n\n全部按推荐。',
    '',
    '- 2026-10-12 09:10 status - status:needs-owner',
    '- 2026-10-12 09:15 @owner：/label status:needs-author',
    '- 2026-10-12 09:16 status + status:needs-author',
    '- 2026-10-12 09:17 PR ora-space/specs#80 引用了本 issue（已合并）：ADR',
    '--- 2026-10-12 09:18 @circus-bot[bot]（bot）',
    '',
    '提醒',
    '',
    '- 运行 #27（进行中）有更新：运行：起草 ADR；用 show 27 查看',
  ]);
});

test('updates with nothing new, from scratch, and --all', () => {
  const quiet = buildUpdates(issue, timeline, [], 'circus-bot[bot]', false, 'ora-space/circus');
  assert.deepEqual(quiet.slice(-2), ['自你上次发言（2026-10-12 09:18）之后：', '（没有新动静）']);
  const fresh = buildUpdates(issue, timeline, [], 'stranger', false, 'ora-space/circus');
  assert.ok(fresh.includes('你还没在这里发过言，从头列出：'));
  assert.ok(fresh.includes('- 2026-10-12 08:48 status + status:needs-owner'));
  const all = buildUpdates(issue, timeline, runs, 'owner', true, 'ora-space/circus');
  assert.ok(all.includes('全部动静：') && all.includes('- 运行 #26（已结束）有更新：运行：旧；用 show 26 查看'));
});

test('updates reads the issue, its timeline and its sub-issues', () => {
  const { ctx, calls, lines } = fakeContext((args) => {
    const path = args[args.indexOf('-X') + 2] ?? args[2];
    if (args.includes('--paginate')) return args[2].includes('timeline') ? timeline.map((e) => JSON.stringify(e)).join('\n') : '';
    if (args[1] === 'user') return 'author\n';
    if (path === 'repos/ora-space/circus') return '{"push":false}';
    return JSON.stringify(issue);
  });
  command.run(['#28'], ctx);
  assert.ok(calls.some((c) => c.args.includes('repos/ora-space/circus/issues/28/timeline?per_page=100')));
  assert.equal(lines[0], '#28 决策 [open] 作者 @author · 当前 status：status:needs-author');
  assert.ok(lines.includes('- 2026-10-12 09:15 @owner：/label status:needs-author'));
});
