/**
 * the design notes — tail-reader cursor acceptance tests (`node --test`).
 *
 * Imports the built `apps/server/dist` (the probe runs dist too) plus the real
 * `LocalWorldStore` from `@airp/shared`, so the cursor is exercised against a
 * real SQLite `events` table in a temp world.
 *
 * Cases: (1) no history replay at start, (2) seq advances once per batch,
 * (3) no replay on a second drain, (4) concurrent drains read once, (5) a read
 * failure keeps the cursor, (6) stopTailReader detaches, (7) switching stores
 * re-aligns instead of replaying, (8) the epoch guard drops a stale in-flight
 * batch (REVIEW m-24).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { EventBridge, mapEngineEvent, shouldBroadcastFileChanged } from '../dist/engine/event-bridge.js';
import { ActivityProjector } from '../dist/engine/agent-activity.js';
import { LocalWorldStore, WorldEventSchema } from '@airp/shared';
const MANIFEST = JSON.stringify({
  id: 'proj-tail',
  name: 'Tail',
  description: '',
  author: '',
  genre: 'test',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

async function tempWorld() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-tail-'));
  const store = new LocalWorldStore(root);
  await store.writeFile('world.json', MANIFEST);
  await store.writeFile('world/README.md', '---\nname: Map\ntype: readme\n---\n\n# Map\n');
  return { store, root };
}

/** A bridge wired to a recording sink; `frames` is everything broadcast. */
function bridgeWithSink() {
  const frames = [];
  const bridge = new EventBridge();
  bridge.setWss({
    clients: [
      { readyState: 1, send: (s) => frames.push(JSON.parse(s)) },
    ],
  });
  return { bridge, frames };
}

async function append(store, n) {
  for (let i = 0; i < n; i++) {
    await store.appendEvent({
      type: 'entity_created',
      actor: { type: 'writer' },
      detail: { path: `world/n-${i}.md`, name: `N${i}`, kind: 'chalk' },
      subject: `world/n-${i}.md`,
      layer: 'world',
      turn: `turn:test:${i}`,
    });
  }
}

/** Let the microtask queue settle so `startTailReader`'s getMaxSeq resolves. */
const settle = () => new Promise((r) => setTimeout(r, 5));

test('§10.2 (1)(2)(3) start aligns, drain advances once, no replay', async () => {
  const { store } = await tempWorld();
  const { bridge, frames } = bridgeWithSink();

  bridge.startTailReader(store);
  await settle();

  // (1) only the 3 events appended AFTER the reader started are new; nothing
  // already in the table is replayed.
  await bridge.drainWorldEvents();
  assert.equal(frames.length, 0, 'no history replay right after start');

  await append(store, 3);
  await bridge.drainWorldEvents();

  assert.equal(frames.length, 3, 'one frame per new event');
  assert.deepEqual(
    frames.map((f) => f.event.seq),
    [1, 2, 3],
    'seq advances in order'
  );
  for (const f of frames) {
    assert.equal(f.type, 'world_event');
    assert.equal(typeof f.timestamp, 'string', 'broadcast timestamp is added');
    assert.equal(f.event.type, 'entity_created');
  }
  assert.equal(bridge.lastSeq, 3, 'cursor ends at the last read seq');

  // (3) cursor already advanced -> a second drain broadcasts nothing.
  const before = frames.length;
  await bridge.drainWorldEvents();
  assert.equal(frames.length, before, 'no replay on second drain');

  bridge.close();
  store.close();
});

test('§10.2 (4) concurrent drains read the table once', async () => {
  let reads = 0;
  const fake = {
    async getMaxSeq() {
      return 0;
    },
    async getEventsSince() {
      reads += 1;
      await new Promise((r) => setTimeout(r, 10));
      return [];
    },
  };
  const { bridge } = bridgeWithSink();
  bridge.startTailReader(fake);
  await settle();

  await Promise.all([bridge.drainWorldEvents(), bridge.drainWorldEvents(), bridge.drainWorldEvents()]);
  assert.equal(reads, 1, 'the in-flight promise is shared, not re-read');

  bridge.close();
});

