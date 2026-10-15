// Image compression: the converter, the world
// pass and generate_image's entry. Runs against built dist
// (`pnpm --filter @airp/shared build`); fixtures are made with sharp, the
// optional dependency the Node encoder uses.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import sharp from 'sharp';
import {
  IMAGE_POLICY,
  compressImage,
  compressWorldImages,
  fitWithin,
  imageRoleForPath,
  readImageInfo,
  referencePattern,
  registerImageEncoder,
  rewriteReferences,
} from '../dist/media/index.js';
import {
  GENERATED_ASSET_DIR,
  LocalWorldStore,
  generateImage,
  registerImageProviderFactory,
  resetImageProviderForTests,
} from '../dist/index.js';

/** Noise compresses badly: a realistic stand-in for a painted picture's size. */
function noise(width, height, { alpha = false, format = 'png', seed = 7 } = {}) {
  const channels = alpha ? 4 : 3;
  const raw = Buffer.alloc(width * height * channels);
  let x = seed;
  for (let i = 0; i < raw.length; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    // Smooth-ish noise: neighbours share bits, so encoders behave like on art, not on static.
    raw[i] = ((x >> 16) & 0x3f) + ((i / channels / width) | 0) % 128;
  }
  if (alpha) for (let i = 3; i < raw.length; i += 4) raw[i] = (i / 4) % width < width / 2 ? 0 : 255;
  const img = sharp(raw, { raw: { width, height, channels } });
  return (format === 'jpeg' ? img.jpeg({ quality: 95 }) : format === 'webp' ? img.webp({ quality: 100 }) : img.png({ compressionLevel: 1 })).toBuffer();
}

