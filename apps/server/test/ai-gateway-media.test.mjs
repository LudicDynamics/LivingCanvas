// Speech, voice input and images through the Worldlines AI service
// (apps/server/src/ai-gateway.ts) when the server holds no provider key — the
// browser runtime on canvas.worldlines.gg. Runs against built dist: `pnpm build` first.
//
// The service is REPLACED by a local stub (no paid calls); provider config is
// re-read per request, so env set after import takes effect.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { test } from 'node:test';
import { WebSocketServer, WebSocket } from 'ws';
import { LocalWorldStore, createOpenAIImageProvider } from '@airp/shared';
import { createTtsRouter } from '../dist/routes/tts.js';
import { createSttRouter } from '../dist/routes/stt.js';
import { handleSttStream } from '../dist/engine/stt-stream.js';
import { billingStopOf, pcm16Wav, readAiGateway } from '../dist/ai-gateway.js';
import { runConnectionTests } from '../dist/routes/connection-test.js';

// The account's token as remote-client.ts would hand it out (refreshed on `force`);
// the real hook would read ~/.config/airp/remote.json.
globalThis.__airpAccountToken = async ({ force } = {}) => (force ? 'fresh' : 'acct');
process.env.AIRP_REMOTE_CONFIG = path.join(os.tmpdir(), `airp-ai-media-none-${process.pid}.json`);

const WAV = Buffer.from('RIFF\x24\x00\x00\x00WAVEfmt ');
const QUOTA = { error: { code: 'quota_exceeded', kind: 'tts', message: 'Plan used up', billing_url: 'https://worldlines.gg/billing' } };
const ENV_KEYS = ['AIRP_PLAY_URL', 'DASHSCOPE_API_KEY', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'AIRP_TTS_LOCAL_BASE_URL', 'AIRP_TTS_CHARACTER_VOICES', 'AIRP_AI_BASE', 'AIRP_AI_KEY', 'AIRP_TTS_MODEL', 'AIRP_STT_MODEL', 'AIRP_AI_TTS_MODEL'];

/** Stub service: records every request; `reply(path)` → [status, type, body] overrides the default. */
async function serviceStub(reply = () => null) {
  const calls = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      const type = String(req.headers['content-type'] ?? '');
      calls.push({ path: req.url, auth: req.headers.authorization, product: req.headers['x-worldlines-product'], type, json: type.includes('json') ? JSON.parse(raw) : null, raw });
      const custom = reply(req.url);
      const [status, ctype, body, extra = {}] = custom ?? (req.url.endsWith('/audio/speech') ? [200, 'audio/wav', WAV]
        : req.url.endsWith('/audio/transcriptions') ? [200, 'application/json', JSON.stringify({ text: ' hello there ' })]
        : req.url.endsWith('/images/generations') ? [200, 'application/json', JSON.stringify({ data: [{ b64_json: 'iVBORw0K' }] })]
        : [404, 'text/plain', 'no']);
      res.writeHead(status, { 'content-type': ctype, ...extra });
      res.end(body);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${server.address().port}/v1`, calls, close: () => new Promise((r) => server.close(r)) };
}

function useEnv(t, values) {
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  // worldlines-play is not asked here (play-voice.test.mjs fakes it): the built-in voices answer
  Object.assign(process.env, { AIRP_PLAY_URL: 'off' }, values);
  t.after(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
}

async function listen(t, app) {
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  return `http://127.0.0.1:${server.address().port}/api`;
}

const apiSavePaths = new Map();

async function ttsApp(t, manifest) {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-ai-tts-'));
  t.after(() => fs.rm(repo, { recursive: true, force: true }));
  const store = new LocalWorldStore(path.join(repo, 'world'));
  await store.writeFile('world.json', JSON.stringify({ name: 'W', description: '', author: '', genre: 'test', createdAt: '', updatedAt: '', ...manifest }));
  const app = express();
  app.use(express.json());
  app.use('/api', createTtsRouter(repo, () => store, root => root === store.worldRoot));
  const api = await listen(t, app);
  apiSavePaths.set(api, store.worldRoot);
  t.after(() => apiSavePaths.delete(api));
  return api;
}

const post = (url, body, headers = {}) => {
  const api = url.slice(0, url.lastIndexOf('/tts'));
  const savePath = body.savePath ?? apiSavePaths.get(api);
  const payload = savePath === undefined ? body : { ...body, savePath };
  return fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(payload) });
};

