import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  ActionError,
  LocalWorldStore,
  assertAssetReference,
  assertImageAsset,
  assertWorldFileReference,
  createEntity,
  editEntity,
  isAllowedMediaReference,
} from '../dist/index.js';

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
const JPEG = Buffer.from('ffd8ffd9', 'hex');
const WEBP = Buffer.from('524946460400000057454250', 'hex');

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-media-'));
  await fs.mkdir(path.join(root, 'assets'), { recursive: true });
  await fs.mkdir(path.join(root, '.airpworld/assets'), { recursive: true });
  await fs.writeFile(path.join(root, 'assets/photo.png'), PNG);
  await fs.writeFile(path.join(root, 'assets/photo.jpg'), JPEG);
  await fs.writeFile(path.join(root, '.airpworld/assets/generated.webp'), WEBP);
  return root;
}

async function invalid(run) {
  await assert.rejects(run, (error) => {
    assert.ok(error instanceof ActionError);
    assert.equal(error.code, 'invalid_asset_ref');
    return true;
  });
}

test('assertImageAsset accepts both published image roots and matching signatures', async () => {
  const root = await fixture();
  try {
    await assertImageAsset(root, 'assets/photo.png');
    await assertImageAsset(root, 'assets/photo.jpg');
    await assertImageAsset(root, '.airpworld/assets/generated.webp');
    assert.equal(isAllowedMediaReference('assets/photo.png'), true);
    assert.equal(isAllowedMediaReference('.airpworld/assets/generated.webp'), true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('assertImageAsset rejects traversal, wrong media, directories and MIME spoofing', async () => {
  const root = await fixture();
  try {
    await fs.writeFile(path.join(root, 'assets/fake.png'), '<html>not an image</html>');
    await fs.writeFile(path.join(root, 'assets/fake.webp'), JPEG);
    await fs.mkdir(path.join(root, 'assets/folder'));
    for (const reference of [
      '../outside.png',
      '/etc/passwd',
      'assets/../outside.png',
      '.airpworld/assets-link/generated.webp',
      'assets/fake.png',
      'assets/fake.webp',
      'assets/folder',
      'assets/photo.mp4',
    ]) {
      await invalid(() => assertImageAsset(root, reference));
    }
    assert.equal(isAllowedMediaReference('../outside.png'), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('realpath symlink escape is rejected while generic video/audio lanes remain available', { skip: process.platform === 'win32' ? 'symlink fixture requires POSIX' : false }, async () => {
  const root = await fixture();
  try {
    await fs.writeFile(path.join(root, 'outside.mp4'), 'outside');
    await fs.symlink(path.join(root, 'outside.mp4'), path.join(root, 'assets/escape.mp4'));
    await invalid(() => assertAssetReference(root, 'assets/escape.mp4', 'video'));
    await fs.writeFile(path.join(root, 'assets/clip.webm'), 'WEBM');
    await fs.writeFile(path.join(root, 'assets/clip.mp3'), 'ID3');
    const video = await assertAssetReference(root, 'assets/clip.webm', 'video');
    const audio = await assertAssetReference(root, 'assets/clip.mp3', 'audio');
    assert.equal(video.mimeType, 'video/webm');
    assert.equal(audio.mimeType, 'audio/mpeg');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('createEntity and editEntity validate photo references before write/event', async () => {
  const root = await fixture();
  const store = new LocalWorldStore(root);
  try {
    await store.writeFile('world.json', JSON.stringify({
      id: 'media-test',
      name: 'Media Test',
      description: '',
      author: 'test',
      genre: 'test',
      createdAt: '',
      updatedAt: '',
    }));
    await store.writeFile('world/README.md', '---\nname: Map\ntype: readme\n---\n\n# Map\n');
    await fs.writeFile(path.join(root, 'assets/fake.png'), '<html>nope</html>');
    const ctx = { store, actor: { type: 'god' }, turn: 'turn:media' };

    await invalid(() => createEntity(ctx, {
      path: 'world/invalid-photo.md',
      frontmatter: { type: 'component', component: 'photo', image: 'assets/fake.png' },
      body: 'bad',
    }));
    assert.equal(await store.statKind('world/invalid-photo.md'), 'missing');
    assert.equal((await store.getEvents(20)).length, 0);

    await createEntity(ctx, {
      path: 'world/photo.md',
      frontmatter: { type: 'component', component: 'photo', image: 'assets/photo.png' },
      body: 'good',
    });
    const before = await store.readFile('world/photo.md');
    await invalid(() => editEntity(ctx, {
      path: 'world/photo.md',
      frontmatter: { image: 'assets/fake.png' },
    }));
    assert.equal(await store.readFile('world/photo.md'), before);
    assert.equal((await store.getEvents(20)).length, 1);
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

// T14: the two lanes must not cross. `.html` is under no
// published asset root, so the ASSET policy rejects it even on the image lane,
// while the WORLD-FILE policy accepts the very same path.
test('world-file lane and asset lane are isolated on the same .html path', async () => {
  const root = await fixture();
  try {
    await fs.mkdir(path.join(root, 'world/a'), { recursive: true });
    await fs.writeFile(path.join(root, 'world/a/x.html'), '<!DOCTYPE html><title>X</title>');
    await invalid(() => assertAssetReference(root, 'world/a/x.html', 'image'));
    await invalid(() => assertAssetReference(root, 'world/a/x.html', 'video'));
    await invalid(() => assertAssetReference(root, 'world/a/x.html', 'audio'));

    const inspected = await assertWorldFileReference(root, 'world/a/x.html');
    assert.equal(inspected.mimeType, 'text/html; charset=utf-8');

    // The policies also exclude each other's territory: an asset path stays
    // out of the world-file lane because of its extension, not its root.
    await assert.rejects(
      () => assertWorldFileReference(root, 'assets/photo.png'),
      (error) => {
        assert.ok(error instanceof ActionError);
        assert.equal(error.code, 'invalid_asset_ref');
        assert.equal(error.details.reason, 'extension');
        return true;
      },
    );
    // A `.html` under an approved asset root is served by the world-file lane
    // (the root policy allows any position) but never by the asset lanes.
    await fs.writeFile(path.join(root, 'assets/page.html'), '<title>Asset page</title>');
    await invalid(() => assertAssetReference(root, 'assets/page.html', 'image'));
    assert.equal(
      (await assertWorldFileReference(root, 'assets/page.html')).mimeType,
      'text/html; charset=utf-8',
    );

    // R1/R3 guard: `isAllowedMediaReference` keeps its 1-arg shape AND still
    // uses the asset policy, so a world file is not a legal "media reference".
    assert.equal(isAllowedMediaReference('world/a/x.html'), false);
    assert.equal(isAllowedMediaReference('assets/page.html'), true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
