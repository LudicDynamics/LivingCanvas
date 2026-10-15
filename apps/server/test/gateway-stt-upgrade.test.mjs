/**
 * the design notes/§10 — the REAL acceptance for the `noServer` upgrade gate
 * and the connection-scoped liveness wiring (`node --test`).
 *
 * Runs against the built `apps/server/dist`. Two things here
 * are shell-level and invisible to every other test in the repo:
 *
 *   1. `/ws/stt` MUST be upgraded by our own `server.on('upgrade')` hook
 *      (§2.2). Under `noServer` the implicit handler is gone, so a branch that
 *      `return`s without `handleUpgrade` leaves the socket unopened and voice
 *      input dies. `apps/server/test/stt-stream.test.mjs` CANNOT catch that — it
 *      builds its own `{ server }` wss and calls `handleSttStream` directly, so
 *      it is green either way (REVIEW M6). So this file transcribes the hook
 *      from §2.2 and asserts the client actually lands.
 *      Reverse experiment: change the `/ws/stt` branch to `if (…stt…) return;`
 *      → the socket never opens, no frame arrives, the case goes red.
 *      There is no STT key in this environment, so `handleSttStream`
 *      (stt-stream.ts:37-42) answers `{type:'error',code:'stt_unavailable'}`
 *      deterministically — no upstream, no flake.
 *
 *   2. The `isAlive = true` + `on('pong')` wiring lives in `wss.on('connection')`
 *      (§3.2 step 7 / REVIEW M2), NOT in `startHeartbeat`. A live socket must
 *      survive repeated sweeps. Reverse experiment (a live case below): drop the
 *      `on('pong')` reset → the second sweep terminates it → red.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { test, mock } from 'node:test';
import { WebSocketServer, WebSocket } from 'ws';
import { PROTOCOL_VERSION, WS_CLOSE } from '@airp/shared';
import { shouldTerminate, startHeartbeat } from '../dist/gateway/heartbeat.js';
import { handleSttStream, STT_STREAM_PATH } from '../dist/engine/stt-stream.js';

const listen = (server) => new Promise((r) => server.listen(0, '127.0.0.1', r));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Everything a sweep touches, recorded instead of executed. */
class FakeClient {
  constructor({ failPing = false, failTerminate = false } = {}) {
    this.isAlive = true;
    this.pings = 0;
    this.terminations = 0;
    this.pongHandlers = [];
    this.failPing = failPing;
    this.failTerminate = failTerminate;
  }
  ping() {
    if (this.failPing) throw new Error('ping failed');
    this.pings++;
  }
  terminate() {
    if (this.failTerminate) throw new Error('terminate failed');
    this.terminations++;
  }
  on(event, handler) {
    if (event === 'pong') this.pongHandlers.push(handler);
  }
  /** Simulate the RFC 6455 pong reply, which the connection handler writes back. */
  pong() {
    this.isAlive = true;
    for (const handler of this.pongHandlers) handler();
  }
}

test('shouldTerminate: only an explicit false is dead', () => {
  assert.equal(shouldTerminate({ isAlive: true }), false);
  assert.equal(shouldTerminate({ isAlive: false }), true);
  // A connection created after the last sweep has no flag yet. Reading it as
  // dead would kill every new client on the next sweep (03 §3.2 step 7).
  assert.equal(shouldTerminate({ isAlive: undefined }), false);
});

test('one sweep pings live clients; the next terminates the ones that never ponged', () => {
  const answered = new FakeClient();
  const silent = new FakeClient();
  const heartbeat = startHeartbeat({ clients: new Set([answered, silent]) }, { intervalMs: 0 });

  heartbeat.tick();
  assert.equal(answered.pings, 1, 'a live client is pinged');
  assert.equal(answered.isAlive, false, 'and is marked not-alive for the next round');
  assert.equal(silent.pings, 1);
  assert.equal(silent.terminations, 0, 'the first sweep never terminates a fresh client');

  answered.pong();
  heartbeat.tick();
  assert.equal(answered.terminations, 0, 'a client that ponged survives');
  assert.equal(answered.pings, 2);
  assert.equal(silent.terminations, 1, 'one missed pong = terminated');
});

