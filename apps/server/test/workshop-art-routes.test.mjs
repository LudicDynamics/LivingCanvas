// Creation-mode art routes: the 素材 panel lists
// every picture the world needs, edits its prompt in the owning file, paints or
// uploads it, and wires the page to it only once the file exists. Draft
// workshop worlds only. Runs against built dist: `pnpm --filter @airp/server build`.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { test } from 'node:test';
import { LocalWorldStore, parseFrontmatter } from '@airp/shared';
import { createWorkshopArtRouter } from '../dist/routes/workshop-art.js';

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

async function world({ status = 'draft', id = 'made-1234abcd' } = {}) {
  delete process.env.AIRP_USER_ID;
  const root = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'airp-art-')), id);
  const store = new LocalWorldStore(root);
  await store.writeFile('world.json', JSON.stringify({
    id: 'made-1234abcd', name: 'Village', description: '', author: 'local', genre: 'Workshop',
    workshop: { status, owner: 'local', createdAt: 'x' },
    characters: [{ id: 'po', name: 'Po', home: 'map', avatar: 'assets/characters/old.png' }],
    triggers: [{ id: 'first-name', kind: 'place', when: { layer: 'world/well' }, assets: [{ kind: 'cg', path: 'assets/cg/first.webp', prompt: 'the first name' }] }],
    createdAt: 'x', updatedAt: 'x',
  }, null, 2));
  await store.writeFile('world/README.md', '---\ntype: readme\nname: Root\nbg: assets/scenes/intro.png\nart:\n  scene:\n    path: assets/scenes/hall.webp\n    prompt: a hall\n  map:\n    path: assets/maps/village.webp\n    prompt: aerial village\n---\n\nThe hall.\n');
  await store.writeFile('world/well/README.md', '---\ntype: readme\ntitle: Well\nmap:\n  plan:\n    pins:\n      well-mouth: [0.4, 0.4]\n---\n\nA well.\n');
  await store.writeFile('world/well/xi-mei.md', '---\ntype: npc\nname: Xi Mei\nart:\n  portrait:\n    path: assets/characters/xi-mei.png\n    prompt: a girl\n---\n\nShe waits.\n');
  await store.writeFile('characters/po/README.md', '---\ntype: readme\nname: Po\navatar: assets/characters/old.png\nart:\n  portrait:\n    path: assets/characters/po.png\n    prompt: old woman\n---\n\nPo.\n');
  await store.writeFile('assets/scenes/intro.png', Buffer.from(PNG_B64, 'base64'));
  return store;
}

