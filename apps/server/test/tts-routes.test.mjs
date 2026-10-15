// TTS batch — /api/tts + /api/tts/audio server assertions.
// Runs against built dist: `pnpm build` first.
// Groups A (cache/atomic write), B (truncation), C (voice+language mapping),
// D (unconfigured / no world), E (anti-traversal), F (empty text), G (wav magic).
//
// DashScope is REPLACED by a local stub: 01's readTtsConfig() reads the 5 env
// vars PER REQUEST (not at module top level), so setting AIRP_TTS_BASE_URL after
// import redirects all synthesis to the stub.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { test } from 'node:test';
import { LocalWorldStore } from '@airp/shared';
import { createTtsRouter, hashOf } from '../dist/routes/tts.js';

const MODEL = 'qwen3-tts-flash-2025-11-27';
const DEFAULT_VOICE = 'Cherry';
const WAV = Buffer.from('RIFF\x24\x00\x00\x00WAVEfmt '); // a distinct fake blob
const savePathByApiBase = new Map();

/** Stub DashScope: captures POST bodies, serves a fake OSS blob. */
async function dashStub({ status = 200, blob = WAV } = {}) {
  const calls = [];
  const server = http.createServer((req, res) => {
    if (req.url.includes('/services/aigc/multimodal-generation/generation')) {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        calls.push({ auth: req.headers.authorization, body: JSON.parse(raw) });
        res.setHeader('content-type', 'application/json');
        if (status !== 200) {
          res.statusCode = status;
          res.end(JSON.stringify({ status_code: status, code: 'InvalidApiKey', message: 'stub' }));
          return;
        }
        res.end(JSON.stringify({
          status_code: 200, request_id: 'stub',
          output: { audio: { id: 'a', url: `http://127.0.0.1:${server.address().port}/blob/out.wav`, data: '', expires_at: 0 } },
          usage: { characters: 1 },
        }));
      });
      return;
    }
    res.setHeader('content-type', 'audio/wav');
    res.end(blob); // the fake OSS blob
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${server.address().port}`, calls, close: () => new Promise((r) => server.close(r)) };
}

/** Temp repo + temp world + express(json) + createTtsRouter + stub + env swap. */
async function harness({ stub = true, blob, afterCacheWrite } = {}) {
  const savedEnv = { ...process.env };
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-tts-repo-'));
  const world = path.join(repo, 'world-root');
  const store = new LocalWorldStore(world);
  let lifecycleRoot = world;
  await store.writeFile('world.json', JSON.stringify({
    id: 'p', name: 'P', description: '', author: '', genre: 'test', createdAt: '', updatedAt: '',
  }));

  const ds = stub ? await dashStub({ blob }) : null;
  process.env.AIRP_TTS_BASE_URL = ds ? ds.base : 'http://127.0.0.1:1'; // unreachable when stub:false
  process.env.DASHSCOPE_API_KEY = 'test-key';
  process.env.AIRP_TTS_MODEL = MODEL;
  process.env.AIRP_TTS_DEFAULT_VOICE = DEFAULT_VOICE;
  const writeCacheAtomic = afterCacheWrite
    ? async (abs, data) => {
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, data);
      await afterCacheWrite();
    }
    : undefined;

  const app = express();
  app.use(express.json());
  app.use('/api', createTtsRouter(repo, () => store, root => lifecycleRoot === root, writeCacheAtomic));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  savePathByApiBase.set(base, world);
  const cacheDir = path.join(world, '.airpworld', 'tts-cache');

  return {
    base, repo, world, store, ds, cacheDir, setCurrentRoot: root => { lifecycleRoot = root; },
    close: async () => {
      savePathByApiBase.delete(base);
      server.close();
      if (ds) await ds.close();
      try { store.close(); } catch {}
      await fs.rm(repo, { recursive: true, force: true });
      for (const k of ['AIRP_TTS_BASE_URL', 'DASHSCOPE_API_KEY', 'AIRP_TTS_MODEL',
                       'AIRP_TTS_DEFAULT_VOICE', 'AIRP_TTS_TIMEOUT_MS', 'AIRP_TTS_LOCAL_BASE_URL',
                       'AIRP_TTS_LOCAL_TIMEOUT_MS', 'AIRP_TTS_LOCAL_VOICE', 'AIRP_TTS_LOCAL_API_KEY', 'AIRP_LOCAL_TTS']) {
        if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k];
      }
    },
  };
}

const post = (base, body) => {
  const savePath = body.savePath ?? savePathByApiBase.get(base);
  const payload = savePath === undefined ? body : { ...body, savePath };
  return fetch(`${base}/tts`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
  });
};

async function localHarness(t, worldId = 'first-snow-jp', afterCacheWrite) {
  const h = await harness({ afterCacheWrite });
  t.after(() => h.close());
  const manifest = JSON.parse(await h.store.readFile('world.json'));
  await h.store.writeFile('world.json', JSON.stringify({ ...manifest, id: worldId, characters: [{ id: 'nanami', home: 'world/map' }] }));
  const local = { mode: 'ok', calls: [] };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => {
      local.calls.push(JSON.parse(raw));
      if (local.mode === 'timeout') return;
      res.statusCode = local.mode === 'fail' ? 503 : 200;
      res.end(local.mode === 'invalid' ? '<html>error</html>' : WAV);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  process.env.AIRP_TTS_LOCAL_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.AIRP_TTS_LOCAL_TIMEOUT_MS = '100';
  process.env.AIRP_TTS_LOCAL_VOICE = 'setsuna';
  process.env.AIRP_LOCAL_TTS = '1'; // hidden by default
  delete process.env.AIRP_TTS_LOCAL_API_KEY;
  return { ...h, local };
}

const localLine = { text: 'また会えたね。', voice: 'girl-next-door', language: 'ja', characterId: 'nanami', emotion: 'smile' };

test('Local Nanami works without cloud key, preserves emotion, and caches independently', async t => {
  const h = await localHarness(t);
  delete process.env.DASHSCOPE_API_KEY;
  assert.equal((await (await fetch(`${h.base}/tts/config`)).json()).configured, true);
  const first = await (await post(h.base, localLine)).json();
  assert.equal(first.ok, true);
  assert.equal(first.cached, false);
  assert.deepEqual(h.local.calls[0], { text: localLine.text, voice: 'setsuna', language: 'ja', emotion: 'happy' });
  const cached = await (await post(h.base, localLine)).json();
  assert.equal(cached.cached, true);
  const sad = await (await post(h.base, { ...localLine, emotion: 'sad' })).json();
  assert.notEqual(sad.url, first.url);
  assert.equal(h.local.calls.length, 2);
  assert.equal(h.ds.calls.length, 0);
  assert.deepEqual(Buffer.from(await (await fetch(new URL(first.url, h.base))).arrayBuffer()), WAV);
});

for (const mode of ['fail', 'timeout', 'invalid']) {
  test(`Local ${mode} warns and uses online fallback; recovery returns to local voice`, async t => {
    const h = await localHarness(t, 'firstsnow-niko-ef44d9e');
    const warnings = [];
    t.mock.method(console, 'warn', line => warnings.push(line));
    h.local.mode = mode;
    const response = await post(h.base, localLine);
    assert.equal(response.headers.get('X-AIRP-TTS-Fallback'), 'local-to-online');
    const fallback = await response.json();
    assert.equal(fallback.ok, true);
    assert.equal(h.ds.calls.length, 1);
    assert.ok(warnings.some(w => w.includes('falling back to online TTS')));
    h.local.mode = 'ok';
    const recovered = await (await post(h.base, localLine)).json();
    assert.equal(recovered.ok, true);
    assert.notEqual(recovered.url, fallback.url);
    assert.equal(h.ds.calls.length, 1);
    assert.equal(h.local.calls.length, 2);
  });
}

test('Other characters and legacy requests remain online', async t => {
  const h = await localHarness(t);
  for (const characterId of ['sumi-yukimura', undefined]) {
    const result = await (await post(h.base, { ...localLine, characterId })).json();
    assert.equal(result.ok, true);
  }
  assert.equal(h.local.calls.length, 0);
  assert.equal(h.ds.calls.length, 1);
});

for (const worldId of ['sakura-academy', 'sakura-academy-saved-game']) {
  test(`School romance Nanami uses local TTS in ${worldId}`, async t => {
    const h = await localHarness(t, worldId);
    delete process.env.DASHSCOPE_API_KEY;
    const response = await post(h.base, { ...localLine, voice: 'shy-sweet' });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).ok, true);
    assert.equal(h.local.calls.length, 1);
    assert.equal(h.local.calls[0].voice, 'setsuna');
    assert.equal(h.ds.calls.length, 0);
  });
}

test('Same character ID in another world remains online', async t => {
  const h = await localHarness(t, 'magic-academy-jp');
  assert.equal((await (await post(h.base, localLine)).json()).ok, true);
  assert.equal(h.local.calls.length, 0);
  assert.equal(h.ds.calls.length, 1);
});

test('Local failure without online credentials returns honest failure and warning header', async t => {
  const h = await localHarness(t);
  delete process.env.DASHSCOPE_API_KEY;
  h.local.mode = 'fail';
  const response = await post(h.base, localLine);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('X-AIRP-TTS-Fallback'), 'local-to-online');
  assert.equal((await response.json()).code, 'tts_unconfigured');
  assert.equal(h.ds.calls.length, 0);
});

// ── A 组：缓存命中（非空性核心） + 原子写 ──

test('A1 首次合成 → 200 / cached:false / url 形状合法 + 上游恰好 1 次', async () => {
  const h = await harness();
  const j = await (await post(h.base, { text: 'おはよう' })).json();
  assert.equal(j.ok, true);
  assert.equal(j.cached, false);
  assert.equal(j.truncated, false);
  assert.equal(j.characters, 'おはよう'.length);
  assert.match(j.url, /^\/api\/tts\/audio\/[a-f0-9]{20}\.wav$/);
  assert.equal(h.ds.calls.length, 1);
  await h.close();
});

test('A2 同文本二次 → cached:true 且上游调用数不变（不联网）', async () => {
  const h = await harness();
  await post(h.base, { text: 'same line' });
  const j2 = await (await post(h.base, { text: 'same line' })).json();
  assert.equal(j2.cached, true);
  // NON-EMPTINESS: no cache → 2 calls here → red.
  assert.equal(h.ds.calls.length, 1, 'cached hit must not re-synthesise');
  await h.close();
});

test('A3 缓存文件字节完整（原子写未留半截） + 无 .tmp 残留', async () => {
  const h = await harness();
  const j = await (await post(h.base, { text: 'blob check' })).json();
  const hash = hashOf(MODEL, DEFAULT_VOICE, 'Auto', 'blob check');
  assert.equal(j.url, `/api/tts/audio/${hash}.wav`);
  assert.deepEqual(await fs.readFile(path.join(h.cacheDir, `${hash}.wav`)), WAV);
  assert.deepEqual((await fs.readdir(h.cacheDir)).filter((f) => f.endsWith('.tmp')), []);
  await h.close();
});

// ── B 组：截断 ──

test('B1 >500 字符 → truncated:true / characters===500 / 上游收到截断文本', async () => {
  const h = await harness();
  const long = 'あ'.repeat(600);
  const j = await (await post(h.base, { text: long })).json();
  assert.equal(j.truncated, true);
  assert.equal(j.characters, 500);
  assert.equal(h.ds.calls[0].body.input.text.length, 500);
  await h.close();
});

test('B2 截断后 hash 按截断文本算（缓存键不因原长漂移）', async () => {
  const h = await harness();
  const long = 'あ'.repeat(600);
  const j = await (await post(h.base, { text: long })).json();
  assert.equal(j.url, `/api/tts/audio/${hashOf(MODEL, DEFAULT_VOICE, 'Auto', long.slice(0, 500))}.wav`);
  await h.close();
});

// ── C 组：voice + language_type 映射 ──

test('C1 language=ja → input.language_type==="Japanese"', async () => {
  const h = await harness();
  await post(h.base, { text: 'a', language: 'ja' });
  assert.equal(h.ds.calls[0].body.input.language_type, 'Japanese');
  await h.close();
});

test('C2 en → "English"；未列出短码 / 缺省 → "Auto"', async () => {
  const h = await harness();
  await post(h.base, { text: 'x', language: 'en' });
  assert.equal(h.ds.calls[0].body.input.language_type, 'English');
  await post(h.base, { text: 'y', language: 'fr' });
  assert.equal(h.ds.calls[1].body.input.language_type, 'Auto');
  await post(h.base, { text: 'z' });
  assert.equal(h.ds.calls[2].body.input.language_type, 'Auto');
  await h.close();
});

test('C3 alias / 裸 id / 畸形 / 未知 四种 voice 的解析与回落', async () => {
  const h = await harness();
  // 效果别名 → 线上 id（the design notes/§3）
  await post(h.base, { text: 'v1', voice: 'wise-elder' });
  assert.equal(h.ds.calls[0].body.input.voice, 'Eldric Sage');
  // 已在调色板里的裸 id → 原样透传（向后兼容）
  await post(h.base, { text: 'v2', voice: 'Vincent' });
  assert.equal(h.ds.calls[1].body.input.voice, 'Vincent');
  // 含空格的合法 id：旧 /^[A-Za-z0-9_-]+$/ 会把它静默改成默认（07 §0 回归）
  await post(h.base, { text: 'v3', voice: 'Eldric Sage' });
  assert.equal(h.ds.calls[2].body.input.voice, 'Eldric Sage');
  // 近失 typo（Eldric / Sage 各是 Eldric Sage 的一半）→ 回落默认，不 400
  await post(h.base, { text: 'v4', voice: 'Eldric' });
  assert.equal(h.ds.calls[3].body.input.voice, DEFAULT_VOICE);
  await post(h.base, { text: 'v5', voice: 'Sage' });
  assert.equal(h.ds.calls[4].body.input.voice, DEFAULT_VOICE);
  // 结构性畸形（路径穿越）→ 同样回落，不泄漏成上游参数
  const r = await post(h.base, { text: 'v6', voice: '../evil' });
  assert.equal(r.status, 200);
  assert.equal(h.ds.calls[5].body.input.voice, DEFAULT_VOICE);
  await h.close();
});

// ── D 组：未配置 key / 无世界 ──

test('D1 无 DASHSCOPE_API_KEY → 503 tts_unconfigured 且不发网络请求', async () => {
  const h = await harness();
  delete process.env.DASHSCOPE_API_KEY;
  const r = await post(h.base, { text: 'hi' });
  const j = await r.json();
  assert.equal(r.status, 503);
  assert.equal(j.ok, false);
  assert.equal(j.code, 'tts_unconfigured');
  assert.equal(h.ds.calls.length, 0);
  await h.close();
});

test('a request from another captured save is rejected before cache or synthesis', async t => {
  const h = await harness();
  t.after(() => h.close());
  const response = await post(h.base, { text: 'old save', savePath: path.join(h.repo, 'world-b') });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'world_changed');
  assert.equal(h.ds.calls.length, 0, 'a stale save never reaches a voice provider');
  await assert.rejects(fs.access(h.cacheDir), { code: 'ENOENT' }, 'a stale save never creates the active world cache');
});

test('a world transition during manifest loading prevents stale synthesis and cache writes', async t => {
  const h = await harness();
  t.after(() => h.close());
  const getManifest = h.store.getManifest.bind(h.store);
  h.store.getManifest = async () => {
    const manifest = await getManifest();
    h.setCurrentRoot(path.join(h.repo, 'world-b'));
    return manifest;
  };
  const response = await post(h.base, { text: 'late line' });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'world_changed');
  assert.equal(h.ds.calls.length, 0, 'the root is rechecked after the async world read');
  await assert.rejects(fs.access(h.cacheDir), { code: 'ENOENT' }, 'no audio from the superseded request is cached');
});

test('online cache miss returns world_changed when the root changes during cache write', async t => {
  let h;
  h = await harness({ afterCacheWrite: async () => h.setCurrentRoot(path.join(h.repo, 'world-b')) });
  t.after(() => h.close());
  const response = await post(h.base, { text: 'online late cache' });
  const body = await response.json();
  assert.equal(response.status, 409);
  assert.equal(body.code, 'world_changed');
  assert.equal(body.url, undefined, 'a superseded write must not publish a stale audio URL');
  assert.equal(h.ds.calls.length, 1);
});

test('online cache write rejection after a world switch returns world_changed, not internal', async t => {
  let h;
  h = await harness({
    afterCacheWrite: async () => {
      h.setCurrentRoot(path.join(h.repo, 'world-b'));
      throw new Error('write failed after switch');
    },
  });
  t.after(() => h.close());
  const response = await post(h.base, { text: 'rejected cache write' });
  const body = await response.json();
  assert.equal(response.status, 409);
  assert.equal(body.code, 'world_changed');
  assert.equal(body.error, 'The active world changed before this voice request could be handled.');
  assert.equal(body.url, undefined, 'a rejected stale write must not publish a URL or its underlying error');
  assert.equal(h.ds.calls.length, 1);
});

test('local cache miss returns world_changed when the root changes during cache write', async t => {
  let h;
  h = await localHarness(t, 'first-snow-jp', async () => h.setCurrentRoot(path.join(h.repo, 'world-b')));
  const response = await post(h.base, localLine);
  const body = await response.json();
  assert.equal(response.status, 409);
  assert.equal(body.code, 'world_changed');
  assert.equal(body.url, undefined, 'a superseded write must not publish a stale audio URL');
  assert.equal(h.local.calls.length, 1);
});

test('D2 无活跃世界 → 400 no_active_world', async () => {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-tts-noworld-'));
  const app = express();
  app.use(express.json());
  app.use('/api', createTtsRouter(repo, () => null, () => false));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const r = await post(`http://127.0.0.1:${server.address().port}/api`, { text: 'hi' });
  const j = await r.json();
  assert.equal(r.status, 400);
  assert.equal(j.code, 'no_active_world');
  server.close();
  await fs.rm(repo, { recursive: true, force: true });
});

