// The voice-live reverse proxy: a byte pipe between the
// browser and voice-live, so the browser only ever talks to our origin.
//
// Everything here runs on two fake sockets. No voice-live, no microphone, no
// network — which is the point: the ordering and passthrough rules are exactly
// what a live smoke test is worst at catching.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const proxy = await jiti.import('../src/engine/voice-live-proxy.ts');
const { handleVoiceLiveStream, VOICE_LIVE_STREAM_PATH } = proxy;

/** A socket that records what it was sent and lets a test drive its events. */
class FakeSocket {
  static OPEN = 1;
  constructor() {
    this.readyState = 1; // OPEN — the browser socket is already up when we are called
    this.sent = [];
    this.closed = false;
    this.handlers = new Map();
  }
  on(event, handler) {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
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
  /** Text frames only, parsed — the shape most assertions want. */
  get json() {
    return this.sent
      .filter((frame) => !frame.binary)
      .map((frame) => JSON.parse(String(frame.data)));
  }
}

/** Stand in for the upstream `ws` client; construction records the URL. */
function fakeUpstream() {
  const created = [];
  class Upstream extends FakeSocket {
    constructor(url) {
      super();
      this.url = url;
      this.readyState = 0; // CONNECTING
      created.push(this);
    }
    open() {
      this.readyState = 1;
      this.emit('open');
    }
  }
  Upstream.OPEN = 1;
  return { Upstream, created };
}

function pipe() {
  const client = new FakeSocket();
  const { Upstream, created } = fakeUpstream();
  handleVoiceLiveStream(client, { WebSocketImpl: Upstream, upstreamUrl: 'ws://fake/ws' });
  return { client, upstream: created[0] };
}

const pcm = (byte) => Buffer.from([byte, 0, byte, 0]);

test('the path is ours, under our own origin', () => {
  assert.equal(VOICE_LIVE_STREAM_PATH, '/ws/voice-live');
  // Not 8765 and not a bare host:port — the browser addresses the canvas.
  assert.ok(VOICE_LIVE_STREAM_PATH.startsWith('/ws/'));
});

test('upstream → browser passes every frame through untouched and in order', () => {
  const { client, upstream } = pipe();
  upstream.open();
  // The exact sequence integration.md §3.3 describes: a JSON header, then the
  // PCM chunks that belong to it, then the end marker.
  upstream.emit('message', Buffer.from(JSON.stringify({ type: 'segment', id: 7, chunks: true })), false);
  upstream.emit('message', pcm(1), true);
  upstream.emit('message', pcm(2), true);
  upstream.emit('message', Buffer.from(JSON.stringify({ type: 'segment_end', id: 7, ms: 900 })), false);

  assert.equal(client.sent.length, 4);
  assert.deepEqual(client.sent.map((f) => f.binary), [false, true, true, false]);
  // Bytes identical, not re-encoded or merged.
  assert.deepEqual(client.sent[1].data, pcm(1));
  assert.deepEqual(client.sent[2].data, pcm(2));
  assert.deepEqual(JSON.parse(String(client.sent[0].data)), { type: 'segment', id: 7, chunks: true });
  assert.deepEqual(JSON.parse(String(client.sent[3].data)), { type: 'segment_end', id: 7, ms: 900 });
});

test('two audio frames are never merged into one', () => {
  const { client, upstream } = pipe();
  upstream.open();
  upstream.emit('message', pcm(1), true);
  upstream.emit('message', pcm(2), true);
  // A "helpful" concatenation would produce one 8-byte frame and break the
  // client's per-chunk scheduling.
  assert.equal(client.sent.length, 2);
  assert.equal(client.sent[0].data.length, 4);
  assert.equal(client.sent[1].data.length, 4);
});

test('browser → upstream keeps text and binary interleaved in the order sent', () => {
  const { client, upstream } = pipe();
  upstream.open();
  client.emit('message', pcm(1), true);
  client.emit('message', Buffer.from(JSON.stringify({ type: 'played', seg: 3 })), false);
  client.emit('message', pcm(2), true);

  assert.deepEqual(upstream.sent.map((f) => f.binary), [true, false, true]);
  assert.deepEqual(upstream.sent[0].data, pcm(1));
  assert.deepEqual(JSON.parse(String(upstream.sent[1].data)), { type: 'played', seg: 3 });
});

test('frames sent before the upstream opens are queued, not dropped or reordered', () => {
  const { client, upstream } = pipe();
  // The mic starts before the socket finishes connecting — the common case.
  client.emit('message', pcm(1), true);
  client.emit('message', Buffer.from(JSON.stringify({ type: 'played', seg: 1 })), false);
  client.emit('message', pcm(2), true);
  assert.equal(upstream.sent.length, 0, 'nothing may be written before open');

  upstream.open();
  assert.deepEqual(upstream.sent.map((f) => f.binary), [true, false, true]);
  assert.deepEqual(upstream.sent[0].data, pcm(1));
  assert.deepEqual(upstream.sent[2].data, pcm(2));
});

test('a never-opening upstream cannot grow the heap without bound', () => {
  const { client, upstream } = pipe();
  for (let i = 0; i < 200; i += 1) client.emit('message', pcm(i % 251), true);
  upstream.open();
  // Bounded, and the frames kept are the NEWEST — the part she can still answer.
  assert.ok(upstream.sent.length <= 64, `queue grew to ${upstream.sent.length}`);
  assert.ok(upstream.sent.length > 0);
  assert.deepEqual(upstream.sent[upstream.sent.length - 1].data, pcm(199 % 251));
});

test('no upstream is a visible failure in voice-live’s own error shape', () => {
  const { client, upstream } = pipe();
  upstream.emit('error', new Error('ECONNREFUSED'));
  // Borrowing `error{where,message}` (integration.md §3.3) means the browser has
  // ONE error path whether the failure was here or upstream.
  assert.deepEqual(client.json, [{ type: 'error', where: 'proxy', message: 'voice backend unavailable' }]);
  assert.equal(client.closed, true);
  // And the address never appears in what the browser is told.
  assert.doesNotMatch(JSON.stringify(client.json), /8777|127\.0\.0\.1|fake/);
});

test('an upstream that refuses the upgrade fails the same visible way', () => {
  const { client } = (() => {
    const c = new FakeSocket();
    const { Upstream, created } = fakeUpstream();
    handleVoiceLiveStream(c, { WebSocketImpl: Upstream, upstreamUrl: 'ws://fake/ws' });
    created[0].emit('unexpected-response', {}, { statusCode: 503 });
    return { client: c };
  })();
  assert.deepEqual(client.json, [{ type: 'error', where: 'proxy', message: 'voice backend unavailable' }]);
  assert.equal(client.closed, true);
});

test('a pending upstream URL (the voice cast) queues browser frames until it opens', async () => {
  const client = new FakeSocket();
  const { Upstream, created } = fakeUpstream();
  let resolveUrl;
  handleVoiceLiveStream(client, {
    WebSocketImpl: Upstream,
    upstreamUrl: new Promise((resolve) => { resolveUrl = resolve; }),
  });
  client.emit('message', Buffer.from([1, 2]), true);
  assert.equal(created.length, 0, 'no upstream before the cast resolves');
  resolveUrl('ws://fake/ws?character=watson&voice=Elias');
  await new Promise((r) => setImmediate(r));
  assert.equal(created.length, 1);
  assert.equal(created[0].url, 'ws://fake/ws?character=watson&voice=Elias');
  created[0].open();
  assert.deepEqual(created[0].sent.map((f) => [...f.data]), [[1, 2]]);
  client.emit('close');
});

test('either side closing tears down the other', () => {
  const a = pipe();
  a.upstream.open();
  a.client.emit('close');
  assert.equal(a.upstream.closed, true);

  const b = pipe();
  b.upstream.open();
  b.upstream.emit('close');
  assert.equal(b.client.closed, true);
});

test('a save-A proxy drops queued microphone audio before it can be forwarded into save B', () => {
  let isCurrent = true;
  const client = new FakeSocket();
  const { Upstream, created } = fakeUpstream();
  handleVoiceLiveStream(client, {
    WebSocketImpl: Upstream,
    upstreamUrl: 'ws://fake/ws',
    isCurrent: () => isCurrent,
  });
  const upstream = created[0];
  client.emit('message', pcm(1), true);
  isCurrent = false;
  upstream.open();

  assert.deepEqual(upstream.sent, []);
  assert.equal(upstream.closed, true);
  assert.equal(client.closed, true);
});

test('a save-A proxy drops late voice output before it reaches a client now viewing save B', () => {
  let isCurrent = true;
  const client = new FakeSocket();
  const { Upstream, created } = fakeUpstream();
  handleVoiceLiveStream(client, {
    WebSocketImpl: Upstream,
    upstreamUrl: 'ws://fake/ws',
    isCurrent: () => isCurrent,
  });
  const upstream = created[0];
  upstream.open();
  isCurrent = false;
  upstream.emit('message', Buffer.from(JSON.stringify({ type: 'segment', text: 'late A' })), false);

  assert.deepEqual(client.sent, []);
  assert.equal(upstream.closed, true);
  assert.equal(client.closed, true);
});
