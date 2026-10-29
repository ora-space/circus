import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyLabels, isKnown, labelsFromBody, type LabelFamily } from './labels.ts';
import { closedForAuthor, forAuthorLine, hasSummary, splitSummary, withSummary } from './summary.ts';
import { parentOf, runBody } from './run.ts';
import { parseEnv } from './config.ts';
import { dependLine, dependsFromBody, epicLine, epicOf } from './deps.ts';

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
  assert.deepEqual(labelsFromBody('e.g. `repo:desktop`\n  ```\nrepo:specs\n  ```\n<!-- priority:p0 -->', families), []);
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

test('dependsFromBody reads 依赖 lines of the original body', () => {
  assert.deepEqual(dependsFromBody('## 背景\n依赖：#13 #14、#13\n依赖: #15\n提到 #16'), [13, 14, 15]);
  assert.deepEqual(dependsFromBody('```\n依赖：#13\n```\n<!-- 依赖：#14 -->'), []);
  assert.deepEqual(dependsFromBody(withSummary('依赖：#2', 'done')), [2]);
  assert.deepEqual(dependsFromBody('完整通过依赖 #13'), []);
  assert.equal(dependLine([13, 14]), '依赖：#13 #14');
});

test('epicOf reads 总事项 lines and prose', () => {
  assert.equal(epicOf('总事项：#11'), 11);
  assert.equal(epicOf('关联总事项 #11。来自验证'), 11);
  assert.equal(epicOf('无'), null);
  assert.equal(epicLine(11), '总事项：#11');
});

test('closedForAuthor needs the line first, naming the author, with a reason', () => {
  const line = forAuthorLine('owner', 'bob', '作者已离开');
  assert.equal(line, '由 @owner 代作者 @bob 关闭：作者已离开');
  assert.ok(closedForAuthor(`${line}\n\n结论`, 'bob'));
  assert.ok(!closedForAuthor(`${line}`, 'carol'));
  assert.ok(!closedForAuthor(`结论\n${line}`, 'bob'));
  assert.ok(!closedForAuthor('由 @owner 代作者 @bob 关闭：', 'bob'));
});

test('tags are known, and set from the body only on a Labels: line', () => {
  assert.equal(isKnown('v2'), true);
  assert.deepEqual(labelsFromBody('做一个 v2 演示\n\nLabels: type:task v2 repo:cloud'), ['type:task', 'repo:cloud', 'v2']);
  assert.deepEqual(labelsFromBody('做一个 v2 演示'), []);
  assert.deepEqual(labelsFromBody('```\nLabels: v2\n```'), []);
});