// ── E 组：/api/tts/audio 反穿越 ──

test('E1 :file 形状非法 → 403', async () => {
  const h = await harness();
  for (const bad of ['notahash.wav', `${'g'.repeat(20)}.wav`, `${'a'.repeat(19)}.wav`, 'x.mp3']) {
    assert.equal((await fetch(`${h.base}/tts/audio/${encodeURIComponent(bad)}`)).status, 403, bad);
  }
  await h.close();
});

test('E2 形状合法且存在 → 200 + immutable', async () => {
  const h = await harness();
  const hash = hashOf(MODEL, DEFAULT_VOICE, 'Auto', 'hit');
  await fs.mkdir(h.cacheDir, { recursive: true });
  await fs.writeFile(path.join(h.cacheDir, `${hash}.wav`), WAV);
  const r = await fetch(`${h.base}/tts/audio/${hash}.wav`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('cache-control') ?? '', /immutable/);
  await h.close();
});

test('E3 .. 逃逸（编码进 :file）→ 403', async () => {
  const h = await harness();
  assert.equal((await fetch(`${h.base}/tts/audio/..%2f..%2fetc%2fpasswd`)).status, 403);
  await h.close();
});

test('E4 符号链接逃逸 → 403（POSIX）', { skip: process.platform === 'win32' ? 'posix only' : false }, async () => {
  const h = await harness();
  const hash = hashOf(MODEL, DEFAULT_VOICE, 'Auto', 'link');
  await fs.mkdir(h.cacheDir, { recursive: true });
  await fs.symlink('/etc/passwd', path.join(h.cacheDir, `${hash}.wav`));
  assert.equal((await fetch(`${h.base}/tts/audio/${hash}.wav`)).status, 403);
  await h.close();
});

