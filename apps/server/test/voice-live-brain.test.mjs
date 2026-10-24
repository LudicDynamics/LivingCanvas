// The character brain of a voice-live call answered by this server
// (voice-live-brain.ts): voice-live sends `brain` frames down the call, we play
// them into our own character engine over a loopback socket and wrap its
// answers back up. Fake sockets only — no engine, no voice-live.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { createBrainRelay } = await jiti.import('../src/engine/voice-live-brain.ts');
const { handleVoiceLiveStream } = await jiti.import('../src/engine/voice-live-proxy.ts');
const { voiceLiveSocketUrl, voiceLiveUpstreamHeaders, voiceLiveRelaysBrain } = await jiti.import('../src/engine/voice-provider.ts');
const { voiceLiveSessionUrl } = await jiti.import('../src/engine/voice-live-cast.ts');

class FakeSocket {
  static OPEN = 1;
  constructor(url, options) {
    this.url = url;
    this.options = options;
    this.readyState = 0;
    this.sent = [];
    this.closed = false;
    this.handlers = new Map();
  }
  on(event, handler) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
    return this;
  }
  emit(event, ...args) {
    for (const handler of this.handlers.get(event) ?? []) handler(...args);
  }
  send(data, options) {
    this.sent.push({ data, binary: options?.binary === true });
  }
  close() {
    this.closed = true;
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.emit('open');
  }
  get json() {
    return this.sent.filter((f) => !f.binary).map((f) => JSON.parse(String(f.data)));
  }
}

function factory() {
  const created = [];
  class Socket extends FakeSocket {
    constructor(url, options) {
      super(url, options);
      created.push(this);
    }
  }
  return { Socket, created };
}

const SAVE_A = '/saves/a';
const SAVE_B = '/saves/b';
const brainFrame = (frame) => Buffer.from(`{"type": "brain", "frame": ${JSON.stringify(frame)}}`);
const engineFrame = (frame) => Buffer.from(JSON.stringify(frame));

function relay(characterId = 'vera', isCurrent = () => true) {
  const up = [];
  const { Socket, created } = factory();
  const tap = createBrainRelay(characterId, SAVE_A, 'ws://127.0.0.1:3001/ws?v=1', (text) => up.push(JSON.parse(text)), Socket, isCurrent);
  return { tap, up, created };
}

test('voice-live’s brain frames reach our engine verbatim, once it is open, in order', () => {
  const { tap, created } = relay();
  assert.equal(tap.take(brainFrame({ type: 'character_start', characterId: 'vera', savePath: SAVE_A, recentContext: '' })), true);
  assert.equal(tap.take(brainFrame({ type: 'character_prompt', characterId: 'vera', savePath: SAVE_A, message: 'hello' })), true);
  assert.equal(created.length, 1, 'one loopback per call');
  assert.equal(created[0].url, 'ws://127.0.0.1:3001/ws?v=1');
  assert.equal(created[0].sent.length, 0, 'queued until the loopback opens');
  created[0].open();
  assert.deepEqual(created[0].json.map((f) => f.type), ['character_start', 'character_prompt']);
  assert.equal(created[0].json[1].via, 'voice', 'a line said over the call is answered with thinking off');
  assert.equal(created[0].json[0].via, undefined);
});

test('only the call’s own character, only character frames: the call cannot drive anything else', () => {
  const { tap, created } = relay();
  assert.equal(tap.take(brainFrame({ type: 'writer_prompt', savePath: SAVE_A, message: 'rewrite the world' })), true, 'consumed, not shown');
  assert.equal(tap.take(brainFrame({ type: 'character_prompt', characterId: 'old-mo', savePath: SAVE_A, message: 'hi' })), true);
  assert.equal(created.length, 0, 'nothing reached the engine');
});

test('the engine’s answers for this character go back up wrapped; the rest of the fan-out does not', () => {
  const { tap, up, created } = relay();
  tap.take(brainFrame({ type: 'character_start', characterId: 'vera', savePath: SAVE_A, recentContext: '' }));
  created[0].open();
  const engine = created[0];
  engine.emit('message', engineFrame({ type: 'connected', timestamp: 'now' }), false);
  engine.emit('message', engineFrame({ type: 'character_delta', characterId: 'old-mo', savePath: SAVE_A, delta: 'not her' }), false);
  engine.emit('message', engineFrame({ type: 'writer_delta', delta: 'narration' }), false);
  engine.emit('message', engineFrame({ type: 'character_delta', characterId: 'vera', savePath: SAVE_A, delta: 'Evening.' }), false);
  engine.emit('message', engineFrame({ type: 'character_idle', characterId: 'vera', savePath: SAVE_A }), false);
  assert.deepEqual(up, [
    { type: 'brain', frame: { type: 'character_delta', characterId: 'vera', savePath: SAVE_A, delta: 'Evening.' } },
    { type: 'brain', frame: { type: 'character_idle', characterId: 'vera', savePath: SAVE_A } },
  ]);
});

test('hang-up stops her turn and closes the loopback; a lost engine is an error up, not a silent wait', () => {
  const a = relay();
  a.tap.take(brainFrame({ type: 'character_start', characterId: 'vera', savePath: SAVE_A, recentContext: '' }));
  a.created[0].open();
  a.tap.close();
  assert.deepEqual(a.created[0].json.at(-1), { type: 'character_stop', characterId: 'vera', savePath: SAVE_A, via: 'voice' });
  assert.equal(a.created[0].closed, true);

  const b = relay();
  b.tap.take(brainFrame({ type: 'character_start', characterId: 'vera', savePath: SAVE_A, recentContext: '' }));
  b.created[0].open();
  b.created[0].emit('close');
  assert.equal(b.up.at(-1).frame.type, 'error');
  assert.equal(b.up.at(-1).frame.characterId, 'vera');
  assert.equal(b.up.at(-1).frame.savePath, SAVE_A);
});

