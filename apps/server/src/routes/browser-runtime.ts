import express, { type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createBrowserCatalog } from './browser-catalog.js';

/**
 * Browser mode, dev host side (apps/browser-runtime). In browser mode the web
 * app runs THIS server's code inside a Web Worker; the real server only hands
 * out three things, all under /api/browser-runtime and all localhost-only:
 *
 *   GET  /dist/<file>        the runtime bundles (worker.js, server.js, pi.js, sqlite3.wasm)
 *   GET  /image              the VFS base image: presets, skills, extensions, pi-rp
 *                            package metadata, platform-audio placeholders (binary pack,
 *                            see packImage). No world bodies — worlds come from /catalog.
 *                            (`?templates=a,b` still packs whole templates, for old tests.)
 *   GET  /catalog/…          the world catalog in identity/storage shapes (browser-catalog.ts):
 *                            list every world + edition, covers and world files by sha256
 *   ANY  /model/<provider>/… OpenAI-compatible model proxy; the key stays in this
 *                            process (env), the browser only ever sees a dummy key
 *   GET  /net                the forwarding targets below, as { name: baseUrl }
 *   ANY  /net/<target>/…     plain forwarding to an allowlisted origin that sends no
 *                            CORS headers (the identity service, the hosted remote),
 *                            so the in-tab server's remote-client works from a Worker.
 *                            Adds nothing (no keys, no cookies); strips cookies and
 *                            hop-by-hop headers both ways.
 *
 * Production needs a hosted, metered, authenticated proxy in place of /model —
 * this route is a local development stand-in and refuses non-loopback callers.
 */
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const UPSTREAMS: Record<string, { url: string; key: string }> = {
  openai: { url: 'https://api.openai.com/v1', key: 'OPENAI_API_KEY' },
  deepseek: { url: 'https://api.deepseek.com', key: 'DEEPSEEK_API_KEY' },
};
/** Where /net/<target> may forward. Anything else is 403. Overridable for tests / other deployments. */
export function netTargets(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const slash = (u: string) => (u.endsWith('/') ? u : `${u}/`);
  return {
    auth: slash(env.AIRP_BROWSER_NET_AUTH?.trim() || 'https://auth.worldlines.gg'),
    remote: slash(env.AIRP_BROWSER_NET_REMOTE?.trim() || env.AIRP_REMOTE_URL?.trim() || env.AIRP_STORAGE_BASE?.trim() || 'https://storage.worldlines.gg'),
  };
}
/** Never forwarded either way: credentials of THIS origin, hop-by-hop, and what fetch recomputes. */
const DROP_REQUEST = new Set(['cookie', 'host', 'origin', 'referer', 'connection', 'keep-alive', 'transfer-encoding', 'te', 'trailer', 'upgrade',
  'proxy-authorization', 'proxy-connection', 'content-length', 'accept-encoding', 'forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip']);
const DROP_RESPONSE = new Set(['set-cookie', 'set-cookie2', 'connection', 'keep-alive', 'transfer-encoding', 'te', 'trailer', 'upgrade',
  'proxy-authenticate', 'content-length', 'content-encoding', 'strict-transport-security', 'alt-svc']);
export const dropRequestHeader = (k: string) => DROP_REQUEST.has(k.toLowerCase()) || k.toLowerCase().startsWith('sec-') || k.toLowerCase().startsWith('proxy-');
export const dropResponseHeader = (k: string) => DROP_RESPONSE.has(k.toLowerCase()) || k.toLowerCase().startsWith('access-control-');

const DIST_FILES = new Set(['worker.js', 'server.js', 'pi.js', 'sqlite3.wasm']);
const TYPES: Record<string, string> = { '.js': 'text/javascript; charset=utf-8', '.wasm': 'application/wasm' };

function walk(dir: string, out: string[], keep: (f: string) => boolean = () => true): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out, keep);
    else if (e.isFile() && keep(p)) out.push(p);
  }
  return out;
}

/**
 * Pack: u32le header length, UTF-8 JSON header `[[path, byteLength], …]`, then
 * the file bytes back to back. Paths are VFS-absolute (/repo/…).
 */
export function packImage(repoRoot: string, templates: string[]): Buffer {
  const files: string[] = [];
  for (const t of templates) walk(path.join(repoRoot, 'templates', t), files);
  for (const d of ['presets', 'skills', 'extensions']) walk(path.join(repoRoot, d), files);
  files.push(path.join(repoRoot, 'config/deepseek-models.example.json'));
  const pkg = path.join(repoRoot, 'vendor/pi-rp/packages/coding-agent');
  files.push(path.join(pkg, 'package.json'));
  walk(path.join(pkg, 'dist'), files, (f) => f.endsWith('.json') && !f.endsWith('.map'));
  // Platform audio (assets/audio) is public static content the page fetches
  // from the host (the Service Worker lets /api/audio through), so its bytes
  // stay out of the image. But the in-tab server decides whether a world HAS a
  // theme / foley by checking those files exist (routes/world.ts resolveAudioRef),
  // so ship each one as an empty placeholder: names only, 0 bytes.
  const placeholders = new Set(walk(path.join(repoRoot, 'assets/audio'), [], (f) => /\.(mp3|ogg|wav|m4a|webm)$/i.test(f)));
  files.push(...placeholders);
  const bodies = files.map((f) => (placeholders.has(f) ? Buffer.alloc(0) : fs.readFileSync(f)));
  const header = Buffer.from(JSON.stringify(files.map((f, i) => [`/repo/${path.relative(repoRoot, f).split(path.sep).join('/')}`, bodies[i].length])));
  const len = Buffer.alloc(4);
  len.writeUInt32LE(header.length);
  return Buffer.concat([len, header, ...bodies]);
}

