import { test } from 'node:test';
import assert from 'node:assert/strict';
import { command } from './index.ts';
import { fakeContext, flag } from '../lib/testing.ts';
import { allLabels } from '../lib/labels.ts';

test('setup creates every registered label with --force', () => {
  const { ctx, calls } = fakeContext();
  command.run([], ctx);
  assert.deepEqual(
    calls.map((c) => c.args[2]),
    allLabels().map((l) => l.name),
  );
  assert.ok(calls.every((c) => c.args.includes('--force') && flag(c.args, '-R') === 'ora-space/circus'));
});
