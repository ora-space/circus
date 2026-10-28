import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorize, handle, referencedIssues } from './handle.ts';
import type { GitHub, Issue, Pull, WorkflowRun } from './github.ts';
import type { Board, BoardValues } from '../lib/board.ts';
import { parentOf } from '../lib/run.ts';

const newIssue = (fields: Partial<Issue>): Issue => ({
  id: 1000 + (fields.number ?? 1),
  node_id: `I_${fields.number ?? 1}`,
  number: 1,
  title: 'T',
  state: 'open',
  body: '',
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
  user: { login: 'alice' },
  assignees: [],
  labels: [],
  ...fields,
});

// In-memory issue store that records writes. `state` is issue #1; `add` puts more issues
// in the store. Writes to #1 are logged bare, writes to other issues are prefixed "#n ".
function fakeGitHub(issue: Partial<Issue> = {}, assignable = ['alice', 'bob', 'carol', 'owner'], writers = ['owner']) {
  const store = new Map<number, Issue>();
  // Product PRs by "repo#n", workflow runs by head SHA, and runs whose re-run GitHub refuses.
  const pulls = new Map<string, Pull>();
  const runs = new Map<string, WorkflowRun[]>();
  const refuse: number[] = [];
  // Dependencies: issue number -> numbers of its blockers.
  const blockers = new Map<number, number[]>();
  const byId = (id: number) => [...store.values()].find((i) => i.id === id)!;
  const summarize = (n: number) => {
    const open = (blockers.get(n) ?? []).filter((b) => store.get(b)?.state === 'open').length;
    if (store.has(n)) store.get(n)!.issue_dependencies_summary = { blocked_by: open };
  };
  const state = newIssue(issue);
  store.set(state.number, state);
  const log: string[] = [];
  const at = (n: number) => {
    const i = store.get(n);
    if (!i) throw new Error(`HTTP 404 #${n}`);
    return i;
  };
  const push = (n: number, entry: string) => log.push(n === 1 ? entry : `#${n} ${entry}`);
  const gh: GitHub = {
    getIssue: (n) => {
      if (blockers.has(n)) summarize(n);
      return structuredClone(at(n));
    },
    setLabels: (n, labels) => {
      push(n, `labels ${labels.join(' ')}`);
      at(n).labels = labels.map((name) => ({ name }));
    },
    addAssignees: (n, users) => {
      push(n, `assign ${users.join(' ')}`);
      const i = at(n);
      for (const u of users) if (assignable.includes(u) && !i.assignees.some((a) => a.login === u)) i.assignees.push({ login: u });
      return i.assignees.map((a) => a.login);
    },
    removeAssignees: (n, users) => {
      push(n, `unassign ${users.join(' ')}`);
      at(n).assignees = at(n).assignees.filter((a) => !users.includes(a.login));
    },
    comment: (n, body) => void push(n, `comment ${body}`),
    react: (id, content) => void log.push(`react ${id} ${content}`),
    reopen: (n) => {
      push(n, 'reopen');
      at(n).state = 'open';
    },
    permission: (login) => {
      log.push(`permission ${login}`);
      return writers.includes(login) ? 'admin' : 'read';
    },
    addSubIssue: (parent, childId) => void push(parent, `sub-issue ${childId}`),
    subIssues: (parent) => [...store.values()].filter((i) => parentOf(i.body) === parent).map((i) => structuredClone(i)),
    blockedBy: (n) => (blockers.get(n) ?? []).map((b) => structuredClone(at(b))),
    blocking: (n) => [...blockers].filter(([, bs]) => bs.includes(n)).map(([d]) => structuredClone(at(d))),
    addBlockedBy: (n, id) => {
      const b = byId(id).number;
      push(n, `depend ${b}`);
      if ((blockers.get(n) ?? []).includes(b)) throw new Error('HTTP 422: Dependency already exists');
      blockers.set(n, [...(blockers.get(n) ?? []), b]);
      summarize(n);
    },
    removeBlockedBy: (n, id) => {
      push(n, `undepend ${byId(id).number}`);
      blockers.set(n, (blockers.get(n) ?? []).filter((b) => b !== byId(id).number));
      summarize(n);
    },
    listOpenIssues: () => [...store.values()].filter((i) => i.state === 'open').map((i) => structuredClone(i)),
    getPull: (repo, n) => {
      const pull = pulls.get(`${repo}#${n}`);
      if (!pull) throw new Error('HTTP 404');
      return structuredClone(pull);
    },
    pullRuns: (_repo, sha) => structuredClone(runs.get(sha) ?? []),
    rerunFailedJobs: (repo, id) => {
      if (refuse.includes(id)) throw new Error('HTTP 403: Resource not accessible by integration');
      log.push(`rerun ${repo} ${id}`);
    },
  };
  const add = (fields: Partial<Issue>) => {
    const i = newIssue(fields);
    store.set(i.number, i);
    return i;
  };
  return { gh, state, log, add, pulls, runs, refuse };
}

const user = (login: string) => ({ login, type: 'User' });
const commentEvent = (gh: ReturnType<typeof fakeGitHub>, actor: string, body: string) => {
  handle(
    { name: 'issue_comment', payload: { action: 'created', issue: gh.state, sender: user(actor), comment: { id: 42, body }, repository: { full_name: 'ora-space/circus' } } },
    gh.gh,
  );
};

