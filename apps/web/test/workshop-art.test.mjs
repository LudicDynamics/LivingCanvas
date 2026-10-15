// The creation-mode 素材 panel: pure helpers, and
// that the panel mounts only for the author's own draft.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { ART_PANEL_TABS, artPreview, artSections, base64OfDataUrl, isArtAuthoring, missingMapSlot, promptDirty, showWorkshopChrome, uploadProblem, withSlot } = await jiti.import('../src/lib/workshop-art.ts');

const src = (p) => readFile(new URL(p, import.meta.url), 'utf8');

const slot = (id, extra) => ({ id, owner: 'layer', ownerPath: 'world/README.md', kind: 'scene', label: id, path: 'assets/scenes/a.png', prompt: 'p', exists: false, declared: true, ...extra });
const slots = [
  slot('layer:map:scene', { layer: 'map' }),
  slot('layer:map:map', { layer: 'map', kind: 'map', exists: false, prompt: 'aerial' }),
  slot('layer:world/well:scene', { layer: 'world/well', exists: true, url: '/api/asset?x' }),
  slot('character:po:portrait', { owner: 'character', kind: 'portrait' }),
  slot('npc:world/well/x.md:portrait', { owner: 'npc', kind: 'portrait' }),
  slot('cg:a', { owner: 'cg', kind: 'cg' }),
  slot('trigger:t:0', { owner: 'trigger', kind: 'cg' }),
  slot('ending:e:scene', { owner: 'ending' }),
];

test('only the author\'s draft is creation mode', () => {
  assert.equal(isArtAuthoring({ authoring: true, workshop: { status: 'draft' } }), true);
  assert.equal(isArtAuthoring({ authoring: true, workshop: { status: 'published' } }), false);
  assert.equal(isArtAuthoring({ authoring: false, workshop: { status: 'draft' } }), false);
  assert.equal(isArtAuthoring(null), false);
});

test('artSections puts the current place first and sorts the rest by owner', () => {
  const s = artSections(slots, 'map');
  assert.equal(s.scene.id, 'layer:map:scene');
  assert.equal(s.map.id, 'layer:map:map');
  assert.deepEqual(s.portraits.map((x) => x.id), ['character:po:portrait', 'npc:world/well/x.md:portrait']);
  assert.deepEqual(s.cgs.map((x) => x.id), ['cg:a', 'trigger:t:0']);
  assert.deepEqual(s.endings.map((x) => x.id), ['ending:e:scene']);
  assert.deepEqual(s.places.map((x) => x.id), ['layer:world/well:scene']);
  const deeper = artSections(slots, 'world/well');
  assert.equal(deeper.scene.id, 'layer:world/well:scene');
  assert.equal(deeper.map, null);
});

test('artPreview: the painted picture, else the one wired now, else a placeholder', () => {
  assert.deepEqual(artPreview(slots[2]), { state: 'ready', url: '/api/asset?x' });
  assert.deepEqual(artPreview(slot('x', { inUseExists: true, inUseUrl: '/old' })), { state: 'in-use', url: '/old' });
  assert.deepEqual(artPreview(slots[0]), { state: 'missing' });
  assert.deepEqual(artPreview(null), { state: 'missing' });
});

test('missingMapSlot, withSlot, uploads and dirty prompts', () => {
  assert.equal(missingMapSlot(slots, 'map').id, 'layer:map:map');
  assert.equal(missingMapSlot(slots, 'world/well'), null);
  const next = withSlot(slots, { ...slots[0], prompt: 'new' });
  assert.equal(next[0].prompt, 'new');
  assert.equal(withSlot(slots, null).length, slots.length);
  assert.equal(uploadProblem({ type: 'image/gif', size: 10 }), 'type');
  assert.equal(uploadProblem({ type: 'image/png', size: 9 * 1024 * 1024 }), 'size');
  assert.equal(uploadProblem({ type: 'image/webp', size: 10 }), null);
  assert.equal(base64OfDataUrl('data:image/png;base64,AAAA'), 'AAAA');
  assert.equal(promptDirty(slots[0], 'p'), false);
  assert.equal(promptDirty(slots[0], ' q '), true);
  assert.deepEqual(ART_PANEL_TABS.map((tab) => [tab.id, tab.ready]), [['assets', true], ['setup', true], ['states', false], ['triggers', false], ['outcomes', false]]);
});

test('App mounts the panel only in creation mode, outside a nook, with a registered depth', async () => {
  const app = await src('../src/App.tsx');
  assert.match(app, /const artAuthoring = isArtAuthoring\(manifest\);/);
  assert.match(app, /\{showWorkshopChrome\(\{ artAuthoring, nook: nookChar !== null, launcherOpen, introOpen: introCardOpen, modalOpen: createOpen \}\) && \(\s*<WorkshopArtPanel/);
  // The same flag gates the intro card itself, so the two can never show together.
  assert.match(app, /\{introCardOpen && introGate\.state && \(\s*<WorldIntroDialog/);
  assert.match(app, /viewMode === 'map' && unpaintedMap/);
  const css = await src('../src/components/chrome/workshop-art.css');
  assert.match(css, /z-index: var\(--depth-chrome-art-panel\)/);
  assert.match(await src('../src/index.css'), /--depth-chrome-art-panel:/);
});

test('the 素材 tab and 试玩 pill show only on the creation-mode canvas', () => {
  const canvas = { artAuthoring: true, nook: false, launcherOpen: false, introOpen: false, modalOpen: false };
  assert.equal(showWorkshopChrome(canvas), true);
  assert.equal(showWorkshopChrome({ ...canvas, launcherOpen: true }), false, 'hidden under the launcher / 世界一览');
  assert.equal(showWorkshopChrome({ ...canvas, introOpen: true }), false, 'hidden under 「开始之前…你在这里是谁？」');
  assert.equal(showWorkshopChrome({ ...canvas, modalOpen: true }), false, 'hidden under a full dialog');
  assert.equal(showWorkshopChrome({ ...canvas, nook: true }), false);
  assert.equal(showWorkshopChrome({ ...canvas, artAuthoring: false }), false);
});
