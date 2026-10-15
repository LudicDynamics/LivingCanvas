// Save identity is rejected at the HTTP boundary before a stale call can touch
// the selected world's store or a live-session registry.
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { test } from 'node:test';
import { createLiveRouter } from '../dist/routes/live.js';

const SAVE_A = '/saves/a';
const SAVE_B = '/saves/b';

function startServer(activeStoreOrGetter, registry) {
  const getActiveStore = typeof activeStoreOrGetter === 'function' ? activeStoreOrGetter : () => activeStoreOrGetter;
  const app = express();
  app.use(express.json());
  app.use('/api', createLiveRouter(getActiveStore, registry));
  const server = http.createServer(app);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        server,
        post: async (route, body) => {
          const response = await fetch(`http://127.0.0.1:${server.address().port}/api${route}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          });
          return { status: response.status, body: await response.json() };
        },
      });
    });
  });
}

test('save-A live session, close, and voice ticket requests have no effects while save B is selected', async () => {
  const effects = { stat: 0, read: 0, open: 0, close: 0 };
  const activeStore = {
    worldRoot: SAVE_B,
    async statKind() { effects.stat += 1; return 'dir'; },
    async readFile() { effects.read += 1; return '---\nname: Vera\n---\n'; },
  };
  const registry = {
    isWorldRootCurrent: () => true,
    captureWorldEpoch: () => 0,
    isWorldIdentityCurrent: () => true,
    async open() { effects.open += 1; throw new Error('stale session reached registry'); },
    async close() { effects.close += 1; },
  };
  const h = await startServer(activeStore, registry);
  try {
    const session = await h.post('/live/session', {
      character: 'vera', sdp: 'offer-sdp', language: 'en', savePath: SAVE_A,
    });
    const close = await h.post('/live/close', { character: 'vera', savePath: SAVE_A });
    const ticket = await h.post('/live/voice-live/ticket', { characterId: 'vera', savePath: SAVE_A });

    assert.equal(session.status, 409);
    assert.equal(session.body.code, 'world_changed');
    assert.equal(close.status, 409);
    assert.equal(close.body.code, 'world_changed');
    assert.equal(ticket.status, 409);
    assert.equal(ticket.body.code, 'world_changed');
    assert.deepEqual(effects, { stat: 0, read: 0, open: 0, close: 0 });
  } finally {
    await new Promise((resolve) => h.server.close(resolve));
  }
});

test('an A→B→A transition during live open returns world_changed instead of the stale attach error', async () => {
  const effects = { stat: 0, read: 0, open: 0 };
  const makeStore = worldRoot => ({
    worldRoot,
    async statKind() { effects.stat += 1; return 'dir'; },
    async readFile() { effects.read += 1; return '---\nname: Vera\n---\n'; },
  });
  const storeA = makeStore(SAVE_A);
  const storeB = makeStore(SAVE_B);
  let activeStore = storeA;
  let worldEpoch = 7;
  const registry = {
    isWorldRootCurrent: root => activeStore.worldRoot === root,
    captureWorldEpoch: () => worldEpoch,
    isWorldIdentityCurrent: (root, capturedEpoch) => activeStore.worldRoot === root && worldEpoch === capturedEpoch,
    async open() {
      effects.open += 1;
      activeStore = storeB;
      worldEpoch += 1;
      activeStore = makeStore(SAVE_A);
      worldEpoch += 1;
      throw new Error('stale sideband attach failed');
    },
    async close() {},
  };
  const h = await startServer(() => activeStore, registry);
  try {
    const result = await h.post('/live/session', {
      character: 'vera', sdp: 'offer-sdp', language: 'en', savePath: SAVE_A,
    });
    assert.equal(result.status, 409);
    assert.equal(result.body.code, 'world_changed');
    assert.equal(result.body.error, 'The active world changed before the live call could be opened.');
    assert.deepEqual(effects, { stat: 1, read: 1, open: 1 });
  } finally {
    await new Promise(resolve => h.server.close(resolve));
  }
});
