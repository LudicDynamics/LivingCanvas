// Fish Audio: own-key request shape, provider choice, roster-only casting, signed-in → AI service, errors.
// Runs against built dist (`pnpm build` first). Fish Audio and DashScope are local stubs.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { test } from 'node:test';
import { LocalWorldStore, VOICE_ROSTER, castWorldVoice, rosterAllows } from '@airp/shared';
import { createTtsRouter } from '../dist/routes/tts.js';
import { readFishTtsConfig, ttsProviderOf, isFishGatewayModel } from '../dist/routes/fish-tts.js';
import { BUILTIN_ASSIGNED, BUILTIN_VOICES, builtinCandidates } from '../dist/builtin-voices.js';

const WAV = Buffer.from('RIFF\x24\x00\x00\x00WAVEfmt fish');
const KEYS = ['AIRP_PLAY_URL', 'FISH_AUDIO_API_KEY', 'FISH_API_KEY', 'AIRP_AI_BASE', 'AIRP_AI_KEY', 'AIRP_AI_TTS_MODEL', 'AIRP_AI_TTS_FISH_MODEL', 'AIRP_FISH_TTS_BASE_URL', 'AIRP_FISH_TTS_MODEL', 'AIRP_TTS_PROVIDER', 'AIRP_TTS_BASE_URL',
  'DASHSCOPE_API_KEY', 'AIRP_TTS_MODEL', 'AIRP_TTS_DEFAULT_VOICE', 'AIRP_TTS_LOCAL_BASE_URL', 'AIRP_LOCAL_TTS', 'AIRP_AI_ACCOUNT'];
const SECRET = 'fish-secret-key-do-not-echo';

function stub(handler) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      calls.push({ url: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : null });
      handler(req, res, server);
    });
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({
    base: `http://127.0.0.1:${server.address().port}`, calls, close: () => new Promise((d) => server.close(d)),
  })));
}

const fishOk = (_req, res) => { res.setHeader('content-type', 'audio/wav'); res.end(WAV); };
const dashOk = (req, res, server) => {
  if (req.url.includes('/services/aigc/')) {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ output: { audio: { url: `http://127.0.0.1:${server.address().port}/blob.wav` } } }));
  } else res.end(WAV);
};

const CHARACTERS = [
  { id: 'martel', home: 'world/x', description: 'Chief authenticator of the museum, in her early fifties, severe and brilliant. Her fingertips carry old paint.' },
  { id: 'suzu', home: 'world/x', description: '守灯塔的老婆婆，七十六岁，银发挽成圆髻。' },
  { id: 'librarian', home: 'world/x', description: 'A librarian who keeps track of every loan and return.' },
  { id: 'ross', home: 'world/x', description: 'Business partner, forty-five years old.' },
];
const README = { martel: 'cool-composed', suzu: null, librarian: 'wise-elder', ross: 'bold-resonant' };
const GENDER = { ross: 'male' };

