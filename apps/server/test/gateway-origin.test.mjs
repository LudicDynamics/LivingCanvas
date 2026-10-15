import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import { WebSocket, WebSocketServer } from 'ws';
import { PROTOCOL_VERSION } from '@airp/shared';
import { parseWsAllowedOrigins, registerGatewayUpgrades } from '../dist/gateway/upgrade.js';

async function startGateway(allowedOrigins = new Set()) {
  const server = http.createServer();
  const wss = new WebSocketServer({ noServer: true });
  const accepted = [];
  const rawSockets = new Set();
  server.on('connection', socket => {
    rawSockets.add(socket);
    socket.on('close', () => rawSockets.delete(socket));
  });
  registerGatewayUpgrades(server, wss, {
    sttPath: '/ws/stt',
    voiceLivePath: '/ws/voice-live',
    allowedOrigins,
  });
  wss.on('connection', (ws, req) => {
    accepted.push(req.url);
    if (req.url?.startsWith('/ws?')) ws.send(JSON.stringify({ type: 'replay_done', savePath: '/private/world' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const url = `ws://127.0.0.1:${address.port}`;
  return {
    url,
    accepted,
    close: async () => {
      for (const ws of wss.clients) ws.terminate();
      for (const socket of rawSockets) socket.destroy();
      server.closeAllConnections?.();
      await new Promise(resolve => server.close(resolve));
    },
  };
}

function firstFrame(url, options) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, options);
    ws.once('message', raw => {
      const frame = JSON.parse(raw.toString());
      ws.close();
      resolve(frame);
    });
    ws.once('error', reject);
  });
}

function rejectedStatus(url, origin) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers: { Origin: origin } });
    ws.once('unexpected-response', (_request, response) => resolve(response.statusCode));
    ws.once('error', () => {});
    setTimeout(() => reject(new Error('upgrade was neither rejected nor accepted')), 1000).unref();
  });
}

test('same-origin localhost sockets use their actual host and port', async () => {
  const gateway = await startGateway();
  try {
    const origin = gateway.url.replace('ws:', 'http:');
    const frame = await firstFrame(`${gateway.url}/ws?v=${PROTOCOL_VERSION}`, { origin });
    assert.deepEqual(frame, { type: 'replay_done', savePath: '/private/world' });
    assert.deepEqual(gateway.accepted, [`/ws?v=${PROTOCOL_VERSION}`]);
  } finally {
    await gateway.close();
  }
});

test('an explicitly configured frontend origin supports a reverse proxy host', async () => {
  const origin = 'https://story.example.test';
  const gateway = await startGateway(parseWsAllowedOrigins(origin));
  try {
    const frame = await firstFrame(`${gateway.url}/ws?v=${PROTOCOL_VERSION}`, { origin });
    assert.equal(frame.savePath, '/private/world');
    assert.equal(gateway.accepted.length, 1);
  } finally {
    await gateway.close();
  }
});

test('an untrusted browser origin is rejected before connection replay or dispatch', async () => {
  const gateway = await startGateway();
  try {
    const status = await rejectedStatus(`${gateway.url}/ws?v=${PROTOCOL_VERSION}`, 'https://attacker.example');
    assert.equal(status, 403);
    assert.deepEqual(gateway.accepted, [], 'the connection handler (replay and command dispatcher) never runs');
  } finally {
    await gateway.close();
  }
});

test('a WebSocket client without Origin remains available to the trusted non-browser network boundary', async () => {
  const gateway = await startGateway();
  try {
    const frame = await firstFrame(`${gateway.url}/ws?v=${PROTOCOL_VERSION}`);
    assert.equal(frame.savePath, '/private/world');
    assert.equal(gateway.accepted.length, 1);
  } finally {
    await gateway.close();
  }
});
