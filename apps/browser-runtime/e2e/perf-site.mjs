// Load and play timings of the browser-mode site (canvas.worldlines.gg, `release.sh preview`,
// `prod-sim.mjs --serve`) or of the local Node app (`?mode=network`), measured from outside the page in a
// fresh profile, then again in the same profile (warm). Each run:
//   lobby     navigation → first launcher brick           ready  navigation → in-tab server listening
//   files     runtime files as the page and the Worker fetched them (KB over the wire; 0 = from a cache)
// With --play (needs a session: --sim-signin on prod-sim, or a signed-in profile): open a world (click → canvas
// image), enter a layer (POST /api/enter-layer), one character reply and one writer turn (PAID model calls: two
// turns, DeepSeek V4 Flash by default — a fraction of a cent), each split by the page's ?perf=1 table into model
// time (the Worker's requests to the gateway) and the rest.
//   node apps/browser-runtime/e2e/perf-site.mjs --url <site> [--browser chromium|webkit] [--runs 2]
//        [--play] [--sim-signin] [--node] [--world Holmes] [--throttle <rttMs>:<kbps>] [--card-wait <ms>] [--turns character,writer] [--settle <ms>] [--json]
import { chromium, webkit, devices } from 'playwright-core';
import { chromiumPath, REMOTE_JSON } from './session-steps.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const SITE = opt('--url', 'https://canvas.worldlines.gg/');
const KIND = opt('--browser', 'chromium');
const RUNS = Number(opt('--runs', 2));
const NODE = args.includes('--node'); // the local Node app: ?mode=network, no Worker
const PLAY = args.includes('--play');
const WORLD = opt('--world', 'Holmes|福尔摩斯|ホームズ');
const THROTTLE = opt('--throttle', null); // e.g. 60:20000 = 60 ms RTT, 20 Mbit/s down (Chromium only)
const CARD_WAIT = Number(opt('--card-wait', 0)); // ms on the open card before 「Start」
const browser = KIND === 'webkit' ? await webkit.launch() : await chromium.launch({ executablePath: chromiumPath() });
const ctx = await browser.newContext(KIND === 'webkit' ? { ...devices['iPhone 15'], locale: 'en-US' } : { viewport: { width: 1400, height: 900 }, locale: 'en-US' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
if (THROTTLE && KIND === 'chromium') {
  const [rtt, kbps] = THROTTLE.split(':').map(Number);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  // Applies to the page AND its Workers (the service worker / module worker share the network stack's throttle).
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: rtt, downloadThroughput: (kbps * 1024) / 8, uploadThroughput: (kbps * 1024) / 8 });
}
const url = new URL(SITE);
url.searchParams.set('perf', '1');
if (NODE) url.searchParams.set('mode', 'network');

const workerStats = () => page.evaluate(() => window.__airpRuntime?.stats().then((s) => ({ marks: s.marks, files: s.stats?.files, worlds: s.stats?.worlds, model: s.stats?.model })) ?? null);

async function load(label) {
  const t0 = Date.now();
  await page.goto(url.href, { waitUntil: 'commit' });
  let ready = null;
  const readyP = NODE ? Promise.resolve() : page.waitForFunction(() => window.__airpBrowserMode, null, { timeout: 180000, polling: 50 }).then(() => { ready = Date.now() - t0; }, () => {});
  await page.locator('.world-launcher__hit').first().waitFor({ timeout: 180000 });
  const lobby = Date.now() - t0;
  await Promise.race([readyP, page.waitForTimeout(1000)]);
  const pageFiles = await page.evaluate(() => performance.getEntriesByType('resource')
    .filter((e) => /\/runtime\/|\/assets\/index-|image\.bin|\/api\/browser-runtime\/(dist|image)/.test(e.name))
    .map((e) => ({ f: e.name.split('?')[0].split('/').pop(), start: Math.round(e.startTime), ms: Math.round(e.duration), kb: Math.round((e.transferSize ?? 0) / 1024) })));
  const w = NODE ? null : await workerStats();
  const marks = await page.evaluate(() => window.__airpPerf?.state.marks ?? null);
  const slowApi = await page.evaluate(() => (window.__airpPerf?.state.api ?? []).filter((a) => a.ms > 300).slice(0, 8));
  const longTasks = await page.evaluate(() => (window.__airpPerf?.state.longTasks ?? []).filter(([, d]) => d > 200));
  return { label, readyMs: ready, lobbyMs: lobby, pageMarks: marks, slowApi, longTasks, workerMarks: w?.marks, files: [...pageFiles, ...(w?.files ?? []).map((f) => ({ ...f, f: `W ${f.f}` }))] };
}

