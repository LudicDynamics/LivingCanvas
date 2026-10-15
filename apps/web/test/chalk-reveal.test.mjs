// Chalk wet-ink reveal timing.
// Run: node --test apps/web/test/chalk-reveal.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';

// jiti lets us import the TS source directly. apps/web/test/ → repo root is 3 up.
let mod = null;
try {
  const { createJiti } = await import('../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs');
  const jiti = createJiti(import.meta.url, { moduleCache: false, tryNative: true });
  mod = await jiti.import('../src/lib/chalk-reveal.ts');
} catch (err) {
  console.error('jiti/bootstrap unavailable, skipping reveal group:', err?.message ?? err);
}

const skip = mod ? false : 'jiti or pi-rp submodule unavailable';

test('C1 empty text reveals 0', { skip }, () => {
  assert.equal(mod.revealChars(0, 1000, 0), 0);
});

test('C2 zero elapsed shows nothing new', { skip }, () => {
  assert.equal(mod.revealChars(100, 0, 0), 0);
});

test('C3 never exceeds the buffer', { skip }, () => {
  assert.equal(mod.revealChars(10, 1_000_000, 0), 10);
});

test('C4 monotonic in elapsed time', { skip }, () => {
  let prev = -1;
  for (let t = 0; t <= 600; t += 24) {
    const n = mod.revealChars(500, t, 0);
    assert.ok(n >= prev, `reveal went backwards at t=${t}`);
    prev = n;
  }
});

test('C5 lights the first cell inside one tick', { skip }, () => {
  const n = mod.revealChars(500, mod.REVEAL_STEP_MS, 0);
  assert.ok(n >= 1, 'first character must appear within one step');
});

test('C6 a short chalk line lands well under 2s', { skip }, () => {
  assert.equal(mod.revealChars(30, 2000, 0), 30);
});

test('C7 normal copy settles at the honest 1-char-per-step pace', { skip }, () => {
  // 200 chars is under the cap → 3 steps ⇒ 3 chars exactly.
  assert.equal(mod.revealChars(200, 3 * mod.REVEAL_STEP_MS, 0), 3);
});

test('C8 a huge body is compressed, not crawled', { skip }, () => {
  // stepFor caps the whole body at MAX_REVEAL_MS.
  assert.equal(mod.stepFor(5000), mod.MAX_REVEAL_MS / 5000);
  const n = mod.revealChars(5000, 4000, 0);
  assert.ok(n > 1000, `expected compression, got ${n}`);
});

test('C9 clamps a negative currentShown', { skip }, () => {
  const n = mod.revealChars(100, 48, -5);
  assert.ok(n >= 0 && n <= 100);
});
