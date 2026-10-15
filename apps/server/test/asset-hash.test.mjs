// Content-addressed media. Runs against built dist:
// `pnpm --filter @airp/server build` first.
//
// Pinned: a media URL carrying `h=<hash of the bytes>` is immutable, a stale
// `h` is never pinned, a URL without `h` keeps its old caching, and identical
// files (the -jp / -zh / -en editions) hash to the same value.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import { fileHash, knownFileHash, mediaCacheControl, warmHashes, withContentHash, worldAssetIndex } from '../dist/asset-hash.js';

const sha = (data) => createHash('sha256').update(data).digest('hex').slice(0, 32);

async function tmp(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-asset-hash-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}
async function write(root, rel, data) {
  await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
  await fs.writeFile(path.join(root, rel), data);
}

test('a file hashes to the first 32 hex of its SHA-256, and a change is noticed', async (t) => {
  const dir = await tmp(t);
  const file = path.join(dir, 'a.webp');
  await fs.writeFile(file, 'one');
  assert.equal(await fileHash(file), sha('one'));
  assert.equal(knownFileHash(file), sha('one'), 'memoised for the synchronous audio resolver');
  await fs.writeFile(file, 'two!');
  assert.equal(knownFileHash(file), null, 'a changed file is not vouched for from memory');
  assert.equal(await fileHash(file), sha('two!'));
  assert.equal(await fileHash(path.join(dir, 'missing.webp')), null);
  assert.equal(await fileHash(dir), null, 'a directory is not media');
});

test('the world index covers media under the two asset roots only, and editions share hashes', async (t) => {
  const root = await tmp(t);
  const en = path.join(root, 'whitechapel');
  const jp = path.join(root, 'whitechapel-jp');
  for (const world of [en, jp]) {
    await write(world, 'assets/characters/holmes.webp', 'holmes');
    await write(world, 'assets/audio/theme.mp3', 'theme');
    await write(world, '.airpworld/assets/gen/p.png', `generated in ${path.basename(world)}`);
    await write(world, '.airpworld/settings.json', '{}');
    await write(world, 'world/README.md', '# not media');
    await write(world, 'assets/.hidden/x.webp', 'hidden');
    await write(world, 'assets/notes.txt', 'text');
  }
  const a = await worldAssetIndex(en);
  const b = await worldAssetIndex(jp);
  assert.deepEqual(Object.keys(a).sort(), ['.airpworld/assets/gen/p.png', 'assets/audio/theme.mp3', 'assets/characters/holmes.webp']);
  assert.equal(a['assets/characters/holmes.webp'], sha('holmes'));
  assert.equal(a['assets/characters/holmes.webp'], b['assets/characters/holmes.webp'], 'same picture, same URL in every edition');
  assert.notEqual(a['.airpworld/assets/gen/p.png'], b['.airpworld/assets/gen/p.png'], 'different bytes never share a hash');
  assert.equal(await warmHashes(path.join(en, 'assets')), 2);
});

test('cache headers: a matching hash is immutable, a stale one is never pinned, none keeps the old rule', () => {
  const h = 'a'.repeat(32);
  assert.equal(mediaCacheControl(h, h, 'public', 'public, max-age=3600'), 'public, max-age=31536000, immutable');
  assert.equal(mediaCacheControl(h, h, 'private', null), 'private, max-age=31536000, immutable');
  assert.equal(mediaCacheControl(h, 'b'.repeat(32), 'public', 'public, max-age=3600'), 'no-cache');
  assert.equal(mediaCacheControl(h, null, 'private', null), 'no-cache', 'an unreadable file is not pinned either');
  assert.equal(mediaCacheControl(undefined, h, 'public', 'public, max-age=3600'), 'public, max-age=3600');
  assert.equal(mediaCacheControl('../etc', h, 'private', null), null, 'a malformed h is ignored');
  assert.equal(mediaCacheControl(['x'], h, 'private', 'private, max-age=60'), 'private, max-age=60');
});

test('withContentHash appends h= only when the file hashes', async (t) => {
  const dir = await tmp(t);
  await write(dir, 'c.webp', 'cover');
  assert.equal(await withContentHash('/api/worlds/cover?id=x', path.join(dir, 'c.webp')), `/api/worlds/cover?id=x&h=${sha('cover')}`);
  assert.equal(await withContentHash('/api/x', path.join(dir, 'c.webp')), `/api/x?h=${sha('cover')}`);
  assert.equal(await withContentHash('/api/worlds/cover?id=x', path.join(dir, 'gone.webp')), '/api/worlds/cover?id=x');
});

test('a 0-byte placeholder (browser-mode catalog stub, platform audio stub) has no hash and no h=', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-hash-empty-'));
  const file = path.join(dir, 'intro.webp');
  await fs.writeFile(file, '');
  assert.equal(await fileHash(file), null);
  assert.equal(await withContentHash('/api/worlds/cover?id=a', file), '/api/worlds/cover?id=a');
});
