// show-geometry pure-function assertions.
// The dispatcher and these tests share the same functions, so a divergence in
// id-legality / defaults fails here rather than in a live canvas.
// Run: node --test apps/web/test/show-geometry.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';

// jiti lets us import the TS source directly. apps/web/test/ → repo root is 3 up.
let mod = null;
try {
  const { createJiti } = await import('../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs');
  const jiti = createJiti(import.meta.url, { moduleCache: false, tryNative: true });
  mod = await jiti.import('../src/lib/show-geometry.ts');
} catch (err) {
  console.error('jiti/bootstrap unavailable, skipping show-geometry group:', err?.message ?? err);
}

const skip = mod ? false : 'jiti or pi-rp submodule unavailable';

// --- resolveShowKind -------------------------------------------------------

test('G1 resolveShowKind accepts a real id', { skip }, () => {
  assert.equal(mod.resolveShowKind('spotlight'), 'spotlight');
});

test('G2 resolveShowKind(unknown string) → null (never throws)', { skip }, () => {
  assert.equal(mod.resolveShowKind('nope'), null);
});

test('G3 resolveShowKind(undefined) → null (malformed-frame guard)', { skip }, () => {
  // Without the typeof guard this is `SHOW_IDS.includes(undefined)` → TypeError,
  // which would abort the whole WS message handler.
  assert.equal(mod.resolveShowKind(undefined), null);
});

test('G4 resolveShowKind("letter") → null (docked kind is not a performance)', { skip }, () => {
  // `letter` is in COMPONENT_REGISTRY but not SHOW_IDS; the server refuses it too.
  assert.equal(mod.resolveShowKind('letter'), null);
});

// --- evidenceLinks ---------------------------------------------------------

test('G5 evidenceLinks: top-level links win', { skip }, () => {
  const frame = { type: 'show_frame', links: ['a', 'b'], params: { links: ['c', 'd'] } };
  assert.deepEqual(mod.evidenceLinks(frame), ['a', 'b']);
});

test('G6 evidenceLinks: params.links is the fallback', { skip }, () => {
  const frame = { type: 'show_frame', params: { links: ['c', 'd'] } };
  assert.deepEqual(mod.evidenceLinks(frame), ['c', 'd']);
});

test('G7 evidenceLinks: neither → []', { skip }, () => {
  assert.deepEqual(mod.evidenceLinks({ type: 'show_frame', params: {} }), []);
});

test('G7b evidenceLinks: non-array params.links → [] (shape defence)', { skip }, () => {
  assert.deepEqual(mod.evidenceLinks({ type: 'show_frame', params: { links: 'x' } }), []);
});

// --- clampBursts / clampStagger -------------------------------------------

test('G8 clampBursts(undefined) → 5 (documented default)', { skip }, () => {
  assert.equal(mod.clampBursts(undefined), 5);
});

test('G9 clampBursts(1000) → 8 (internal performance cap)', { skip }, () => {
  // Without the cap this is 1000 → 12000 particles, dropping the frame rate.
  assert.equal(mod.clampBursts(1000), 8);
});

test('G9b clampStagger default / floor / ceiling', { skip }, () => {
  assert.equal(mod.clampStagger(undefined), 90);
  assert.equal(mod.clampStagger(-5), 0);
  assert.equal(mod.clampStagger(9999), 400);
});

test('G10 clampBursts(3) → 3 (no cap under the limit)', { skip }, () => {
  assert.equal(mod.clampBursts(3), 3);
});

// --- spotlightDim / lightsOutDim ------------------------------------------

test('G11 spotlightDim(undefined) → 0.15 (frozen default)', { skip }, () => {
  assert.equal(mod.spotlightDim(undefined), 0.15);
});

test('G12 spotlightDim(0.4) → 0.4 (param honoured)', { skip }, () => {
  assert.equal(mod.spotlightDim(0.4), 0.4);
});

test('G13 lightsOutDim(undefined) → 0.08 (frozen default)', { skip }, () => {
  assert.equal(mod.lightsOutDim(undefined), 0.08);
});

test('G13b dim falls back on null too (typeof, not ??)', { skip }, () => {
  assert.equal(mod.spotlightDim(null), 0.15);
  assert.equal(mod.lightsOutDim(null), 0.08);
});

// --- zoomOf ----------------------------------------------------------------

test('G14 zoomOf({zoom:1.35}) → 1.35', { skip }, () => {
  assert.equal(mod.zoomOf({ zoom: 1.35 }), 1.35);
});

test('G15 zoomOf({}) → undefined (flyTo must keep current z)', { skip }, () => {
  // Regression lock: `params.zoom ?? 1` would return 1 here and snap the
  // camera to an extreme.
  assert.equal(mod.zoomOf({}), undefined);
});

// --- inkToneOf -------------------------------------------------------------

test('G16 inkToneOf({tone:"rust"}) → "rust"', { skip }, () => {
  assert.equal(mod.inkToneOf({ tone: 'rust' }), 'rust');
});

test('G17 inkToneOf({tone:"purple"}) → undefined (out-of-enum)', { skip }, () => {
  assert.equal(mod.inkToneOf({ tone: 'purple' }), undefined);
});

// --- ruleKeyOf -------------------------------------------------------------

test('G18 ruleKeyOf groups the two dimmers, isolates the rest', { skip }, () => {
  assert.equal(mod.ruleKeyOf('spotlight'), 'dim');
  assert.equal(mod.ruleKeyOf('lights_out'), 'dim');
  assert.equal(mod.ruleKeyOf('ink_burst'), 'ink_burst');
});