test('a client with no liveness flag yet survives its first sweep only', () => {
  const late = new FakeClient();
  late.isAlive = undefined;
  const heartbeat = startHeartbeat({ clients: [late] }, { intervalMs: 0 });

  heartbeat.tick();
  assert.equal(late.terminations, 0, 'undefined is unknown, not dead');
  heartbeat.tick();
  assert.equal(late.terminations, 1, 'it was marked false and never answered');
});

test('a throwing client does not abort the sweep', () => {
  const brokenPing = new FakeClient({ failPing: true });
  const brokenTerminate = new FakeClient({ failTerminate: true });
  brokenTerminate.isAlive = false;
  const healthy = new FakeClient();
  const heartbeat = startHeartbeat(
    { clients: [brokenTerminate, brokenPing, healthy] },
    { intervalMs: 0 },
  );

  assert.doesNotThrow(() => heartbeat.tick());
  assert.equal(healthy.pings, 1, 'the client after both failures is still swept');
});

test('stop() silences a manual tick', () => {
  const client = new FakeClient();
  const heartbeat = startHeartbeat({ clients: [client] }, { intervalMs: 0 });
  heartbeat.stop();
  heartbeat.tick();
  assert.equal(client.pings, 0);
});

test('intervalMs defaults to 30000 and AIRP_WS_HEARTBEAT_MS overrides it', () => {
  mock.timers.enable({ apis: ['setInterval'] });
  try {
    delete process.env.AIRP_WS_HEARTBEAT_MS;
    const byDefault = new FakeClient();
    const defaultBeat = startHeartbeat({ clients: [byDefault] }, {});
    mock.timers.tick(29_999);
    assert.equal(byDefault.pings, 0, 'nothing before the 30s mark');
    mock.timers.tick(1);
    assert.equal(byDefault.pings, 1);
    defaultBeat.stop();

    process.env.AIRP_WS_HEARTBEAT_MS = '1000';
    const byEnv = new FakeClient();
    const envBeat = startHeartbeat({ clients: [byEnv] }, {});
    mock.timers.tick(1_000);
    assert.equal(byEnv.pings, 1);
    envBeat.stop();
  } finally {
    delete process.env.AIRP_WS_HEARTBEAT_MS;
    mock.timers.reset();
  }
});

/**
 * A server carrying the EXACT upgrade hook and connection wiring of
 * `apps/server/src/index.ts` (§2.2 / §3.2 step 7). `pongReset: false` is the
 * reverse experiment: the connection-scoped wiring is dropped.
 */
async function startGateway({ pongReset = true } = {}) {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><title>spa</title>');
  });
  const wss = new WebSocketServer({ noServer: true });
  const connections = [];

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/ws' || url.pathname.startsWith(STT_STREAM_PATH)) {
      if (url.pathname === '/ws' && url.searchParams.get('v') !== PROTOCOL_VERSION) {
        wss.handleUpgrade(req, socket, head, (ws) => {
          ws.close(WS_CLOSE.PROTOCOL_MISMATCH, 'protocol version mismatch');
        });
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
      return;
    }
    // Unknown path: no upgrade — `express.static` / the SPA fallback own it.
  });

  wss.on('connection', (ws, req) => {
    connections.push(req.url);
    ws.isAlive = true;
    if (pongReset) {
      ws.on('pong', () => {
        ws.isAlive = true;
      });
    }
    if (req.url?.startsWith(STT_STREAM_PATH)) {
      handleSttStream(ws);
      return;
    }
    ws.send(JSON.stringify({ type: 'connected' }));
  });

  // Raw sockets that never reach an upgrade (unknown path, or the reverse
  // experiment's B1 bug) are invisible to `wss.clients`; track them so `close()`
  // can still tear the server down instead of waiting forever.
  const rawSockets = new Set();
  server.on('connection', (socket) => {
    rawSockets.add(socket);
    socket.on('close', () => rawSockets.delete(socket));
  });

  // `intervalMs: 0` keeps the timer out of the way — every sweep is manual.
  const heartbeat = startHeartbeat(wss, { intervalMs: 0 });
  await listen(server);
  // Tear the sockets down BEFORE `server.close()`: it waits for every open
  // connection, so a test that leaves a client connected would hang the run.
  const close = () =>
    new Promise((r) => {
      heartbeat.stop();
      for (const ws of wss.clients) ws.terminate();
      for (const socket of rawSockets) socket.destroy();
      server.closeAllConnections?.();
      server.close(() => r());
    });
  return { url: `ws://127.0.0.1:${server.address().port}`, heartbeat, connections, close };
}

