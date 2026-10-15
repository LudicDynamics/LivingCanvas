// Activity-chip lifecycle assertions.
// `lib/agent-activity.ts` and `lib/agent-activity-store.ts` have no React and no
// DOM, so jiti imports the TS source directly — same bootstrap as ghost.test.mjs.
// Run: node --test apps/web/test/agent-activity.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let mod = null;
let storeMod = null;
try {
  const { createJiti } = await import('../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs');
  const jiti = createJiti(import.meta.url, { moduleCache: false, tryNative: true });
  mod = await jiti.import('../src/lib/agent-activity.ts');
  storeMod = await jiti.import('../src/lib/agent-activity-store.ts');
} catch (err) {
  console.error('jiti/bootstrap unavailable, skipping activity group:', err?.message ?? err);
}

const skip = mod ? false : 'jiti or pi-rp submodule unavailable';

const {
  ACTIVITY_COMPLETE_TTL_MS,
  ACTIVITY_FAILED_TTL_MS,
  ACTIVITY_STALE_TTL_MS,
  MAX_VISIBLE_ACTIVITIES,
  normalizeAgentActivityFrame,
  upsertActivity,
  promoteActivities,
  pruneActivities,
  visibleActivities,
  selectAgentActivityLog,
  selectAgentActivityLogEntries,
  surfaceForSource,
  activityLabel,
  activityAriaText,
  summariseActivities,
  RUNNING_KEYS,
  OK_KEYS,
  ERROR_KEYS,
} = mod ?? {};

// ISO timestamps must resolve to a real epoch; an unparsable one uses `now`.
test('timestamp resolves via Date.parse, falling back to now', { skip }, () => {
  const iso = normalizeAgentActivityFrame(frame({ timestamp: '2026-09-13T10:00:00.000Z' }), 42);
  assert.equal(iso.startedAt, Date.parse('2026-09-13T10:00:00.000Z'));
  const bad = normalizeAgentActivityFrame(frame({ timestamp: 'not-a-date' }), 42);
  assert.equal(bad.startedAt, 42);
});

// No `timestamp` by default: the injected `now` then defines the chip clock,
// which is what lets the TTL cases use small, exact numbers. The timestamp
// fallback has its own case below.
const frame = (over) => ({
  type: 'agent_activity',
  source: 'writer',
  agentId: 'writer',
  turnId: 't1',
  activityId: 't1:c1',
  phase: 'started',
  operation: 'read',
  subject: 'the letter',
  ...over,
});

// `t` that only interpolates: it mirrors i18n.translate's en behaviour (key = en).
const t = (key, values = {}) =>
  key.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? `{${name}}`));

const createScopedStore = (savePath = '/saves/test') => {
  const store = storeMod.createAgentActivityStore();
  store.selectSave(savePath);
  return store;
};

const activityIds = (store) =>
  selectAgentActivityLog(store.getLogSnapshot(), { surface: 'rail' })
    .flatMap((turn) => turn.entries.map((entry) => entry.activityId))
    .sort();

const ONE = ACTIVITY_STALE_TTL_MS;

test('constants are the frozen values (contract §3.2)', { skip }, () => {
  assert.equal(ACTIVITY_COMPLETE_TTL_MS, 2400);
  assert.equal(ACTIVITY_FAILED_TTL_MS, 4500);
  assert.equal(ACTIVITY_STALE_TTL_MS, 90000);
  assert.equal(MAX_VISIBLE_ACTIVITIES, 3);
});

test('LC1 frame maps started/completed/failed and de-dups by activityId', { skip }, () => {
  assert.equal(normalizeAgentActivityFrame(frame()).state, 'running');
  assert.equal(normalizeAgentActivityFrame(frame({ phase: 'completed' })).state, 'ok');
  assert.equal(normalizeAgentActivityFrame(frame({ phase: 'failed' })).state, 'error');

  const a = normalizeAgentActivityFrame(frame(), 1000);
  const b = upsertActivity([], a);
  assert.equal(b.length, 1);
  assert.equal(b[0].activityId, 't1:c1');
});

