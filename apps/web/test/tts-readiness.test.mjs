// "Voice is unavailable" must mean voice is unavailable: one failed line (a timeout, a rate
// limit, an experimental voice that is down) is skipped quietly; only a missing configuration or
// several failures in a row pause voice for a minute and show the notice.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';

const readiness = await readFile(new URL('../src/lib/tts-readiness.ts', import.meta.url), 'utf8');
const request = await readFile(new URL('../src/lib/tts-request.ts', import.meta.url), 'utf8');

test('a single failed line does not pause voice or show the notice', () => {
  const body = readiness.slice(readiness.indexOf('export function invalidateTts'));
  const fn = body.slice(0, body.indexOf('\n}') + 2);
  assert.match(readiness, /const FAILURES_BEFORE_PAUSE = 3;/);
  assert.match(fn, /consecutiveFailures \+= 1;/);
  assert.match(fn, /if \(!missing && consecutiveFailures < FAILURES_BEFORE_PAUSE\) return;/);
  // the pause and the notice come only after that early return
  assert.ok(fn.indexOf('return;') < fn.indexOf('retryAt = Date.now() + 60_000'));
  assert.ok(fn.indexOf('return;') < fn.indexOf('warnTtsUnavailable()'));
});

test('a successful line resets the failure streak', () => {
  assert.match(readiness, /export function noteTtsSuccess\(\) \{ consecutiveFailures = 0; \}/);
  const ok = request.indexOf("return { status: 'ready', url: data.url };");
  assert.ok(ok > 0);
  assert.match(request.slice(ok - 40, ok), /noteTtsSuccess\(\);/);
});