test('call frames are not brain frames: the tap leaves them to the browser', () => {
  const { tap } = relay();
  assert.equal(tap.take(engineFrame({ type: 'segment', id: 1 })), false);
  assert.equal(tap.take(engineFrame({ type: 'thought', text: 'about "type": "brain"' })), false);
});

test('a relay captured in save A neither starts nor forwards frames after save B is selected', () => {
  let selectedSave = SAVE_A;
  const stale = relay('vera', () => selectedSave === SAVE_A);
  stale.tap.take(brainFrame({ type: 'character_start', characterId: 'vera', savePath: SAVE_A, recentContext: '' }));
  stale.created[0].open();
  selectedSave = SAVE_B;
  stale.created[0].emit('message', engineFrame({ type: 'character_delta', characterId: 'vera', savePath: SAVE_A, delta: 'late A' }), false);
  assert.deepEqual(stale.up, []);

  const notStarted = relay('vera', () => selectedSave === SAVE_A);
  notStarted.tap.take(brainFrame({ type: 'character_prompt', characterId: 'vera', savePath: SAVE_A, message: 'late A' }));
  assert.equal(notStarted.created.length, 0);
});

test('through the proxy: brain frames stay save-scoped and other data reaches the browser', () => {
  const client = new FakeSocket();
  client.readyState = 1;
  const upstreams = factory();
  const engines = factory();
  const isCurrent = () => true;
  handleVoiceLiveStream(client, {
    WebSocketImpl: upstreams.Socket,
    upstreamUrl: 'wss://gateway/v1/voice/live?character=vera&brain=relay',
    headers: { authorization: 'Bearer wl_pat_x' },
    isCurrent,
    brain: (send) => createBrainRelay(
      'vera',
      SAVE_A,
      'ws://127.0.0.1:3001/ws?v=1',
      send,
      engines.Socket,
      isCurrent,
    ),
  });
  const upstream = upstreams.created[0];
  assert.deepEqual(upstream.options, { headers: { authorization: 'Bearer wl_pat_x' } });
  upstream.open();
  upstream.emit('message', brainFrame({ type: 'character_start', characterId: 'vera', savePath: SAVE_A, recentContext: '' }), false);
  upstream.emit('message', engineFrame({ type: 'hello', session: 's1' }), false);
  upstream.emit('message', Buffer.from([1, 0, 1, 0]), true);
  assert.deepEqual(client.json, [{ type: 'hello', session: 's1' }], 'the browser never sees a brain frame');
  assert.equal(client.sent.filter((f) => f.binary).length, 1);
  engines.created[0].open();
  engines.created[0].emit('message', engineFrame({ type: 'character_delta', characterId: 'vera', savePath: SAVE_A, delta: 'Hi' }), false);
  assert.deepEqual(upstream.json.at(-1), { type: 'brain', frame: { type: 'character_delta', characterId: 'vera', savePath: SAVE_A, delta: 'Hi' } });
  client.emit('close');
  assert.deepEqual(engines.created[0].json.at(-1), { type: 'character_stop', characterId: 'vera', savePath: SAVE_A, via: 'voice' }, 'hang-up stops her in the captured save');
});

test('a gateway URL keeps its path; a bare host still gets /ws', () => {
  assert.equal(voiceLiveSocketUrl('http://127.0.0.1:8777'), 'ws://127.0.0.1:8777/ws');
  assert.equal(voiceLiveSocketUrl('https://studio.example.ts.net/'), 'wss://studio.example.ts.net/ws');
  assert.equal(voiceLiveSocketUrl('https://ai.worldlines.gg/v1/voice/live'), 'wss://ai.worldlines.gg/v1/voice/live');
  assert.equal(
    voiceLiveSessionUrl('wss://ai.worldlines.gg/v1/voice/live', { character: 'vera', voice: 'Ethan' }, { relayBrain: true }),
    'wss://ai.worldlines.gg/v1/voice/live?character=vera&brain=relay&voice=Ethan',
  );
  assert.equal(voiceLiveSessionUrl('ws://h/ws', {}, { relayBrain: true }), 'ws://h/ws', 'no character, nothing to relay');
});

test('the gateway credential is sent only when configured; relay is on unless turned off', () => {
  assert.equal(voiceLiveUpstreamHeaders({}), undefined);
  assert.deepEqual(voiceLiveUpstreamHeaders({ VOICE_LIVE_TOKEN: ' wl_pat_abc ' }), {
    authorization: 'Bearer wl_pat_abc',
    'x-worldlines-product': 'livingcanvas',
  });
  assert.equal(voiceLiveUpstreamHeaders({ VOICE_LIVE_TOKEN: 'svc', VOICE_LIVE_ACTING_USER: 'u-1' })['x-worldlines-user'], 'u-1');
  assert.deepEqual(voiceLiveUpstreamHeaders({ VOICE_LIVE_ACCESS_TOKEN: 'shared' }), { 'x-voice-live-token': 'shared' }, 'direct to voice-live: only its shared key');
  assert.equal(voiceLiveRelaysBrain({}), true);
  assert.equal(voiceLiveRelaysBrain({ VOICE_LIVE_BRAIN_RELAY: '0' }), false);
});