test('LC2-STRONG duplicate started keeps one chip and does not refresh startedAt', { skip }, () => {
  const once = upsertActivity([], normalizeAgentActivityFrame(frame(), 1000));
  const twice = upsertActivity(once, normalizeAgentActivityFrame(frame(), 6000));
  assert.equal(twice.length, 1);
  assert.equal(twice[0].startedAt, 1000);

  const done = upsertActivity(twice, normalizeAgentActivityFrame(frame({ phase: 'completed' }), 7000));
  assert.equal(done.length, 1);
  assert.equal(done[0].state, 'ok');
  assert.equal(upsertActivity(done, normalizeAgentActivityFrame(frame(), 200)).length, 1);
  assert.equal(upsertActivity(done, normalizeAgentActivityFrame(frame(), 200))[0].state, 'ok');
});

test('LC3 terminal absorbs any later frame, including an out-of-order started', { skip }, () => {
  let list = upsertActivity([], normalizeAgentActivityFrame(frame(), 1000));
  list = upsertActivity(list, normalizeAgentActivityFrame(frame({ phase: 'failed' }), 2000));
  assert.equal(list[0].state, 'error');
  const after = upsertActivity(list, normalizeAgentActivityFrame(frame({ phase: 'completed' }), 500));
  assert.equal(after.length, 1);
  assert.equal(after[0].state, 'error');
  assert.equal(after[0].endedAt, 2000);
});

test('malformed frames are dropped whole, never half-rendered', { skip }, () => {
  assert.equal(normalizeAgentActivityFrame(null), null);
  assert.equal(normalizeAgentActivityFrame({ type: 'tool_start' }), null);
  assert.equal(normalizeAgentActivityFrame(frame({ phase: 'nope' })), null);
  assert.equal(normalizeAgentActivityFrame(frame({ source: 'ghost' })), null);
  assert.equal(normalizeAgentActivityFrame(frame({ activityId: '' })), null);
  assert.equal(normalizeAgentActivityFrame(frame({ agentId: '' })), null);
  // Unknown operation degrades to 'other' instead of breaking the chip.
  assert.equal(normalizeAgentActivityFrame(frame({ operation: 'teleport' })).operation, 'other');
});

test('LC4 a visible terminal is pruned at its own TTL, queued terminals are not', { skip }, () => {
  const started = normalizeAgentActivityFrame(frame(), 0);
  let list = promoteActivities([started], 'rail', 0);
  assert.equal(list[0].visibleAt, 0);

  list = upsertActivity(list, normalizeAgentActivityFrame(frame({ phase: 'completed' }), 100));
  assert.equal(pruneActivities(list, 100 + ACTIVITY_COMPLETE_TTL_MS - 1).length, 1);
  assert.equal(pruneActivities(list, 100 + ACTIVITY_COMPLETE_TTL_MS).length, 0);

  let failed = promoteActivities([normalizeAgentActivityFrame(frame(), 0)], 'rail', 0);
  failed = upsertActivity(failed, normalizeAgentActivityFrame(frame({ phase: 'failed' }), 100));
  assert.equal(pruneActivities(failed, 100 + ACTIVITY_FAILED_TTL_MS).length, 0);

  // A terminal that never got a slot must survive pruning indefinitely.
  const queued = normalizeAgentActivityFrame(
    frame({ activityId: 't1:c9', phase: 'completed', timestamp: '2026-09-13T10:00:00.000Z' }),
    50,
  );
  assert.equal(queued.visibleAt, undefined);
  assert.equal(pruneActivities([queued], 10 * ONE).length, 1);
});

test('LC5 running without a terminal fails as timeout after the stale window', { skip }, () => {
  const list = promoteActivities([normalizeAgentActivityFrame(frame(), 0)], 'rail', 0);
  const swept = pruneActivities(list, ONE - 1);
  assert.equal(swept[0].state, 'running');
  const timedOut = pruneActivities(list, ONE);
  assert.equal(timedOut[0].state, 'error');
  assert.equal(timedOut[0].errorKind, 'timeout');
  assert.equal(timedOut[0].state === 'error' && timedOut[0].endedAt, ONE);
});

