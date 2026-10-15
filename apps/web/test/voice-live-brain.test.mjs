// A direct voice-live call (page → ai.worldlines.gg → voice-live): the page
// answers for the character over its own canvas socket (voice-live-brain.ts),
// and gets onto the call with a ticket its server fetched (requestCallTicket).
// Fakes only: no socket, no server, no voice-live.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

globalThis.WebSocket ??= { OPEN: 1 };
const jiti = createJiti(import.meta.url, { moduleCache: false });
const { createBrainRelay } = await jiti.import('../src/lib/voice-live-brain.ts');
const bridgeModule = await jiti.import('../src/lib/canvas-socket-bridge.ts');
const { requestCallTicket, voiceLiveUrl } = await jiti.import('../src/lib/voice-live-call.ts');

function fakeBridge({ connected = true } = {}) {
  const sent = [];
  const listeners = new Set();
  return {
    sent,
    publish: (frame) => listeners.forEach((l) => l(frame)),
    listeners,
    send: (frame) => (connected ? (sent.push(frame), true) : false),
    subscribe: (listener) => (listeners.add(listener), () => listeners.delete(listener)),
  };
}

const SAVE_A = '/saves/a';

const brain = (frame) => ({ type: 'brain', frame });

test('voice-live’s frames for this character go onto the canvas socket, only the protocol’s fields', () => {
  const bridge = fakeBridge();
  const relay = createBrainRelay('vera', SAVE_A, () => {}, bridge);
  assert.equal(relay.take(brain({ type: 'character_start', characterId: 'vera', savePath: SAVE_A, recentContext: '' })), true);
  assert.equal(relay.take(brain({ type: 'character_prompt', characterId: 'vera', savePath: SAVE_A, message: 'hello', extra: 'dropped' })), true);
  assert.equal(relay.take(brain({ type: 'character_abort', characterId: 'vera', savePath: SAVE_A })), true);
  assert.deepEqual(bridge.sent, [
    { type: 'character_start', characterId: 'vera', savePath: SAVE_A, recentContext: '' },
    { type: 'character_prompt', characterId: 'vera', savePath: SAVE_A, message: 'hello' },
    { type: 'character_abort', characterId: 'vera', savePath: SAVE_A },
  ]);
});

test('the call cannot drive anything else — and cannot stop the agent the page is using', () => {
  const bridge = fakeBridge();
  const relay = createBrainRelay('vera', SAVE_A, () => {}, bridge);
  for (const frame of [
    { type: 'character_stop', characterId: 'vera', savePath: SAVE_A },
    { type: 'character_prompt', characterId: 'old-mo', savePath: SAVE_A, message: 'hi' },
    { type: 'character_prompt', characterId: 'vera', savePath: '/saves/b', message: 'from another save' },
    { type: 'writer_prompt', savePath: SAVE_A, message: 'rewrite everything' },
    { type: 'airp_init', savePath: SAVE_A, kind: 'scene' },
  ]) assert.equal(relay.take(brain(frame)), true, `${frame.type} is consumed, never shown as a call event`);
  assert.deepEqual(bridge.sent, []);
});

test('her answers come back up wrapped; other characters, the writer and canvas chatter do not', () => {
  const bridge = fakeBridge();
  const up = [];
  createBrainRelay('vera', SAVE_A, (m) => up.push(m), bridge);
  bridge.publish({ type: 'character_delta', characterId: 'old-mo', savePath: SAVE_A, delta: 'not her' });
  bridge.publish({ type: 'writer_delta', savePath: SAVE_A, delta: 'narration' });
  bridge.publish({ type: 'file_changed', path: 'x', savePath: SAVE_A });
  bridge.publish({ type: 'character_delta', characterId: 'vera', savePath: '/saves/b', delta: 'late A' });
  bridge.publish({ type: 'character_delta', characterId: 'vera', savePath: SAVE_A, delta: 'Evening.' });
  bridge.publish({ type: 'character_idle', characterId: 'vera', savePath: SAVE_A });
  assert.deepEqual(up, [
    { type: 'brain', frame: { type: 'character_delta', characterId: 'vera', savePath: SAVE_A, delta: 'Evening.' } },
    { type: 'brain', frame: { type: 'character_idle', characterId: 'vera', savePath: SAVE_A } },
  ]);
});

test('no canvas socket: the turn fails at once instead of waiting out the timeout', () => {
  const up = [];
  const relay = createBrainRelay('vera', SAVE_A, (m) => up.push(m), fakeBridge({ connected: false }));
  relay.take(brain({ type: 'character_prompt', characterId: 'vera', savePath: SAVE_A, message: 'hi' }));
  assert.equal(up.at(-1).frame.type, 'error');
  assert.equal(up.at(-1).frame.characterId, 'vera');
  assert.equal(up.at(-1).frame.savePath, SAVE_A);
});

test('hang-up unsubscribes; call frames are left to the call', () => {
  const bridge = fakeBridge();
  const up = [];
  const relay = createBrainRelay('vera', SAVE_A, (m) => up.push(m), bridge);
  assert.equal(relay.take({ type: 'segment', id: 1, text: 'hi' }), false);
  relay.close();
  assert.equal(bridge.listeners.size, 0);
  bridge.publish({ type: 'character_delta', characterId: 'vera', savePath: SAVE_A, delta: 'late' });
  assert.deepEqual(up, []);
});