test('§10.2 (5) a read failure keeps the cursor (no permanent loss)', async () => {
  let reads = 0;
  const batch = [
    {
      seq: 7,
      id: 'evt-7',
      projectId: 'proj-tail',
      type: 'entity_created',
      actor: { type: 'writer' },
      layer: 'world',
      subject: 'world/x.md',
      turn: null,
      detail: { path: 'world/x.md', name: 'X', kind: 'chalk' },
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ];
  const fake = {
    worldRoot: '/test/world',
    async getMaxSeq() {
      return 0;
    },
    async getEventsSince() {
      reads += 1;
      if (reads === 1) throw new Error('database is locked');
      return batch;
    },
  };
  const { bridge, frames } = bridgeWithSink();
  bridge.startTailReader(fake);
  await settle();

  await bridge.drainWorldEvents(); // fails -> warn, cursor unchanged
  assert.equal(bridge.lastSeq, 0, 'failure does not advance the cursor');
  assert.equal(frames.length, 0);

  await bridge.drainWorldEvents(); // retries the same batch
  assert.deepEqual(
    frames.map((f) => f.event.seq),
    [7],
    'the batch is readable on the next drain'
  );
  assert.equal(bridge.lastSeq, 7);

  bridge.close();
});

test('§10.2 (6) stopTailReader detaches the reader', async () => {
  const { store } = await tempWorld();
  const { bridge, frames } = bridgeWithSink();

  bridge.startTailReader(store);
  await settle();
  bridge.stopTailReader();
  assert.equal(bridge.tailStore, null, 'detached');

  await append(store, 2);
  await bridge.drainWorldEvents();
  assert.equal(frames.length, 0, 'nothing broadcast after stop');

  store.close();
});

test('§10.2 (7) switching stores re-aligns instead of replaying', async () => {
  const a = await tempWorld();
  const b = await tempWorld();
  await append(a.store, 5); // store A has a long history
  const { bridge, frames } = bridgeWithSink();

  bridge.startTailReader(a.store);
  await settle();
  await bridge.drainWorldEvents();
  assert.equal(frames.length, 0, 'A history not replayed');

  // Switch to B, which already has 2 events of its own sequence.
  await append(b.store, 2);
  bridge.startTailReader(b.store);
  await settle();
  await bridge.drainWorldEvents();
  assert.equal(frames.length, 0, 'B history not replayed either');
  assert.equal(bridge.lastSeq, 2, 'cursor aligned to B max seq, not A');

  await append(b.store, 1);
  await bridge.drainWorldEvents();
  assert.deepEqual(
    frames.map((f) => f.event.seq),
    [3],
    'B continues from its own sequence'
  );

  bridge.close();
  a.store.close();
  b.store.close();
});

test('§10.2 (8) / m-24 epoch guard drops a stale in-flight batch', async () => {
  let release;
  const staleBatch = [
    {
      seq: 99,
      id: 'evt-99',
      projectId: 'proj-old',
      type: 'entity_created',
      actor: { type: 'writer' },
      layer: 'world',
      subject: 'world/old.md',
      turn: null,
      detail: { path: 'world/old.md', name: 'Old', kind: 'chalk' },
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ];
  const old = {
    async getMaxSeq() {
      return 0;
    },
    getEventsSince() {
      return new Promise((r) => {
        release = () => r(staleBatch);
      });
    },
  };
  const fresh = {
    async getMaxSeq() {
      return 40;
    },
    async getEventsSince() {
      return [];
    },
  };

  const { bridge, frames } = bridgeWithSink();
  bridge.startTailReader(old);
  await settle();

  const inflight = bridge.drainWorldEvents(); // suspended inside getEventsSince
  // The world switches while that read is still in flight.
  bridge.startTailReader(fresh);
  await settle();

  release(); // the OLD world's read finally resolves
  await inflight;

  assert.equal(frames.length, 0, 'old world events never reach the new client');
  assert.equal(bridge.lastSeq, 40, 'stale batch does not write its seq');

  bridge.close();
});

test('broadcast survives one throwing client (§11 conflict 6)', () => {
  const good = [];
  const bridge = new EventBridge();
  bridge.setWss({
    clients: [
      {
        readyState: 1,
        send() {
          throw new Error('socket is half-dead');
        },
      },
      { readyState: 1, send: (s) => good.push(JSON.parse(s)) },
    ],
  });

  bridge.broadcast({ type: 'file_changed', filename: 'a.md', savePath: '/test/world' });
  assert.equal(good.length, 1, 'the healthy client still receives the frame');
});

test('§10.1 the broadcast world_event payload matches WorldEventSchema', async () => {
  const { store } = await tempWorld();
  const { bridge, frames } = bridgeWithSink();

  // Start the reader BEFORE appending, or the cursor aligns past the event.
  bridge.startTailReader(store);
  await settle();
  await append(store, 1);
  await bridge.drainWorldEvents();

  assert.equal(frames.length, 1);
  const parsed = WorldEventSchema.safeParse(frames[0].event);
  assert.equal(parsed.success, true, JSON.stringify(parsed.error));
  assert.equal(typeof frames[0].timestamp, 'string');

  bridge.close();
  store.close();
});
test('canvas database changes trigger event draining but not file_changed refreshes', () => {
  assert.equal(shouldBroadcastFileChanged('.airpworld/canvas.db'), false);
  assert.equal(shouldBroadcastFileChanged('.airpworld/canvas.db-wal'), false);
  assert.equal(shouldBroadcastFileChanged('.airpworld/canvas.db-shm'), false);
  assert.equal(shouldBroadcastFileChanged('world/scene.md'), true);
  assert.equal(shouldBroadcastFileChanged('.airpworld/history.db'), true);
});

// ---------------------------------------------------------------------------
// Engine-native agent_activity events. The old
// hidden-custom-message relay (airp_agent_activity) is gone; these frames now
// arrive as transient engine events and must still pass the fail-closed
// identity checks before projection.
// ---------------------------------------------------------------------------
test('agent_activity: valid subagent events project functional frames', () => {
  const projector = new ActivityProjector();
  const map = () => new Map();
  const base = {
    type: 'agent_activity',
    origin: 'subagent',
    agentId: 'scene-init',
    turnId: 'functional:abc-123:0',
    toolCallId: 'call-1',
    toolName: 'write',
    timestamp: Date.now(),
  };
  const start = mapEngineEvent('writer', { ...base, phase: 'start', args: { path: 'world/x.md' } }, map(), undefined, undefined, 'orphan:writer', projector);
  assert.equal(start.length, 1, JSON.stringify(start));
  assert.equal(start[0].type, 'agent_activity');
  assert.equal(start[0].source, 'functional');
  assert.equal(start[0].agentId, 'scene-init');
  assert.equal(start[0].phase, 'started');

  const end = mapEngineEvent('writer', { ...base, phase: 'end' }, map(), undefined, undefined, 'orphan:writer', projector);
  assert.equal(end.length, 1, JSON.stringify(end));
  assert.equal(end[0].phase, 'completed');
});

test('agent_activity: fail-closed on bad identity or unknown keys', () => {
  const projector = new ActivityProjector();
  const map = () => new Map();
  const base = {
    type: 'agent_activity',
    origin: 'subagent',
    agentId: 'scene-init',
    turnId: 'functional:abc-123:0',
    toolCallId: 'call-1',
    toolName: 'write',
    phase: 'start',
    timestamp: Date.now(),
  };
  assert.equal(mapEngineEvent('writer', { ...base, evil: 1 }, map(), undefined, undefined, 'orphan:writer', projector).length, 0, 'unknown key');
  assert.equal(mapEngineEvent('writer', { ...base, agentId: 'BAD ID' }, map(), undefined, undefined, 'orphan:writer', projector).length, 0, 'bad agentId');
  assert.equal(mapEngineEvent('writer', { ...base, turnId: 'no-prefix' }, map(), undefined, undefined, 'orphan:writer', projector).length, 0, 'bad turnId');
  assert.equal(mapEngineEvent('writer', { ...base, origin: 'spoofed' }, map(), undefined, undefined, 'orphan:writer', projector).length, 0, 'bad origin');
  assert.equal(mapEngineEvent('writer', { ...base, toolName: '' }, map(), undefined, undefined, 'orphan:writer', projector).length, 0, 'empty toolName');
});

test('agent_activity: command origin fails the agent open activities on terminal', () => {
  const projector = new ActivityProjector();
  const map = () => new Map();
  const base = {
    type: 'agent_activity',
    origin: 'command',
    agentId: 'scene-init',
    turnId: 'functional:abc-123',
    timestamp: Date.now(),
  };
  // A child activity left open (no tool_end of its own)...
  const openStart = mapEngineEvent('writer', { ...base, toolCallId: 'call-child', toolName: 'write', phase: 'start' }, map(), undefined, undefined, 'orphan:writer', projector);
  assert.equal(openStart.length, 1);
  // ...then the command's own terminal: the projector must fail-close the
  // open child activity alongside the completed tool frame.
  const terminal = mapEngineEvent('writer', { ...base, toolCallId: 'initialize', toolName: 'airp-init', phase: 'end', isError: false }, map(), undefined, undefined, 'orphan:writer', projector);
  assert.ok(terminal.length >= 2, JSON.stringify(terminal));
  const phases = terminal.map((frame) => frame.phase);
  assert.deepEqual(phases.sort(), ['completed', 'failed']);
});
