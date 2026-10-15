/**
 * Handler-level acceptance for the injection granularity fix
 *.
 *
 * Unlike `tools/probe-inject.mjs` (which spawns a REAL writer through the engine
 * and is therefore slow and stage-gated), this loads the REAL
 * `extensions/context.ts` through jiti and drives its handlers directly. It is
 * the cheapest place to pin the gate's contract:
 *
 *   - the recorder (`pi.on('turn_start')`) exists at all,
 *   - the first provider request of a trace injects,
 *   - every later request of the SAME trace returns `undefined`,
 *   - a NEW trace re-delivers (the gate is not a permanent latch),
 *   - `previewPrompt()` (a `context` call outside any trace) consumes nothing,
 *   - `turn_end` forgets the trace immediately (07 §4.1 hardening 2).
 *
 * RED POINT: with the recorder registered and the positive precondition asserted
 * first, `assert.equal(second, undefined)` is where the UNFIXED handler fails —
 * it re-appends the block on every request. Not before: the preconditions mean a
 * failure there is "the recorder is missing", not "the gate did not work".
 *
 * Build first (`pnpm --filter @airp/shared build`); this file imports built
 * `dist/` modules directly, and jiti compiles the extension against the same
 * `dist/` (ESM module identity is by URL, so `resetTurnCacheForTests` here clears
 * the very cache the extension reads).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

import {
  readTurnBlock,
  resetTurnCacheForTests,
  writeTurnBlock,
} from '../../../packages/shared/dist/inject/turn-cache.js';
import { LocalWorldStore } from '../../../packages/shared/dist/store/local-store.js';

const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  tryNative: true,
  alias: {
    '@earendil-works/pi-coding-agent': new URL(
      '../../../vendor/pi-rp/packages/coding-agent/dist/index.js',
      import.meta.url
    ).pathname,
  },
});

const MARKER = '[World state'; // STATE_HEADER (packages/shared/src/render/state.ts:25)
const LAYER = 'world/baker-street';
const SESSION_ID = 'granularity-session';

const countIn = (haystack, needle) => haystack.split(needle).length - 1;

/**
 * A minimal world the writer extension can turn into a NON-NULL block. Empty
 * dirs CAN yield the `STATE_EMPTY_WRITER` sentinel, but a viewpoint row is the
 * HARD PREREQUISITE for the positive assertions: without it a failed assembly
 * would surface as `first === undefined` and the test would be red for the wrong
 * reason (07 §6.2, mirroring the probe's seed at `tools/probe-inject.mjs`).
 */
async function makeWorld() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-granularity-'));
  const store = new LocalWorldStore(root);
  try {
    await store.writeFile(
      'world.json',
      JSON.stringify({
        id: 'proj-1',
        name: 'T',
        description: '',
        author: '',
        genre: 'test',
        characters: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      })
    );
    await store.writeFile('world/baker-street/README.md', '---\nname: Baker Street\n---\n\n# B\n');
    store.writeViewpoint({ layer: LAYER, focus: null, selected: [], bagCount: 0 });
  } finally {
    store.close();
  }
  return root;
}

/** Load the real extension and collect its handlers, exactly as the loader does. */
async function loadHandlers() {
  process.env.AIRP_AGENT_ROLE = 'writer';
  const mod = await jiti.import('../../../extensions/context.ts');
  const handlers = new Map();
  mod.default({ on: (event, handler) => handlers.set(event, handler), registerCustomType: () => {} });
  return handlers;
}

/** The world-state block's text on the last wire message of an injection result. */
function injectedBlock(result) {
  const last = result.messages.at(-1);
  return last.content.map((block) => block.text).join('\n');
}

