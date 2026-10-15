// Live voice input — /ws/stt relay.
// Runs against built dist: `pnpm build` first.
// OpenAI Realtime is REPLACED by a local WebSocket stub; readSttConfig() reads
// env per connection, so OPENAI_BASE_URL can point at it after import.
import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import { WebSocketServer, WebSocket } from 'ws';
import { handleSttStream, realtimeTranscriptionUrl } from '../dist/engine/stt-stream.js';

const listen = (server) => new Promise((r) => server.listen(0, '127.0.0.1', r));
const until = async (check, ms = 2000) => {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > ms) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 10));
  }
};

/** Stub OpenAI Realtime: records the handshake and every event it receives. */
async function upstreamStub({ refuse = false } = {}) {
  const server = http.createServer();
  const received = [];
  const handshake = {};
  let socket = null;
  if (refuse) {
    server.on('upgrade', (_req, raw) => { raw.end('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n'); });
  } else {
    const wss = new WebSocketServer({ server });
    wss.on('connection', (ws, req) => {
      socket = ws;
      handshake.url = req.url;
      handshake.auth = req.headers.authorization;
      ws.on('message', (m) => received.push(JSON.parse(m.toString())));
    });
  }
  await listen(server);
  return {
    base: `http://127.0.0.1:${server.address().port}/v1`,
    received,
    handshake,
    emit: (event) => socket.send(JSON.stringify(event)),
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }),
  };
}

/** Our relay under test, with env swapped for the duration. */
async function relay(env) {
  const saved = { ...process.env };
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_BASE_URL;
  delete process.env.AIRP_STT_MODEL;
  Object.assign(process.env, env);
  const server = http.createServer();
  new WebSocketServer({ server }).on('connection', (ws) => handleSttStream(ws));
  await listen(server);
  return {
    url: `ws://127.0.0.1:${server.address().port}/ws/stt`,
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => { process.env = saved; r(); }); }),
  };
}

async function connect(url) {
  const ws = new WebSocket(url);
  const messages = [];
  let closed = false;
  ws.on('message', (m) => messages.push(JSON.parse(m.toString())));
  ws.on('close', () => { closed = true; });
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j); });
  return { ws, messages, isClosed: () => closed };
}

test('configures a transcription session, relays audio, deltas, completion and stop', async () => {
  const upstream = await upstreamStub();
  const server = await relay({ OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: upstream.base });
  const { ws, messages } = await connect(server.url);
  try {
    await until(() => messages.some((m) => m.type === 'ready'));
    assert.equal(upstream.handshake.url, '/v1/realtime?intent=transcription');
    assert.equal(upstream.handshake.auth, 'Bearer sk-test');
    const [config] = upstream.received;
    assert.equal(config.type, 'session.update');
    assert.equal(config.session.type, 'transcription');
    assert.deepEqual(config.session.audio.input.format, { type: 'audio/pcm', rate: 24000 });
    assert.equal(config.session.audio.input.transcription.model, 'gpt-4o-transcribe');
    assert.equal(config.session.audio.input.transcription.language, undefined);

    ws.send(Buffer.from([1, 2, 3, 4]));
    await until(() => upstream.received.some((e) => e.type === 'input_audio_buffer.append'));
    assert.equal(upstream.received.find((e) => e.type === 'input_audio_buffer.append').audio, 'AQIDBA==');

    upstream.emit({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'i1', delta: 'こん' });
    upstream.emit({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'i1', transcript: 'こんにちは' });
    await until(() => messages.some((m) => m.type === 'completed'));
    assert.deepEqual(messages.filter((m) => m.type !== 'ready'), [
      { type: 'delta', itemId: 'i1', delta: 'こん' },
      { type: 'completed', itemId: 'i1', transcript: 'こんにちは' },
    ]);

    ws.send(JSON.stringify({ type: 'stop' }));
    await until(() => upstream.received.some((e) => e.type === 'input_audio_buffer.commit'));

    // An empty final commit (VAD already committed) is not surfaced as an error.
    upstream.emit({ type: 'error', error: { code: 'input_audio_buffer_commit_empty' } });
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(messages.some((m) => m.type === 'error'), false);
  } finally {
    ws.close();
    await server.close();
    await upstream.close();
  }
});

test('no key answers stt_unavailable and closes without dialing upstream', async () => {
  const upstream = await upstreamStub();
  const server = await relay({ OPENAI_BASE_URL: upstream.base });
  const { messages, isClosed } = await connect(server.url);
  try {
    await until(() => isClosed());
    assert.deepEqual(messages, [{ type: 'error', code: 'stt_unavailable' }]);
    assert.equal(upstream.handshake.url, undefined);
  } finally {
    await server.close();
    await upstream.close();
  }
});

test('an upstream refusal answers stt_failed without leaking the key', async () => {
  const upstream = await upstreamStub({ refuse: true });
  const server = await relay({ OPENAI_API_KEY: 'sk-secret', OPENAI_BASE_URL: upstream.base });
  const { messages, isClosed } = await connect(server.url);
  try {
    await until(() => isClosed());
    assert.deepEqual(messages, [{ type: 'error', code: 'stt_failed' }]);
    assert.doesNotMatch(JSON.stringify(messages), /sk-secret/);
  } finally {
    await server.close();
    await upstream.close();
  }
});

test('the realtime URL follows the configured base', () => {
  assert.equal(realtimeTranscriptionUrl('https://api.openai.com/v1'), 'wss://api.openai.com/v1/realtime?intent=transcription');
  assert.equal(realtimeTranscriptionUrl('http://127.0.0.1:9/v1'), 'ws://127.0.0.1:9/v1/realtime?intent=transcription');
});
