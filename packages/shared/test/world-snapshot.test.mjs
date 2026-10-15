/**
 * doc-16 acceptance: snapshot打点 + rollback restore + append-only events.
 *
 * Imports built `dist/` modules directly, not the barrel (the same reason as
 * move.test.mjs). Build first (`pnpm --filter @airp/shared build`), then
 * `node --test packages/shared/test/world-snapshot.test.mjs`.
 *
 * What this defends:
 *   - a snapshot is a real zip under `.airpworld/snapshots/` and does not nest
 *     the previous snapshots;
 *   - a rollback returns the world FILES to the captured state (added files
 *     disappear, changed files revert, deleted files come back);
 *   - the event table is append-only: rollback ADDS `world_rolled_back` and
 *     every read cursor lands on that event's own seq (never re-reading the
 *     pre-rollback backlog, never swallowing the rollback sentence);
 *   - state (`canvas.db` / `history.db`) is never restored from the archive.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { ActionError } from '../dist/actions/errors.js';
import { createActionService } from '../dist/actions/service.js';
// Side-effect imports: the service dispatches through a registry populated at
// module-import time, and these tests deliberately avoid the barrel.
import '../dist/actions/layer.js';
import { rollbackWorld, snapshotWorld } from '../dist/actions/world.js';
import { LocalWorldStore } from '../dist/store/local-store.js';

async function tempStore() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-snapshot-test-'));
  const store = new LocalWorldStore(root);
  await store.writeFile(
    'world.json',
    JSON.stringify({
      id: 'proj-snap',
      name: 'Snap',
      description: '',
      author: '',
      genre: 'test',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
  );
  await store.writeFile('world/README.md', '---\nname: Map\ntype: readme\n---\n\n# Map\n');
  await store.writeFile('world/inn/README.md', '---\nname: Inn\ntype: readme\n---\n\n# Inn\n');
  await store.writeFile('world/inn/01-note.md', '---\ntype: note\n---\n\noriginal note\n');
  return { store, root };
}

function code(expected) {
  return (error) => {
    assert.ok(error instanceof ActionError, `expected ActionError, got ${error}`);
    assert.equal(error.code, expected);
    return true;
  };
}

test('a snapshot is a real zip and excludes the snapshot store', async () => {
  const { store, root } = await tempStore();
  const svc = createActionService(store, { type: 'god' }, { turn: 'req:snapshot' });
  const first = await svc.snapshotWorld({ reason: 'plot beat' });

  assert.equal(first.details.reason, 'plot beat');
  assert.match(first.details.path, /^\.airpworld\/snapshots\/snap-.+\.zip$/);
  assert.ok(first.details.files >= 4, `expected the world files in the archive, got ${first.details.files}`);
  assert.equal(first.details.event.type, 'world_snapshot');

  // `.airpworld/snapshots` is deliberately outside the store's `resolvePath`
  // surface (only `.airpworld/assets` is), so the archive is checked on disk.
  assert.ok((await fs.stat(path.join(root, first.details.path))).isFile());

  // A second snapshot must not contain the first archive.
  const second = await svc.snapshotWorld({ reason: 'second' });
  assert.notEqual(second.details.snapshot, first.details.snapshot);
  assert.equal(second.details.files, first.details.files, 'snapshot store leaked into the archive');
});

test('a rollback returns the files to the captured state', async () => {
  const { store, root } = await tempStore();
  const svc = createActionService(store, { type: 'god' }, { turn: 'req:rollback' });
  const snap = await svc.snapshotWorld({ reason: 'before the cellar' });

  // Mutate: rewrite one file, add another, delete a third.
  await store.writeFile('world/inn/01-note.md', '---\ntype: note\n---\n\nrewritten\n');
  await store.writeFile('world/inn/02-extra.md', '---\ntype: note\n---\n\nadded later\n');
  await store.deleteFile('world/inn/README.md');

  const back = await svc.rollbackWorld({ snapshot: snap.details.snapshot });
  assert.equal(back.details.snapshot, snap.details.snapshot);
  assert.ok(back.details.removed >= 1, 'the file added after the snapshot must be removed');
  assert.ok(back.details.restored >= 4, `expected the capture to be restored, got ${back.details.restored}`);

  assert.equal(await store.statKind('world/inn/02-extra.md'), 'missing');
  assert.match(await store.readFile('world/inn/01-note.md'), /original note/);
  assert.equal(await store.statKind('world/inn/README.md'), 'file');

  // State files are NOT part of the restore surface.
  assert.ok((await fs.stat(path.join(root, '.airpworld', 'history.db'))).isFile());
  await fs.stat(path.join(root, '.airpworld', 'canvas.db'));
});

test('rollback appends world_rolled_back and flushes every cursor to its own seq', async () => {
  const { store } = await tempStore();
  const writer = createActionService(store, { type: 'writer' }, { turn: 'writer:turn:1' });
  const god = createActionService(store, { type: 'god' }, { turn: 'req:cursor' });

  const snap = await god.snapshotWorld({ reason: 'anchor' });
  await store.writeCursor('writer', snap.details.event.seq);
  await store.writeCursor('character:watson', 0);

  // Newer events a stale cursor would otherwise re-read.
  await writer.enterLayer({ layer: 'world/inn' });
  const maxBefore = await store.getMaxSeq();
  assert.ok(maxBefore > snap.details.event.seq);

  const back = await god.rollbackWorld({ snapshot: snap.details.snapshot });

  // Append-only: the rollback row is new, and the cursor sits exactly on it.
  assert.ok(back.details.event.seq > maxBefore);
  assert.equal(await store.readCursor('writer'), back.details.event.seq);
  assert.equal(await store.readCursor('character:watson'), back.details.event.seq);

  // The writer can still READ the rollback sentence (merged window is non-empty).
  const events = await store.getEventsSince(await store.readCursor('writer') - 1);
  assert.ok(
    events.some((e) => e.type === 'world_rolled_back'),
    'the rollback event must remain visible to the writer',
  );
  // ...but not the pre-rollback backlog.
  assert.ok(!events.some((e) => e.type === 'layer_entered'));
});

test('rollback rejects an unknown snapshot and a bad reason', async () => {
  const { store } = await tempStore();
  const svc = createActionService(store, { type: 'god' }, { turn: 'req:bad' });
  await assert.rejects(() => svc.rollbackWorld({ snapshot: 'snap-nope' }), code('not_found'));
  await assert.rejects(() => svc.snapshotWorld({ reason: '   ' }), code('invalid_argument'));
  // A character may not govern the world.
  const character = createActionService(store, { type: 'character', id: 'watson' }, { turn: 'req:char' });
  await assert.rejects(() => character.snapshotWorld({ reason: 'nope' }), code('unsupported'));
});

test('the exported functions are callable directly, not only through the service', async () => {
  const { store } = await tempStore();
  const svc = createActionService(store, { type: 'engine' }, { turn: 'req:direct' });
  const snap = await snapshotWorld(svc.ctx, { reason: 'direct call' });
  const back = await rollbackWorld(svc.ctx, { snapshot: snap.details.snapshot });
  assert.ok(back.details.restored > 0);
});
