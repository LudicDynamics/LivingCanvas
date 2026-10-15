/**
 * the design notes — replay-window acceptance tests (`node --test`).
 *
 * Imports the built `apps/server/dist` (the probe runs dist too).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { EventBridge, replayWindow } from '../dist/engine/event-bridge.js';
import { REPLAY_BUFFER_KEEP } from '@airp/shared';

/** A bridge whose ring is live: `broadcast` needs a sink to reach the push. */
function ringBridge() {
  const bridge = new EventBridge();
  bridge.setWss({ clients: [] });
  return bridge;
}

/** A ring-shaped frame line. `writer_idle` ends a turn; anything else is content. */
const TEST_SAVE_PATH = '/test/world';
const line = (type, extra = {}) => JSON.stringify({ type, source: 'writer', savePath: TEST_SAVE_PATH, ...extra });
const IDLE = line('writer_idle');
const WRITE = line('chalk_writing');

/** One "complete turn": a few content frames then a `writer_idle`. */
function turn(n) {
  return [line('chalk_writing', { toolCallId: `t${n}` }), IDLE];
}
/** Concatenate `n` complete turns. */
function turns(n) {
  const out = [];
  for (let i = 1; i <= n; i += 1) out.push(...turn(i));
  return out;
}
/** The trailing half-turn: content frames with no `writer_idle`. */
const halfTurn = [line('chalk_writing', { toolCallId: 'tail' })];

// ------------------------------------------------------------------ §10-1 + §10-2
test('§10-1/2 five complete turns + a trailing half turn → newest 5 whole turns', () => {
  const buf = [...turns(5), ...halfTurn];
  const out = replayWindow(buf, 5);

  // HEAD trim: the oldest included turn is turn 1's FIRST frame, untruncated.
  assert.equal(out[0], buf[0], 'window starts at turn 1 frame 0');
  // TAIL trim: the trailing half turn is dropped — the last frame is a `writer_idle`.
  assert.equal(JSON.parse(out.at(-1)).type, 'writer_idle', 'last frame is writer_idle');
  assert.ok(!out.some((l) => JSON.parse(l).toolCallId === 'tail'), 'tail half-turn absent');
  assert.equal(out.length, 10, 'five complete turns, two frames each');
});

test('§10-1 six complete turns + a trailing half turn → starts after the (turns+1)th idle', () => {
  const buf = [...turns(6), ...halfTurn];
  const out = replayWindow(buf, 5);

  // 6 turns → idles at indices 1,3,5,7,9,11. The (turns+1)=6th idle from the
  // tail is index 1 (turn 1's), so the window opens at index 2 — turn 2's first
  // frame, preserving turns 2..6 as five whole turns.
  assert.equal(out[0], buf[2], 'starts after the 6th idle from the tail');
  assert.equal(JSON.parse(out.at(-1)).type, 'writer_idle', 'last frame is writer_idle');
  assert.equal(out.length, 10, 'five complete turns');
});

// ---------------------------------------------------------------------------- §10-3
test('§10-3 fewer than `turns` complete turns → the whole buffer', () => {
  const buf = turns(2);
  const out = replayWindow(buf, 5);
  assert.deepEqual(out, buf, 'two turns, no trailing residue → unchanged');
});

// ---------------------------------------------------------------------------- §10-4
test('§10-4 no `writer_idle` at all → []', () => {
  const buf = [WRITE, WRITE, WRITE];
  assert.deepEqual(replayWindow(buf, 5), [], 'a buffer of half-turns yields nothing');
});

// ---------------------------------------------------------------------------- §10-5
test('§10-5 a non-JSON line is replayed verbatim and does not count as a turn', () => {
  const bogus = 'not json';
  const clean = [...turns(2)];
  const dirty = [...turns(2).slice(0, 2), bogus, ...turns(2).slice(2)];

  const cleanOut = replayWindow(clean, 5);
  const dirtyOut = replayWindow(dirty, 5);

  assert.ok(dirtyOut.includes(bogus), 'the malformed line is carried through');
  assert.equal(dirtyOut.length, cleanOut.length + 1, 'exactly one extra line');
  assert.equal(
    JSON.parse(dirtyOut.at(-1)).type,
    'writer_idle',
    'the tail half-turn is still trimmed identically',
  );
  assert.deepEqual(
    dirtyOut.filter((l) => l !== bogus),
    cleanOut,
    'the turn boundaries are unchanged by the bad line',
  );
});

// ---------------------------------------------------------------------------- §10-6
test('§10-6 the ring is bounded and drops the OLDEST lines', () => {
  const bridge = ringBridge();
  const over = REPLAY_BUFFER_KEEP + 10;
  for (let i = 0; i < over; i += 1) {
    bridge.broadcast({ type: 'chalk_writing', source: 'writer', savePath: TEST_SAVE_PATH, toolCallId: `c${i}` });
  }
  const ring = bridge.replayRingsBySavePath.get(TEST_SAVE_PATH) ?? [];
  assert.equal(ring.length, REPLAY_BUFFER_KEEP, 'length is capped');
  // The first 10 broadcast frames were evicted from the head.
  assert.equal(JSON.parse(ring[0]).toolCallId, 'c10', 'oldest 10 dropped');
});