test('LC6 concurrent chips cap at MAX_VISIBLE and queue the rest without loss', { skip }, () => {
  let list = [];
  for (let i = 1; i <= 4; i++) {
    list = upsertActivity(list, normalizeAgentActivityFrame(frame({ activityId: `t1:c${i}` }), i * 10));
  }
  list = promoteActivities(list, 'rail', 100);
  assert.equal(list.length, 4); // nothing dropped
  const visible = visibleActivities(list, 'rail');
  assert.equal(visible.length, MAX_VISIBLE_ACTIVITIES);
  assert.deepEqual(visible.map((a) => a.activityId), ['t1:c1', 't1:c2', 't1:c3']);

  // The first three finish while visible; the 4th finishes while queued, so it
  // has no `visibleAt` and keeps its data (and its un-started TTL) until a slot
  // opens — a finished chip must never vanish before the player saw it.
  for (const id of ['t1:c1', 't1:c2', 't1:c3']) {
    list = upsertActivity(list, normalizeAgentActivityFrame(frame({ activityId: id, phase: 'completed' }), 120));
  }
  list = upsertActivity(list, normalizeAgentActivityFrame(frame({ activityId: 't1:c4', phase: 'completed' }), 130));
  const queued = list.find((a) => a.activityId === 't1:c4');
  assert.equal(queued.visibleAt, undefined);
  assert.equal(visibleActivities(list, 'rail').length, MAX_VISIBLE_ACTIVITIES);

  // First three fade 2400ms after they finished (endedAt 120); the queued one is
  // then promoted and gets a full TTL from *that* moment.
  const fadeAt = 120 + ACTIVITY_COMPLETE_TTL_MS;
  list = pruneActivities(list, fadeAt);
  list = promoteActivities(list, 'rail', fadeAt);
  const promoted = visibleActivities(list, 'rail');
  assert.deepEqual(promoted.map((a) => a.activityId), ['t1:c4']);
  const promotedAt = promoted[0].visibleAt;
  assert.equal(promotedAt, fadeAt);
  assert.equal(pruneActivities(list, promotedAt + ACTIVITY_COMPLETE_TTL_MS).length, 0);
});

test('LC7 surface routing keeps character chips out of the global rail', { skip }, () => {
  assert.equal(surfaceForSource('writer'), 'rail');
  assert.equal(surfaceForSource('functional'), 'rail');
  assert.equal(surfaceForSource('character'), 'character-modal');

  let list = [];
  list = upsertActivity(list, normalizeAgentActivityFrame(frame({ activityId: 'w1' }), 0));
  list = upsertActivity(list, normalizeAgentActivityFrame(frame({
    activityId: 'k1', source: 'character', agentId: 'character:watson', operation: 'look',
  }), 0));
  list = promoteActivities(list, 'rail', 0);
  list = promoteActivities(list, 'character-modal', 0);
  assert.deepEqual(visibleActivities(list, 'rail').map((a) => a.activityId), ['w1']);
  assert.deepEqual(visibleActivities(list, 'character-modal').map((a) => a.activityId), ['k1']);
});

test('LC8 clearSurface cancels running chips; the next character inherits nothing', { skip }, () => {
  const store = createScopedStore();
  store.ingest(frame({ activityId: 'k1', source: 'character', agentId: 'character:watson' }), 0);
  store.ingest(frame({ activityId: 'w1' }), 0);
  store.clearSurface('character-modal', 500);

  const chips = store.getSnapshot();
  const character = chips.find((a) => a.activityId === 'k1');
  assert.equal(character.state, 'error');
  assert.equal(character.errorKind, 'cancelled');
  assert.equal(character.endedAt, 500);
  // The global rail is untouched by a character close.
  assert.equal(chips.find((a) => a.activityId === 'w1').state, 'running');
  // A different character's query sees no leftover chip.
  assert.equal(store.getSnapshot().filter((a) => a.agentId === 'character:holmes').length, 0);
});

