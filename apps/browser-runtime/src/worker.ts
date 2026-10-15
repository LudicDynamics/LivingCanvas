// The platform Worker: one Node-shaped "machine". It owns the VFS, SQLite and
// the node:* registry, runs the AIRP server program as its main process, and
// lets the server spawn pi-rp CLI programs in-process. The page talks to it only
// through messages that stand in for HTTP requests and WebSocket frames.
import reg from './platform/registry';
import { fs, writeTree, readTree } from './platform/fs';
import { initSqlite, flushAllDatabases, walToRollback } from './platform/sqlite';
import { createProcess, ProcessExit } from './platform/process';
import { registerProgram } from './platform/child-process';
import { dispatch, IncomingMessage, FakeSocket } from './platform/http';
import { WebSocket as ShimWebSocket } from './platform/ws';
import { startPersistence, type Persistence } from './platform/persist';
import { installNetProxy } from './platform/net';
import { createGatewayFetch } from './platform/model-gateway';
import { createLocalKeyFetch, parseLocalKeyRoutes, type LocalKeyRoutes } from './platform/local-key';
import { createCatalog, type CatalogConfig } from './catalog';
import { WorldLibrary } from './worlds';
import { installImageEncoder } from './platform/image-encoder';
import { serverStartFailure } from './server-start';

// Before any program runs: @airp/shared's compressImage finds it on globalThis.
installImageEncoder();

const post = (m: any, t?: Transferable[]) => (self as any).postMessage(m, t ?? []);
const programUrl = (name: string) => new URL(`./${name}.js`, import.meta.url).href;
const t0 = performance.now();
const marks: Record<string, number> = {};
const mark = (k: string) => { marks[k] = Math.round(performance.now() - t0); };

// Start the two big downloads of a boot the moment this Worker runs, not one after another inside boot():
// server.js (~2.4 MB brotli on the static site) and sqlite3.wasm. Evaluating server.js only defines its
// program function (build.mjs wraps it), so importing early has no side effects; boot() awaits both. On a
// cold load this overlaps the server download with the image, the catalog list and SQLite (?perf=1 table).
const earlyServer = import(/* @vite-ignore */ programUrl('server'));
earlyServer.catch(() => { /* boot() imports it again and reports the error */ });
const earlySqlite = initSqlite();
earlySqlite.catch(() => { /* boot() awaits it and reports the error */ });

self.addEventListener('unhandledrejection', (ev: any) => {
  if (ev.reason instanceof ProcessExit || ev.reason?.name === 'ProcessExit') ev.preventDefault();
});
self.addEventListener('error', (ev: any) => {
  if (ev.error instanceof ProcessExit || ev.error?.name === 'ProcessExit') ev.preventDefault();
});

/**
 * Run a program bundle with its own process object. `main` resolves once its top level has run:
 * with null, or with why it stopped early (an uncaught error, or `process.exit(n)`).
 */
async function runProgram(name: string, init: Parameters<typeof createProcess>[0], target?: any) {
  const mod = await import(/* @vite-ignore */ programUrl(name));
  const proc = createProcess(init, target);
  const main: Promise<string | null> = mod.default(proc).then(() => null, (e: any) => {
    if (e instanceof ProcessExit || e?.name === 'ProcessExit') return `process.exit(${e.code ?? '?'})`;
    proc.stderr.write(`[${name}] ${errorText(e)}\n`);
    try { proc.exit(1); } catch { /* ProcessExit */ }
    return errorText(e);
  });
  return { proc, main };
}

/** No shell in browser mode: drop `bash` from every agent unless its spawn already pins an allowlist. */
function browserToolArgs(argv: string[]) {
  if (argv.includes('--tools') || argv.includes('-t') || argv.includes('--no-tools')) return argv;
  const i = argv.indexOf('--exclude-tools');
  if (i >= 0) return argv.map((a, j) => (j === i + 1 ? `${a},bash` : a));
  return [...argv, '--exclude-tools', 'bash'];
}

