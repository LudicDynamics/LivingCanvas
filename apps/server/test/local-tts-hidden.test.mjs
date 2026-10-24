// Local studio TTS is hidden by default
// Flag off (no AIRP_LOCAL_TTS=1): no studio voice is
// listed or used, old saves that name one fall back to the hosted voice for the
// world's language, and the writer cannot assign one. Runs against built dist.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { test } from 'node:test';
import {
  LocalWorldStore, createActionService, hostedVoiceOf, localTtsFlag, npcVoiceAlias,
  resolveLiveVoice, resolveVoice, resolveVoiceFor, VOICE_ROSTER,
} from '@airp/shared';
import { createTtsRouter } from '../dist/routes/tts.js';
import { aiRoutes } from '../dist/ai-gateway.js';
import { resolveVoiceLiveCast } from '../dist/engine/voice-live-cast.js';

const WAV = Buffer.from('RIFF\x24\x00\x00\x00WAVEfmt ');
const ENV = ['AIRP_TTS_BASE_URL', 'DASHSCOPE_API_KEY', 'AIRP_TTS_MODEL', 'AIRP_TTS_DEFAULT_VOICE',
  'AIRP_TTS_LOCAL_BASE_URL', 'AIRP_TTS_LOCAL_TIMEOUT_MS', 'AIRP_TTS_LOCAL_VOICE', 'AIRP_TTS_LOCAL_API_KEY',
  'AIRP_TTS_JA_LOCAL_VOICES', 'AIRP_TTS_CHARACTER_VOICES', 'AIRP_LOCAL_TTS', 'AIRP_AI_BASE', 'AIRP_AI_KEY'];

async function stub(t, handle) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => {
      calls.push({ url: req.url, body: raw ? JSON.parse(raw) : null });
      const [status, type, payload] = handle(req, server);
      res.statusCode = status;
      res.setHeader('content-type', type);
      res.end(payload);
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return { base: `http://127.0.0.1:${server.address().port}`, calls };
}

async function harness(t, { locale = 'ja', worldId = 'first-snow-jp', characters, mapping = 'nanami=setsuna', flag } = {}) {
  const saved = Object.fromEntries(ENV.map(k => [k, process.env[k]]));
  t.after(() => { for (const k of ENV) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; });
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-ltts-hidden-'));
  t.after(() => fs.rm(repo, { recursive: true, force: true }));
  const store = new LocalWorldStore(path.join(repo, 'world-root'));
  t.after(() => { try { store.close(); } catch {} });
  const cast = characters ?? [{ id: 'nanami', home: 'world/map', voice: 'girl-next-door' }];
  await store.writeFile('world.json', JSON.stringify({ id: worldId, name: 'W', description: '', author: '', genre: 'test', createdAt: '', updatedAt: '', locale, characters: cast }));
  for (const c of cast) if (c.voice) await store.writeFile(`characters/${c.id}/README.md`, `---\ntype: readme\nname: ${c.id}\nvoice: ${c.voice}\n---\n`);

  const online = await stub(t, (req, server) => req.url.includes('/generation')
    ? [200, 'application/json', JSON.stringify({ status_code: 200, output: { audio: { url: `http://127.0.0.1:${server.address().port}/blob.wav` } }, usage: { characters: 1 } })]
    : [200, 'audio/wav', WAV]);
  const local = await stub(t, () => [200, 'audio/wav', WAV]);
  for (const k of ENV) delete process.env[k];
  Object.assign(process.env, {
    AIRP_TTS_BASE_URL: online.base, DASHSCOPE_API_KEY: 'test-key', AIRP_TTS_MODEL: 'qwen3-tts-flash-2025-11-27', AIRP_TTS_DEFAULT_VOICE: 'Cherry',
    AIRP_TTS_LOCAL_BASE_URL: local.base, AIRP_TTS_LOCAL_TIMEOUT_MS: '1000', AIRP_TTS_LOCAL_VOICE: 'setsuna',
    AIRP_TTS_CHARACTER_VOICES: mapping, ...(flag ? { AIRP_LOCAL_TTS: flag } : {}),
  });

  const app = express();
  app.use(express.json());
  app.use('/api', createTtsRouter(repo, () => store, root => root === store.worldRoot));
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const api = `http://127.0.0.1:${server.address().port}/api`;
  const post = (body, headers = {}) => fetch(`${api}/tts`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ savePath: store.worldRoot, ...body }) });
  return { api, post, online, local, store };
}

const synthOf = h => h.online.calls.find(c => c.url.includes('/generation'))?.body;

test('the flag is OFF unless AIRP_LOCAL_TTS=1', () => {
  assert.equal(localTtsFlag({}), false);
  assert.equal(localTtsFlag({ AIRP_LOCAL_TTS: '0' }), false);
  assert.equal(localTtsFlag({ AIRP_LOCAL_TTS: 'true' }), false);
  assert.equal(localTtsFlag({ AIRP_LOCAL_TTS: '1' }), true);
});

test('flag off: a configured studio voice is not used; Nanami speaks with her hosted voice', async t => {
  const h = await harness(t);
  const res = await h.post({ text: 'また会えたね。', voice: 'girl-next-door', language: 'ja', characterId: 'nanami', emotion: 'smile' });
  assert.equal((await res.json()).ok, true);
  assert.equal(res.headers.get('x-airp-tts-fallback'), null, 'not a failure: local is simply off');
  assert.equal(h.local.calls.length, 0);
  // girl-next-door is Nini, a Chinese qwen voice; qwen speaks only its own language → the Japanese qwen woman
  assert.equal(synthOf(h).input.voice, 'Ono Anna');
  assert.equal(synthOf(h).input.language_type, 'Japanese');
});

