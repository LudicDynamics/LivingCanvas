// Nook read/write routes.
// Runs against built dist: `pnpm --filter @airp/server build` first.
//
// N1-A1: GET /api/nook?character=<id> — non-emptiness. Before the route existed
//        Express answered 404 `Cannot GET /api/nook`; after it, 200 with items.
// N1-A8: POST /api/card/footprint with layer=`characters/<id>` — before the nook
//        gate branch, `resolveLayer` returns null for `characters/**` by
//        construction, so the gate 404'd every nook footprint forever; after it,
//        200 `updated:1` and the row carries a top-level `measuredAt`.
//
// Fixture: a temp world with character `ryo` (README + 2 md). NOT watson — the
// real template row for it is polluted by a prior probe.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { test } from 'node:test';
import { LocalWorldStore, NookNoteOutcomeSchema } from '@airp/shared';
import { createWorldRouter } from '../dist/routes/world.js';
import { EventBridge } from '../dist/engine/event-bridge.js';

const MANIFEST = JSON.stringify({
  id: 'proj-nook',
  name: 'Nook',
  description: '',
  author: '',
  genre: 'test',
  createdAt: '',
  updatedAt: '',
  characters: [{ id: 'ryo', name: 'Ryo', home: 'world/map' }],
});

const README = [
  '---',
  'name: Ryo',
  'type: readme',
  'avatar: /api/asset?path=assets/characters/ryo/ryo.png',
  '---',
  '',
  '# Ryo',
  '',
  'Her room.',
  '',
].join('\n');

/** A card md with a declared kind the form table knows. */
const CARD = (title) =>
  `---\ntitle: ${title}\ntype: note\n---\n\n${title} body.\n`;

/** Temp repo root + world; character `ryo` has a README and two cards. */
async function harness() {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-nook-repo-'));
  const world = path.join(repo, 'world-root');
  const store = new LocalWorldStore(world);
  await store.writeFile('world.json', MANIFEST);
  await store.writeFile('world/README.md', '---\nname: Map\ntype: readme\n---\n\n# Map\n');
  await store.writeFile('characters/ryo/README.md', README);
  await store.writeFile('characters/ryo/erased-line.md', CARD('Erased Line'));
  await store.writeFile('characters/ryo/ten-years.md', CARD('Ten Years'));
  // A non-md sibling must NOT appear in `items`, and a nested md reaches the
  // canvas only through its directory's door, never
  // on the root page directly.
  await store.writeFile('characters/ryo/preset.json', '{"id":"ryo"}');
  await store.writeFile('characters/ryo/letters/unsent.md', CARD('Unsent'));

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

// ── N1-A1: the nook page exists and is non-empty ──
test('N1-A1 GET /api/nook?character=ryo -> 200, non-empty items, LayerState shape', async () => {
  const h = await harness();
  try {
    const r = await h.get('/nook?character=ryo');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const b = r.body;
    assert.equal(b.layer, 'characters/ryo');
    assert.ok(Array.isArray(b.items));
    assert.ok(b.items.length >= 2, `items must be non-empty, got ${JSON.stringify(b.items)}`);
    assert.deepEqual(b.links, []);
    assert.deepEqual(b.presence, []);
    assert.equal(typeof b.worldFrozen, 'boolean');
    assert.equal(b.scene?.path, 'characters/ryo/README.md');
    assert.equal(typeof b.bg?.tone, 'string');
    assert.ok(b.audio && 'ambient' in b.audio && 'bgm' in b.audio);

    // Direct children only, minus README, md only — plus one door per direct
    // child DIRECTORY (the `letters/` door; the nested `unsent.md` itself stays
    // off this page, the design notes decision 4).
    const paths = b.items.map((i) => i.path).sort();
    assert.deepEqual(paths, [
      'characters/ryo/erased-line.md',
      'characters/ryo/letters/README.md',
      'characters/ryo/ten-years.md',
    ]);

    // Every item carries the seat fields the canvas needs.
    for (const it of b.items) {
      for (const k of ['x', 'y', 'w', 'h', 'z', 'rot', 'kind', 'filename', 'frontmatter', 'body']) {
        assert.ok(k in it, `item ${it.path} missing ${k}`);
      }
      assert.ok(it.w > 0 && it.h > 0);
    }
  } finally {
    await h.close();
  }
});

test('N1-A1b no README -> 200, scene null (no stub synthesised)', async () => {
  const h = await harness();
  try {
    await h.store.writeFile('characters/bare/preset.json', '{}');
    const r = await h.get('/nook?character=bare');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.scene, null);
    assert.deepEqual(r.body.items, []);
  } finally {
    await h.close();
  }
});