test('gateway is off without AIRP_AI_BASE (and not signed in); AIRP_AI_KEY replaces the account', () => {
  assert.equal(readAiGateway({}), null);
  assert.deepEqual(readAiGateway({ AIRP_AI_BASE: 'https://ai.example/v1/' }), { base: 'https://ai.example/v1', apiKey: 'worldlines-account', account: true });
  assert.deepEqual(readAiGateway({ AIRP_AI_BASE: 'https://ai.example/v1', AIRP_AI_KEY: 'pat' }), { base: 'https://ai.example/v1', apiKey: 'pat', account: false });
});

test('TTS: no DashScope key → /audio/speech on the service with the cast voice and language; cached after', async (t) => {
  const ai = await serviceStub();
  t.after(ai.close);
  useEnv(t, { AIRP_AI_BASE: ai.base });
  const api = await ttsApp(t, { id: 'wuwu-zh', locale: 'zh-CN', characters: [] });
  assert.equal((await (await fetch(`${api}/tts/config`)).json()).configured, true);
  const first = await (await post(`${api}/tts`, { text: '你好。', voice: 'Ethan' })).json();
  assert.equal(first.ok, true);
  assert.equal(first.cached, false);
  assert.equal(ai.calls.length, 1);
  assert.equal(ai.calls[0].path, '/v1/audio/speech');
  assert.equal(ai.calls[0].auth, 'Bearer acct');
  assert.equal(ai.calls[0].product, 'livingcanvas');
  assert.deepEqual(ai.calls[0].json, { model: 'qwen3-tts-flash', input: '你好。', voice: 'Ethan', response_format: 'wav', language: 'Chinese' });
  const again = await (await post(`${api}/tts`, { text: '你好。', voice: 'Ethan' })).json();
  assert.equal(again.cached, true);
  assert.equal(ai.calls.length, 1);
  assert.deepEqual(Buffer.from(await (await fetch(`http://127.0.0.1:${new URL(api).port}${again.url}`)).arrayBuffer()), WAV);
});

test('TTS signed out (or a guest of the trial): config says requiresAccount, a line is 401 tts_requires_account, the service is never asked', async (t) => {
  const ai = await serviceStub();
  t.after(ai.close);
  useEnv(t, { AIRP_AI_BASE: ai.base });
  const hook = globalThis.__airpAccountToken;
  globalThis.__airpAccountToken = async () => null;
  t.after(() => { globalThis.__airpAccountToken = hook; });
  const api = await ttsApp(t, { id: 'last-train-prologue-zh', locale: 'zh-CN', characters: [] });
  const config = await (await fetch(`${api}/tts/config`)).json();
  assert.deepEqual([config.configured, config.requiresAccount], [false, true]);
  const res = await post(`${api}/tts`, { text: '你醒了？', voice: 'Cherry' });
  assert.equal(res.status, 401);
  assert.equal((await res.json()).code, 'tts_requires_account');
  assert.equal(ai.calls.length, 0, 'no 401 round trip per line');
  // AIRP_AI_KEY (a service key, not the account): voices work signed out
  useEnv(t, { AIRP_AI_BASE: ai.base, AIRP_AI_KEY: 'pat' });
  assert.equal((await (await fetch(`${api}/tts/config`)).json()).requiresAccount, undefined);
});

test('TTS: the service refuses the caller (401 / 403) → 401 tts_requires_account, not 502 tts_upstream', async (t) => {
  for (const status of [401, 403]) {
    const ai = await serviceStub((p) => (p.endsWith('/audio/speech') ? [status, 'application/json', '{"error":{"code":"guest_not_allowed"}}'] : null));
    t.after(ai.close);
    useEnv(t, { AIRP_AI_BASE: ai.base });
    const api = await ttsApp(t, { id: 'w', locale: 'zh-CN', characters: [] });
    const res = await post(`${api}/tts`, { text: `第${status}行。`, voice: 'Cherry' });
    assert.equal(res.status, 401, String(status));
    assert.equal((await res.json()).code, 'tts_requires_account', String(status));
  }
});

