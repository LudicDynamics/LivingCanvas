// Audio wiring A1 — server route + resolver assertions.
// Runs against built dist: `pnpm build` first.
// Groups A (resolve), B (traversal), C (layer shape), D (bgStyle regression),
// F (manifest), G (degradation), I (layer inheritance tri-state).
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

/**
 * Resolved audio URLs carry `&h=<content hash>` once the file's hash is known
 * — platform clips are hashed in the background, so
 * whether a given call already has it is timing. The resolution rules below
 * compare the URL without it; the hash itself is pinned in its own test.
 */
const noHash = (url) => (typeof url === 'string' ? url.replace(/&h=[0-9a-f]{32}$/, '') : url);

const LAYER = (fields) => `---\nname: Baker Street\ntype: readme\n${fields}---\n\n# Baker Street\n`;

/** Temp repo root carrying a platform `assets/audio/**` pool + a temp world. */
async function harness({ readme, mapReadme, manifest, loadable = false } = {}) {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-audio-repo-'));
  const world = path.join(repo, 'world-root');
  // Includes ambient/rain.mp3: the I-group inherits `ambient: rain` from the map
  // layer; without the file the bare name resolves to null and I1/I5/I7 fail
  // while I3 stops discriminating the `??` bug (review finding).
  for (const rel of ['bgm/calm.mp3', 'bgm/tense.mp3', 'themes/whitechapel.mp3',
                     'ambient/rain.mp3', 'ambient/fireplace.mp3',
                     'ambient/pool/storm.mp3', 'foley/page-turn.mp3']) {
    const abs = path.join(repo, 'assets/audio', rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, 'ID3');
  }
  const store = new LocalWorldStore(world);
  await store.writeFile('world.json', JSON.stringify(manifest ?? {
    id: 'p', name: 'P', description: '', author: '', genre: 'test',
    createdAt: '', updatedAt: '',
  }));
  await store.writeFile('world/README.md', mapReadme ?? '---\nname: Map\ntype: readme\n---\n\n# Map\n');
  if (readme) await store.writeFile('world/baker-street/README.md', readme);

  const lifecycle = { isModelSwitching: () => false, beginWorldTransition() {}, completeWorldTransition() {}, stopCharacters: async () => {}, startWriter: async () => {}, stopAll: async () => {} };
  const app = express();
  app.use(express.json());
  let active = store;
  const bridge = loadable ? { startTailReader() {}, watchWorld() {} } : new EventBridge();
  app.use('/api', createWorldRouter(repo, lifecycle, bridge, () => active, next => { active = next; }));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  return {
    base, repo, world, store,
    close: async () => {
      server.close();
      try { active.close(); } catch {}
      await fs.rm(repo, { recursive: true, force: true });
    },
  };
}

test('/asset requires an explicit media kind and keeps image/video/audio lanes distinct', async () => {
  const h = await harness();
  try {
    await fs.mkdir(path.join(h.world, 'assets/media'), { recursive: true });
    await fs.writeFile(path.join(h.world, 'assets/media/photo.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
    await fs.writeFile(path.join(h.world, 'assets/media/clip.webm'), 'WEBM');
    await fs.writeFile(path.join(h.world, 'assets/media/clip.mp3'), 'ID3');

    assert.equal((await fetch(`${h.base}/asset?path=assets%2Fmedia%2Fphoto.png`)).status, 400);
    const image = await fetch(`${h.base}/asset?path=assets%2Fmedia%2Fphoto.png&kind=image`);
    assert.equal(image.status, 200);
    assert.match(image.headers.get('content-type') ?? '', /^image\/png/);
    const video = await fetch(`${h.base}/asset?path=assets%2Fmedia%2Fclip.webm&kind=video`);
    assert.equal(video.status, 200);
    assert.match(video.headers.get('content-type') ?? '', /^video\/webm/);
    assert.equal((await fetch(`${h.base}/asset?path=assets%2Fmedia%2Fclip.mp3&kind=image`)).status, 403);
    assert.equal((await fetch(`${h.base}/asset?path=assets%2Fmedia%2Fmissing.png&kind=image`)).status, 404);
  } finally {
    await h.close();
  }
});

// ── A 组：裸名 / assets/ 解析与覆盖链 ──
test('world load and manifest both return the resolved theme URL', async () => {
  const h = await harness({ loadable: true, manifest: {
    id: 'theme-save', name: 'Theme Save', description: '', author: '', genre: 'test',
    createdAt: '', updatedAt: '', audio: { theme: 'whitechapel' },
  } });
  try {
    const response = await fetch(`${h.base}/worlds/load`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ worldPath: h.world }) });
    assert.equal(response.status, 200);
    const loaded = await response.json();
    const manifest = await (await fetch(`${h.base}/manifest`)).json();
    assert.equal(noHash(loaded.manifest.audio.theme), '/api/audio?path=themes%2Fwhitechapel.mp3');
    assert.equal(noHash(loaded.manifest.audio.theme), noHash(manifest.audio.theme));
  } finally { await h.close(); }
});

