// Voices come from worldlines-play: POST play /v1/voice/cast with the signed-in account's token →
// candidates tried in order; play unreachable → its last answer (cache, memory + disk); never asked / no answer → the
// built-in table. X-AIRP-Voice-Source: play | cache | builtin. A fake play service here. Runs against built dist.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { test } from 'node:test';
import { LocalWorldStore } from '@airp/shared';
import { createTtsRouter } from '../dist/routes/tts.js';
import { PLAY_DOWN_MS, PLAY_TIMEOUT_MS, resetPlayVoiceCache, setPlayVoiceClock } from '../dist/play-voice.js';

const WAV = Buffer.from('RIFF\x24\x00\x00\x00WAVEfmt play');
const KEYS = ['AIRP_PLAY_URL', 'AIRP_PLAY_CACHE', 'FISH_AUDIO_API_KEY', 'FISH_API_KEY', 'AIRP_AI_BASE', 'AIRP_AI_KEY', 'AIRP_AI_TTS_MODEL', 'AIRP_AI_TTS_FISH_MODEL', 'AIRP_TTS_PROVIDER',
  'AIRP_TTS_BASE_URL', 'DASHSCOPE_API_KEY', 'AIRP_TTS_MODEL', 'AIRP_TTS_DEFAULT_VOICE', 'AIRP_TTS_LOCAL_BASE_URL', 'AIRP_LOCAL_TTS', 'AIRP_AI_ACCOUNT'];

function stub(handler) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const call = { url: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : null };
      calls.push(call);
      handler(req, res, server, call);
    });
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ base: `http://127.0.0.1:${server.address().port}`, calls, close: () => new Promise((d) => { server.closeAllConnections(); server.close(d); }) })));
}
const json = (res, status, body) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };
const dashOk = (req, res, server) => (req.url.includes('/services/aigc/') ? json(res, 200, { output: { audio: { url: `http://127.0.0.1:${server.address().port}/blob.wav` } } }) : res.end(WAV));

const CHARACTERS = [{ id: 'mio', home: 'world/x', description: '十四岁的渔家少女，她嘴硬。' }, { id: 'kenta', home: 'world/x', description: '退休的老渔夫，他话不多。' }];

