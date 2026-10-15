/**
 * Pins pi-rp 0a872512 ("salvage LLM double-encoded JSON values in state
 * validation") against the BUILT engine we ship (`vendor/pi-rp/.../dist`), so a
 * later submodule bump that loses the salvage fails here instead of in play.
 *
 * Contract (vendor/pi-rp/packages/coding-agent/src/state/schema-validator.ts
 * `validate`, state-manager.ts `unwrapJsonStringValue`):
 *   - a write that FAILS the schema and whose value is a JSON string encoding an
 *     object/array is retried unwrapped; on success `correctedValue` carries the
 *     unwrapped value (callers apply that, not the string);
 *   - a value that passes as-is is never touched (a dialogue line that happens to
 *     start with `{` stays a string);
 *   - scalars are NOT salvaged: `"5"` where a number is expected is still
 *     rejected — the engine only unwraps objects/arrays, on purpose.
 *
 * LivingCanvas itself denies `state_update` in every bundled preset (the world
 * lives in world.json + our own tools), so this guards the engine path we ship
 * rather than a code path our worlds take today.
 *
 * Build first (`pnpm pi build`): this imports the engine's `dist/` directly.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { SchemaValidator } from '../../../vendor/pi-rp/packages/coding-agent/dist/state/schema-validator.js';
import { unwrapJsonStringValue } from '../../../vendor/pi-rp/packages/coding-agent/dist/state/state-manager.js';

function validator() {
  const v = new SchemaValidator();
  v.loadSchema('test-char', 'char', {
    type: 'object',
    properties: {
      stats: { type: 'object', properties: { hp: { type: 'number' } }, required: ['hp'] },
      tags: { type: 'array', items: { type: 'string' } },
      line: { type: 'string' },
      hp: { type: 'number' },
    },
  });
  return v;
}

const STATE = { char: {} };

test('an object double-encoded as a JSON string is salvaged via correctedValue', () => {
  const r = validator().validate('char.stats', 'replace', '{"hp":3}', STATE);
  assert.equal(r.ok, true, r.reason);
  assert.deepEqual(r.correctedValue, { hp: 3 });
});

test('an array double-encoded as a JSON string is salvaged too (and on add)', () => {
  const r = validator().validate('char.tags', 'add', ' ["lantern","key"] ', STATE);
  assert.equal(r.ok, true, r.reason);
  assert.deepEqual(r.correctedValue, ['lantern', 'key']);
});

test('a root merge with a double-encoded object is salvaged', () => {
  const r = validator().validate('', 'merge', '{"char":{"stats":{"hp":7}}}', STATE);
  assert.equal(r.ok, true, r.reason);
  assert.deepEqual(r.correctedValue, { char: { stats: { hp: 7 } } });
});

test('a valid string that merely looks like JSON is never rewritten', () => {
  const line = '{"hp":3} is what the ledger says, sir.';
  const r = validator().validate('char.line', 'replace', line, STATE);
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.correctedValue, undefined);
  // Even a fully valid JSON object string stays a string where a string is expected.
  const r2 = validator().validate('char.line', 'replace', '{"hp":3}', STATE);
  assert.equal(r2.ok, true, r2.reason);
  assert.equal(r2.correctedValue, undefined);
});

test('a correct object value passes untouched', () => {
  const r = validator().validate('char.stats', 'replace', { hp: 3 }, STATE);
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.correctedValue, undefined);
});

test('scalars are not salvaged: "5" (or a JSON-quoted "\\"5\\"") where a number is expected is still rejected', () => {
  for (const value of ['5', '"5"']) {
    const r = validator().validate('char.hp', 'replace', value, STATE);
    assert.equal(r.ok, false, `expected rejection for ${JSON.stringify(value)}`);
    assert.match(r.reason, /Schema validation failed for "char"/);
  }
});

test('a double-encoded object that is still wrong after unwrapping keeps the ORIGINAL rejection', () => {
  const r = validator().validate('char.stats', 'replace', '{"hp":"three"}', STATE);
  assert.equal(r.ok, false);
  assert.equal(r.correctedValue, undefined);
});

test('unwrapJsonStringValue only unwraps objects/arrays', () => {
  assert.deepEqual(unwrapJsonStringValue('{"a":1}'), { a: 1 });
  assert.deepEqual(unwrapJsonStringValue('[1,2]'), [1, 2]);
  assert.equal(unwrapJsonStringValue('"5"'), '"5"');
  assert.equal(unwrapJsonStringValue('{not json'), '{not json');
  assert.equal(unwrapJsonStringValue('plain dialogue'), 'plain dialogue');
  assert.equal(unwrapJsonStringValue(5), 5);
});
