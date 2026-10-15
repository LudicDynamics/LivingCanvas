import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import express from 'express';
import { LocalWorldStore } from '@airp/shared';
import { createWorldRouter } from '../dist/routes/world.js';
import { EventBridge } from '../dist/engine/event-bridge.js';

const MANIFEST = JSON.stringify({
  id: 'layout-layer-test',
  name: 'Layout layer test',
  description: '',
  author: '',
  genre: 'test',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const LIFECYCLE = {
  stopCharacters: async () => {},
  startWriter: async () => {},
  stopAll: async () => {},
};

async function startWorld(files) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-layout-layer-'));
  const store = new LocalWorldStore(root);
  await store.writeFile('world.json', MANIFEST);
  await store.writeFile('world/README.md', '---\nname: Map\ntype: readme\n---\n\n# Map\n');
  for (const [file, content] of Object.entries(files)) await store.writeFile(file, content);

  const app = express();
  app.use(express.json());
  const eventBridge = new EventBridge();
  app.use('/api', createWorldRouter(process.cwd(), LIFECYCLE, eventBridge, () => store, () => {}));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;

  return {
    store,
    base,
    async getLayer() {
      const response = await fetch(`${base}/layer?layer=map`);
      assert.equal(response.status, 200);
      return response.json();
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
      store.close();
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}

function overlaps(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function chalk(title) {
  return `---\ntitle: ${title}\ntype: chalk\n---\n\n${title}.\n`;
}

function note(title) {
  return `---\ntitle: ${title}\ntype: note\n---\n\n${title}.\n`;
}

test('GET /layer avoids an occupied old card while leaving its x/y/z unchanged', async () => {
  const world = await startWorld({
    'world/old.md': chalk('Old card'),
    'world/new.md': chalk('New card'),
  });
  try {
    world.store.execCanvas(
      'INSERT INTO cards (id, layer, x, y, width, height, z_index, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ['world/old.md', 'map', 360, 96, 460, 190, 7, JSON.stringify({ seatW: 460, seatH: 190 })]
    );
    const before = world.store.getLayerCards(['world/old.md'])[0];
    const layer = await world.getLayer();
    assert.ok(layer.items.some((item) => item.path === 'world/new.md'), 'new item is returned by the page');
    const old = world.store.getLayerCards(['world/old.md'])[0];
    const fresh = world.store.getLayerCards(['world/new.md'])[0];
    assert.ok(fresh, 'new page item receives a persistent row');
    assert.deepEqual({ x: old.x, y: old.y, z: old.z }, { x: before.x, y: before.y, z: before.z });
    assert.equal(overlaps(old, fresh), false, 'new row does not overlap the existing page card');
  } finally {
    await world.close();
  }
});

test('GET /layer seats every new page item in one non-overlapping flow batch', async () => {
  const world = await startWorld({
    'world/03-third.md': note('Third'),
    'world/01-first.md': chalk('First'),
    'world/02-second.md': note('Second'),
  });
  try {
    const layer = await world.getLayer();
    assert.equal(layer.items.length, 3, 'all page files are returned');
    const rows = world.store.getLayerCards(layer.items.map((item) => item.path));
    assert.equal(rows.length, 3, 'every page item receives a row');
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        assert.equal(overlaps(rows[i], rows[j]), false, `${rows[i].id} and ${rows[j].id} do not overlap`);
      }
    }
  } finally {
    await world.close();
  }
});

test('replaying GET /layer preserves existing row x/y/z', async () => {
  const world = await startWorld({
    'world/01-entry.md': chalk('Entry'),
    'world/02-note.md': note('Note'),
  });
  try {
    const first = await world.getLayer();
    const paths = first.items.map((item) => item.path);
    const before = new Map(world.store.getLayerCards(paths).map((row) => [row.id, { x: row.x, y: row.y, z: row.z }]));
    const second = await world.getLayer();
    assert.equal(second.items.length, first.items.length, 'replay returns the same page');
    const after = world.store.getLayerCards(paths);
    assert.equal(after.length, before.size, 'replay does not drop rows');
    for (const row of after) assert.deepEqual({ x: row.x, y: row.y, z: row.z }, before.get(row.id), row.id);
  } finally {
    await world.close();
  }
});
