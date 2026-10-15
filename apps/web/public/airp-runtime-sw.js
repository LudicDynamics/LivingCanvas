// Browser mode (experimental): routes the page's `/api/…` requests — fetch()
// AND element loads like <img src="/api/asset?…"> / <audio>, which no fetch
// patch can reach — to the AIRP server running in the page's runtime Worker.
// The Service Worker cannot talk to that Worker directly, so it asks the page
// that made the request; the page relays to its Worker and answers on a port.
// Only registered when the player turns browser mode on (src/lib/browser-mode.ts).
// A page that is not in browser mode answers "passthrough" and the request goes
// to the network unchanged. Always to the network: `/api/browser-runtime/…`
// (bundles, VFS image, model proxy) and `/api/audio` (platform audio under
// assets/audio — public static content, not part of any world; world-local
// media rides /api/asset and comes from the VFS).
// On a static site (canvas.worldlines.gg) nothing answers /api/audio: the page
// registers this worker with `?audio=<base>` and platform audio is served as
// static files, `/api/audio?path=a/b.mp3` → `<base>a/b.mp3` (same origin).
// Besides `/api/*`, only the files that never change are answered here, from Cache Storage
// (`immutableFile` below): the runtime under `/runtime/<rid>/` and the hashed app bundles under
// `/assets/`. `/audio/*`, html, this worker and every other origin go straight to the network.
const BASE = new URL(self.registration.scope).pathname.replace(/\/$/, '');
const AUDIO_BASE = (() => {
  const v = new URL(self.location.href).searchParams.get('audio');
  if (!v) return null;
  const u = new URL(v, self.location.origin);
  return u.origin === self.location.origin ? u.href.replace(/\/?$/, '/') : null;
})();
const NULL_BODY = new Set([101, 204, 205, 304]);

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// Immutable files, kept in Cache Storage (the browser's HTTP cache drops multi-MB entries early, and
// Safari often fetches image.bin and the app bundle again on every visit — perf-site.mjs, 2026-10-08).
// `/runtime/<rid>/…`: rid is a hash over the runtime (deploy/canvas/assemble-browser.mjs), so a name never
// changes content; caching one rid drops the other rids. `/assets/…-<hash>.<ext>`: Vite's hashed bundles;
// the oldest go once there are more than ASSET_LIMIT. Only 200 answers of our own origin are stored.
const STATIC_CACHE = 'airp-static-v1';
const ASSET_LIMIT = 60;
const RUNTIME = /^\/runtime\/([a-z0-9_-]+)\/[^/]+$/i;
const ASSET = /^\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.(js|css|woff2?|wasm)$/;
function immutableFile(path) {
  const m = RUNTIME.exec(path);
  if (m) return { kind: 'runtime', rid: m[1] };
  return ASSET.test(path) ? { kind: 'asset' } : null;
}

async function fromStaticCache(request, file, waitUntil) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(request.url);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.status === 200 && res.type === 'basic') waitUntil(store(cache, request.url, res.clone(), file));
  return res;
}

async function store(cache, url, res, file) {
  try {
    await cache.put(url, res);
    const keys = await cache.keys();
    if (file.kind === 'runtime') {
      for (const k of keys) {
        const m = RUNTIME.exec(new URL(k.url).pathname.slice(BASE.length));
        if (m && m[1] !== file.rid) await cache.delete(k);
      }
    } else {
      const assets = keys.filter((k) => ASSET.test(new URL(k.url).pathname.slice(BASE.length)));
      for (const k of assets.slice(0, Math.max(0, assets.length - ASSET_LIMIT))) await cache.delete(k);
    }
  } catch { /* quota / private mode: the network still answers */ }
}
// A hard reload (Cmd/Ctrl+Shift+R) loads the page past this worker, so it starts uncontrolled
// and `activate` has long passed: the page asks for a claim (browser-mode.ts).
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'airp-claim') event.waitUntil(self.clients.claim());
  // A first visit loads the runtime before this worker controls the page, so nothing went through
  // fromStaticCache: once the runtime is up the page names its files and they are stored now
  // (usually straight from the HTTP cache), and the next visit starts from Cache Storage.
  if (event.data && event.data.type === 'airp-cache' && Array.isArray(event.data.urls)) event.waitUntil(precache(event.data.urls));
});

