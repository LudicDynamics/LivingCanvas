/**
 * doc 05 acceptance: `move_to` / `set_following` / `carryFollowers` (05 §10).
 *
 * Imports built `dist/` modules directly, not the barrel: `dist/index.js`
 * re-exports every sibling module in the batch, so one unfinished sibling would
 * block this file at import time. Build first (`pnpm --filter @airp/shared
 * build`), then `node --test packages/shared/test/presence.test.mjs`.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { ActionError } from '../dist/actions/errors.js';
import { createActionService } from '../dist/actions/service.js';
import { carryFollowers, resolveDestinationLayer } from '../dist/actions/presence.js';
import { initializeMissingCharacterPresence } from '../dist/actions/initial-presence.js';
// Import the action modules for their registration side effect (the service
// registry is populated at module load, 01 §2.6).
import '../dist/actions/move-to.js';
import '../dist/actions/following.js';
import { LocalWorldStore } from '../dist/store/local-store.js';

const WRITER = { type: 'writer' };

async function tempWorld() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-presence-test-'));
  const store = new LocalWorldStore(root);
  await store.writeFile(
    'world.json',
    JSON.stringify({
      id: 'proj-1',
      name: 'T',
      description: '',
      author: '',
      genre: 'test',
      characters: [
        { id: 'watson', home: 'world/baker-street' },
        { id: 'constable', home: 'world/baker-street' },
        { id: 'homeless', home: 'world/nowhere' },
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
  );
  await store.writeFile('world/README.md', '---\nname: Map\ntype: readme\n---\n\n# Map\n');
  await store.writeFile(
    'world/baker-street/README.md',
    '---\nname: Baker Street\ntype: readme\n---\n\n# Baker Street\n'
  );
  await store.writeFile(
    'world/baker-street/fireplace.md',
    '---\ntitle: Fireplace\ntype: chalk\n---\n\nA low fire.\n'
  );
  await store.writeFile(
    'world/crime-scene/README.md',
    '---\nname: Crime Scene\ntype: readme\n---\n\n# Crime Scene\n'
  );
  await store.writeFile(
    'world/crime-scene/evening.md',
    '---\ntitle: Evening\ntype: chalk\n---\n\nRain.\n'
  );
  await store.writeFile('characters/watson/README.md', '---\nname: Watson\ntype: readme\n---\n\n');
  await store.writeFile(
    'characters/watson/preset.json',
    JSON.stringify({ id: 'watson' })
  );
  await store.writeFile('characters/constable/README.md', '---\nname: Constable\ntype: readme\n---\n\n');
  await store.writeFile('characters/constable/preset.json', JSON.stringify({ id: 'constable' }));
  // `homeless` exists as a directory but its manifest home is not a layer.
  await store.writeFile('characters/homeless/README.md', '---\nname: Homeless\ntype: readme\n---\n\n');
  await store.writeFile('characters/homeless/preset.json', JSON.stringify({ id: 'homeless' }));
  await store.writeFile('player/copper-key.md', '---\ntitle: Key\ntype: note\n---\n\nA key.\n');
  return { store, root };
}

function service(store, actor = WRITER) {
  return createActionService(store, actor, { turn: 'req:test' });
}

function isActionError(code) {
  return (err) => {
    assert.ok(err instanceof ActionError, `expected ActionError, got ${err}`);
    assert.equal(err.code, code, `expected code ${code}, got ${err.code}: ${err.message}`);
    return true;
  };
}

// ------------------------------------------------- §10.1 resolveDestinationLayer

test('§10.1: the three destination forms dispatch to layer/entity', async () => {
  const { store } = await tempWorld();
  assert.deepEqual(await resolveDestinationLayer(store, 'world/baker-street'), {
    layer: 'world/baker-street',
    kind: 'layer',
  });
  assert.deepEqual(await resolveDestinationLayer(store, 'world'), { layer: 'map', kind: 'layer' });
  assert.deepEqual(await resolveDestinationLayer(store, 'map'), { layer: 'map', kind: 'layer' });
  assert.deepEqual(await resolveDestinationLayer(store, 'world/crime-scene/evening.md'), {
    layer: 'world/crime-scene',
    kind: 'entity',
  });
  // A stub layer (directory, no README) is still a legal destination (05 §3.2).
  await fs.mkdir(path.join(store.worldRoot, 'world', 'stub'));
  assert.deepEqual(await resolveDestinationLayer(store, 'world/stub'), {
    layer: 'world/stub',
    kind: 'layer',
  });

  await assert.rejects(
    () => resolveDestinationLayer(store, 'world/nowhere'),
    isActionError('not_found')
  );
  // `player/**` is a bag, not a scene (05 §3.2).
  await assert.rejects(
    () => resolveDestinationLayer(store, 'player/copper-key.md'),
    isActionError('invalid_argument')
  );
  await assert.rejects(() => resolveDestinationLayer(store, ''), isActionError('invalid_argument'));
  // Path discipline is the action layer's job (05 §7.1): `statKind` would
  // otherwise swallow these into a misleading `not_found`.
  for (const bad of ['/abs/x.md', 'a/../../etc', '.airpworld/assets/x.png', 'a\\b.md']) {
    await assert.rejects(
      () => resolveDestinationLayer(store, bad),
      isActionError('invalid_path')
    );
  }
});

// ------------------------------------------------------ §10.3 the three forms

test('§10.3-4: directory / current-layer entity / other-layer entity', async () => {
  const { store } = await tempWorld();
  const svc = service(store);

  // (1) directory
  const a = await svc.moveCharacter({ character: 'watson', destination: 'world/baker-street' });
  assert.equal(a.details.layer, 'world/baker-street');
  assert.equal(a.details.from, undefined, 'first appearance must omit `from`');
  assert.equal(a.details.moved, true);
  assert.equal(a.details.seat.exhausted, false);
  assert.equal(a.details.event.type, 'character_moved');
  assert.equal(a.details.event.layer, 'world/baker-street');
  assert.equal(a.details.event.subject, 'world/baker-street');
  assert.deepEqual(
    a.details.event.detail,
    { character: 'watson', name: 'Watson', to: 'world/baker-street' },
    'a first appearance carries no `from`'
  );

  // (2) entity in the current layer — implicit `near`, one row stays one row
  const b = await svc.moveCharacter({
    character: 'watson',
    destination: 'world/baker-street/fireplace.md',
  });
  assert.equal(b.details.layer, 'world/baker-street');
  assert.equal(b.details.near, 'world/baker-street/fireplace.md');
  // `details.from` echoes the prior layer whenever a row exists (05 §2.1);
  // it is the EVENT detail that stays cross-layer-only (05 §5.1).
  assert.equal(b.details.from, 'world/baker-street');
  assert.equal(b.details.event.detail.from, undefined, 'same-layer move is not a crossing');
  assert.equal(b.details.moved, true);
  assert.equal(store.getPresence('world/baker-street').length, 1);

  // (3) entity in ANOTHER layer — cross-layer, `from` appears
  const c = await svc.moveCharacter({
    character: 'watson',
    destination: 'world/crime-scene/evening.md',
  });
  assert.equal(c.details.layer, 'world/crime-scene');
  assert.equal(c.details.from, 'world/baker-street');
  assert.equal(c.details.event.detail.from, 'world/baker-street');
  assert.equal(c.details.event.detail.to, 'world/crime-scene');
  // Cross-layer seating looks ONLY at the target layer (05 §3.9.5).
  assert.equal(store.getPresence('world/baker-street').length, 0);
  assert.equal(store.getPresence('world/crime-scene').length, 1);
  // `character_id UNIQUE`: one character, one row, ever.
  assert.equal(store.getPresence().length, 1);
});

test('§10.2-1/2: character_id UNIQUE and the row rewrite', async () => {
  const { store } = await tempWorld();
  const svc = service(store);
  await svc.moveCharacter({ character: 'watson', destination: 'world/baker-street' });
  await svc.moveCharacter({ character: 'watson', destination: 'world/crime-scene' });
  const row = store.getPresenceOf('watson');
  assert.equal(row.layer, 'world/crime-scene');
  assert.equal(store.getPresence().filter((p) => p.characterId === 'watson').length, 1);
});

// ---------------------------------------------------------------- seating

test('§10.2 seatPresence: skips cell 0 and avoids cards + presences', async () => {
  const { store } = await tempWorld();
  // Empty layer → the first candidate after the anchor cell (05 §10.2).
  const empty = await store.seatPresence('map');
  assert.deepEqual({ x: empty.x, y: empty.y }, { x: 1056, y: 540 });
  assert.deepEqual(empty.seat, { gx: 1, gy: 0, tries: 2, exhausted: false });

  // A card covering the anchor forces the walk outward.
  store.execCanvas(
    'INSERT INTO cards (id, layer, x, y, width, height, z_index) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ['world/baker-street/evening.md', 'world/baker-street', 960 - 230, 540 - 95, 460, 190, 1]
  );
  const moved = await store.seatPresence('world/baker-street');
  assert.notDeepEqual({ x: moved.x, y: moved.y }, { x: 1056, y: 540 });

  // Two presences never overlap: centre distance ≥ (176+176)/2+22 = 198.
  await store.upsertPresence({ characterId: 'watson', layer: 'map', x: 1056, y: 540 });
  const second = await store.seatPresence('map');
  const dx = Math.abs(second.x - 1056);
  const dy = Math.abs(second.y - 540);
  assert.ok(dx >= 198 || dy >= 218, `centre distance too small: (${dx}, ${dy})`);

  // `excludeCharacter` frees the character's own seat.
  const own = await store.seatPresence('map', { excludeCharacter: 'watson' });
  assert.deepEqual({ x: own.x, y: own.y }, { x: 1056, y: 540 });
});

test('§10.2 anchorOf: a `near` anchor with no card row is seated first', async () => {
  const { store } = await tempWorld();
  const seat = await store.seatPresence('world/baker-street', {
    near: 'world/baker-street/fireplace.md',
  });
  // The anchor now HAS a row, and the presence sits at ring 1 (not cell 0).
  assert.equal(store.getLayerCards(['world/baker-street/fireplace.md']).length, 1);
  assert.notDeepEqual({ x: seat.x, y: seat.y }, { x: 960, y: 540 });
  assert.ok(Number.isFinite(seat.x) && Number.isFinite(seat.y));
});

// --------------------------------------------------------------- no-op paths

test('§3.7: same layer without `near` is a no-op', async () => {
  const { store } = await tempWorld();
  const svc = service(store);
  await svc.moveCharacter({ character: 'watson', destination: 'world/baker-street' });
  const before = await store.getMaxSeq();
  const again = await svc.moveCharacter({ character: 'watson', destination: 'world/baker-street' });
  assert.equal(again.details.moved, false);
  assert.equal(again.details.event, undefined);
  assert.equal(again.text, 'Watson is already in "Baker Street".');
  assert.equal(await store.getMaxSeq(), before, 'a no-op must not land an event');
});

test('REVIEW M-3: set_following(false) on a character with NO presence row writes nothing', async () => {
  const { store } = await tempWorld();
  const svc = service(store);
  const before = await store.getMaxSeq();

  const r = await svc.setFollowing({ character: 'constable', following: false });

  assert.equal(r.details.changed, false);
  assert.equal(r.details.created, false);
  assert.equal(r.details.following, false);
  assert.equal(r.details.event, undefined);
  // THE point of M-3: no phantom (0,0) row may appear.
  assert.equal(store.getPresenceOf('constable'), null);
  assert.equal(store.getPresence().length, 0);
  assert.equal(await store.getMaxSeq(), before);
  assert.match(r.text, /not in the world and is not following/);
});

test('§3.6.1: set_following(true) creates the row at the manifest home', async () => {
  const { store } = await tempWorld();
  const svc = service(store);

  const r = await svc.setFollowing({ character: 'constable', following: true });
  assert.equal(r.details.created, true);
  assert.equal(r.details.changed, true);
  assert.equal(r.details.landedFromHome, true);
  assert.equal(r.details.layer, 'world/baker-street');
  const row = store.getPresenceOf('constable');
  assert.equal(row.following, true);
  assert.equal(row.layer, 'world/baker-street');
  assert.equal(r.details.event.type, 'following_changed');
  assert.deepEqual(r.details.event.detail, { character: 'constable', name: 'Constable', following: true });

  // A missing / non-layer home degrades to `map` and says so.
  const homeless = await svc.setFollowing({ character: 'homeless', following: true });
  assert.equal(homeless.details.landedFromHome, false);
  assert.equal(homeless.details.layer, 'map');
});

test('§3.6.1: an existing row only flips the flag, never the coordinates', async () => {
  const { store } = await tempWorld();
  const svc = service(store);
  await svc.moveCharacter({ character: 'watson', destination: 'world/baker-street' });
  const seat = store.getPresenceOf('watson');

  const idle = await svc.setFollowing({ character: 'watson', following: false });
  assert.equal(idle.details.changed, false, 'already false → no-op');
  assert.equal(idle.details.event, undefined);

  const on = await svc.setFollowing({ character: 'watson', following: true });
  assert.equal(on.details.changed, true);
  assert.equal(on.details.created, false);
  assert.equal(on.details.event.detail.following, true);
  assert.deepEqual(
    { x: on.details.x, y: on.details.y, layer: on.details.layer },
    { x: seat.x, y: seat.y, layer: 'world/baker-street' }
  );
  const off = await svc.setFollowing({ character: 'watson', following: false });
  assert.equal(off.details.changed, true);
  assert.equal(store.getPresenceOf('watson').following, false);
});

// ----------------------------------------------------------- carryFollowers

test('§10.2 carryFollowers: only off-layer followers move, following is kept', async () => {
  const { store } = await tempWorld();
  const svc = service(store);
  await svc.moveCharacter({ character: 'watson', destination: 'world/baker-street' });
  await svc.moveCharacter({ character: 'constable', destination: 'world/crime-scene' });
  await svc.setFollowing({ character: 'watson', following: true }); // at the target layer
  await svc.setFollowing({ character: 'constable', following: true }); // off-layer
  await store.upsertPresence({ characterId: 'homeless', layer: 'world/crime-scene', x: 1, y: 1 });

  const before = await store.getMaxSeq();
  const ctx = { store, actor: { type: 'engine' }, turn: 'req:enter' };
  const { moved, failures } = await carryFollowers(ctx, 'world/baker-street');

  assert.deepEqual(failures, []);
  assert.equal(moved.length, 1);
  assert.equal(moved[0].characterId, 'constable');
  assert.equal(moved[0].following, true, 'carrying a follower must not un-follow them');
  assert.equal(store.getPresenceOf('constable').layer, 'world/baker-street');
  assert.equal(store.getPresenceOf('watson').layer, 'world/baker-street');
  assert.equal(store.getPresenceOf('homeless').layer, 'world/crime-scene');

  const created = await store.getEventsSince(before);
  assert.equal(created.length, 1);
  assert.equal(created[0].type, 'character_moved');
  assert.equal(created[0].actor.type, 'engine');
  assert.equal(created[0].detail.from, 'world/crime-scene');
  assert.equal(created[0].detail.to, 'world/baker-street');
  assert.equal(created[0].turn, 'req:enter');

  // Re-entering the same layer must not re-move anyone (05 §3.6.2 detail 2).
  const again = await carryFollowers(ctx, 'world/baker-street');
  assert.equal(again.moved.length, 0);
  assert.equal(again.failures.length, 0);
});

// ------------------------------------------------------------------ identity

test('§2.4: omitted `character` defaults to self only for a character agent', async () => {
  const { store } = await tempWorld();
  const watson = service(store, { type: 'character', id: 'watson' });
  const r = await watson.moveCharacter({ destination: 'world/baker-street' });
  assert.equal(r.details.character, 'watson');

  await assert.rejects(
    () => service(store).moveCharacter({ destination: 'map' }),
    (err) => {
      assert.ok(err instanceof ActionError);
      assert.equal(err.code, 'invalid_argument');
      assert.match(err.message, /AIRP_AGENT_ROLE/);
      return true;
    }
  );
  await assert.rejects(
    () => service(store).moveCharacter({ character: '../watson', destination: 'map' }),
    isActionError('invalid_argument')
  );
  await assert.rejects(
    () => service(store).moveCharacter({ character: 'sherlock', destination: 'map' }),
    isActionError('not_found')
  );
});

test('§3.3: a cross-layer `near` is refused and the presence is untouched', async () => {
  const { store } = await tempWorld();
  const svc = service(store);
  await svc.moveCharacter({ character: 'watson', destination: 'world/baker-street' });
  const before = store.getPresenceOf('watson');

  await assert.rejects(
    () =>
      svc.moveCharacter({
        character: 'watson',
        destination: 'world/baker-street',
        near: 'world/crime-scene/evening.md',
      }),
    isActionError('near_out_of_layer')
  );
  assert.deepEqual(store.getPresenceOf('watson'), before);
  await assert.rejects(
    () =>
      svc.moveCharacter({
        character: 'watson',
        destination: 'world/baker-street',
        near: 'world/baker-street',
      }),
    isActionError('near_out_of_layer')
  );
});

test('§3.8: characters/<id>/ is never touched by a move', async () => {
  const { store } = await tempWorld();
  const svc = service(store);
  const before = await store.listFiles('characters/watson');
  await svc.moveCharacter({ character: 'watson', destination: 'world/crime-scene' });
  const after = await store.listFiles('characters/watson');
  assert.deepEqual(after, before);
});

// ------------------------------------------------------------ schema migration

test('§3.4: the presence table gets UNIQUE(character_id) + idx_presence_layer, once', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { initCanvasDatabase } = await import('../dist/db/schema.js');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-presence-schema-'));
  const dbPath = path.join(root, 'canvas.db');
  try {
    // The pre-05 shape: no UNIQUE, no index.
    const old = new DatabaseSync(dbPath);
    old.exec(`CREATE TABLE presence (
      id TEXT PRIMARY KEY, character_id TEXT NOT NULL, layer TEXT NOT NULL,
      x REAL NOT NULL DEFAULT 0, y REAL NOT NULL DEFAULT 0,
      following INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);`);
    old.close();

    const db = new DatabaseSync(dbPath);
    initCanvasDatabase(db);
    const indexes = db.prepare('PRAGMA index_list(presence)').all();
    assert.ok(indexes.some((i) => i.origin === 'u' && Number(i.unique) === 1), 'UNIQUE is in place');
    assert.ok(indexes.some((i) => String(i.name) === 'idx_presence_layer'));

    // The natural key must actually reject a second row per character.
    db.prepare('INSERT INTO presence VALUES (?,?,?,?,?,?,?)').run('presence:w', 'w', 'map', 1, 1, 0, 'now');
    assert.throws(() =>
      db.prepare('INSERT INTO presence VALUES (?,?,?,?,?,?,?)').run('other', 'w', 'map', 2, 2, 0, 'now')
    );

    // Re-running init must not wipe the standing characters.
    initCanvasDatabase(db);
    assert.equal(Number(db.prepare('SELECT COUNT(*) AS n FROM presence').get().n), 1);
    db.close();
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('initial world load fills missing presence at home and is idempotent', async () => {
  const { store } = await tempWorld();
  const first = await initializeMissingCharacterPresence(store, { turn: 'init:test' });
  assert.equal(first.initialized.length, 3);
  assert.equal(store.getPresence().length, 3);
  assert.deepEqual(
    Object.fromEntries(store.getPresence().map((row) => [row.characterId, row.layer])),
    { constable: 'world/baker-street', homeless: 'map', watson: 'world/baker-street' },
  );
  const positions = Object.fromEntries(
    store.getPresence().map((row) => [row.characterId, { x: row.x, y: row.y, following: row.following }]),
  );
  const eventCount = (await store.getEventsSince(0)).length;
  const second = await initializeMissingCharacterPresence(store, { turn: 'init:retry' });
  assert.equal(second.initialized.length, 0);
  assert.deepEqual(
    Object.fromEntries(store.getPresence().map((row) => [row.characterId, { x: row.x, y: row.y, following: row.following }])),
    positions,
  );
  assert.equal((await store.getEventsSince(0)).length, eventCount);
});

test('initial presence retries after its event append fails', async () => {
  const { store } = await tempWorld();
  const appendEvent = store.appendEvent.bind(store);
  store.appendEvent = async () => { throw new Error('db locked'); };
  await assert.rejects(
    () => initializeMissingCharacterPresence(store, { turn: 'init:failed' }),
    /db locked/,
  );
  assert.equal(store.getPresence().length, 0, 'failed initialization must not leave a presence row');
  store.appendEvent = appendEvent;
  const retry = await initializeMissingCharacterPresence(store, { turn: 'init:retry' });
  assert.equal(retry.initialized.length, 3);
  assert.equal(store.getPresence().length, 3);
});