// ---------------------------------------------------------------------------- §10-7
test('§10-7 allowlist: only the 5 content-rebuild frames ever enter the ring', () => {
  const bridge = ringBridge();
  const OUT = [
    'world_event', 'file_changed', 'error', 'turn_aborted', 'agent_progress',
    'writer_delta', 'dice_result', 'show_frame', 'image_landed',
  ];
  const IN = ['chalk_writing', 'chalk_landed', 'card_writing', 'writer_message', 'writer_idle'];

  for (const type of OUT) bridge.broadcast({ type, source: 'writer', savePath: TEST_SAVE_PATH });
  for (const type of OUT) {
    assert.ok(
      !(bridge.replayRingsBySavePath.get(TEST_SAVE_PATH) ?? []).some((payload) => JSON.parse(payload).type === type),
      `${type} must NOT enter the ring`,
    );
  }

  for (const type of IN) bridge.broadcast({ type, source: 'writer', savePath: TEST_SAVE_PATH });
  for (const type of IN) {
    assert.ok(
      (bridge.replayRingsBySavePath.get(TEST_SAVE_PATH) ?? []).some((payload) => JSON.parse(payload).type === type),
      `${type} must enter the ring`,
    );
  }
});

// ---------------------------------------------------------------------------- §10-8
test('§10-8 replayTo ends with ONE replay_done whose `turns` is the replayed count', () => {
  const bridge = ringBridge();
  for (const message of turns(3).map((l) => JSON.parse(l))) bridge.broadcast(message);

  const sent = [];
  bridge.replayTo({ readyState: 1, send: (s) => sent.push(s) }, TEST_SAVE_PATH);

  const done = sent.map((s) => JSON.parse(s)).filter((f) => f.type === 'replay_done');
  assert.equal(done.length, 1, 'exactly one replay_done');
  assert.equal(sent.at(-1), JSON.stringify(done[0]), 'it is the last frame');
  assert.equal(typeof done[0].turns, 'number', 'turns is a number');
  assert.equal(done[0].turns, 3, 'turns equals the number of complete turns replayed');
  assert.equal(typeof done[0].timestamp, 'string', 'timestamp present (frame family shape)');
  // The replayed frames themselves precede the boundary frame.
  assert.equal(sent.length, 6 + 1, 'six content frames then replay_done');
});

test('§10-8b an empty ring still sends replay_done with turns: 0', () => {
  const bridge = ringBridge();
  const sent = [];
  bridge.replayTo({ readyState: 1, send: (s) => sent.push(s) }, TEST_SAVE_PATH);
  assert.equal(sent.length, 1, 'the boundary frame is always sent');
  assert.deepEqual(JSON.parse(sent[0]).type, 'replay_done');
  assert.equal(JSON.parse(sent[0]).turns, 0, 'nothing replayed → 0 turns');
});

// ---------------------------------------------------------------------------- §10-9
test('§10-9 a CLOSED socket sends nothing and does not throw', () => {
  const bridge = ringBridge();
  for (const message of turns(2).map((l) => JSON.parse(l))) bridge.broadcast(message);
  let calls = 0;
  assert.doesNotThrow(() => bridge.replayTo({ readyState: 3, send: () => { calls += 1; } }, TEST_SAVE_PATH));
  assert.equal(calls, 0, 'no send on a non-OPEN socket');
});

// --------------------------------------------------------------------------- §10-10
test('§10-10 a throwing send does not stop the remaining frames', () => {
  const bridge = ringBridge();
  for (const message of turns(2).map((l) => JSON.parse(l))) bridge.broadcast(message);

  const sent = [];
  bridge.replayTo({
    readyState: 1,
    send: (s) => {
      sent.push(s);
      if (sent.length === 2) throw new Error('half-dead socket');
    },
  }, TEST_SAVE_PATH);

  // 4 content frames + replay_done = 5 attempts; the 2nd threw, the rest landed.
  assert.equal(sent.length, 5, 'the frames after the throw are still sent');
  assert.equal(JSON.parse(sent.at(-1)).type, 'replay_done', 'the boundary frame survives');
});

test('replay is isolated to the connected world root', () => {
  const bridge = ringBridge();
  bridge.broadcast({ type: 'writer_message', source: 'writer', savePath: '/world/a', turnId: 'a' });
  bridge.broadcast({ type: 'writer_idle', source: 'writer', savePath: '/world/a', turnId: 'a' });
  bridge.broadcast({ type: 'writer_message', source: 'writer', savePath: '/world/b', turnId: 'b' });
  bridge.broadcast({ type: 'writer_idle', source: 'writer', savePath: '/world/b', turnId: 'b' });
  const sent = [];
  bridge.replayTo({ readyState: 1, send: payload => sent.push(JSON.parse(payload)) }, '/world/a');
  assert.deepEqual(sent.map(frame => frame.turnId).filter(Boolean), ['a', 'a']);
  assert.ok(sent.every(frame => frame.savePath === '/world/a'));
  assert.equal(sent.at(-1).type, 'replay_done');
});
