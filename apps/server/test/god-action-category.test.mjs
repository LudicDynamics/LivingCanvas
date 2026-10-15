/**
 * `/api/god-action` by world category.
 *
 * Free / story worlds (and worlds with no category): the player creates
 * straight from the right-click radial — `mode: 'play'` is accepted. TRPG
 * worlds: a player-made scene / NPC / clue / chalk would break the case and the
 * dice, so `mode: 'play'` (or no mode) is refused with 403 and writes nothing;
 * authoring mode (`mode: 'authoring'`) keeps the full tools.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import test from 'node:test';
import express from '../node_modules/express/index.js';
import { LocalWorldStore } from '../../../packages/shared/dist/index.js';
import { createWorldRouter } from '../dist/routes/world.js';
import { EventBridge } from '../dist/engine/event-bridge.js';

// A valid lobby card (the manifest schema drops an invalid `intro` whole):
// borrow a shipped one and set only its category.
const SHIPPED_INTRO = JSON.parse(await fs.readFile(new URL('../../../templates/wuwu/world.json', import.meta.url), 'utf8')).intro;
const intro = (category) => ({ intro: { ...SHIPPED_INTRO, category } });

async function world(extra) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-god-cat-'));
  const store = new LocalWorldStore(root);
  await store.writeFile('world.json', JSON.stringify({
    id: 'proj-god-cat', name: 'Cat', description: '', author: '', genre: 'test',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...extra,
  }));
  await store.writeFile('world/README.md', '---\nname: Map\ntype: readme\n---\n\n# Map\n');
  await store.writeFile('world/inn/README.md', '---\nname: Inn\ntype: readme\n---\n\n# Inn\n');
  const lifecycle = { stopAll: async () => {}, submitWriter: async () => {} };
  const app = express();
  app.use(express.json());
  app.use('/api', createWorldRouter(process.cwd(), lifecycle, new EventBridge(), () => store, () => {}));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const create = async (name, mode) => {
    const res = await fetch(`${base}/god-action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'create', path: `world/inn/${name}.md`, content: `---\ntype: clue\ntitle: ${name}\n---\nA ${name}.`, ...(mode ? { mode } : {}) }),
    });
    return { status: res.status, body: await res.json() };
  };
  const close = async () => { server.close(); store.close(); await fs.rm(root, { recursive: true, force: true }); };
  return { store, create, close };
}

test('free / story / uncategorised worlds: a player creates from play mode', async () => {
  for (const extra of [intro('free'), intro('story'), {}, { intro: { ...SHIPPED_INTRO, category: undefined } }, { theme: { type: 'galgame' } }]) {
    const w = await world(extra);
    try {
      const made = await w.create('coin', 'play');
      assert.equal(made.status, 200, `${extra.intro?.category ?? JSON.stringify(extra.theme ?? {})} ${JSON.stringify(made.body)}`);
      assert.equal(await w.store.statKind('world/inn/coin.md'), 'file');
    } finally { await w.close(); }
  }
});

test('TRPG worlds: play-mode creation is refused and writes nothing; authoring mode still creates', async () => {
  for (const extra of [intro('trpg'), { theme: { type: 'infinite' } }]) {
    const w = await world(extra);
    try {
      for (const mode of ['play', undefined]) {
        const refused = await w.create('clue', mode);
        assert.equal(refused.status, 403, `${extra.intro ? 'intro' : 'theme'} mode=${mode} ${JSON.stringify(refused.body)}`);
        assert.equal(refused.body.code, 'not_in_this_world');
        assert.equal(await w.store.statKind('world/inn/clue.md'), 'missing');
      }
      assert.equal(await w.store.getMaxSeq(), 0, 'a refused create lands no event');
      const authored = await w.create('clue', 'authoring');
      assert.equal(authored.status, 200, JSON.stringify(authored.body));
      assert.equal(await w.store.statKind('world/inn/clue.md'), 'file');
    } finally { await w.close(); }
  }
});

test('an unknown mode is a 400', async () => {
  const w = await world({});
  try {
    const bad = await w.create('x', 'god');
    assert.equal(bad.status, 400);
    assert.equal(bad.body.code, 'invalid_argument');
  } finally { await w.close(); }
});
