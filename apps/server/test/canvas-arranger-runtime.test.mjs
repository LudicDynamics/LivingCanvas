// CanvasArrangerRuntime behavior — the 2026-09-18 de-agented, in-process flow.
//
// The runtime replaces the former pi-rp canvas-arranger agent. These tests
// pin the observable contract the old agent + runtime pair provided
//: completion requires a fresh full-layer
// overlaps=[] proof, an already-clean layer is a verified no-op with no
// write, a stale world revision is `conflict` (never flattened to failed),
// screenshot policies fail explicitly instead of pretending a capture, and
// requestId reuse stays idempotent.
//
// Runs against built dist: `pnpm --filter @airp/server build`.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { LocalWorldStore, createActionService, readCanvasSnapshot } from '@airp/shared';
import { CanvasArrangerRuntime } from '../dist/engine/canvas-arranger-lifecycle.js';
import { createCanvasArrangerRouter } from '../dist/routes/canvas-arranger.js';
import express from 'express';
import http from 'node:http';
import { CanvasCaptureConflict, saveArrangeScreenshot } from '../dist/engine/canvas-capture.js';

const MANIFEST = JSON.stringify({
  id: 'proj-arranger',
  name: 'Arranger',
  description: '',
  author: '',
  genre: 'test',
  createdAt: '',
  updatedAt: '',
  characters: [],
});

const CARD = (title) => `---\ntitle: ${title}\ntype: note\n---\n\n${title} body.\n`;
const LAYER = 'world/map';

/** Temp world with two OVERLAPPING note cards on world/map. */
async function harness() {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-arranger-'));
  const world = path.join(repo, 'world-root');
  const store = new LocalWorldStore(world);
  await store.writeFile('world.json', MANIFEST);
  await store.writeFile(`${LAYER}/README.md`, '---\nname: Map\ntype: readme\n---\n\n# Map\n');
  await store.writeFile(`${LAYER}/note-a.md`, CARD('Alpha'));
  await store.writeFile(`${LAYER}/note-b.md`, CARD('Beta'));
  const svc = createActionService(store, { type: 'writer' }, { turn: 'arranger-seed' });
  // Grid seating gives both cards a real declared footprint (`placeCards`
  // writes x/y/z only). The arrangeCards `place` ACTION refuses/avoids a
  // placement that would overlap another card, so the overlap itself is
  // seeded with the bare store batch write, which has no collision logic.
  await svc.arrangeCards({ layout: { mode: 'grid', layer: LAYER, paths: [`${LAYER}/note-a.md`, `${LAYER}/note-b.md`] } });
  const seated = store.getLayerCards([`${LAYER}/note-a.md`, `${LAYER}/note-b.md`]);
  const a = seated.find((row) => row.id === `${LAYER}/note-a.md`);
  assert.ok(a && a.w > 0 && a.h > 0, 'grid seating must give the card a real footprint');
  await store.placeCards([{ layer: LAYER, path: `${LAYER}/note-b.md`, x: a.x, y: a.y }]);
  return { repo, store };
}

/** Runtime + signal journal bound to one store. */
function runtimeOver(store, captureEvidence) {
  const signals = [];
  const runtime = new CanvasArrangerRuntime({
    getActiveStore: () => store,
    onRuntimeSignal: (signal) => signals.push(signal),
    ...(captureEvidence ? { captureEvidence } : {}),
  });
  return { runtime, signals };
}

/** Recording evidence seam; returns the fake and its call journal. */
function fakeCapture() {
  const calls = [];
  const captureEvidence = async (input) => {
    calls.push(input);
    return {
      phase: input.phase,
      path: `.airpworld/arrange/${input.operationId}-${input.phase}.png`,
      width: 1600,
      height: 900,
      snapshotId: input.snapshotId,
    };
  };
  return { captureEvidence, calls };
}

