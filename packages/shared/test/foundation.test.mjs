import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import {
  AGENT_ROLE_ENV,
  ActionError,
  HTTP_STATUS,
  LocalWorldStore,
  WORLD_EVENT_TYPES,
  EventDetailSchemas,
  initHistoryDatabase,
  readerOfActor,
  resolveAgentActor,
} from '../dist/index.js';

// ---------------------------------------------------------------- actor table

test('resolveAgentActor degradation table (01 §2.3)', () => {
  const rows = [
    ['writer', { type: 'writer' }, null],
    ['character:watson', { type: 'character', id: 'watson' }, null],
    [
      'character:',
      { type: 'writer' },
      "AIRP_AGENT_ROLE='character:' has an empty id; falling back to writer",
    ],
    ['scene-init', { type: 'writer' }, null],
    ['nook-init', { type: 'writer' }, null],
    [undefined, { type: 'writer' }, 'AIRP_AGENT_ROLE is not set; falling back to writer'],
    ['', { type: 'writer' }, 'AIRP_AGENT_ROLE is not set; falling back to writer'],
    ['foo', { type: 'writer' }, "Unknown AIRP_AGENT_ROLE='foo'; falling back to writer"],
  ];
  for (const [raw, actor, warning] of rows) {
    const got = resolveAgentActor(raw);
    assert.deepEqual(got.actor, actor, `actor for ${JSON.stringify(raw)}`);
    assert.equal(got.warning, warning, `warning for ${JSON.stringify(raw)}`);
  }
  assert.equal(AGENT_ROLE_ENV, 'AIRP_AGENT_ROLE');
});

test('readerOfActor mapping (01 §2.3)', () => {
  assert.equal(readerOfActor({ type: 'writer' }), 'writer');
  assert.equal(readerOfActor({ type: 'character', id: 'watson' }), 'character:watson');
  assert.equal(readerOfActor({ type: 'player' }), null);
  assert.equal(readerOfActor({ type: 'god' }), null);
  assert.equal(readerOfActor({ type: 'engine' }), null);
});

// -------------------------------------------------------------- error surface

test('HTTP_STATUS is exhaustive over ActionErrorCode and carries the adjudicated values', () => {
  assert.equal(HTTP_STATUS.dice_already_rolled, 409);
  assert.equal(HTTP_STATUS.no_free_seat, 507);
  assert.equal(HTTP_STATUS.not_movable, 409);
  assert.equal(HTTP_STATUS.invalid_asset_ref, 400);
  // doc-command/05 §7 — the three idempotency codes this batch added. Their
  // statuses are adjudicated, not incidental: a corrupt log is an unprocessable
  // file (422), while a full log and a drifted resume are state conflicts (409).
  assert.equal(HTTP_STATUS.command_log_corrupt, 422);
  assert.equal(HTTP_STATUS.command_log_full, 409);
  assert.equal(HTTP_STATUS.command_resume_drifted, 409);
  // the design notes: acting in a closed world that has ended is a
  // state conflict, not a bad request.
  assert.equal(HTTP_STATUS.game_ended, 409);
  // Exhaustiveness is guaranteed at compile time by `Record<ActionErrorCode, number>`;
  // this count is the mechanical proxy that catches a code added to the union but
  // forgotten in the map. Bump it in the same commit that adds a code.
  // `player_owned`: a player note is the player's alone.
  assert.equal(HTTP_STATUS.player_owned, 403);
  assert.equal(Object.keys(HTTP_STATUS).length, 24);
  const err = new ActionError({ code: 'not_found', message: 'nope' });
  assert.equal(err.httpStatus, 404);
  assert.deepEqual(err.toHttp(), { status: 404, body: { ok: false, code: 'not_found', error: 'nope' } });
  assert.equal(err.toToolResult().isError, true);
});

// ----------------------------------------------------------- detail schemas

test('EventDetailSchemas covers the closed seventeen and rejects bad shapes', () => {
  // Fifteen, plus `ending_reached` for closed worlds
  // and `story_event` for what a roll lands on a character / item / place;
  // `cg_shown` / `background_swapped` for scene media.
  // + `player_board_changed` for the player's clue board.
  // + `loop_reset` for a looping world going back to its first morning.
  assert.equal(WORLD_EVENT_TYPES.length, 22);
  assert.equal(Object.keys(EventDetailSchemas).length, 22);
  for (const type of WORLD_EVENT_TYPES) {
    assert.ok(EventDetailSchemas[type], `missing detail schema for ${type}`);
  }
  const created = EventDetailSchemas.entity_created;
  assert.equal(created.safeParse({ path: 'world/x.md', name: 'X', kind: 'chalk' }).success, true);
  assert.equal(created.safeParse({ path: 'world/x.md', kind: 'chalk' }).success, false, 'missing name');
  assert.equal(created.safeParse({ path: 'world/x.md', name: 'X', kind: 'asset' }).success, false, 'bad kind');
  assert.equal(
    EventDetailSchemas.entity_moved.safeParse({
      from: 'a', to: 'b', name: 'n', rewrote: 1, dangling: 0,
      bogus: true,
    }).success,
    true,
    'extra keys are allowed'
  );
});

