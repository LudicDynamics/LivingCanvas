import assert from 'node:assert/strict';
import { test } from 'node:test';
import { actionErrorMissed, registerActionErrorFlag } from '../extensions/toolkit/error-flag.ts';

test('an ActionError payload the runtime recorded as success is flagged; real successes are not', () => {
  assert.equal(actionErrorMissed({ isError: false, details: { code: 'invalid_argument', httpStatus: 400 } }), true);
  assert.equal(actionErrorMissed({ isError: true, details: { code: 'invalid_argument', httpStatus: 400 } }), false);
  assert.equal(actionErrorMissed({ isError: false, details: { path: 'world/inn/02.md', layer: 'world/inn' } }), false);
  assert.equal(actionErrorMissed({ isError: false, details: { code: 'placed' } }), false);
  assert.equal(actionErrorMissed({ isError: false }), false);
});

test('the hook returns { isError: true } only for the missed failure', () => {
  const handlers = [];
  registerActionErrorFlag({ on: (name, fn) => { handlers.push([name, fn]); } });
  assert.equal(handlers.length, 1);
  assert.equal(handlers[0][0], 'tool_result');
  const hook = handlers[0][1];
  assert.deepEqual(hook({ isError: false, details: { code: 'not_found', httpStatus: 404 } }), { isError: true });
  assert.equal(hook({ isError: false, details: { path: 'x' } }), undefined);
});