test('A1 裸名常驻床 → /api/audio', async () => {
  const h = await harness({ readme: LAYER('ambient: fireplace\n') });
  const l = await (await fetch(`${h.base}/layer?layer=world/baker-street`)).json();
  assert.equal(noHash(l.audio.ambient), '/api/audio?path=ambient%2Ffireplace.mp3');
  await h.close();
});

test('A2 裸名池命中第二候选', async () => {
  const h = await harness({ readme: LAYER('ambient: storm\n') });
  const l = await (await fetch(`${h.base}/layer?layer=world/baker-street`)).json();
  assert.equal(noHash(l.audio.ambient), '/api/audio?path=ambient%2Fpool%2Fstorm.mp3');
  await h.close();
});

test('A3 裸名全落空 → null', async () => {
  const h = await harness({ readme: LAYER('ambient: nonexistent\n') });
  const l = await (await fetch(`${h.base}/layer?layer=world/baker-street`)).json();
  assert.equal(noHash(l.audio.ambient), null);
  await h.close();
});

test('A4 bgm 裸名 → /api/audio', async () => {
  const h = await harness({ readme: LAYER('bgm: tense\n') });
  const l = await (await fetch(`${h.base}/layer?layer=world/baker-street`)).json();
  assert.equal(noHash(l.audio.bgm), '/api/audio?path=bgm%2Ftense.mp3');
  await h.close();
});

test('A5a assets/ 直取 + 世界无此文件 → null', async () => {
  const h = await harness({ readme: LAYER('ambient: "assets/audio/rain.mp3"\n') });
  const l = await (await fetch(`${h.base}/layer?layer=world/baker-street`)).json();
  assert.equal(noHash(l.audio.ambient), null);
  await h.close();
});

test('A5b assets/ 直取 + 世界文件存在 → /api/asset', async () => {
  const h = await harness({ readme: LAYER('ambient: "assets/audio/rain.mp3"\n') });
  const abs = path.join(h.world, 'assets/audio/rain.mp3');
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, 'ID3');
  const l = await (await fetch(`${h.base}/layer?layer=world/baker-street`)).json();
  assert.equal(noHash(l.audio.ambient), `/api/asset?path=${encodeURIComponent('assets/audio/rain.mp3')}&kind=audio`);
  await h.close();
});

test('A6 违约值（含 / 但非 assets/）→ null', async () => {
  const h = await harness({ readme: LAYER('bgm: "bgm/calm.mp3"\n') });
  const l = await (await fetch(`${h.base}/layer?layer=world/baker-street`)).json();
  assert.equal(noHash(l.audio.bgm), null);
  await h.close();
});

// ── 覆盖链核心（用户需求：世界级覆盖/平台级增强） ──
test('A7 世界同名覆盖 → /api/asset；删后 → 平台 /api/audio', async () => {
  const h = await harness({ readme: LAYER('ambient: fireplace\n') });
  const worldFile = path.join(h.world, 'assets/audio/ambient/fireplace.mp3');
  await fs.mkdir(path.dirname(worldFile), { recursive: true });
  await fs.writeFile(worldFile, 'ID3');
  let l = await (await fetch(`${h.base}/layer?layer=world/baker-street`)).json();
  assert.equal(noHash(l.audio.ambient), `/api/asset?path=${encodeURIComponent('assets/audio/ambient/fireplace.mp3')}&kind=audio`, '世界级覆盖平台');
  await fs.rm(worldFile);
  l = await (await fetch(`${h.base}/layer?layer=world/baker-street`)).json();
  assert.equal(noHash(l.audio.ambient), '/api/audio?path=ambient%2Ffireplace.mp3', '平台级兜底');
  await h.close();
});

test('A8 层级序：世界第二候选胜平台第一候选（level-major）', async () => {
  const h = await harness({ readme: LAYER('ambient: storm\n') });
  const worldPool = path.join(h.world, 'assets/audio/ambient/pool/storm.mp3');
  await fs.mkdir(path.dirname(worldPool), { recursive: true });
  await fs.writeFile(worldPool, 'ID3');
  const l = await (await fetch(`${h.base}/layer?layer=world/baker-street`)).json();
  assert.equal(noHash(l.audio.ambient), `/api/asset?path=${encodeURIComponent('assets/audio/ambient/pool/storm.mp3')}&kind=audio`);
  await h.close();
});

// ── B 组：/api/audio 防穿越 ──
test('B1 正常素材 200 + immutable', async () => {
  const h = await harness();
  const r = await fetch(`${h.base}/audio?path=ambient%2Ffireplace.mp3`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('cache-control') ?? '', /immutable/);
  await h.close();
});