registerProgram('/repo/vendor/pi-rp/packages/coding-agent/dist/cli.js', async (ctx) => {
  const t = performance.now();
  if (ctx.env.AIRP_BROWSER_TRACE) {
    const tag = `[pi ${ctx.pid}]`;
    const cut = (d: any) => String(typeof d === 'string' ? d : new TextDecoder().decode(d)).slice(0, 300);
    const noisy = (s: string) => s.includes('get_session_stats');
    ctx.stdin.on('data', (d: any) => { const s = cut(d); if (!noisy(s)) console.log(tag, '>', s); });
    ctx.stdout.on('data', (d: any) => { const s = cut(d); if (!noisy(s)) console.log(tag, '<', s); });
    ctx.stderr.on('data', (d: any) => console.log(tag, '!', cut(d)));
    console.log(tag, 'argv', ctx.argv.slice(2).join(' ').replace(/--(extension|skill) \S+ /g, '').slice(0, 600));
  }
  const { proc } = await runProgram('pi', {
    argv: browserToolArgs(ctx.argv), env: ctx.env, cwd: ctx.cwd, pid: ctx.pid,
    stdin: ctx.stdin, stdout: ctx.stdout, stderr: ctx.stderr, onExit: ctx.onExit,
  });
  (globalThis as any).__airpStats.piSpawns.push(Math.round(performance.now() - t));
  return {
    kill: (signal: string) => {
      try { proc.emit(signal); } catch { /* listener errors */ }
      try { proc.exit(signal === 'SIGKILL' ? 137 : 143); } catch { /* ProcessExit */ }
    },
  };
});
(globalThis as any).__airpStats = { piSpawns: [] as number[], model: [] as ModelTiming[] };

/**
 * Timing of every model request (the page's ?perf=1 table splits a turn into model time and the rest):
 * `at` in epoch ms, time to response headers, time to the end of the body. The last 50 only; no content.
 */
type ModelTiming = { at: number; path: string; status: number; headersMs: number; ms: number };
function timeModelRequests(inner: typeof fetch, base: string): typeof fetch {
  return async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url ?? '';
    if (!url.startsWith(base)) return inner(input, init);
    const t = performance.now();
    const rec: ModelTiming = { at: Math.round(performance.timeOrigin + t), path: url.slice(base.length).split('?')[0], status: 0, headersMs: 0, ms: 0 };
    const log = (globalThis as any).__airpStats.model as ModelTiming[];
    log.push(rec);
    if (log.length > 50) log.shift();
    const res = await inner(input, init);
    rec.status = res.status;
    rec.headersMs = rec.ms = Math.round(performance.now() - t);
    if (!res.body) return res;
    const done = () => { rec.ms = Math.round(performance.now() - t); };
    const body = res.body.pipeThrough(new TransformStream({ flush: done }));
    return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
  };
}

/** The files this Worker fetched (bundles, wasm, catalog list), for the ?perf=1 table. */
function fetchedFiles() {
  try {
    return performance.getEntriesByType('resource').map((e: any) => ({
      f: e.name.split('?')[0].split('/').pop(), start: Math.round(e.startTime), ms: Math.round(e.duration), kb: Math.round((e.transferSize ?? 0) / 1024),
    })).filter((x) => /\.(js|wasm|json|bin)$|worlds$/.test(x.f)).slice(0, 40);
  } catch { return []; }
}

const sockets = new Map<number, ShimWebSocket>();
let persistence: Persistence | null = null;
let persistInfo: any = null;
let library: WorldLibrary | null = null;
/** 「使用本机密钥」: per capability, the player's own key (in memory only, never the VFS); {} = all on Worldlines. */
let localKey: LocalKeyRoutes = {};
/** Rewrites models.json for the chat route's context window (gateway mode only). */
let writeModels: ((contextWindow?: number) => void) | null = null;

/**
 * The signed-in account's access token. The in-tab server owns the session
 * (apps/server sync/remote-client.ts) and registers `__airpAccountToken`, which
 * refreshes it when needed; before the server has loaded, the session file.
 */