test('N1-A1c bad / missing character id -> 400 invalid_argument', async () => {
  const h = await harness();
  try {
    for (const q of ['', '?character=', '?character=Ryo', '?character=ryo%2F..', '?character=does-not-exist!!']) {
      const r = await h.get(`/nook${q}`);
      assert.equal(r.status, 400, `${q} -> ${r.status} ${JSON.stringify(r.body)}`);
      assert.equal(r.body.code, 'invalid_argument', q);
    }
  } finally {
    await h.close();
  }
});

test('N1-A1d valid id, no directory -> 404 not_found', async () => {
  const h = await harness();
  try {
    const r = await h.get('/nook?character=ghost');
    assert.equal(r.status, 404, JSON.stringify(r.body));
    assert.equal(r.body.code, 'not_found');
  } finally {
    await h.close();
  }
});

// ── N1-A8: the footprint write gate opens for a nook ──
test('N1-A8 POST /api/card/footprint layer=characters/ryo -> 200 updated:1 + measuredAt', async () => {
  const h = await harness();
  try {
    // The row must exist first: GET /api/nook seats unplaced cards (nook 01 §3).
    const page = await h.get('/nook?character=ryo');
    assert.equal(page.status, 200, JSON.stringify(page.body));
    const cardPath = 'characters/ryo/erased-line.md';
    const before = h.store.getLayerCards([cardPath])[0];
    assert.ok(before, 'GET /api/nook must have seated a row');
    assert.equal(before.layer, 'characters/ryo');
    assert.equal(before.measuredAt ?? null, null, 'a fresh seat is not a measurement');

    // A measured height different from the declared one forces a write.
    const measured = { w: before.w + 7, h: before.h + 11 };
    const r = await h.post('/card/footprint', {
      layer: 'characters/ryo',
      boxes: [{ path: cardPath, ...measured }],
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.updated, 1, JSON.stringify(r.body));
    assert.equal(r.body.unchanged, 0);

    const after = h.store.getLayerCards([cardPath])[0];
    assert.equal(after.w, measured.w);
    assert.equal(after.h, measured.h);
    // Field is FLAT on CardRecord (world-store.ts:13-44): no nested `metadata`.
    assert.equal(typeof after.measuredAt, 'string', JSON.stringify(after));
    assert.ok(after.measuredAt.length > 0);

    // Idempotent: a second identical POST writes nothing.
    const again = await h.post('/card/footprint', {
      layer: 'characters/ryo',
      boxes: [{ path: cardPath, ...measured }],
    });
    assert.equal(again.body.updated, 0, JSON.stringify(again.body));
    assert.equal(again.body.unchanged, 1);
  } finally {
    await h.close();
  }
});

test('N1-A8b footprint nook gate: bad id -> 400, missing dir -> 404', async () => {
  const h = await harness();
  try {
    const bad = await h.post('/card/footprint', { layer: 'characters/NOPE!!', boxes: [{ path: 'x', w: 1, h: 1 }] });
    assert.equal(bad.status, 400, JSON.stringify(bad.body));
    assert.equal(bad.body.code, 'invalid_argument');

    const missing = await h.post('/card/footprint', {
      layer: 'characters/ghost',
      boxes: [{ path: 'characters/ghost/a.md', w: 1, h: 1 }],
    });
    assert.equal(missing.status, 404, JSON.stringify(missing.body));
    assert.equal(missing.body.code, 'not_found');
  } finally {
    await h.close();
  }
});

// ── UX player Nook note seam ──
test('POST /api/nook-note writes a direct-child chalk, returns its event sequence, and refreshes through GET', async () => {
  const h = await harness();
  try {
    const input = {
      characterId: 'ryo',
      title: 'A player note',
      body: 'Remember the blue umbrella.',
      clientRef: 'note-test-1',
    };
    const r = await h.post('/nook-note', input);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const outcome = { path: r.body.path, eventSeq: r.body.eventSeq, actor: r.body.actor, created: r.body.created };
    assert.equal(NookNoteOutcomeSchema.safeParse(outcome).success, true, JSON.stringify(outcome));
    assert.equal(r.body.ok, true);
    assert.match(r.body.path, /^characters\/ryo\/\d+-a-player-note\.md$/);
    assert.deepEqual(r.body.actor, { type: 'player' });
    assert.equal(r.body.created, true);

    const raw = await h.store.readFile(r.body.path);
    assert.match(raw, /title: A player note/);
    assert.match(raw, /Remember the blue umbrella\./);

    const events = await h.store.getEventsSince(0);
    assert.equal(events.length, 1);
    assert.equal(events[0].seq, r.body.eventSeq);
    assert.equal(events[0].type, 'entity_created');
    assert.deepEqual(events[0].actor, { type: 'player' });
    assert.equal(events[0].subject, r.body.path);
    assert.equal(events[0].detail.kind, 'chalk');

    // The next read is the refresh contract: no local-only append is needed.
    const page = await h.get('/nook?character=ryo');
    assert.equal(page.status, 200, JSON.stringify(page.body));
    assert.ok(page.body.items.some((item) => item.path === r.body.path));
  } finally {
    await h.close();
  }
});

test('POST /api/nook-note rejects traversal, README/path/frontmatter/link, and actor forgery before writing', async () => {
  const h = await harness();
  try {
    const invalidInputs = [
      { characterId: 'ryo/../ghost', title: 'x', body: 'y' },
      { characterId: 'ryo', title: 'x', body: 'y', path: 'characters/ryo/README.md' },
      { characterId: 'ryo', title: 'x', body: 'y', frontmatter: { type: 'chalk' } },
      { characterId: 'ryo', title: 'x', body: 'y', linkTo: 'world/map/door.md' },
      { characterId: 'ryo', title: 'x', body: 'y', actor: { type: 'god' } },
    ];
    for (const input of invalidInputs) {
      const r = await h.post('/nook-note', input);
      assert.equal(r.status, 400, `${JSON.stringify(input)} -> ${r.status} ${JSON.stringify(r.body)}`);
      assert.equal(r.body.code, 'invalid_argument');
    }
    assert.deepEqual((await h.store.listFiles('characters/ryo')).sort(), [
      'characters/ryo/README.md',
      'characters/ryo/erased-line.md',
      'characters/ryo/letters/unsent.md',
      'characters/ryo/preset.json',
      'characters/ryo/ten-years.md',
    ]);
  } finally {
    await h.close();
  }
});

test('POST /api/nook-note rejects a missing nook and blank note fields', async () => {
  const h = await harness();
  try {
    const missing = await h.post('/nook-note', { characterId: 'ghost', title: 'x', body: 'y' });
    assert.equal(missing.status, 404, JSON.stringify(missing.body));
    assert.equal(missing.body.code, 'not_found');

    for (const input of [
      { characterId: 'ryo', title: 'x', body: '   ' },
      { characterId: 'ryo', title: 'x', body: '   ' },
    ]) {
      const r = await h.post('/nook-note', input);
      assert.equal(r.status, 400, JSON.stringify(r.body));
      assert.equal(r.body.code, 'invalid_argument');
    }
  } finally {
    await h.close();
  }
});
