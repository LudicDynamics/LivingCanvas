// Ghost pure-function assertions. `lib/ghost.ts` has no DOM
// and no React, so jiti can import the TS source directly — same bootstrap as
// audio-engine.test.mjs. Run: node --test apps/web/test/ghost.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';

let ghost = null;
try {
  const { createJiti } = await import('../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs');
  const jiti = createJiti(import.meta.url, { moduleCache: false, tryNative: true });
  ghost = await jiti.import('../src/lib/ghost.ts');
} catch (err) {
  console.error('jiti/bootstrap unavailable, skipping ghost group:', err?.message ?? err);
}

const skip = ghost ? false : 'jiti or pi-rp submodule unavailable';
const { ghostSizeFor, stageText, ghostVisibleOn, asNum } = ghost ?? {};
const GHOST_W = 320;
const GHOST_H_MIN = 180;
const GHOST_H_MAX = 420;
// NOTE on GHOST_W: the frozen `ghostSizeFor` keeps the requested width (with an
// 80px floor) and clamps the requested height into [GHOST_H_MIN, GHOST_H_MAX].
// The design table's "aspect-corrected, width=GHOST_W" wording does not match
// the shipped implementation; these tests assert the real contract.

test('G1 ghostSizeFor keeps a landscape request, clamping height to the band', { skip }, () => {
  const { w, h } = ghostSizeFor(1536, 1024);
  assert.equal(w, 1536);
  assert.equal(h, GHOST_H_MAX);
});

test('G1b ghostSizeFor floors a small height and fills the lower band', { skip }, () => {
  const { w, h } = ghostSizeFor(200, 90);
  assert.equal(w, 200);
  assert.equal(h, GHOST_H_MIN);
});

test('G2 ghostSizeFor clamps an extreme portrait and never yields <= 0', { skip }, () => {
  const { w, h } = ghostSizeFor(512, 2048);
  assert.equal(h, GHOST_H_MAX);
  assert.equal(w, 512);
  assert.ok(w >= 1 && h >= 1, 'no zero/negative box');
});

test('G3 ghostSizeFor tolerates missing/garbage size without throwing', { skip }, () => {
  // `undefined`/NaN are "absent" -> default width; default height = 0.75 * W.
  assert.deepEqual(ghostSizeFor(undefined, undefined), { w: GHOST_W, h: 240 });
  assert.deepEqual(ghostSizeFor(NaN, 10), { w: GHOST_W, h: GHOST_H_MIN });
  // `0` is a finite number, so it flows through the clamps without going negative.
  const zero = ghostSizeFor(0, 0);
  assert.ok(zero.w >= 1 && zero.h >= GHOST_H_MIN);
});

test('G4 ghostSizeFor is pure: equal inputs -> equal, fresh object', { skip }, () => {
  const a = ghostSizeFor(1536, 1024);
  const b = ghostSizeFor(1536, 1024);
  assert.deepEqual(a, b);
  assert.notEqual(a, b, 'must return a new object, not a shared reference');
});

test('G5 stageText surfaces the heartbeat seconds (non-emptiness)', { skip }, () => {
  // Without this line a stalled generation is an unreadable still skeleton.
  assert.match(stageText('generating', 20000), /20/);
  assert.match(stageText('generating', 3050), /3/);
});

test('G6 stageText omits seconds when elapsedMs is absent', { skip }, () => {
  assert.doesNotMatch(stageText('resolving', undefined), /\d+s/);
});

test('G7 stageText treats elapsedMs:0 as a live zero, not "missing"', { skip }, () => {
  // The guard MUST be `typeof === 'number'`: `if (elapsedMs)` would drop the 0.
  assert.match(stageText(undefined, 0), /0s/);
});

test('G8 ghostVisibleOn filters by layer, tolerating an absent layer', { skip }, () => {
  assert.equal(ghostVisibleOn(undefined, 'world/x'), true);
  assert.equal(ghostVisibleOn('world/x', 'world/x'), true);
  assert.equal(ghostVisibleOn('world/y', 'world/x'), false);
});

test('G9 asNum guards untrusted frame fields, keeps a valid zero', { skip }, () => {
  assert.equal(asNum(NaN), undefined);
  assert.equal(asNum('12'), undefined);
  assert.equal(asNum(undefined), undefined);
  assert.equal(asNum(Infinity), undefined);
  assert.equal(asNum(0), 0);
  assert.equal(asNum(7), 7);
});

test('G10 dwell constants and the ambient hint are the frozen ones', { skip }, () => {
  assert.equal(ghost.GHOST_WAIT_AMBIENT, 'rain'); // bare name -> synth bed
  assert.equal(ghost.LANDED_DWELL_MS, 15000);
  assert.equal(ghost.REUSED_DWELL_MS, 5000);
  assert.ok(ghost.REUSED_DWELL_MS < ghost.LANDED_DWELL_MS);
});

test('a failed image of either source hands the sound bed back (useWorld tool_end)', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../src/state/useWorld.ts', import.meta.url), 'utf8');
  const block = src.slice(src.indexOf("case 'tool_end': {"), src.indexOf("case 'character_delta':"));
  assert.match(block, /msg\.source === 'character' && msg\.toolName === 'generate_image'/);
  assert.match(block, /msg\.source === 'writer' \|\| imageFailed[\s\S]*setAmbient\(stateRef\.current\?\.audio\.ambient/);
});
