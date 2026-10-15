// Presence & following routes.
// Runs against built dist: `pnpm --filter @airp/server build` first.
//
// These four each guard a wiring the design batch landed, and each FAILS without
// its fix:
//   PF-A1: POST /api/following exists at all. Before it, Express answered 404
//          `Cannot POST /api/following` — the player had no way to follow.
//   PF-A2: a follower is CARRIED into the new layer on `enter-layer`. Before
//          `carryFollowers` was wired into `enterLayer`, the character stayed
//          behind forever (measured: presence.layer unchanged).
//   PF-A3: /api/layer returns `x`. Before, the route mapped only
//          characterId/y/following and silently dropped the `x` it had read.
//   PF-A4: /api/characters reports each character's presence (the ONE
//          cross-layer fact the character rail needs). Before, it did not.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { test } from 'node:test';
import { LocalWorldStore } from '@airp/shared';
import { createWorldRouter } from '../dist/routes/world.js';
import { EventBridge } from '../dist/engine/event-bridge.js';

const MANIFEST = JSON.stringify({
  id: 'proj-presence',
  name: 'Presence',
  description: '',
  author: '',
  genre: 'test',
  createdAt: '',
  updatedAt: '',
  characters: [
    { id: 'watson', name: 'Watson', home: 'world/a' },
    { id: 'edith', name: 'Edith', home: 'world/a' },
  ],
});