async function accountToken(force = false): Promise<string | null> {
  const hook = (globalThis as any).__airpAccountToken as ((o: { force?: boolean }) => Promise<string | null>) | undefined;
  if (hook) return hook({ force });
  try { const s = JSON.parse(fs.readFileSync('/home/web/.config/airp/remote.json', 'utf8')); return s.session?.accessToken ?? s.accessToken ?? null; } catch { return null; }
}

/** The guest trial's token (apps/server sync/guest-session.ts `__airpGuestToken`): signed out, trial world only. */
async function guestToken(force = false): Promise<string | null> {
  const hook = (globalThis as any).__airpGuestToken as ((o: { force?: boolean }) => Promise<string | null>) | undefined;
  return hook ? hook({ force }) : null;
}

/** The catalog config from the page; `services` uses the signed-in account's token for bundles and drafts. */
function catalogFrom(c: any): CatalogConfig {
  if (c.kind !== 'services') return { kind: 'host', base: c.base };
  return { kind: 'services', identity: c.identity, storage: c.storage, token: () => accountToken(), trial: typeof c.trial === 'string' ? c.trial : null };
}

/** The pack apps/server's /api/browser-runtime/image serves: u32le header length, JSON [[path, size]…], bytes. */
function unpackImage(buf: ArrayBuffer): Record<string, Uint8Array> {
  const dv = new DataView(buf);
  const hlen = dv.getUint32(0, true);
  const entries: [string, number][] = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, hlen)));
  const out: Record<string, Uint8Array> = {};
  let off = 4 + hlen;
  for (const [p, n] of entries) { out[p] = new Uint8Array(buf, off, n); off += n; }
  return out;
}

/**
 * Point pi-ai at the models: every provider the server may pick (world
 * preference, or the openai default) gets `<base>` and a placeholder key.
 * Dev host: `<proxy>/<provider>/v1`, the real key lives only in the proxy.
 * Static site: the Worldlines gateway for all of them; the gateway fetch
 * (platform/model-gateway.ts) swaps in the account's token.
 */
function writeModelConfig(baseFor: (provider: string) => string, apiKey: string, contextWindow?: number) {
  const example = '/repo/config/deepseek-models.example.json';
  const models = fs.existsSync(example) ? JSON.parse(fs.readFileSync(example, 'utf8')) : { providers: {} };
  for (const [name, p] of Object.entries<any>(models.providers)) {
    p.baseUrl = baseFor(name); p.apiKey = apiKey;
    // 「使用本机密钥」 on a smaller model: agents started from now on compact within its window (a number, never the key).
    if (contextWindow && Array.isArray(p.models)) for (const m of p.models) m.contextWindow = Math.min(m.contextWindow ?? contextWindow, contextWindow);
  }
  models.providers.openai = { ...models.providers.openai, baseUrl: baseFor('openai'), apiKey };
  fs.mkdirSync('/repo/.pi/agent', { recursive: true });
  fs.writeFileSync('/repo/.pi/agent/models.json', JSON.stringify(models, null, 2));
  if (!fs.existsSync('/repo/.pi/agent/settings.json')) fs.writeFileSync('/repo/.pi/agent/settings.json', '{ "defaultThinkingLevel": "low" }\n');
}

