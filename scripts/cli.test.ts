import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMMANDS, help } from './cli.ts';

const here = dirname(fileURLToPath(import.meta.url));

test('every command directory is registered, and only those', () => {
  const dirs = readdirSync(here).filter((d) => d !== 'lib' && statSync(join(here, d)).isDirectory());
  assert.deepEqual(dirs.sort(), Object.keys(COMMANDS).sort());
});

test('help lists each command synopsis', () => {
  for (const c of Object.values(COMMANDS)) assert.ok(help().includes(c.usage.split('\n')[0]));
});