// A stub layer (`world/b` with no README) is deliberate: following into a
// never-written scene is the case where it matters most, and the design notes
// allows a stub directory as a destination.
async function harness() {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-presence-repo-'));
  const world = path.join(repo, 'world-root');
  const store = new LocalWorldStore(world);
  await store.writeFile('world.json', MANIFEST);
  await store.writeFile('world/README.md', '---\nname: Map\ntype: readme\n---\n\n# Map\n');
  await store.writeFile('world/a/README.md', '---\nname: A\ntype: readme\n---\n\n# A\n');
  for (const id of ['watson', 'edith']) {
    await store.writeFile(`characters/${id}/README.md`, `---\nname: ${id}\ntype: readme\n---\n\n# ${id}\n`);
    await store.writeFile(`characters/${id}/preset.json`, JSON.stringify({ id }));
  }
  // `world/b` is a stub: the directory exists but has no README yet, which is
  // exactly `first: true`. Created directly because
  // `writeFile` would need a file, and the absence of one IS the point.
  await fs.mkdir(path.join(world, 'world', 'b'), { recursive: true });

  const lifecycle = { stopCharacters: async () => {}, startWriter: async () => {}, stopAll: async () => {} };
  const app = express();
  app.use(express.json());
  app.use('/api', createWorldRouter(repo, lifecycle, new EventBridge(), () => store, () => {}));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  return {
    base,
    store,
    get: async (route) => {
      const r = await fetch(base + route);
      return { status: r.status, body: await r.json().catch(() => null) };
    },
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

/** Put a character on a layer, the way the writer's `move_to` does. */
async function seed(st, characterId, layer) {
  const svc = (await import('@airp/shared')).createActionService(st, { type: 'writer' }, { turn: 'req:seed' });
  return svc.moveCharacter({ character: characterId, destination: layer });
}

// ── PF-A1: the route exists (404 before it did) ──
test('PF-A1 POST /api/following -> 200, writes the terminal state', async () => {
  const h = await harness();
  try {
    await seed(h.store, 'watson', 'world/a');
    const r = await h.post('/following', { character: 'watson', following: true });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.ok, true);
    const row = h.store.getPresenceOf('watson');
    assert.equal(row.following, true, 'following must be persisted');

    // Idempotent: the same terminal state again is a no-op that lands no event.
    const before = (await h.store.getEventsSince(0)).length;
    const again = await h.post('/following', { character: 'watson', following: true });
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.equal(again.body.changed, false, 'repeat must report changed:false');
    assert.equal((await h.store.getEventsSince(0)).length, before, 'a no-op must land no event');

    // Validation: the C entry point must reject a malformed body.
    const bad = await h.post('/following', { character: '', following: true });
    assert.equal(bad.status, 400, JSON.stringify(bad.body));
  } finally {
    await h.close();
  }
});

// ── PF-A2: the follower is actually carried (the B1 wiring) ──
test('PF-A2 enter-layer carries followers: presence.layer moves, layer_entered lands first', async () => {
  const h = await harness();
  try {
    await seed(h.store, 'watson', 'world/a');
    await seed(h.store, 'edith', 'world/a');
    await h.post('/following', { character: 'watson', following: true });

    const r = await h.post('/enter-layer', { layer: 'world/b' });
    assert.equal(r.status, 200, JSON.stringify(r.body));

    // The whole point: watson travelled, edith (not following) did not.
    assert.equal(h.store.getPresenceOf('watson').layer, 'world/b', 'watson must follow into the new layer');
    assert.equal(h.store.getPresenceOf('watson').following, true, 'following survives the move');
    assert.equal(h.store.getPresenceOf('edith').layer, 'world/a', 'a non-follower must stay behind');

    // Order is frozen: the entry lands, then they come.
    const events = await h.store.getEventsSince(0);
    const entryAt = events.findIndex((e) => e.type === 'layer_entered');
    const carriedAt = events.flatMap((e, i) =>
      e.type === 'character_moved' && e.detail?.to === 'world/b' ? [i] : []
    );
    assert.ok(entryAt >= 0, 'layer_entered must be on record');
    assert.equal(carriedAt.length, 1, 'exactly one carried event');
    assert.ok(carriedAt.every((i) => i > entryAt), 'layer_entered must precede the carry');
    for (const i of carriedAt) {
      assert.equal(events[i].actor.type ?? events[i].actor, 'engine', 'the carry is an engine act');
      assert.equal(events[i].detail.from, 'world/a');
    }
  } finally {
    await h.close();
  }
});

// ── PF-A3: /api/layer exposes the coordinates (the dropped `x`) ──
test('PF-A3 GET /api/layer presence carries x and y (the centre point)', async () => {
  const h = await harness();
  try {
    await seed(h.store, 'watson', 'world/a');
    const r = await h.get('/layer?layer=world/a');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const row = r.body.presence.find((p) => p.characterId === 'watson');
    assert.ok(row, `presence must include watson: ${JSON.stringify(r.body.presence)}`);
    // Before the fix the route mapped characterId/y/following only: `x` was read
    // by the SELECT and thrown away, so the avatar had no horizontal position.
    assert.equal(typeof row.x, 'number', 'x must be present (docs/presence/00 §3.1)');
    assert.equal(typeof row.y, 'number', 'y must be present');
    assert.equal(typeof row.following, 'boolean', 'following must be a boolean, not 0/1');
  } finally {
    await h.close();
  }
});

// ── PF-A4: /api/characters reports where each character actually is ──
test('PF-A4 GET /api/characters presence is always a key: object when in-world, null when not', async () => {
  const h = await harness();
  try {
    await seed(h.store, 'watson', 'world/b');
    const r = await h.get('/characters');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const byId = Object.fromEntries(r.body.characters.map((c) => [c.id, c]));

    assert.ok('presence' in byId.watson, 'the key is ALWAYS present (P-11), never optional');
    assert.deepEqual(byId.watson.presence, { layer: 'world/b', following: false });
    // edith has no presence row at all: absent is expressed as null, not a
    // missing key — `home` is NOT "where they are".
    assert.ok('presence' in byId.edith, 'absent must still carry the key');
    assert.equal(byId.edith.presence, null, 'no presence row => null');
    assert.equal(byId.edith.home, 'world/a', 'home remains the initial layer, untouched');
    assert.equal('avatar' in byId.edith, false, 'missing media must not use an invalid generic avatar');
  } finally {
    await h.close();
  }
});
