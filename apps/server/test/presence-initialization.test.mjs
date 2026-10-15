import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { test } from 'node:test';
import { LocalWorldStore } from '@airp/shared';
import { createWorldRouter } from '../dist/routes/world.js';

async function harness() {
  let active = null;
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-presence-init-'));
  await fs.mkdir(path.join(repo, 'world', 'a'), { recursive: true });
  await fs.mkdir(path.join(repo, 'world', 'b'), { recursive: true });
  for (const id of ['watson', 'edith']) await fs.mkdir(path.join(repo, 'characters', id), { recursive: true });
  await fs.writeFile(path.join(repo, 'world.json'), JSON.stringify({
    id: 'presence-init', name: 'Presence init', description: '', author: '', genre: 'test',
    characters: [
      { id: 'watson', name: 'Watson', home: 'world/a' },
      { id: 'edith', name: 'Edith', home: 'world/b' },
    ],
    createdAt: '2026-01-01', updatedAt: '2026-01-01',
  }));
  for (const layer of ['world', 'world/a', 'world/b']) {
    await fs.mkdir(path.join(repo, layer), { recursive: true });
    await fs.writeFile(path.join(repo, layer, 'README.md'), `---\ntype: readme\nname: ${layer}\n---\n`);
  }
  for (const id of ['watson', 'edith']) {
    await fs.writeFile(path.join(repo, 'characters', id, 'README.md'), `---\ntype: readme\nname: ${id}\n---\n`);
    await fs.writeFile(path.join(repo, 'characters', id, 'preset.json'), '{}');
  }

  const lifecycle = {
    isModelSwitching: () => false,
    beginWorldTransition: () => {},
    completeWorldTransition: () => {},
    stopCharacters: async () => {},
    stopAll: async () => {},
    startWriter: async () => {},
  };
  const bridge = { close() {}, startTailReader() {}, watchWorld() {}, broadcast() {} };
  const app = express();
  app.use(express.json());
  app.use('/api', createWorldRouter(repo, lifecycle, bridge, () => active, (store) => { active = store; }));
  const server = http.createServer(app);
  await new Promise((resolve, reject) => { server.listen(0, '127.0.0.1', resolve); server.once('error', reject); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  return {
    repo,
    active: () => active,
    post: async (route, body) => {
      const response = await fetch(`${base}/${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    },
    get: async (route) => {
      const response = await fetch(`${base}/${route}`);
      return { status: response.status, body: await response.json() };
    },
    close: async () => {
      active?.close();
      await new Promise((resolve) => server.close(resolve));
      await fs.rm(repo, { recursive: true, force: true });
    },
  };
}

test('world load initializes each manifest character from home before exposing the store', async () => {
  const h = await harness();
  try {
    const loaded = await h.post('worlds/load', { worldPath: h.repo });
    assert.equal(loaded.status, 200, JSON.stringify(loaded.body));
    const chars = await h.get('characters');
    assert.equal(chars.status, 200);
    assert.ok(chars.body.characters.every((character) => character.presence !== null), 'world load must initialize every manifest character presence');

    for (const [id, layer] of [['watson', 'world/a'], ['edith', 'world/b']]) {
      const page = await h.get(`layer?layer=${encodeURIComponent(layer)}`);
      assert.equal(page.status, 200);
      assert.ok(page.body.presence.some((entry) => entry.characterId === id), 'home layer must expose a non-empty initial presence row');
      assert.equal(page.body.items.some((item) => ['character', 'spirit'].includes(item.frontmatter?.type)), false);
    }
    const events = await h.active().getEventsSince(0);
    assert.deepEqual(events.map((event) => event.type), ['character_moved', 'character_moved']);
    assert.ok(events.every((event) => event.actor.type === 'engine'));
  } finally {
    await h.close();
  }
});
