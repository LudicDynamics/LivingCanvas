// Voices are cast by WORLD LANGUAGE × declared timbre
// A local studio voice speaks only
// in a world of its own language and for a character of its own gender — there
// is no translation bridge; a Chinese world gets the online voice, in Chinese.
// Runs against built dist: `pnpm build`.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { test } from 'node:test';
import { LocalWorldStore, VOICE_ROSTER } from '@airp/shared';
import { createTtsRouter } from '../dist/routes/tts.js';

const WAV = Buffer.from('RIFF\x24\x00\x00\x00WAVEfmt ');
const ENV = ['AIRP_TTS_BASE_URL', 'DASHSCOPE_API_KEY', 'AIRP_TTS_MODEL', 'AIRP_TTS_DEFAULT_VOICE',
  'AIRP_TTS_LOCAL_BASE_URL', 'AIRP_TTS_LOCAL_TIMEOUT_MS', 'AIRP_TTS_LOCAL_VOICE', 'AIRP_TTS_LOCAL_API_KEY',
  'AIRP_TTS_JA_LOCAL_VOICES', 'AIRP_TTS_CHARACTER_VOICES', 'AIRP_TTS_TRANSLATE_BASE_URL',
  'AIRP_TTS_TRANSLATE_API_KEY', 'AIRP_TTS_TRANSLATE_MODEL', 'AIRP_TTS_TRANSLATE_TIMEOUT_MS', 'DEEPSEEK_API_KEY', 'AIRP_LOCAL_TTS'];

/** One http stub; `handle(body, req)` returns [status, contentType, payload]. */
async function stub(t, handle) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : null;
      calls.push({ url: req.url, body });
      const [status, type, payload] = handle(body, req, server);
      res.statusCode = status;
      res.setHeader('content-type', type);
      res.end(payload);
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return { base: `http://127.0.0.1:${server.address().port}`, calls };
}