test('LC9 clearAll leaves no residue and no aria copy', { skip }, () => {
  const store = createScopedStore();
  store.ingest(frame({ activityId: 'w1' }), 0);
  store.ingest(frame({ activityId: 'w2' }), 0);
  assert.equal(store.getSnapshot().length, 2);
  store.clearAll();
  assert.equal(store.getSnapshot().length, 0);
  assert.equal(summariseActivities([], t), '');
});

test('store ingest is idempotent: a repeated frame reports no change', { skip }, () => {
  const store = createScopedStore();
  assert.equal(store.ingest(frame(), 0), true);
  assert.equal(store.ingest(frame(), 10), false); // duplicate started
  assert.equal(store.ingest(frame({ phase: 'completed' }), 20), true);
  assert.equal(store.ingest(frame(), 30), false); // terminal absorbs
  assert.equal(store.getSnapshot().length, 1);
});

test('activity details stay with their save across A → B → A', { skip }, () => {
  const store = createScopedStore('/saves/A');
  assert.equal(store.isSaveActive('/saves/A'), true);
  store.ingest(frame({ activityId: 'a-1', turnId: 'a-turn', phase: 'completed' }), 1);
  store.ingest(frame({ activityId: 'a-2', turnId: 'a-turn', phase: 'completed' }), 2);
  assert.deepEqual(activityIds(store), ['a-1', 'a-2']);

  store.selectSave(null);
  assert.equal(store.isSaveActive('/saves/A'), false);
  assert.equal(store.ingest(frame({ activityId: 'late-a', turnId: 'a-turn' }), 3), false);
  store.selectSave('/saves/B');
  assert.equal(store.isSaveActive('/saves/B'), true);
  assert.deepEqual(activityIds(store), []);
  assert.equal(store.ingest(frame({ activityId: 'late-a-after-switch', turnId: 'a-turn' }), 3, '/saves/A'), false);
  store.ingest(frame({ activityId: 'b-1', turnId: 'b-turn', phase: 'completed' }), 4);
  assert.deepEqual(activityIds(store), ['b-1']);

  store.selectSave('/saves/A');
  assert.equal(store.isSaveActive('/saves/A'), true);
  assert.deepEqual(activityIds(store), ['a-1', 'a-2']);
  store.selectSave('/saves/B');
  assert.deepEqual(activityIds(store), ['b-1']);
});

test('store tick advances TTLs and stays a no-op when nothing expires', { skip }, () => {
  const store = createScopedStore();
  store.ingest(frame(), 0);
  store.ingest(frame({ phase: 'completed' }), 10);
  const before = store.getSnapshot();
  store.tick(1000);
  assert.equal(store.getSnapshot(), before, 'tick must not swap the snapshot when idle');
  store.tick(10 + ACTIVITY_COMPLETE_TTL_MS);
  assert.equal(store.getSnapshot().length, 0);
});

test('LC10 chip copy never leaks activityId, toolName, args or paths', { skip }, () => {
  const cases = [
    frame({ toolName: 'read_file', activityId: 't1:c1' }),
    frame({ phase: 'completed', toolName: 'read_file' }),
    frame({ phase: 'failed', error: 'ENOENT /home/u/secret' }),
    frame({ operation: 'other' }),
  ];
  for (const raw of cases) {
    const act = normalizeAgentActivityFrame(raw, 0);
    for (const text of [activityLabel(act, t), activityAriaText(act, t), summariseActivities([act], t)]) {
      assert.ok(!text.includes('t1:c1'), `leaked activityId: ${text}`);
      assert.ok(!text.includes('read_file'), `leaked toolName: ${text}`);
      assert.ok(!text.includes('/home/'), `leaked path: ${text}`);
      assert.ok(!text.includes('{') && !text.includes('}'), `unresolved slot: ${text}`);
    }
  }
});

test('LC10 timeout/cancel override the per-operation failure copy', { skip }, () => {
  const timedOut = { ...normalizeAgentActivityFrame(frame({ phase: 'failed' }), 0), errorKind: 'timeout' };
  const cancelled = { ...normalizeAgentActivityFrame(frame({ phase: 'failed' }), 0), errorKind: 'cancelled' };
  assert.equal(activityLabel(timedOut, t), 'Took too long');
  assert.equal(activityLabel(cancelled, t), 'Stopped');
});