/** Connect and record the frames the server sends. */
function connect(url) {
  const ws = new WebSocket(url);
  const frames = [];
  ws.on('message', (raw) => {
    try {
      frames.push(JSON.parse(raw.toString()));
    } catch {
      frames.push(raw.toString());
    }
  });
  return { ws, frames };
}

test('/ws/stt still upgrades: the hook emits a connection and the relay answers', async () => {
  // No key in this environment, so the relay answers before touching upstream.
  const saved = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = '';
  const gateway = await startGateway();
  try {
    const client = connect(`${gateway.url}${STT_STREAM_PATH}`);
    await sleep(400);
    assert.ok(
      gateway.connections.some((url) => url?.startsWith(STT_STREAM_PATH)),
      'the upgrade hook must emit a connection for /ws/stt (a bare `return` never does)',
    );
    assert.ok(
      client.frames.some((f) => f?.type === 'error' && f?.code === 'stt_unavailable'),
      `expected a stt_unavailable frame, saw ${JSON.stringify(client.frames)}`,
    );
  } finally {
    await gateway.close();
    if (saved === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = saved;
  }
});

test('the SPA path stays plain HTTP under noServer', async () => {
  const gateway = await startGateway();
  try {
    // A normal GET never reaches the upgrade hook: `express.static` / the SPA
    // fallback own it (apps/server/src/index.ts).
    const root = await fetch(`${gateway.url.replace('ws://', 'http://')}/`);
    assert.equal(root.status, 200);
    assert.match(await root.text(), /spa/);
    assert.equal(gateway.connections.length, 0, 'an HTTP GET must not open a socket');
  } finally {
    await gateway.close();
  }
});

test('a live connection survives repeated sweeps (the pong reset holds)', async () => {
  const gateway = await startGateway();
  try {
    const client = connect(`${gateway.url}/ws?v=${PROTOCOL_VERSION}`);
    await sleep(200);
    assert.ok(client.frames.some((f) => f?.type === 'connected'), 'the socket is up');

    gateway.heartbeat.tick();
    await sleep(200); // let the pong round-trip land
    gateway.heartbeat.tick();
    await sleep(200);

    assert.equal(client.ws.readyState, WebSocket.OPEN, 'a live client must not be terminated');
  } finally {
    await gateway.close();
  }
});

test('reverse experiment: without the pong reset the second sweep kills a live client', async () => {
  const gateway = await startGateway({ pongReset: false });
  try {
    const client = connect(`${gateway.url}/ws?v=${PROTOCOL_VERSION}`);
    await sleep(200);
    assert.ok(client.frames.some((f) => f?.type === 'connected'), 'the socket is up');

    gateway.heartbeat.tick();
    await sleep(200); // the pong arrives but nothing writes it back
    gateway.heartbeat.tick();
    await sleep(200);

    assert.notEqual(
      client.ws.readyState,
      WebSocket.OPEN,
      'this case MUST go red if the connection-scoped pong wiring is present — it proves the previous test is non-empty',
    );
  } finally {
    await gateway.close();
  }
});
