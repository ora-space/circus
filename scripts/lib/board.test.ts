import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boardValues, ghBoard, STATUS_OPTIONS } from './board.ts';
import { fakeContext } from './testing.ts';

const labels = (...names: string[]) => names.map((name) => ({ name }));

test('boardValues: open dependencies make Blocked, above Running but below status labels', () => {
  assert.deepEqual(boardValues({ state: 'open', labels: [] }, 1, 2), { Status: 'Blocked' });
  assert.deepEqual(boardValues({ state: 'open', labels: labels('status:needs-owner') }, 0, 2), { Status: 'Needs Owner' });
  assert.deepEqual(boardValues({ state: 'open', labels: labels('status:needs-author') }, 1, 0), { Status: 'Needs Author' });
  assert.deepEqual(boardValues({ state: 'closed', labels: [] }, 0, 2), { Status: 'Done' });
});

test('boardValues: closed > status label > open runs > Open; priority from its label', () => {
  assert.deepEqual(boardValues({ state: 'closed', labels: labels('status:needs-owner') }, 1), { Status: 'Done' });
  assert.deepEqual(boardValues({ state: 'open', labels: labels('status:in-review', 'priority:p1') }, 2), {
    Status: 'In Review',
    Priority: 'P1',
  });
  assert.deepEqual(boardValues({ state: 'open', labels: [] }, 1), { Status: 'Running' });
  assert.deepEqual(boardValues({ state: 'open', labels: labels('repo:desktop') }, 0), { Status: 'Open' });
});

// gh stub answering GraphQL by the operation it contains.
function graphqlStub(fields: unknown[], addError?: string) {
  return (args: string[], input?: string) => {
    const { query } = JSON.parse(input ?? '{}') as { query: string };
    if (query.includes('organization(')) {
      return JSON.stringify({ data: { organization: { projectV2: { id: 'P', fields: { nodes: fields } } } } });
    }
    if (query.includes('addProjectV2ItemById')) {
      return JSON.stringify(addError ? { errors: [{ message: addError }] } : { data: { addProjectV2ItemById: { item: { id: 'I' } } } });
    }
    if (query.includes('projectItems')) {
      return JSON.stringify({ data: { node: { projectItems: { nodes: [{ id: 'I2', project: { id: 'P' } }] } } } });
    }
    return JSON.stringify({ data: {} });
  };
}

const status = { id: 'FS', name: 'Status', options: STATUS_OPTIONS.map((o, i) => ({ id: `s${i}`, name: o.name })) };
const priority = { id: 'FP', name: 'Priority', options: ['P0', 'P1'].map((name) => ({ id: name, name })) };

const updates = (calls: { input?: string }[]) =>
  calls
    .map((c) => JSON.parse(c.input ?? '{}'))
    .filter((b) => b.query?.includes('updateProjectV2ItemFieldValue'))
    .map((b) => b.variables);

test('sync adds the item and sets each field; missing options only warn', () => {
  const warnings: string[] = [];
  const { ctx, calls } = fakeContext(graphqlStub([status, priority]));
  ghBoard(ctx.gh, 'ora-space', 4, (w) => warnings.push(w)).sync('ISSUE', { Status: 'Running', Priority: 'P3' });
  assert.deepEqual(updates(calls), [{ p: 'P', i: 'I', f: 'FS', o: 's2' }]);
  assert.match(warnings[0], /Priority 或选项 P3/);
  assert.deepEqual(calls[0].args, ['api', '-X', 'POST', 'graphql', '--input', '-']);
});

test('sync falls back to the existing item when a concurrent add won', () => {
  const { ctx, calls } = fakeContext(graphqlStub([status], 'Content already exists in this project'));
  ghBoard(ctx.gh, 'ora-space', 4).sync('ISSUE', { Status: 'Done' });
  assert.deepEqual(updates(calls), [{ p: 'P', i: 'I2', f: 'FS', o: 's6' }]);
});

test('the first sync fixes Status options and creates Priority, then reloads', () => {
  const stale = { ...status, options: [{ id: 'x', name: 'Inbox' }] };
  const warnings: string[] = [];
  const { ctx, calls } = fakeContext(graphqlStub([stale]));
  const board = ghBoard(ctx.gh, 'ora-space', 4, (w) => warnings.push(w));
  board.sync('A', { Status: 'Open' });
  board.sync('B', { Status: 'Open' });
  const ops = calls.map((c) => /(organization|updateProjectV2Field\(|createProjectV2Field)/.exec(JSON.parse(c.input!).query)?.[1]).filter(Boolean);
  assert.deepEqual(ops, ['organization', 'updateProjectV2Field(', 'createProjectV2Field', 'organization']);
  assert.deepEqual(warnings.slice(0, 2), ['看板 Status 选项已设为：Open, Blocked, Running, Needs Owner, In Review, Needs Author, Done', '看板已创建 Priority 字段']);
});

test('fields already in shape are left alone', () => {
  const { ctx, calls } = fakeContext(graphqlStub([status, priority]));
  ghBoard(ctx.gh, 'ora-space', 4).sync('A', { Status: 'Open' });
  assert.ok(!calls.some((c) => /updateProjectV2Field\(|createProjectV2Field/.test(JSON.parse(c.input!).query)));
});
