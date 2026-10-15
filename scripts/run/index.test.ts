import { test } from 'node:test';
import assert from 'node:assert/strict';
import { command } from './index.ts';
import { fakeContext, flag } from '../lib/testing.ts';
import { UsageError } from '../lib/context.ts';

const labels = (...names: string[]) => names.map((name) => ({ name }));

// gh answering the parent (#5) and its blockers; `issue create` returns the new issue's URL.
function parentGh(parent: { labels?: { name: string }[] } = {}, blockers: { number: number; state: string; labels: { name: string }[] }[] = []) {
  return (args: string[]) => {
    if (args[0] === 'issue') return 'https://x/issues/9\n';
    if (args.some((a) => a.includes('/dependencies/blocked_by'))) return blockers.map((b) => JSON.stringify(b)).join('\n');
    return JSON.stringify({ number: 5, title: '修复启动崩溃', state: 'open', labels: [], ...parent });
  };
}

const created = (calls: { args: string[]; input?: string }[]) => calls.find((c) => c.args[0] === 'issue')!;

test('run opens an issue whose body starts with Parent: #N, titled after the parent', () => {
  const { ctx, calls, lines } = fakeContext(parentGh(), { read: () => '负责前端部分' });
  command.run(['#5', '--body-file', 'f'], ctx);
  assert.equal(flag(created(calls).args, '--title'), '运行：修复启动崩溃');
  assert.equal(created(calls).input, 'Parent: #5\n\n负责前端部分');
  assert.ok(!created(calls).args.includes('--label'));
  assert.deepEqual(lines, ['https://x/issues/9']);
});

test('run --title overrides the parent title', () => {
  const { ctx, calls } = fakeContext(parentGh());
  command.run(['5', '--title', '前端'], ctx);
  assert.equal(flag(created(calls).args, '--title'), '前端');
  assert.equal(created(calls).input, 'Parent: #5');
});

test('run --preflight marks the first line', () => {
  const { ctx, calls } = fakeContext(parentGh({}, [{ number: 3, state: 'open', labels: [] }]));
  command.run(['5', '--preflight'], ctx);
  assert.equal(created(calls).input, 'Parent: #5 (preflight)');
});

test('run refuses a decision, and a plain run of an issue waiting on an open decision', () => {
  const decision = fakeContext(parentGh({ labels: labels('type:decision') }));
  assert.throws(() => command.run(['5', '--preflight'], decision.ctx), /#5 是 type:decision，不能开运行 issue/);

  const blockers = [
    { number: 3, state: 'open', labels: labels('type:decision') },
    { number: 4, state: 'closed', labels: labels('type:decision') },
  ];
  const waiting = fakeContext(parentGh({}, blockers));
  assert.throws(() => command.run(['5'], waiting.ctx), /#5 依赖未关闭的决策 #3，只能开 preflight/);
  assert.ok(!waiting.calls.some((c) => c.args[0] === 'issue'));
  command.run(['5', '--preflight'], waiting.ctx);
  assert.equal(created(waiting.calls).input, 'Parent: #5 (preflight)');
});

test('run needs exactly one issue number', () => {
  const { ctx } = fakeContext();
  assert.throws(() => command.run([], ctx), UsageError);
  assert.throws(() => command.run(['5', '6'], ctx), UsageError);
});