export function createBrowserRuntimeRouter(repoRoot: string, env: NodeJS.ProcessEnv = process.env): express.Router {
  const router = express.Router();
  const distDir = path.join(repoRoot, 'apps/browser-runtime/dist');
  const images = new Map<string, Buffer>();
  const stats = { modelCalls: 0, modelErrors: 0, netCalls: 0, netErrors: 0 };

  router.use((req, res, next) => {
    if (LOOPBACK.has(req.socket.remoteAddress ?? '')) return next();
    res.status(403).json({ error: 'browser runtime host routes are localhost-only' });
  });

  router.get('/status', (_req, res) => {
    res.json({ available: fs.existsSync(path.join(distDir, 'worker.js')), providers: Object.keys(UPSTREAMS).filter((p) => !!env[UPSTREAMS[p].key]), ...stats });
  });

  router.get('/dist/:file', (req, res) => {
    const file = req.params.file;
    if (!DIST_FILES.has(file) || !fs.existsSync(path.join(distDir, file))) return res.status(404).end();
    res.type(TYPES[path.extname(file)] ?? 'application/octet-stream');
    res.set('Cache-Control', 'no-cache');
    res.sendFile(path.join(distDir, file));
  });

  router.get('/image', (req, res) => {
    const available = new Set(fs.readdirSync(path.join(repoRoot, 'templates')));
    const wanted = String(req.query.templates ?? '').split(',').filter((t) => /^[\w-]+$/.test(t) && available.has(t));
    const key = `:${wanted.sort().join(',')}`;
    let img = images.get(key);
    if (!img) images.set(key, (img = packImage(repoRoot, wanted)));
    res.type('application/octet-stream').send(img);
  });

  router.use('/catalog', createBrowserCatalog(repoRoot));

  router.all("/model/:provider/*", async (req: Request<{ provider: string }>, res: Response) => {
    const up = UPSTREAMS[req.params.provider];
    const key = up && env[up.key];
    if (!up || !key) return res.status(503).json({ error: { message: `model proxy: no upstream key for ${req.params.provider}` } });
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    stats.modelCalls++;
    const rest = req.originalUrl.slice(req.originalUrl.indexOf(`/model/${req.params.provider}/`) + `/model/${req.params.provider}`.length);
    try {
      const r = await fetch(`${up.url}${rest.replace(/^\/v1(?=\/)/, up.url.endsWith('/v1') ? '' : '/v1')}`, {
        method: req.method,
        headers: { 'content-type': req.get('content-type') ?? 'application/json', authorization: `Bearer ${key}`, accept: req.get('accept') ?? '*/*' },
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
      });
      if (!r.ok) stats.modelErrors++;
      res.status(r.status).type(r.headers.get('content-type') ?? 'application/json');
      if (r.body) for await (const c of r.body as any) res.write(c);
      res.end();
    } catch (e) {
      stats.modelErrors++;
      res.status(502).json({ error: { message: `model proxy: ${(e as Error).message}` } });
    }
  });

  const targets = netTargets(env);
  router.get('/net', (_req, res) => { res.json(targets); });
  router.all('/net/:target/*', async (req: Request<{ target: string }>, res: Response) => {
    const base = Object.hasOwn(targets, req.params.target) ? targets[req.params.target] : undefined;
    if (!base) return res.status(403).json({ error: `net proxy: ${req.params.target} is not an allowed target` });
    const marker = `/net/${req.params.target}/`;
    const rest = req.originalUrl.slice(req.originalUrl.indexOf(marker) + marker.length);
    const upstream = new URL(rest, base);
    if (!upstream.href.startsWith(base) || /%2f|%5c/i.test(upstream.pathname)) return res.status(403).json({ error: 'net proxy: path escapes the target' });
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string' && !dropRequestHeader(k)) headers[k] = v;
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    stats.netCalls++;
    try {
      const r = await fetch(upstream, {
        method: req.method, headers, redirect: 'manual',
        body: ['GET', 'HEAD'].includes(req.method) || !chunks.length ? undefined : Buffer.concat(chunks),
      });
      res.status(r.status);
      r.headers.forEach((v, k) => {
        if (dropResponseHeader(k)) return;
        if (k === 'location') {
          // Keep redirects inside the allowlist on the proxy; others go out as they are.
          const to = new URL(v, upstream).href;
          const hit = Object.entries(targets).find(([, b]) => to.startsWith(b));
          v = hit ? `${req.baseUrl}/net/${hit[0]}/${to.slice(hit[1].length)}` : to;
        }
        res.setHeader(k, v);
      });
      if (r.body && req.method !== 'HEAD') for await (const c of r.body as any) res.write(c);
      res.end();
    } catch (e) {
      stats.netErrors++;
      res.status(502).json({ error: `net proxy: ${(e as Error).message}` });
    }
  });
  return router;
}
