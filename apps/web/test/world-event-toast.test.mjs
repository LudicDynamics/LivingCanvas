import assert from 'node:assert/strict';
import { test } from 'node:test';

let mod = null;
try {
  const { createJiti } = await import('../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs');
  const jiti = createJiti(import.meta.url, { moduleCache: false, tryNative: true });
  mod = await jiti.import('../src/lib/world-event-toast.ts');
} catch (error) {
  console.error('jiti/bootstrap unavailable, skipping world toast group:', error?.message ?? error);
}

const skip = mod ? false : 'jiti or pi-rp submodule unavailable';
const {
  createWorldEventToastStore,
  createWorldToastState,
  reduceWorldToast,
  WORLD_TOAST_BATCH_WINDOW_MS,
  WORLD_TOAST_FAILED_TTL_MS,
  WORLD_TOAST_SEEN_LIMIT,
} = mod ?? {};

const baseEvent = (overrides = {}) => ({
  seq: 1,
  id: 'evt-1',
  projectId: 'world-a',
  type: 'entity_created',
  actor: { type: 'player' },
  layer: 'map',
  subject: 'key',
  turn: null,
  detail: { path: 'world/key.md', name: 'key', kind: 'note' },
  createdAt: '2026-09-14T00:00:00.000Z',
  ...overrides,
});

const ingest = (state, event, now) => reduceWorldToast(state, { type: 'world-event', event, now });

test('first whitelisted entity event projects a changed entry', { skip }, () => {
  const state = ingest(createWorldToastState(), baseEvent(), 1000);
  assert.equal(state.visible.length, 1);
  assert.equal(state.visible[0].status, 'changed');
  assert.equal(state.visible[0].eventIds[0], 'evt-1');
  assert.match(state.visible[0].message, /key/);
  assert.match(state.visible[0].message, /Next step/);
});

test('duplicate event id is idempotent and does not repeat the message', { skip }, () => {
  const once = ingest(createWorldToastState(), baseEvent(), 1000);
  const twice = ingest(once, baseEvent(), 1100);
  assert.equal(twice.visible.length, 1);
  assert.equal(twice.queued.length, 0);
  assert.deepEqual(twice.visible[0].eventIds, ['evt-1']);
  assert.equal(twice.visible[0].message, once.visible[0].message);
});

test('malformed detail and unknown type are discarded without seen pollution', { skip }, () => {
  const malformed = ingest(createWorldToastState(), baseEvent({ detail: { path: 'world/key.md' } }), 1000);
  assert.equal(malformed.visible.length, 0);
  assert.equal(malformed.queued.length, 0);
  assert.equal(malformed.seenIds.size, 0);
  const unknown = ingest(malformed, baseEvent({ id: 'evt-2', seq: 2, type: 'world_snapshot' }), 1000);
  assert.equal(unknown.visible.length, 0);
  assert.equal(unknown.seenIds.size, 0);
});

test('same-layer entity events inside the batch window merge and retain ids', { skip }, () => {
  let state = ingest(createWorldToastState(), baseEvent(), 1000);
  state = ingest(state, baseEvent({ id: 'evt-2', seq: 2, detail: { path: 'world/letter.md', name: 'letter', kind: 'note' } }), 1000 + WORLD_TOAST_BATCH_WINDOW_MS);
  assert.equal(state.visible.length, 1);
  assert.deepEqual(state.visible[0].eventIds, ['evt-1', 'evt-2']);
  assert.match(state.visible[0].message, /2/);
});

test('different layers do not merge', { skip }, () => {
  let state = ingest(createWorldToastState(), baseEvent(), 1000);
  state = ingest(state, baseEvent({ id: 'evt-2', seq: 2, layer: 'harbor', subject: 'letter', detail: { path: 'world/letter.md', name: 'letter', kind: 'note' } }), 1001);
  assert.equal(state.visible.length, 2);
  assert.notDeepEqual(state.visible[0].eventIds, state.visible[1].eventIds);
});

test('failed initialization remains visible with failure TTL and no success wording', { skip }, () => {
  const state = ingest(createWorldToastState(), baseEvent({
    id: 'evt-2', seq: 2, type: 'layer_init_failed', layer: 'harbor', detail: {
      layer: 'harbor', reason: 'writer stopped', fallback: 'none',
    },
  }), 1000);
  assert.equal(state.visible[0].status, 'failed');
  assert.equal(state.visible[0].expiresAt, 1000 + WORLD_TOAST_FAILED_TTL_MS);
  assert.doesNotMatch(state.visible[0].message, /solved|completed/i);
});

test('seen window is bounded and oldest ids can re-enter after eviction', { skip }, () => {
  let state = createWorldToastState();
  for (let seq = 1; seq <= WORLD_TOAST_SEEN_LIMIT + 1; seq += 1) {
    state = ingest(state, baseEvent({ id: `evt-${seq}`, seq, detail: { path: `world/${seq}.md`, name: String(seq), kind: 'note' } }), seq);
  }
  assert.equal(state.seenIds.size, WORLD_TOAST_SEEN_LIMIT);
  assert.equal(state.seenIds.has('evt-1'), false);
  const replay = ingest(state, baseEvent({ detail: { path: 'world/key.md', name: 'key', kind: 'note' } }), 9999);
  assert.equal(replay.seenIds.has('evt-1'), true);
});

test('store hold: toasts hide while a scene card is up and keep their remaining time (场景演出 §3.3)', { skip }, () => {
  const store = createWorldEventToastStore();
  let calls = 0;
  const unsubscribe = store.subscribe(() => { calls += 1; });
  assert.equal(store.ingest(baseEvent(), 1000), true);
  const [entry] = store.getSnapshot().visible;
  const ttl = entry.expiresAt - 1000;
  store.hold(true, 1500);
  assert.equal(store.isHeld(), true);
  assert.ok(calls >= 2, 'holding notifies, so the region re-reads and hides');
  store.tick(1000 + ttl + 10_000);
  assert.equal(store.getSnapshot().visible.length, 1, 'no expiry while held');
  store.hold(false, 4500);
  assert.equal(store.isHeld(), false);
  assert.equal(store.getSnapshot().visible[0].expiresAt, 1000 + ttl + 3000, 'clock shifted by the 3 s held');
  store.tick(4500 + ttl - 500 - 1);
  assert.equal(store.getSnapshot().visible.length, 1, 'the time it had left when held is kept');
  store.tick(1000 + ttl + 3000);
  assert.equal(store.getSnapshot().visible.length, 0);
  store.hold(false);
  unsubscribe();
});
