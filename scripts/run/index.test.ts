import { test } from 'node:test';
import assert from 'node:assert/strict';
import { command } from './index.ts';
import { fakeContext, flag } from '../lib/testing.ts';
import { UsageError } from '../lib/context.ts';

test('run opens an issue whose body starts with Parent: #N, titled after the parent', () => {
  const { ctx, calls, lines } = fakeContext((args) => (args[1] === 'view' ? '修复启动崩溃\n' : 'https://x/issues/9\n'), {
    read: () => '负责前端部分',
  });
  command.run(['#5', '--body-file', 'f'], ctx);
  assert.equal(flag(calls[1].args, '--title'), '运行：修复启动崩溃');
  assert.equal(calls[1].input, 'Parent: #5\n\n负责前端部分');
  assert.ok(!calls[1].args.includes('--label'));
  assert.deepEqual(lines, ['https://x/issues/9']);
});

test('run --title skips the parent lookup', () => {
  const { ctx, calls } = fakeContext();
  command.run(['5', '--title', '前端'], ctx);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].input, 'Parent: #5');
});

test('run --preflight marks the first line', () => {
  const { ctx, calls } = fakeContext();
  command.run(['5', '--title', '前端', '--preflight'], ctx);
  assert.equal(calls[0].input, 'Parent: #5 (preflight)');
});

test('run needs exactly one issue number', () => {
  const { ctx } = fakeContext();
  assert.throws(() => command.run([], ctx), UsageError);
  assert.throws(() => command.run(['5', '6'], ctx), UsageError);
});