async function simSignIn() {
  // prod-sim's fake identity accepts any sim-access-N; the in-tab server reads its session file on demand.
  await page.evaluate(async ([file, origin]) => {
    const rt = window.__airpRuntime;
    let stored = {};
    try { stored = JSON.parse((await rt.call({ type: 'read', path: file })).data ?? '{}'); } catch { /* none */ }
    stored.url ??= `${origin}/fake-storage/`;
    stored.auth ??= { provider: 'worldlines', issuer: `${origin}/fake-auth` };
    stored.session = { accessToken: 'sim-access-900', refreshToken: 'sim-refresh-900', expiresAt: Date.now() + 3600e3, uid: 'sim-user-1', email: 'perf@example.test' };
    await rt.call({ type: 'write', path: file, data: JSON.stringify(stored) });
  }, [REMOTE_JSON, url.origin]);
}

async function openWorld() {
  await page.waitForFunction((w) => [...document.querySelectorAll('.world-launcher__hit')].some((h) => h.getAttribute('aria-expanded') !== null && new RegExp(w, 'i').test(h.getAttribute('aria-label') ?? '')), WORLD, { timeout: 60000 });
  await page.evaluate((w) => {
    const hits = [...document.querySelectorAll('.world-launcher__hit')].filter((h) => h.getAttribute('aria-expanded') !== null);
    const named = hits.filter((h) => new RegExp(w, 'i').test(h.getAttribute('aria-label') ?? ''));
    (named.length ? named : hits)[0].click();
  }, WORLD);
  const start = page.getByRole('button', { name: /Start a new game|Start game|开始新游戏|开始游戏|新しいゲーム|ゲーム開始|게임 시작|새 게임/ }).first();
  await start.waitFor({ timeout: 15000 });
  await page.waitForTimeout(CARD_WAIT); // the player reads the card (prefetch time)
  const t = Date.now();
  await start.evaluate((b) => b.click());
  await page.locator('.world-launcher').waitFor({ state: 'detached', timeout: 180000 });
  await page.waitForFunction(() => [...document.images].some((i) => i.complete && i.naturalWidth > 0 && i.src.includes('/api/asset')), null, { timeout: 180000 });
  return Date.now() - t;
}

