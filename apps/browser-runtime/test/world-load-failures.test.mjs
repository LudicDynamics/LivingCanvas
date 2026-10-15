// POST /api/worlds/load through the REAL catalog (catalog.ts) and the library's intercept (worlds.ts) against a
// fake static site + fake storage, for the ways an open failed on canvas.worldlines.gg (canvas-20261011-0211):
//   - the shipped trial worlds' blobs at an extensionless /trial-worlds/<sha256> were answered by CloudFront's SPA
//     function with index.html (200 text/html) → sha256 mismatch → 502 for 末班车 and the prologue;
//   - storage republished a world after the lobby listed it (the listed revision is gone);
//   - presigned links expired between the lobby and the open;
//   - signed out / a guest token: storage 401 on download-url;
//   - no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const built = await esbuild.build({
  stdin: { contents: `export * from './src/worlds.ts'; export * from './src/catalog.ts';`, resolveDir: path.join(HERE, '..'), loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'error',
  banner: { js: "import { createRequire as __req } from 'node:module'; const require = __req(import.meta.url);" },
});
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'airp-load-fail-'));
fs.writeFileSync(path.join(dir, 'w.mjs'), built.outputFiles[0].text);
const m = await import(pathToFileURL(path.join(dir, 'w.mjs')).href);
fs.rmSync(dir, { recursive: true, force: true });

const SITE = 'https://canvas.example';
const STORAGE = 'https://storage.example';
const TRIAL = `${SITE}/runtime/r1/trial.json`;
const INDEX_HTML = '<!DOCTYPE html><html><body>app</body></html>';
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const f = (p, body) => ({ path: p, size: Buffer.byteLength(body), sha256: sha(body), body });

function fakeCaches() {
  const stores = new Map();
  return { async open(name) { if (!stores.has(name)) { const mm = new Map(); stores.set(name, { async keys() { return [...mm.keys()].map((url) => ({ url })); }, async match(k) { const v = mm.get(typeof k === 'string' ? k : k.url); return v ? v.clone() : undefined; }, async put(k, r) { mm.set(typeof k === 'string' ? k : k.url, r); } }); } return stores.get(name); } };
}

/**
 * The world: the static site (trial.json + /trial-worlds/<name>, served like CloudFront: a last path segment with no
 * dot is an app route → index.html) and storage (public list, download-url with presigned blob links).
 */
function world(opts = {}) {
  const trialFiles = [f('world.json', '{"id":"last-train-zh","name":"末班车 (shipped)"}'), f('assets/scenes/intro.webp', 'TRIAL-ART')];
  const rev = { 4: [f('world.json', '{"id":"whitechapel-zh","rev":4}'), f('assets/a.webp', 'WC-4')], 5: [f('world.json', '{"id":"whitechapel-zh","rev":5}'), f('assets/a.webp', 'WC-5')] };
  const s = {
    calls: [], linkGen: 0,
    current: opts.current ?? 4, pruned: new Set(opts.pruned ?? []), listed: opts.listed ?? 4,
    expireFirst: opts.expireFirst ?? 0, token: opts.token ?? (async () => 'acct'), guestToken: !!opts.guestToken,
    offline: false, storageHtml: false,
  };
  const fetch = async (input, init) => {
    const url = String(input);
    const u = new URL(url);
    const auth = new Headers(init?.headers).get('authorization');
    s.calls.push(`${u.host}${u.pathname}${u.search}`);
    if (s.offline) throw new TypeError('Failed to fetch');
    if (url === TRIAL) return Response.json({ worlds: [{ id: 'last-train-zh', hash: 'sha256:trial', size: 1, world: { id: 'last-train-zh', name: '末班车' }, files: trialFiles.map(({ body, ...x }) => x) }] });
    if (u.origin === SITE) {
      const last = u.pathname.split('/').pop();
      if (!last.includes('.')) return new Response(INDEX_HTML, { headers: { 'content-type': 'text/html' } }); // the CloudFront SPA function
      const m2 = /^\/trial-worlds\/([0-9a-f]{64})\.bin$/.exec(u.pathname);
      const hit = m2 && trialFiles.find((x) => x.sha256 === m2[1]);
      return hit ? new Response(hit.body, { headers: { 'content-type': 'application/octet-stream' } }) : new Response('', { status: 404 });
    }
    if (u.pathname === '/v1/public/livingcanvas/worlds') return Response.json({ worlds: [
      { id: 'whitechapel-zh', revision: s.listed, hash: `sha256:wc${s.listed}`, name: '白教堂' },
      { id: 'last-train-zh', revision: 5, hash: 'sha256:republished', name: '末班车' },
    ] });
    const dl = /^\/v1\/objects\/livingcanvas\/world\/([^/]+)\/download-url$/.exec(u.pathname);
    if (dl) {
      if (!auth || (s.guestToken && auth === 'Bearer guest')) return Response.json({ error: 'unauthorized' }, { status: 401 });
      const want = u.searchParams.has('revision') ? Number(u.searchParams.get('revision')) : s.current;
      if (!rev[want] || s.pruned.has(want) || want > s.current) return Response.json({ error: 'not_found' }, { status: 404 });
      const gen = ++s.linkGen;
      return Response.json({ revision: want, hash: `sha256:wc${want}`, size: 1, files: rev[want].map(({ body, ...x }) => ({ ...x, url: `${STORAGE}/blob/${x.sha256}?sig=${gen}` })) });
    }
    const blob = /^\/blob\/([0-9a-f]{64})$/.exec(u.pathname);
    if (blob) {
      if (Number(u.searchParams.get('sig')) <= s.expireFirst) return new Response('<Error>AccessDenied: Request has expired</Error>', { status: 403 });
      if (s.storageHtml) return new Response(INDEX_HTML, { headers: { 'content-type': 'text/html' } });
      const body = Object.values(rev).flat().find((x) => x.sha256 === blob[1])?.body;
      return body ? new Response(body) : new Response('', { status: 404 });
    }
    return new Response('', { status: 404 });
  };
  return { s, fetch };
}