// ------------------------------------------------------------------- store

async function tempStore() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-shared-test-'));
  const store = new LocalWorldStore(root);
  await store.writeFile(
    'world.json',
    JSON.stringify({
      id: 'proj-1',
      name: 'T',
      description: '',
      author: '',
      genre: 'test',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
  );
  await store.writeFile('world/README.md', '---\nname: Map\ntype: readme\n---\n\n# Map\n');
  await store.writeFile('world/inn/README.md', '---\nname: Inn\ntype: readme\n---\n\n# Inn\n');
  return { store, root };
}

test('resolvePath rejects escapes and reserved trees, allows .airpworld/assets', async () => {
  const { store, root } = await tempStore();
  try {
    await store.writeFile('player/key.md', '# key');
    assert.equal(await store.statKind('player/key.md'), 'file');

    await assert.rejects(() => store.writeFile('../etc/passwd', 'x'), (err) => {
      assert.ok(err instanceof ActionError);
      assert.equal(err.code, 'invalid_path');
      return true;
    });
    await assert.rejects(() => store.writeFile('a/../../etc/passwd', 'x'), /must not contain/);
    await assert.rejects(() => store.writeFile('/etc/passwd', 'x'), /world-relative/);
    await assert.rejects(() => store.writeFile('node_modules/x.md', 'x'), /reserved directory/);
    await assert.rejects(() => store.writeFile('.airpworld/history.db', 'x'), /reserved directory/);
    await assert.rejects(() => store.writeFile('', 'x'), (err) => {
      assert.equal(err.code, 'invalid_argument');
      return true;
    });

    // The ONE allowed hidden subtree: generated assets are world content.
    await store.writeFileAtomic('.airpworld/assets/gen/eye.png', Buffer.from([1, 2, 3]));
    assert.equal(await store.statKind('.airpworld/assets/gen/eye.png'), 'file');
    assert.equal(await store.readFileBase64('.airpworld/assets/gen/eye.png'), Buffer.from([1, 2, 3]).toString('base64'));

    assert.ok(!(await fs.readdir(root)).includes('etc'), 'nothing escaped the world root');
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('resolveLayer: world/** maps to a layer, bag/character paths map to null', async () => {
  const { store, root } = await tempStore();
  try {
    assert.equal(await store.resolveLayer('world/inn/1-key.md'), 'world/inn');
    assert.equal(await store.resolveLayer('world/README.md'), 'map');
    assert.equal(await store.resolveLayer('world/inn/README.md'), 'world/inn');
    assert.equal(await store.resolveLayer('player/key.md'), null);
    assert.equal(await store.resolveLayer('characters/watson/letter.md'), null);
    assert.equal(await store.resolveLayer('world.json'), null);
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('events: seq ordering, filters, cursors', async () => {
  const { store, root } = await tempStore();
  try {
    const a = await store.appendEvent({
      type: 'entity_created',
      actor: { type: 'writer' },
      detail: { path: 'world/inn/1-key.md', name: 'Key', kind: 'chalk' },
      subject: 'world/inn/1-key.md',
      layer: 'world/inn',
      turn: 'turn:s:1',
    });
    const b = await store.appendEvent({
      type: 'entity_created',
      actor: { type: 'character', id: 'watson' },
      detail: { path: 'world/inn/2-note.md', name: 'Note', kind: 'note' },
      subject: 'world/inn/2-note.md',
      layer: 'world/inn',
      turn: 'turn:s:1',
    });
    await store.appendEvent({
      type: 'world_snapshot',
      actor: { type: 'engine' },
      detail: { snapshot: 's1', reason: 'r' },
      turn: 'turn:s:1',
    });

    assert.equal(a.seq, 1);
    assert.equal(a.id, 'evt-1');
    assert.equal(b.seq, 2);
    assert.equal(await store.getMaxSeq(), 3);

    const asc = await store.getEventsSince(0);
    assert.deepEqual(asc.map((e) => e.seq), [1, 2, 3]);
    assert.equal(asc[1].actor.id, 'watson');
    assert.equal(asc[2].layer, null);

    const desc = await store.getEvents(3);
    assert.deepEqual(desc.map((e) => e.seq), [3, 2, 1]);

    const layerFiltered = await store.getEventsSince(0, { layer: 'world/inn' });
    assert.deepEqual(layerFiltered.map((e) => e.seq), [1, 2], 'NULL layer rows are excluded');

    const excluded = await store.getEventsSince(0, { excludeActor: { type: 'character', id: 'watson' } });
    assert.deepEqual(excluded.map((e) => e.seq), [1, 3], 'excludeActor keeps writer + engine');

    assert.equal(await store.readCursor('writer'), 0);
    await store.writeCursor('writer', 5);
    assert.equal(await store.readCursor('writer'), 5);
    await store.writeCursor('writer', 3);
    assert.equal(await store.readCursor('writer'), 3, 'no implicit monotonic clamp');
    assert.deepEqual(await store.getAllReadCursors(), [{ reader: 'writer', seq: 3 }]);
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('appendEvent rejects a detail that breaks its own schema', async () => {
  const { store, root } = await tempStore();
  try {
    await assert.rejects(
      () => store.appendEvent({ type: 'entity_moved', actor: { type: 'player' }, detail: { from: 'a' } }),
      (err) => {
        assert.ok(err instanceof ActionError);
        assert.equal(err.code, 'invalid_argument');
        return true;
      }
    );
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('writeFileAtomic leaves no temp residue and survives overwrite', async () => {
  const { store, root } = await tempStore();
  try {
    await store.writeFileAtomic('world/inn/1-key.md', 'first');
    await store.writeFileAtomic('world/inn/1-key.md', 'second');
    assert.equal(await store.readFile('world/inn/1-key.md'), 'second');
    const entries = await fs.readdir(path.join(root, 'world/inn'));
    assert.ok(!entries.some((e) => e.includes('.tmp-')), `no temp files left: ${entries}`);
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('history database migration: old five-column events is rebuilt, new shape is kept', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-migrate-test-'));
  const dbPath = path.join(root, 'history.db');
  try {
    // Old B0 shape + a row that must not survive the one-time rebuild.
    const old = new DatabaseSync(dbPath);
    old.exec(`
      CREATE TABLE events (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, type TEXT NOT NULL,
        payload TEXT NOT NULL, created_at TEXT NOT NULL
      );
    `);
    old.prepare('INSERT INTO events VALUES (?,?,?,?,?)').run('old', 'p', 'roll_resolved', '{}', 'now');
    old.close();

    const migrated = new DatabaseSync(dbPath);
    initHistoryDatabase(migrated);
    const cols = migrated.prepare('PRAGMA table_info(events)').all().map((c) => c.name);
    assert.ok(cols.includes('seq') && cols.includes('actor_type') && cols.includes('detail'));
    migrated.prepare(
      `INSERT INTO events (id, project_id, type, actor_type, actor_id, layer, subject, turn, detail, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).run('evt-1', 'p', 'entity_created', 'writer', null, null, null, null, '{}', 'now');

    // Running it again must NOT wipe the row (REVIEW B-4).
    initHistoryDatabase(migrated);
    const count = migrated.prepare('SELECT COUNT(*) AS n FROM events').get().n;
    assert.equal(Number(count), 1, 'second init keeps history');
    migrated.close();
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('move rewrites only real references; prose mentions become dangling', async () => {
  const { store, root } = await tempStore();
  try {
    await store.writeFile('world/inn/copper-key.md', '---\ntitle: Copper Key\ntype: chalk\n---\n\nA key.\n');
    await store.writeFile(
      'world/inn/cabinet.md',
      '---\ntitle: Cabinet\ntype: component\ntarget: world/inn/copper-key.md\n---\n\nSee [the key](./copper-key.md).\n'
    );
    await store.writeFile(
      'world/inn/prose.md',
      '---\ntitle: Prose\ntype: chalk\n---\n\nHe left copper-key.md on the counter.\n'
    );
    await store.writeFile(
      'world/inn/decoy.md',
      '---\ntitle: Decoy\ntype: chalk\n---\n\nA backup: copper-key.md.bak matters here.\n'
    );

    const result = await store.move('world/inn/copper-key.md', 'player/copper-key.md');

    const cabinet = await store.readFile('world/inn/cabinet.md');
    assert.match(cabinet, /target: player\/copper-key\.md/, 'frontmatter path key rewritten');
    assert.match(cabinet, /\[the key\]\(\.\.\/\.\.\/player\/copper-key\.md\)/, 'markdown link rewritten relatively');

    const prose = await store.readFile('world/inn/prose.md');
    assert.equal(prose.includes('copper-key.md'), true, 'prose mention NOT rewritten');
    assert.equal(result.rewrote.includes('world/inn/prose.md'), false);

    const decoy = await store.readFile('world/inn/decoy.md');
    assert.match(decoy, /copper-key\.md\.bak/, 'substring filename not rewritten');

    const danglingFiles = result.dangling.map((d) => d.file);
    assert.ok(danglingFiles.includes('world/inn/prose.md'), `prose reported dangling: ${JSON.stringify(result.dangling)}`);
    assert.equal(result.dangling.every((d) => d.reason === 'ambiguous'), true);

    const events = await store.getEventsSince(0);
    const moved = events.find((e) => e.type === 'entity_moved');
    assert.ok(moved, 'entity_moved recorded');
    assert.equal(moved.detail.to, 'player/copper-key.md');
    assert.equal(moved.detail.name, 'Copper Key');
    assert.equal(moved.layer, 'world/inn', 'layer keeps the world-tree end (01 §3.9)');
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