async function boot(msg: any) {
  mark('bootStart');
  const catalog = msg.catalog ? createCatalog(catalogFrom(msg.catalog)) : null;
  // The catalog list (network) runs while SQLite finishes and the image is unpacked.
  if (catalog) library = new WorldLibrary(catalog, '/repo', (root) => persistence?.ignore(root));
  const listing = library?.list();
  listing?.catch(() => { /* reported by init() below */ });
  await earlySqlite;
  mark('sqlite');
  const files: Record<string, Uint8Array> = msg.image ? unpackImage(msg.image) : msg.files;
  for (const [p, b] of Object.entries(files)) if (p.endsWith('.db')) walToRollback(b);
  writeTree(files);
  mark('vfs');
  if (library) {
    try { await library.init(listing); } catch (e) { post({ type: 'log', level: 'error', message: `catalog: ${e}` }); }
    (globalThis as any).__airpStats.worlds = library.stats;
    mark('catalog');
  }
  if (msg.persist) {
    const blobs = catalog ? { has: catalog.hasBlob, read: catalog.readCachedBlob } : undefined;
    persistence = await startPersistence(msg.persist.ns ?? 'default', (e) => post({ type: 'log', level: 'error', message: `persist: ${e}` }), blobs);
    persistInfo = persistence ? { kind: persistence.kind, restored: persistence.restored } : { kind: 'none', reason: 'another tab owns the store' };
    mark('persist');
  }
  library?.afterRestore();
  if (msg.model?.base) {
    const base = String(msg.model.base).replace(/\/+$/, '');
    localKey = parseLocalKeyRoutes(msg.localKey);
    writeModels = (contextWindow) => writeModelConfig(() => base, 'worldlines-account', contextWindow);
    writeModels(localKey.chat?.contextWindow);
    const direct = (globalThis as any).fetch.bind(globalThis) as typeof fetch;
    const gateway = createGatewayFetch(direct, {
      base, product: msg.model.product ?? 'livingcanvas', map: msg.model.map, token: accountToken, guestToken,
      onAuthRequired: (reason) => post({ type: 'auth-required', ...(reason ? { reason } : {}) }),
      // The in-tab server's open world (apps/server/src/gateway-world.ts); none before it has loaded.
      world: () => (globalThis as any).__airpGatewayWorld?.() ?? null,
    });
    // Chat / images / voice on the player's own key where they chose it (platform/local-key.ts); the rest stays on the gateway.
    (globalThis as any).fetch = timeModelRequests(createLocalKeyFetch(gateway, direct, { gatewayBase: base, current: () => localKey }), base);
  } else if (msg.modelProxy) writeModelConfig((name) => `${msg.modelProxy}/${name}/v1`, 'browser-proxy');
  if (msg.netProxy) {
    try { installNetProxy(msg.netProxy, await (await fetch(msg.netProxy)).json()); } catch (e) { post({ type: 'log', level: 'error', message: `net proxy: ${e}` }); }
  }
  const env = { HOME: '/home/web', PATH: '/usr/bin', ...msg.env };
  fs.mkdirSync('/home/web', { recursive: true });
  fs.mkdirSync('/tmp', { recursive: true });
  await earlyServer.catch(() => null);
  mark('serverLoaded');
  const { main } = await runProgram('server', { argv: ['node', '/repo/apps/server/dist/index.js'], env, cwd: '/repo' }, (globalThis as any).process);
  // The server's top level ends with listen(). If it died first, booting must fail with WHY — answering
  // 'ready' left every /api request and /ws open failing with "server has not called listen()" (2026-10-06).
  const stopped = await main; // first: the server registers itself only while its top level runs
  const failed = serverStartFailure(httpServer(), stopped);
  if (failed) throw new Error(failed);
  mark('serverReady');
  post({ type: 'ready', marks, persist: persistInfo });
  // Warm pi.js while the player looks at the launcher: one `pi --version` run
  // compiles its module code, so the first real agent spawn (on opening a world)
  // does not parse and compile ~9 MB while the player waits.
  if (!msg.noPrewarm) setTimeout(() => {
    const t = performance.now();
    void runProgram('pi', { argv: ['node', '/repo/vendor/pi-rp/packages/coding-agent/dist/cli.js', '--version'], env: { ...env, PI_OFFLINE: '1' }, cwd: '/repo' })
      .then(({ main }) => main).then(() => { marks.piPrewarmMs = Math.round(performance.now() - t); }, () => {});
  }, 1500);
}

const httpServer = () => (globalThis as any).__airpHttpServers?.[0] ?? null;
function server() {
  const s = httpServer();
  if (!s) throw new Error('server has not called listen()');
  return s;
}

