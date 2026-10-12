import { test } from 'node:test';
import assert from 'node:assert/strict';
import { command } from './index.ts';
import { fakeContext } from '../lib/testing.ts';

const respond = (permissions: object) => (args: string[]) =>
  args[1] === 'user' ? 'alice\n' : JSON.stringify(permissions);

test('whoami: push or admin means owner', () => {
  const { ctx, calls, lines } = fakeContext(respond({ admin: false, push: true, pull: true }));
  command.run([], ctx);
  assert.deepEqual(calls[1].args, ['api', 'repos/ora-space/circus', '--jq', '.permissions']);
  assert.match(lines[0], /^你是 @alice（owner）/);
});

test('whoami: read access means member, whose word is not an owner decision', () => {
  const { ctx, lines } = fakeContext(respond({ admin: false, push: false, pull: true }));
  command.run([], ctx);
  assert.match(lines[0], /^你是 @alice（成员）.*不是 owner/);
});