async function serve(store, painter) {
  const app = express();
  app.use(express.json({ limit: '12mb' }));
  const calls = [];
  const fake = painter === null ? () => null : () => async (prompt) => { calls.push(prompt); return painter ?? { ok: true, mimeType: 'image/png', dataB64: PNG_B64 }; };
  app.use('/api', createWorkshopArtRouter({ getStore: () => store, painter: fake }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/workshop/art`;
  const get = async () => { const r = await fetch(base); return { status: r.status, body: await r.json() }; };
  const post = async (sub, body) => {
    const r = await fetch(`${base}/${sub}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  return { get, post, calls, close: () => new Promise((r) => server.close(r)) };
}

const fm = async (store, file) => parseFrontmatter(await store.readFile(file)).frontmatter;

test('GET lists every slot with its prompt, existence and what is wired now', async () => {
  const store = await world();
  const s = await serve(store);
  try {
    const { status, body } = await s.get();
    assert.equal(status, 200);
    assert.equal(body.canPaint, true);
    const ids = body.slots.map((x) => x.id);
    assert.deepEqual(ids, ['layer:map:scene', 'layer:map:map', 'layer:world/well:scene', 'layer:world/well:map', 'character:po:portrait', 'npc:world/well/xi-mei.md:portrait', 'trigger:first-name:0']);
    const root = body.slots[0];
    assert.equal(root.prompt, 'a hall');
    assert.equal(root.exists, false);
    assert.equal(root.inUse, 'assets/scenes/intro.png');
    assert.match(root.inUseUrl, /^\/api\/asset\?path=assets%2Fscenes%2Fintro\.png&kind=image&v=\d+$/);
    assert.equal(root.url, undefined);
  } finally { await s.close(); }
});

test('only the author\'s draft: a published world and a play copy are refused', async () => {
  const published = await serve(await world({ status: 'published' }));
  try { assert.equal((await published.get()).status, 409); } finally { await published.close(); }
  const copy = await serve(await world({ id: 'made-1234abcd-9f9f9f9f' }));
  try { assert.equal((await copy.get()).status, 403); } finally { await copy.close(); }
  const none = await serve(null);
  try { assert.equal((await none.get()).status, 409); } finally { await none.close(); }
});

test('prompt: declares an undeclared slot in its README, keeping the body; trigger prompts go to world.json', async () => {
  const store = await world();
  const s = await serve(store);
  try {
    const r = await s.post('prompt', { slot: 'layer:world/well:map', prompt: '  aerial well  ' });
    assert.equal(r.status, 200);
    assert.equal(r.body.slot.prompt, 'aerial well');
    assert.equal(r.body.slot.declared, true);
    const well = await fm(store, 'world/well/README.md');
    assert.deepEqual(well.art.map, { path: 'assets/maps/well.png', prompt: 'aerial well' });
    assert.deepEqual(well.map.plan.pins, { 'well-mouth': [0.4, 0.4] });
    assert.match(await store.readFile('world/well/README.md'), /A well\./);
    await s.post('prompt', { slot: 'trigger:first-name:0', prompt: 'a new cg prompt' });
    const manifest = JSON.parse(await store.readFile('world.json'));
    assert.equal(manifest.triggers[0].assets[0].prompt, 'a new cg prompt');
    assert.equal((await s.post('prompt', { slot: 'nope', prompt: 'x' })).status, 404);
    assert.equal((await s.post('prompt', { slot: 'layer:map:scene' })).status, 400);
  } finally { await s.close(); }
});

test('generate: paints from the prompt, lands at the typed extension, and wires bg / map picture', async () => {
  const store = await world();
  const s = await serve(store);
  try {
    const scene = await s.post('generate', { slot: 'layer:map:scene' });
    assert.equal(scene.status, 200);
    assert.deepEqual(s.calls, ['a hall']);
    // The painter answered PNG: the declared .webp path follows the real type.
    assert.equal(scene.body.slot.path, 'assets/scenes/hall.png');
    assert.equal(scene.body.slot.exists, true);
    assert.ok(scene.body.slot.url);
    const root = await fm(store, 'world/README.md');
    assert.equal(root.bg, 'assets/scenes/hall.png');
    assert.equal(root.art.scene.path, 'assets/scenes/hall.png');
    const map = await s.post('generate', { slot: 'layer:map:map', prompt: 'a new aerial' });
    assert.equal(map.status, 200);
    assert.equal(s.calls.at(-1), 'a new aerial');
    assert.equal((await fm(store, 'world/README.md')).map.plan.picture, 'assets/maps/village.png');
    // No prompt yet: nothing is painted.
    assert.equal((await s.post('generate', { slot: 'layer:world/well:scene' })).status, 400);
  } finally { await s.close(); }
});

test('generate: 503 without an image model, and a failed paint leaves the page untouched', async () => {
  const store = await world();
  const none = await serve(store, null);
  try {
    const r = await none.post('generate', { slot: 'layer:map:scene' });
    assert.equal(r.status, 503);
    assert.equal(r.body.code, 'no_image_model');
    assert.equal((await none.get()).body.canPaint, false);
  } finally { await none.close(); }
  const failing = await serve(store, { ok: false, reason: 'timeout', message: 'slow' });
  try {
    assert.equal((await failing.post('generate', { slot: 'layer:map:scene' })).status, 504);
    assert.equal((await fm(store, 'world/README.md')).bg, 'assets/scenes/intro.png');
  } finally { await failing.close(); }
});

test('upload: portraits set the avatar on the card and on the world.json character; cutout is only recorded', async () => {
  const store = await world();
  const s = await serve(store);
  try {
    const po = await s.post('upload', { slot: 'character:po:portrait', mimeType: 'image/png', dataB64: PNG_B64, cutout: true });
    assert.equal(po.status, 200);
    const card = await fm(store, 'characters/po/README.md');
    assert.equal(card.avatar, 'assets/characters/po.png');
    assert.equal(card.art.portrait.cutout, true);
    assert.equal(JSON.parse(await store.readFile('world.json')).characters[0].avatar, 'assets/characters/po.png');
    const npc = await s.post('upload', { slot: 'npc:world/well/xi-mei.md:portrait', mimeType: 'image/jpeg', dataB64: PNG_B64 });
    assert.equal(npc.body.slot.path, 'assets/characters/xi-mei.jpg');
    assert.equal((await fm(store, 'world/well/xi-mei.md')).avatar, 'assets/characters/xi-mei.jpg');
    assert.equal((await s.post('upload', { slot: 'character:po:portrait', mimeType: 'image/gif', dataB64: PNG_B64 })).status, 400);
    assert.equal((await s.post('upload', { slot: 'character:po:portrait', mimeType: 'image/png', dataB64: '' })).status, 400);
  } finally { await s.close(); }
});
