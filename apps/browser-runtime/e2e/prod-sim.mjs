// Production simulation of canvas.worldlines.gg — the static-site build of
// browser mode against LOCAL FAKES of the Worldlines services. No deploy, no
// real account, no real storage.
//
//   node e2e/prod-sim.mjs [--port 3199] [--host-port 3196] [--no-build]
//                         [--serve]          keep running; open http://127.0.0.1:3199/
//                         [--quota]          the fake gateway answers 429 quota_exceeded to everything
//                         [--turn]           play one real turn (paid model calls, capped by --max-calls, default 8)
//                         [--local-key]      「使用本机密钥」: set a key for a FAKE provider on another origin (port+2, CORS)
//                                            through the account panel, test it, play one turn on it (no paid call), and
//                                            check the key reached only that provider — never /fake-ai or /fake-*
//
// What runs:
//   1. apps/web built with the production switches (deploy/canvas/build-browser.sh
//      sets the same names) into e2e/out/prod-sim-web:
//        VITE_AIRP_RUNTIME_BASE=/runtime/sim/  VITE_AIRP_BROWSER_MODE=always  VITE_AIRP_CATALOG=services
//        VITE_AIRP_ID_BASE=<sim>/fake-auth  VITE_AIRP_STORAGE_BASE=<sim>/fake-storage  VITE_AIRP_MODEL_BASE=<sim>/fake-ai/v1
//   2. the ordinary dev host (ui-host.mjs) on --host-port, used ONLY as the
//      backing store of the fakes (catalog stand-in, runtime bundles, model proxy).
//   3. a static server on --port with COOP/COEP like CloudFront, serving the site,
//      /runtime/sim/* (bundles + image.bin), /audio/* (assets/audio), and:
//        /fake-storage  GET /v1/public/livingcanvas/worlds (+ /:id/cover) — no token;
//                       GET /v1/objects/livingcanvas/world/:id/download-url — Bearer required; /blob/:sha
//                       POST /v1/objects/livingcanvas/world/:id/upload-url, PUT /put/…, POST …/complete
//                       (in memory: 远端草稿 / 发布 of the sim user's workshop worlds)
//        /fake-auth     POST /v1/login/otp, /v1/login/otp/verify (code 123456), /v1/token/refresh,
//                       GET /v1/me, /v1/resources?scope=mine, POST /v1/resources (register),
//                       …/lease, …/publish, …/unpublish, POST /v1/logout
// After entering the world the walk makes a workshop world, uploads it to the
// remote, publishes it, and checks it appears in the storage public list.
//        /fake-ai/v1    Bearer + X-Worldlines-Product required → the host's model proxy
// The page must never ask for /api/browser-runtime/* (the dev host's routes).
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { Readable } from 'node:stream';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { startUiHost } from './ui-host.mjs';
import { chromiumPath, expireSessionAndCall } from './session-steps.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const OUT = path.join(HERE, 'out');
// A/B runs (perf-site.mjs): PROD_SIM_WEB / PROD_SIM_DIST serve a saved web build / runtime dist instead (with --no-build).
const WEB_OUT = process.env.PROD_SIM_WEB ? path.resolve(process.env.PROD_SIM_WEB) : path.join(OUT, 'prod-sim-web');
const DIST = process.env.PROD_SIM_DIST ? path.resolve(process.env.PROD_SIM_DIST) : null;
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const PORT = Number(opt('--port', 3199));
const SIM = `http://127.0.0.1:${PORT}`;
const maxCalls = Number(opt('--max-calls', 8));
const quotaMode = args.includes('--quota');
const localKeyMode = args.includes('--local-key');
const LOCAL_KEY = 'sk-sim-LOCALKEY-0123456789';
const PROVIDER_PORT = PORT + 2;
const PROVIDER = `http://127.0.0.1:${PROVIDER_PORT}/v1`;
fs.mkdirSync(OUT, { recursive: true });