test('opened: labels written in the body are set', () => {
  const f = fakeGitHub({ body: 'crash on start\n\nLabels: repo:desktop repo:nope' });
  handle({ name: 'issues', payload: { action: 'opened', issue: f.state, sender: user('alice') } }, f.gh);
  assert.deepEqual(f.log, ['labels repo:desktop']);
});

test('events from bots are ignored', () => {
  const f = fakeGitHub({ labels: [{ name: 'repo:desktop' }] });
  handle(
    { name: 'issues', payload: { action: 'unlabeled', issue: f.state, sender: { login: 'circus[bot]', type: 'Bot' }, label: { name: 'repo:specs' } } },
    f.gh,
  );
  assert.deepEqual(f.log, []);
});

test('labeled by hand is reverted, except body labels while the issue is opening', () => {
  const f = fakeGitHub({ body: 'repo:desktop', labels: [{ name: 'repo:desktop' }, { name: 'repo:specs' }] });
  const labeled = (name: string) =>
    handle({ name: 'issues', payload: { action: 'labeled', issue: f.state, sender: user('alice'), label: { name } } }, f.gh);
  labeled('repo:desktop');
  assert.deepEqual(f.log, []);
  labeled('repo:specs');
  assert.equal(f.log[0], 'labels repo:desktop');
  assert.match(f.log[1], /^comment @alice 已撤销手动打上的 `repo:specs`/);

  f.log.length = 0;
  f.state.updated_at = '2026-10-02T00:00:00Z';
  labeled('repo:desktop');
  assert.equal(f.log[0], 'labels ');
});

test('unlabeled by hand is restored', () => {
  const f = fakeGitHub();
  handle({ name: 'issues', payload: { action: 'unlabeled', issue: f.state, sender: user('bob'), label: { name: 'legacy' } } }, f.gh);
  assert.equal(f.log[0], 'labels legacy');
  assert.match(f.log[1], /已恢复/);
});

test('assignee changes by hand are reverted', () => {
  const f = fakeGitHub({ assignees: [{ login: 'bob' }] });
  handle({ name: 'issues', payload: { action: 'assigned', issue: f.state, sender: user('alice'), assignee: { login: 'bob' } } }, f.gh);
  handle({ name: 'issues', payload: { action: 'unassigned', issue: f.state, sender: user('alice'), assignee: { login: 'bob' } } }, f.gh);
  assert.deepEqual(
    f.log.filter((l) => !l.startsWith('comment')),
    ['unassign bob', 'assign bob'],
  );
});

test('closed without a summary is reopened', () => {
  const f = fakeGitHub({ state: 'closed', body: 'no summary' });
  handle({ name: 'issues', payload: { action: 'closed', issue: f.state, sender: user('alice') } }, f.gh);
  assert.equal(f.log[0], 'reopen');
  const g = fakeGitHub({ state: 'closed', body: '## 总结\n\ndone' });
  handle({ name: 'issues', payload: { action: 'closed', issue: g.state, sender: user('alice') } }, g.gh);
  assert.deepEqual(g.log, []);
});

test('author runs label and assign commands', () => {
  const f = fakeGitHub({ labels: [{ name: 'legacy' }] });
  commentEvent(f, 'alice', 'splitting this\n/label repo:desktop repo:specs\n/unlabel legacy\n/assign @bob');
  assert.deepEqual(f.log, ['assign bob', 'labels repo:desktop repo:specs', 'react 42 +1']);
});

test('assignee can bring in helpers but not edit labels or remove others', () => {
  const f = fakeGitHub({ assignees: [{ login: 'bob' }] });
  commentEvent(f, 'bob', '/assign @carol\n/label repo:desktop\n/unassign @carol');
  assert.deepEqual(f.log.slice(0, 2), ['permission bob', 'assign carol']);
  assert.equal(f.log.length, 3);
  assert.match(f.log[2], /^comment @bob 以下命令有问题/);
  assert.match(f.log[2], /`\/label repo:desktop`：只有作者 @alice 和有写权限的人可以修改 label/);
  assert.match(f.log[2], /只有作者 @alice 和有写权限的人可以移除别人：@carol/);
});

test('anyone can unassign themselves; outsiders cannot assign', () => {
  const f = fakeGitHub({ assignees: [{ login: 'bob' }] });
  commentEvent(f, 'bob', '/unassign @bob');
  assert.deepEqual(f.log, ['permission bob', 'unassign bob', 'react 42 +1']);
  f.log.length = 0;
  commentEvent(f, 'carol', '/assign @carol');
  assert.match(f.log[1], /只有作者 @alice 和有写权限的人以及现有 assignee 可以拉人/);
});

test('unknown labels, empty commands and unassignable users are reported', () => {
  const f = fakeGitHub();
  commentEvent(f, 'alice', '/label status:ready repo:cloud\n/assign\n/assign @mallory');
  assert.equal(f.log[0], 'assign mallory');
  assert.equal(f.log[1], 'labels repo:cloud');
  assert.match(f.log[2], /未登记的 label status:ready/);
  assert.match(f.log[2], /`\/assign`：缺少参数/);
  assert.match(f.log[2], /GitHub 拒绝 assign @mallory/);
});