async function enterLayer() {
  // The first layer that opens (some are gated behind backpack items: 409).
  return page.evaluate(async () => {
    const m = await (await fetch('/api/manifest')).json();
    const tried = [];
    for (const layer of Object.keys(m.layers ?? {}).filter((l) => l !== 'map')) {
      const t = performance.now();
      const r = await fetch('/api/enter-layer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ layer }) });
      await r.text();
      const ms = Math.round(performance.now() - t);
      if (r.status === 200) return { layer, ms, gatedFirst: tried.length };
      tried.push(r.status);
    }
    return { error: `no enterable layer (${tried.join(',')})` };
  });
}

/** One prompt on a fresh socket; first delta and done, in page ms. */
function turn(kind) {
  return page.evaluate(([kind]) => new Promise(async (resolve) => {
    const save = (await (await fetch('/api/world-settings')).json()).world;
    let character = null;
    if (kind === 'character') {
      const chars = await (await fetch('/api/characters')).json();
      character = (Array.isArray(chars) ? chars : chars.characters ?? [])[0]?.id;
    }
    const ws = new WebSocket(`${location.origin.replace('http', 'ws')}/ws?v=1`);
    let t0 = 0, first = null, text = '';
    const done = (extra) => { try { ws.close(); } catch { /* closed */ } resolve({ ms: Math.round(performance.now() - t0), firstMs: first, start: t0, chars: text.length, ...extra }); };
    const timer = setTimeout(() => done({ error: 'timeout' }), 180000);
    ws.onmessage = (e) => {
      if (typeof e.data !== 'string') return;
      const f = JSON.parse(e.data);
      if (f.type === 'error') { clearTimeout(timer); done({ error: String(f.message).slice(0, 200) }); }
      if (f.type === `${kind}_delta`) { if (first === null) first = Math.round(performance.now() - t0); text += f.delta ?? ''; }
      if (kind === 'writer' && f.type === 'writer_idle' && first !== null) { clearTimeout(timer); done({}); }
      if (kind === 'character' && (f.type === 'character_message' || (f.type === 'character_idle' && text))) { clearTimeout(timer); done({}); }
    };
    ws.onopen = () => {
      t0 = performance.now();
      ws.send(JSON.stringify(kind === 'writer'
        ? { type: 'writer_prompt', savePath: save, message: 'I look around the room and read the note on the desk.' }
        : { type: 'character_prompt', savePath: save, characterId: character, message: 'Hello. Who are you? (one sentence)' }));
    };
  }), [kind]);
}

/** Model time inside a turn (the Worker's gateway requests, epoch-stamped) vs the rest. */
function split(t, model, origin) {
  const reqs = (model ?? []).map((r) => ({ ...r, at: r.at - origin })).filter((r) => r.at >= t.start - 5 && r.at <= t.start + t.ms);
  let busy = 0, end = -Infinity;
  for (const r of reqs.sort((a, b) => a.at - b.at)) { const s = Math.max(r.at, end), e = r.at + r.ms; if (e > s) busy += e - s; end = Math.max(end, e); }
  return { modelRequests: reqs.length, firstHeadersMs: reqs[0]?.headersMs ?? null, sumHeadersMs: reqs.reduce((n, r) => n + r.headersMs, 0), modelMs: Math.round(busy), otherMs: Math.round(t.ms - busy) };
}

async function play(label) {
  const r = { label };
  r.openWorldMs = await openWorld();
  await page.waitForTimeout(1500);
  r.enterLayer = await enterLayer();
  if (!args.includes('--no-turns')) {
    const origin = await page.evaluate(() => performance.timeOrigin);
    for (const kind of opt('--turns', 'character,writer').split(',')) {
      const t = await turn(kind);
      const stats = NODE ? null : await workerStats();
      r[kind] = { ...t, ...(stats ? split(t, stats.model, origin) : {}) };
      delete r[kind].start;
    }
  }
  const s = NODE ? null : await workerStats();
  r.worldsOpened = s?.worlds?.opened;
  r.worldsPrefetched = s?.worlds?.prefetched;
  r.api = await page.evaluate(() => window.__airpPerf?.state.api.filter((a) => /worlds\/load|enter-layer|asset/.test(a.path)).slice(0, 12) ?? null);
  return r;
}

const out = { url: SITE, browser: KIND, node: NODE, throttle: THROTTLE, runs: [], play: [] };
try {
  for (let i = 0; i < RUNS; i++) {
    out.runs.push(await load(i === 0 ? 'cold' : `warm${i}`));
    if (PLAY && (i === 0 || i === RUNS - 1)) {
      if (args.includes('--sim-signin') && i === 0) await simSignIn();
      out.play.push(await play(i === 0 ? 'cold' : `warm${i}`));
      if (!NODE) await page.evaluate(() => window.__airpRuntime.flush());
    }
    await page.waitForTimeout(Number(opt('--settle', 7000))); // the overlay flush, the pi prewarm and the static-file precache (5 s after ready) settle
  }
} catch (e) {
  out.error = String(e?.stack ?? e).slice(0, 800);
  await page.screenshot({ path: new URL('./out/perf-site-error.png', import.meta.url).pathname }).catch(() => {});
}
out.errors = errors.slice(0, 5);
if (args.includes('--json')) console.log(JSON.stringify(out, null, 1));
else {
  console.log(`${KIND}${NODE ? ' node' : ''} ${SITE}${THROTTLE ? ` throttle ${THROTTLE}` : ''}`);
  for (const r of out.runs) {
    console.log(`  ${r.label}: ready ${r.readyMs ?? '-'} · lobby ${r.lobbyMs} ms · page ${JSON.stringify(r.pageMarks ?? {})} · worker ${JSON.stringify(r.workerMarks ?? {})}`);
    if (r.slowApi?.length) console.log(`     slow /api: ${r.slowApi.map((a) => `${a.path} ${a.ms}ms@${a.at}`).join(', ')}`);
    if (r.longTasks?.length) console.log(`     long tasks > 200 ms (start, ms): ${r.longTasks.map(([s, d]) => `${s}+${d}`).join(' ')}`);
    for (const f of r.files) console.log(`     ${f.f.padEnd(30)} start ${String(f.start).padStart(5)}  ${String(f.ms).padStart(5)} ms  ${String(f.kb).padStart(6)} KB`);
  }
  for (const p of out.play) console.log(`  play ${p.label}: ${JSON.stringify({ ...p, label: undefined })}`);
  if (out.error) console.log('ERROR', out.error);
  if (out.errors.length) console.log('page errors', out.errors);
}
await browser.close();