self.onmessage = async (ev: MessageEvent) => {
  const msg = ev.data;
  try {
    if (msg.type === 'init') await boot(msg);
    else if (msg.type === 'fetch') {
      const r = (library && await library.intercept(msg)) || await dispatch(server(), msg);
      post({ type: 'response', id: msg.id, ...r }, [r.body.buffer]);
    } else if (msg.type === 'ws-open') {
      const req = new IncomingMessage();
      req.method = 'GET';
      req.url = msg.url;
      req.headers = { host: 'localhost', upgrade: 'websocket', connection: 'Upgrade' };
      // No server (it never started): close this socket instead of leaving the page's WebSocket CONNECTING forever.
      if (!httpServer()) { post({ type: 'ws-closed', id: msg.id, code: 1011, reason: 'server not running' }); return; }
      const sock: any = new FakeSocket();
      sock.__makeWebSocket = () => {
        const ws = new ShimWebSocket();
        ws._sendOut = (data) => post({ type: 'ws-message', id: msg.id, data });
        ws._closeOut = (code, reason) => { sockets.delete(msg.id); post({ type: 'ws-closed', id: msg.id, code, reason }); };
        sockets.set(msg.id, ws);
        queueMicrotask(() => post({ type: 'ws-opened', id: msg.id }));
        return ws;
      };
      server().emit('upgrade', req, sock, new Uint8Array(0));
    } else if (msg.type === 'ws-send') sockets.get(msg.id)?._receive(msg.data);
    else if (msg.type === 'ws-close') sockets.get(msg.id)?._remoteClose(msg.code, msg.reason);
    else if (msg.type === 'flush') {
      flushAllDatabases();
      const saved = persistence ? await persistence.flush({ full: !!msg.full }) : null;
      post({ type: 'flushed', id: msg.id, saved });
    } else if (msg.type === 'persist-reset') { await persistence?.reset(); post({ type: 'reset', id: msg.id }); }
    else if (msg.type === 'write') {
      fs.mkdirSync(msg.path.slice(0, msg.path.lastIndexOf('/')) || '/', { recursive: true });
      fs.writeFileSync(msg.path, msg.data);
      post({ type: 'written', id: msg.id });
    }
    else if (msg.type === 'local-key') {
      // Takes effect from the next model request; running agents need no restart.
      const before = localKey.chat?.contextWindow;
      localKey = parseLocalKeyRoutes(msg.config);
      if (localKey.chat?.contextWindow !== before) writeModels?.(localKey.chat?.contextWindow);
      post({ type: 'local-key-set', id: msg.id, active: Object.keys(localKey) });
    }
    else if (msg.type === 'prefetch-world') void library?.prefetch(String(msg.worldPath ?? ''));
    else if (msg.type === 'ping') post({ type: 'pong', id: msg.id });
    else if (msg.type === 'stats') post({ type: 'stats', id: msg.id, stats: { ...(globalThis as any).__airpStats, files: fetchedFiles() }, marks });
    else if (msg.type === 'tree') post({ type: 'tree', id: msg.id, paths: fs.existsSync(msg.path) ? Object.keys(readTree(msg.path)).map((p) => `${msg.path}/${p}`) : [] });
    else if (msg.type === 'read') post({ type: 'read', id: msg.id, data: fs.existsSync(msg.path) ? fs.readFileSync(msg.path, 'utf8') : null });
  } catch (e: any) {
    post({ type: 'error', id: msg.id, message: errorText(e) });
  }
};
void reg;
post({ type: 'loaded' });

/** V8 puts "Name: message" on the first line of `stack`; WebKit / Safari does not — keep the message. */
function errorText(e: any): string {
  if (!e || typeof e !== 'object') return String(e);
  const head = `${e.name ?? 'Error'}: ${e.message ?? ''}`;
  const stack = typeof e.stack === 'string' ? e.stack : '';
  return stack.startsWith(head) ? stack : `${head}${stack ? `\n${stack}` : ''}`;
}
