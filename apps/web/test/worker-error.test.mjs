// lib/worker-error.ts: the runtime Worker's `error` event → reported text. A Worker whose script did not load or
// start fires a bare Event (no message) in some browsers; that was reported as "WorkerError: undefined" (2026-10-05).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const W = await jiti.import('../src/lib/worker-error.ts');

test('an ErrorEvent keeps its message and location', () => {
  assert.equal(W.workerErrorText({ message: 'Uncaught SyntaxError: x', filename: 'https://c/runtime/r/worker.js', lineno: 58, colno: 9 }), 'WorkerError: Uncaught SyntaxError: x\n    at https://c/runtime/r/worker.js:58:9');
  assert.equal(W.workerErrorText({ error: new Error('boom') }), 'WorkerError: boom');
});

test('a bare Event is never reported as "undefined"', () => {
  for (const e of [{}, { message: undefined }, { message: '' }, null, undefined, new (class Ev { type = 'error'; })()]) {
    assert.equal(W.workerErrorMessage(e), null);
    const text = W.workerErrorText(e);
    assert.doesNotMatch(text, /undefined/);
    assert.match(text, /^WorkerError: the runtime worker did not start/);
  }
  assert.equal(W.workerErrorText({}, 'worker.js HTTP 404'), 'WorkerError: worker.js HTTP 404');
});

test('the script probe says 404 / loaded / unreachable', async () => {
  const at = (status) => async (_u, init) => { assert.equal(init.method, 'HEAD'); return new Response(null, { status }); };
  assert.equal(await W.workerScriptStatus('https://c/worker.js', at(404)), 'worker.js HTTP 404');
  assert.equal(await W.workerScriptStatus('https://c/worker.js', at(200)), 'worker.js loaded (HTTP 200) but did not start');
  assert.equal(await W.workerScriptStatus('https://c/worker.js', async () => { throw new TypeError('offline'); }), 'worker.js unreachable');
});
