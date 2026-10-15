// The voice-live transport's verdicts (voice-live-call.ts), with a fake socket,
// a fake microphone and no audio output: which events hang the call up, which
// only show a notice, and which close codes / ticket refusals become which
// failure. No voice-live, no ai.worldlines.gg, no browser.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

globalThis.WebSocket ??= { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 };
globalThis.AudioWorkletNode ??= class {
  constructor() { this.port = { onmessage: null, close() {} }; }
  connect(next) { return next; }
  disconnect() {}
};
const jiti = createJiti(import.meta.url, { moduleCache: false });
const { startVoiceLiveCall, ticketFailure, closeFailure } = await jiti.import('../src/lib/voice-live-call.ts');

function fakeSocket() {
  return {
    readyState: 0,
    sent: [],
    closed: 0,
    send(data) { this.sent.push(data); },
    close() { this.closed += 1; this.readyState = 3; },
    open() { this.readyState = 1; this.onopen?.(); },
    json(message) { this.onmessage?.({ data: JSON.stringify(message) }); },
    shut(code, reason = '') { this.readyState = 3; this.onclose?.({ code, reason }); },
  };
}

const fakeContext = () => ({
  sampleRate: 48_000,
  state: 'running',
  destination: {},
  audioWorklet: { addModule: async () => {} },
  createMediaStreamSource: () => ({ connect: (next) => next }),
  createGain: () => ({ gain: { value: 1 }, connect: (next) => next }),
  close: async () => {},
});

async function call(ticket = { mode: 'direct', url: 'wss://ai.example.test/v1/voice/live', protocols: ['p'] }) {
  const seen = { errors: [], notices: [], closed: 0, ready: 0, states: [], allowance: [] };
  const socket = fakeSocket();
  const transport = await startVoiceLiveCall({
    characterId: 'nanami',
    savePath: '/saves/a',
    signal: new AbortController().signal,
    isCurrent: () => true,
    onReady: () => { seen.ready += 1; },
    onInputText: () => {},
    onLine: () => {},
    onBotState: (s) => seen.states.push(s),
    onThought: () => {},
    onError: (reason, detail) => seen.errors.push(detail ? [reason, detail] : [reason]),
    onNotice: (kind) => seen.notices.push(kind),
    onAllowance: (s) => seen.allowance.push(s),
    onClosed: () => { seen.closed += 1; },
  }, {
    requestTicket: async () => ticket,
    getUserMedia: async () => ({ getTracks: () => [] }),
    createAudioContext: fakeContext,
    openOutput: () => null,
    createSocket: () => socket,
  }).catch((error) => ({ error }));
  return { seen, socket, transport };
}

test('one failed turn (error{fatal:false}) is a notice, never a hangup', async () => {
  const { seen, socket } = await call();
  socket.open();
  socket.json({ type: 'hello', session: 's', sample_rate: 16000, tts: 'qwen', brain: 'relay' });
  socket.json({ type: 'error', where: 'reply', fatal: false, message: 'agent timed out' });
  // An older voice-live sends no `fatal`; its reply errors were never fatal either.
  socket.json({ type: 'error', where: 'reply', message: '429' });
  assert.deepEqual(seen.notices, ['turn_failed', 'turn_failed']);
  assert.deepEqual(seen.errors, []);
  assert.equal(socket.closed, 0, 'the call stays up');
  socket.json({ type: 'state', bot: 'thinking' });
  assert.deepEqual(seen.states, ['thinking'], 'and keeps working afterwards');
});

test('a fatal error still hangs up', async () => {
  const { seen, socket } = await call();
  socket.open();
  socket.json({ type: 'error', where: 'upstream', message: 'gone' });
  assert.deepEqual(seen.errors, [['connection']]);
  assert.equal(socket.closed, 1);
});

test('the ticket refusal is named, with its billing link and reset date kept', async () => {
  const { seen, transport } = await call({
    mode: 'error', code: 'quota_exceeded', status: 429,
    billingUrl: 'https://worldlines.gg/billing', resetsAt: '2026-11-01T00:00:00.000Z',
  });
  assert.ok(transport.error);
  assert.deepEqual(seen.errors, [['minutes_exhausted', { billingUrl: 'https://worldlines.gg/billing', resetsAt: '2026-11-01T00:00:00.000Z' }]]);
});

test('the ticket’s allowance reaches the store', async () => {
  const { seen } = await call({ mode: 'direct', url: 'wss://x/v', protocols: ['p'], remainingSeconds: 600 });
  assert.deepEqual(seen.allowance, [600]);
});

test('close codes become reasons; an ordinary close is just a closed call', async () => {
  for (const [code, reason, expected] of [
    [4002, 'voice_minutes_exhausted', 'minutes_exhausted'],
    [4001, 'voice_call_time_limit', 'time_limit'],
    [4429, 'concurrency_limit', 'call_in_progress'],
    [4429, 'quota_exceeded', 'minutes_exhausted'],
    [4403, 'plan_required', 'plan_required'],
    [4503, 'voice_busy', 'line_busy'],
    [1006, '', 'network'],
  ]) {
    const { seen, socket } = await call();
    socket.open();
    socket.shut(code, reason);
    assert.deepEqual(seen.errors, [[expected]], `${code} ${reason}`);
  }
  const { seen, socket } = await call();
  socket.open();
  socket.shut(1000);
  assert.deepEqual(seen.errors, []);
  assert.equal(seen.closed, 1);
});

test('a socket that never opened is a connection failure, not a closed call', async () => {
  const { seen, socket } = await call();
  socket.onerror?.();
  socket.shut(1006);
  assert.deepEqual(seen.errors, [['connection']]);
  assert.equal(seen.closed, 0);
});

test('ticket codes map one to one; unknown ones stay generic', () => {
  assert.equal(ticketFailure('quota_exceeded'), 'minutes_exhausted');
  assert.equal(ticketFailure('plan_required'), 'plan_required');
  assert.equal(ticketFailure('wallet_not_supported'), 'plan_required');
  assert.equal(ticketFailure('concurrency_limit'), 'call_in_progress');
  assert.equal(ticketFailure('voice_busy'), 'line_busy');
  assert.equal(ticketFailure('signed_out'), 'signed_out');
  assert.equal(ticketFailure('whatever', 401), 'signed_out');
  assert.equal(ticketFailure('ticket_unreachable'), 'network');
  assert.equal(ticketFailure('provider_unconfigured'), 'unavailable');
  assert.equal(ticketFailure('ticket_malformed', 502), 'connection');
  assert.equal(closeFailure(4401, 'invalid_ticket', false), 'connection', 'an expired ticket is a retry, not a sign-out');
  assert.equal(closeFailure(1000, '', true), null);
});