test('comments without commands do nothing', () => {
  const f = fakeGitHub();
  commentEvent(f, 'carol', 'see /tmp/log\n```\n/label repo:desktop\n```');
  assert.deepEqual(f.log, []);
});

test('repository writers have the author\'s rights on every issue', () => {
  const f = fakeGitHub({ labels: [{ name: 'legacy' }], assignees: [{ login: 'bob' }] });
  commentEvent(f, 'owner', '/label repo:desktop\n/unlabel legacy\n/unassign @bob\n/assign @owner');
  assert.deepEqual(f.log, ['permission owner', 'unassign bob', 'assign owner', 'labels repo:desktop', 'react 42 +1']);
});

test('manual edits by writers are still reverted', () => {
  const f = fakeGitHub({ labels: [{ name: 'repo:specs' }], updated_at: '2026-10-02T00:00:00Z' });
  handle({ name: 'issues', payload: { action: 'labeled', issue: f.state, sender: user('owner'), label: { name: 'repo:specs' } } }, f.gh);
  assert.equal(f.log[0], 'labels ');
});

test('authorize lets the author do everything without a permission lookup', () => {
  const issue = fakeGitHub().state;
  const never = () => assert.fail('looked up permission');
  for (const verb of ['label', 'unlabel', 'assign', 'unassign'] as const) {
    assert.equal(authorize({ verb, args: ['x'] }, 'alice', issue, never), null);
  }
});

// Reviews: issue #1 is alice's run awaiting review; bob and carol are its reviewers (assignees).
const reviewed = (labels: string[] = ['status:in-review']) =>
  fakeGitHub({ body: 'Parent: #9', labels: ['run', ...labels].map((name) => ({ name })), assignees: [{ login: 'bob' }, { login: 'carol' }] });

test('reviewers approve someone else\'s run awaiting review with a commit SHA', () => {
  const f = reviewed();
  commentEvent(f, 'bob', '审过 a1b2c3d，可以合并\n/label review:lgtm');
  assert.deepEqual(f.log, ['permission bob', 'labels run status:in-review review:lgtm', 'react 42 +1']);

  const g = reviewed();
  commentEvent(g, 'bob', '/label review:lgtm');
  assert.match(g.log.at(-1)!, /`\/label review:lgtm`：评论里要写明审过的 commit SHA/);
  assert.equal(g.log.filter((l) => l.startsWith('labels')).length, 0);
});

test('lgtm needs a run awaiting review, and never comes from its author', () => {
  for (const [f, actor, why] of [
    [reviewed(['status:needs-owner']), 'bob', /只能在 status:in-review 时打/],
    [reviewed(), 'alice', /作者不能给自己的运行 issue 打/],
    [fakeGitHub({ labels: [{ name: 'status:in-review' }] }), 'owner', /只用于运行 issue/],
  ] as const) {
    commentEvent(f, actor, 'a1b2c3d\n/label review:lgtm');
    assert.match(f.log.at(-1)!, why);
    assert.equal(f.log.filter((l) => l.startsWith('labels')).length, 0);
  }
});

test('reviewers hand a run awaiting review back to its author, which drops the lgtm', () => {
  const f = reviewed(['status:in-review', 'review:lgtm']);
  commentEvent(f, 'carol', '/label status:needs-author');
  assert.deepEqual(f.log, ['permission carol', 'labels run status:needs-author', 'react 42 +1']);

  const g = reviewed(['status:needs-owner']);
  commentEvent(g, 'carol', '/label status:needs-author');
  assert.match(g.log.at(-1)!, /reviewer 只能在 status:in-review 时打 status:needs-author/);
});

test('reviewers may retract an lgtm but touch nothing else', () => {
  const f = reviewed(['status:in-review', 'review:lgtm']);
  commentEvent(f, 'bob', '/unlabel review:lgtm');
  assert.deepEqual(f.log, ['permission bob', 'labels run status:in-review', 'react 42 +1']);

  for (const body of ['/label priority:p1', '/unlabel status:in-review', '/label review:lgtm status:needs-owner']) {
    const g = reviewed();
    commentEvent(g, 'bob', `a1b2c3d\n${body}`);
    assert.match(g.log.at(-1)!, /reviewer（运行 issue 的 assignee）只能/);
  }
  const h = fakeGitHub({ labels: [{ name: 'status:in-review' }], assignees: [{ login: 'bob' }] });
  commentEvent(h, 'bob', '/label status:needs-author');
  assert.match(h.log.at(-1)!, /只有作者 @alice 和有写权限的人可以修改 label$/);
});

test('only the run\'s assignees and the owner review it', () => {
  const f = reviewed();
  commentEvent(f, 'mallory', 'a1b2c3d\n/label review:lgtm\n/label status:needs-author');
  assert.equal(f.log.filter((l) => l.startsWith('labels')).length, 0);
  assert.match(f.log.at(-1)!, /只有作者 @alice 和有写权限的人可以修改 label$/m);

  const g = reviewed();
  commentEvent(g, 'owner', 'a1b2c3d\n/label review:lgtm');
  assert.deepEqual(g.log, ['permission owner', 'labels run status:in-review review:lgtm', 'react 42 +1']);
});

test('the author asking for review again drops the lgtm', () => {
  const f = reviewed(['status:in-review', 'review:lgtm']);
  commentEvent(f, 'alice', '/label status:in-review');
  assert.deepEqual(f.log, ['labels run status:in-review', 'react 42 +1']);
});