async function settle(runtime, operationId, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const operation = runtime.get(operationId);
    if (operation?.terminal) return operation;
    if (Date.now() > deadline) throw new Error(`canvas arrangement ${operationId} did not settle in time`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function request(store, over = {}) {
  return {
    worldId: 'proj-arranger',
    layer: LAYER,
    mode: 'grid',
    requestId: randomUUID(),
    expectedRevision: await store.getMaxSeq(),
    expectedCanvasVersion: 0,
    snapshotId: 'stale-request-fence',
    screenshotPolicy: 'none',
    ...over,
  };
}

test('overlapping layer is de-overlapped, verified, and lands completed', async () => {
  const { repo, store } = await harness();
  try {
    const before = await readCanvasSnapshot(store, { layer: LAYER });
    assert.ok(before.overlaps.length > 0, 'seed must actually overlap, otherwise this test proves nothing');

    const { runtime, signals } = runtimeOver(store);
    const accepted = await runtime.start(await request(store));
    assert.equal(accepted.agentId, 'canvas-arranger');
    assert.match(accepted.turnId, /^functional:canvas-arranger:/);

    const operation = await settle(runtime, accepted.operationId);
    assert.equal(operation.outcome, 'completed');
    assert.equal(operation.committed, true);
    assert.ok(operation.result.movedCount >= 1, 'at least one card must move to de-overlap');
    assert.deepEqual(signals.map((s) => s.type), ['started', 'committed', 'verified']);
    assert.ok(signals.every((signal) => signal.savePath === store.worldRoot), 'each lifecycle signal retains its originating save path');

    const after = await readCanvasSnapshot(store, { layer: LAYER });
    assert.deepEqual(after.overlaps, [], 'fresh full-layer proof must be collision-free');
  } finally {
    store.close();
    await fs.rm(repo, { recursive: true, force: true });
  }
});

test('an already-clean layer is a verified no-op with no write', async () => {
  const { repo, store } = await harness();
  try {
    // De-overlap first so the layer satisfies the completion proof.
    await store.placeCards([{ layer: LAYER, path: `${LAYER}/note-b.md`, x: 749, y: 900 }]);
    const versionBefore = (await readCanvasSnapshot(store, { layer: LAYER })).identity.canvasVersion;

    const { runtime, signals } = runtimeOver(store);
    const accepted = await runtime.start(await request(store));
    const operation = await settle(runtime, accepted.operationId);

    assert.equal(operation.outcome, 'completed');
    assert.equal(operation.committed, false, 'a clean layer must not write');
    assert.equal(operation.result.movedCount, 0);
    assert.deepEqual(signals.map((s) => s.type), ['started', 'verified']);
    const after = await readCanvasSnapshot(store, { layer: LAYER });
    assert.equal(after.identity.canvasVersion, versionBefore, 'no-op must not bump the canvas version');
  } finally {
    store.close();
    await fs.rm(repo, { recursive: true, force: true });
  }
});

test('a stale world revision yields conflict, never flattened to failed', async () => {
  const { repo, store } = await harness();
  try {
    const { runtime } = runtimeOver(store);
    const base = await request(store);
    const accepted = await runtime.start({ ...base, expectedRevision: base.expectedRevision + 5 });
    const operation = await settle(runtime, accepted.operationId);
    assert.equal(operation.outcome, 'conflict');
    assert.equal(operation.committed, true, 'rows are retained when the revision fence cannot be proven');
  } finally {
    store.close();
    await fs.rm(repo, { recursive: true, force: true });
  }
});

test('a screenshot policy that cannot be honored fails explicitly before any write', async () => {
  const { repo, store } = await harness();
  try {
    const { runtime, signals } = runtimeOver(store);
    const versionBefore = (await readCanvasSnapshot(store, { layer: LAYER })).identity.canvasVersion;
    const accepted = await runtime.start(await request(store, { screenshotPolicy: 'before' }));
    const operation = await settle(runtime, accepted.operationId);

    assert.equal(operation.outcome, 'failed');
    assert.equal(operation.committed, false, 'pre-commit evidence failure must not write');
    assert.deepEqual(signals.map((s) => s.type), ['started', 'failed']);
    assert.equal(signals.at(-1).error, 'screenshot_failed');
    const after = await readCanvasSnapshot(store, { layer: LAYER });
    assert.equal(after.identity.canvasVersion, versionBefore);
  } finally {
    store.close();
    await fs.rm(repo, { recursive: true, force: true });
  }
});

test('requestId reuse is idempotent; reuse with different input is rejected', async () => {
  const { repo, store } = await harness();
  try {
    const { runtime } = runtimeOver(store);
    const requestId = randomUUID();
    const first = await request(store, { requestId });
    const accepted = await runtime.start(first);
    await settle(runtime, accepted.operationId);

    const replay = await runtime.start(await request(store, { requestId }));
    assert.equal(replay.operationId, accepted.operationId, 'same requestId replays the settled operation');

    await assert.rejects(
      async () => runtime.start(await request(store, { requestId, layer: 'world/other' })),
      /reused with different input/
    );
    const done = await runtime.cancel(accepted.operationId);
    assert.equal(done.stage, 'already_completed');
  } finally {
    store.close();
    await fs.rm(repo, { recursive: true, force: true });
  }
});

test('before_and_after captures ride the evidence seam into details and the terminal signal', async () => {
  const { repo, store } = await harness();
  try {
    const idBefore = (await readCanvasSnapshot(store, { layer: LAYER })).identity.snapshotId;
    const { captureEvidence, calls } = fakeCapture();
    const { runtime, signals } = runtimeOver(store, captureEvidence);

    const accepted = await runtime.start(await request(store, { screenshotPolicy: 'before_and_after' }));
    const operation = await settle(runtime, accepted.operationId);

    assert.equal(operation.outcome, 'completed');
    assert.deepEqual(calls.map((c) => c.phase), ['before', 'after'], 'demanded phases capture exactly once each');
    assert.equal(calls[0].snapshotId, idBefore, 'pre capture is fenced to the read window it verifies');
    assert.notEqual(calls[1].snapshotId, idBefore, 'post capture is fenced to the committed layout');
    assert.equal(calls[0].operationId, accepted.operationId);

    const evidence = operation.result.screenshotEvidence;
    assert.equal(evidence.length, 2);
    assert.deepEqual(evidence.map((e) => e.phase), ['before', 'after']);
    assert.ok(evidence.every((e) => e.path.startsWith('.airpworld/arrange/')), 'evidence paths stay world-relative');
    const terminal = signals.at(-1);
    assert.deepEqual(terminal.result.screenshotEvidence, evidence, 'terminal signal carries the same evidence');
    assert.equal(terminal.type, 'verified');
  } finally {
    store.close();
    await fs.rm(repo, { recursive: true, force: true });
  }
});

test('a clean layer never captures even when the policy demands it', async () => {
  const { repo, store } = await harness();
  try {
    await store.placeCards([{ layer: LAYER, path: `${LAYER}/note-b.md`, x: 749, y: 900 }]);
    const { captureEvidence, calls } = fakeCapture();
    const { runtime } = runtimeOver(store, captureEvidence);

    const accepted = await runtime.start(await request(store, { screenshotPolicy: 'before_and_after' }));
    const operation = await settle(runtime, accepted.operationId);

    assert.equal(operation.outcome, 'completed');
    assert.equal(operation.committed, false);
    assert.equal(calls.length, 0, 'no-op: before/after would be identical, so no capture is demanded');
    assert.equal(operation.result.screenshotEvidence, undefined);
  } finally {
    store.close();
    await fs.rm(repo, { recursive: true, force: true });
  }
});

test('identity drift during the pre capture is conflict, with nothing written', async () => {
  const { repo, store } = await harness();
  try {
    const versionBefore = (await readCanvasSnapshot(store, { layer: LAYER })).identity.canvasVersion;
    const drift = new CanvasCaptureConflict(
      { version: 'canvas-snapshot-v1', snapshotId: 'requested', canvasRevision: 'r', canvasVersion: 0, capturedAt: '' },
      { version: 'canvas-snapshot-v1', snapshotId: 'observed', canvasRevision: 'r2', canvasVersion: 1, capturedAt: '' },
    );
    const { runtime, signals } = runtimeOver(store, async () => { throw drift; });

    const accepted = await runtime.start(await request(store, { screenshotPolicy: 'before' }));
    const operation = await settle(runtime, accepted.operationId);

    assert.equal(operation.outcome, 'conflict', 'drifted identity is unprovable currentness, not a flat failure');
    assert.equal(operation.committed, false);
    assert.equal(signals.at(-1).error, 'conflict');
    const after = await readCanvasSnapshot(store, { layer: LAYER });
    assert.equal(after.identity.canvasVersion, versionBefore, 'conflicted pre capture must not write');
  } finally {
    store.close();
    await fs.rm(repo, { recursive: true, force: true });
  }
});

test('identity drift during the post capture is conflict with rows retained', async () => {
  const { repo, store } = await harness();
  try {
    const drift = new CanvasCaptureConflict(
      { version: 'canvas-snapshot-v1', snapshotId: 'requested', canvasRevision: 'r', canvasVersion: 1, capturedAt: '' },
      { version: 'canvas-snapshot-v1', snapshotId: 'observed', canvasRevision: 'r2', canvasVersion: 2, capturedAt: '' },
    );
    const { runtime, signals } = runtimeOver(store, async (input) => {
      if (input.phase === 'after') throw drift;
      return { phase: input.phase, path: `.airpworld/arrange/${input.operationId}-${input.phase}.png`, width: 1, height: 1, snapshotId: input.snapshotId };
    });

    const accepted = await runtime.start(await request(store, { screenshotPolicy: 'before_and_after' }));
    const operation = await settle(runtime, accepted.operationId);

    assert.equal(operation.outcome, 'conflict');
    assert.equal(operation.committed, true, 'rows already committed stay committed');
    const after = await readCanvasSnapshot(store, { layer: LAYER });
    assert.deepEqual(after.overlaps, [], 'de-overlap itself survived');
    assert.equal(signals.at(-1).error, 'conflict');
  } finally {
    store.close();
    await fs.rm(repo, { recursive: true, force: true });
  }
});

test('a post capture that cannot be produced is partial, never a fake completion', async () => {
  const { repo, store } = await harness();
  try {
    const { runtime, signals } = runtimeOver(store, async (input) => {
      if (input.phase === 'after') throw new Error('chromium is gone');
      return { phase: input.phase, path: `.airpworld/arrange/${input.operationId}-${input.phase}.png`, width: 1, height: 1, snapshotId: input.snapshotId };
    });

    const accepted = await runtime.start(await request(store, { screenshotPolicy: 'after' }));
    const operation = await settle(runtime, accepted.operationId);

    assert.equal(operation.outcome, 'partial');
    assert.equal(operation.committed, true);
    assert.equal(signals.at(-1).error, 'screenshot_failed');
    assert.equal(operation.result.screenshotEvidence, undefined, 'failed evidence is absent, not pretended');
    const after = await readCanvasSnapshot(store, { layer: LAYER });
    assert.deepEqual(after.overlaps, []);
  } finally {
    store.close();
    await fs.rm(repo, { recursive: true, force: true });
  }
});

test('arrange evidence archives as world-relative PNG under .airpworld/arrange', async () => {
  const { repo, store } = await harness();
  try {
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
    const operationId = randomUUID();
    const archived = await saveArrangeScreenshot(store, operationId, 'before', png);
    assert.equal(archived, `.airpworld/arrange/${operationId}-before.png`);
    const onDisk = await fs.readFile(path.join(store.worldRoot, '.airpworld', 'arrange', `${operationId}-before.png`));
    assert.deepEqual([...onDisk], [...png]);
    await assert.rejects(
      () => saveArrangeScreenshot(store, '../escape', 'before', png),
      /Invalid arrange operation id/
    );
  } finally {
    store.close();
    await fs.rm(repo, { recursive: true, force: true });
  }
});

test('HTTP edge: a fence-free agent intent runs to completion and stays queryable', async () => {
  const { repo, store } = await harness();
  try {
    const runtime = new CanvasArrangerRuntime({ getActiveStore: () => store });
    const app = express();
    app.use(express.json());
    app.use('/api', createCanvasArrangerRouter(runtime));
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;

    const post = await fetch(`${base}/canvas/arrange`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ layer: LAYER, mode: 'grid', screenshotPolicy: 'none' }),
    });
    assert.equal(post.status, 202, 'agent intent without any fence is accepted');
    const accepted = await post.json();

    let operation = null;
    for (let i = 0; i < 200; i++) {
      operation = runtime.get(accepted.operationId);
      if (operation?.terminal) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(operation.outcome, 'completed');
    assert.ok(operation.result.movedCount >= 1, 'the server minted its own fence and de-overlapped the layer');

    const query = await fetch(`${base}/canvas/arrange/${accepted.operationId}`);
    assert.equal(query.status, 200);
    const view = await query.json();
    assert.equal(view.terminal, true);
    assert.equal(view.outcome, 'completed');

    const partial = await fetch(`${base}/canvas/arrange`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ layer: LAYER, mode: 'grid', screenshotPolicy: 'none', snapshotId: 'half-a-fence' }),
    });
    assert.equal(partial.status, 400, 'a half fence looks like safety and is rejected outright');

    server.close();
  } finally {
    store.close();
    await fs.rm(repo, { recursive: true, force: true });
  }
});
