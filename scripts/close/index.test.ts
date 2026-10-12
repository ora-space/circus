import { test } from 'node:test';
import assert from 'node:assert/strict';
import { command } from './index.ts';
import { fakeContext, flag } from '../lib/testing.ts';
import { UsageError } from '../lib/context.ts';

test('close retitles, prepends the summary, then closes', () => {
  const { ctx, calls } = fakeContext((args) => (args[1] === 'view' ? 'original\n' : ''), {
    read: () => '结论：做完了\n',
  });
  command.run(['4', '--title', '新标题', '--summary-file', '-'], ctx);
  assert.deepEqual(
    calls.map((c) => c.args[1]),
    ['view', 'edit', 'close'],
  );
  assert.equal(flag(calls[1].args, '--title'), '新标题');
  assert.equal(calls[1].input, '## 总结\n\n结论：做完了\n\n---\n\noriginal');
  assert.equal(flag(calls[2].args, '--reason'), 'completed');
});

test('close --not-planned closes as not planned', () => {
  const { ctx, calls } = fakeContext(() => '', { read: () => 's' });
  command.run(['4', '--title', 't', '--summary-file', 'f', '--not-planned'], ctx);
  assert.equal(flag(calls[2].args, '--reason'), 'not planned');
});

test('close requires a title and a non-empty summary', () => {
  const { ctx, calls } = fakeContext(() => '', { read: () => '  ' });
  assert.throws(() => command.run(['4', '--summary-file', 'f'], ctx), UsageError);
  assert.throws(() => command.run(['4', '--title', 't', '--summary-file', 'f'], ctx), /总结不能为空/);
  assert.equal(calls.length, 0);
});
