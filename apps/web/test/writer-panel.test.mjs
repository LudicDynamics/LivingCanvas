// The writer panel (作家栏) —：
//   「点击作家之后，它有很多那种浮窗…浮窗会遮挡住很多地方，可以考虑浮窗的移动问题，
//    或者自动自适应位置…还有作家面板，你点击 Textfield 之外的地方，它会直接把作家
//    面板取消掉」
// 1. lib/floating-layout.ts places the sheet in the free slot (pure geometry).
// 2. The sheet only closes on an explicit act; the draft survives a close.
// 3. The writer's own tools ride in the sheet instead of a second floating row.
// The browser half (real bounding boxes, outside clicks) is tools/e2e-writer-panel.mjs.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const L = await jiti.import('../src/lib/floating-layout.ts');
const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const fab = await readFile(new URL('../src/components/chrome/WriterFab.tsx', import.meta.url), 'utf8');
const hook = await readFile(new URL('../src/lib/use-floating-panel.ts', import.meta.url), 'utf8');

const SHEET = { w: 420, h: 150 };
const place = (viewport, anchor, obstacles, size = SHEET) =>
  L.placeFloating({ viewport, size, obstacles, slots: L.writerSheetSlots(viewport, anchor) });
const inside = (r, v) => r.x >= 0 && r.y >= 0 && r.x + r.w <= v.w && r.y + r.h <= v.h;

test('overlap and clamping are plain rectangle maths', () => {
  assert.equal(L.overlapArea({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 }), 25);
  assert.equal(L.overlapArea({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 }), 0);
  const c = L.clampToViewport({ x: -50, y: 900, w: 100, h: 100 }, { w: 400, h: 800 });
  assert.deepEqual([c.x, c.y], [8, 692]);
  // A remembered drag from a wider window comes back on screen.
  const r = L.restorePosition({ x: 1300, y: 20 }, SHEET, { w: 844, h: 390 });
  assert.ok(inside(r, { w: 844, h: 390 }));
  assert.equal(L.restorePosition(null, SHEET, { w: 844, h: 390 }), null);
});

test('desktop 1440×900: the sheet keeps its home straight above the writer button', () => {
  const v = { w: 1440, h: 900 };
  const button = { x: 1360, y: 820, w: 56, h: 56 };
  const p = place(v, button, [
    { ...button },
    { x: 1285, y: 828, w: 58, h: 48 },            // bag
    { x: 24, y: 820, w: 56, h: 56 },              // player orb
    { x: 1354, y: 155, w: 60, h: 402, soft: true }, // character rail
  ]);
  assert.equal(p.slot, 'above-button');
  assert.equal(p.hard, 0);
  assert.equal(p.soft, 0);
  assert.ok(p.y + p.h <= button.y, 'ends above the button');
});

test('1280×720: when above-the-button would cover the rail, a free slot wins', () => {
  const v = { w: 1280, h: 720 };
  const button = { x: 1200, y: 640, w: 56, h: 56 };
  const p = place(v, button, [
    { ...button },
    { x: 1125, y: 648, w: 58, h: 48 },
    { x: 24, y: 640, w: 56, h: 56 },
    { x: 1194, y: 155, w: 60, h: 402, soft: true },
  ], { w: 420, h: 165 });
  assert.equal(p.hard + p.soft, 0, `slot ${p.slot} still covers chrome`);
});

test('phone landscape 844×390: clear of the options strip, the rail, the bag and the orb', () => {
  const v = { w: 844, h: 390 };
  const button = { x: 682, y: 274, w: 56, h: 56 };
  const p = place(v, button, [
    { ...button },
    { x: 8, y: 96, w: 734, h: 70 },               // options strip
    { x: 664, y: 155, w: 60, h: 402, soft: true },
    { x: 595, y: 270, w: 58, h: 48 },
    { x: 24, y: 262, w: 56, h: 56 },
    { x: 22, y: 22, w: 96, h: 44 },
  ], { w: 420, h: 102 });
  assert.equal(p.hard, 0);
  assert.equal(p.soft, 0);
  assert.ok(inside(p, v));
});

test('phone portrait 390×664: no hard overlap; only the scrollable rail may give way', () => {
  const v = { w: 390, h: 664 };
  const button = { x: 322, y: 596, w: 56, h: 56 };
  const p = place(v, button, [
    { ...button },
    { x: 258, y: 600, w: 44, h: 44 },
    { x: 16, y: 598, w: 46, h: 46 },
    { x: 8, y: 96, w: 121, h: 40 },
    { x: 274, y: 164, w: 98, h: 400, soft: true },
  ], { w: 366, h: 102 });
  assert.equal(p.hard, 0);
  assert.ok(inside(p, v));
});

test('hard chrome always outweighs soft chrome', () => {
  const v = { w: 600, h: 600 };
  const p = L.placeFloating({
    viewport: v,
    size: { w: 100, h: 100 },
    obstacles: [{ x: 0, y: 0, w: 120, h: 120 }, { x: 400, y: 400, w: 200, h: 200, soft: true }],
    slots: [
      { name: 'covers-hard', corner: 'top-left', x: 10, y: 10 },
      { name: 'covers-soft', corner: 'top-left', x: 450, y: 450 },
    ],
  });
  assert.equal(p.slot, 'covers-soft');
});

