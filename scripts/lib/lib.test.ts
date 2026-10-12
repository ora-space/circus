import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyLabels, isKnown, labelsFromBody, type LabelFamily } from './labels.ts';
import { hasSummary, splitSummary, withSummary } from './summary.ts';
import { parentOf, runBody } from './run.ts';
import { parseEnv } from './config.ts';

const families: LabelFamily[] = [
  { prefix: 'repo', values: ['desktop', 'specs'], description: '', color: '', exclusive: false, fromBody: true },
  { prefix: 'priority', values: ['p0', 'p1'], description: '', color: '', exclusive: true, fromBody: true },
  { prefix: 'status', values: ['ready'], description: '', color: '', exclusive: true, fromBody: false },
];

test('isKnown accepts only registered prefix and value', () => {
  assert.equal(isKnown('repo:desktop', families), true);
  assert.equal(isKnown('repo:nope', families), false);
  assert.equal(isKnown('desktop', families), false);
});

test('labelsFromBody finds registered labels in prose', () => {
  const body = 'Fix crash.\n\nLabels: repo:desktop, repo:specs repo:nope\nsee https://x/repo:desktop';
  assert.deepEqual(labelsFromBody(body, families), ['repo:desktop', 'repo:specs']);
});

test('labelsFromBody ignores fenced code, non-body families and extra exclusive values', () => {
  const body = '```\nrepo:desktop\n```\npriority:p1 priority:p0 status:ready';
  assert.deepEqual(labelsFromBody(body, families), ['priority:p1']);
  assert.deepEqual(labelsFromBody(null, families), []);
});

test('applyLabels replaces exclusive values and keeps unregistered labels', () => {
  assert.deepEqual(
    applyLabels(['legacy', 'priority:p0', 'repo:desktop'], ['priority:p1', 'repo:specs'], ['repo:desktop'], families),
    ['legacy', 'priority:p1', 'repo:specs'],
  );
});

test('withSummary prepends a summary and replaces an earlier one', () => {
  const once = withSummary('original text', 'first');
  assert.equal(once, '## 总结\n\nfirst\n\n---\n\noriginal text');
  assert.ok(hasSummary(once));
  assert.equal(withSummary(once, 'second'), '## 总结\n\nsecond\n\n---\n\noriginal text');
  assert.equal(withSummary('', 'only'), '## 总结\n\nonly');
  assert.ok(!hasSummary('text\n## 总结'));
});

test('parseEnv reads KEY=value lines', () => {
  assert.deepEqual(parseEnv('# c\r\nA=1\nB= x \n'), { A: '1', B: 'x' });
});

test('splitSummary separates the summary from the original body', () => {
  assert.deepEqual(splitSummary('## 总结\n\nS\n\n---\n\nO'), { summary: 'S', original: 'O' });
  assert.deepEqual(splitSummary('plain'), { summary: '', original: 'plain' });
});

test('parentOf reads the first line of the original body, even after a summary', () => {
  assert.equal(parentOf('Parent: #12\n\nwork'), 12);
  assert.equal(parentOf(withSummary('Parent: #12\n\nwork', 'done')), 12);
  assert.equal(parentOf('see\nParent: #12'), null);
  assert.equal(runBody(3, ' notes '), 'Parent: #3\n\nnotes');
  assert.equal(runBody(3, ''), 'Parent: #3');
});