test('B2 不存在 → 404', async () => {
  const h = await harness();
  assert.equal((await fetch(`${h.base}/audio?path=ambient%2Fnope.mp3`)).status, 404);
  await h.close();
});

test('B3 .. 穿越 → 403；前导斜杠 → 404', async () => {
  const h = await harness();
  assert.equal((await fetch(`${h.base}/audio?path=..%2F..%2F..%2Fetc%2Fpasswd`)).status, 403);
  const lead = await fetch(`${h.base}/audio?path=%2Fetc%2Fpasswd`);
  assert.notEqual(lead.status, 200);
  await h.close();
});

test('B4 无 path → 400', async () => {
  const h = await harness();
  assert.equal((await fetch(`${h.base}/audio`)).status, 400);
  await h.close();
});

// ── C 组：/api/layer 形状 ──
test('C1 audio 顶层存在，仅 ambient/bgm；bg 形状不变', async () => {
  const h = await harness({ readme: LAYER('bgStyle:\n  tone: warm\n  grain: parchment\n') });
  const l = await (await fetch(`${h.base}/layer?layer=map`)).json();
  assert.deepEqual(Object.keys(l.audio).sort(), ['ambient', 'bgm']);
  assert.ok('src' in l.bg && 'tone' in l.bg && 'grain' in l.bg);
  await h.close();
});

test('C2 缺省声明 → {ambient:null,bgm:null} HTTP 200', async () => {
  const h = await harness();
  const r = await fetch(`${h.base}/layer?layer=world/baker-street`);
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).audio, { ambient: null, bgm: null });
  await h.close();
});

// ── D 组：bgStyle 结构化回归（裸正则 bug 面） ──
test('D1 正文缩进 tone: 不污染 bg.tone', async () => {
  const h = await harness({ readme: LAYER('bgStyle:\n  tone: warm\n  grain: parchment\n') + '  tone: uneasy\n' });
  const l = await (await fetch(`${h.base}/layer?layer=world/baker-street`)).json();
  assert.equal(l.bg.tone, 'warm');
  assert.equal(l.bg.grain, 'parchment');
  await h.close();
});

// ── F 组：manifest theme ──
test('F1 manifest theme 解析为 URL', async () => {
  const h = await harness({ manifest: { id: 'p', name: 'P', description: '', author: '', genre: 'test', createdAt: '', updatedAt: '', audio: { theme: 'whitechapel' } } });
  const m = await (await fetch(`${h.base}/manifest`)).json();
  assert.equal(noHash(m.audio.theme), '/api/audio?path=themes%2Fwhitechapel.mp3');
  await h.close();
});

test('F1b 归乡 theme: the shipped themes/guixiang.mp3 resolves and is served', async () => {
  const shipped = new URL('../../../assets/audio/themes/guixiang.mp3', import.meta.url);
  const h = await harness({ manifest: { id: 'p', name: 'P', description: '', author: '', genre: 'test', createdAt: '', updatedAt: '', audio: { theme: 'guixiang' } } });
  await fs.copyFile(shipped, path.join(h.repo, 'assets/audio/themes/guixiang.mp3'));
  const m = await (await fetch(`${h.base}/manifest`)).json();
  assert.equal(noHash(m.audio.theme), '/api/audio?path=themes%2Fguixiang.mp3');
  const res = await fetch(`${h.base}${m.audio.theme.slice('/api'.length)}`);
  assert.equal(res.status, 200);
  assert.ok((await res.arrayBuffer()).byteLength > 100_000, 'the real track, not a stub');
  await h.close();
});

test('F2 无 theme → null', async () => {
  const h = await harness();
  const m = await (await fetch(`${h.base}/manifest`)).json();
  assert.equal(noHash(m.audio.theme), null);
  await h.close();
});

// ── G 组：降级 ──
test('G1 世界路径不存在 → null（直取，不试平台同名）', async () => {
  const h = await harness({ readme: LAYER('ambient: "assets/audio/tense.mp3"\n') });
  const l = await (await fetch(`${h.base}/layer?layer=world/baker-street`)).json();
  assert.equal(noHash(l.audio.ambient), null);
  await h.close();
});

// ── I 组：层继承三态 ──
const MAP_RAIN = '---\nname: Map\ntype: readme\nambient: rain\n---\n\n# Map\n';

test('I1 键不存在 → 继承 map（逐字段）', async () => {
  const h = await harness({ mapReadme: MAP_RAIN, readme: LAYER('bgm: calm\n') });
  const l = await (await fetch(`${h.base}/layer?layer=world/baker-street`)).json();
  assert.equal(noHash(l.audio.ambient), '/api/audio?path=ambient%2Frain.mp3');
  assert.equal(noHash(l.audio.bgm), '/api/audio?path=bgm%2Fcalm.mp3');
  await h.close();
});

