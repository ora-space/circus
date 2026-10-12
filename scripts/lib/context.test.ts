import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeUtf8, UsageError } from './context.ts';

test('decodeUtf8 accepts UTF-8 Chinese and strips BOM', () => {
  assert.equal(decodeUtf8(Buffer.from('结论：已过时', 'utf8'), 'f'), '结论：已过时');
  assert.equal(decodeUtf8(Buffer.from('\uFEFF结论', 'utf8'), 'f'), '结论');
});

test('decodeUtf8 rejects invalid UTF-8', () => {
  assert.throws(() => decodeUtf8(Buffer.from([0xe4, 0xb8]), 'f'), UsageError);
});

test('decodeUtf8 rejects PowerShell-style question-mark corruption', () => {
  const garbled = '## ?????? owner ?????? close?\n\n**????**：?? bug ?????????。';
  assert.throws(() => decodeUtf8(Buffer.from(garbled, 'utf8'), 'stdin'), /编码损坏/);
});

test('decodeUtf8 allows ASCII with single ? or Chinese with ??', () => {
  assert.equal(decodeUtf8(Buffer.from('ready?', 'utf8'), 'f'), 'ready?');
  assert.equal(decodeUtf8(Buffer.from('结论？？仍有效', 'utf8'), 'f'), '结论？？仍有效');
});
