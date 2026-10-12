import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { command, frontmatter } from './index.ts';
import { fakeContext } from '../lib/testing.ts';

test('frontmatter reads fields and drops trailing comments', () => {
  assert.deepEqual(frontmatter('---\nsummary: 一句话\nscope: ora-space   # 范围\n---\n# T'), {
    summary: '一句话',
    scope: 'ora-space',
  });
  assert.deepEqual(frontmatter('# no frontmatter'), {});
});

test('memory lists every directory with its entries', () => {
  const root = mkdtempSync(join(tmpdir(), 'circus-memory-'));
  mkdirSync(join(root, 'memory', 'rules'), { recursive: true });
  writeFileSync(join(root, 'memory', 'rules', 'a.md'), '---\nsummary: S\nscope: all\n---\n');
  const { ctx, lines } = fakeContext(undefined, { root });
  command.run([], ctx);
  assert.equal(lines.join('\n'), '## rules\n- memory/rules/a.md [all] S\n\n## methods\n\n## preferences');
});
