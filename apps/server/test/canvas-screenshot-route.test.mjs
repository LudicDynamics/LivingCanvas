import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import http from 'node:http';
import { createCanvasPerceptionRouter } from '../dist/routes/canvas-perception.js';

test('screenshot route fails closed when the web origin is not configured', async () => {
  const previous = process.env.AIRP_WEB_ORIGIN;
  delete process.env.AIRP_WEB_ORIGIN;
  const app = express();
  app.use(express.json());
  app.use('/api', createCanvasPerceptionRouter(() => null));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/canvas/screenshot`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    const body = await response.json();
    assert.equal(response.status, 501);
    assert.equal(body.ok, false);
    assert.equal(body.code, 'unsupported');
    assert.equal(body.error, 'screenshot_canvas unavailable: the canvas web origin is not configured.');
    assert.equal(body.details.reason, 'the canvas web origin is not configured.');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previous === undefined) delete process.env.AIRP_WEB_ORIGIN;
    else process.env.AIRP_WEB_ORIGIN = previous;
  }
});

test('screenshot route rejects missing capability even on the configured local origin', async () => {
  const previous = process.env.AIRP_WEB_ORIGIN;
  const app = express();
  app.use(express.json());
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  process.env.AIRP_WEB_ORIGIN = `http://127.0.0.1:${port}`;
  app.use('/api', createCanvasPerceptionRouter(() => null));
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/canvas/screenshot`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: process.env.AIRP_WEB_ORIGIN },
      body: JSON.stringify({ worldId: 'world', layer: 'map', snapshotId: 'snapshot', viewport: { width: 800, height: 600 } }),
    });
    const body = await response.json();
    assert.equal(response.status, 501);
    assert.equal(body.ok, false);
    assert.equal(body.code, 'unsupported');
    assert.equal(body.error, 'screenshot_canvas unavailable: the current user\'s canvas identity is unavailable.');
    assert.equal(body.details.reason, 'the current user\'s canvas identity is unavailable.');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previous === undefined) delete process.env.AIRP_WEB_ORIGIN;
    else process.env.AIRP_WEB_ORIGIN = previous;
  }
});