// ── 1. the production web build ─────────────────────────────────────────────
if (!args.includes('--no-build') || !fs.existsSync(path.join(WEB_OUT, 'index.html'))) {
  const env = {
    ...process.env, AIRP_WEB_BASE: '/', AIRP_DEPLOY: 'remote', // a static site is a remote build (packages/shared/src/deploy-mode)
    VITE_AIRP_RUNTIME_BASE: '/runtime/sim/', VITE_AIRP_BROWSER_MODE: 'always', VITE_AIRP_CATALOG: 'services',
    VITE_AIRP_ID_BASE: `${SIM}/fake-auth`, VITE_AIRP_STORAGE_BASE: `${SIM}/fake-storage`, VITE_AIRP_MODEL_BASE: `${SIM}/fake-ai/v1`,
  };
  execFileSync('npx', ['vite', 'build', '--outDir', WEB_OUT, '--emptyOutDir', '--logLevel', 'error'], { cwd: path.join(REPO, 'apps/web'), env, stdio: 'inherit' });
}
const jsFiles = fs.readdirSync(path.join(WEB_OUT, 'assets')).filter((f) => f.endsWith('.js'));
if (!jsFiles.some((f) => fs.readFileSync(path.join(WEB_OUT, 'assets', f), 'utf8').includes('/runtime/sim/'))) {
  throw new Error('the web build does not reference /runtime/sim/ — browser-mode.ts must read VITE_AIRP_RUNTIME_BASE');
}

// ── 2. the backing dev host ─────────────────────────────────────────────────
const host = await startUiHost({ port: Number(opt('--host-port', 3196)), quiet: true });
const CAT = `${host.url}/api/browser-runtime/catalog`;

// ── 3. the static site + fakes ──────────────────────────────────────────────
const stats = { provider: { requests: [], keyOk: 0, keyBad: 0, chat: 0, models: [] }, keyLeaks: [], devHostRequests: [], storage: { publicList: 0, covers: 0, downloadUrl: 0, downloadUnauthorized: 0, blobs: 0 }, auth: [], ai: { calls: 0, refused: 0, unauthorized: 0, badProduct: 0, models: [], paths: [] }, audio: 0 };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
const ISOLATION = { 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp' };
const send = (res, status, body, headers = {}) => { res.writeHead(status, { ...ISOLATION, ...headers }); res.end(body); };
const json = (res, status, v) => send(res, status, JSON.stringify(v), { 'content-type': 'application/json' });
const bearer = (req) => /^Bearer (sim-access-\d+)$/.exec(req.headers.authorization ?? '')?.[1] ?? null;
let tokenSeq = 0;
const tokens = (email) => ({ access_token: `sim-access-${++tokenSeq}`, refresh_token: `sim-refresh-${tokenSeq}`, expires_in: 900, user: { id: 'sim-user-1', email } });
const readBody = (req) => new Promise((resolve) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => resolve(Buffer.concat(c))); });
async function pipe(res, upstream, extra = {}) {
  const headers = { ...ISOLATION, ...extra };
  for (const k of ['content-type', 'content-length', 'cache-control']) { const v = upstream.headers.get(k); if (v) headers[k] = v; }
  res.writeHead(upstream.status, headers);
  if (upstream.body) Readable.fromWeb(upstream.body).pipe(res); else res.end();
}
// CloudFront compresses text types (js / css / json / html / wasm) with brotli when the client asks; image.bin and
// media go as they are. Same here, so transfer sizes (and --throttle runs of perf-site.mjs) match the live site.
const COMPRESS = /\.(js|mjs|css|json|html|wasm)$/;
const brCache = new Map(); // path → compressed bytes (recompressed when the size changes, e.g. a rebuild)
function sendMaybeCompressed(req, res, key, bytes, headers) {
  if (!COMPRESS.test(key) || !/\bbr\b/.test(req.headers['accept-encoding'] ?? '')) return send(res, 200, bytes, headers);
  let br = brCache.get(key);
  if (!br || br.n !== bytes.length) {
    br = { n: bytes.length, b: zlib.brotliCompressSync(bytes, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } }) };
    brCache.set(key, br);
  }
  return send(res, 200, br.b, { ...headers, 'content-encoding': 'br', vary: 'accept-encoding' });
}
// The sim user's workshop worlds on the fake services: identity record + committed files.
const made = new Map(); // id → { status, revision, publishedRevision, title, meta, hash, size, files: Map(path → Buffer), pending: Map, lease }
const madeView = (id, r) => ({ product: 'livingcanvas', kind: 'world', id, owner_id: 'sim-user-1', mine: true, status: r.status, title: r.title, meta: r.meta,
  revision: r.revision, published_revision: r.status === 'published' ? r.publishedRevision : null, hash: r.hash, size: r.size,
  updated_at: r.updatedAt, published_at: r.publishedAt ?? null, lease: r.lease ? { active: true } : null });