let n = 0;
async function open(w, worldPath, { token } = {}) {
  const prev = { fetch: globalThis.fetch, caches: globalThis.caches };
  globalThis.fetch = w.fetch;
  globalThis.caches = fakeCaches();
  try {
    const catalog = m.createCatalog({ kind: 'services', identity: 'https://id.example', storage: STORAGE, token: token ?? w.s.token, trial: TRIAL });
    const lib = new m.WorldLibrary(catalog, `/repo-load-fail-${++n}`, () => {}, async () => null);
    await lib.init();
    const answer = await lib.intercept({ method: 'POST', url: '/api/worlds/load', body: new TextEncoder().encode(JSON.stringify({ worldPath })) });
    return { answer, body: answer ? JSON.parse(new TextDecoder().decode(answer.body)) : null, lib };
  } finally {
    globalThis.fetch = prev.fetch;
    globalThis.caches = prev.caches;
  }
}

test('trial world after a republish: opens from the shipped bundle at /trial-worlds/<sha256>.bin, signed out, never through storage', async () => {
  const w = world();
  const { answer, lib } = await open(w, 'templates/last-train-zh', { token: async () => null });
  assert.equal(answer, null, 'dispatched to the server: the world is materialised');
  assert.equal(lib.stats.opened[0].files, 2);
  const blobCalls = w.s.calls.filter((c) => c.includes('/trial-worlds/'));
  assert.equal(blobCalls.length, 2);
  assert.ok(blobCalls.every((c) => /\/trial-worlds\/[0-9a-f]{64}\.bin$/.test(c)), `every trial blob has an extension: ${blobCalls}`);
  assert.ok(!w.s.calls.some((c) => c.includes('last-train-zh/download-url')), 'storage (revision 5) is never asked');
});

test('a blob answered by an SPA fallback (index.html, 200) is a clear world_files failure, not a bare sha256 mismatch', async () => {
  const w = world();
  w.s.storageHtml = true;
  const { answer, body } = await open(w, 'templates/whitechapel-zh');
  assert.equal(answer.status, 502);
  assert.equal(body.code, 'world_files');
  assert.equal(body.retry, true);
  assert.doesNotMatch(body.error, /sha256|catalog:/, 'the player sentence carries no internals');
  assert.match(body.detail, /came back as a web page/);
});

test('republished after the lobby listed it: the listed revision is gone (404) → the current one opens', async () => {
  const w = world({ listed: 4, current: 5, pruned: [4] });
  const { answer, lib } = await open(w, 'templates/whitechapel-zh');
  assert.equal(answer, null, JSON.stringify(answer && new TextDecoder().decode(answer.body)));
  assert.ok(w.s.calls.includes('storage.example/v1/objects/livingcanvas/world/whitechapel-zh/download-url?revision=4'));
  assert.ok(w.s.calls.includes('storage.example/v1/objects/livingcanvas/world/whitechapel-zh/download-url'), 'fell back to the current revision');
  assert.equal(lib.stats.opened[0].files, 2);
});

test('expired presigned links (403) → fresh links from storage once, and the open succeeds', async () => {
  const w = world({ expireFirst: 1 });
  const { answer } = await open(w, 'templates/whitechapel-zh');
  assert.equal(answer, null);
  assert.ok(w.s.calls.filter((c) => c.includes('/download-url')).length >= 2, 'asked for fresh links after the 403');
});

test('signed out, or a guest token storage refuses (401 on download-url) → 401 signed_out, a sign-in prompt', async () => {
  for (const token of [async () => null, async () => 'guest']) {
    const w = world({ guestToken: true });
    const { answer, body } = await open(w, 'templates/whitechapel-zh', { token });
    assert.equal(answer.status, 401);
    assert.equal(body.code, 'signed_out');
    assert.match(body.error, /Sign in/);
  }
});

test('no network → 503 network with retry, not 502', async () => {
  const w = world();
  const prev = { fetch: globalThis.fetch, caches: globalThis.caches };
  globalThis.fetch = w.fetch;
  globalThis.caches = fakeCaches();
  try {
    const catalog = m.createCatalog({ kind: 'services', identity: 'https://id.example', storage: STORAGE, token: w.s.token, trial: TRIAL });
    const lib = new m.WorldLibrary(catalog, `/repo-load-fail-${++n}`, () => {}, async () => null);
    await lib.init();
    w.s.offline = true;
    const answer = await lib.intercept({ method: 'POST', url: '/api/worlds/load', body: new TextEncoder().encode(JSON.stringify({ worldPath: 'templates/whitechapel-zh' })) });
    const body = JSON.parse(new TextDecoder().decode(answer.body));
    assert.equal(answer.status, 503);
    assert.equal(body.code, 'network');
    assert.equal(body.retry, true);
  } finally {
    globalThis.fetch = prev.fetch;
    globalThis.caches = prev.caches;
  }
});

test('worldLoadFailure: older plain errors still classify', () => {
  assert.equal(m.worldLoadFailure(new Error('catalog: 401 https://x/download-url'))[1].code, 'signed_out');
  assert.equal(m.worldLoadFailure(new TypeError('Failed to fetch'))[1].code, 'network');
  assert.equal(m.worldLoadFailure(new Error('catalog: x does not match its sha256'))[0], 502);
});