async function harness(t, { fish = fishOk, env = {}, locale = 'zh-CN', worldId = 'p' } = {}) {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-fish-'));
  const world = path.join(repo, 'w');
  const store = new LocalWorldStore(world);
  await store.writeFile('world.json', JSON.stringify({ id: worldId, name: 'P', description: '', author: '', genre: 't', createdAt: '', updatedAt: '', locale, characters: CHARACTERS }));
  for (const c of CHARACTERS) {
    const lines = ['---', 'type: readme', `name: ${c.id}`];
    if (README[c.id]) lines.push(`voice: ${README[c.id]}`);
    if (GENDER[c.id]) lines.push(`gender: ${GENDER[c.id]}`);
    await store.writeFile(`characters/${c.id}/README.md`, `${lines.join('\n')}\n---\n`);
  }
  const fishStub = await stub(fish);
  const dashStub = await stub(dashOk);
  Object.assign(process.env, {
    FISH_AUDIO_API_KEY: SECRET, AIRP_FISH_TTS_BASE_URL: fishStub.base,
    DASHSCOPE_API_KEY: 'dash-key', AIRP_TTS_BASE_URL: dashStub.base, AIRP_TTS_MODEL: 'qwen3-tts-flash', AIRP_AI_ACCOUNT: '0',
    AIRP_PLAY_URL: 'off', // worldlines-play is not asked here (play-voice.test.mjs fakes it): the built-in voices answer
  }, env);
  const app = express();
  app.use(express.json());
  app.use('/api', createTtsRouter(repo, () => store, (root) => root === world));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  t.after(async () => {
    server.close();
    await fishStub.close();
    await dashStub.close();
    try { store.close(); } catch {}
    await fs.rm(repo, { recursive: true, force: true });
    for (const k of KEYS) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  });
  const say = (body) => fetch(`${base}/tts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ savePath: world, language: 'zh', ...body }) });
  return { base, say, fishStub, dashStub, world };
}

const fallback = (cell) => VOICE_ROSTER.fallback[cell];
const declared = (alias) => castWorldVoice(alias).voice.id;

test('provider choice: Fish when FISH_AUDIO_API_KEY is set, AIRP_TTS_PROVIDER overrides, fish-… gateway models', () => {
  assert.equal(ttsProviderOf({}), 'dashscope');
  assert.equal(ttsProviderOf({ FISH_AUDIO_API_KEY: 'k' }), 'fish');
  assert.equal(ttsProviderOf({ FISH_AUDIO_API_KEY: 'k', AIRP_TTS_PROVIDER: 'dashscope' }), 'dashscope');
  assert.equal(ttsProviderOf({ AIRP_TTS_PROVIDER: 'fish' }), 'fish');
  assert.equal(ttsProviderOf({ FISH_API_KEY: 'k' }), 'fish', 'the play tools\' variable name works too');
  assert.equal(readFishTtsConfig({ FISH_AUDIO_API_KEY: '', FISH_API_KEY: 'k2' }).apiKey, 'k2');
  assert.equal(readFishTtsConfig({}).model, 's2.1-pro');
  assert.equal(readFishTtsConfig({ AIRP_FISH_TTS_MODEL: 's2.1-pro-free' }).model, 's2.1-pro-free');
  assert.equal(readFishTtsConfig({ AIRP_FISH_TTS_MODEL: 'nonsense' }).model, 's2.1-pro');
  assert.equal(readFishTtsConfig({}).baseUrl, 'https://api.fish.audio');
  assert.ok(isFishGatewayModel('fish-s2.1-pro'));
  assert.ok(!isFishGatewayModel('qwen3-tts-flash'));
});

test('Fish request shape: POST /v1/tts, Bearer key, model header, reference_id + wav', async (t) => {
  const h = await harness(t);
  const res = await h.say({ text: '先叫谁进来？', voice: 'wise-elder', characterId: 'librarian' });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(h.fishStub.calls.length, 1);
  assert.equal(h.dashStub.calls.length, 0, 'DashScope is not called when Fish speaks');
  const call = h.fishStub.calls[0];
  assert.equal(call.url, '/v1/tts');
  assert.equal(call.headers.authorization, `Bearer ${SECRET}`);
  assert.equal(call.headers.model, 's2.1-pro');
  assert.equal(call.body.reference_id, BUILTIN_VOICES.fish.zh.male.old, 'wise-elder → an old man: signed out, the built-in Fish old man (play is not asked)');
  assert.equal(res.headers.get('x-airp-voice-source'), 'builtin');
  assert.equal(VOICE_ROSTER.voices.find((v) => v.id === call.body.reference_id).age, 'old');
  assert.equal(call.body.format, 'wav');
  assert.equal(call.body.text, '先叫谁进来？');
  // cached on the second ask
  const again = await (await h.say({ text: '先叫谁进来？', voice: 'wise-elder', characterId: 'librarian' })).json();
  assert.equal(again.cached, true);
  assert.equal(h.fishStub.calls.length, 1);
});

test('a declared voice of the other sex is overruled by the character (马特尔 cool-composed → a woman)', async (t) => {
  const h = await harness(t);
  await h.say({ text: '第八夜。', voice: 'cool-composed', characterId: 'martel' });
  assert.equal(h.fishStub.calls[0].body.reference_id, fallback('female/middle'));
  await h.say({ text: '欠钱我认。', voice: 'bold-resonant', characterId: 'ross' });
  assert.equal(h.fishStub.calls[1].body.reference_id, fallback('male/middle'), 'README gender: male wins over a female voice');
});

test('signed out (play not asked): no voice / unknown voice → the built-in voice by sex × age band', async (t) => {
  const h = await harness(t);
  await h.say({ text: '后生。', characterId: 'suzu' });
  assert.equal(h.fishStub.calls[0].body.reference_id, BUILTIN_VOICES.fish.zh.female.old);
  await h.say({ text: '嗯。', voice: 'Eldric', characterId: 'suzu' });
  assert.equal(h.fishStub.calls[1].body.reference_id, BUILTIN_VOICES.fish.zh.female.old);
  await h.say({ text: '你好。' });
  assert.equal(h.fishStub.calls[2].body.reference_id, BUILTIN_VOICES.fish.zh.female.young, 'nothing known → the young woman');
  const spoken = new Set(h.fishStub.calls.map((c) => c.body.reference_id));
  for (const ref of spoken) assert.ok(rosterAllows(VOICE_ROSTER, ref), 'only roster voices reach Fish');
});

test("niko's assigned voices (assignments.json): first on a Fish route, one per language, beating the declaration", () => {
  const ja = builtinCandidates({ providers: ['fish', 'dashscope'], lang: 'ja', gender: 'female', age: 'middle', declared: 'Ono Anna', declaredFirst: true, family: 'forger', character: 'martel' });
  assert.deepEqual(ja[0], { provider: 'fish', voiceId: BUILTIN_ASSIGNED.forger.martel.ja, via: 'assigned' });
  assert.deepEqual(ja.slice(1), builtinCandidates({ providers: ['dashscope'], lang: 'ja', gender: 'female', age: 'middle', declared: 'Ono Anna', declaredFirst: true }), 'qwen keeps its cell after it');
  for (const lang of ['zh', 'ja', 'en', 'ko']) assert.equal(builtinCandidates({ providers: ['fish'], lang, family: 'islet', character: 'kenta' })[0].voiceId, BUILTIN_ASSIGNED.islet.kenta[lang]);
  assert.equal(builtinCandidates({ providers: ['dashscope'], lang: 'zh', gender: 'female', age: 'middle', family: 'forger', character: 'martel' })[0].provider, 'dashscope', 'qwen-only: the cell, never a Fish id');
  assert.equal(builtinCandidates({ providers: ['fish'], lang: 'zh', gender: 'female', age: 'middle', family: 'forger', character: 'nobody' })[0].via, 'builtin', 'unassigned: the cell');
  assert.equal(builtinCandidates({ providers: ['fish'], lang: 'zh', gender: 'female', age: 'middle', character: 'martel' })[0].via, 'builtin', 'no family: the cell');
});

test("TTS speaks niko's assigned Fish voice for the edition's language (forger-jp / forger / forger-zh martel)", async (t) => {
  for (const [worldId, locale, lang] of [['forger-jp', 'ja', 'ja'], ['forger', 'en', 'en'], ['forger-zh', 'zh-CN', 'zh']]) {
    const h = await harness(t, { worldId, locale });
    const res = await h.say({ text: 'Eighth night.', voice: 'cool-composed', characterId: 'martel', language: lang });
    assert.equal(res.status, 200, worldId);
    assert.equal(h.fishStub.calls[0].body.reference_id, BUILTIN_ASSIGNED.forger.martel[lang], worldId);
    assert.equal(res.headers.get('x-airp-voice-source'), 'builtin');
  }
});

test('AIRP_TTS_PROVIDER=dashscope keeps DashScope even with a Fish key', async (t) => {
  const h = await harness(t, { env: { AIRP_TTS_PROVIDER: 'dashscope' } });
  const res = await h.say({ text: '嗯。', voice: 'wise-elder', characterId: 'librarian' });
  assert.equal(res.status, 200);
  assert.equal(h.fishStub.calls.length, 0);
  assert.equal(h.dashStub.calls.filter((c) => c.body).length, 1);
  assert.equal(h.dashStub.calls[0].body.input.voice, 'Eldric Sage');
});

test('Fish errors map to tts_upstream and never echo the key; a non-wav body is not cached', async (t) => {
  const h = await harness(t, { fish: (_req, res) => { res.statusCode = 402; res.end(JSON.stringify({ message: 'payment' })); }, env: { DASHSCOPE_API_KEY: '' } }); // no qwen route: the Fish error itself
  const res = await h.say({ text: '嗯。', voice: 'wise-elder', characterId: 'librarian' });
  const text = await res.text();
  assert.equal(res.status, 502);
  assert.match(text, /tts_upstream/);
  assert.ok(!text.includes(SECRET));
});

test('Fish returning html is refused (magic-byte gate)', async (t) => {
  const h = await harness(t, { fish: (_req, res) => { res.end('<html>oops</html>'); }, env: { DASHSCOPE_API_KEY: '' } }); // no qwen route: the Fish error itself
  const res = await h.say({ text: '嗯。', voice: 'wise-elder', characterId: 'librarian' });
  assert.equal(res.status, 502);
  const again = await h.say({ text: '嗯。', voice: 'wise-elder', characterId: 'librarian' });
  assert.equal(again.status, 502, 'nothing was cached');
});

test('/tts/config reports Fish as configured with only a Fish key', async (t) => {
  const h = await harness(t);
  delete process.env.DASHSCOPE_API_KEY;
  const config = await (await fetch(`${h.base}/tts/config`)).json();
  assert.equal(config.configured, true);
  assert.equal(config.model, 'fish-audio/s2.1-pro');
  assert.ok(!JSON.stringify(config).includes(SECRET));
});

test('signed in: voices go through the AI service (fish model, roster reference_id), even with local keys', async (t) => {
  const gw = await stub((req, res) => { res.setHeader('content-type', 'audio/wav'); res.end(WAV); });
  t.after(() => gw.close());
  const hooks = globalThis;
  const saved = hooks.__airpAccountToken;
  hooks.__airpAccountToken = async () => 'account-token';
  t.after(() => { hooks.__airpAccountToken = saved; });
  const h = await harness(t, { env: { AIRP_AI_BASE: gw.base, AIRP_AI_TTS_MODEL: 'fish-s2.1-pro' } });
  const res = await h.say({ text: '后生，醒醒。', characterId: 'suzu' });
  assert.equal(res.status, 200, await res.clone().text());
  assert.equal(h.fishStub.calls.length, 0, 'the own Fish key is not used when signed in');
  assert.equal(h.dashStub.calls.length, 0, 'nor the own DashScope key');
  const call = gw.calls.at(-1);
  assert.equal(call.url, '/audio/speech');
  assert.equal(call.headers.authorization, 'Bearer account-token');
  assert.equal(call.body.model, 'fish-s2.1-pro');
  assert.equal(call.body.voice, fallback('female/old'), 'reference_id resolved here, not by the service');
  assert.equal(call.body.response_format, 'wav');
  const config = await (await fetch(`${h.base}/tts/config`)).json();
  assert.equal(config.configured, true);
  assert.equal(config.model, 'fish-s2.1-pro');
});

test('signed out with an account gateway and no key: still asks for an account (unchanged)', async (t) => {
  const gw = await stub((req, res) => { res.end(WAV); });
  t.after(() => gw.close());
  const h = await harness(t, { env: { AIRP_AI_BASE: gw.base, AIRP_AI_TTS_MODEL: 'fish-s2.1-pro' } });
  delete process.env.FISH_AUDIO_API_KEY;
  delete process.env.DASHSCOPE_API_KEY;
  const res = await h.say({ text: '嗯。', characterId: 'suzu' });
  assert.equal(res.status, 401);
  assert.equal(gw.calls.length, 0);
});

test('mixed providers through the service: the model follows the cast voice\'s provider; without Fish there, the nearest qwen voice', async (t) => {
  const gw = await stub((req, res) => { res.setHeader('content-type', 'audio/wav'); res.end(WAV); });
  t.after(() => gw.close());
  const hooks = globalThis;
  const saved = hooks.__airpAccountToken;
  hooks.__airpAccountToken = async () => 'account-token';
  t.after(() => { hooks.__airpAccountToken = saved; });
  // a qwen voice on the roster, with Fish available: spoken by qwen, never sent to a fish model
  const h = await harness(t, { env: { AIRP_AI_BASE: gw.base, AIRP_AI_TTS_MODEL: 'fish-s2.1-pro' } });
  assert.equal((await h.say({ text: '后生。', voice: 'Eldric Sage', characterId: 'librarian' })).status, 200);
  assert.deepEqual([gw.calls.at(-1).body.model, gw.calls.at(-1).body.voice], ['qwen3-tts-flash', 'Eldric Sage']);
  // Fish through the service switched off (AIRP_AI_TTS_FISH_MODEL=off): a Fish cast becomes the roster's nearest qwen voice
  delete process.env.AIRP_AI_TTS_MODEL;
  process.env.AIRP_AI_TTS_FISH_MODEL = 'off';
  assert.equal((await h.say({ text: '后生，醒醒。', characterId: 'suzu' })).status, 200);
  const call = gw.calls.at(-1);
  assert.equal(call.body.model, 'qwen3-tts-flash');
  const v = VOICE_ROSTER.voices.find((x) => x.id === call.body.voice);
  assert.equal(v?.provider, 'dashscope', `${call.body.voice} is a qwen voice on the roster`);
  assert.equal(v.gender, 'female');
});

test('signed in with nothing configured: Fish voices go to the service as fish-s2.1-pro (the default since the service serves Fish)', async (t) => {
  const gw = await stub((req, res) => { res.setHeader('content-type', 'audio/wav'); res.end(WAV); });
  t.after(() => gw.close());
  const hooks = globalThis;
  const saved = hooks.__airpAccountToken;
  hooks.__airpAccountToken = async () => 'account-token';
  t.after(() => { hooks.__airpAccountToken = saved; });
  const h = await harness(t, { env: { AIRP_AI_BASE: gw.base } });
  assert.equal((await h.say({ text: '后生，醒醒。', characterId: 'suzu' })).status, 200);
  const call = gw.calls.at(-1);
  assert.equal(call.body.model, 'fish-s2.1-pro');
  assert.equal(VOICE_ROSTER.voices.find((x) => x.id === call.body.voice)?.provider, 'fish');
});

const failWith = (status) => (_req, res) => { res.statusCode = status; res.end(JSON.stringify({ message: 'no' })); };
const cacheFiles = async (h) => (await fs.readdir(path.join(h.world, '.airpworld', 'tts-cache')).catch(() => [])).filter((f) => f.endsWith('.wav'));

for (const status of [402, 500]) {
  test(`own Fish key fails with ${status} → retried once on the nearest native qwen voice of the same sex (X-AIRP-TTS-Fallback: fish-to-qwen); cached under the qwen voice`, async (t) => {
    const h = await harness(t, { fish: failWith(status) });
    const res = await h.say({ text: '后生，醒醒。', characterId: 'suzu' });
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(res.headers.get('x-airp-tts-fallback'), 'fish-to-qwen');
    assert.equal(h.fishStub.calls.length, 1, 'Fish tried once');
    const qwen = h.dashStub.calls.find((c) => c.body)?.body.input.voice;
    const v = VOICE_ROSTER.voices.find((x) => x.id === qwen);
    assert.equal(v.provider, 'dashscope');
    assert.equal(v.only, 'zh', 'a qwen voice that speaks the world language natively');
    assert.equal(v.gender, 'female', 'same sex as the character');
    assert.equal((await cacheFiles(h)).length, 1, 'only the qwen take is cached; the failed Fish attempt wrote nothing');
    const again = await h.say({ text: '后生，醒醒。', characterId: 'suzu' });
    assert.equal((await again.json()).cached, true, 'the qwen take is found again by its own key');
    assert.equal(h.dashStub.calls.filter((c) => c.body).length, 1, 'qwen not asked twice');
  });
}

test('own Fish key fails and the world language has no native qwen voice of that sex → the Fish error, nothing forced', async (t) => {
  const h = await harness(t, { fish: failWith(500), locale: 'ja' });
  const res = await h.say({ text: 'まあな。', characterId: 'ross', language: 'ja' });
  assert.equal(res.status, 502);
  assert.equal((await res.json()).code, 'tts_upstream');
  assert.equal(h.dashStub.calls.filter((c) => c.body).length, 0, 'no Japanese qwen man: qwen is not asked');
  assert.equal((await cacheFiles(h)).length, 0);
});

test('own Fish key fails and there is no qwen route (no DashScope key, not signed in) → the Fish error', async (t) => {
  const h = await harness(t, { fish: failWith(402), env: { DASHSCOPE_API_KEY: '' } });
  const res = await h.say({ text: '后生。', characterId: 'suzu' });
  assert.equal(res.status, 502);
  assert.equal(res.headers.get('x-airp-tts-fallback'), null);
});
