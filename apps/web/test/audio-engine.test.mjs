// Audio engine request-state assertions (A1 batch).
// Web Audio is unavailable in node → initAudio() returns null, so these tests only
// assert the *request state* (what the engine recorded), never ctx/decode/mixing.
// Run: node --test apps/web/test/audio-engine.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';

// jiti lets us import the TS source directly. apps/web/test/ → repo root is 3 up.
let mod = null;
try {
  const { createJiti } = await import('../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs');
  const jiti = createJiti(import.meta.url, { moduleCache: false, tryNative: true });
  mod = await jiti.import('../src/lib/audio.ts');
} catch (err) {
  console.error('jiti/bootstrap unavailable, skipping engine group:', err?.message ?? err);
}

const skip = mod ? false : 'jiti or pi-rp submodule unavailable';

test('E1 initAudio() is null without Web Audio', { skip }, () => {
  assert.equal(mod.initAudio(), null);
});

test('E2 setTheme(ref) records ref even without ctx', { skip }, () => {
  mod.setTheme('/api/audio?path=themes%2Fwhitechapel.mp3');
  assert.equal(mod.audioDebugState().theme, '/api/audio?path=themes%2Fwhitechapel.mp3');
  mod.setTheme(null);
  assert.equal(mod.audioDebugState().theme, null);
});

test('E3 setAmbient(null) is declared silence (ref null, loaded empty)', { skip }, () => {
  mod.setAmbient(null);
  const s = mod.audioDebugState();
  assert.equal(s.ambient, null);
  assert.deepEqual(s.loaded, []);
});

test('E4 setBGM accepts URL and null', { skip }, () => {
  mod.setBGM('/api/audio?path=bgm%2Fcalm.mp3');
  assert.equal(mod.audioDebugState().bgm, '/api/audio?path=bgm%2Fcalm.mp3');
  mod.setBGM(null);
  assert.equal(mod.audioDebugState().bgm, null);
});

test('E5 preloadAudio resolves and (no ctx) leaves loaded empty', { skip }, async () => {
  await mod.preloadAudio(['/api/audio?path=bgm%2Fcalm.mp3']);   // must never reject
  assert.deepEqual(mod.audioDebugState().loaded, []);
});

test('E6 new FoleyName page-turn and playStinger do not throw', { skip }, () => {
  assert.doesNotThrow(() => mod.playFoley('page-turn'));
  assert.doesNotThrow(() => mod.playStinger('shock'));
});

test('E7 audioDebugState key set is exactly {ambient,bgm,theme,loaded}', { skip }, () => {
  assert.deepEqual(Object.keys(mod.audioDebugState()).sort(), ['ambient', 'bgm', 'loaded', 'theme']);
});
