// GET /api/ambient: read-only, sanitised, keyed by id.
// Runs against built dist: `pnpm build` first.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { test } from 'node:test';
import { LocalWorldStore } from '@airp/shared';
import { createAmbientRouter, readAmbientEntries } from '../dist/routes/ambient.js';

async function worldWith(files) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-ambient-route-'));
  await fs.writeFile(path.join(root, 'world.json'), JSON.stringify({ id: 'w', name: 'W', version: '1.0.0', schema: 1 }));
  for (const [rel, text] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await fs.writeFile(path.join(root, rel), text);
  }
  return root;
}

async function get(router, url) {
  const app = express();
  app.use('/api', router);
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${url}`);
    return { status: res.status, body: await res.json() };
  } finally {
    server.close();
  }
}

test('AR1 entries are read from ambient/<id>.json, sanitised, broken files skipped', async () => {
  const root = await worldWith({
    'ambient/xia-cheng.json': JSON.stringify({ barks: ['Hello', 'x'.repeat(41)], emotes: ['dots', 'wink'] }),
    'ambient/lao-qin.json': '{ broken',
    'ambient/Bad_Name.json': JSON.stringify({ barks: ['nope'] }),
    'ambient/notes.txt': 'ignored',
  });
  const store = new LocalWorldStore(root);
  assert.deepEqual(await readAmbientEntries(store), { 'xia-cheng': { barks: ['Hello'], emotes: ['dots'] } });
  const { status, body } = await get(createAmbientRouter({ getStore: () => store }), '/api/ambient');
  assert.equal(status, 200);
  assert.deepEqual(body, { ok: true, entries: { 'xia-cheng': { barks: ['Hello'], emotes: ['dots'] } } });
});

test('AR2 a world with no ambient/ answers empty; no world is 409', async () => {
  const store = new LocalWorldStore(await worldWith({}));
  assert.deepEqual((await get(createAmbientRouter({ getStore: () => store }), '/api/ambient')).body, { ok: true, entries: {} });
  const none = await get(createAmbientRouter({ getStore: () => null }), '/api/ambient');
  assert.equal(none.status, 409);
  assert.equal(none.body.code, 'no_active_world');
});