async function harness(t, { locale = 'zh-CN', worldId = 'first-snow-zh', characters = [{ id: 'nanami', home: 'world/map' }], mapping = 'nanami=setsuna' } = {}) {
  const saved = Object.fromEntries(ENV.map(k => [k, process.env[k]]));
  t.after(() => { for (const k of ENV) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; });
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-tts-bridge-'));
  t.after(() => fs.rm(repo, { recursive: true, force: true }));
  const store = new LocalWorldStore(path.join(repo, 'world-root'));
  t.after(() => { try { store.close(); } catch {} });
  await store.writeFile('world.json', JSON.stringify({ id: worldId, name: 'W', description: '', author: '', genre: 'test', createdAt: '', updatedAt: '', locale, characters }));
  for (const c of characters) if (c.voice) await store.writeFile(`characters/${c.id}/README.md`, `---\ntype: readme\nname: ${c.id}\nvoice: ${c.voice}\n---\n`);

  const online = await stub(t, (body, req, server) => req.url.includes('/generation')
    ? [200, 'application/json', JSON.stringify({ status_code: 200, output: { audio: { url: `http://127.0.0.1:${server.address().port}/blob.wav` } }, usage: { characters: 1 } })]
    : [200, 'audio/wav', WAV]);
  const local = await stub(t, () => [200, 'audio/wav', WAV]);

  Object.assign(process.env, {
    AIRP_TTS_BASE_URL: online.base, DASHSCOPE_API_KEY: 'test-key', AIRP_TTS_MODEL: 'qwen3-tts-flash-2025-11-27', AIRP_TTS_DEFAULT_VOICE: 'Cherry',
    AIRP_TTS_LOCAL_BASE_URL: local.base, AIRP_TTS_LOCAL_TIMEOUT_MS: '1000', AIRP_TTS_LOCAL_VOICE: 'setsuna',
    AIRP_TTS_CHARACTER_VOICES: mapping, AIRP_LOCAL_TTS: '1',
  });
  delete process.env.AIRP_TTS_LOCAL_API_KEY;
  delete process.env.AIRP_TTS_JA_LOCAL_VOICES;

  const app = express();
  app.use(express.json());
  app.use('/api', createTtsRouter(repo, () => store, root => root === store.worldRoot));
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const post = body => fetch(`http://127.0.0.1:${server.address().port}/api/tts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, savePath: body.savePath ?? store.worldRoot }),
  });
  return { post, online, local };
}

const synthOf = h => h.online.calls.find(c => c.url.includes('/generation'))?.body;

const zhLine = { text: '你终于来了。', voice: 'girl-next-door', language: 'zh-CN', characterId: 'nanami', emotion: 'smile' };

test('Vera in the Chinese wuwu world: the Japanese studio voice is skipped and her own voice reads Chinese', async t => {
  const h = await harness(t, {
    worldId: 'wuwu-zh', characters: [{ id: 'vera', home: 'world/map', voice: 'warm-cheerful' }], mapping: 'vera=setsuna',
  });
  const res = await h.post({ text: '你来了，好。', voice: 'warm-cheerful', language: 'zh-CN', characterId: 'vera' });
  assert.equal((await res.json()).ok, true);
  assert.equal(h.local.calls.length, 0, 'setsuna (Japanese) never speaks in a Chinese world');
  const body = synthOf(h);
  assert.equal(body.input.voice, 'Cherry');
  assert.equal(body.input.language_type, 'Chinese');
  assert.equal(body.input.text, '你来了，好。', 'no translation: the line is read as written');
});

test('the same mapping still uses the studio voice in the Japanese edition', async t => {
  const h = await harness(t, {
    locale: 'ja', worldId: 'wuwu-jp', characters: [{ id: 'vera', home: 'world/map', voice: 'warm-cheerful' }], mapping: 'vera=setsuna',
  });
  await h.post({ text: '来たね。', voice: 'warm-cheerful', language: 'ja', characterId: 'vera' });
  assert.deepEqual(h.local.calls[0].body, { text: '来たね。', voice: 'setsuna', language: 'ja', emotion: 'neutral' });
  assert.equal(h.online.calls.length, 0);
});

test('a female studio voice never speaks for a male character, even in its own language', async t => {
  const h = await harness(t, {
    locale: 'ja', worldId: 'whitechapel-jp', characters: [{ id: 'watson', home: 'world/map', voice: 'scholarly-narrator' }], mapping: 'watson=setsuna',
  });
  const res = await h.post({ text: 'やあ。', voice: 'scholarly-narrator', language: 'ja', characterId: 'watson' });
  assert.equal(h.local.calls.length, 0);
  // scholarly-narrator is Elias, banned on the voice roster. qwen speaks only its own native language
  // and there is no Japanese qwen man: on a qwen-only route nothing may read it — refused, never
  // forced onto a Chinese voice or a woman.
  assert.equal(res.status, 503);
  assert.deepEqual([(await res.json()).reason], ['no_native_voice']);
  assert.equal(synthOf(h), undefined, 'no synthesis at all');
});

test('the world locale decides the language even when the request omits or contradicts it', async t => {
  const h = await harness(t);
  await h.post({ ...zhLine, language: 'ja' });
  assert.equal(h.local.calls.length, 0);
  assert.equal(synthOf(h).input.language_type, 'Chinese');
});

test('a voice bound to another language is re-cast on the same gender in the world language', async t => {
  const h = await harness(t, { locale: 'en', worldId: 'mandongbu-en', characters: [], mapping: '' });
  await h.post({ text: 'Hello.', voice: 'beijing-youth', language: 'en' });
  const en = VOICE_ROSTER.voices.find(v => v.id === synthOf(h).input.voice);
  assert.deepEqual([en.provider, en.gender, en.only], ['dashscope', 'male', 'en'], 'Beijing-dialect Dylan → a native-English qwen man (qwen speaks only its own language)');
  const zh = await harness(t, { locale: 'zh-CN', worldId: 'x-zh', characters: [], mapping: '' });
  await zh.post({ text: '你好。', voice: 'Jennifer', language: 'zh-CN' });
  assert.equal(synthOf(zh).input.voice, 'Katerina', 'an American-English raw id is re-cast for a Chinese world');
});

test('an unregistered local voice is not used: its language is unknown', async t => {
  const h = await harness(t, { locale: 'ja', worldId: 'first-snow-jp', mapping: 'nanami=aoi' });
  await h.post({ ...zhLine, text: 'また会えたね。', language: 'ja' });
  assert.equal(h.local.calls.length, 0);
  process.env.AIRP_TTS_JA_LOCAL_VOICES = 'aoi';
  await h.post({ ...zhLine, text: 'また会えたね！', language: 'ja' });
  assert.equal(h.local.calls[0].body.voice, 'aoi', 'declared Japanese by the operator → used in a Japanese world');
});
