/**
 * N2c — `POST /api/card/footprint` write gate for nook SUB-SCENES
 *.
 *
 * Before this batch the gate did `isValidCharacterId(layer.slice('characters/'.length))`,
 * so `characters/elias/office` sliced to `'elias/office'`, the `/` failed the id
 * regex, and EVERY sub-scene footprint write answered 400 — the renderer's
 * measured size could never be persisted (the `AGENTS §7.5` long-card overlap
 * bug, restored). After it, the shape gate is the ONE id validator
 * `isNookSceneId` and existence is the SCENE directory itself.
 *
 * Runs against built dist: `pnpm --filter @airp/server build`.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { test } from 'node:test';
import { LocalWorldStore, createActionService } from '@airp/shared';
import { createWorldRouter } from '../dist/routes/world.js';
import { EventBridge } from '../dist/engine/event-bridge.js';

const MANIFEST = JSON.stringify({
  id: 'proj-n2c',
  name: 'N2c',
  description: '',
  author: '',
  genre: 'test',
  createdAt: '',
  updatedAt: '',
  characters: [{ id: 'elias', name: 'Elias', home: 'world/map' }],
});

const CARD = (title) => `---\ntitle: ${title}\ntype: note\n---\n\n${title} body.\n`;

const OFFICE = 'characters/elias/office';
const SCENE_CARD = `${OFFICE}/desk.md`;

/** Temp repo root + world; character `elias` with an `office` sub-scene. */
async function harness() {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-n2c-repo-'));
  const world = path.join(repo, 'world-root');
  const store = new LocalWorldStore(world);
  await store.writeFile('world.json', MANIFEST);
  await store.writeFile('world/README.md', '---\nname: Map\ntype: readme\n---\n\n# Map\n');
  await store.writeFile('characters/elias/README.md', '---\nname: Elias\ntype: readme\n---\n\n# Elias\n');
  await store.writeFile('characters/elias/unspoken.md', CARD('Unspoken'));
  await store.writeFile(`${OFFICE}/README.md`, '---\nname: Office\ntype: readme\n---\n\n# Office\n');
  await store.writeFile(SCENE_CARD, CARD('Desk'));

  const lifecycle = { stopCharacters: async () => {}, startWriter: async () => {}, stopAll: async () => {} };
  const app = express();
  app.use(express.json());
  app.use('/api', createWorldRouter(repo, lifecycle, new EventBridge(), () => store, () => {}));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  return {
    store,
    post: async (route, body) => {
      const r = await fetch(base + route, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      return { status: r.status, body: await r.json().catch(() => null) };
    },
    close: async () => {
      server.close();
      try { store.close(); } catch {}
      await fs.rm(repo, { recursive: true, force: true });
    },
  };
}

test('N2c-A12 POST /api/card/footprint on a SUB-SCENE layer -> 200 and the measured size lands', async () => {
  const h = await harness();
  try {
    // Seat the sub-scene card through the OTHER half of this batch's write path
    // (arrangeCards), so the row the footprint write must find actually exists.
    const svc = createActionService(h.store, { type: 'writer' }, { turn: 'n2c:footprint' });
    const placed = await svc.arrangeCards({ place: { path: SCENE_CARD, x: 730, y: 445 } });
    assert.equal(placed.details.layer, OFFICE);
    const before = h.store.getLayerCards([SCENE_CARD])[0];
    assert.equal(before.layer, OFFICE);

    // BEFORE the fix this was a 400: `'elias/office'` failed `isValidCharacterId`.
    const measured = { w: before.w + 7, h: before.h + 11 };
    const r = await h.post('/card/footprint', { layer: OFFICE, boxes: [{ path: SCENE_CARD, ...measured }] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.updated, 1, JSON.stringify(r.body));

    const after = h.store.getLayerCards([SCENE_CARD])[0];
    assert.equal(after.w, measured.w);
    assert.equal(after.h, measured.h);
    assert.equal(after.layer, OFFICE, 'the write must not move the row onto the character root');
  } finally {
    await h.close();
  }
});

test('N2c-A13 footprint on a sub-scene keeps the shape/existence split: trailing slash -> 400, missing dir -> 404', async () => {
  const h = await harness();
  try {
    // Trailing slash: a shape error, NOT "layer must be an existing layer id".
    const slash = await h.post('/card/footprint', {
      layer: `${OFFICE}/`,
      boxes: [{ path: SCENE_CARD, w: 1, h: 1 }],
    });
    assert.equal(slash.status, 400, JSON.stringify(slash.body));
    assert.equal(slash.body.code, 'invalid_argument');

    // Well-formed but nonexistent scene: 404 (never a silent 200 `unchanged`).
    const ghost = await h.post('/card/footprint', {
      layer: 'characters/elias/ghost-scene',
      boxes: [{ path: 'characters/elias/ghost-scene/x.md', w: 1, h: 1 }],
    });
    assert.equal(ghost.status, 404, JSON.stringify(ghost.body));
    assert.equal(ghost.body.code, 'not_found');
  } finally {
    await h.close();
  }
});

test('N2c-A14 footprint regression: the root nook and a real layer are unchanged', async () => {
  const h = await harness();
  try {
    const svc = createActionService(h.store, { type: 'writer' }, { turn: 'n2c:footprint-reg' });
    await svc.arrangeCards({ place: { path: 'characters/elias/unspoken.md', x: 10, y: 20 } });

    const root = await h.post('/card/footprint', {
      layer: 'characters/elias',
      boxes: [{ path: 'characters/elias/unspoken.md', w: 300, h: 200 }],
    });
    assert.equal(root.status, 200, JSON.stringify(root.body));

    const unrelated = await h.post('/card/footprint', {
      layer: 'world/nope',
      boxes: [{ path: 'world/nope/a.md', w: 1, h: 1 }],
    });
    assert.equal(unrelated.status, 404, JSON.stringify(unrelated.body));
  } finally {
    await h.close();
  }
});
