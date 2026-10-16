import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatSlash, fromSigned, parseSlash } from './slash.ts';

test('parseSlash reads known verbs line by line', () => {
  const body = 'please\n/label repo:desktop, repo:specs\n  /assign @bob alice\n/tmp/x is a path\n/unknown x\n/unlabel';
  assert.deepEqual(parseSlash(body), [
    { verb: 'label', args: ['repo:desktop', 'repo:specs'] },
    { verb: 'assign', args: ['bob', 'alice'] },
    { verb: 'unlabel', args: [] },
  ]);
});

test('parseSlash skips fenced code', () => {
  assert.deepEqual(parseSlash('```\n/label repo:desktop\n```\n/unassign @bob'), [{ verb: 'unassign', args: ['bob'] }]);
  assert.deepEqual(parseSlash(null), []);
});

test('parseSlash skips commands that render as code or stay hidden', () => {
  for (const body of ['`/unlabel review:lgtm`', 'x\n\n    /unlabel review:lgtm', '<!--\n/unlabel review:lgtm\n-->', '````\n```\n/unlabel review:lgtm\n````']) {
    assert.deepEqual(parseSlash(body), [], body);
  }
});

test('fromSigned splits +/- arguments and formatSlash writes them back', () => {
  const cmds = fromSigned(['+repo:desktop', '-repo:specs', 'repo:cloud'], 'label', 'unlabel');
  assert.deepEqual(cmds, [
    { verb: 'unlabel', args: ['repo:specs'] },
    { verb: 'label', args: ['repo:desktop', 'repo:cloud'] },
  ]);
  assert.equal(formatSlash(cmds), '/unlabel repo:specs\n/label repo:desktop repo:cloud');
  assert.equal(formatSlash(fromSigned(['bob', '-@carol'], 'assign', 'unassign')), '/unassign @carol\n/assign @bob');
  assert.deepEqual(parseSlash(formatSlash(cmds)), cmds);
});

test('depend commands strip and restore "#"', () => {
  const cmds = parseSlash('/depend #13, 14\n/undepend #15');
  assert.deepEqual(cmds, [
    { verb: 'depend', args: ['13', '14'] },
    { verb: 'undepend', args: ['15'] },
  ]);
  assert.equal(formatSlash(fromSigned(['#13', '-#15'], 'depend', 'undepend')), '/undepend #15\n/depend #13');
});