test('TTS: the studio voice through the service is opt-in; opted in, nanami in a Japanese first-snow uses the local model', async (t) => {
  const ai = await serviceStub();
  t.after(ai.close);
  useEnv(t, { AIRP_AI_BASE: ai.base });
  const api = await ttsApp(t, { id: 'first-snow-ja', locale: 'ja', characters: [{ id: 'nanami', home: 'world/map' }] });
  assert.equal((await (await fetch(`${api}/tts/config`)).json()).experimentalLocal, true);
  await post(`${api}/tts`, { text: 'こんにちは。', characterId: 'nanami', emotion: 'smile' });
  assert.equal(ai.calls[0].json.model, 'fish-s2.1-pro'); // not opted in: the cloud voice (Fish through the service by default)
  const res = await (await post(`${api}/tts`, { text: 'こんばんは。', characterId: 'nanami', emotion: 'smile' }, { 'x-airp-tts-local': '1' })).json();
  assert.equal(res.ok, true);
  assert.deepEqual(ai.calls[1].json, { model: 'local-tts', input: 'こんばんは。', voice: 'setsuna', response_format: 'wav', language: 'ja', emotion: 'happy' });
});

test('TTS: an experimental studio voice failure plays the cloud voice for that line, not silence', async (t) => {
  const ai = await serviceStub(function (p) { return this.local++ === 0 ? [502, 'application/json', '{"error":{"code":"upstream"}}'] : null; }.bind({ local: 0 }));
  t.after(ai.close);
  useEnv(t, { AIRP_AI_BASE: ai.base });
  const api = await ttsApp(t, { id: 'first-snow-ja', locale: 'ja', characters: [{ id: 'nanami', home: 'world/map' }] });
  const res = await post(`${api}/tts`, { text: 'こんにちは。', characterId: 'nanami' }, { 'x-airp-tts-local': '1' });
  assert.equal(res.headers.get('x-airp-tts-fallback'), 'local-to-online');
  assert.equal((await res.json()).ok, true);
  assert.deepEqual(ai.calls.map((c) => c.json.model), ['local-tts', 'fish-s2.1-pro'], 'the cloud voice: Fish through the service by default');
});

test('TTS: the service\'s own provider fallback is reported, never retried here', async (t) => {
  const ai = await serviceStub((p) => (p.endsWith('/audio/speech') ? [200, 'audio/wav', WAV, { 'x-worldlines-tts-fallback': 'openai', 'x-worldlines-tts-provider': 'dashscope' }] : null));
  t.after(ai.close);
  useEnv(t, { AIRP_AI_BASE: ai.base });
  const api = await ttsApp(t, { id: 'w', locale: 'en', characters: [] });
  const res = await post(`${api}/tts`, { text: 'Hello.' });
  assert.equal((await res.json()).ok, true);
  assert.equal(res.headers.get('x-airp-tts-fallback'), 'provider');
  assert.equal(ai.calls.length, 1);
});

test('TTS: a quota stop answers 429 quota_exceeded with the billing link; nothing is cached', async (t) => {
  const ai = await serviceStub(() => [429, 'application/json', JSON.stringify(QUOTA)]);
  t.after(ai.close);
  useEnv(t, { AIRP_AI_BASE: ai.base });
  const api = await ttsApp(t, { id: 'w', locale: 'en', characters: [] });
  const res = await post(`${api}/tts`, { text: 'Hello.' });
  assert.equal(res.status, 429);
  assert.deepEqual(await res.json(), { ok: false, code: 'quota_exceeded', error: 'Plan used up', billingUrl: 'https://worldlines.gg/billing', kind: 'tts' });
});

test('TTS: a 402 from the wallet answers 402 with claim_required / insufficient_credits (the client shows the claim or redeem entry)', async (t) => {
  for (const [reason, code] of [['claim_required', 'claim_required'], ['insufficient', 'insufficient_credits']]) {
    const ai = await serviceStub(() => [402, 'application/json', JSON.stringify({ error: { code: 'insufficient_credits', message: 'Top up', kind: 'tts', reason, billing_url: 'https://worldlines.gg/billing' } })]);
    t.after(ai.close);
    useEnv(t, { AIRP_AI_BASE: ai.base });
    const api = await ttsApp(t, { id: 'w', locale: 'en', characters: [] });
    const res = await post(`${api}/tts`, { text: `Hello ${reason}.` });
    assert.equal(res.status, 402);
    assert.equal((await res.json()).code, code);
  }
});

test('billingStopOf: an image tool error names its billing stop (claim_required first)', () => {
  assert.equal(billingStopOf('HTTP 402: code=insufficient_credits; reason=claim_required'), 'claim_required');
  assert.equal(billingStopOf('HTTP 402: code=insufficient_credits; reason=insufficient'), 'insufficient_credits');
  assert.equal(billingStopOf('HTTP 429: code=quota_exceeded'), 'quota_exceeded');
  assert.equal(billingStopOf('HTTP 400: code=invalid_size'), null);
});