test('LC10 subject-less chips use the no-object sentence', { skip }, () => {
  const bare = normalizeAgentActivityFrame(frame({ subject: undefined }));
  assert.equal(activityLabel(bare, t), 'Reading…');
  const ok = normalizeAgentActivityFrame(frame({ phase: 'completed', subject: undefined }));
  assert.equal(activityLabel(ok, t), 'Read');
});

// The `memory` operation is a boundary value: the wire carries it, the
// OPERATIONS guard must keep it (a miss silently degrades to 'other'), and its
// copy is subject-independent because a memory subject is never emitted.
test('LC10 the memory operation survives the guard and uses its own copy', { skip }, () => {
  const running = normalizeAgentActivityFrame(frame({ operation: 'memory', subject: undefined }), 0);
  assert.equal(running.operation, 'memory');
  assert.equal(activityLabel(running, t), 'Remembering…');
  const ok = normalizeAgentActivityFrame(frame({ operation: 'memory', phase: 'completed', subject: undefined }), 0);
  assert.equal(activityLabel(ok, t), 'Remembered');
  const failed = normalizeAgentActivityFrame(frame({ operation: 'memory', phase: 'failed', subject: undefined }), 0);
  assert.equal(activityLabel(failed, t), 'Could not remember');
  assert.deepEqual(RUNNING_KEYS.memory, { with: 'Remembering…', without: 'Remembering…' });
});

test('LC10 every label key exists in messages.json with non-empty zh-CN and ja', { skip }, () => {
  const path = fileURLToPath(new URL('../src/lib/messages.json', import.meta.url));
  const messages = JSON.parse(readFileSync(path, 'utf8'));
  const keys = new Set();
  for (const table of [RUNNING_KEYS, OK_KEYS, ERROR_KEYS]) {
    for (const pair of Object.values(table)) {
      keys.add(pair.with);
      keys.add(pair.without);
    }
  }
  for (const extra of [
    'Took too long', 'Stopped', 'Writer', 'Character', 'Background task',
    '{name} is reading {subject}…', '{name} is working…', '{name} finished {subject}',
    '{name} is done', '{name} could not use {subject}', '{name} could not act',
    '{name} took too long', '{name} stopped',
    '{count} action in progress', '{count} actions in progress',
    '{count} action finished', '{count} actions finished',
  ]) keys.add(extra);

  for (const key of keys) {
    const entry = messages[key];
    assert.ok(entry, `missing messages.json key: ${key}`);
    assert.ok(entry['zh-CN'] && entry['zh-CN'].trim() !== '', `missing zh-CN for ${key}`);
    assert.ok(entry.ja && entry.ja.trim() !== '', `missing ja for ${key}`);
  }
});

test('LC10 the with/without key sets line up operation by operation', { skip }, () => {
  for (const table of [RUNNING_KEYS, OK_KEYS, ERROR_KEYS]) {
    for (const [op, pair] of Object.entries(table)) {
      assert.ok(pair.with && pair.without, `empty label pair for ${op}`);
      // A subject-less key must never keep an unfilled slot. The `with` key may
      // legitimately have no slot (roll / choose / initialize ignore the object).
      assert.ok(!pair.without.includes('{subject}'), `${op}: without-key still has {subject}`);
      assert.ok(!pair.without.includes('{'), `${op}: without-key has another slot`);
    }
  }
});


test('summariseActivities reports running count, then finished count', { skip }, () => {
  const a = normalizeAgentActivityFrame(frame({ activityId: 'a' }), 0);
  const b = normalizeAgentActivityFrame(frame({ activityId: 'b' }), 0);
  assert.equal(summariseActivities([a, b], t), '2 actions in progress');
  assert.equal(summariseActivities([a], t), '1 action in progress');
  const done = upsertActivity([], normalizeAgentActivityFrame(frame({ phase: 'completed' }), 0));
  assert.equal(summariseActivities(done, t), '1 action finished');
  assert.equal(summariseActivities([...done, ...done.map((x) => ({ ...x, activityId: 'z' }))], t), '2 actions finished');
});

