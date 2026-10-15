// Player sticky notes + clue board, web side.
// Pure gesture helpers through jiti; Canvas / App wiring as source contracts;
// the end-to-end long-press runs in the Playwright pass (scratchpad screenshots).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const gestures = await jiti.import('../src/lib/player-board-gestures.ts');
const src = (p) => readFile(new URL(`../src/${p}`, import.meta.url), 'utf8');
const [canvas, app, world, linkLayer, objectSrc, renderer, clue] = await Promise.all([
  src('components/canvas/Canvas.tsx'),
  src('App.tsx'),
  src('state/useWorld.ts'),
  src('components/canvas/LinkLayer.tsx'),
  src('components/canvas/CanvasObject.tsx'),
  src('components/canvas/CardRenderer.tsx'),
  src('components/canvas/ClueBoard.tsx'),
]);

/** A minimal element whose `closest` answers from a selector → dataset table. */
function el(hits) {
  return {
    closest(selector) {
      for (const [sel, dataset] of Object.entries(hits)) if (selector.includes(sel)) return { dataset };
      return null;
    },
  };
}

test('boardEndpointAt: a card is its path, a character avatar is characters/<id>, blank is null', () => {
  assert.equal(gestures.boardEndpointAt(el({ '.object[data-path]': { path: 'world/study/clock.md' } })), 'world/study/clock.md');
  assert.equal(gestures.boardEndpointAt(el({ '[data-presence-id]': { presenceId: 'butler' } })), 'characters/butler');
  assert.equal(gestures.boardEndpointAt(el({})), null);
  assert.equal(gestures.boardEndpointAt(null), null);
});

test('shortcuts stay quiet while typing; long-press threshold is a real hold', () => {
  assert.equal(gestures.isTypingTarget(el({ 'textarea': {} })), true);
  assert.equal(gestures.isTypingTarget(el({})), false);
  assert.ok(gestures.LONG_PRESS_MS >= 450 && gestures.LONG_PRESS_MS <= 800);
  assert.equal(gestures.NOTE_KEY, 'n');
});

test('Canvas: touch long-press on blank canvas calls onLongPress and is cancelled by movement / release / pinch', () => {
  assert.match(canvas, /e\.pointerType === 'touch' && onLongPress/);
  assert.match(canvas, /window\.setTimeout\([\s\S]*?onLongPress\(sx, sy, world\.x, world\.y\)[\s\S]*?LONG_PRESS_MS\)/);
  assert.match(canvas, /pastTapThreshold\(lp\.sx, lp\.sy, e\.clientX, e\.clientY\)\) cancelLongPress\(\)/);
  assert.match(canvas, /const handlePointerEnd = \(e: React\.PointerEvent\) => \{\n    cancelLongPress\(\);/);
  assert.match(canvas, /const handlePointerCancel = \(e: React\.PointerEvent\) => \{\n    cancelLongPress\(\);/);
  assert.match(canvas, /pointersRef\.current\.size === 0/);
});

test('Canvas: board mode turns a card drag into a line and a tap into a pick, and swallows the card click', () => {
  assert.match(canvas, /if \(boardMode && /);
  assert.match(canvas, /onBoardLink\?\.\(b\.from, to, e\.clientX, e\.clientY\)/);
  assert.match(canvas, /onBoardPick\?\.\(b\.from, e\.clientX, e\.clientY\)/);
  assert.match(canvas, /onClickCapture=\{boardMode \?/);
  assert.match(canvas, /playerTag=\{playerTags\?\.get\(item\.path\)\}/);
});

test('App: right-click / long-press open the radial (canvas-radial.test.mjs); board only on the world canvas, in play', () => {
  assert.match(app, /onOpenRadialMenu=\{openRadial\}/);
  assert.match(app, /const boardCanvas = Boolean\(state\) && !nookChar && !loadingWorld && viewMode !== 'map';/);
  assert.match(app, /enabled: boardCanvas && attention !== 'authoring'/);
  assert.match(app, /links=\{canvasLinks\}/);
  assert.match(app, /\.\.\.\(state\?\.links \|\| \[\]\), \.\.\.playerBoard\.links/);
});

test('frames and rendering: player_board relayed, clue lines drawn with labels, stickies have their own face', () => {
  assert.match(world, /case 'player_board':\s*\n[\s\S]*?airp:player-board/);
  assert.match(linkLayer, /clue: '#b3261e'/);
  assert.match(linkLayer, /classList\.add\('clue-label'\)/);
  assert.match(linkLayer, /data-presence-id/);
  assert.match(renderer, /if \(isPlayerNoteItem\(item\)\) \{\s*return <StickyNote item=\{item\} \/>;/);
  assert.match(objectSrc, /const readable = kind !== 'sprite' && !isGate && !isDoor && !isSticky;/);
  assert.match(clue, /key === NOTE_KEY/);
  assert.match(clue, /key === BOARD_KEY/);
});