const sha = async (b) => (await import('node:crypto')).createHash('sha256').update(b).digest('hex');
let publicWorlds = null;
async function publicList() {
  if (publicWorlds) return publicWorlds;
  const r = await (await fetch(`${CAT}/v1/resources?scope=public&product=livingcanvas&kind=world`)).json();
  publicWorlds = r.resources.filter((x) => x.status === 'published' || x.meta?.source === 'template').map((x) => {
    const w = x.meta?.world ?? {};
    return {
      id: x.id, name: x.title ?? w.name ?? x.id, description: x.meta?.description ?? w.description ?? null, locale: x.meta?.locale ?? w.locale ?? null,
      edition_group: x.meta?.edition ?? x.id.replace(/-(jp|zh|ko)$/, ''), revision: x.revision, hash: x.hash, size: x.size,
      publisher: 'Worldlines 官方', published_at: null, updated_at: null,
      cover_url: x.meta?.cover ? `${SIM}/fake-storage/v1/public/livingcanvas/worlds/${encodeURIComponent(x.id)}/cover?rev=${x.revision}` : null,
      _cover: x.meta?.cover ?? null,
    };
  });
  return publicWorlds;
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, SIM);
  const p = decodeURIComponent(u.pathname);
  // 「使用本机密钥」: nothing addressed to the Worldlines fakes may carry the player's key.
  if (localKeyMode && p.startsWith('/fake-')) {
    const peek = JSON.stringify(req.headers) + req.url;
    if (peek.includes(LOCAL_KEY)) stats.keyLeaks.push(p);
  }
  try {
    if (p.startsWith('/api/browser-runtime/')) { stats.devHostRequests.push(p); return send(res, 404, 'no dev host on a static site'); }
    if (p.startsWith('/runtime/sim/')) {
      const file = p.slice('/runtime/sim/'.length);
      const up = file === 'image.bin' ? `${host.url}/api/browser-runtime/image` : `${host.url}/api/browser-runtime/dist/${encodeURIComponent(file)}`;
      const headers = { 'cache-control': 'public, max-age=31536000, immutable', ...(file.endsWith('.wasm') ? { 'content-type': 'application/wasm' } : {}) };
      if (DIST && file !== 'image.bin') {
        const abs = path.join(DIST, path.basename(file));
        if (!fs.existsSync(abs)) return send(res, 404, '');
        return sendMaybeCompressed(req, res, abs, fs.readFileSync(abs), { 'content-type': TYPES[path.extname(abs)] ?? 'application/octet-stream', ...headers });
      }
      if (COMPRESS.test(file)) {
        const r = await fetch(up);
        return sendMaybeCompressed(req, res, p, Buffer.from(await r.arrayBuffer()), { 'content-type': r.headers.get('content-type') ?? 'text/javascript', ...headers });
      }
      return pipe(res, await fetch(up), headers);
    }
    if (p.startsWith('/audio/')) {
      const abs = path.join(REPO, 'assets/audio', p.slice('/audio/'.length));
      if (!abs.startsWith(path.join(REPO, 'assets/audio') + path.sep) || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) return send(res, 404, '');
      stats.audio++;
      return send(res, 200, fs.readFileSync(abs), { 'content-type': TYPES[path.extname(abs)] ?? 'application/octet-stream', 'cache-control': 'public, max-age=300' });
    }
    // ── fake storage ──
    if (p === '/fake-storage/v1/public/livingcanvas/worlds') {
      stats.storage.publicList++;
      const worlds = (await publicList()).map(({ _cover, ...w }) => w);
      for (const [id, r] of made) if (r.status === 'published') worlds.push({ id, name: r.meta?.name ?? r.title ?? id, description: r.meta?.description ?? null, locale: r.meta?.locale ?? null, revision: r.publishedRevision, hash: r.hash, size: r.size, publisher: null, published_at: r.publishedAt, updated_at: r.updatedAt, cover_url: null });
      return json(res, 200, { product: 'livingcanvas', kind: 'world', count: worlds.length, worlds });
    }
    let m = /^\/fake-storage\/v1\/public\/livingcanvas\/worlds\/([^/]+)\/cover$/.exec(p);
    if (m) {
      const w = (await publicList()).find((x) => x.id === m[1]);
      if (!w?._cover) return json(res, 404, { error: 'not_found' });
      stats.storage.covers++;
      const bytes = Buffer.from(await (await fetch(`${CAT}/blob/${w._cover.sha256}`)).arrayBuffer());
      return send(res, 200, bytes, { 'content-type': TYPES[path.extname(w._cover.path)] ?? 'image/webp', 'cross-origin-resource-policy': 'cross-origin', 'cache-control': 'public, max-age=86400' });
    }
    m = /^\/fake-storage\/v1\/objects\/livingcanvas\/world\/(made-[0-9a-f]{8})\/(upload-url|complete|download-url)$/.exec(p);
    if (m) {
      if (!bearer(req)) return json(res, 401, { error: 'unauthorized' });
      const r = made.get(m[1]);
      if (!r) return json(res, 404, { error: 'not_found' });
      stats.storage[m[2]] = (stats.storage[m[2]] ?? 0) + 1;
      if (m[2] === 'download-url') {
        const rev = u.searchParams.get('revision') === 'published' ? r.publishedRevision : r.revision;
        return json(res, 200, { id: m[1], status: r.status, revision: rev, hash: r.hash, files: [...r.files].map(([fp, b]) => ({ path: fp, size: b.length, sha256: r.sums.get(fp), url: `/fake-storage/made/${m[1]}/${encodeURIComponent(fp)}` })) });
      }
      const body = JSON.parse((await readBody(req)).toString() || '{}');
      if (!r.lease || body.leaseId !== r.lease) return json(res, 409, { error: 'lease_invalid' });
      if (m[2] === 'upload-url') {
        r.pendingRev = r.revision + 1;
        r.pending = new Map(body.files.map((f) => [f.path, f]));
        r.upload = new Map();
        return json(res, 200, { revision: r.pendingRev, uploads: body.files.map((f) => ({ path: f.path, method: 'PUT', url: `${SIM}/fake-storage/put/${m[1]}/${encodeURIComponent(f.path)}`, headers: {} })) });
      }
      for (const [fp, f] of r.pending) { const b = r.upload.get(fp); if (!b || b.length !== f.size || (await sha(b)) !== f.sha256) return json(res, 409, { error: 'integrity_mismatch' }); }
      r.files = r.upload; r.sums = new Map([...r.pending].map(([fp, f]) => [fp, f.sha256]));
      r.revision = r.pendingRev; r.size = [...r.files.values()].reduce((n, b) => n + b.length, 0);
      r.hash = `sha256:${await sha(Buffer.from([...r.pending.values()].sort((a, b) => (a.path < b.path ? -1 : 1)).map((f) => `${f.sha256} ${f.size} ${f.path}`).join('\n')))}`;
      r.lease = null; r.updatedAt = new Date().toISOString();
      return json(res, 200, { resource: madeView(m[1], r), manifest: { revision: r.revision, hash: r.hash, size: r.size, files: r.files.size } });
    }
    m = /^\/fake-storage\/put\/(made-[0-9a-f]{8})\/(.+)$/.exec(u.pathname);
    if (m && req.method === 'PUT') {
      const r = made.get(m[1]);
      const fp = decodeURIComponent(m[2]);
      if (!r?.pending?.has(fp)) return send(res, 403, '');
      r.upload.set(fp, await readBody(req));
      return send(res, 200, '');
    }
    m = /^\/fake-storage\/made\/(made-[0-9a-f]{8})\/(.+)$/.exec(u.pathname);
    if (m) { const b = made.get(m[1])?.files.get(decodeURIComponent(m[2])); return b ? send(res, 200, b) : send(res, 404, ''); }
    m = /^\/fake-storage\/v1\/objects\/livingcanvas\/world\/([^/]+)\/download-url$/.exec(p);
    if (m) {
      if (!bearer(req)) { stats.storage.downloadUnauthorized++; return json(res, 401, { error: 'unauthorized', message: 'A Worldlines token is required.' }); }
      stats.storage.downloadUrl++;
      const r = await (await fetch(`${CAT}/v1/objects/livingcanvas/world/${encodeURIComponent(m[1])}/download-url${u.search}`)).json();
      if (r.files) r.files = r.files.map((f) => ({ ...f, url: `/fake-storage/blob/${f.sha256}` }));
      return json(res, 200, r);
    }
    m = /^\/fake-storage\/blob\/([0-9a-f]{64})$/.exec(p);
    if (m) { stats.storage.blobs++; return pipe(res, await fetch(`${CAT}/blob/${m[1]}`)); }
    // ── fake identity ──
    if (p.startsWith('/fake-auth/')) {
      const body = req.method === 'POST' ? JSON.parse((await readBody(req)).toString() || '{}') : {};
      stats.auth.push(p);
      if (p === '/fake-auth/v1/login/otp') return json(res, 200, { ok: true });
      if (p === '/fake-auth/v1/login/otp/verify') return body.token === '123456' ? json(res, 200, tokens(body.email)) : json(res, 400, { error: 'invalid_grant', message: 'Wrong code.' });
      if (p === '/fake-auth/v1/token/refresh') return /^sim-refresh-\d+$/.test(body.refresh_token ?? '') ? json(res, 200, tokens('sim@example.test')) : json(res, 400, { error: 'invalid_grant' });
      if (p === '/fake-auth/v1/me') return bearer(req) ? json(res, 200, { user: { id: 'sim-user-1', email: 'sim@example.test' } }) : json(res, 401, { error: 'unauthorized' });
      if (p === '/fake-auth/v1/resources' && req.method === 'GET') return json(res, 200, { resources: [...made].map(([id, r]) => madeView(id, r)), next_cursor: null });
      if (p === '/fake-auth/v1/resources') {
        if (!bearer(req)) return json(res, 401, { error: 'unauthorized' });
        const exists = made.has(body.id);
        if (!exists) made.set(body.id, { status: 'draft', revision: 0, publishedRevision: null, title: body.title ?? null, meta: body.meta ?? {}, hash: null, size: null, files: new Map(), sums: new Map(), lease: null, updatedAt: new Date().toISOString() });
        return json(res, exists ? 200 : 201, { created: !exists, resource: madeView(body.id, made.get(body.id)) });
      }
      const rm = /^\/fake-auth\/v1\/resources\/livingcanvas\/world\/(made-[0-9a-f]{8})(?:\/(lease|publish|unpublish)(?:\/(.+))?)?$/.exec(p);
      if (rm) {
        if (!bearer(req)) return json(res, 401, { error: 'unauthorized' });
        const r = made.get(rm[1]);
        if (!r) return json(res, 404, { error: 'not_found' });
        if (!rm[2]) return json(res, 200, { resource: madeView(rm[1], r) });
        if (rm[2] === 'lease' && req.method === 'DELETE') { r.lease = null; return json(res, 200, { ok: true }); }
        if (rm[2] === 'lease') { if (r.lease) return json(res, 409, { error: 'busy' }); r.lease = `wl_lease_sim${Date.now()}`; return json(res, 201, { lease_id: r.lease, expires_at: new Date(Date.now() + 900e3).toISOString(), ttl_seconds: 900 }); }
        const was = r.status;
        if (rm[2] === 'publish') { r.status = 'published'; r.publishedRevision = body.revision ?? r.revision; r.publishedAt = new Date().toISOString(); }
        else { r.status = 'draft'; r.publishedRevision = null; }
        return json(res, 200, { changed: was !== r.status || rm[2] === 'publish', resource: madeView(rm[1], r) });
      }
      if (p === '/fake-auth/v1/logout') return send(res, 204, '');
      return json(res, 404, { error: 'not_found' });
    }
    // ── fake model gateway ──
    if (p.startsWith('/fake-ai/v1/')) {
      if (!bearer(req)) { stats.ai.unauthorized++; return json(res, 401, { error: { message: 'Sign in.', type: 'authentication_error', code: 'unauthorized' } }); }
      if (req.headers['x-worldlines-product'] !== 'livingcanvas') stats.ai.badProduct++;
      const body = await readBody(req);
      if (localKeyMode && body.includes(LOCAL_KEY)) stats.keyLeaks.push(`${p} (body)`);
      const model = (() => { try { return JSON.parse(body.toString()).model; } catch { return null; } })();
      stats.ai.models.push(model);
      stats.ai.paths.push(`${req.method} ${p}`);
      if (quotaMode || stats.ai.calls >= maxCalls) {
        stats.ai.refused++;
        return json(res, 429, { error: { message: "Your free plan's day usd quota is used up.", type: 'quota_error', code: 'quota_exceeded', quota: { plan: 'free', limit: 'day_usd' } } });
      }
      stats.ai.calls++;
      const provider = /^deepseek/.test(model ?? '') ? 'deepseek' : 'openai';
      const up = await fetch(`${host.url}/api/browser-runtime/model/${provider}/v1/${p.slice('/fake-ai/v1/'.length)}`, { method: req.method, headers: { 'content-type': 'application/json', authorization: 'Bearer browser-proxy' }, body: req.method === 'GET' ? undefined : body });
      return pipe(res, up);
    }
    // ── the site (SPA fallback like CloudFront's 404 → index.html) ──
    let file = path.join(WEB_OUT, p === '/' ? 'index.html' : p);
    if (!file.startsWith(WEB_OUT) || !fs.existsSync(file) || !fs.statSync(file).isFile()) file = path.join(WEB_OUT, 'index.html');
    // As CloudFront serves it (deploy/canvas/serve-site.mjs): html / sw no-cache, hashed /assets immutable, the rest 5 min.
    const cache = file.endsWith('index.html') || file.endsWith('-sw.js') ? 'no-cache' : p.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=300';
    return sendMaybeCompressed(req, res, file, fs.readFileSync(file), { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': cache });
  } catch (e) {
    return send(res, 500, String(e?.stack ?? e));
  }
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
// The player's own provider for --local-key: ANOTHER origin, so the tab's calls are real CORS requests
// under COEP. Canned answers only (no model behind it, nothing paid).
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
const provider = http.createServer(async (req, res) => {
  const body = await readBody(req);
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  const ok = req.headers.authorization === `Bearer ${LOCAL_KEY}`;
  stats.provider.requests.push(`${req.method} ${req.url}`);
  if (!ok) { stats.provider.keyBad++; res.writeHead(401, { ...CORS, 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: { message: 'bad key' } })); }
  stats.provider.keyOk++;
  if (req.url === '/v1/models') { res.writeHead(200, { ...CORS, 'content-type': 'application/json' }); return res.end(JSON.stringify({ data: [{ id: 'sim-model' }] })); }
  if (req.url === '/v1/chat/completions') {
    stats.provider.chat++;
    try { stats.provider.models.push(JSON.parse(body.toString()).model); } catch { /* not JSON */ }
    res.writeHead(200, { ...CORS, 'content-type': 'text/event-stream' });
    const chunk = (o) => res.write(`data: ${JSON.stringify({ id: 'sim', object: 'chat.completion.chunk', created: 0, model: 'sim-model', choices: [o] })}\n\n`);
    chunk({ index: 0, delta: { role: 'assistant', content: 'The street is quiet. ' }, finish_reason: null });
    chunk({ index: 0, delta: {}, finish_reason: 'stop' });
    return res.end('data: [DONE]\n\n');
  }
  res.writeHead(404, CORS); res.end();
});
if (localKeyMode) await new Promise((r) => provider.listen(PROVIDER_PORT, '127.0.0.1', r));
const stop = () => { server.close(); provider.close(); host.child.kill(); };
process.on('SIGINT', () => { stop(); process.exit(0); });

if (args.includes('--serve')) {
  console.log(`prod-sim: ${SIM}/   (sign in with any email, code 123456; backing host ${host.url})`);
} else {
  const result = await drive();
  result.stats = stats;
  fs.writeFileSync(path.join(OUT, 'prod-sim.json'), JSON.stringify(result, null, 1));
  console.log(JSON.stringify(result, null, 1));
  stop();
  process.exit(result.error ? 1 : 0);
}

// ── headless walk: lobby signed out → play → sign-in panel → code → world → audio → (turn) ──
async function drive() {
  const result = {};
  const log = [];
  const browser = await chromium.launch({ headless: true, executablePath: chromiumPath() });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, locale: 'en-US' });
  page.on('console', (m) => log.push(`[${m.type()}] ${m.text().slice(0, 300)}`));
  page.on('pageerror', (e) => log.push(`[pageerror] ${String(e.stack ?? e).slice(0, 500)}`));
  const audio = [];
  page.on('response', (r) => { const u = new URL(r.url()); if (u.pathname === '/api/audio') audio.push({ status: r.status(), fromSW: r.fromServiceWorker() }); });
  const shot = (n) => page.screenshot({ path: path.join(OUT, `prod-sim-${n}.png`) }).catch(() => {});
  try {
    const t0 = Date.now();
    await page.goto(`${SIM}/`);
    await page.waitForFunction(() => window.__airpBrowserMode || /启动失败/.test(document.body.innerText), null, { timeout: 90000 });
    result.boot = await page.evaluate(() => window.__airpBrowserMode ?? document.body.innerText.slice(0, 300));
    result.isolated = await page.evaluate(() => crossOriginIsolated);
    await page.locator('.world-launcher__hit').first().waitFor({ timeout: 30000 });
    result.lobbyMs = Date.now() - t0;
    await page.waitForTimeout(2500);
    result.lobby = {
      titles: [...new Set(await page.locator('.world-launcher__caption b').allInnerTexts())].length,
      // Covers are CSS backgrounds: count the distinct cover URLs the page asked the runtime for.
      coverUrls: await page.evaluate(() => new Set(performance.getEntriesByType('resource').map((e) => e.name).filter((n) => n.includes('/api/worlds/cover'))).size),
      signedOutRemoteSettings: await page.evaluate(async () => (await (await fetch('/api/remote/settings')).json())),
    };
    await shot('1-lobby');
    if (localKeyMode) {
      // In the lobby (signed out is fine): the account panel → 「模型与密钥」 → 使用本机密钥 → add a key for the fake provider → model → 测试连接.
      const box = page.locator('[data-testid="local-key"]:visible').first();
      if (!(await box.isVisible().catch(() => false))) await page.locator('.account-panel__trigger:visible').first().click();
      await box.waitFor({ timeout: 10000 });
      result.localKey = { promiseShown: await box.locator('[data-testid="local-key-promise"]').isVisible() };
      await box.getByLabel('Use local keys').check();
      await box.locator('.local-key__add select').selectOption('custom');
      await box.getByLabel('API address (OpenAI-compatible)').fill(PROVIDER);
      await box.getByLabel('API key').fill(LOCAL_KEY);
      await box.getByRole('button', { name: 'Save and use' }).click();
      await box.locator('[data-capability="chat"] input').fill('sim-model');
      await box.locator('.local-key__key').getByRole('button', { name: 'Test connection' }).click();
      await page.waitForTimeout(1500);
      result.localKey.status = await box.locator('.account-panel__status').first().textContent().catch(() => null);
      result.localKey.planLine = await page.locator('[data-testid="plan-chat-source"]:visible').first().textContent().catch(() => null);
      result.localKey.stored = await page.evaluate(() => { const v = JSON.parse(localStorage.getItem('airp.localModelKey') ?? '{}'); return { source: v.source, keys: v.keys?.length, chat: v.use?.chat?.model }; });
      await shot('4-local-key');
      await page.keyboard.press('Escape');
    }
    // Pick a world signed out: the account panel must open instead of the world.
    await page.evaluate(() => {
      const hits = [...document.querySelectorAll('.world-launcher__hit')].filter((h) => h.getAttribute('aria-expanded') !== null);
      const holmes = hits.filter((h) => /Holmes|福尔摩斯|ホームズ/.test(h.getAttribute('aria-label') ?? ''));
      (holmes.length ? holmes : hits)[0].click();
    });
    const start = page.getByRole('button', { name: /Start a new game|Start game|开始新游戏|开始游戏|新しいゲーム|ゲーム開始|게임 시작|새 게임/ }).first();
    await start.waitFor({ timeout: 10000 });
    await start.evaluate((b) => b.click());
    const email = page.getByRole('textbox', { name: 'Email' }).first();
    result.gate = await email.waitFor({ timeout: 10000 }).then(() => 'account panel opened', () => 'NO account panel');
    result.downloadsBeforeSignIn = stats.storage.downloadUrl + stats.storage.downloadUnauthorized;
    await shot('2-gate');
    await email.fill('sim@example.test');
    await page.getByRole('button', { name: /Send sign-in email/ }).first().click();
    const code = page.getByRole('textbox', { name: /Code from the email/ }).first();
    await code.waitFor({ timeout: 10000 });
    await code.fill('123456');
    const tLoad = Date.now();
    await page.getByRole('button', { name: /Sign in with code/ }).first().click();
    // Signed in → the pending pick continues into the world (download with the token).
    await page.waitForFunction(() => [...document.images].some((i) => i.complete && i.naturalWidth > 0 && i.src.includes('/api/asset')), null, { timeout: 90000 });
    await page.waitForTimeout(2000);
    result.worldAfterSignInMs = Date.now() - tLoad;
    result.signedIn = await page.evaluate(async () => { const s = await (await fetch('/api/remote/settings')).json(); return { signedIn: s.signedIn, email: s.email }; });
    await shot('3-world');
    // An expired session must refresh through the identity client (e2e/session-steps.mjs; also the release gate).
    const refreshesBefore = stats.auth.filter((p) => p.endsWith('/token/refresh')).length;
    result.expiredSession = await expireSessionAndCall(page);
    result.expiredSession.refreshed = stats.auth.filter((p) => p.endsWith('/token/refresh')).length - refreshesBefore;
    if (result.expiredSession.status !== 200 || !result.expiredSession.refreshed) throw new Error(`expired session did not refresh: ${JSON.stringify(result.expiredSession)}`);
    result.platformAudio = await page.evaluate((ps) => Promise.all(ps.map((p) => fetch(`/api/audio?path=${encodeURIComponent(p)}`).then((r) => r.status))), ['licensed/launcher.mp3', 'foley/canvas/se-card.mp3']);
    result.audioResponses = audio.slice(0, 6);
    // 远端 = the Worldlines services, the same logic as the local app: make a workshop world,
    // upload it to my remote drafts, publish it, and find it in the storage public list.
    result.remote = await page.evaluate(async (png) => {
      const post = async (url, body) => { const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'X-AIRP-Settings': '1' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => null) }; };
      const settings = await (await fetch('/api/remote/settings')).json();
      const created = await post('/api/worlds/create', { name: 'Sim Harbour', description: 'A town the simulation made.', locale: 'en', cover: { kind: 'upload', mimeType: 'image/png', dataB64: png } });
      if (created.status !== 200) return { settings, created };
      const pushed = await post('/api/remote/push', { worldPath: created.body.worldPath });
      const published = pushed.status === 200 ? await post('/api/remote/publish', { id: pushed.body.id }) : null;
      const list = await (await fetch('/api/remote/worlds')).json();
      return {
        backend: settings.backend, url: settings.url,
        pushed: { status: pushed.status, id: pushed.body?.id, revision: pushed.body?.revision, files: pushed.body?.files, error: pushed.body?.error },
        published: published && { status: published.status, revision: published.body?.revision },
        inRemoteList: list.public?.some((w) => w.id === pushed.body?.id) ?? false,
        id: pushed.body?.id,
      };
    }, 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==');
    const pub = await (await fetch(`${SIM}/fake-storage/v1/public/livingcanvas/worlds`)).json();
    result.remote.inStoragePublicList = pub.worlds.some((w) => w.id === result.remote.id);
    if (!result.remote.inStoragePublicList) throw new Error(`published world not in the public list: ${JSON.stringify(result.remote)}`);
    if (localKeyMode) {
      await page.evaluate((t) => { const ws = new WebSocket(`${location.origin.replace('http', 'ws')}/ws?v=1`); ws.onopen = async () => ws.send(JSON.stringify({ type: 'writer_prompt', savePath: (await (await fetch('/api/world-settings')).json()).world, message: t })); }, 'I look around.');
      const tSend = Date.now();
      while (Date.now() - tSend < 120000 && stats.provider.chat === 0) await page.waitForTimeout(500);
      await page.waitForTimeout(3000);
      result.localKey.turn = { providerChats: stats.provider.chat, models: [...new Set(stats.provider.models)], gatewayChatsMeanwhile: stats.ai.paths.filter((x) => x.endsWith('/chat/completions')).length };
      // the key in the Worker's VFS? (models.json keeps the placeholder)
      result.localKey.modelsJsonHasKey = await page.evaluate(async (k) => {
        const r = await window.__airpRuntime.call({ type: 'read', path: '/repo/.pi/agent/models.json' });
        return (r.data ?? '').includes(k);
      }, LOCAL_KEY);
      result.localKey.leaks = stats.keyLeaks;
      if (stats.keyLeaks.length || result.localKey.modelsJsonHasKey || !stats.provider.chat || stats.provider.keyBad || result.localKey.turn.gatewayChatsMeanwhile) throw new Error(`local key: ${JSON.stringify(result.localKey)}`);
    }
    if (quotaMode || args.includes('--turn')) {
      const frames = () => page.evaluate(() => ({ ...window.__airpRuntime.frames }));
      const before = await frames();
      const text = 'I step out of the cab and look around the street.';
      await page.evaluate((t) => { const ws = new WebSocket(`${location.origin.replace('http', 'ws')}/ws?v=1`); window.__simErrors = []; ws.onmessage = (e) => { if (typeof e.data === 'string' && /"type":"error"/.test(e.data)) window.__simErrors.push(e.data.slice(0, 400)); }; ws.onopen = async () => ws.send(JSON.stringify({ type: 'writer_prompt', savePath: (await (await fetch('/api/world-settings')).json()).world, message: t })); }, text);
      const tSend = Date.now();
      let last = '', lastChange = Date.now();
      const toasts = new Set();
      while (Date.now() - tSend < 240000) {
        await page.waitForTimeout(1000);
        const toast = await page.evaluate(() => document.querySelector('.prototype-toast')?.textContent ?? '');
        if (toast) toasts.add(toast.slice(0, 200));
        const f = JSON.stringify(await frames());
        if (f !== last) { last = f; lastChange = Date.now(); }
        const idle = (JSON.parse(last).writer_idle ?? 0) > (before.writer_idle ?? 0);
        if (idle && Date.now() - lastChange > 3000) break;
        if (Date.now() - lastChange > 25000) break;
      }
      const after = await frames();
      result.turn = { ms: Date.now() - tSend, frames: Object.fromEntries(Object.entries(after).map(([k, v]) => [k, v - (before[k] ?? 0)]).filter(([, v]) => v > 0)) };
      result.turn.toasts = [...toasts];
      result.turn.quotaShown = result.turn.toasts.some((x) => /quota is used up/i.test(x));
      result.turn.errorFrames = await page.evaluate(() => window.__simErrors);
      result.turn.errorLines = log.filter((l) => /quota|429|auth_required|401/i.test(l)).slice(0, 5);
      await shot('4-turn');
    }
  } catch (e) {
    result.error = String(e?.stack ?? e).slice(0, 1200);
    await shot('error');
  } finally {
    fs.writeFileSync(path.join(OUT, 'prod-sim-console.log'), log.join('\n'));
    await browser.close();
  }
  return result;
}