test('the secondary tools always fold into one ⋯ menu (the sheet is a compact popover, docs/ux/27 §8.3)', () => {
  assert.equal(L.isCompactViewport({ w: 1440, h: 900 }), false);
  assert.equal(L.isCompactViewport({ w: 844, h: 390 }), true);
  assert.equal(L.isCompactViewport({ w: 390, h: 664 }), true);
  assert.match(fab, /data-testid="writer-tools-toggle"/);
  assert.match(fab, /const showTools = Boolean\(tools\) && toolsOpen;/);
  assert.match(fab, /\{tools && \(\s*<button type="button" className="writer-fab__icon" data-testid="writer-tools-toggle"/);
});

test('a press outside closes the sheet only with an empty draft and no armed tool; sending or a slip closes it too', () => {
  // (「作家的框太大了」): a compact popover that gets out of the way; 2026-10-08 (「你点击 Textfield
  // 之外的地方，它会直接把作家面板取消掉」): a draft in progress keeps it open.
  assert.match(fab, /document\.addEventListener\('pointerdown', onDown, true\)/);
  assert.match(fab, /if \(!open \|\| holdOpen\) return;/);
  assert.match(fab, /if \(draftRef\.current\.trim\(\) !== ''\) return;/);
  assert.match(fab, /target\.closest\('\[role="dialog"\], \[role="menu"\], \[data-radial-menu\]'\)/);
  assert.match(fab, /if \(writing && !wasWriting\.current && open\) requestClose\(\);/);
  assert.match(fab, /onSlip\?\.\(slip\);\s*if \(open\) requestClose\(\);/);
  assert.match(app, /holdOpen=\{isGodHandOpen\}/);
  assert.doesNotMatch(fab, /keepOpenFor/);
  assert.match(fab, /data-testid="writer-sheet-close"[^>]*onClick=\{requestClose\}/);
  assert.match(fab, /key: 'writer-sheet'/); // Escape still reaches it
  // Closing the companion sheet ends the authoring attention with it, so no
  // orphaned God Hand stays armed — and nothing clears the draft.
  // One handler: the FAB and the message drawer's ⌄ both go through it.
  assert.match(app, /onOpenChange=\{onWriterOpenChange\}/);
  const change = app.slice(app.indexOf('const onWriterOpenChange = (next: boolean): void => {'), app.indexOf('const closeStream = (): void => {'));
  assert.match(change, /if \(!next\) \{\s*closeRadial\(\);\s*setAttention\('ambient'\);\s*setIsGodHandOpen\(false\);/);
  // Put away together: closing the writer also lowers a drawer opened on its own.
  assert.match(change, /if \(!next\) \{[\s\S]{0,260}setStreamSolo\(false\);/);
  assert.doesNotMatch(change, /setWriterDraft/);
  assert.match(app, /if \(companion\) setWriterSheetOpen\(attention === 'authoring'\);/);
});

test('the writer tools live in the sheet; the separate floating row is classic-only', () => {
  assert.match(app, /tools=\{\(\s*<div role="group" aria-label=\{t\("Authoring tools"\)\}>\s*<GodModeToolbar /);
  // a teammate's bag hand-off (opening the bag suspends the sheet) keeps the row hidden while the bag is open.
  assert.match(app, /\{attention === 'authoring' && !companion && !bagOpen && \(\s*<div className="prototype-authoring">/);
  // The tools are rendered once, inside the sheet.
  assert.equal((fab.match(/className="writer-fab__tools"/g) || []).length, 1);
});

test('the sheet is draggable by its head, remembered per session, with a reset', () => {
  assert.match(fab, /className="writer-fab__sheet-head" \{\.\.\.floating\.handleProps\}/);
  assert.match(fab, /data-testid="writer-sheet-reset"/);
  assert.match(hook, /window\.sessionStorage/);
  // the developer handbook: the drag loop writes the element directly, no React state, no layout reads.
  const loop = hook.slice(hook.indexOf('const move = (ev: PointerEvent) => {'), hook.indexOf('const up = () => {'));
  assert.doesNotMatch(loop, /set[A-Z]\w*\(|getBoundingClientRect|offset(Width|Height)/);
  assert.match(loop, /panel\.style\.left = /);
});

test('phone portrait with the options rail grip on the left edge: the sheet narrows to fit beside it', () => {
  const v = { w: 390, h: 664 };
  const button = { x: 322, y: 595, w: 56, h: 56 };
  const obstacles = [
    { ...button },
    { x: -244, y: 150, w: 288, h: 484 },          // options rail, 44px of it on screen
    { x: 278, y: 600, w: 44, h: 44 },
    { x: 16, y: 598, w: 46, h: 46 },
    { x: 101, y: 74, w: 273, h: 35 },
  ];
  const wide = L.placeFloating({ viewport: v, size: { w: 366, h: 102 }, obstacles, slots: L.writerSheetSlots(v, button) });
  assert.ok(wide.hard > 0, 'at full width every slot touches the rail');
  const fit = L.placeFloatingFit({ viewport: v, size: { w: 366, h: 102 }, obstacles, slots: L.writerSheetSlots(v, button) });
  assert.equal(fit.hard, 0);
  assert.ok(fit.w < 366 && fit.w >= 280);
  assert.ok(fit.x >= 44);
});
