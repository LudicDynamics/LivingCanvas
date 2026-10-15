// Map-first worlds: a world declares the view it opens in
// (`world.json` `view.default`), chosen in the workshop. Entering a world applies
// it; a player's switch inside that world is remembered for that world only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const read = (p) => readFile(new URL(p, import.meta.url), 'utf8');

function withStorage(fn) {
  const saved = new Map();
  const events = [];
  const previous = { localStorage: globalThis.localStorage, window: globalThis.window, CustomEvent: globalThis.CustomEvent };
  globalThis.localStorage = { getItem: (k) => saved.get(k) ?? null, setItem: (k, v) => saved.set(k, String(v)) };
  globalThis.CustomEvent ??= class CustomEvent extends Event { constructor(type, init) { super(type); this.detail = init?.detail; } };
  globalThis.window = { dispatchEvent: (e) => events.push(e.detail), addEventListener() {}, removeEventListener() {} };
  return Promise.resolve(fn(saved, events)).finally(() => Object.assign(globalThis, previous));
}

test('a world opens in its own default view; without one, the canvas', () => withStorage(async (saved, events) => {
  const view = await jiti.import('../src/lib/view-mode.ts');
  assert.equal(view.worldDefaultViewOf({ view: { default: 'map' } }), 'map');
  assert.equal(view.worldDefaultViewOf({ view: { default: 'globe' } }), 'canvas', 'unknown values fall back');
  assert.equal(view.worldDefaultViewOf({}), 'canvas', 'every world written before the field');
  assert.equal(view.worldDefaultViewOf(null), 'canvas');

  assert.equal(view.enterWorldView('last-train', 'map'), 'map');
  assert.equal(view.readViewMode(), 'map', 'the current view follows the world');
  assert.equal(events.at(-1), 'map', 'consumers (the camera loop) are woken');
  assert.equal(saved.has(view.worldViewKey('last-train')), false, 'entering is not an override');

  assert.equal(view.enterWorldView('first-snow', 'canvas'), 'canvas', 'an open world goes back to the canvas');
}));

test('a player switch inside a world is remembered for that world only', () => withStorage(async (saved) => {
  const view = await jiti.import('../src/lib/view-mode.ts');
  view.enterWorldView('guixiang', 'map');
  view.setViewMode('canvas');
  assert.equal(saved.get(view.worldViewKey('guixiang')), 'canvas');
  view.enterWorldView('wuwu', 'map');
  assert.equal(view.readViewMode(), 'map', 'another map-first world still opens on the map');
  assert.equal(view.enterWorldView('guixiang', 'map'), 'canvas', 'coming back, the player keeps their choice');
  view.enterWorldView(null);
  view.setViewMode('map');
  assert.equal(saved.get(view.worldViewKey('guixiang')), 'canvas', 'outside a world nothing is written per world');
}));

test('the app applies the world view on entry; the workshop form lets the author pick it', async () => {
  const app = await read('../src/App.tsx');
  assert.match(app, /const worldView = worldDefaultViewOf\(manifest\);/);
  assert.match(app, /enterWorldView\(manifest\?\.id \?\? null, worldView\);/);
  const dialog = await read('../src/components/CreateWorldDialog.tsx');
  assert.match(dialog, /t\('Opens in'\)/);
  assert.match(dialog, /const view = viewPicked \?\? suggestedViewOf\(theme\);/);
  assert.match(dialog, /theme: themeRequestOf\(theme\),\n\s*view,/);
  const messages = JSON.parse(await read('../src/lib/messages.json'));
  for (const key of ['Opens in', 'Map', 'Canvas', 'Players start on the map of each place; they can switch to the canvas.', 'Players start on the canvas; they can switch to the map.']) {
    assert.ok(messages[key]?.['zh-CN'] && messages[key]?.ja, `${key}: zh-CN and ja`);
  }
});

test('the form suggests the map for a world with endings, the canvas for a sandbox', async () => {
  const theme = await jiti.import('../src/lib/world-theme.ts');
  const trpg = theme.themeDraftFor('trpg');
  assert.equal(theme.suggestedViewOf({ ...trpg, structure: { ...trpg.structure, endings: true } }), 'map');
  assert.equal(theme.suggestedViewOf({ ...trpg, structure: { ...trpg.structure, endings: false, clock: false } }), 'canvas');
});

test('the official TRPG families with maps open on the map, in every language', async () => {
  const templates = new URL('../../../templates/', import.meta.url);
  // 归乡 is not in the open-source copy: the families here are checked.
  const here = new Set(await readdir(templates));
  for (const family of ['last-train', 'wuwu', 'guixiang'].filter((f) => here.has(f))) {
    for (const id of [family, `${family}-jp`, `${family}-zh`]) {
      const manifest = JSON.parse(await readFile(new URL(`${id}/world.json`, templates), 'utf8'));
      assert.deepEqual(manifest.view, { default: 'map' }, id);
    }
  }
  // Open worlds keep the canvas: no field at all.
  for (const id of (await readdir(templates)).filter((d) => /^(first-snow|moonlit-contract|magic-academy|divergence|unwritten-door)/.test(d))) {
    const manifest = JSON.parse(await readFile(new URL(`${id}/world.json`, templates), 'utf8'));
    assert.equal(manifest.view, undefined, id);
  }
});
