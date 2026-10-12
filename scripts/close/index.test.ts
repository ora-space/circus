import { test } from 'node:test';
import assert from 'node:assert/strict';
import { command } from './index.ts';
import { fakeContext, flag, type Call } from '../lib/testing.ts';
import { UsageError } from '../lib/context.ts';

// gh double: the issue is authored by `author`, the session is `me`.
const gh = (author = 'me', me = 'me') => (args: string[]) => {
  if (args[1] === 'view') return JSON.stringify({ body: 'original\n', author: { login: author } });
  if (args[1] === 'user') return `${me}\n`;
  if (args[0] === 'api') return '{"push":true}';
  return '';
};
const writes = (calls: Call[]) => calls.filter((c) => c.args[0] === 'issue' && c.args[1] !== 'view');

test('close retitles, prepends the summary, then closes', () => {
  const { ctx, calls } = fakeContext(gh(), { read: () => '结论：做完了\n' });
  command.run(['4', '--title', '新标题', '--summary-file', '-'], ctx);
  const [edit, close] = writes(calls);
  assert.deepEqual([edit.args[1], close.args[1]], ['edit', 'close']);
  assert.equal(flag(edit.args, '--title'), '新标题');
  assert.equal(edit.input, '## 总结\n\n结论：做完了\n\n---\n\noriginal');
  assert.equal(flag(close.args, '--reason'), 'completed');
});

test('close --not-planned closes as not planned', () => {
  const { ctx, calls } = fakeContext(gh(), { read: () => 's' });
  command.run(['4', '--title', 't', '--summary-file', 'f', '--not-planned'], ctx);
  assert.equal(flag(writes(calls)[1].args, '--reason'), 'not planned');
});

test('close refuses issues of other authors unless --for-author gives a reason', () => {
  const { ctx, calls } = fakeContext(gh('bob', 'owner'), { read: () => '结论' });
  assert.throws(() => command.run(['4', '--title', 't', '--summary-file', 'f'], ctx), /作者是 @bob，应由作者关闭/);
  assert.equal(writes(calls).length, 0);
  command.run(['4', '--title', 't', '--summary-file', 'f', '--for-author', '作者已离开项目'], ctx);
  assert.equal(writes(calls)[0].input, '## 总结\n\n由 @owner 代作者 @bob 关闭：作者已离开项目\n\n结论\n\n---\n\noriginal');
});

test('close requires a title and a non-empty summary', () => {
  const { ctx, calls } = fakeContext(() => '', { read: () => '  ' });
  assert.throws(() => command.run(['4', '--summary-file', 'f'], ctx), UsageError);
  assert.throws(() => command.run(['4', '--title', 't', '--summary-file', 'f'], ctx), /总结不能为空/);
  assert.equal(calls.length, 0);
});
