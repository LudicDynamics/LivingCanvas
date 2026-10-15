// Creation-mode music picker: GET shows the world theme
// and one place's declared music; POST runs the shared set_music action
// (catalog-checked, one music_changed event). Draft workshop worlds only.
// Runs against built dist: `pnpm --filter @airp/server build`.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { test } from 'node:test';
import { LocalWorldStore, parseFrontmatter } from '@airp/shared';
import { createWorkshopMusicRouter } from '../dist/routes/workshop-music.js';

async function world({ status = 'draft' } = {}) {
  delete process.env.AIRP_USER_ID;
  const root = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'airp-music-route-')), 'made-1234abcd');
  const store = new LocalWorldStore(root);
  await store.writeFile('world.json', JSON.stringify({
    id: 'made-1234abcd', name: 'Village', description: '', author: 'local', genre: 'Workshop', locale: 'en',
    workshop: { status, owner: 'local', createdAt: 'x' }, characters: [],
    theme: { players: 'single', type: 'infinite', rules: 'coc', structure: { endings: true, mysteries: true, clock: false, puzzles: false } },
    audio: { theme: 'guixiang' }, createdAt: 'x', updatedAt: 'x',
  }, null, 2));
  await store.writeFile('world/README.md', '---\ntype: readme\nname: Root\nambient: rain\n---\n\nThe hall.\n');
  await store.writeFile('world/well/README.md', '---\ntype: readme\nname: Well\n---\n\nA well.\n');
  return store;
}

async function serve(store) {
  const app = express();
  app.use(express.json());
  app.use('/api', createWorkshopMusicRouter({ getStore: () => store }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/workshop/music`;
  const get = async (layer) => { const r = await fetch(`${base}?layer=${encodeURIComponent(layer)}`); return { status: r.status, body: await r.json() }; };
  const post = async (body) => {
    const r = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  return { get, post, close: () => new Promise((resolve) => server.close(resolve)) };
}

test('GET: the world theme, its type default and the place\'s declared bgm / ambient', async () => {
  const store = await world();
  const s = await serve(store);
  try {
    const r = await s.get('map');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.world, { theme: 'guixiang', typeDefault: 'guixiang' });
    assert.deepEqual(r.body.place, { layer: 'map', name: 'Root', bgm: null, ambient: 'rain', exists: true });
  } finally { await s.close(); }
});

test('POST: a place track + ambient and the world theme are written; a made-up id is a 400', async () => {
  const store = await world();
  const s = await serve(store);
  try {
    assert.equal((await s.post({ layer: 'world/well', track: 'tense', ambient: null })).body.changed, true);
    assert.equal((await s.post({ layer: 'world/well', track: null, ambient: 'cave-drip' })).body.changed, true);
    const fm = parseFrontmatter(await store.readFile('world/well/README.md')).frontmatter;
    assert.deepEqual([fm.bgm, fm.ambient], ['tense', 'cave-drip']);
    assert.equal((await s.post({ layer: 'world', track: 'firstsnow', ambient: null })).status, 200);
    assert.equal((await store.getManifest()).audio.theme, 'firstsnow');
    const bad = await s.post({ layer: 'map', track: 'epic', ambient: null });
    assert.equal(bad.status, 400);
    assert.match(bad.body.error, /not in the music catalog/);
    const events = (await store.getEvents(100)).filter((e) => e.type === 'music_changed');
    assert.equal(events.length, 3);
  } finally { await s.close(); }
});

test('only the author\'s draft: a published world is refused', async () => {
  const store = await world({ status: 'published' });
  const s = await serve(store);
  try {
    assert.equal((await s.get('map')).status, 409);
    assert.equal((await s.post({ layer: 'map', track: 'calm' })).status, 409);
  } finally { await s.close(); }
});