test('TTS: signed in, the service speaks even with an own DashScope key', async (t) => {
  const ai = await serviceStub();
  t.after(ai.close);
  useEnv(t, { AIRP_AI_BASE: ai.base, DASHSCOPE_API_KEY: 'own' });
  process.env.AIRP_TTS_BASE_URL = 'http://127.0.0.1:1';
  t.after(() => { delete process.env.AIRP_TTS_BASE_URL; });
  const api = await ttsApp(t, { id: 'w', locale: 'en', characters: [] });
  const res = await post(`${api}/tts`, { text: 'Hello.' });
  assert.equal(res.status, 200);
  assert.equal(ai.calls.at(-1).path, '/v1/audio/speech');
});

test('TTS: signed out, an own DashScope key keeps the direct call; the service is not used', async (t) => {
  const hook = globalThis.__airpAccountToken;
  globalThis.__airpAccountToken = async () => null;
  t.after(() => { globalThis.__airpAccountToken = hook; });
  const ai = await serviceStub();
  t.after(ai.close);
  useEnv(t, { AIRP_AI_BASE: ai.base, DASHSCOPE_API_KEY: 'own' });
  process.env.AIRP_TTS_BASE_URL = 'http://127.0.0.1:1';
  t.after(() => { delete process.env.AIRP_TTS_BASE_URL; });
  const api = await ttsApp(t, { id: 'w', locale: 'en', characters: [] });
  const res = await post(`${api}/tts`, { text: 'Hello.' });
  assert.equal(res.status, 502); // DashScope unreachable — proves which path ran
  assert.equal(ai.calls.length, 0);
});

test('STT route: no OpenAI key → multipart /audio/transcriptions on the service; quota → 429', async (t) => {
  let quota = false;
  const ai = await serviceStub((p) => (quota && p.endsWith('/audio/transcriptions') ? [429, 'application/json', JSON.stringify(QUOTA)] : null));
  t.after(ai.close);
  useEnv(t, { AIRP_AI_BASE: ai.base });
  const app = express();
  app.use('/api', createSttRouter());
  const api = await listen(t, app);
  assert.equal((await (await fetch(`${api}/stt/config`)).json()).available, true);
  const send = () => fetch(`${api}/stt?language=ja`, { method: 'POST', headers: { 'content-type': 'audio/webm' }, body: Buffer.from('opus') });
  assert.deepEqual(await (await send()).json(), { ok: true, text: 'hello there' });
  assert.equal(ai.calls[0].path, '/v1/audio/transcriptions');
  assert.match(ai.calls[0].type, /^multipart\/form-data/);
  const form = ai.calls[0].raw.toString('latin1');
  for (const field of ['gpt-4o-transcribe', 'name="language"', 'speech.webm']) assert.ok(form.includes(field), field);
  quota = true;
  const stopped = await send();
  assert.equal(stopped.status, 429);
  assert.equal((await stopped.json()).billingUrl, 'https://worldlines.gg/billing');
});