test('E5 形状合法但文件缺失 → 404', async () => {
  const h = await harness();
  const hash = hashOf(MODEL, DEFAULT_VOICE, 'Auto', 'missing');
  assert.equal((await fetch(`${h.base}/tts/audio/${hash}.wav`)).status, 404);
  await h.close();
});

// ── F 组：空文本 ──

test('F1 text 缺失 / 非字符串 / 空串 / 纯空白 → 400 invalid_argument', async () => {
  const h = await harness();
  for (const body of [{}, { text: 42 }, { text: '' }, { text: '   ' }]) {
    const r = await post(h.base, body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal((await r.json()).code, 'invalid_argument');
  }
  assert.equal(h.ds.calls.length, 0);
  await h.close();
});

// ── G 组：wav magic bytes（契约 §15.21：非 wav → 502，不写盘） ──

test('G1 上游回非 wav 字节 → 502 tts_upstream 且不写缓存（不污染内容寻址）', async () => {
  const h = await harness({ blob: Buffer.from('<!doctype html><h1>not audio</h1>') });
  const r = await post(h.base, { text: 'magic' });
  assert.equal(r.status, 502);
  const j = await r.json();
  assert.equal(j.ok, false);
  assert.equal(j.code, 'tts_upstream');
  // NON-EMPTINESS: no magic check → the HTML blob is cached forever → red.
  const hash = hashOf(MODEL, DEFAULT_VOICE, 'Auto', 'magic');
  await assert.rejects(() => fs.readFile(path.join(h.cacheDir, `${hash}.wav`)));
  await h.close();
});
// ── H 组：共享清洗防线（清洗先于截断 / hash / 合成） ──

test('H1 动作与情绪控制标签先清洗，再发送并写入对应缓存键', async () => {
  const h = await harness();
  const r1 = await post(h.base, { text: '[emo: smile] （笑了一下）好啊' });
  const j1 = await r1.json();
  assert.equal(r1.status, 200);
  assert.equal(h.ds.calls[0].body.input.text, '好啊');
  assert.equal(j1.url, `/api/tts/audio/${hashOf(MODEL, DEFAULT_VOICE, 'Auto', '好啊')}.wav`);

  const r2 = await post(h.base, { text: '好啊' });
  const j2 = await r2.json();
  assert.equal(j2.cached, true);
  assert.equal(h.ds.calls.length, 1, 'equivalent cleaned text must share one cache entry');
  await h.close();
});

test('H2 纯动作行和异常括号 → 400 invalid_argument 且不上游', async () => {
  const h = await harness();
  for (const text of ['（笑了一下）', '（说完就走了', '还好）', '（他说\\n完了']) {
    const r = await post(h.base, { text });
    assert.equal(r.status, 400, text);
    assert.equal((await r.json()).code, 'invalid_argument');
  }
  assert.equal(h.ds.calls.length, 0);
  await h.close();
});
