import assert from 'node:assert/strict';
import { test } from 'node:test';

const storage = new Map();
globalThis.localStorage = {
  getItem(key) { return storage.has(key) ? storage.get(key) : null; },
  setItem(key, value) { storage.set(key, String(value)); },
};
let mod = null;
try {
  const { createJiti } = await import('../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs');
  const jiti = createJiti(import.meta.url, { moduleCache: false, tryNative: true });
  mod = await jiti.import('../src/lib/play-hints.ts');
} catch (err) {
  console.error('jiti/bootstrap unavailable, skipping play-hints tests:', err?.message ?? err);
}
const skip = mod ? false : 'jiti or pi-rp submodule unavailable';
const settled = (overrides = {}) => ({
  enabled: true,
  phase: 'idle',
  stage: 'Ready for your next action',
  error: null,
  completionSeq: 3,
  visibleSeq: 3,
  worldReady: true,
  worldFrozen: false,
  submitPending: false,
  preparedSeq: null,
  ...overrides,
});

test('Continue only appears for a current settled receipt', { skip }, () => {
  assert.equal(mod.deriveContinueHintAvailability(settled()), 'available');
  assert.equal(mod.deriveContinueHintAvailability(settled({ phase: 'writing' })), 'hidden-not-settled');
  assert.equal(mod.deriveContinueHintAvailability(settled({ stage: null, completionSeq: 0, visibleSeq: null })), 'hidden-not-settled');
  assert.equal(mod.deriveContinueHintAvailability(settled({ error: { message: 'failed', retryable: true } })), 'hidden-error');
});

test('world, freeze, submit pending, disabled, and prepared guards hide Continue', { skip }, () => {
  assert.equal(mod.deriveContinueHintAvailability(settled({ enabled: false })), 'hidden-disabled');
  assert.equal(mod.deriveContinueHintAvailability(settled({ worldReady: false })), 'hidden-world');
  assert.equal(mod.deriveContinueHintAvailability(settled({ worldFrozen: true })), 'hidden-frozen');
  assert.equal(mod.deriveContinueHintAvailability(settled({ submitPending: true })), 'hidden-submit-pending');
  assert.equal(mod.deriveContinueHintAvailability(settled({ preparedSeq: 3 })), 'hidden-submit-pending');
  assert.equal(mod.deriveContinueHintAvailability(settled({ visibleSeq: 2 })), 'hidden-not-settled');
});

test('play hint preference defaults on and survives storage failures in memory', { skip }, () => {
  mod.setPlayHintsEnabled(false);
  assert.equal(mod.getPlayHintsEnabled(), false);
  assert.equal(storage.get('airp:play-hints'), 'off');
  mod.setPlayHintsEnabled(true);
  assert.equal(storage.get('airp:play-hints'), 'on');
  globalThis.localStorage.setItem = () => { throw new Error('blocked'); };
  mod.setPlayHintsEnabled(false);
  assert.equal(mod.getPlayHintsEnabled(), false);
});

test('prompt keeps discovery and no-side-effect boundaries', { skip }, () => {
  assert.match(mod.PLAY_HINT_REQUEST, /actually discovered and the items I carry/);
  assert.match(mod.PLAY_HINT_REQUEST, /Do not reveal undiscovered answers/);
  assert.match(mod.PLAY_HINT_REQUEST, /change game state/);
  assert.match(mod.PLAY_HINT_REQUEST, /one short hint Chalk/);
  assert.match(mod.PLAY_HINT_REQUEST, /wait for my decision/);
});