test('I2 两层都未声明 → null', async () => {
  const h = await harness({ readme: LAYER('') });
  const l = await (await fetch(`${h.base}/layer?layer=world/baker-street`)).json();
  assert.deepEqual(l.audio, { ambient: null, bgm: null });
  await h.close();
});

test('I3 键存在但解析落空 → null（不回退；且能区分 ?? bug）', async () => {
  const h = await harness({ mapReadme: MAP_RAIN, readme: LAYER('ambient: nonexistent\n') });
  const l = await (await fetch(`${h.base}/layer?layer=world/baker-street`)).json();
  assert.equal(noHash(l.audio.ambient), null);
  await h.close();
});

test('I3b 键存在且字面 null → null（显式静音）', async () => {
  const h = await harness({ mapReadme: MAP_RAIN, readme: LAYER('ambient: null\n') });
  const l = await (await fetch(`${h.base}/layer?layer=world/baker-street`)).json();
  assert.equal(noHash(l.audio.ambient), null);
  await h.close();
});

test('I4 bgm 键不存在→继承；ambient own 保留（两字段独立）', async () => {
  const h = await harness({ mapReadme: '---\nname: Map\ntype: readme\nbgm: calm\n---\n\n# Map\n', readme: LAYER('ambient: fireplace\n') });
  const l = await (await fetch(`${h.base}/layer?layer=world/baker-street`)).json();
  assert.equal(noHash(l.audio.bgm), '/api/audio?path=bgm%2Fcalm.mp3');
  assert.equal(noHash(l.audio.ambient), '/api/audio?path=ambient%2Ffireplace.mp3');
  await h.close();
});

test('I5 map 层自身不回退', async () => {
  const h = await harness({ mapReadme: MAP_RAIN });
  const l = await (await fetch(`${h.base}/layer?layer=map`)).json();
  assert.equal(noHash(l.audio.ambient), '/api/audio?path=ambient%2Frain.mp3');
  assert.equal(noHash(l.audio.bgm), null);
  await h.close();
});

test('I6 map README 缺失 → 保持 own，不 500', async () => {
  const h = await harness({ readme: LAYER('ambient: fireplace\n') });
  await fs.rm(path.join(h.world, 'world/README.md'));
  const r = await fetch(`${h.base}/layer?layer=world/baker-street`);
  assert.equal(r.status, 200);
  assert.equal(noHash((await r.json()).audio.ambient), '/api/audio?path=ambient%2Ffireplace.mp3');
  await h.close();
});

test('resolved audio URLs gain the content hash of the file once it is known', async () => {
  const h = await harness({ readme: LAYER('ambient: fireplace\nbgm: assets/audio/own.mp3\n') });
  try {
    await h.store.writeFile('assets/audio/own.mp3', 'own bytes');
    const { createHash } = await import('node:crypto');
    const sha = (data) => createHash('sha256').update(data).digest('hex').slice(0, 32);
    // The world's own file is hashed by the index; platform clips by the background warm-up.
    const index = await (await fetch(`${h.base}/asset-index`)).json();
    assert.equal(index.files['assets/audio/own.mp3'], sha('own bytes'));
    let audio = null;
    for (let i = 0; i < 50; i++) {
      audio = (await (await fetch(`${h.base}/layer?layer=world/baker-street`)).json()).audio;
      if (/&h=/.test(audio.ambient ?? '')) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(audio.ambient, `/api/audio?path=ambient%2Ffireplace.mp3&h=${sha('ID3')}`);
    assert.equal(audio.bgm, `/api/asset?path=${encodeURIComponent('assets/audio/own.mp3')}&kind=audio&h=${sha('own bytes')}`);
    // The served clip answers immutable for its own hash and never pins a stale one.
    const fresh = await fetch(`${h.base}/asset?path=${encodeURIComponent('assets/audio/own.mp3')}&kind=audio&h=${sha('own bytes')}`);
    assert.match(fresh.headers.get('cache-control'), /^private, max-age=31536000, immutable$/);
    const stale = await fetch(`${h.base}/asset?path=${encodeURIComponent('assets/audio/own.mp3')}&kind=audio&h=${'0'.repeat(32)}`);
    assert.equal(stale.headers.get('cache-control'), 'no-cache');
    assert.equal((await fetch(`${h.base}/audio?path=ambient%2Ffireplace.mp3&h=${'0'.repeat(32)}`)).headers.get('cache-control'), 'no-cache');
    assert.match((await fetch(`${h.base}/audio?path=ambient%2Ffireplace.mp3`)).headers.get('cache-control'), /immutable/, 'no h: the old year-long rule');
  } finally { await h.close(); }
});
