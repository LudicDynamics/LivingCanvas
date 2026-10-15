// Every picture entering the engine is compressed:
// the server's entry points — a workshop cover, a workshop art upload, a local
// publish, the bundle that goes to storage / a remote. Model images
// (generate_image) are covered in packages/shared/test/image-compress.test.mjs,
// the official release in tools/migrate-worlds-to-storage.test.mjs.
// Runs against built dist (`pnpm build`); fixtures are made with sharp.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import express from 'express';
import { test } from 'node:test';
import { LocalWorldStore, parseFrontmatter } from '@airp/shared';
import { readImageInfo } from '@airp/shared/images';
import { createWorkshopWorld, parseCreateWorldInput, publishWorkshopWorld } from '../dist/world-workshop.js';
import { createWorkshopArtRouter } from '../dist/routes/workshop-art.js';
import { buildEntries } from '../dist/sync/bundle.js';

const sharp = createRequire(new URL('../../../packages/shared/package.json', import.meta.url))('sharp');

/** A picture-sized PNG that compresses like art, not like a flat colour. */
async function bigPng(width, height, { alpha = false } = {}) {
  const channels = alpha ? 4 : 3;
  const raw = Buffer.alloc(width * height * channels);
  for (let i = 0, x = 11; i < raw.length; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    raw[i] = ((x >> 16) & 0x3f) + (((i / channels / width) | 0) % 128);
  }
  if (alpha) for (let i = 3; i < raw.length; i += 4) raw[i] = (i / 4) % width < width / 3 ? 0 : 255;
  return sharp(raw, { raw: { width, height, channels } }).png({ compressionLevel: 9 }).toBuffer();
}

async function sandbox() {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-images-'));
  await fs.mkdir(path.join(repo, 'templates'));
  process.env.AIRP_WORLDS_ROOT = path.join(repo, 'saves');
  process.env.AIRP_PUBLISHED_ROOT = path.join(repo, 'shared');
  delete process.env.AIRP_USER_ID;
  return repo;
}

const createInput = (cover) => parseCreateWorldInput({ name: 'Fog Harbour', description: 'A town that forgets its ships.', locale: 'en', cover });

test('workshop cover: a painted or uploaded PNG lands as a capped WebP and the world points at it', async () => {
  const repo = await sandbox();
  const png = await bigPng(2100, 1400);
  const painter = async () => ({ ok: true, mimeType: 'image/png', dataB64: png.toString('base64') });
  for (const made of [
    await createWorkshopWorld(repo, createInput({ kind: 'generate', prompt: 'a harbour' }), painter),
    await createWorkshopWorld(repo, createInput({ kind: 'upload', mimeType: 'image/png', dataB64: png.toString('base64') }), null),
  ]) {
    const dir = path.join(repo, 'saves', made.id);
    assert.equal(made.manifest.cover, 'assets/scenes/intro.webp');
    assert.match(await fs.readFile(path.join(dir, 'world/README.md'), 'utf8'), /bg: assets\/scenes\/intro\.webp/);
    const bytes = await fs.readFile(path.join(dir, 'assets/scenes/intro.webp'));
    const info = readImageInfo(bytes);
    // The cover is also the entry scene's backdrop: the scene cap, not the launcher-cover one.
    assert.deepEqual([info.format, info.width, info.height], ['webp', 1920, 1280]);
    assert.ok(bytes.length < png.length / 3);
    await assert.rejects(fs.stat(path.join(dir, 'assets/scenes/intro.png')));
  }
});

async function artWorld() {
  const root = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'airp-art-img-')), 'made-1234abcd');
  const store = new LocalWorldStore(root);
  await store.writeFile('world.json', JSON.stringify({
    id: 'made-1234abcd', name: 'Village', description: '', author: 'local', genre: 'Workshop',
    workshop: { status: 'draft', owner: 'local', createdAt: 'x' },
    characters: [{ id: 'po', name: 'Po', home: 'map', avatar: 'assets/characters/old.png' }],
    createdAt: 'x', updatedAt: 'x',
  }, null, 2));
  await store.writeFile('world/README.md', '---\ntype: readme\nname: Root\nart:\n  map:\n    path: assets/maps/village.png\n    prompt: aerial village\n---\n\nThe hall.\n');
  await store.writeFile('characters/po/README.md', '---\ntype: readme\nname: Po\navatar: assets/characters/old.png\nart:\n  portrait:\n    path: assets/characters/po.png\n    prompt: old woman\n---\n\nPo.\n');
  return store;
}

