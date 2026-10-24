// Static-site pieces: the model gateway fetch (token, product header, 401
// re-auth, 429 quota, CORS-safe headers, cut streams) and storage's public
// world list → catalog entries.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const r = await esbuild.build({
  stdin: { contents: `export * from './src/platform/model-gateway.ts'; export { publicEntry, createCatalog, trialBlobBase } from './src/catalog.ts';`, resolveDir: path.join(HERE, '..'), loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'error',
});
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'airp-prod-')), 'p.mjs');
fs.writeFileSync(tmp, r.outputFiles[0].text);
const m = await import(pathToFileURL(tmp).href);

const BASE = 'https://ai.example/v1';
function harness(responses, tokens = ['t1', 't2']) {
  const seen = [];
  let authRequired = 0;
  const direct = async (url, init) => {
    seen.push({ url: String(url), headers: Object.fromEntries(new Headers(init?.headers).entries()), body: init?.body });
    const next = responses.shift();
    return typeof next === 'function' ? next() : next;
  };
  const f = m.createGatewayFetch(direct, {
    base: BASE, product: 'livingcanvas', map: { 'deepseek-v4-flash': 'deepseek-chat' },
    token: async (force) => (force ? tokens[1] : tokens[0]) ?? null,
    onAuthRequired: () => { authRequired++; },
  });
  return { f, seen, authRequired: () => authRequired };
}
const ok = (text = 'data: {}\n\n') => new Response(text, { status: 200, headers: { 'content-type': 'text/event-stream' } });

test('gateway: token, product header, only CORS-safe headers, model renamed; other URLs untouched', async () => {
  const h = harness([ok(), ok('other')]);
  const res = await h.f(`${BASE}/chat/completions`, { method: 'POST', headers: { authorization: 'Bearer worldlines-account', 'content-type': 'application/json', 'x-stainless-os': 'x' }, body: JSON.stringify({ model: 'deepseek-v4-flash' }) });
  assert.equal(await res.text(), 'data: {}\n\n');
  assert.deepEqual(h.seen[0].headers, { authorization: 'Bearer t1', 'content-type': 'application/json', 'x-worldlines-product': 'livingcanvas' });
  assert.equal(JSON.parse(h.seen[0].body).model, 'deepseek-chat');
  await h.f('https://elsewhere.example/x', { headers: { 'x-a': '1' } });
  assert.equal(h.seen[1].headers['x-a'], '1');
  assert.equal(h.seen[1].headers.authorization, undefined);
});

test('gateway: x-worldlines-scene (image degrade signal) is forwarded', async () => {
  const h = harness([ok()]);
  await h.f(`${BASE}/images/generations`, { method: 'POST', headers: { 'content-type': 'application/json', 'X-Worldlines-Scene': 'in-progress' }, body: '{}' });
  assert.equal(h.seen[0].headers['x-worldlines-scene'], 'in-progress');
});

test('gateway: 401 → refreshed token, retried once; still 401 → sign-in asked, non-retryable error', async () => {
  const h = harness([new Response('', { status: 401 }), ok()]);
  assert.equal((await h.f(`${BASE}/chat/completions`, { method: 'POST', body: '{}' })).status, 200);
  assert.equal(h.seen[1].headers.authorization, 'Bearer t2');
  assert.equal(h.authRequired(), 0);
  const h2 = harness([new Response('', { status: 401 }), new Response('', { status: 401 })]);
  const res = await h2.f(`${BASE}/chat/completions`, { method: 'POST', body: '{}' });
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error.code, 'auth_required');
  assert.equal(h2.authRequired(), 1);
});

test('gateway: signed out → no request, sign-in asked', async () => {
  const h = harness([], [null, null]);
  const res = await h.f(`${BASE}/chat/completions`, { method: 'POST', body: '{}' });
  assert.equal(res.status, 401);
  assert.equal(h.seen.length, 0);
  assert.equal(h.authRequired(), 1);
});