async function precache(urls) {
  const cache = await caches.open(STATIC_CACHE);
  for (const href of urls.slice(0, 20)) {
    try {
      const u = new URL(href, self.location.origin);
      const file = u.origin === self.location.origin ? immutableFile(u.pathname.slice(BASE.length)) : null;
      if (!file || await cache.match(u.href)) continue;
      const res = await fetch(u.href, { credentials: 'same-origin' });
      if (res.status === 200 && res.type === 'basic') await store(cache, u.href, res, file);
    } catch { /* offline / quota: try again next visit */ }
  }
}

// Sign-in comes back as a top-level navigation in a NEW tab (no clientId, and a
// page with no runtime): /api/remote/login/callback/<state> is offered to every
// open window instead — only the tab whose in-Worker server started that sign-in
// knows the state; the others answer 400 login_expired with no side effect.
const CALLBACK = /^\/api\/remote\/login\/callback\//;

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  const path = url.pathname.startsWith(BASE) ? url.pathname.slice(BASE.length) : url.pathname;
  if (path === '/api/audio' && AUDIO_BASE) return event.respondWith(staticAudio(event.request, url));
  const file = event.request.method === 'GET' && !event.request.headers.has('range') ? immutableFile(path) : null;
  if (file) return event.respondWith(fromStaticCache(event.request, file, (p) => event.waitUntil(p)));
  if (!path.startsWith('/api/') || path.startsWith('/api/browser-runtime/') || path === '/api/audio') return;
  if (CALLBACK.test(path)) return event.respondWith(fanOut(event.request, event.clientId, path + url.search));
  if (!event.clientId) return;
  event.respondWith(relay(event.request, event.clientId, path + url.search));
});

async function fanOut(request, selfId, url) {
  const body = request.method === 'GET' || request.method === 'HEAD' ? null : await request.clone().arrayBuffer();
  // Pages with no runtime listener (about:blank, an earlier callback page) would never answer: skip them.
  const windows = (await self.clients.matchAll({ type: 'window' }))
    .filter((c) => c.id !== selfId && c.url.startsWith(self.location.origin) && !CALLBACK.test(new URL(c.url).pathname.slice(BASE.length)));
  let last = null;
  for (const client of windows) {
    const r = await ask(client, request, url, body && body.slice(0), 20000);
    if (!r || r.passthrough) continue;
    last = r;
    if (r.status < 400) break;
  }
  if (!last) return fetch(request);
  return new Response(NULL_BODY.has(last.status) || request.method === 'HEAD' ? null : last.body, { status: last.status, headers: last.headers });
}

/** One relayed request; null when the page does not answer in `ms` (e.g. a page with no runtime listener). */
function ask(client, request, url, body, ms) {
  const headers = {};
  request.headers.forEach((v, k) => { headers[k] = v; });
  const channel = new MessageChannel();
  const reply = new Promise((resolve) => { channel.port1.onmessage = (e) => resolve(e.data); });
  client.postMessage({ type: 'airp-runtime-fetch', method: request.method, url, headers, body }, [channel.port2, ...(body ? [body] : [])]);
  return ms ? Promise.race([reply, new Promise((r) => setTimeout(() => r(null), ms))]) : reply;
}

async function relay(request, clientId, url) {
  const client = await self.clients.get(clientId);
  if (!client || client.type !== 'window') return fetch(request);
  const body = request.method === 'GET' || request.method === 'HEAD' ? null : await request.clone().arrayBuffer();
  const r = await ask(client, request, url, body, 0);
  if (r.passthrough) return fetch(request);
  return new Response(NULL_BODY.has(r.status) || request.method === 'HEAD' ? null : r.body, { status: r.status, headers: r.headers });
}

/** Platform audio from the site's static `/audio/` tree (Range requests pass through for seeking). */
function staticAudio(request, url) {
  const rel = (url.searchParams.get('path') || '').replace(/^\/+/, '');
  if (!rel || rel.split('/').some((s) => s === '..' || s === '.' || s === '')) return new Response('bad audio path', { status: 400 });
  const target = AUDIO_BASE + rel.split('/').map(encodeURIComponent).join('/');
  const headers = new Headers();
  const range = request.headers.get('range');
  if (range) headers.set('range', range);
  return fetch(target, { headers, credentials: 'same-origin' });
}
