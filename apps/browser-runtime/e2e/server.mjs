// e2e host: serves the page, dist/ and the VFS image, and proxies model calls
// to DeepSeek. The API key stays in this Node process; the browser only ever
// sees http://127.0.0.1:<port>/v1 with a dummy key.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '..');
const REPO = path.resolve(APP, '../..');
// The developer's own keys file (default: the repository's .env.local).
const MAIN_ENV = process.env.AIRP_KEYS_FILE ?? path.join(REPO, '.env.local');

function readKey() {
  const line = fs.readFileSync(MAIN_ENV, 'utf8').split('\n').find((l) => /^\s*DEEPSEEK_API_KEY\s*=/.test(l));
  return line?.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '');
}

function walk(dir, out, filter = () => true) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out, filter);
    else if (e.isFile() && filter(p)) out.push(p);
  }
  return out;
}

export function buildVfs(port, world) {
  const files = {};
  const add = (abs, rel = path.relative(REPO, abs)) => { files[`/repo/${rel}`] = fs.readFileSync(abs).toString('base64'); };
  for (const d of [`templates/${world}`, 'presets', 'skills', 'extensions']) walk(path.join(REPO, d), []).forEach((f) => add(f));
  add(path.join(REPO, 'config/deepseek-models.example.json'));
  // The server refuses to start without a build mode (apps/server/src/deploy-mode.ts): the public local one.
  add(path.join(REPO, 'config/.env.local'));
  const pkg = path.join(REPO, 'vendor/pi-rp/packages/coding-agent');
  add(path.join(pkg, 'package.json'));
  walk(path.join(pkg, 'dist'), [], (f) => f.endsWith('.json') && !f.endsWith('.map')).forEach((f) => add(f));
  const models = JSON.parse(fs.readFileSync(path.join(REPO, 'config/deepseek-models.example.json'), 'utf8'));
  models.providers.deepseek.baseUrl = `http://127.0.0.1:${port}/v1`;
  models.providers.deepseek.apiKey = 'browser-proxy';
  files['/repo/.pi/agent/models.json'] = Buffer.from(JSON.stringify(models, null, 2)).toString('base64');
  // The player's model choice (what the Agents panel writes): DeepSeek via the proxy.
  const pref = { provider: 'deepseek', model: 'deepseek-v4-flash', thinking: 'low' };
  files[`/repo/worlds/${world}-default/.airpworld/model-preferences.json`] = Buffer.from(JSON.stringify({ writer: pref, character: pref })).toString('base64');
  files['/repo/.pi/agent/settings.json'] = Buffer.from('{ "defaultThinkingLevel": "low" }\n').toString('base64');
  return files;
}

const TYPES = { '.js': 'text/javascript', '.html': 'text/html', '.wasm': 'application/wasm', '.json': 'application/json' };

// --no-regexp-v (run.mjs): worker.js served behind a RegExp that refuses the `v` flag the way Safari < 17 / Chrome < 112
// do, so a bundle that still constructs one fails here like it did on players' iPhones (chronicle 2026-10-07).
export const NO_REGEXP_V = `{const R=globalThis.RegExp,no=(f)=>{if(String(f??'').includes('v'))throw new SyntaxError("Invalid flags supplied to RegExp constructor '"+f+"'")};globalThis.RegExp=new Proxy(R,{construct(t,a,n){no(a[1]);return Reflect.construct(t,a,n)},apply(t,s,a){no(a[1]);return Reflect.apply(t,s,a)}});}\n`;

export function startHost({ world = 'whitechapel', maxModelCalls = 10, noRegExpV = false } = {}) {
  const key = readKey();
  if (!key) throw new Error('DEEPSEEK_API_KEY missing in .env.local');
  const stats = { modelCalls: 0, refused: 0, calls: [] };
  let vfsJson = null;
  const server = http.createServer(async (req, res) => {
    const iso = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };
    const url = new URL(req.url, 'http://x');
    if (req.method === 'OPTIONS') { res.writeHead(204, iso); res.end(); return; }
    if (url.pathname.startsWith('/v1/')) {
      const body = await new Promise((r) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => r(Buffer.concat(c))); });
      if (stats.modelCalls >= maxModelCalls) { stats.refused++; res.writeHead(429, { ...iso, 'content-type': 'application/json' }); res.end('{"error":{"message":"e2e model-call cap reached"}}'); return; }
      stats.modelCalls++;
      const t = Date.now();
      const up = await fetch(`https://api.deepseek.com${url.pathname.slice(3)}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body });
      res.writeHead(up.status, { ...iso, 'content-type': up.headers.get('content-type') ?? 'application/json' });
      for await (const chunk of up.body) res.write(chunk);
      res.end();
      stats.calls.push({ status: up.status, ms: Date.now() - t, reqBytes: body.length });
      return;
    }
    if (url.pathname === '/vfs.json') {
      vfsJson ??= JSON.stringify(buildVfs(server.address().port, world));
      res.writeHead(200, { ...iso, 'content-type': 'application/json' }); res.end(vfsJson); return;
    }
    const file = url.pathname === '/' ? path.join(HERE, 'page.html') : url.pathname.startsWith('/dist/') ? path.join(APP, url.pathname) : null;
    if (!file || !fs.existsSync(file)) { res.writeHead(404, iso); res.end(); return; }
    res.writeHead(200, { ...iso, 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    if (noRegExpV && url.pathname === '/dist/worker.js') { res.end(NO_REGEXP_V + fs.readFileSync(file, 'utf8')); return; }
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, port: server.address().port, stats, vfsBytes: () => vfsJson?.length ?? 0 })));
}
