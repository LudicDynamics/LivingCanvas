// The runtime Service Worker keeps the files that never change in Cache Storage: /runtime/<rid>/… and the
// hashed /assets/… bundles (Safari fetched image.bin and the app bundle again on every visit; perf-site.mjs,
// 2026-10-08). Runs the real worker source in a vm with fake caches / fetch / clients.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

const SRC = fs.readFileSync(new URL('../public/airp-runtime-sw.js', import.meta.url), 'utf8');
const ORIGIN = 'https://canvas.example';

function load() {
  const store = new Map(); // url → Response
  const net = [];
  const listeners = {};
  const cache = {
    match: async (url) => store.get(url)?.clone() ?? undefined,
    put: async (url, res) => { store.set(url, res); },
    keys: async () => [...store.keys()].map((url) => ({ url })),
    delete: async (k) => store.delete(k.url),
  };
  const self = {
    location: new URL(`${ORIGIN}/airp-runtime-sw.js`),
    registration: { scope: `${ORIGIN}/` },
    clients: { claim: async () => {}, get: async () => null, matchAll: async () => [] },
    skipWaiting: () => {},
    addEventListener: (t, f) => { listeners[t] = f; },
  };
  const fetch = async (req) => {
    const url = typeof req === 'string' ? req : req.url;
    net.push(url);
    const res = new Response(`body of ${url}`, { status: 200 });
    Object.defineProperty(res, 'type', { value: 'basic' });
    return res;
  };
  vm.runInNewContext(SRC, { self, caches: { open: async () => cache }, fetch, URL, Response, Headers, MessageChannel, setTimeout });
  async function get(path, init = {}) {
    let answer = null; const waits = [];
    const request = { url: `${ORIGIN}${path}`, method: init.method ?? 'GET', headers: new Headers(init.headers ?? {}) };
    listeners.fetch({ request, clientId: 'c1', respondWith: (p) => { answer = p; }, waitUntil: (p) => waits.push(p) });
    if (!answer) return null; // not intercepted: the browser goes to the network itself
    const res = await answer;
    await Promise.all(waits);
    return res;
  }
  async function message(data) {
    const waits = [];
    listeners.message({ data, waitUntil: (p) => waits.push(p) });
    await Promise.all(waits);
  }
  return { get, message, net, store };
}

test('runtime files come from the network once, then from Cache Storage', async () => {
  const sw = load();
  const a = await sw.get('/runtime/abc123/server.js');
  assert.equal(await a.text(), `body of ${ORIGIN}/runtime/abc123/server.js`);
  const b = await sw.get('/runtime/abc123/server.js');
  assert.equal(await b.text(), `body of ${ORIGIN}/runtime/abc123/server.js`);
  assert.deepEqual(sw.net, [`${ORIGIN}/runtime/abc123/server.js`]);
});

test('a new runtime id replaces the old one in the cache', async () => {
  const sw = load();
  await sw.get('/runtime/old111/image.bin');
  await sw.get('/runtime/old111/pi.js');
  await sw.get('/runtime/new222/image.bin');
  assert.deepEqual([...sw.store.keys()], [`${ORIGIN}/runtime/new222/image.bin`]);
});

test('hashed bundles are cached; html, the worker itself, audio, ranges and /api are not', async () => {
  const sw = load();
  await sw.get('/assets/index-BJTiD68o.js');
  await sw.get('/assets/index-BJTiD68o.js');
  assert.equal(sw.net.length, 1);
  for (const p of ['/', '/index.html', '/airp-runtime-sw.js', '/audio/x.mp3', '/brand/icon.svg']) assert.equal(await sw.get(p), null, p);
  assert.equal(await sw.get('/runtime/abc123/pi.js', { headers: { range: 'bytes=0-1' } }), null);
  assert.equal(await sw.get('/runtime/abc123/pi.js', { method: 'POST' }), null);
});

test('the dev host bundles (/api/browser-runtime/dist) still go to the network untouched', async () => {
  const sw = load();
  assert.equal(await sw.get('/api/browser-runtime/dist/worker.js'), null);
});

test('after a first visit the page names the runtime files and the worker stores them (only immutable ones, once)', async () => {
  const sw = load();
  await sw.get('/runtime/abc123/worker.js');
  await sw.message({ type: 'airp-cache', urls: [`${ORIGIN}/runtime/abc123/worker.js`, `${ORIGIN}/runtime/abc123/pi.js`, `${ORIGIN}/assets/index-BJTiD68o.js`, `${ORIGIN}/index.html`, 'https://elsewhere.example/runtime/abc123/x.js'] });
  assert.deepEqual(sw.net, [`${ORIGIN}/runtime/abc123/worker.js`, `${ORIGIN}/runtime/abc123/pi.js`, `${ORIGIN}/assets/index-BJTiD68o.js`]);
  assert.equal(sw.store.size, 3);
});
