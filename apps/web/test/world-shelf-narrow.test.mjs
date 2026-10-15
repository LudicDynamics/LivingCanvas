// The 「选择世界」 shelf on phones (smoke test 2026-10-05): it opened by itself and covered most of the lobby,
// 「开始新游戏」 included. ≤ 520px it now starts collapsed; the 「存档」 pill toggles it; the choice is remembered.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const app = read('../src/App.tsx');
const launcher = read('../src/components/WorldLauncher.tsx');
const jiti = createJiti(import.meta.url, { moduleCache: false, tryNative: true });
const pref = await jiti.import('../src/lib/world-shelf-pref.ts');

const envOf = (narrow, initial = {}) => {
  const store = new Map(Object.entries(initial));
  return { store, env: { matchMedia: (q) => ({ matches: q === pref.NARROW_SHELF_QUERY && narrow }), storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) } } };
};

test('wide screens open the shelf as before and never store a choice', () => {
  const { env, store } = envOf(false, { [pref.WORLD_SHELF_KEY]: 'closed' });
  assert.equal(pref.autoOpenWorldShelf(env), true);
  pref.rememberWorldShelf(false, env);
  assert.equal(store.get(pref.WORLD_SHELF_KEY), 'closed', 'untouched');
});

test('phones: collapsed by default, then the last choice on this device', () => {
  const { env, store } = envOf(true);
  assert.equal(pref.NARROW_SHELF_QUERY, '(max-width: 520px)');
  assert.equal(pref.autoOpenWorldShelf(env), false);
  pref.rememberWorldShelf(true, env);
  assert.equal(pref.autoOpenWorldShelf(env), true);
  pref.rememberWorldShelf(false, env);
  assert.equal(store.get(pref.WORLD_SHELF_KEY), 'closed');
  assert.equal(pref.autoOpenWorldShelf(env), false);
  assert.equal(pref.autoOpenWorldShelf({ matchMedia: env.matchMedia, storage: { getItem() { throw new Error('blocked'); } } }), false);
});

test('App: auto-open asks the preference; the pill toggles and every close is remembered', () => {
  assert.match(app, /if \(autoOpenWorldShelf\(\)\) setWorldPickerOpen\(true\);/);
  assert.match(app, /onManageSaves=\{\(\) => \{ rememberWorldShelf\(!worldPickerOpen\); setWorldPickerOpen\(!worldPickerOpen\); \}\}/);
  assert.match(app, /shelfOpen=\{worldPickerOpen\}/);
  assert.match(app, /onClose=\{\(\) => \{ rememberWorldShelf\(false\); setWorldPickerOpen\(false\); \}\}/);
  assert.match(app, /entry\.owner === 'world-shelf'\) \{ rememberWorldShelf\(false\); setWorldPickerOpen\(false\); \}/);
  assert.match(launcher, /aria-expanded=\{shelfOpen \?\? false\} data-testid="world-shelf-toggle" onClick=\{onManageSaves\}/);
});

test('Esc closes the shelf before the lobby wall it sits on', () => {
  const shelf = read('../src/components/WorldShelf.tsx');
  const p = (src, key) => Number(src.match(new RegExp(`key: '${key}',[^}]*?priority: (\\d+)`))[1]);
  assert.ok(p(shelf, 'world-shelf') > p(launcher, 'world-launcher'));
});

test('an opened brick is panned fully into view (its 「开始新游戏」 reachable on a phone)', async () => {
  const { revealDelta } = await jiti.import('../src/lib/world-launcher.ts');
  assert.equal(revealDelta(20, 300, 12, 378), 0, 'fits: no move');
  assert.equal(revealDelta(-72, 228, 12, 378), -84, 'off the left edge: the wall moves so the box moves right');
  assert.equal(revealDelta(200, 500, 12, 378), 122, 'off the right edge');
  assert.equal(revealDelta(-50, 450, 12, 378), -62, 'wider than the room: align its start');
  assert.match(launcher, /useEffect\(\(\) => \{\s*if \(!opened\) return;[\s\S]{0,900}revealDelta\(box\.left[\s\S]{0,300}panBy\(dx, dy\);/);
});

test('phone: an opened brick keeps 「开始新游戏」 inside the brick (caption fits below the meta line, scrolls the rest)', () => {
  const css = read('../src/components/world-launcher.css');
  const block = css.slice(css.lastIndexOf('@media (max-width: 520px)'));
  assert.match(block, /\.world-launcher__caption:has\(> \.world-launcher__actions\) \{[^}]*top: 20%;[^}]*overflow-y: auto;[^}]*pointer-events: auto;/);
  assert.match(block, /:has\(> \.world-launcher__actions\) > small \{ display: none; \}/);
  // the play buttons come before the social row, so they show without scrolling
  const tile = launcher.slice(launcher.indexOf('<div className="world-launcher__actions">'));
  assert.ok(tile.indexOf("t('＋ Start a new game')") < tile.indexOf('<WorldSocialRow'));
});