async function harness(t, { locale = 'zh-CN', worldId = 'islet-zh', play, gateway, env = {} } = {}) {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  resetPlayVoiceCache();
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-play-voice-'));
  const world = path.join(repo, 'w');
  const store = new LocalWorldStore(world);
  await store.writeFile('world.json', JSON.stringify({ id: worldId, name: 'W', description: '', author: '', genre: 't', createdAt: '', updatedAt: '', locale, characters: CHARACTERS }));
  for (const c of CHARACTERS) await store.writeFile(`characters/${c.id}/README.md`, `---\ntype: readme\nname: ${c.id}\n---\n`);
  const dash = await stub(dashOk);
  Object.assign(process.env, { AIRP_AI_ACCOUNT: '0', AIRP_TTS_BASE_URL: dash.base, AIRP_TTS_MODEL: 'qwen3-tts-flash', AIRP_PLAY_CACHE: path.join(repo, 'play-voice-cache.json'), AIRP_PLAY_URL: play?.base ?? 'http://127.0.0.1:1' }, gateway ? { AIRP_AI_BASE: gateway.base } : {}, env);
  const app = express();
  app.use(express.json());
  app.use('/api', createTtsRouter(repo, () => store, (root) => root === world));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(async () => {
    server.closeAllConnections();
    server.close();
    await dash.close();
    try { store.close(); } catch {}
    await fs.rm(repo, { recursive: true, force: true });
    for (const k of KEYS) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    resetPlayVoiceCache();
  });
  const say = (body) => fetch(`http://127.0.0.1:${server.address().port}/api/tts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ savePath: world, ...body }) });
  return { say, dash, world, repo };
}

function signIn(t, token = 'account-token') {
  const hooks = globalThis;
  const saved = hooks.__airpAccountToken;
  hooks.__airpAccountToken = async () => token;
  t.after(() => { hooks.__airpAccountToken = saved; });
}

test('signed in: play is asked with the account token; its candidates are tried in order (a failing Fish voice gives way to qwen); source play', async (t) => {
  signIn(t);
  const play = await stub((req, res, _s, call) => json(res, 200, { key: 'livingcanvas/islet/mio', lang: call.body.lang, candidates: [
    { provider: 'fish', voiceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', title: 'A', via: 'assigned' },
    { provider: 'openai', voiceId: 'nova', title: 'OpenAI nova', via: 'table' },
    { provider: 'dashscope', voiceId: 'Cherry', title: 'Cherry', via: 'other-provider' },
  ], traits: {} }));
  t.after(play.close);
  const gateway = await stub((req, res, _s, call) => (call.body?.model?.startsWith('fish') ? json(res, 500, { error: { code: 'upstream' } }) : (res.setHeader('content-type', 'audio/wav'), res.end(WAV))));
  t.after(gateway.close);
  const h = await harness(t, { play, gateway });
  const res = await h.say({ text: '你来了。', characterId: 'mio' });
  assert.equal(res.status, 200, await res.clone().text());
  assert.equal(res.headers.get('x-airp-voice-source'), 'play');
  assert.equal(res.headers.get('x-airp-tts-fallback'), 'fish-to-qwen');
  const asked = play.calls[0];
  assert.equal(asked.url, '/v1/voice/cast');
  assert.equal(asked.headers.authorization, 'Bearer account-token');
  assert.deepEqual([asked.body.product, asked.body.family, asked.body.character, asked.body.lang, asked.body.providers], ['livingcanvas', 'islet', 'mio', 'zh', ['fish', 'dashscope']]);
  assert.match(asked.body.description, /渔家少女/);
  assert.deepEqual(gateway.calls.map((c) => [c.body.model, c.body.voice]), [['fish-s2.1-pro', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'], ['qwen3-tts-flash', 'Cherry']], 'openai is not a route here: skipped');
});

test('play unreachable → the last answer (memory, then disk); never answered → the built-in table', async (t) => {
  signIn(t);
  let up = true;
  const play = await stub((req, res) => (up ? json(res, 200, { candidates: [{ provider: 'dashscope', voiceId: 'Serena', via: 'auto' }] }) : json(res, 503, { error: { code: 'down' } })));
  t.after(play.close);
  const gateway = await stub((req, res) => { res.setHeader('content-type', 'audio/wav'); res.end(WAV); });
  t.after(gateway.close);
  const h = await harness(t, { play, gateway, env: { AIRP_AI_TTS_FISH_MODEL: 'off' } });
  assert.equal((await h.say({ text: '一。', characterId: 'mio' })).headers.get('x-airp-voice-source'), 'play');
  up = false;
  const second = await h.say({ text: '二。', characterId: 'mio' });
  assert.equal(second.headers.get('x-airp-voice-source'), 'cache');
  assert.equal(gateway.calls.at(-1).body.voice, 'Serena');
  const disk = JSON.parse(await fs.readFile(path.join(h.repo, 'play-voice-cache.json'), 'utf8'));
  assert.equal(disk.schema, 'airp.play-voice-cache/1');
  resetPlayVoiceCache(); // a restart: the answer comes back from disk
  assert.equal((await h.say({ text: '三。', characterId: 'mio' })).headers.get('x-airp-voice-source'), 'cache');
  const never = await h.say({ text: '四。', characterId: 'kenta' });
  assert.equal(never.status, 200);
  assert.equal(never.headers.get('x-airp-voice-source'), 'builtin');
  assert.equal(gateway.calls.at(-1).body.voice, 'Eldric Sage', 'built-in: an old man in Chinese');
});

test('signed out with an own DashScope key: play is not asked; the built-in qwen voice (source builtin)', async (t) => {
  const play = await stub((req, res) => json(res, 200, { candidates: [{ provider: 'dashscope', voiceId: 'Serena', via: 'auto' }] }));
  t.after(play.close);
  const h = await harness(t, { play, env: { DASHSCOPE_API_KEY: 'dash-key' } });
  const res = await h.say({ text: '你来了。', characterId: 'mio' });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-airp-voice-source'), 'builtin');
  assert.equal(play.calls.length, 0, 'signed out: play is never asked');
  assert.equal(h.dash.calls.find((c) => c.body).body.input.voice, 'Bunny', 'a girl of fourteen: the built-in Chinese qwen girl');
});

test('a Japanese world with only qwen: Ono Anna for a woman; a man has no Japanese qwen voice → 503, nothing forced', async (t) => {
  const h = await harness(t, { locale: 'ja', worldId: 'islet-jp', env: { DASHSCOPE_API_KEY: 'dash-key' } });
  const res = await h.say({ text: '来たね。', characterId: 'mio' });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-airp-voice-source'), 'builtin');
  assert.equal(h.dash.calls.find((c) => c.body).body.input.voice, 'Ono Anna');
  const man = await h.say({ text: 'そうか。', characterId: 'kenta' });
  assert.equal(man.status, 503);
  assert.deepEqual([(await man.json()).code], ['tts_voice_unavailable']);
});

test('play fails once (5xx) → the next lines do not ask it for 5 minutes; then one probe, and it is back', async (t) => {
  signIn(t);
  let now = 1_000_000;
  let up = false;
  const play = await stub((req, res) => (up ? json(res, 200, { candidates: [{ provider: 'dashscope', voiceId: 'Serena', via: 'auto' }] }) : json(res, 502, { error: { code: 'bad_gateway' } })));
  t.after(play.close);
  const gateway = await stub((req, res) => { res.setHeader('content-type', 'audio/wav'); res.end(WAV); });
  t.after(gateway.close);
  const h = await harness(t, { play, gateway, env: { AIRP_AI_TTS_FISH_MODEL: 'off' } });
  setPlayVoiceClock(() => now);
  const first = await h.say({ text: '一。', characterId: 'mio' });
  assert.equal(first.headers.get('x-airp-voice-source'), 'builtin');
  assert.equal(play.calls.length, 1);
  up = true;
  for (const [text, who] of [['二。', 'mio'], ['三。', 'kenta']]) {
    assert.equal((await h.say({ text, characterId: who })).headers.get('x-airp-voice-source'), 'builtin');
  }
  assert.equal(play.calls.length, 1, 'marked unavailable: no further request to play');
  now += PLAY_DOWN_MS - 1;
  await h.say({ text: '四。', characterId: 'mio' });
  assert.equal(play.calls.length, 1, 'still inside the 5 minutes');
  now += 2;
  const back = await h.say({ text: '五。', characterId: 'mio' });
  assert.equal(play.calls.length, 2, 'after 5 minutes: one probe');
  assert.equal(back.headers.get('x-airp-voice-source'), 'play');
  await h.say({ text: '六。', characterId: 'kenta' });
  assert.equal(play.calls.length, 3, 'up again: asked as usual');
});

test('play unreachable (connection refused) or too slow (> 1.5 s) marks it unavailable too', async (t) => {
  signIn(t);
  const gateway = await stub((req, res) => { res.setHeader('content-type', 'audio/wav'); res.end(WAV); });
  t.after(gateway.close);
  let slowCalls = 0;
  const slow = await stub((req, res) => { slowCalls++; setTimeout(() => json(res, 200, { candidates: [{ provider: 'dashscope', voiceId: 'Serena', via: 'auto' }] }), PLAY_TIMEOUT_MS + 500); });
  t.after(slow.close);
  const h = await harness(t, { play: slow, gateway, env: { AIRP_AI_TTS_FISH_MODEL: 'off' } });
  const started = Date.now();
  const res = await h.say({ text: '慢。', characterId: 'mio' });
  assert.equal(res.headers.get('x-airp-voice-source'), 'builtin');
  assert.ok(Date.now() - started < PLAY_TIMEOUT_MS + 1500, 'the line does not wait for the slow play');
  await h.say({ text: '再说。', characterId: 'kenta' });
  assert.equal(slowCalls, 1, 'timed out once: not asked again');
  resetPlayVoiceCache();
  process.env.AIRP_PLAY_URL = 'http://127.0.0.1:1';
  assert.equal((await h.say({ text: '断。', characterId: 'mio' })).headers.get('x-airp-voice-source'), 'builtin');
});

test('concurrent lines of the same character share one request to play', async (t) => {
  signIn(t);
  const play = await stub((req, res) => setTimeout(() => json(res, 200, { candidates: [{ provider: 'dashscope', voiceId: 'Serena', via: 'auto' }] }), 300));
  t.after(play.close);
  const gateway = await stub((req, res) => { res.setHeader('content-type', 'audio/wav'); res.end(WAV); });
  t.after(gateway.close);
  const h = await harness(t, { play, gateway, env: { AIRP_AI_TTS_FISH_MODEL: 'off' } });
  const all = await Promise.all(['一。', '二。', '三。', '四。'].map((text) => h.say({ text, characterId: 'mio' })));
  assert.deepEqual(all.map((r) => r.headers.get('x-airp-voice-source')), ['play', 'play', 'play', 'play']);
  assert.equal(play.calls.length, 1, 'one request for four lines');
  assert.ok(gateway.calls.every((c) => c.body.voice === 'Serena'));
});