/** /ws/stt relay under test: our handler on a local WebSocketServer. */
async function sttRelay(t) {
  const server = http.createServer();
  const wss = new WebSocketServer({ server });
  wss.on('connection', (ws) => handleSttStream(ws));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }));
  const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}`);
  const frames = [];
  ws.on('message', (m) => frames.push(JSON.parse(m.toString())));
  const closed = new Promise((r) => ws.on('close', r));
  await new Promise((r) => ws.on('open', r));
  return { ws, frames, closed };
}

test('/ws/stt via the service: PCM is kept until stop, sent as one wav, one completed transcript', async (t) => {
  const ai = await serviceStub();
  t.after(ai.close);
  useEnv(t, { AIRP_AI_BASE: ai.base });
  const { ws, frames, closed } = await sttRelay(t);
  ws.send(Buffer.alloc(4800));
  ws.send(Buffer.alloc(4800));
  ws.send(JSON.stringify({ type: 'stop' }));
  await closed;
  assert.deepEqual(frames.map((f) => f.type), ['ready', 'transcribing', 'completed']);
  assert.equal(frames[2].transcript, 'hello there');
  assert.equal(ai.calls.length, 1);
  const raw = ai.calls[0].raw;
  const wavAt = raw.indexOf(Buffer.from('RIFF'));
  assert.ok(wavAt > 0);
  assert.equal(raw.readUInt32LE(wavAt + 24), 24000); // sample rate in the wav header
  assert.equal(raw.readUInt32LE(wavAt + 40), 9600); // both frames, nothing lost
});

test('/ws/stt via the service: a quota stop reaches the browser as quota_exceeded; an empty recording bills nothing', async (t) => {
  const ai = await serviceStub(() => [429, 'application/json', JSON.stringify(QUOTA)]);
  t.after(ai.close);
  useEnv(t, { AIRP_AI_BASE: ai.base });
  const a = await sttRelay(t);
  a.ws.send(Buffer.alloc(480));
  a.ws.send(JSON.stringify({ type: 'stop' }));
  await a.closed;
  assert.equal(a.frames.at(-1).code, 'quota_exceeded');
  assert.equal(a.frames.at(-1).billingUrl, 'https://worldlines.gg/billing');
  const b = await sttRelay(t);
  b.ws.send(JSON.stringify({ type: 'stop' }));
  await b.closed;
  assert.deepEqual(b.frames.map((f) => f.type), ['ready']);
  assert.equal(ai.calls.length, 1);
});

test('pcm16Wav writes a valid mono 16-bit header', () => {
  const wav = pcm16Wav(Buffer.alloc(10), 24000);
  assert.equal(wav.toString('latin1', 0, 4), 'RIFF');
  assert.equal(wav.toString('latin1', 8, 12), 'WAVE');
  assert.equal(wav.readUInt32LE(4), 46);
  assert.equal(wav.readUInt16LE(34), 16);
  assert.equal(wav.length, 54);
});

test('images: no OpenAI key → /images/generations on the service; an own key keeps its own base', async () => {
  const seen = [];
  const request = async (url, init) => { seen.push({ url, auth: init.headers.Authorization }); return new Response(JSON.stringify({ data: [{ b64_json: 'AAAA' }] }), { status: 200 }); };
  const viaService = createOpenAIImageProvider('gpt-image-1', { AIRP_AI_BASE: 'https://ai.example/v1' }, request);
  assert.equal((await viaService.generate({ prompt: 'a door', width: 1024, height: 1024 }, {})).ok, true);
  assert.deepEqual(seen[0], { url: 'https://ai.example/v1/images/generations', auth: 'Bearer worldlines-account' });
  const own = createOpenAIImageProvider('gpt-image-1', { OPENAI_API_KEY: 'sk-own', AIRP_AI_BASE: 'https://ai.example/v1' }, request);
  await own.generate({ prompt: 'a door', width: 1024, height: 1024 }, {});
  assert.deepEqual(seen[1], { url: 'https://api.openai.com/v1/images/generations', auth: 'Bearer sk-own' });
  const none = createOpenAIImageProvider('gpt-image-1', {}, request);
  assert.equal((await none.generate({ prompt: 'x', width: 256, height: 256 }, {})).reason, 'no_credentials');
});

test('images: a mid-scene call says X-Worldlines-Scene: in-progress (the gateway may degrade a wallet-short image); others do not', async () => {
  const seen = [];
  const request = async (_url, init) => { seen.push(init.headers['X-Worldlines-Scene']); return new Response(JSON.stringify({ data: [{ b64_json: 'AAAA' }] }), { status: 200 }); };
  const p = createOpenAIImageProvider('gpt-image-1', { AIRP_AI_BASE: 'https://ai.example/v1' }, request);
  await p.generate({ prompt: 'a door', width: 1024, height: 1024 }, { scene: 'in-progress' });
  await p.generate({ prompt: 'a door', width: 1024, height: 1024 }, {});
  assert.deepEqual(seen, ['in-progress', undefined]);
});

test('connection self-test does not spend the account on probes through the service', async (t) => {
  const ai = await serviceStub();
  t.after(ai.close);
  useEnv(t, { AIRP_AI_BASE: ai.base });
  const checks = await runConnectionTests({ agentModels: async () => null });
  const byId = Object.fromEntries(checks.map((c) => [c.id, c]));
  assert.equal(byId['tts-online'].status, 'skipped');
  assert.match(byId['tts-online'].detail, /Worldlines AI service/);
  assert.equal(byId.stt.status, 'skipped');
  assert.equal(ai.calls.length, 0);
});
