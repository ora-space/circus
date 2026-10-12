import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorize, handle } from './handle.ts';
import type { GitHub, Issue } from './github.ts';

// In-memory issue store that records writes.
function fakeGitHub(issue: Partial<Issue> = {}, assignable = ['alice', 'bob', 'carol', 'owner'], writers = ['owner']) {
  const state: Issue = {
    number: 1,
    state: 'open',
    body: '',
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    user: { login: 'alice' },
    assignees: [],
    labels: [],
    ...issue,
  };
  const log: string[] = [];
  const gh: GitHub = {
    getIssue: () => structuredClone(state),
    setLabels: (_n, labels) => {
      log.push(`labels ${labels.join(' ')}`);
      state.labels = labels.map((name) => ({ name }));
    },
    addAssignees: (_n, users) => {
      log.push(`assign ${users.join(' ')}`);
      for (const u of users) if (assignable.includes(u) && !state.assignees.some((a) => a.login === u)) state.assignees.push({ login: u });
      return state.assignees.map((a) => a.login);
    },
    removeAssignees: (_n, users) => {
      log.push(`unassign ${users.join(' ')}`);
      state.assignees = state.assignees.filter((a) => !users.includes(a.login));
    },
    comment: (_n, body) => void log.push(`comment ${body}`),
    react: (id, content) => void log.push(`react ${id} ${content}`),
    reopen: () => {
      log.push('reopen');
      state.state = 'open';
    },
    permission: (login) => {
      log.push(`permission ${login}`);
      return writers.includes(login) ? 'admin' : 'read';
    },
  };
  return { gh, state, log };
}

const user = (login: string) => ({ login, type: 'User' });
const commentEvent = (gh: ReturnType<typeof fakeGitHub>, actor: string, body: string) => {
  handle(
    { name: 'issue_comment', payload: { action: 'created', issue: gh.state, sender: user(actor), comment: { id: 42, body } } },
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