test('gateway: 429 quota_exceeded → friendly "quota exceeded"; other 429 passes through', async () => {
  const quota = new Response(JSON.stringify({ error: { code: 'quota_exceeded', message: 'x' } }), { status: 429 });
  const h = harness([quota, new Response(JSON.stringify({ error: { code: 'concurrency_limit' } }), { status: 429 })]);
  const a = await h.f(`${BASE}/chat/completions`, { method: 'POST', body: '{}' });
  const body = await a.json();
  assert.equal(a.status, 429);
  assert.equal(body.error.code, 'quota_exceeded');
  assert.match(body.error.message, /quota exceeded/);
  const b = await h.f(`${BASE}/chat/completions`, { method: 'POST', body: '{}' });
  assert.equal((await b.json()).error.code, 'concurrency_limit');
});

test('gateway: media calls — kind / billing_url survive the quota rewrite; a multipart upload keeps its boundary', async () => {
  const quota = new Response(JSON.stringify({ error: { code: 'quota_exceeded', kind: 'tts', billing_url: 'https://worldlines.gg/billing' } }), { status: 429 });
  const h = harness([quota, new Response('{"text":"hi"}', { status: 200 })]);
  const a = await (await h.f(`${BASE}/audio/speech`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json();
  assert.equal(a.error.kind, 'tts');
  assert.equal(a.error.billing_url, 'https://worldlines.gg/billing');
  const form = new FormData();
  form.append('model', 'gpt-4o-transcribe');
  await h.f(`${BASE}/audio/transcriptions`, { method: 'POST', headers: { authorization: 'Bearer worldlines-account' }, body: form });
  assert.equal(h.seen[1].body, form);
  assert.equal(h.seen[1].headers['content-type'], undefined); // fetch sets multipart + boundary itself
  assert.equal(h.seen[1].headers.authorization, 'Bearer t1');
});

test('gateway: a stream cut mid-way errors as a retryable network error', async () => {
  let n = 0;
  const cut = new ReadableStream({ pull(c) { if (n++ === 0) c.enqueue(new TextEncoder().encode('data: 1\n\n')); else c.error(new Error('terminated')); } });
  const h = harness([new Response(cut, { status: 200 })]);
  const res = await h.f(`${BASE}/chat/completions`, { method: 'POST', body: '{}' });
  await assert.rejects(res.text(), /network error: the model stream was cut/);
});

test('public list entry → catalog world (stub world.json, cover by URL, template vs made)', () => {
  const e = { id: 'whitechapel-zh', name: '白教堂', description: 'd', locale: 'zh-CN', edition_group: 'whitechapel', revision: 3, hash: 'sha256:abc', size: 10, publisher: 'Worldlines 官方', cover_url: '/v1/public/livingcanvas/worlds/whitechapel-zh/cover?rev=3' };
  const w = m.publicEntry(e, 'https://storage.example');
  assert.equal(w.source, 'template');
  assert.equal(w.edition, 'whitechapel');
  assert.equal(w.coverUrl, 'https://storage.example/v1/public/livingcanvas/worlds/whitechapel-zh/cover?rev=3');
  assert.equal(w.world.cover, w.cover.path);
  assert.equal(w.world.locale, 'zh-CN');
  assert.equal(m.publicEntry({ ...e, id: 'made-abc', cover_url: null }, 'https://s').source, 'published');
  assert.equal(m.publicEntry({ ...e, id: 'made-abc', cover_url: null }, 'https://s').cover, null);
  assert.equal(m.publicEntry({ id: 'x', revision: 0, hash: 'h' }, 'https://s'), null);
});

// ── the guest trial ──
function guestHarness(responses, guest = 'g1') {
  const seen = [];
  const asked = [];
  const direct = async (url, init) => { seen.push({ url: String(url), headers: Object.fromEntries(new Headers(init?.headers).entries()) }); return responses.shift(); };
  const f = m.createGatewayFetch(direct, {
    base: BASE, product: 'livingcanvas', token: async () => null, guestToken: async () => guest,
    onAuthRequired: (reason) => { asked.push(reason ?? null); },
  });
  return { f, seen, asked };
}
const errorRes = (status, code) => new Response(JSON.stringify({ error: { code, message: code } }), { status, headers: { 'content-type': 'application/json' } });

test('guest trial: signed out, the guest token signs the chat call; no sign-in asked', async () => {
  const h = guestHarness([ok()]);
  assert.equal((await h.f(`${BASE}/chat/completions`, { method: 'POST', body: '{}' })).status, 200);
  assert.equal(h.seen[0].headers.authorization, 'Bearer g1');
  assert.deepEqual(h.asked, []);
});

test('guest trial: no guest token (not the trial world) → sign-in asked as before', async () => {
  const h = guestHarness([], null);
  assert.equal((await h.f(`${BASE}/chat/completions`, { method: 'POST', body: '{}' })).status, 401);
  assert.deepEqual(h.asked, [null]);
});

test('guest trial: credits used up / past the trial → one non-retryable "billing" 402 and the trial sign-in prompt', async () => {
  for (const [status, code] of [[402, 'insufficient_credits'], [403, 'guest_world_only'], [503, 'guest_trial_unavailable']]) {
    const h = guestHarness([errorRes(status, code)]);
    const r = await h.f(`${BASE}/chat/completions`, { method: 'POST', body: '{}' });
    assert.equal(r.status, 402, code);
    const body = await r.json();
    assert.equal(body.error.reason, 'trial_used');
    assert.match(body.error.message, /billing/);
    assert.match(body.error.message, /500-credit newcomer gift/);
    assert.deepEqual(h.asked, ['trial'], code);
  }
  // an ordinary upstream hiccup is not the end of the trial
  const h = guestHarness([errorRes(503, 'upstream_unavailable')]);
  assert.equal((await h.f(`${BASE}/chat/completions`, { method: 'POST', body: '{}' })).status, 503);
  assert.deepEqual(h.asked, []);
});

test('guest trial: pictures / transcription are not sent for a guest, and do not pop the sign-in', async () => {
  for (const p of ['/images/generations', '/audio/transcriptions']) {
    const h = guestHarness([]);
    const r = await h.f(`${BASE}${p}`, { method: 'POST', body: '{}' });
    assert.equal(r.status, 403, p);
    assert.equal(h.seen.length, 0, p);
    assert.deepEqual(h.asked, [], p);
  }
});

test('guest trial: speech is signed with the guest token (fish_cap fallback header kept); no sign-in asked', async () => {
  const wav = new Response('RIFF', { status: 200, headers: { 'content-type': 'audio/wav', 'x-worldlines-tts-fallback': 'fish->dashscope (fish_cap)' } });
  const h = guestHarness([wav]);
  const r = await h.f(`${BASE}/audio/speech`, { method: 'POST', body: '{}' });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('x-worldlines-tts-fallback'), 'fish->dashscope (fish_cap)');
  assert.equal(h.seen[0].headers.authorization, 'Bearer g1');
  assert.deepEqual(h.asked, []);
});

test('guest trial: voice allowance used up (429 guest_tts_exhausted) → a non-retryable "quota exceeded" 429, no trial popup', async () => {
  const h = guestHarness([errorRes(429, 'guest_tts_exhausted')]);
  const r = await h.f(`${BASE}/audio/speech`, { method: 'POST', body: '{}' });
  assert.equal(r.status, 429);
  const body = await r.json();
  assert.equal(body.error.code, 'guest_tts_exhausted');
  assert.match(body.error.message, /quota exceeded/);
  assert.deepEqual(h.asked, []);
  // a guest's speech 402 (trial credits gone) is the end of the trial, as for chat
  const g = guestHarness([errorRes(402, 'insufficient_credits')]);
  assert.equal((await g.f(`${BASE}/audio/speech`, { method: 'POST', body: '{}' })).status, 402);
  assert.deepEqual(g.asked, ['trial']);
});

test('character tick v2: a quiet call (x-airp-quiet) never opens the sign-in — outside the trial world, or when the trial / wallet refuses; the header is not forwarded', async () => {
  const quiet = { method: 'POST', headers: { 'content-type': 'application/json', 'x-airp-quiet': '1' }, body: '{}' };
  const outside = guestHarness([], null);
  assert.equal((await outside.f(`${BASE}/chat/completions`, quiet)).status, 401);
  assert.deepEqual(outside.asked, []);
  for (const [status, code] of [[402, 'insufficient_credits'], [403, 'guest_world_only']]) {
    const h = guestHarness([errorRes(status, code)]);
    assert.equal((await h.f(`${BASE}/chat/completions`, quiet)).status, 402, code);
    assert.deepEqual(h.asked, [], code);
    assert.equal(h.seen[0].headers['x-airp-quiet'], undefined);
  }
});

// ── the shipped trial worlds in the services catalog ──
function fakeCaches() {
  const stores = new Map();
  return { async open(name) { if (!stores.has(name)) { const m = new Map(); stores.set(name, { async keys() { return [...m.keys()].map((url) => ({ url })); }, async match(k) { const v = m.get(typeof k === 'string' ? k : k.url); return v ? v.clone() : undefined; }, async put(k, r) { m.set(typeof k === 'string' ? k : k.url, r); } }); } return stores.get(name); } };
}
test('catalog: trial worlds from the site (no token, no storage), listed even when storage is down, never twice', async () => {
  const TRIAL = 'https://canvas.example/runtime/abc/trial.json';
  const index = { worlds: [{ id: 'last-train-zh', hash: 'sha256:t1', size: 3, world: { id: 'last-train-zh', name: '末班车', locale: 'zh-CN' }, files: [{ path: 'world.json', size: 3, sha256: 'aa' }] }] };
  const seen = [];
  let storageUp = false;
  const prevFetch = globalThis.fetch, prevCaches = globalThis.caches;
  globalThis.caches = fakeCaches();
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), auth: new Headers(init?.headers).get('authorization') });
    if (String(url) === TRIAL) return Response.json(index);
    if (String(url).endsWith('/v1/public/livingcanvas/worlds')) return storageUp ? Response.json({ worlds: [{ id: 'last-train-zh', revision: 4, hash: 'sha256:s4', name: '末班车' }, { id: 'harbor', revision: 2, hash: 'sha256:h2', name: 'Harbor' }] }) : new Response('', { status: 503 });
    if (String(url).includes('/download-url')) return Response.json({ revision: 2, hash: 'sha256:h2', size: 1, files: [{ path: 'world.json', size: 1, sha256: 'bb', url: 'https://storage.example/blob/bb' }] });
    return new Response('', { status: 404 });
  };
  try {
    const c = m.createCatalog({ kind: 'services', identity: 'https://id.example', storage: 'https://storage.example', token: async () => null, trial: TRIAL });
    const down = await c.listWorlds();
    assert.deepEqual(down.map((w) => [w.id, w.source, w.title]), [['last-train-zh', 'template', '末班车']], 'storage down: the trial world still lists');
    storageUp = true;
    const c2 = m.createCatalog({ kind: 'services', identity: 'https://id.example', storage: 'https://storage.example', token: async () => 'acct', trial: TRIAL });
    const up = await c2.listWorlds();
    assert.deepEqual(up.map((w) => w.id).sort(), ['harbor', 'last-train-zh'], 'listed once');
    const b = await c2.getWorld('last-train-zh', 4);
    assert.equal(b.files[0].url, `${m.trialBlobBase(TRIAL)}aa.bin`);
    assert.equal(b.files[0].url, 'https://canvas.example/trial-worlds/aa.bin', 'an extension, or CloudFront answers index.html');
    assert.ok(!seen.some((x) => x.url.includes('last-train-zh/download-url')), 'no storage download for a trial world');
    await c2.getWorld('harbor', 2);
    assert.equal(seen.find((x) => x.url.includes('harbor/download-url')).auth, 'Bearer acct', 'other worlds: storage with the account');
  } finally {
    globalThis.fetch = prevFetch;
    globalThis.caches = prevCaches;
  }
});
