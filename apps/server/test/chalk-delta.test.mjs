import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractContentPrefix } from '../dist/engine/chalk-delta.js';

test('content first key, complete', () => {
  const r = extractContentPrefix('{"content":"hello"}');
  assert.equal(r.text, 'hello');
  assert.equal(r.complete, true);
});

test('content not first key (path before content)', () => {
  const r = extractContentPrefix('{"path":"a/b.md","content":"hello"}');
  assert.equal(r.text, 'hello');
  assert.equal(r.complete, true);
});

test('content after another string value containing a colon', () => {
  const r = extractContentPrefix('{"path":"a:b","link_to":"x","content":"y"}');
  assert.equal(r.text, 'y');
  assert.equal(r.complete, true);
});

test('content after a nested object', () => {
  const r = extractContentPrefix('{"meta":{"a":[1,2]},"content":"hi"}');
  assert.equal(r.text, 'hi');
  assert.equal(r.complete, true);
});

test('unterminated string returns decoded prefix, incomplete', () => {
  const r = extractContentPrefix('{"content":"The fog parts');
  assert.equal(r.text, 'The fog parts');
  assert.equal(r.complete, false);
});

// NON-EMPTINESS: without the "defer incomplete escape" rule, a trailing
// backslash would surface a mangled char. `a\` must decode to `a` (not `a\`).
test('dangling backslash is deferred, never surfaced', () => {
  const r = extractContentPrefix('{"content":"a\\');
  assert.equal(r.text, 'a');
  assert.equal(r.complete, false);
});

test('escape completes across two fragments', () => {
  const frag1 = '{"content":"a\\';
  const frag2 = frag1 + '"b"}';
  assert.equal(extractContentPrefix(frag1).text, 'a');
  assert.equal(extractContentPrefix(frag2).text, 'a"b');
  assert.equal(extractContentPrefix(frag2).complete, true);
});

test('\\uXXXX split across fragments is deferred whole', () => {
  const frag1 = '{"content":"\\u00';
  assert.equal(extractContentPrefix(frag1).text, '');
  const frag2 = '{"content":"\\u00e9!"}';
  assert.equal(extractContentPrefix(frag2).text, 'é!');
});

test('all escape forms decode', () => {
  const r = extractContentPrefix('{"content":"a\\nb\\tc\\\\d\\/e\\"f"}');
  assert.equal(r.text, 'a\nb\tc\\d/e"f');
});

test('literal newline inside value is preserved (not a JSON escape)', () => {
  const r = extractContentPrefix('{"content":"line1\n\nline2');
  assert.equal(r.text, 'line1\n\nline2');
  assert.equal(r.complete, false);
});

test('missing content returns empty', () => {
  const r = extractContentPrefix('{"path":"a.md"}');
  assert.deepEqual(r, { text: '', complete: false });
});

test('content pending behind a growing value returns empty', () => {
  const r = extractContentPrefix('{"path":"a.md","cont');
  assert.deepEqual(r, { text: '', complete: false });
});

test('content not a string is ignored', () => {
  const r = extractContentPrefix('{"content":42}');
  assert.deepEqual(r, { text: '', complete: false });
});

test('non-object returns empty', () => {
  assert.deepEqual(extractContentPrefix(''), { text: '', complete: false });
  assert.deepEqual(extractContentPrefix('[]'), { text: '', complete: false });
});