test('complete log keeps four actions after the three-chip rail cap', { skip }, () => {
  const records = [1, 2, 3, 4].map((index) =>
    normalizeAgentActivityFrame(frame({ activityId: `t1:c${index}`, phase: 'completed' }), index),
  );
  const visible = promoteActivities(records, 'rail', 100);
  assert.equal(visibleActivities(visible, 'rail').length, 3);
  const turns = selectAgentActivityLog(records, { surface: 'rail' });
  assert.equal(turns.length, 1);
  assert.equal(turns[0].entries.length, 4);
});

test('store retains terminal records after the rail TTL', { skip }, () => {
  const store = createScopedStore();
  store.ingest(frame({ phase: 'completed' }), 10);
  store.tick(10 + ACTIVITY_COMPLETE_TTL_MS);
  assert.equal(store.getSnapshot().length, 0);
  assert.equal(store.getLogSnapshot().length, 1);
  assert.equal(store.getLogSnapshot()[0].state, 'ok');
});

test('log selector de-duplicates activity ids and preserves turn boundaries', { skip }, () => {
  const start = normalizeAgentActivityFrame(frame({ activityId: 'a', turnId: 'turn-a' }), 10);
  const done = normalizeAgentActivityFrame(frame({ activityId: 'a', turnId: 'turn-a', phase: 'completed' }), 20);
  const otherTurn = normalizeAgentActivityFrame(frame({ activityId: 'b', turnId: 'turn-b' }), 30);
  const turns = selectAgentActivityLog([start, done, start, otherTurn], { surface: 'rail' });
  assert.deepEqual(turns.map((turn) => turn.turnId), ['turn-b', 'turn-a']);
  assert.equal(turns[1].entries.length, 1);
  assert.equal(turns[1].entries[0].state, 'ok');
  assert.equal(turns[1].entries[0].startedAt, 10);
});

test('global and character log projections stay isolated by surface and session', { skip }, () => {
  const writer = normalizeAgentActivityFrame(frame({ activityId: 'writer-1' }), 10);
  const functional = normalizeAgentActivityFrame(frame({
    activityId: 'functional-1',
    source: 'functional',
    agentId: 'scene-init',
  }), 20);
  const oldCharacter = normalizeAgentActivityFrame(frame({
    activityId: 'character-old',
    source: 'character',
    agentId: 'character:a',
  }), 30);
  const newCharacter = normalizeAgentActivityFrame(frame({
    activityId: 'character-new',
    source: 'character',
    agentId: 'character:a',
  }), 60);
  const records = [writer, functional, oldCharacter, newCharacter];
  assert.deepEqual(
    selectAgentActivityLogEntries(records, { surface: 'rail' }).map((entry) => entry.activityId),
    ['writer-1', 'functional-1'],
  );
  assert.deepEqual(
    selectAgentActivityLogEntries(records, {
      surface: 'character-modal',
      agentId: 'character:a',
      since: 50,
    }).map((entry) => entry.activityId),
    ['character-new'],
  );
  assert.equal(selectAgentActivityLogEntries(records, { surface: 'character-modal' }).length, 0);
});

test('safe activity copy omits raw errors and internal identifiers', { skip }, () => {
  const act = normalizeAgentActivityFrame(frame({
    activityId: 'private-id',
    toolName: 'read_file',
    phase: 'failed',
    error: 'ENOENT /home/user/.ssh/id_rsa',
  }), 0);
  const turns = selectAgentActivityLog([act], { surface: 'rail' });
  const text = [
    activityLabel(turns[0].entries[0], t),
    activityAriaText(turns[0].entries[0], t),
  ].join(' ');
  assert.equal(text.includes('ENOENT'), false);
  assert.equal(text.includes('/home/user'), false);
  assert.equal(text.includes('private-id'), false);
  assert.equal(text.includes('read_file'), false);
});