test('07 §6.2: one injection per trace — gate on the first provider request, undefined after', async () => {
  resetTurnCacheForTests();
  const root = await makeWorld();
  try {
    const handlers = await loadHandlers();

    // HARD PREREQUISITE 1 — without the recorder there is no gate to test, and a
    // bare `handlers.get('turn_start')(…)` would throw a TypeError BEFORE the red
    // point, making the failure indistinguishable from "the gate did not work".
    assert.ok(
      handlers.has('turn_start'),
      'context.ts must register pi.on("turn_start") — the gate has no input without it'
    );

    const ctx = { sessionManager: { getSessionId: () => SESSION_ID }, cwd: root };

    // Trace 1 — the first provider request injects.
    await handlers.get('agent_start')({ type: 'agent_start' }, ctx);
    handlers.get('turn_start')({ type: 'turn_start', turnIndex: 0 });
    const first = handlers.get('context')({ type: 'context', messages: [] }, ctx);
    // HARD PREREQUISITE 2 — the precondition must really hold, else the assertions
    // below could pass/fail for reasons unrelated to the gate.
    assert.ok(first && Array.isArray(first.messages), 'the first request must inject a block (precondition)');
    assert.equal(countIn(injectedBlock(first), MARKER), 1);

    // THE RED POINT — the UNFIXED handler re-injects on every request, so this is
    // `{ messages: […] }` and the equality fails exactly here.
    handlers.get('turn_start')({ type: 'turn_start', turnIndex: 1 });
    const second = handlers.get('context')({ type: 'context', messages: [] }, ctx);
    assert.equal(second, undefined, 'a tool-loop continuation must not inject');

    handlers.get('turn_start')({ type: 'turn_start', turnIndex: 2 });
    assert.equal(handlers.get('context')({ type: 'context', messages: [] }, ctx), undefined);

    // A NEW trace re-delivers: the gate must not have latched permanently.
    await handlers.get('agent_start')({ type: 'agent_start' }, ctx);
    handlers.get('turn_start')({ type: 'turn_start', turnIndex: 0 });
    const again = handlers.get('context')({ type: 'context', messages: [] }, ctx);
    assert.ok(again && Array.isArray(again.messages), 'a new trace must re-inject');
    assert.equal(countIn(injectedBlock(again), MARKER), 1);
  } finally {
    resetTurnCacheForTests();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('07 §6.4 (1): previewPrompt consumes nothing — a mid-trace context call is inert', async () => {
  resetTurnCacheForTests();
  const root = await makeWorld();
  try {
    const handlers = await loadHandlers();
    const ctx = { sessionManager: { getSessionId: () => SESSION_ID }, cwd: root };

    await handlers.get('agent_start')({ type: 'agent_start' }, ctx);
    handlers.get('turn_start')({ type: 'turn_start', turnIndex: 0 });
    assert.ok(handlers.get('context')({ type: 'context', messages: [] }, ctx), 'precondition: first request injects');

    // `previewPrompt()` fires `context` directly, without `agent_start`/`turn_start`
    // (agent-session.ts:1850-1857). The consumption-latch design would eat the
    // block here; `turnIndex` must not.
    handlers.get('turn_start')({ type: 'turn_start', turnIndex: 1 });
    assert.equal(
      handlers.get('context')({ type: 'context', messages: [] }, ctx),
      undefined,
      'a /prompt preview mid-trace must not produce a block'
    );
    // ...and the following real request of the SAME trace is still silent (the
    // preview consumed nothing, but there is nothing to consume at turnIndex 1).
    assert.equal(handlers.get('context')({ type: 'context', messages: [] }, ctx), undefined);
    // The NEXT trace is unaffected.
    await handlers.get('agent_start')({ type: 'agent_start' }, ctx);
    handlers.get('turn_start')({ type: 'turn_start', turnIndex: 0 });
    const next = handlers.get('context')({ type: 'context', messages: [] }, ctx);
    assert.ok(next && countIn(injectedBlock(next), MARKER) === 1, 'the next trace still injects');
  } finally {
    resetTurnCacheForTests();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('07 §6.4 (2): turn_end forgets the trace — /prompt between traces injects nothing', async () => {
  resetTurnCacheForTests();
  const root = await makeWorld();
  try {
    const handlers = await loadHandlers();
    assert.ok(handlers.has('turn_end'), 'context.ts must register pi.on("turn_end") (07 §4.1 hardening 2)');

    const ctx = { sessionManager: { getSessionId: () => SESSION_ID }, cwd: root };

    // A SINGLE-REQUEST trace (no tool call — the common case): its last `turnIndex`
    // is 0, so without the `turn_end` reset a `/prompt` landing between traces
    // would match `turnIndex === 0` and inject a STALE block.
    await handlers.get('agent_start')({ type: 'agent_start' }, ctx);
    handlers.get('turn_start')({ type: 'turn_start', turnIndex: 0 });
    assert.ok(handlers.get('context')({ type: 'context', messages: [] }, ctx), 'precondition: single-request trace injects');

    handlers.get('turn_end')({ type: 'turn_end', turnIndex: 0, message: {}, toolResults: [] });
    assert.equal(
      handlers.get('context')({ type: 'context', messages: [] }, ctx),
      undefined,
      'a /prompt between traces must not inject a stale block'
    );
  } finally {
    resetTurnCacheForTests();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('07 §4.1 (hardening 1): agent_start goes fail-closed before the first turn_start', async () => {
  resetTurnCacheForTests();
  const root = await makeWorld();
  try {
    const handlers = await loadHandlers();
    const ctx = { sessionManager: { getSessionId: () => SESSION_ID }, cwd: root };

    // Seed the cache directly so a `context` call between `agent_start` and
    // `turn_start{0}` WOULD inject if the mirror were not reset. `agent_start`
    // must set it to -1, not leave the previous trace's `0`.
    await handlers.get('agent_start')({ type: 'agent_start' }, ctx);
    handlers.get('turn_start')({ type: 'turn_start', turnIndex: 0 });
    assert.ok(handlers.get('context')({ type: 'context', messages: [] }, ctx), 'precondition: injects once');

    // New trace, but a `context` fires BEFORE its `turn_start{0}`.
    await handlers.get('agent_start')({ type: 'agent_start' }, ctx);
    assert.equal(
      handlers.get('context')({ type: 'context', messages: [] }, ctx),
      undefined,
      'the mirror must be -1 until this trace issues turn_start{0} (fail-closed)'
    );
    // ...and `turn_start{0}` immediately restores delivery.
    handlers.get('turn_start')({ type: 'turn_start', turnIndex: 0 });
    assert.ok(handlers.get('context')({ type: 'context', messages: [] }, ctx), 'turn_start{0} reopens the gate');
  } finally {
    resetTurnCacheForTests();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('07 §3.2: a failed assembly means no injection, not a stale one', async () => {
  resetTurnCacheForTests();
  const root = await makeWorld();
  try {
    const handlers = await loadHandlers();
    const ctx = { sessionManager: { getSessionId: () => SESSION_ID }, cwd: root };

    // Empty slot → the handler must return undefined even on the FIRST request.
    writeTurnBlock(SESSION_ID, null);
    handlers.get('turn_start')({ type: 'turn_start', turnIndex: 0 });
    assert.equal(handlers.get('context')({ type: 'context', messages: [] }, ctx), undefined);
    assert.equal(readTurnBlock(SESSION_ID), null);
  } finally {
    resetTurnCacheForTests();
    await fs.rm(root, { recursive: true, force: true });
  }
});
