import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false, tryNative: true });
const {
  DEFAULT_PORTRAIT_BOUNDS,
  clampPortraitAnchor,
  defaultPortraitAnchor,
  isPortraitAnchor,
  portraitBounds,
  portraitStorageKey,
} = await jiti.import('../src/lib/nook-portrait.ts');

const portrait = await readFile(new URL('../src/components/nook/NookPortrait.tsx', import.meta.url), 'utf8');
const styles = await readFile(new URL('../src/components/nook/nook-character-media.css', import.meta.url), 'utf8');
const view = await readFile(new URL('../src/components/nook/NookView.tsx', import.meta.url), 'utf8');

test('portrait bounds keep the whole footprint on screen at narrow widths', () => {
  // 176×236 portrait on a 390×844 stage: the centre may not come closer than
  // half a footprint to any edge, or the layer overflows (the pre-fix bug let
  // the right edge reach 415px on a 390px viewport).
  const bounds = portraitBounds({ width: 176, height: 236 }, { width: 390, height: 844 });
  const halfW = 176 / 2 / 390;
  assert.ok(Math.abs(bounds.minX - halfW) < 1e-9);
  assert.ok(Math.abs(bounds.maxX - (1 - halfW)) < 1e-9);
  const clamped = clampPortraitAnchor({ x: 0.92, y: 0.5 }, bounds);
  // Centre * stage ± half a footprint must stay inside the stage.
  assert.ok(clamped.x * 390 + 88 <= 390 + 1e-9, 'right edge stays on screen');
  assert.ok(clamped.x * 390 - 88 >= -1e-9, 'left edge stays on screen');
});

test('an unmeasurable stage falls back to the fixed safe bounds', () => {
  assert.deepEqual(portraitBounds(null, { width: 390, height: 844 }), DEFAULT_PORTRAIT_BOUNDS);
  assert.deepEqual(portraitBounds({ width: 176, height: 236 }, { width: 0, height: 0 }), DEFAULT_PORTRAIT_BOUNDS);
  // A footprint wider than its stage cannot satisfy the edge rule; centre it.
  assert.deepEqual(portraitBounds({ width: 800, height: 200 }, { width: 100, height: 100 }), DEFAULT_PORTRAIT_BOUNDS);
});

test('the clamp is the single rule for every input path', () => {
  const bounds = { minX: 0.1, maxX: 0.9, minY: 0.2, maxY: 0.8 };
  assert.deepEqual(clampPortraitAnchor({ x: -5, y: 99 }, bounds), { x: 0.1, y: 0.8 });
  assert.deepEqual(clampPortraitAnchor({ x: 0.5, y: 0.5 }, bounds), { x: 0.5, y: 0.5 });
  assert.deepEqual(clampPortraitAnchor({ x: 5, y: -5 }), { x: DEFAULT_PORTRAIT_BOUNDS.maxX, y: DEFAULT_PORTRAIT_BOUNDS.minY });
});

test('portrait memory is isolated by active world and character identity', () => {
  assert.equal(portraitStorageKey('wuwu', 'vera'), 'airp:nook-portrait:v1:wuwu:vera');
  assert.notEqual(portraitStorageKey('wuwu', 'vera'), portraitStorageKey('exp', 'vera'));
  assert.notEqual(portraitStorageKey('wuwu', 'vera'), portraitStorageKey('wuwu', 'elias'));
  assert.ok(isPortraitAnchor({ x: 0.5, y: 0.5 }));
  assert.ok(!isPortraitAnchor({ x: '0.5', y: 0.5 }));
  assert.ok(!isPortraitAnchor({ x: Number.NaN, y: 0.5 }));
  assert.ok(!isPortraitAnchor(null));
});

test('default anchor is desktop-right, mobile-lower-centre', () => {
  assert.deepEqual(defaultPortraitAnchor(false), { x: 0.84, y: 0.5 });
  assert.deepEqual(defaultPortraitAnchor(true), { x: 0.5, y: 0.72 });
});

test('NookPortrait wires pointer, keyboard, cancel and stage measurement', () => {
  assert.match(portrait, /setPointerCapture/);
  assert.match(portrait, /onPointerMove/);
  assert.match(portrait, /onPointerCancel/);
  assert.match(portrait, /onLostPointerCapture/);
  for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) assert.match(portrait, new RegExp(key));
  assert.match(portrait, /event\.key === 'Home'/);
  assert.match(portrait, /event\.key === 'Escape'/);
  assert.match(portrait, /requestAnimationFrame/);
  // Drag maths must read the positioned stage's own rect, never parentElement
  // (display:contents reports 0×0 and silently broke dragging).
  assert.match(portrait, /root\.offsetParent\?\.getBoundingClientRect\(\)/);
  assert.doesNotMatch(portrait, /parentElement\?\.getBoundingClientRect/);
  // High-frequency pointermove must not enter React state (AGENTS §5).
  const pointerMove = portrait.slice(portrait.indexOf('updateFromPointer'), portrait.indexOf('onPointerDown'));
  assert.doesNotMatch(pointerMove, /setAnchor\(/);
});

test('NookPortrait exposes drag semantics and stays operable without media, the host supplies identity', () => {
  assert.match(styles, /pointer-events: auto/);
  assert.match(styles, /touch-action: none/);
  assert.match(styles, /data-nook-portrait-dragging/);
  assert.match(portrait, /fallback=\{fallback\}/);
  assert.match(portrait, /role=\{onActivate && !hidden \? 'button' : 'group'\}/);
  assert.match(portrait, /tabIndex=\{hidden \? -1 : 0\}/);
  assert.match(view, /<NookPortrait/);
  assert.match(view, /worldId=\{worldId\}/);
  assert.match(portrait, /className="nook-character-media__asset"/);
});

test('activating the portrait opens the dialogue, dragging it does not', () => {
  // The prop is both draggable and activatable. A press that stays inside the
  // shared card threshold is a click; beyond it, a drag that must NOT open the
  // overlay. One threshold keeps the canvas and the portrait consistent.
  assert.match(portrait, /movedBeyondCardThreshold/);
  assert.match(portrait, /import \{ movedBeyondCardThreshold \} from '\.\.\/\.\.\/lib\/card-interaction\.js'/);
  const pointerUp = portrait.slice(portrait.indexOf('const onPointerUp'), portrait.indexOf('const onPointerCancel'));
  assert.match(pointerUp, /possiblyActivate\(event\)/);
  // The activation must happen AFTER the drag commits, and only when unmoved.
  const activate = portrait.slice(portrait.indexOf('const possiblyActivate'), portrait.indexOf('const onPointerUp'));
  assert.match(activate, /movedBeyondCardThreshold\(start\.x, start\.y, event\.clientX, event\.clientY\)/);
  assert.match(activate, /onActivate\(\)/);
  // A cancel restores the anchor and clears the pending press, so a cancelled
  // drag can never be mistaken for a click.
  assert.match(portrait, /pointerStartRef\.current = null/);
  // Enter/Space must beat App's document-capture Enter (which focuses the
  // writer) — window capture, and only while the portrait itself has focus.
  assert.match(portrait, /window\.addEventListener\('keydown', onActivateKey, true\)/);
  assert.match(portrait, /document\.activeElement !== rootRef\.current/);
  assert.match(portrait, /event\.key !== 'Enter' && event\.key !== ' '/);
  // NookView wires the existing dialogue entry point, not a second one.
  assert.match(view, /onActivate=\{onOpenCharacterModal \? \(\) => handleOpenCharacterModal\(characterId\) : undefined\}/);
  assert.match(view, /translate\(locale, 'Talk to \{name\}', \{ name: displayName \}\)/);
});