test('readImageInfo reads size, alpha and format from the header alone', async () => {
  const png = await noise(64, 32);
  assert.deepEqual(readImageInfo(png), { format: 'png', width: 64, height: 32, alpha: false, animated: false });
  assert.equal(readImageInfo(await noise(16, 16, { alpha: true })).alpha, true);
  assert.deepEqual(readImageInfo(await noise(40, 30, { format: 'jpeg' })), { format: 'jpeg', width: 40, height: 30, alpha: false, animated: false });
  const webp = readImageInfo(await noise(50, 20, { format: 'webp' }));
  assert.deepEqual([webp.format, webp.width, webp.height], ['webp', 50, 20]);
  const alphaWebp = readImageInfo(await sharp(await noise(20, 20, { alpha: true })).webp().toBuffer());
  assert.equal(alphaWebp.alpha, true);
  assert.equal(readImageInfo(Buffer.from('not-really-a-png-but-bytes')), null);
  assert.equal(readImageInfo(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')).width, 1);
});

test('roles come from the path; caps keep the aspect and never upscale', () => {
  assert.equal(imageRoleForPath('assets/maps/harbor.png'), 'map');
  assert.equal(imageRoleForPath('assets/characters/po/smile.webp'), 'portrait');
  assert.equal(imageRoleForPath('characters/po/README.md'), 'portrait');
  assert.equal(imageRoleForPath('assets/items/key.webp'), 'portrait');
  assert.equal(imageRoleForPath('assets/tokens/door.png'), 'token');
  assert.equal(imageRoleForPath('assets/elias/office/portrait.png'), 'portrait');
  assert.equal(imageRoleForPath('assets/scenes/intro.png'), 'scene');
  assert.equal(imageRoleForPath(undefined), 'scene');
  assert.deepEqual(fitWithin(4000, 2000, 2048), { width: 2048, height: 1024 });
  assert.deepEqual(fitWithin(500, 300, 2048), { width: 500, height: 300 });
});

test('compressImage: an oversized PNG becomes a capped WebP; the aspect is kept', async () => {
  const png = await noise(2400, 1200);
  const out = await compressImage(png, { role: 'scene' });
  assert.equal(out.changed, true);
  assert.equal(out.reason, 'resized');
  assert.equal(out.mimeType, 'image/webp');
  assert.equal(out.ext, 'webp');
  assert.deepEqual([out.width, out.height], [IMAGE_POLICY.longEdge.scene, 960]);
  assert.ok(out.bytes.length < png.length / 3, `${out.bytes.length} vs ${png.length}`);
  const map = await compressImage(await noise(2400, 1200), { path: 'assets/maps/a.png' });
  assert.equal(map.width, 2048);
  const portrait = await compressImage(await noise(1024, 1536), { role: 'portrait' });
  assert.deepEqual([portrait.width, portrait.height], [683, 1024]);
});

test('compressImage never upscales: a small-dimension picture keeps its pixels', async () => {
  const png = await noise(600, 400);
  const out = await compressImage(png, { role: 'map' });
  assert.equal(out.changed, true);
  assert.equal(out.reason, 'converted');
  assert.deepEqual([out.width, out.height], [600, 400]);
});

test('compressImage keeps alpha (cutout portraits)', async () => {
  const out = await compressImage(await noise(1600, 1600, { alpha: true }), { role: 'portrait' });
  assert.equal(out.changed, true);
  assert.equal(readImageInfo(out.bytes).alpha, true);
  const { channels, hasAlpha } = await sharp(out.bytes).metadata();
  assert.equal(hasAlpha, true);
  assert.equal(channels, 4);
  const corner = await sharp(out.bytes).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer();
  assert.equal(corner[3], 0, 'the transparent half stays transparent');
});

test('compressImage leaves small files, compact WebP, GIF and non-images alone', async () => {
  const tiny = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#336' } }).png().toBuffer();
  assert.ok(tiny.length <= IMAGE_POLICY.smallBytes);
  assert.equal((await compressImage(tiny)).reason, 'small');
  const compact = await sharp(await noise(1200, 800)).webp({ quality: 60 }).toBuffer();
  assert.equal((await compressImage(compact)).reason, 'compact');
  assert.equal((await compressImage(Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;', 'latin1'))).reason, 'unsupported');
  const junk = Buffer.from('not an image at all');
  const kept = await compressImage(junk);
  assert.equal(kept.changed, false);
  assert.equal(kept.bytes, junk);
});

test('compressImage is idempotent: its own output passes through unchanged', async () => {
  for (const [w, h, role] of [[2400, 1200, 'scene'], [900, 700, 'map'], [1500, 1500, 'portrait']]) {
    const once = await compressImage(await noise(w, h), { role });
    assert.equal(once.changed, true);
    const twice = await compressImage(once.bytes, { role });
    assert.equal(twice.changed, false, `${w}x${h} ${role}: ${twice.reason}`);
  }
});

test('compressImage without an encoder, or with one that declines or fails, stores the original', async () => {
  const png = await noise(2400, 1200);
  try {
    registerImageEncoder(null);
    const none = await compressImage(png);
    assert.deepEqual([none.changed, none.reason, none.bytes], [false, 'no-encoder', png]);
  } finally {
    registerImageEncoder(undefined);
  }
  assert.equal((await compressImage(png, { encoder: { id: 'no', encode: async () => null } })).reason, 'declined');
  assert.equal((await compressImage(png, { encoder: { id: 'boom', encode: async () => { throw new Error('x'); } } })).reason, 'declined');
  // A canvas fallback that dropped the alpha (JPEG) is refused.
  const rgba = await noise(1600, 1600, { alpha: true });
  const jpeg = await sharp(rgba).flatten().jpeg().toBuffer();
  assert.equal((await compressImage(rgba, { encoder: { id: 'safari', encode: async () => ({ bytes: jpeg, mimeType: 'image/jpeg' }) } })).reason, 'declined');
  // Bytes that are not what the encoder claims are refused too.
  assert.equal((await compressImage(png, { encoder: { id: 'liar', encode: async () => ({ bytes: Buffer.from('x'.repeat(40)), mimeType: 'image/webp' }) } })).reason, 'declined');
});

test('the browser hook on globalThis is used when present, and gets the cap and alpha', async () => {
  const seen = [];
  const webp = await sharp(await noise(100, 50)).webp().toBuffer();
  globalThis.__airpImageEncoder = { id: 'canvas', encode: async (input, o) => { seen.push(o); return { bytes: webp, mimeType: 'image/webp' }; } };
  try {
    const out = await compressImage(await noise(3000, 1500), { role: 'map' });
    assert.equal(out.changed, true);
    assert.equal(seen.length, 1);
    assert.deepEqual([seen[0].width, seen[0].height, seen[0].maxEdge, seen[0].format, seen[0].quality, seen[0].alpha], [2048, 1024, 2048, 'webp', 80, false]);
  } finally {
    delete globalThis.__airpImageEncoder;
  }
});

test('references: whole world-relative paths only, ./ kept, longer names untouched', () => {
  const text = [
    'bg: assets/scenes/intro.png',
    'cover: "./assets/scenes/intro.png"',
    'demo/assets/scenes/intro.png',
    'assets/scenes/intro.png.bak',
    'assets/scenes/intro.png-old',
    'see `intro.png`',
    '![x](assets/scenes/intro.png).',
  ].join('\n');
  const out = rewriteReferences(text, 'assets/scenes/intro.png', 'assets/scenes/intro.webp');
  assert.equal(out, [
    'bg: assets/scenes/intro.webp',
    'cover: "./assets/scenes/intro.webp"',
    'demo/assets/scenes/intro.png',
    'assets/scenes/intro.png.bak',
    'assets/scenes/intro.png-old',
    'see `intro.png`',
    '![x](assets/scenes/intro.webp).',
  ].join('\n'));
  assert.equal(referencePattern('assets/a.png').test('x assets/a.png'), true);
  assert.equal(referencePattern('assets/a.png').test('x assets/a.pngx'), false);
});

async function worldDir() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-images-'));
  const w = (rel, data) => fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true }).then(() => fs.writeFile(path.join(root, rel), data));
  await w('world.json', JSON.stringify({ id: 'made-0000aaaa', cover: 'assets/scenes/intro.png', characters: [{ id: 'po', avatar: 'assets/characters/po.png' }] }, null, 2));
  await w('world/README.md', '---\ntype: readme\nbg: assets/scenes/intro.png\nmap:\n  plan:\n    picture: assets/maps/village.jpg\n---\n\nSee intro.png for the mood.\n');
  await w('characters/po/README.md', '---\nname: Po\navatar: assets/characters/po.png\n---\n\nPo.\n');
  await w('.airpworld/assets/gen/well-0123456789abcdef.png', await noise(1024, 1024));
  await w('world/well/README.md', '---\nbg: .airpworld/assets/gen/well-0123456789abcdef.png\n---\n');
  await w('assets/scenes/intro.png', await noise(2400, 1600));
  await w('assets/maps/village.jpg', await noise(3000, 2000, { format: 'jpeg' }));
  await w('assets/characters/po.png', await noise(1200, 1800, { alpha: true }));
  // Found by convention only (no text names it): resized, but keeps its name and format.
  await w('assets/tokens/door.png', await noise(1500, 1500));
  await w('assets/characters/po/smile.webp', await noise(1600, 1600, { format: 'webp' }));
  // Small and already fine.
  await w('assets/scenes/note.png', await sharp({ create: { width: 64, height: 64, channels: 3, background: '#fff' } }).png().toBuffer());
  // Runtime state is never touched.
  await w('.airpworld/history.json', '{"bg":"assets/scenes/intro.png"}');
  return root;
}

test('compressWorldImages: referenced pictures become .webp and every reference follows', async () => {
  const root = await worldDir();
  const plan = await compressWorldImages(root, { dryRun: true });
  assert.equal(plan.changes.length, 6);
  assert.ok(await fs.stat(path.join(root, 'assets/scenes/intro.png')), 'a dry run writes nothing');

  const report = await compressWorldImages(root);
  const byPath = Object.fromEntries(report.changes.map((c) => [c.path, c]));
  assert.equal(byPath['assets/scenes/intro.png'].to, 'assets/scenes/intro.webp');
  assert.equal(byPath['assets/scenes/intro.png'].role, 'scene', 'the cover that is also a bg keeps the scene cap');
  assert.equal(byPath['assets/maps/village.jpg'].to, 'assets/maps/village.webp');
  assert.equal(byPath['.airpworld/assets/gen/well-0123456789abcdef.png'].to, '.airpworld/assets/gen/well-0123456789abcdef.webp');
  assert.equal(byPath['assets/tokens/door.png'].to, 'assets/tokens/door.png');
  assert.equal(byPath['assets/characters/po/smile.webp'].to, 'assets/characters/po/smile.webp');
  assert.ok(report.bytesAfter < report.bytesBefore / 3);

  const manifest = JSON.parse(await fs.readFile(path.join(root, 'world.json'), 'utf8'));
  assert.equal(manifest.cover, 'assets/scenes/intro.webp');
  assert.equal(manifest.characters[0].avatar, 'assets/characters/po.webp');
  const readme = await fs.readFile(path.join(root, 'world/README.md'), 'utf8');
  assert.match(readme, /bg: assets\/scenes\/intro\.webp/);
  assert.match(readme, /picture: assets\/maps\/village\.webp/);
  assert.match(readme, /See intro\.png for the mood\./, 'prose that only names the file is not a reference');
  assert.match(await fs.readFile(path.join(root, 'world/well/README.md'), 'utf8'), /bg: \.airpworld\/assets\/gen\/well-0123456789abcdef\.webp/);
  assert.match(await fs.readFile(path.join(root, 'characters/po/README.md'), 'utf8'), /avatar: assets\/characters\/po\.webp/);
  assert.equal(await fs.readFile(path.join(root, '.airpworld/history.json'), 'utf8'), '{"bg":"assets/scenes/intro.png"}');

  // Every reference resolves; the old files are gone; formats and caps are right.
  for (const rel of ['assets/scenes/intro.webp', 'assets/maps/village.webp', 'assets/characters/po.webp', '.airpworld/assets/gen/well-0123456789abcdef.webp']) {
    assert.equal(readImageInfo(await fs.readFile(path.join(root, rel))).format, 'webp', rel);
  }
  await assert.rejects(fs.stat(path.join(root, 'assets/scenes/intro.png')));
  const door = readImageInfo(await fs.readFile(path.join(root, 'assets/tokens/door.png')));
  assert.deepEqual([door.format, door.width], ['png', IMAGE_POLICY.longEdge.token]);
  const po = readImageInfo(await fs.readFile(path.join(root, 'assets/characters/po.webp')));
  assert.deepEqual([po.height, po.alpha], [1024, true]);
  assert.equal(readImageInfo(await fs.readFile(path.join(root, 'assets/maps/village.webp'))).width, 2048);

  // Idempotent.
  const again = await compressWorldImages(root);
  assert.deepEqual(again.changes, []);
});

test('a cover used only as the cover gets the cover cap', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-cover-'));
  await fs.mkdir(path.join(root, 'assets'), { recursive: true });
  await fs.writeFile(path.join(root, 'world.json'), JSON.stringify({ cover: 'assets/cover.png' }));
  await fs.writeFile(path.join(root, 'assets/cover.png'), await noise(2400, 1600));
  const report = await compressWorldImages(root);
  assert.equal(report.changes[0].role, 'cover');
  assert.equal(readImageInfo(await fs.readFile(path.join(root, 'assets/cover.webp'))).width, IMAGE_POLICY.longEdge.cover);
});

test('generate_image stores the compressed WebP under .airpworld/assets/gen', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-gen-'));
  const store = new LocalWorldStore(root);
  const png = await noise(1536, 1024);
  registerImageProviderFactory(() => ({ id: 'fake', model: 'm', supportsReference: false, async generate() { return { ok: true, mimeType: 'image/png', dataB64: png.toString('base64') }; } }));
  try {
    const out = await generateImage({ store, actor: { type: 'writer' }, turn: 'turn:test:1' }, { prompt: 'a harbour', width: 1536, height: 1024 });
    assert.match(out.details.asset, new RegExp(`^${GENERATED_ASSET_DIR}/a-harbour-[0-9a-f]{16}\\.webp$`));
    assert.equal(out.details.mimeType, 'image/webp');
    const stored = await fs.readFile(path.join(root, out.details.asset));
    assert.equal(out.details.bytes, stored.length);
    assert.ok(stored.length < png.length / 3);
    assert.deepEqual([readImageInfo(stored).width, readImageInfo(stored).height], [1536, 1024], 'within the cap: never upscaled, not shrunk');
    const again = await generateImage({ store, actor: { type: 'writer' }, turn: 'turn:test:2' }, { prompt: 'a harbour', width: 1536, height: 1024 });
    assert.equal(again.details.reused, true);
    assert.equal(again.details.asset, out.details.asset);
  } finally {
    resetImageProviderForTests();
    await fs.rm(root, { recursive: true, force: true });
  }
});
