// GET /api/nook scene addressing + door synthesis.
// Runs against built dist: `pnpm --filter @airp/server build` first.
//
// Before this batch the handler never read `req.query.scene`: `?scene=office`
// returned the ROOT scene byte-for-byte, so a sub-scene was unreachable; and
// `items` held direct-child FILES only, so a sub-directory README (and every
// door) was dropped.
//
// Fixture is built here from scratch: an assertion
// pinned to the number of directories in `templates/fpal` would drift with
// someone else's commits. Counts below are properties of THIS temp world.
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
  id: 'proj-nook-scene',
  name: 'Nook Scene',
  description: '',
  author: '',
  genre: 'test',
  createdAt: '',
  updatedAt: '',
  characters: [{ id: 'ryo', name: 'Ryo', home: 'world/map' }],
});

const README = (name, extra = '') =>
  `---\nname: ${name}\ntype: readme\n${extra}---\n\n# ${name}\n\nRoom.\n`;

/** A card md with a declared kind the form table knows. */
const CARD = (title) => `---\ntitle: ${title}\ntype: note\n---\n\n${title} body.\n`;

/**
 * Temp world for character `ryo`:
 *   README.md                 facade of the root scene
 *   erased-line.md            root card
 *   office/README.md          sub-scene WITH a facade
 *   office/workday-portrait.md  its card
 *   meta/card.md              sub-scene with a card but NO README (stub=false)
 *   empty-room/               COMPLETELY empty sub-scene (stub=true)
 *   a/b/c.md                  grandchild-only dir (`a` door, `b` NOT a root door)
 *   .pi/session.json          dot-dir, must never become a door
 */
async function harness() {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-nook-scene-repo-'));
  const world = path.join(repo, 'world-root');
  const store = new LocalWorldStore(world);
  await store.writeFile('world.json', MANIFEST);
  await store.writeFile('world/README.md', README('Map'));
  await store.writeFile('characters/ryo/README.md', README('Ryo'));
  await store.writeFile('characters/ryo/erased-line.md', CARD('Erased Line'));
  await store.writeFile('characters/ryo/office/README.md', README('Office', 'bg: assets/office.png\n'));
  await store.writeFile('characters/ryo/office/workday-portrait.md', CARD('Workday'));
  await store.writeFile('characters/ryo/meta/card.md', CARD('Meta Card'));
  await fs.mkdir(path.join(world, 'characters/ryo/empty-room'), { recursive: true });
  await store.writeFile('characters/ryo/a/b/c.md', CARD('Deep'));
  // Dot-directories (reserved for tooling) are created outside the store: it
  // refuses to resolve them by design, and `listDirs` skips them anyway.
  const dotDir = path.join(world, 'characters/ryo/.pi');
  await fs.mkdir(dotDir, { recursive: true });
  await fs.writeFile(path.join(dotDir, 'session.json'), '{}');

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
    close: async () => {
      server.close();
      try { store.close(); } catch {}
      await fs.rm(repo, { recursive: true, force: true });
    },
  };
}

const pathsOf = (body) => body.items.map((i) => i.path).sort();
const doorOf = (body, dir) => body.items.find((i) => i.path === `${dir}/README.md`);

// ── N2b-A1: a sub-scene is addressed, and it is NOT the root page ──
test('N2b-A1 GET /nook?character=ryo&scene=office -> layer is the office scene', async () => {
  const h = await harness();
  try {
    const r = await h.get('/nook?character=ryo&scene=office');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    // Before the fix `scene` was ignored: layer stayed 'characters/ryo' and
    // scene.path stayed the ROOT README, i.e. the caller silently got another page.
    assert.equal(r.body.layer, 'characters/ryo/office');
    assert.equal(r.body.scene?.path, 'characters/ryo/office/README.md');
    assert.equal(r.body.scene?.kind, 'scene');
    // The sub-scene's own card, and no door of its own (office has no child dirs).
    assert.deepEqual(pathsOf(r.body), ['characters/ryo/office/workday-portrait.md']);
    assert.equal(r.body.bg?.src, 'assets/office.png', 'bg comes from the SCENE README (OWN-only)');
  } finally {
    await h.close();
  }
});

// ── N2b-A2: count-independent page identity (the fixture may drift) ──
test('N2b-A2 root and sub-scene are different pages (notDeepEqual, no counts)', async () => {
  const h = await harness();
  try {
    const root = (await h.get('/nook?character=ryo')).body;
    const office = (await h.get('/nook?character=ryo&scene=office')).body;
    assert.notDeepEqual(office.items, root.items);
    assert.notEqual(office.layer, root.layer);
    assert.notEqual(office.scene?.path, root.scene?.path);
  } finally {
    await h.close();
  }
});

