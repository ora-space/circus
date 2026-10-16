import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prose } from './markdown.ts';

test('prose blanks fenced code, matching fence char and length', () => {
  assert.equal(prose('a\n```\nx\n```\nb'), 'a\n\n\n\nb');
  assert.equal(prose('````\n```\nx\n````\nb'), '\n\n\n\nb');
  assert.equal(prose('~~~\n```\nx\n~~~\nb'), '\n\n\n\nb');
  assert.equal(prose('  ```ts\nx\n  ```\nb'), '\n\n\nb');
  assert.equal(prose('```\nx'), '\n'); // an unclosed fence runs to the end
});

test('prose blanks indented code, inline code and HTML comments', () => {
  assert.equal(prose('a\n    x\n\ty\n  z'), 'a\n\n\n  z');
  assert.equal(prose('use `x` or ``y ` z`` here'), 'use   or   here');
  assert.equal(prose('a `unclosed'), 'a `unclosed');
  assert.equal(prose('```x``` b'), '  b'); // backticks in the info string: inline code, not a fence
  assert.equal(prose('a <!-- x --> b'), 'a   b');
  assert.equal(prose('a <!--\nx\n```\n--> b\nc'), 'a \n\n\n  b\nc');
  assert.equal(prose(null), '');
});
