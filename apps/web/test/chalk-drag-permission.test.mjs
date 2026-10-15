import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const canvasSource = await readFile(new URL('../src/components/canvas/Canvas.tsx', import.meta.url), 'utf8');
const toolbarSource = await readFile(new URL('../src/components/god/GodModeToolbar.tsx', import.meta.url), 'utf8');
const pointerdown = canvasSource.slice(canvasSource.indexOf('const handlePointerDown'));
const interactiveGuard = pointerdown.indexOf("target.closest('button, a, input, select, textarea, [data-no-drag]')");
const chalkGuard = pointerdown.indexOf("item?.kind !== 'chalk' || allowChalkDrag");
const blankPan = pointerdown.indexOf('// Blank viewport → pan + pinch');

test('locked Chalk falls through to viewport pan instead of card drag', () => {
  assert.ok(interactiveGuard >= 0, 'interactive-child guard must remain in the dispatcher');
  assert.ok(chalkGuard > interactiveGuard, 'Chalk permission must run after interactive-child guard');
  assert.ok(blankPan > chalkGuard, 'locked Chalk must reach the existing blank-viewport pan branch');
  const chalkBranch = pointerdown.slice(chalkGuard, blankPan);
  assert.match(chalkBranch, /cardDragRef\.current\s*=\s*\{/);
  assert.doesNotMatch(chalkBranch, /allowChalkDrag[\s\S]*?\}\s*\n\s*e\.preventDefault\(\)/,
    'the lock must not preventDefault before pan can start');
});

test('God Chalk toggle is an accessible independent control', () => {
  assert.match(canvasSource, /allowChalkDrag\?: boolean/);
  assert.match(toolbarSource, /aria-pressed=\{allowChalkDrag\}/);
  assert.match(toolbarSource, /onToggleChalkDrag/);
});
