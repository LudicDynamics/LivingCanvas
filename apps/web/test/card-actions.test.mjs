// A card's big action buttons:
// the tiny side arrows became a pill that shows after a short dwell, a focus
// view opens on click / tap, the map's pins got real hit areas, and the forced
// tutorial points at the button itself. The buttons only trigger the handlers
// that already existed — no game logic moved.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const lib = await jiti.import('../src/lib/card-actions.ts');
const tutorial = await jiti.import('../src/lib/forced-tutorial.ts');
const src = rel => readFile(new URL(rel, import.meta.url), 'utf8');
const [entity, object, bar, css, dialog, map, boardCss, shell, messages, indexCss] = await Promise.all([
  src('../src/components/narrative/EntityInteractions.tsx'),
  src('../src/components/canvas/CanvasObject.tsx'),
  src('../src/components/canvas/CardActionBar.tsx'),
  src('../src/components/canvas/card-actions.css'),
  src('../src/components/BagItemDialog.tsx'),
  src('../src/components/board/PictureMap.tsx'),
  src('../src/components/board/board.css'),
  src('../src/scene-shell.css'),
  src('../src/lib/messages.json').then(JSON.parse),
  src('../src/index.css'),
]);

test('each card offers only the actions valid for it, in a fixed order', () => {
  const wired = { canOpen: true, canEnter: true, canTalk: true };
  assert.deepEqual(lib.cardPrimaryActions({ path: 'world/badge.md', frontmatter: { title: 'Badge' } }, wired), ['open', 'take']);
  assert.deepEqual(lib.cardPrimaryActions({ path: 'world/hall/README.md', frontmatter: { type: 'gate' } }, wired), ['open', 'enter']);
  assert.deepEqual(lib.cardPrimaryActions({ path: 'world/door.md', frontmatter: { visual: 'door' } }, wired), ['open', 'enter']);
  assert.deepEqual(lib.cardPrimaryActions({ path: 'world/clerk.md', frontmatter: { type: 'npc' } }, wired), ['open', 'converse']);
  assert.deepEqual(lib.cardPrimaryActions({ path: 'world/vera.md', frontmatter: { type: 'character' } }, wired), ['open', 'talk']);
  // Not portable, chalk, outside world/: nothing to pocket.
  assert.deepEqual(lib.cardPrimaryActions({ path: 'world/anvil.md', frontmatter: { portable: false } }, wired), ['open']);
  assert.deepEqual(lib.cardPrimaryActions({ path: 'world/search-1.md', frontmatter: { type: 'chalk' } }, wired), ['open']);
  assert.deepEqual(lib.cardPrimaryActions({ path: 'player/badge.md', frontmatter: {} }, wired), ['open']);
  // A handler the owner did not wire is never offered.
  assert.deepEqual(lib.cardPrimaryActions({ path: 'world/hall/README.md', frontmatter: { type: 'gate' } }, {}), []);
});

test('the take rule is the one the tutorial and the side panel always used', () => {
  for (const item of [
    { path: 'world/badge.md', frontmatter: {} },
    { path: 'world/hall/README.md', frontmatter: { type: 'gate' } },
    { path: 'world/anvil.md', frontmatter: { portable: false } },
    { path: 'world/note.md', frontmatter: { type: 'chalk' } },
  ]) {
    const takeable = lib.isCollectable(item);
    const places = tutorial.tutorialPlaces([{ path: 'world/x/README.md', kind: 'gate', frontmatter: { type: 'gate', requires: { items: ['player/zzz.md'] } } }, item], new Set());
    assert.equal(places.lockItemPath === item.path, takeable, item.path);
  }
  // The panel keeps its own reading and filters with it.
  assert.match(entity, /const collectable = !isGate && !isDoor && !isPerson && !isNpc && fm\?\.type !== 'chalk'/);
  assert.match(entity, /id !== 'take' \|\| collectable/);
});

test('the lift grows a small card to a readable size, never shrinks it, never balloons', () => {
  assert.equal(lib.cardLiftScale(150), 1.8);
  assert.equal(lib.cardLiftScale(200), 1.5);
  assert.equal(lib.cardLiftScale(600), 1.04);
  assert.equal(lib.cardLiftScale(0), 1);
  assert.equal(lib.CARD_DWELL_MS, 300);
  assert.ok(lib.CARD_GRACE_MS >= 150 && lib.CARD_GRACE_MS <= 400);
});