test('closing drops review labels along with status', () => {
  const f = reviewed(['status:in-review', 'review:lgtm']);
  f.state.state = 'closed';
  f.state.body = '## 总结\n\n合并了\n\n---\n\nParent: #9';
  handle({ name: 'issues', payload: { action: 'closed', issue: f.state, sender: user('alice') } }, f.gh);
  assert.equal(f.log[0], 'labels run');
});

// Runs: issue #1 is the parent, #2 the run.
const opened = (f: ReturnType<typeof fakeGitHub>, run: Issue) =>
  handle({ name: 'issues', payload: { action: 'opened', issue: run, sender: user(run.user.login) } }, f.gh);

test('opened run: labelled, linked as sub-issue, author added to the parent assignees', () => {
  const f = fakeGitHub({ assignees: [{ login: 'alice' }] });
  const run = f.add({ number: 2, user: { login: 'bob' }, body: 'Parent: #1\n\nrepo:desktop' });
  opened(f, run);
  assert.deepEqual(f.log, ['#2 labels repo:desktop run', 'sub-issue 1002', 'assign bob']);
});

test('opened run by an existing assignee does not reassign', () => {
  const f = fakeGitHub({ assignees: [{ login: 'bob' }] });
  opened(f, f.add({ number: 2, user: { login: 'bob' }, body: 'Parent: #1' }));
  assert.deepEqual(f.log, ['#2 labels run', 'sub-issue 1002']);
});