test('flag off: /tts/config does not offer the studio voice', async t => {
  const off = await harness(t);
  const config = await (await fetch(`${off.api}/tts/config`)).json();
  assert.equal(config.localTts, false);
  assert.equal(config.experimentalLocal, false);
  assert.equal(config.configured, true, 'still configured through the hosted voice');
  const on = await harness(t, { flag: '1' });
  assert.equal((await (await fetch(`${on.api}/tts/config`)).json()).localTts, true);
});

test('flag off, no hosted key: a local URL alone does not count as configured', async t => {
  const h = await harness(t);
  delete process.env.DASHSCOPE_API_KEY;
  assert.equal((await (await fetch(`${h.api}/tts/config`)).json()).configured, false);
  assert.equal(aiRoutes({ AIRP_TTS_LOCAL_BASE_URL: 'http://x' }).tts, 'none', 'the connection panel never shows "Local voice server"');
  assert.equal(aiRoutes({ AIRP_TTS_LOCAL_BASE_URL: 'http://x', AIRP_LOCAL_TTS: '1' }).tts, 'local');
});

test('flag on (env, or this browser\'s own toggle header): the studio voice still works', async t => {
  const env = await harness(t, { flag: '1' });
  await env.post({ text: 'また会えたね。', voice: 'girl-next-door', language: 'ja', characterId: 'nanami' });
  assert.equal(env.local.calls.length, 1);
  const header = await harness(t);
  await header.post({ text: 'また会えたね。', voice: 'girl-next-door', language: 'ja', characterId: 'nanami' }, { 'x-airp-tts-local': '1' });
  assert.equal(header.local.calls.length, 1);
});

test('an old save that declares the studio voice id falls back to a hosted voice of the world language', async t => {
  for (const [locale, language] of [['ja', 'Japanese'], ['zh-CN', 'Chinese'], ['ko', 'Korean'], ['en', 'English']]) {
    const h = await harness(t, { locale, worldId: `old-${locale}`, characters: [{ id: 'aoi', home: 'world/map', voice: 'setsuna' }], mapping: '' });
    const res = await h.post({ text: 'Hi.', voice: 'setsuna', language: locale, characterId: 'aoi' });
    assert.equal((await res.json()).ok, true, locale);
    assert.equal(h.local.calls.length, 0);
    // setsuna → shy-sweet (a young woman's voice): signed out, worldlines-play is not asked, so the built-in qwen
    // woman of the world language — qwen speaks only its own language
    const spoken = VOICE_ROSTER.voices.find(v => v.id === synthOf(h).input.voice);
    assert.deepEqual([spoken.provider, spoken.gender, spoken.only], ['dashscope', 'female', locale === 'zh-CN' ? 'zh' : locale], locale);
    assert.equal(synthOf(h).input.language_type, language);
  }
});

test('fallback mapping: studio ids resolve to a hosted voice for reading, never for writing', () => {
  assert.equal(hostedVoiceOf('setsuna'), 'Mia');
  assert.equal(hostedVoiceOf('girl-next-door'), 'Nini');
  assert.equal(hostedVoiceOf('nope'), null);
  for (const lang of ['zh', 'ja', 'en', 'ko']) assert.equal(resolveVoiceFor('setsuna', lang), 'Mia');
  assert.equal(npcVoiceAlias({ voice: 'setsuna', gender: 'female' }), 'shy-sweet');
  assert.equal(resolveLiveVoice('setsuna'), 'coral', 'a voice call uses shy-sweet\'s live voice');
  assert.equal(resolveVoice('setsuna'), null, 'content validation / the writer still reject a studio id');
});

test('voice call (flag off): the studio mapping is ignored and the hosted voice is named', async t => {
  const h = await harness(t, { characters: [{ id: 'nanami', home: 'world/map', voice: 'setsuna' }] });
  const cast = await resolveVoiceLiveCast(h.store, 'nanami');
  // signed out: play is not asked; the built-in native Japanese voice, as /api/tts gives her
  assert.equal(cast.voice, 'Ono Anna');
  assert.equal(cast.language, 'Japanese');
});

test('the writer cannot assign a studio voice, and an old studio voice elsewhere does not break create_char', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-ltts-writer-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new LocalWorldStore(root);
  t.after(() => { try { store.close(); } catch {} });
  await store.writeFile('world.json', JSON.stringify({
    id: 'ltts-writer', name: 'W', description: '', author: '', genre: 'test', locale: 'ja',
    characters: [{ id: 'old', home: 'map', role: 'npc' }], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  }));
  await store.writeFile('characters/old/README.md', '---\ntype: readme\nname: Old\nvoice: setsuna\n---\n');
  await store.writeFile('assets/a.png', Buffer.from('89504e470d0a1a0a', 'hex'));
  const writer = createActionService(store, { type: 'writer' }, { turn: 'test:ltts', agentScope: 'writer-top-level' });
  const preset = { id: 'character', name: '', description: '', items: [{ id: 'a' }] };
  const base = { name: 'N', desc: 'd', avatar: 'assets/a.png' };
  await assert.rejects(
    writer.createChar({ input: { id: 'n1', ...base, voice: 'setsuna' }, platformPreset: preset }),
    /Unknown voice "setsuna"/,
  );
  await assert.rejects(
    writer.createChar({ input: { id: 'n2', ...base, voice: 'shy-sweet' }, platformPreset: preset }),
    /collides/, 'the old studio voice is read as its hosted stand-in (shy-sweet)',
  );
  await writer.createChar({ input: { id: 'n3', ...base, voice: 'gentle-calm' }, platformPreset: preset });
});