test('the pill sits above the card, flips when there is no room, and stays on screen', () => {
  const vp = { width: 1440, height: 900 };
  const pill = { width: 220, height: 56 };
  const mid = lib.pillPosition({ left: 600, top: 400, width: 200, height: 260 }, pill, vp);
  assert.equal(mid.side, 'above');
  assert.equal(mid.top, 400 - lib.CARD_PILL_GAP - 56);
  assert.equal(mid.left, 600 + 100 - 110);
  const top = lib.pillPosition({ left: 600, top: 20, width: 200, height: 260 }, pill, vp);
  assert.equal(top.side, 'below');
  // A place prefers below (its detail sheet hangs above it).
  assert.equal(lib.pillPosition({ left: 600, top: 400, width: 200, height: 200 }, pill, vp, 'below').side, 'below');
  const edge = lib.pillPosition({ left: -80, top: 400, width: 100, height: 100 }, pill, vp);
  assert.equal(edge.left, lib.CARD_PILL_MARGIN);
  const phone = lib.pillPosition({ left: 300, top: 300, width: 120, height: 160 }, pill, { width: 390, height: 844 });
  assert.ok(phone.left + pill.width <= 390 - lib.CARD_PILL_MARGIN);
});

test('buttons are big, readable and carry the tutorial hooks', () => {
  assert.match(css, /\.card-actions__btn \{[^}]*min-height: 44px/);
  assert.match(css, /\.card-actions__btn \{[^}]*font: 500 17px/);
  assert.match(bar, /data-card-action=\{action\.id\}/);
  assert.match(bar, /data-card-path=\{path\}/);
  assert.match(bar, /data-tutorial-locked=\{action\.locked \? 'true' : undefined\}/);
  // Ported out of the camera transform, so zoom and the map projection never shrink it.
  assert.match(bar, /createPortal\(bar, document\.body\)/);
  // A press on the pill never pans the canvas or starts a card drag.
  assert.match(bar, /onPointerDown=\{event => event\.stopPropagation\(\)\}/);
  // Reduced motion: still lifted, just not animated.
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*transition: none/);
  // Stacking goes through the depth registry.
  assert.match(css, /z-index: var\(--depth-card-actions\)/);
  assert.match(css, /z-index: var\(--depth-card-focus\)/);
  assert.match(indexCss, /--depth-card-actions: calc\(var\(--depth-writer\) \+ 7\)/);
  assert.match(indexCss, /--depth-card-focus: calc\(var\(--depth-writer\) \+ 11\)/);
});