test('workshop art: an upload is compressed by its slot (portrait 1024, alpha kept; map 2048) and wired as .webp', async () => {
  delete process.env.AIRP_USER_ID;
  const store = await artWorld();
  const app = express();
  app.use(express.json({ limit: '20mb' }));
  app.use('/api', createWorkshopArtRouter({ getStore: () => store, painter: () => null }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const post = async (body) => {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api/workshop/art/upload`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  try {
    const portrait = await post({ slot: 'character:po:portrait', mimeType: 'image/png', dataB64: (await bigPng(1200, 1800, { alpha: true })).toString('base64'), cutout: true });
    assert.equal(portrait.status, 200, JSON.stringify(portrait.body));
    assert.equal(portrait.body.slot.path, 'assets/characters/po.webp');
    const po = readImageInfo(await fs.readFile(path.join(store.worldRoot, 'assets/characters/po.webp')));
    assert.deepEqual([po.format, po.width, po.height, po.alpha], ['webp', 683, 1024, true]);
    const fm = parseFrontmatter(await store.readFile('characters/po/README.md')).frontmatter;
    assert.equal(fm.avatar, 'assets/characters/po.webp');
    assert.equal(JSON.parse(await store.readFile('world.json')).characters[0].avatar, 'assets/characters/po.webp');

    const map = await post({ slot: 'layer:map:map', mimeType: 'image/png', dataB64: (await bigPng(2600, 1300)).toString('base64') });
    assert.equal(map.status, 200, JSON.stringify(map.body));
    assert.equal(map.body.slot.path, 'assets/maps/village.webp');
    const village = readImageInfo(await fs.readFile(path.join(store.worldRoot, 'assets/maps/village.webp')));
    assert.deepEqual([village.width, village.height], [2048, 1024]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

/** A made world whose generated picture predates the pipeline: a big PNG a README points at. */
async function legacyWorld(repo) {
  const tiny = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const made = await createWorkshopWorld(repo, createInput({ kind: 'upload', mimeType: 'image/png', dataB64: tiny }), null);
  const dir = path.join(repo, 'saves', made.id);
  await fs.mkdir(path.join(dir, '.airpworld/assets/gen'), { recursive: true });
  await fs.writeFile(path.join(dir, '.airpworld/assets/gen/harbour-0123456789abcdef.png'), await bigPng(1536, 1024));
  await fs.mkdir(path.join(dir, 'world/harbour'), { recursive: true });
  await fs.writeFile(path.join(dir, 'world/harbour/README.md'), '---\ntype: readme\ntitle: Harbour\nbg: .airpworld/assets/gen/harbour-0123456789abcdef.png\n---\n\nShips.\n');
  return { made, dir };
}

test('workshop publish: the public copy is compressed with its references; the draft keeps its originals', async () => {
  const repo = await sandbox();
  const { made, dir } = await legacyWorld(repo);
  const out = await publishWorkshopWorld(repo, made.worldPath);
  const published = path.join(repo, 'shared', made.id);
  assert.equal(out.publishedPath, `published/${made.id}`);
  assert.equal(readImageInfo(await fs.readFile(path.join(published, '.airpworld/assets/gen/harbour-0123456789abcdef.webp'))).format, 'webp');
  await assert.rejects(fs.stat(path.join(published, '.airpworld/assets/gen/harbour-0123456789abcdef.png')));
  assert.match(await fs.readFile(path.join(published, 'world/harbour/README.md'), 'utf8'), /bg: \.airpworld\/assets\/gen\/harbour-0123456789abcdef\.webp/);
  assert.equal(JSON.parse(await fs.readFile(path.join(published, 'world.json'), 'utf8')).workshop.status, 'published');
  // The author's draft is untouched.
  assert.equal(readImageInfo(await fs.readFile(path.join(dir, '.airpworld/assets/gen/harbour-0123456789abcdef.png'))).format, 'png');
  assert.match(await fs.readFile(path.join(dir, 'world/harbour/README.md'), 'utf8'), /harbour-0123456789abcdef\.png/);
});

test('storage / remote upload: the bundle entries carry the compressed pictures and rewritten references', async () => {
  const repo = await sandbox();
  const { dir } = await legacyWorld(repo);
  const before = await fs.readFile(path.join(dir, '.airpworld/assets/gen/harbour-0123456789abcdef.png'));
  const built = await buildEntries(dir);
  const byPath = new Map(built.entries.map((e) => [e.path, e.data]));
  assert.ok(byPath.has('.airpworld/assets/gen/harbour-0123456789abcdef.webp'), [...byPath.keys()].join(','));
  assert.ok(!byPath.has('.airpworld/assets/gen/harbour-0123456789abcdef.png'));
  assert.ok(byPath.get('.airpworld/assets/gen/harbour-0123456789abcdef.webp').length < before.length / 3);
  assert.match(byPath.get('world/harbour/README.md').toString('utf8'), /harbour-0123456789abcdef\.webp/);
  // Built twice, the same bytes: what a pair compares does not churn.
  const again = await buildEntries(dir);
  assert.deepEqual(again.entries.map((e) => [e.path, e.data.length]), built.entries.map((e) => [e.path, e.data.length]));
  assert.deepEqual(await fs.readFile(path.join(dir, '.airpworld/assets/gen/harbour-0123456789abcdef.png')), before, 'the local world keeps its original');
});
