// Player / world / character panels.
//
// No HUD: declared states surface only as prose, on demand — the player panel
// from the avatar orb, the world panel as a hover under the clock badge or the
// world title. These pin the pure helpers and where the panels are mounted.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { EMPTY_PANELS, HOVER_CLOSE_MS, endingKind, normalizePanels, worldHoverAnchor } = await jiti.import('../src/lib/panels.ts');

const src = (p) => readFile(new URL(p, import.meta.url), 'utf8');
const app = await src('../src/App.tsx');
const closedRun = await src('../src/components/chrome/ClosedRun.tsx');
const panels = await src('../src/components/chrome/StatePanels.tsx');
const modal = await src('../src/components/overlay/CharacterModal.tsx');
const css = await src('../src/components/chrome/state-panels.css');

test('normalizePanels is fail-soft: garbage reads as nothing to say', () => {
  assert.deepEqual(normalizePanels(null), EMPTY_PANELS);
  assert.deepEqual(normalizePanels({ player: { states: 'x' }, world: { mode: 'weird' } }), EMPTY_PANELS);
});

test('normalizePanels keeps prose lines only and clamps places', () => {
  const out = normalizePanels({
    player: { states: [{ id: 'hp', label: '伤势', text: '受了伤' }, { id: 'bad', text: '' }, { nope: 1 }] },
    world: { name: '末班车', mode: 'closed', states: [{ id: 'alarm', label: '警戒', text: '四下安静' }], places: { visited: 9, total: 5 } },
    characters: { vera: [{ id: 'trust', label: '信任', text: '她开始信你了' }], empty: [] },
  });
  assert.deepEqual(out.player.states, [{ id: 'hp', label: '伤势', text: '受了伤' }]);
  assert.equal(out.world.mode, 'closed');
  assert.deepEqual(out.world.places, { visited: 5, total: 5 });
  assert.deepEqual(Object.keys(out.characters), ['vera']);
  assert.equal(normalizePanels({ world: { places: { visited: 0, total: 0 } } }).world.places, null);
});

test('the ending line never spoils: clock / key moment / none', () => {
  assert.equal(endingKind('closed', true), 'clock');
  assert.equal(endingKind('closed', false), 'moment');
  assert.equal(endingKind('semi', false), 'moment');
  assert.equal(endingKind('semi', true), 'moment');
  assert.equal(endingKind('open', false), null);
});

test('the world hover hangs on the clock while it shows, else on the world title', () => {
  const clock = { label: 'x', left: 3, start: 6 };
  assert.equal(worldHoverAnchor({ mode: 'closed', clock, ending: null }), 'clock');
  assert.equal(worldHoverAnchor({ mode: 'closed', clock, ending: { id: 'e' } }), 'title');
  assert.equal(worldHoverAnchor({ mode: 'semi', clock: null, ending: null }), 'title');
  assert.equal(worldHoverAnchor({ mode: 'open', clock: null, ending: null }), 'title');
});

test('the hover close delay matches PictureMap (250ms)', () => {
  assert.equal(HOVER_CLOSE_MS, 250);
});

test('App mounts the panels: player from the orb, world on the title or clock, states into the character modal', () => {
  assert.match(app, /useWorldPanels\(/);
  assert.match(app, /<PlayerPanel[\s\S]*?open=\{profileOpen && chromeVisible && !nookChar\}[\s\S]*?states=\{worldPanels\.player\.states\}/);
  assert.match(app, /worldHoverAnchor\(closedRun\) === 'title'[\s\S]*?<HoverPanel className="world-title-hover"/);
  assert.match(app, /worldPanel=\{\(clockLine\) => <WorldPanelBody/);
  assert.match(app, /states=\{worldPanels\.characters\[activeCharacter\.id\]\}/);
  assert.match(closedRun, /<HoverPanel className="closed-clock-hover"/);
  assert.match(modal, /<StateLines states=\{states\}/);
});

test('panels are closed until asked, and a mouse can cross into the hover', () => {
  assert.match(panels, /if \(!open\) return null;/);
  assert.match(panels, /onPointerLeave=\{\(e\) => \{ if \(e\.pointerType === 'mouse'\) hideSoon\(\); \}\}/);
  assert.match(panels, /'pointerdown', onPointerDown, true/);
  assert.match(css, /z-index: var\(--depth-chrome-world-panel\)/);
  assert.doesNotMatch(css, /z-index:\s*\d/);
});