test('the canvas socket bridge: send needs an open socket, a throwing subscriber cannot break the others', () => {
  const sent = [];
  assert.equal(bridgeModule.sendCanvasSocketFrame({ type: 'x' }), false, 'nothing bound');
  bridgeModule.bindCanvasSocket({ readyState: 1, send: (t) => sent.push(JSON.parse(t)) });
  assert.equal(bridgeModule.sendCanvasSocketFrame({ type: 'x' }), true);
  assert.deepEqual(sent, [{ type: 'x' }]);
  const seen = [];
  const off1 = bridgeModule.subscribeCanvasSocketFrames(() => { throw new Error('bad subscriber'); });
  const off2 = bridgeModule.subscribeCanvasSocketFrames((f) => seen.push(f));
  bridgeModule.publishCanvasSocketFrame({ type: 'y' });
  assert.deepEqual(seen, [{ type: 'y' }]);
  off1(); off2();
  bridgeModule.bindCanvasSocket(null);
  assert.equal(bridgeModule.sendCanvasSocketFrame({ type: 'x' }), false);
});

test('the ticket answer decides the way in; an old server without the route keeps the proxied call', async () => {
  const realFetch = globalThis.fetch;
  const requests = [];
  const answer = (status, body) => {
    globalThis.fetch = async (_url, init) => {
      requests.push(JSON.parse(init.body));
      return new Response(JSON.stringify(body), { status });
    };
  };
  try {
    answer(200, { mode: 'direct', url: 'wss://ai.example.test/v1/voice/live?character=vera&brain=relay', protocols: ['worldlines.voice.v1', 'ticket.abc'] });
    assert.deepEqual(await requestCallTicket('vera', SAVE_A), { mode: 'direct', url: 'wss://ai.example.test/v1/voice/live?character=vera&brain=relay', protocols: ['worldlines.voice.v1', 'ticket.abc'] });
    assert.deepEqual(requests.at(-1), { characterId: 'vera', savePath: SAVE_A });
    answer(200, { mode: 'proxy' });
    assert.deepEqual(await requestCallTicket('vera', SAVE_A), { mode: 'proxy' });
    answer(404, { error: 'not found' });
    assert.deepEqual(await requestCallTicket('vera', SAVE_A), { mode: 'proxy' });
    answer(402, { mode: 'error', code: 'insufficient_credits' });
    assert.deepEqual(await requestCallTicket('vera', SAVE_A), { mode: 'error', code: 'insufficient_credits', status: 402 });
    answer(429, { mode: 'error', code: 'quota_exceeded', billingUrl: 'https://worldlines.gg/billing', resetsAt: '2026-11-01T00:00:00.000Z' });
    assert.deepEqual(await requestCallTicket('vera', SAVE_A), {
      mode: 'error', code: 'quota_exceeded', status: 429, billingUrl: 'https://worldlines.gg/billing', resetsAt: '2026-11-01T00:00:00.000Z',
    });
    globalThis.fetch = async () => { throw new TypeError('offline'); };
    assert.deepEqual(await requestCallTicket('vera', SAVE_A), { mode: 'error', code: 'ticket_unreachable' });
    assert.match(voiceLiveUrl({ protocol: 'https:', host: 'app.test' }, 'vera', SAVE_A), /savePath=%2Fsaves%2Fa/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

// the design notes: hanging up ENDS the chat (the writer's
// summary) without stopping the agent the page still uses.
test('hanging up after talking sends character_talk_end (via voice), never character_stop', () => {
  const bridge = fakeBridge();
  const relay = createBrainRelay('vera', SAVE_A, () => {}, bridge);
  relay.take(brain({ type: 'character_start', characterId: 'vera' }));
  relay.take(brain({ type: 'character_prompt', characterId: 'vera', message: 'hi' }));
  relay.close();
  relay.close();
  assert.deepEqual(bridge.sent.at(-1), { type: 'character_talk_end', characterId: 'vera', via: 'voice', savePath: SAVE_A });
  assert.equal(bridge.sent.filter((f) => f.type === 'character_talk_end').length, 1, 'once');
  assert.ok(!bridge.sent.some((f) => f.type === 'character_stop'));
});

test('a call that never spoke to her ends nothing', () => {
  const bridge = fakeBridge();
  createBrainRelay('vera', SAVE_A, () => {}, bridge).close();
  assert.deepEqual(bridge.sent, []);
});

test('while the forced tutorial runs, chat-end frames ask for no writer beat', async () => {
  const chatEnd = await jiti.import('../src/lib/chat-end.ts');
  assert.deepEqual(chatEnd.characterStopFrame('vera'), { type: 'character_stop', characterId: 'vera' });
  chatEnd.holdChatBeats(true);
  try {
    assert.deepEqual(chatEnd.characterStopFrame('vera'), { type: 'character_stop', characterId: 'vera', beat: false });
    assert.deepEqual(chatEnd.chatEndFrame('vera', 'voice'), { type: 'character_talk_end', characterId: 'vera', via: 'voice', beat: false });
  } finally {
    chatEnd.holdChatBeats(false);
  }
});
