// Player sticky notes + clue board routes.
// Runs against built dist: `pnpm --filter @airp/server build` first.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { test } from 'node:test';
import { LocalWorldStore, parseFrontmatter } from '@airp/shared';
import { createWorldRouter } from '../dist/routes/world.js';
import { EventBridge } from '../dist/engine/event-bridge.js';
import { resetPlayState } from '../dist/world-play-reset.js';

const LAYER = 'world/study';

class SpyBridge extends EventBridge {
  frames = [];
  broadcast(message) {
    this.frames.push(message);
  }
}

async function harness() {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-pnote-repo-'));
  const world = path.join(repo, 'world-root');
  const store = new LocalWorldStore(world);
  await store.writeFile('world.json', JSON.stringify({ id: 'pn', name: 'PN', description: '', author: '', genre: 'test', createdAt: '', updatedAt: '', characters: [] }));
  await store.writeFile('world/README.md', '---\nname: Map\ntype: readme\n---\n');
  await store.writeFile(`${LAYER}/README.md`, '---\nname: Study\ntype: readme\n---\n');
  await store.writeFile(`${LAYER}/clock.md`, '---\ntitle: Clock\ntype: note\n---\nTick.\n');
  await store.writeFile(`${LAYER}/letter.md`, '---\ntitle: Letter\ntype: note\n---\nDear.\n');
  const bridge = new SpyBridge();
  const lifecycle = { stopCharacters: async () => {}, startWriter: async () => {}, stopAll: async () => {} };
  const app = express();
  app.use(express.json());
  app.use('/api', createWorldRouter(repo, lifecycle, bridge, () => store, () => {}));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (method, route, body) => {
    const r = await fetch(base + route, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  return {
    world, store, bridge,
    get: (route) => call('GET', route),
    post: (route, body) => call('POST', route, body),
    close: async () => {
      server.close();
      try { store.close(); } catch {}
      await fs.rm(repo, { recursive: true, force: true });
    },
  };
}

test('POST /api/player-note create/update/delete as the player; the note shows on the layer as a sticky', async () => {
  const h = await harness();
  try {
    const created = await h.post('/player-note', { op: 'create', layer: LAYER, text: 'Who wound the clock?', x: 900, y: 50 });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const notePath = created.body.path ?? created.body.details?.path;
    assert.equal(notePath, `${LAYER}/player-note-1.md`);
    assert.equal(typeof (created.body.revision ?? created.body.details?.revision), 'number');

    const layer = await h.get(`/layer?layer=${encodeURIComponent(LAYER)}`);
    const sticky = layer.body.items.find((it) => it.path === notePath);
    assert.ok(sticky, 'note is a card on its layer');
    assert.equal(sticky.kind, 'sticky');
    assert.equal(sticky.x, 900);

    const stale = await h.post('/player-note', { op: 'update', path: notePath, text: 'x', expectedRevision: 0 });
    assert.equal(stale.status, 409);
    const updated = await h.post('/player-note', { op: 'update', path: notePath, text: 'The butler did', color: 'blue' });
    assert.equal(updated.status, 200, JSON.stringify(updated.body));
    assert.equal(parseFrontmatter(await h.store.readFile(notePath)).frontmatter.color, 'blue');

    const bad = await h.post('/player-note', { op: 'delete', path: `${LAYER}/clock.md` });
    assert.equal(bad.status, 400);
    const forged = await h.post('/player-note', { op: 'create', layer: LAYER, text: 'x', actor: { type: 'writer' }, author: 'writer' });
    assert.equal(forged.status, 200);
    assert.equal(parseFrontmatter(await h.store.readFile(`${LAYER}/player-note-2.md`)).frontmatter.author, 'player');

    const del = await h.post('/player-note', { op: 'delete', path: notePath });
    assert.equal(del.status, 200);
    assert.equal(await h.store.statKind(notePath), 'missing');
  } finally {
    await h.close();
  }
});

test('POST /api/player-board link + tag persist, broadcast player_board, GET reads them back; reset clears notes and board', async () => {
  const h = await harness();
  try {
    const link = await h.post('/player-board', { op: 'link', from: `${LAYER}/clock.md`, to: `${LAYER}/letter.md`, label: '矛盾' });
    assert.equal(link.status, 200, JSON.stringify(link.body));
    const tag = await h.post('/player-board', { op: 'tag', path: `${LAYER}/clock.md`, tag: 'suspect' });
    assert.equal(tag.status, 200);
    const frames = h.bridge.frames.filter((f) => f.type === 'player_board');
    assert.equal(frames.length, 2);
    assert.equal(frames[1].layer, LAYER);
    assert.equal(frames[1].board.tags[`${LAYER}/clock.md`], 'suspect');

    const read = await h.get(`/player-board?layer=${encodeURIComponent(LAYER)}`);
    assert.equal(read.status, 200);
    assert.equal(read.body.board.links[0].label, '矛盾');
    assert.equal(read.body.board.tags[`${LAYER}/clock.md`], 'suspect');
    const other = await h.get('/player-board?layer=map');
    assert.deepEqual(other.body.board, { links: [], tags: {} });

    const badTag = await h.post('/player-board', { op: 'tag', path: `${LAYER}/clock.md`, tag: 'guilty' });
    assert.equal(badTag.status, 400);

    await h.post('/player-note', { op: 'create', layer: LAYER, text: 'n' });
    const report = await resetPlayState(h.world);
    assert.ok(report.deleted.includes('player-board.json'));
    assert.ok(report.deleted.includes(`${LAYER}/player-note-1.md`));
  } finally {
    await h.close();
  }
});