test('the pill only triggers the handlers that already existed', () => {
  assert.match(entity, /const take = \(\) => void runAction\(\s*'take',\s*item\.path/);
  assert.match(entity, /const enter = \(\) => onEnterGate\?\.\(/);
  assert.match(entity, /converse: \(\) => requestNpcTalk\(/);
  assert.match(entity, /const talk = \(\) => onOpenCharacter\?\.\(/);
  assert.doesNotMatch(entity, /airpGateway\./);
  // Every label is a literal key, so the i18n gate checks it.
  for (const key of ['Open card', 'Take along', 'Enter place', 'Converse', 'Talk with this person', 'Card actions']) {
    assert.match(entity, new RegExp(`t\\('${key}'\\)`), key);
    assert.ok(messages[key]?.['zh-CN'] && messages[key]?.ja, key);
  }
  assert.equal(messages['Take along']['zh-CN'], '收入随身');
  assert.equal(messages['Enter place']['zh-CN'], '进入地点');
  assert.equal(messages['Open card']['zh-CN'], '打开');
  // The old side-arrow labels left with the arrows.
  for (const gone of ['→ Take along', '→ Enter scene', '→ Talk', '→ Converse', 'Go in']) assert.equal(messages[gone], undefined, gone);
});

test('hover dwell, grace, keyboard focus and touch take their own paths', () => {
  assert.match(object, /dwellTimer\.current = window\.setTimeout\(raise, CARD_DWELL_MS\)/);
  assert.match(object, /if \(event\.pointerType === 'touch' \|\| reading\) return;/);
  assert.match(object, /onPointerLeave=\{event => \{[^}]*lower\(\);/);
  assert.match(object, /if \(!insidePill\.current\) setLifted\(false\)/);
  assert.match(object, /matches\(':focus-visible'\)\) raise\(\)/);
  assert.match(object, /event\.key === 'Escape' && lifted/);
  // The lift reads the card's rect once when it starts, never per move.
  assert.doesNotMatch(object, /onPointerMove/);
  assert.match(object, /data-card-lifted=\{lifted \? '' : undefined\}/);
});

test('click / tap opens the centred focus view with the same buttons; Esc, outside and back close it', () => {
  assert.match(object, /<BagItemDialog\s+focusView/);
  assert.match(object, /footer=\{<div ref=\{setFocusSlot\} className="card-focus__actions" \/>\}/);
  assert.match(object, /pillHost=\{reading \? focusSlot : null\}/);
  assert.match(object, /window\.history\.pushState\(\{ \.\.\.\(state \?\? \{\}\), airpCardFocus: true \}, ''\)/);
  // Escape closes the focus view before the docked character dialogue (priority 500).
  assert.match(dialog, /priority: focusView \? 505 : 340/);
  assert.match(object, /addEventListener\('popstate', onPop\)/);
  assert.match(dialog, /createPortal\(<div className="card-focus">\{sheet\}<\/div>, document\.body\)/);
  // Light, not a heavy modal: no aria-modal, no backdrop catching the page.
  assert.doesNotMatch(dialog, /aria-modal/);
  assert.match(css, /\.card-focus \{[^}]*pointer-events: none/);
  // Enter from the card closes the focus view first; double-click still enters.
  assert.match(object, /const enterFromCard = \(target: string\) => \{ setReading\(false\); dropLift\(\); requestEnter\(target\); \}/);
  assert.match(object, /if \(event\.detail < 2\) gateOpenTimer\.current = window\.setTimeout\(openFocus, 240\)/);
});

test('map pins have a 44px hit area, places sit above faces, and a tap shows the popover first', () => {
  assert.match(boardCss, /\.map-pin__icon \{[^}]*min-width: 44px;[^}]*min-height: 44px/);
  assert.match(boardCss, /\.map-pin--place \{ z-index: var\(--depth-entity-control\); \}/);
  assert.match(boardCss, /\.map-pin__actions button \{[^}]*min-height: 44px/);
  assert.match(map, /if \(pin\.kind === 'place' && lastPointer\.current !== 'mouse' && hover !== pin\.id\)/);
  assert.match(map, /data-card-action=\{hoverPin\.kind === 'place' \? 'enter' : undefined\}/);
  assert.match(map, /t\('Enter place'\)/);
});

test('a place has no hover detail sheet any more: the focus view shows its full text', async () => {
  const renderer = await src('../src/components/canvas/CardRenderer.tsx');
  const decoration = await src('../src/decoration.css');
  for (const text of [renderer, indexCss, decoration]) assert.doesNotMatch(text, /gate__detail/);
});

test('touch devices do not render the left tool rail (it used to swallow taps meant for cards)', () => {
  assert.match(shell, /@media \(hover: none\) \{ \.prototype-tools \{ display: none; \} \}/);
});

test('the tutorial points at the big button once it shows and lets it be pressed', () => {
  const take = { ...tutorial.INITIAL_TUTORIAL, step: 'take', takeItem: 'world/badge.md' };
  assert.equal(tutorial.tutorialTargets(take)[0], '[data-card-action="take"][data-card-path="world/badge.md"]');
  const enter = { ...tutorial.INITIAL_TUTORIAL, step: 'enter', startLayer: 'world' };
  assert.equal(tutorial.tutorialTargets(enter)[0], '[data-card-action="enter"]:not([data-tutorial-locked="true"])');
  for (const step of ['take', 'enter']) assert.match(tutorial.tutorialAllowed(step), /\.card-actions/);
  assert.match(tutorial.tutorialAllowed('enter'), /\.map-pin__panel/);
});