test('opened run with an invalid parent is told to fix it', () => {
  for (const parent of [{ state: 'closed' }, { body: 'Parent: #9' }]) {
    const f = fakeGitHub(parent);
    opened(f, f.add({ number: 2, user: { login: 'bob' }, body: 'Parent: #1' }));
    assert.equal(f.log.length, 1);
    assert.match(f.log[0], /^#2 comment #1 不是未关闭的普通 issue/);
  }
  const f = fakeGitHub();
  opened(f, f.add({ number: 2, user: { login: 'bob' }, body: 'Parent: #7' }));
  assert.match(f.log[0], /^#2 comment #7 不是/);
});

test('opened run reports an author who cannot be assigned', () => {
  const f = fakeGitHub({}, ['alice']);
  opened(f, f.add({ number: 2, user: { login: 'mallory' }, body: 'Parent: #1' }));
  assert.match(f.log.at(-1)!, /^#2 comment 无法把 @mallory assign 到 #1/);
});

test('closed run with a summary reports it on the parent', () => {
  const f = fakeGitHub();
  const run = f.add({ number: 2, title: '前端部分已完成', user: { login: 'bob' }, state: 'closed', body: '## 总结\n\n改了 A\n\n---\n\nParent: #1' });
  handle({ name: 'issues', payload: { action: 'closed', issue: run, sender: user('bob') } }, f.gh);
  assert.deepEqual(f.log, ['comment 运行 #2（@bob）已结束：**前端部分已完成**\n\n改了 A']);
});

test('the run label is kept on runs, reverted elsewhere, and refused by commands', () => {
  const f = fakeGitHub();
  const run = f.add({ number: 2, user: { login: 'bob' }, body: 'Parent: #1', labels: [{ name: 'run' }], updated_at: '2026-10-05T00:00:00Z' });
  handle({ name: 'issues', payload: { action: 'labeled', issue: run, sender: user('bob'), label: { name: 'run' } } }, f.gh);
  assert.deepEqual(f.log, []);
  f.state.labels = [{ name: 'run' }];
  handle({ name: 'issues', payload: { action: 'labeled', issue: f.state, sender: user('alice'), label: { name: 'run' } } }, f.gh);
  assert.equal(f.log[0], 'labels ');
  f.log.length = 0;
  commentEvent(f, 'alice', '/label run repo:desktop\n/unlabel run');
  assert.equal(f.log[0], 'labels repo:desktop');
  assert.match(f.log[1], /`\/label run repo:desktop`：run 由 bot 管理/);
  assert.match(f.log[1], /`\/unlabel run`：run 由 bot 管理/);
  assert.doesNotMatch(f.log[1], /未登记/);
});

// Board: records what each issue was synced to.
function fakeBoard() {
  const synced: string[] = [];
  const board: Board = {
    sync: (id: string, v: BoardValues) => void synced.push(`${id} ${v.Status}${v.Priority ? ' ' + v.Priority : ''}`),
  };
  return { board, synced };
}

test('board: an opened issue is mirrored with its status and priority', () => {
  const f = fakeGitHub({ body: 'status:needs-owner priority:p1' });
  const b = fakeBoard();
  handle({ name: 'issues', payload: { action: 'opened', issue: f.state, sender: user('alice') } }, f.gh, b.board);
  assert.deepEqual(b.synced, ['I_1 Needs Owner P1']);
});

test('board: runs are not mirrored, their parent turns Running and back', () => {
  const f = fakeGitHub();
  const b = fakeBoard();
  const run = f.add({ number: 2, user: { login: 'bob' }, body: 'Parent: #1' });
  handle({ name: 'issues', payload: { action: 'opened', issue: run, sender: user('bob') } }, f.gh, b.board);
  run.state = 'closed';
  run.body = '## 总结\n\nok\n\n---\n\nParent: #1';
  handle({ name: 'issues', payload: { action: 'closed', issue: run, sender: user('bob') } }, f.gh, b.board);
  commentEvent(f, 'alice', 'no commands');
  assert.deepEqual(b.synced, ['I_1 Running', 'I_1 Open']);
});

test('closing with a summary drops status labels and shows Done', () => {
  const f = fakeGitHub({ state: 'closed', body: '## 总结\n\nok', labels: [{ name: 'status:needs-owner' }, { name: 'type:decision' }] });
  const b = fakeBoard();
  handle({ name: 'issues', payload: { action: 'closed', issue: f.state, sender: user('alice') } }, f.gh, b.board);
  assert.deepEqual(f.log, ['labels type:decision']);
  assert.deepEqual(b.synced, ['I_1 Done']);
});

test('board: slash commands resync the issue, reverts do not', () => {
  const f = fakeGitHub();
  const b = fakeBoard();
  handle(
    { name: 'issue_comment', payload: { action: 'created', issue: f.state, sender: user('alice'), comment: { id: 1, body: '/label priority:p0' } } },
    f.gh,
    b.board,
  );
  handle({ name: 'issues', payload: { action: 'unlabeled', issue: f.state, sender: user('alice'), label: { name: 'priority:p0' } } }, f.gh, b.board);
  assert.deepEqual(b.synced, ['I_1 Open P0']);
});

test('scheduled and manual runs resync every open non-run issue', () => {
  const f = fakeGitHub({ labels: [{ name: 'priority:p2' }] });
  f.add({ number: 2, user: { login: 'bob' }, body: 'Parent: #1' });
  f.add({ number: 3, state: 'closed' });
  f.add({ number: 4, pull_request: {} });
  for (const name of ['schedule', 'workflow_dispatch']) {
    const b = fakeBoard();
    handle({ name, payload: {} }, f.gh, b.board);
    assert.deepEqual(b.synced, ['I_1 Running P2']);
  }
  assert.deepEqual(f.log, []);
});

test('scheduled resync promotes preflights an event run missed, with or without a board', () => {
  for (const b of [fakeBoard(), undefined]) {
    const f = fakeGitHub();
    f.add({ number: 2, user: { login: 'bob' }, body: 'Parent: #1 (preflight)', labels: [{ name: 'preflight' }] });
    f.add({ number: 3, state: 'closed' });
    f.gh.addBlockedBy(1, 1003);
    f.add({ number: 4 });
    f.add({ number: 5, user: { login: 'bob' }, body: 'Parent: #4 (preflight)', labels: [{ name: 'preflight' }] });
    f.add({ number: 6 });
    f.gh.addBlockedBy(4, 1006);
    f.log.length = 0;
    handle({ name: 'schedule', payload: {} }, f.gh, b?.board);
    assert.equal(f.log[0], '#2 labels run');
    assert.match(f.log[1], /^#2 comment @bob #1 的依赖都已关闭/);
    assert.equal(f.log.length, 2);
    if (b) assert.deepEqual(b.synced, ['I_1 Running', 'I_4 Preflight', 'I_6 Open']);
    f.log.length = 0;
    handle({ name: 'schedule', payload: {} }, f.gh, b?.board);
    assert.deepEqual(f.log, []);
  }
});

// Dependencies: #1 is the issue under test, #2 and #3 are blockers.
test('opened: 依赖 lines become dependencies; bad references are reported', () => {
  const f = fakeGitHub({ body: '依赖：#2 #3 #1 #99' });
  f.add({ number: 2 });
  f.add({ number: 3 });
  handle({ name: 'issues', payload: { action: 'opened', issue: f.state, sender: user('alice') } }, f.gh);
  assert.deepEqual(f.log.slice(0, 2), ['depend 2', 'depend 3']);
  assert.match(f.log[2], /^comment 正文里的依赖有问题：\n- 不能依赖自己\n- #99 不存在/);
});

test('/depend and /undepend follow the label permissions', () => {
  const f = fakeGitHub();
  f.add({ number: 2 });
  commentEvent(f, 'alice', '/depend #2');
  commentEvent(f, 'alice', '/depend #2');
  assert.deepEqual(f.log.slice(0, 2), ['depend 2', 'react 42 +1']);
  assert.match(f.log[3], /无法依赖 #2：HTTP 422: Dependency already exists/);
  f.log.length = 0;
  commentEvent(f, 'bob', '/undepend #2');
  assert.match(f.log[1], /只有作者 @alice 和有写权限的人可以修改依赖/);
  f.log.length = 0;
  commentEvent(f, 'owner', '/undepend #2');
  assert.deepEqual(f.log, ['permission owner', 'undepend 2', 'react 42 +1']);
});

test('closing a blocker tells each open dependent what is left and resyncs it', () => {
  const f = fakeGitHub({ number: 1 });
  f.add({ number: 2, title: '部署统一' });
  f.add({ number: 3 });
  f.gh.addBlockedBy(1, 1002);
  f.gh.addBlockedBy(1, 1003);
  f.log.length = 0;
  const b = fakeBoard();
  const blocker = f.add({ number: 2, title: '部署统一', state: 'closed', body: '## 总结\n\n完成' });
  handle({ name: 'issues', payload: { action: 'closed', issue: blocker, sender: user('alice') } }, f.gh, b.board);
  assert.deepEqual(f.log, ['comment 依赖 #2 已关闭：**部署统一**，总结见 #2。还在等 #3。']);
  assert.deepEqual(b.synced, ['I_2 Done', 'I_1 Blocked']);

  f.log.length = 0;
  const last = f.add({ number: 3, title: '收尾', state: 'closed', body: '## 总结\n\n完成' });
  handle({ name: 'issues', payload: { action: 'closed', issue: last, sender: user('alice') } }, f.gh, fakeBoard().board);
  assert.equal(f.log[0], 'comment 依赖 #3 已关闭：**收尾**，总结见 #3。依赖都已完成，可以开始。');
});

test('reopening a blocker resyncs its dependents', () => {
  const f = fakeGitHub();
  f.add({ number: 2 });
  f.gh.addBlockedBy(1, 1002);
  const b = fakeBoard();
  handle({ name: 'issues', payload: { action: 'reopened', issue: f.gh.getIssue(2), sender: user('alice') } }, f.gh, b.board);
  assert.deepEqual(b.synced, ['I_2 Open', 'I_1 Blocked']);
});

test('a run on a blocked issue gets a reminder', () => {
  const f = fakeGitHub({ assignees: [{ login: 'bob' }] });
  f.add({ number: 3 });
  f.gh.addBlockedBy(1, 1003);
  f.log.length = 0;
  opened(f, f.add({ number: 2, user: { login: 'bob' }, body: 'Parent: #1' }));
  assert.match(f.log.at(-1)!, /^#2 comment 提醒：#1 还有未完成的依赖 #3。可以先做不受影响的部分；.*run 1 --preflight/);
});

// Preflight: #1 is the parent, #3 its blocker, #2 the preflight run.
function blockedParent() {
  const f = fakeGitHub({ assignees: [{ login: 'bob' }] });
  f.add({ number: 3, title: '定方案' });
  f.gh.addBlockedBy(1, 1003);
  f.log.length = 0;
  return f;
}

test('a preflight on a blocked issue is labelled preflight, not run', () => {
  const f = blockedParent();
  const b = fakeBoard();
  const run = f.add({ number: 2, user: { login: 'bob' }, body: 'Parent: #1 (preflight)' });
  handle({ name: 'issues', payload: { action: 'opened', issue: run, sender: user('bob') } }, f.gh, b.board);
  assert.equal(f.log[0], '#2 labels preflight');
  assert.match(f.log.at(-1)!, /^#2 comment preflight：#1 还在等 #3。/);
  assert.deepEqual(b.synced, ['I_1 Preflight']);
});

test('a preflight on an issue with nothing open to wait on is an ordinary run', () => {
  const f = fakeGitHub({ assignees: [{ login: 'bob' }] });
  opened(f, f.add({ number: 2, user: { login: 'bob' }, body: 'Parent: #1 (preflight)' }));
  assert.deepEqual(f.log, ['#2 labels run', 'sub-issue 1002', '#2 comment #1 没有未完成的依赖，按普通运行打上 `run`。']);
});

test('closing the last blocker turns open preflights into runs', () => {
  const f = blockedParent();
  f.add({ number: 2, user: { login: 'bob' }, body: 'Parent: #1 (preflight)', labels: [{ name: 'preflight' }, { name: 'status:in-review' }] });
  f.add({ number: 4, user: { login: 'bob' }, body: 'Parent: #1 (preflight)', labels: [{ name: 'preflight' }], state: 'closed' });
  const b = fakeBoard();
  const blocker = f.add({ number: 3, title: '定方案', state: 'closed', body: '## 总结\n\n选 A' });
  handle({ name: 'issues', payload: { action: 'closed', issue: blocker, sender: user('alice') } }, f.gh, b.board);
  assert.equal(f.log[1], '#2 labels status:in-review run');
  assert.match(f.log[2], /^#2 comment @bob #1 的依赖都已关闭，本运行由 `preflight` 转为 `run`。/);
  assert.equal(f.log.length, 3);
  assert.deepEqual(b.synced, ['I_3 Done', 'I_1 Running']);
});

test('/undepend of the last blocker turns preflights into runs; a remaining one keeps them', () => {
  const f = blockedParent();
  f.add({ number: 5 });
  f.gh.addBlockedBy(1, 1005);
  f.add({ number: 2, user: { login: 'bob' }, body: 'Parent: #1 (preflight)', labels: [{ name: 'preflight' }] });
  f.log.length = 0;
  commentEvent(f, 'alice', '/undepend #3');
  assert.deepEqual(f.log, ['undepend 3', 'react 42 +1']);
  f.log.length = 0;
  commentEvent(f, 'alice', '/undepend #5');
  assert.deepEqual(f.log.slice(0, 2), ['undepend 5', '#2 labels run']);
});

test('a decision has no runs, preflight or not', () => {
  for (const body of ['Parent: #1', 'Parent: #1 (preflight)']) {
    const f = fakeGitHub({ labels: [{ name: 'type:decision' }] });
    opened(f, f.add({ number: 2, user: { login: 'bob' }, body }));
    assert.equal(f.log.length, 1);
    assert.match(f.log[0], /^#2 comment #1 是 type:decision，不能开运行 issue.*请关闭本 issue。$/);
  }
});

test('a plain run of an issue waiting on an open decision becomes a preflight', () => {
  const f = fakeGitHub({ assignees: [{ login: 'bob' }] });
  f.add({ number: 3, labels: [{ name: 'type:decision' }] });
  f.gh.addBlockedBy(1, 1003);
  f.log.length = 0;
  opened(f, f.add({ number: 2, user: { login: 'bob' }, body: 'Parent: #1' }));
  assert.equal(f.log[0], '#2 labels preflight');
  assert.match(f.log.at(-1)!, /^#2 comment #1 依赖未拍板的决策 #3，只能开 preflight，已打上 `preflight`。/);
});

test('preflight is kept on preflights, reverted elsewhere, and refused by commands', () => {
  const f = fakeGitHub();
  const run = f.add({ number: 2, user: { login: 'bob' }, body: 'Parent: #1 (preflight)', labels: [{ name: 'preflight' }], updated_at: '2026-10-05T00:00:00Z' });
  handle({ name: 'issues', payload: { action: 'labeled', issue: run, sender: user('bob'), label: { name: 'preflight' } } }, f.gh);
  assert.deepEqual(f.log, []);
  const plain = f.add({ number: 3, user: { login: 'bob' }, body: 'Parent: #1', labels: [{ name: 'run' }, { name: 'preflight' }], updated_at: '2026-10-05T00:00:00Z' });
  handle({ name: 'issues', payload: { action: 'labeled', issue: plain, sender: user('bob'), label: { name: 'preflight' } } }, f.gh);
  assert.equal(f.log[0], '#3 labels run');
  f.log.length = 0;
  commentEvent(f, 'alice', '/label preflight');
  assert.match(f.log[0], /preflight 由 bot 管理/);
});

test('closing someone else\'s issue is undone unless the summary records why', () => {
  const f = fakeGitHub({ state: 'closed', body: '## 总结\n\n完成', labels: [{ name: 'status:in-review' }] });
  handle({ name: 'issues', payload: { action: 'closed', issue: f.state, sender: user('owner') } }, f.gh);
  assert.equal(f.log[0], 'reopen');
  assert.match(f.log[1], /^comment @owner 这个 issue 应由作者 @alice 关闭，已重新打开/);
  assert.equal(f.log.length, 2);

  const g = fakeGitHub({ state: 'closed', body: '## 总结\n\n由 @owner 代作者 @alice 关闭：作者已离开\n\n完成' });
  handle({ name: 'issues', payload: { action: 'closed', issue: g.state, sender: user('owner') } }, g.gh);
  assert.deepEqual(g.log, []);
});

test('referencedIssues reads closing keywords and Refs, not bare mentions or other repos', () => {
  assert.deepEqual(referencedIssues('Refs ora-space/circus#24\nfixes: #5\n来源：#12\nRefs ora-space/desktop#3\nResolves #24', 'ora-space/circus'), [24, 5]);
});

// A run (#1 by alice, reviewed by bob) whose desktop#7 PR has two workflows on its head:
// pr-tests failed twice (the newer run counts), build is still running, lint passed.
function rerunFixture(prBody = 'Refs ora-space/circus#1') {
  const f = fakeGitHub({ body: 'Parent: #5', assignees: [{ login: 'bob' }] });
  f.add({ number: 5 });
  f.pulls.set('desktop#7', { state: 'open', body: prBody, head: { sha: 'abcdef1234567890' } });
  const run = (id: number, workflow_id: number, name: string, status: string, conclusion: string | null): WorkflowRun =>
    ({ id, workflow_id, name, status, conclusion, html_url: `https://github.com/ora-space/desktop/actions/runs/${id}` });
  f.runs.set('abcdef1234567890', [
    run(10, 1, 'pr-tests', 'completed', 'failure'),
    run(11, 1, 'pr-tests', 'completed', 'failure'),
    run(20, 2, 'build', 'in_progress', null),
    run(30, 3, 'lint', 'completed', 'success'),
  ]);
  return f;
}

test('/rerun re-runs the failed jobs of the newest run per workflow and links them', () => {
  for (const [actor, arg] of [['alice', 'desktop#7'], ['bob', 'https://github.com/ora-space/desktop/pull/7'], ['owner', 'desktop#7']]) {
    const f = rerunFixture();
    commentEvent(f, actor, `/rerun ${arg}`);
    assert.deepEqual(f.log.filter((l) => !l.startsWith('permission')), [
      'rerun desktop 11',
      `comment @${actor} 已重跑 CI：\n- desktop#7（abcdef1）已重跑失败的 job：[pr-tests](https://github.com/ora-space/desktop/actions/runs/11)，还在跑：build`,
      'react 42 +1',
    ]);
  }
});

test('/rerun is for the run\'s author, assignees and the owner, on runs only', () => {
  const f = rerunFixture();
  commentEvent(f, 'carol', '/rerun desktop#7');
  assert.equal(f.log.filter((l) => l.startsWith('rerun')).length, 0);
  assert.match(f.log.at(-1)!, /只有作者 @alice 和有写权限的人以及 assignee 可以重跑 CI/);

  const plain = fakeGitHub();
  plain.pulls.set('desktop#7', { state: 'open', body: 'Refs ora-space/circus#1', head: { sha: 'abc' } });
  commentEvent(plain, 'alice', '/rerun desktop#7');
  assert.match(plain.log.at(-1)!, /只能在运行 issue 里重跑/);
});

test('/rerun refuses PRs that do not reference the run, and reports why nothing ran', () => {
  const cases: [string, (f: ReturnType<typeof rerunFixture>) => void, RegExp][] = [
    ['desktop#7', (f) => f.pulls.set('desktop#7', { ...f.pulls.get('desktop#7')!, body: 'Refs #1' }), /描述里没有 `Refs ora-space\/circus#1`/],
    ['desktop#7', (f) => f.pulls.set('desktop#7', { ...f.pulls.get('desktop#7')!, body: 'Refs ora-space/circus#12' }), /描述里没有/],
    ['desktop#7', (f) => f.pulls.set('desktop#7', { ...f.pulls.get('desktop#7')!, state: 'closed' }), /desktop#7 已关闭/],
    ['desktop#8', () => {}, /取不到 desktop#8/],
    ['7', () => {}, /7 不是 PR/],
    ['desktop#7', (f) => f.runs.set('abcdef1234567890', []), /在 abcdef1 上没有 CI 运行/],
    ['desktop#7', (f) => f.runs.get('abcdef1234567890')!.splice(0, 2), /没有失败的 CI 运行，还在跑：build/],
    ['desktop#7', (f) => f.refuse.push(11), /desktop#7 重跑失败：pr-tests（HTTP 403/],
  ];
  for (const [arg, setup, error] of cases) {
    const f = rerunFixture();
    setup(f);
    commentEvent(f, 'alice', `/rerun ${arg}`);
    assert.equal(f.log.filter((l) => l.startsWith('rerun')).length, 0, arg);
    assert.match(f.log.at(-1)!, /以下命令有问题/);
    assert.match(f.log.at(-1)!, error);
  }
});

test('demo: a run of a demo issue is labelled demo, other runs are not', () => {
  const f = fakeGitHub({ labels: [{ name: 'demo' }], assignees: [{ login: 'bob' }] });
  opened(f, f.add({ number: 2, user: { login: 'bob' }, body: 'Parent: #1' }));
  assert.equal(f.log[0], '#2 labels run demo');

  const g = fakeGitHub({ assignees: [{ login: 'bob' }] });
  opened(g, g.add({ number: 2, user: { login: 'bob' }, body: 'Parent: #1' }));
  assert.equal(g.log[0], '#2 labels run');
});

test('demo: an issue opened under a demo epic is labelled demo', () => {
  const f = fakeGitHub({ labels: [{ name: 'demo' }] });
  const item = f.add({ number: 2, body: '总事项：#1\n\nLabels: type:task' });
  handle({ name: 'issues', payload: { action: 'opened', issue: item, sender: user('alice') } }, f.gh);
  assert.deepEqual(f.log, ['#2 labels type:task demo']);
});

test('demo: labelling the parent demo or not carries over to its open runs', () => {
  const f = fakeGitHub();
  f.add({ number: 2, body: 'Parent: #1', labels: [{ name: 'run' }] });
  f.add({ number: 3, body: 'Parent: #1', labels: [{ name: 'run' }], state: 'closed' });
  commentEvent(f, 'alice', '/label demo');
  assert.deepEqual(f.log, ['labels demo', '#2 labels run demo', 'react 42 +1']);
  commentEvent(f, 'alice', '/unlabel demo');
  assert.deepEqual(f.log.slice(3), ['labels ', '#2 labels run', 'react 42 +1']);
});

test('demo: a demo run goes to review only with a screenshot in the same comment', () => {
  const run = () => fakeGitHub({ body: 'Parent: #9', labels: [{ name: 'run' }, { name: 'demo' }] });
  const f = run();
  commentEvent(f, 'alice', '/label status:in-review');
  assert.match(f.log.at(-1)!, /demo 运行送审要在同一条评论里附界面截图/);
  assert.equal(f.log.filter((l) => l.startsWith('labels')).length, 0);

  for (const shot of ['![首页](https://raw.githubusercontent.com/bob/demo/abc/home.png)', '<img width="800" alt="home" src="https://github.com/user-attachments/assets/1">']) {
    const g = run();
    commentEvent(g, 'alice', `${shot}\n/label status:in-review`);
    assert.deepEqual(g.log, ['labels run demo status:in-review', 'react 42 +1']);
  }
  const h = run();
  commentEvent(h, 'alice', '`![x](https://a/b.png)`\n/label status:in-review');
  assert.match(h.log.at(-1)!, /附界面截图/);

  const plain = fakeGitHub({ body: 'Parent: #9', labels: [{ name: 'run' }] });
  commentEvent(plain, 'alice', '/label status:in-review');
  assert.deepEqual(plain.log, ['labels run status:in-review', 'react 42 +1']);
});

test('demo: a demo run opened as in-review without a screenshot is not', () => {
  const f = fakeGitHub({ labels: [{ name: 'demo' }], assignees: [{ login: 'bob' }] });
  opened(f, f.add({ number: 2, user: { login: 'bob' }, body: 'Parent: #1\n\nstatus:in-review' }));
  assert.match(f.log[0], /没有打上 `status:in-review`/);
  assert.equal(f.log[1], '#2 labels run demo');
});
