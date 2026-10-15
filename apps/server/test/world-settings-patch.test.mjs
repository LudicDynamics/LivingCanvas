// POST /api/world-settings is a PATCH, not a whole-object overwrite
//. Runs against built dist
//: `pnpm --filter @airp/server build` first.
//
// The observable difference between "patch" and "overwrite" exists even with a
// single field, and that is what these assert:
//   - an EMPTY body is a valid no-op under patch (`{}` keeps the stored value);
//     under whole-object overwrite it was a 400 (a one-field schema cannot
//     parse `{}`), i.e. the endpoint simply refused to be called partially.
//   - a body naming an unknown key is still rejected (strict is inherited), so
//     "accepts partial" did not become "accepts anything".
//   - the response carries the MERGED object, so the caller never has to guess
//     which fields survived.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { test } from 'node:test';
import { LocalWorldStore } from '@airp/shared';
import { createWorldRouter } from '../dist/routes/world.js';
import { EventBridge } from '../dist/engine/event-bridge.js';

const MANIFEST = JSON.stringify({
  id: 'proj-settings',
  name: 'Settings',
  description: '',
  author: '',
  genre: 'test',
  createdAt: '',
  updatedAt: '',
  characters: [],
});

const SETTINGS_FILE = '.airpworld/settings.json';

async function harness() {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-settings-repo-'));
  const world = path.join(repo, 'world-root');
  const store = new LocalWorldStore(world);
  await store.writeFile('world.json', MANIFEST);
  await store.writeFile('world/README.md', '---\nname: Map\ntype: readme\n---\n\n# Map\n');

  const lifecycle = { stopCharacters: async () => {}, startWriter: async () => {}, stopAll: async () => {} };
  const app = express();
  app.use(express.json());
  app.use('/api', createWorldRouter(repo, lifecycle, new EventBridge(), () => store, () => {}));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  return {
    world,
    store,
    get: async (route) => {
      const r = await fetch(base + route);
      return { status: r.status, body: await r.json().catch(() => null) };
    },
    post: async (route, body) => {
      const r = await fetch(base + route, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      return { status: r.status, body: await r.json().catch(() => null) };
    },
    onDisk: async () => JSON.parse(await fs.readFile(path.join(world, SETTINGS_FILE), 'utf8')),
    close: async () => {
      server.close();
      try { store.close(); } catch {}
      await fs.rm(repo, { recursive: true, force: true });
    },
  };
}

test('S1-P1 an empty body is a valid no-op that keeps the stored value', async () => {
  const h = await harness();
  try {
    const seed = await h.post('/world-settings', { autoWrite: 'off' });
    assert.equal(seed.status, 200, JSON.stringify(seed.body));

    const r = await h.post('/world-settings', {});
    assert.equal(r.status, 200, `empty patch must be accepted, got ${JSON.stringify(r.body)}`);
    assert.equal(r.body.autoWrite, 'off', 'a field absent from the patch MUST keep its stored value');
    assert.equal((await h.onDisk()).autoWrite, 'off', 'the stored file must be untouched');

    const after = await h.get('/world-settings');
    assert.equal(after.status, 200);
    assert.equal(after.body.autoWrite, 'off');
  } finally {
    await h.close();
  }
});

test('S1-P2 patch still rejects unknown keys (strict is inherited)', async () => {
  const h = await harness();
  try {
    await h.post('/world-settings', { autoWrite: 'scenes' });
    const r = await h.post('/world-settings', { nope: true });
    assert.equal(r.status, 400, 'strict: an unknown key is a 400, never silently dropped');
    assert.equal((await h.onDisk()).autoWrite, 'scenes', 'a rejected patch must not write');
  } finally {
    await h.close();
  }
});

test('S1-P3 the response carries the merged object, not the request echo', async () => {
  const h = await harness();
  try {
    await h.post('/world-settings', { autoWrite: 'off' });
    const r = await h.post('/world-settings', {});
    assert.equal(r.status, 200);
    assert.equal(r.body.world, h.world, 'the merged response keeps the `world` key');
    assert.equal(r.body.autoWrite, 'off');
  } finally {
    await h.close();
  }
});
