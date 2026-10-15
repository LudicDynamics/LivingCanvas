// The prologue has a map view too:
// the 画布 / 地图 switch comes with the first answer, the map shows 2 车's floor plan with the notebook, the
// testimony and the door to 5 车 pinned, and canvas mode stays exactly as it was.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, access } from 'node:fs/promises';
import { parseFrontmatter } from '@airp/shared';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const board = await jiti.import('../src/lib/board-model.ts');
const viewMode = await jiti.import('../src/lib/view-mode.ts');
const src = (p) => readFile(new URL(p, import.meta.url), 'utf8');
const templates = new URL('../../../templates/', import.meta.url);
const EDITIONS = ['last-train-prologue', 'last-train-prologue-zh', 'last-train-prologue-jp', 'last-train-prologue-ko'];

test('first-run chrome: the 画布 / 地图 switch is not in the hidden batch; it shows once the world has answered', async () => {
  const css = await src('../src/components/chrome/first-run.css');
  const hidden = css.match(/\/\* ② The prologue[\s\S]*?\{ display: none !important; \}/)[0];
  assert.doesNotMatch(hidden, /\.view-mode-switch/, 'the switch is not in the minimal-chrome display:none batch');
  assert.match(css, /\.app--first-run\[data-first-run-view='hidden'\] \.view-mode-switch \{ display: none; \}/);
  const app = await src('../src/App.tsx');
  assert.match(app, /data-first-run-view=\{prologueOpen \? \(prologueFacts\.spoke \|\| prologueFacts\.mapped \|\| viewMode === 'map' \? 'shown' : 'hidden'\) : undefined\}/,
    'shown after the first answer, and always once the player is on the map');
  assert.match(app, /if \(prologueOpen && viewMode === 'map'\) setPrologueFacts\(\(f\) => \(f\.mapped \? f : \{ \.\.\.f, mapped: true \}\)\)/, 'back on the canvas, the switch stays');
  assert.match(app, /\{!nookChar && <ViewModeSwitch mode=\{viewMode\} onChange=\{setViewMode\} \/>\}/, 'the switch renders in the prologue too (only CSS holds it back)');
  assert.match(app, /parent=\{prologueOpen \? null : boardParent\}/, 'no way out of 2 车 to the overview the prologue never visits');
});

test('switching works in the prologue: the choice is remembered for that world and broadcast to the stage', () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const seen = [];
  globalThis.window = new EventTarget();
  globalThis.CustomEvent ??= class extends Event { constructor(type, init) { super(type); this.detail = init?.detail; } };
  const off = viewMode.subscribeViewMode((m) => seen.push(m));
  try {
    assert.equal(viewMode.enterWorldView('last-train-prologue-zh', viewMode.worldDefaultViewOf({ id: 'last-train-prologue-zh' })), 'canvas', 'the prologue opens on the canvas');
    viewMode.setViewMode('map');
    assert.equal(store.get('airp.view:last-train-prologue-zh'), 'map');
    viewMode.setViewMode('canvas');
    assert.deepEqual(seen, ['canvas', 'map', 'canvas']);
    assert.equal(viewMode.enterWorldView('last-train-prologue-zh'), 'canvas');
  } finally {
    off();
    delete globalThis.window;
    delete globalThis.localStorage;
  }
});

for (const id of EDITIONS) {
  test(`${id}: 2 车 and 5 车 have a drawn floor plan; the notebook, the testimony, the door and Xia Cheng are pinned on it`, async () => {
    const seated = parseFrontmatter(await readFile(new URL(`${id}/world/seated-car/README.md`, templates), 'utf8')).frontmatter;
    const plan = board.mapPlan(seated);
    assert.ok(plan, 'map.plan');
    await access(new URL(`${id}/${plan.picture}`, templates));
    const items = [
      { path: 'world/seated-car/01-opening.md', frontmatter: { type: 'chalk' }, body: '1:10' },
      { path: 'world/seated-car/su-he-notebook.md', frontmatter: { type: 'prop' }, body: 'notebook' },
      { path: 'world/seated-car/witness-account.md', frontmatter: { type: 'note' }, body: 'testimony' },
      { path: 'world/seated-car/freight-door.md', frontmatter: { type: 'gate', target: 'world/freight-car' }, body: 'door' },
    ];
    const pins = board.pinMap({ worldId: id, layerId: 'world/seated-car', readme: plan.readme, items, characters: [{ id: 'xia-cheng', name: 'Xia', here: true }], parent: null }).pins;
    const at = (pid) => pins.find((p) => p.id === pid);
    assert.deepEqual([at('world/seated-car/su-he-notebook.md').x, at('world/seated-car/su-he-notebook.md').y], [0.41, 0.41], 'the notebook on seat 17');
    assert.deepEqual([at('world/seated-car/freight-door.md').x, at('world/seated-car/freight-door.md').y], [0.93, 0.45], 'the door at the rear end of the car');
    assert.equal(at('world/seated-car/freight-door.md').kind, 'place');
    assert.deepEqual([at('xia-cheng').x, at('xia-cheng').y], [0.3, 0.6]);
    assert.ok(at('player'), 'the player stands on the map');
    const freight = parseFrontmatter(await readFile(new URL(`${id}/world/freight-car/README.md`, templates), 'utf8')).frontmatter;
    const fplan = board.mapPlan(freight);
    assert.ok(fplan);
    await access(new URL(`${id}/${fplan.picture}`, templates));
  });
}
