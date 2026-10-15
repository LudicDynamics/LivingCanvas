import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { LocalWorldStore } from '../dist/store/local-store.js';
import { readCanvasSnapshot } from '../dist/render/canvas-snapshot.js';
import { arrangeCanvas } from '../dist/actions/canvas.js';
import { ActionError } from '../dist/actions/errors.js';

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-canvas-snapshot-'));
  const store = new LocalWorldStore(root);
  await store.writeFile(
    'world.json',
    JSON.stringify({
      id: 'snapshot-world',
      name: 'Snapshot fixture',
      description: '',
      author: '',
      genre: 'test',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }),
  );
  await store.writeFile('world/README.md', '---\nname: Map\ntype: readme\n---\n\n# Map\n');
  await store.writeFile('world/room/README.md', '---\nname: Room\ntype: readme\n---\n\n# Room\n');
  await store.writeFile('world/room/a.md', '---\ntype: note\n---\n\nA\n');
  await store.writeFile('world/room/b.md', '---\ntype: note\n---\n\nB\n');
  await store.writeFile('world/room/c.md', '---\ntype: chalk\n---\n\nC\n');
  return { root, store };
}

test('CanvasSnapshotV1 is stable and fences real row geometry', async () => {
  const { root, store } = await fixture();
  try {
    await store.seatUnplaced('world/room', [
      { path: 'world/room/a.md', w: 280, h: 200 },
      { path: 'world/room/b.md', w: 280, h: 180 },
    ]);
    await store.placeCard('world/room', 'world/room/a.md', { x: 0, y: 0 });
    await store.placeCard('world/room', 'world/room/b.md', { x: 100, y: 100 });
    await store.upsertLink({
      layer: 'world/room',
      from: 'world/room/a.md',
      to: 'world/room/b.md',
      id: 'lnk-fixture',
      style: 'ink',
      color: 'rust',
      directed: true,
      z: 4,
      label: 'near',
    });
    await store.upsertPresence({ characterId: 'watson', layer: 'world/room', x: 50, y: 70, following: true });
    store.writeViewpoint({
      layer: 'world/room',
      focus: { x: 200, y: 300, w: 800, h: 600 },
      selected: ['world/room/a.md'],
      bagCount: 2,
    });

    const now = Date.now();
    const first = await readCanvasSnapshot(store, { layer: 'world/room' }, { now });
    const second = await readCanvasSnapshot(store, { layer: 'world/room' }, { now: now + 1000 });
    assert.equal(first.identity.version, 'canvas-snapshot-v1');
    assert.equal(first.identity.snapshotId, second.identity.snapshotId, 'capturedAt is not hashed');
    assert.notEqual(first.identity.capturedAt, second.identity.capturedAt);
    assert.equal(first.rows.length, 2);
    assert.deepEqual(first.rows.map((row) => row.path), ['world/room/a.md', 'world/room/b.md']);
    assert.deepEqual(first.rows.map((row) => [row.w, row.h]), [[280, 200], [280, 180]]);
    assert.deepEqual(first.overlaps, [['world/room/a.md', 'world/room/b.md']]);
    assert.deepEqual(first.unplaced, [
      { path: 'world/room/c.md', kind: 'chalk', sizeSource: 'declared', declared: { w: 460, h: 190 } },
    ]);
    assert.deepEqual(first.links, [{
      id: 'lnk-fixture',
      layer: 'world/room',
      from: 'world/room/a.md',
      to: 'world/room/b.md',
      style: 'ink',
      color: 'rust',
      directed: true,
      z: 4,
      label: 'near',
    }]);
    assert.deepEqual(first.presence, [{
      characterId: 'watson',
      layer: 'world/room',
      x: 50,
      y: 70,
      following: true,
      updatedAt: first.presence[0].updatedAt,
    }]);
    assert.deepEqual(first.viewpoint?.focus, { x: 200, y: 300 });

    await store.placeCard('world/room', 'world/room/b.md', { x: 900, y: 900 });
    const moved = await readCanvasSnapshot(store, { layer: 'world/room' }, { now });
    assert.notEqual(moved.identity.canvasRevision, first.identity.canvasRevision);
    assert.notEqual(moved.identity.snapshotId, first.identity.snapshotId);
    assert.equal(moved.overlaps.length, 0);

    await store.writeFootprints('world/room', [{ path: 'world/room/a.md', w: 280, h: 260 }]);
    const measured = await readCanvasSnapshot(store, { layer: 'world/room' }, { now });
    assert.equal(measured.rows.find((row) => row.path.endsWith('/a.md')).footprintSource, 'measured');
    assert.notEqual(measured.identity.canvasRevision, moved.identity.canvasRevision);
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('CanvasSnapshotV1 binds source content without changing canvasRevision', async () => {
  const { root, store } = await fixture();
  try {
    await store.seatUnplaced('world/room', [{ path: 'world/room/a.md', w: 200, h: 168 }]);
    const before = await readCanvasSnapshot(store, { layer: 'world/room' }, { now: Date.now() });
    await store.writeFile('world/room/a.md', '---\ntype: note\n---\n\nChanged\n');
    const after = await readCanvasSnapshot(store, { layer: 'world/room' }, { now: Date.now() });
    assert.equal(after.identity.canvasRevision, before.identity.canvasRevision);
    assert.notEqual(after.identity.snapshotId, before.identity.snapshotId);
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('arrangeCanvas rejects a stale snapshot before writing', async () => {
  const { root, store } = await fixture();
  try {
    await store.seatUnplaced('world/room', [
      { path: 'world/room/a.md', w: 240, h: 168 },
      { path: 'world/room/b.md', w: 240, h: 168 },
    ]);
    const stale = await readCanvasSnapshot(store, { layer: 'world/room' });
    await store.placeCard('world/room', 'world/room/a.md', { x: 2400, y: 1800 });
    const rowsBeforeAttempt = store.getLayerCards(['world/room/a.md', 'world/room/b.md']);
    const versionBeforeAttempt = store.getCanvasVersion('world/room');
    const expectedRevision = await store.getMaxSeq();

    await assert.rejects(
      () =>
        arrangeCanvas(
          { store, actor: { type: 'functional', id: 'canvas-arranger' }, agentScope: 'functional-canvas-arranger', turn: 'arrange:stale' },
          {
            operationId: 'arrange-stale',
            layer: 'world/room',
            mode: 'grid',
            expectedRevision,
            expectedCanvasVersion: stale.identity.canvasVersion,
            snapshotId: stale.identity.snapshotId,
            policy: 'deoverlap',
            allowMoveStableCards: true,
            preserveLinks: true,
          },
        ),
      (error) => {
        assert.ok(error instanceof ActionError);
        assert.equal(error.code, 'conflict');
        assert.equal(error.details.expectedSnapshotId, stale.identity.snapshotId);
        return true;
      },
    );
    assert.deepEqual(store.getLayerCards(['world/room/a.md', 'world/room/b.md']), rowsBeforeAttempt);
    assert.equal(store.getCanvasVersion('world/room'), versionBeforeAttempt);
  } finally {

    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('arrangeCanvas accepts a current snapshot and returns the fenced result identity', async () => {
  const { root, store } = await fixture();
  try {
    await store.seatUnplaced('world/room', [
      { path: 'world/room/a.md', w: 240, h: 168 },
      { path: 'world/room/b.md', w: 240, h: 168 },
    ]);
    await store.placeCard('world/room', 'world/room/a.md', { x: 0, y: 0 });
    await store.placeCard('world/room', 'world/room/b.md', { x: 100, y: 100 });
    const before = await readCanvasSnapshot(store, { layer: 'world/room' });
    const result = await arrangeCanvas(
      { store, actor: { type: 'functional', id: 'canvas-arranger' }, agentScope: 'functional-canvas-arranger', turn: 'arrange:current' },
      {
        operationId: 'arrange-current',
        layer: 'world/room',
        mode: 'grid',
        expectedRevision: await store.getMaxSeq(),
        expectedCanvasVersion: before.identity.canvasVersion,
        snapshotId: before.identity.snapshotId,
        policy: 'deoverlap',
        allowMoveStableCards: true,
        preserveLinks: true,
      },
    );
    const after = await readCanvasSnapshot(store, { layer: 'world/room' });
    assert.equal(result.details.committed, true);
    assert.equal(result.details.snapshotIdBefore, before.identity.snapshotId);
    assert.equal(result.details.snapshotIdAfter, after.identity.snapshotId);
    assert.equal(result.details.canvasRevision, after.identity.canvasRevision);
    assert.equal(result.details.overlapCount, 0);
    assert.ok(result.details.canvasVersion > before.identity.canvasVersion);
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