// ── N2b-A3: doors on the root page; the empty directory proves `listDirs` ──
test('N2b-A3 root items carry one door per DIRECT child directory, incl. the empty one', async () => {
  const h = await harness();
  try {
    const root = (await h.get('/nook?character=ryo')).body;
    assert.equal(root.layer, 'characters/ryo');

    const paths = pathsOf(root);
    assert.ok(paths.includes('characters/ryo/erased-line.md'), JSON.stringify(paths));

    // `empty-room/` holds NO file at all. A directory set derived from `listFiles`
    // (a file walk) cannot see it, so this door is the assertion that fails on a
    // `listFiles`-derived implementation — the whole point of the design notes
    for (const dir of ['office', 'meta', 'empty-room', 'a']) {
      assert.ok(paths.includes(`characters/ryo/${dir}/README.md`), `missing door ${dir}: ${JSON.stringify(paths)}`);
    }

    // Not recursive: `a` is a door, `a/b` is not, and `a/b/c.md` never lands here.
    assert.equal(paths.some((p) => p.startsWith('characters/ryo/a/b')), false, JSON.stringify(paths));

    // Dot-directories never become doors (listDirs skip rule).
    assert.equal(paths.some((p) => p.includes('/.pi')), false, JSON.stringify(paths));

    // Door shape: a gate card the canvas can render + enter.
    const office = doorOf(root, 'characters/ryo/office');
    assert.equal(office.filename, 'README.md');
    assert.equal(office.frontmatter?.name, 'Office');
    assert.equal(office.kind, 'gate');
    assert.ok(office.body.includes('Room.'), 'a written door carries the real README body');

    // `stub` = "this directory itself has nothing readable" (no README AND no card).
    assert.equal(doorOf(root, 'characters/ryo/empty-room').frontmatter?.stub, true);
    assert.equal(doorOf(root, 'characters/ryo/meta').frontmatter?.stub, false, 'meta has a card: UNWRITTEN would be a lie');
    assert.equal(doorOf(root, 'characters/ryo/meta').body, '');
    assert.equal(doorOf(root, 'characters/ryo/a').frontmatter?.stub, true);
  } finally {
    await h.close();
  }
});

// ── N2b-A4: a scene with cards but no README is enterable ──
test('N2b-A4 ?scene=meta -> 200, scene null, its own card, no doors', async () => {
  const h = await harness();
  try {
    const r = await h.get('/nook?character=ryo&scene=meta');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.layer, 'characters/ryo/meta');
    assert.equal(r.body.scene, null, 'no README -> no facade, and none is synthesised');
    assert.deepEqual(pathsOf(r.body), ['characters/ryo/meta/card.md']);
  } finally {
    await h.close();
  }
});

// ── N2b-A5: the shape gate runs BEFORE existence ──
test('N2b-A5 malformed scene -> 400; unknown scene -> 404', async () => {
  const h = await harness();
  try {
    for (const scene of ['office/', '/office', 'a//b', '.pi', '..', 'Office', 'a_b', '../../etc']) {
      const r = await h.get(`/nook?character=ryo&scene=${encodeURIComponent(scene)}`);
      assert.equal(r.status, 400, `${scene} -> ${r.status} ${JSON.stringify(r.body)}`);
      assert.equal(r.body.code, 'invalid_argument', scene);
    }
    // Shape-legal, directory absent — and `scene` pointing at a FILE cannot be
    // tested with an extension because the shape gate rejects every `.` segment
    // first.
    const missing = await h.get('/nook?character=ryo&scene=nope');
    assert.equal(missing.status, 404, JSON.stringify(missing.body));
    assert.equal(missing.body.code, 'not_found');
    assert.match(missing.body.error, /No such scene: "characters\/ryo\/nope"/);
  } finally {
    await h.close();
  }
});

// ── N2b-A6: the root scene is byte-identical to before, plus doors ──
test('N2b-A6 no scene param -> root scene unchanged (layer/scene/links/presence)', async () => {
  const h = await harness();
  try {
    const r = await h.get('/nook?character=ryo');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.layer, 'characters/ryo');
    assert.equal(r.body.scene?.path, 'characters/ryo/README.md');
    assert.equal(r.body.scene?.frontmatter?.name, 'Ryo');
    assert.deepEqual(r.body.links, []);
    assert.deepEqual(r.body.presence, []);
    assert.equal(typeof r.body.worldFrozen, 'boolean');
    for (const it of r.body.items) {
      for (const k of ['x', 'y', 'w', 'h', 'z', 'rot', 'kind', 'filename', 'frontmatter', 'body']) {
        assert.ok(k in it, `item ${it.path} missing ${k}`);
      }
      assert.ok(it.w > 0 && it.h > 0);
    }
    // Doors get a seat on the PARENT page: their row layer is the parent scene id,
    // not the door's own scene.
    const rows = h.store.getLayerCards(['characters/ryo/office/README.md']);
    assert.equal(rows[0]?.layer, 'characters/ryo');
  } finally {
    await h.close();
  }
});
