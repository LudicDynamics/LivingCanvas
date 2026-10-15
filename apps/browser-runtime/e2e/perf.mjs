// Where does browser mode stall? Starts its own host (default :3198) and, in a
// fresh headless profile, measures:
//   boot       page load → in-tab server ready (+ the Worker's own marks)
//   launcher   page load → first launcher brick
//   world      「开始新游戏」 → canvas ready (the "Write an action" button)
//   relay      round trip of a tiny /api GET through SW → page → Worker (median / p95)
//   jank       page main-thread long tasks (>50 ms, PerformanceObserver) and the
//              largest requestAnimationFrame gap, per phase
//   worker     Worker responsiveness: RTT of a no-op message sent every 100 ms (max / p95), per phase
//   rss        peak renderer RSS (MB, all renderer processes of the headless shell)
// --turn runs one writer turn (paid model calls; see status.modelCalls).
// --reload also measures a warm second load (same profile, OPFS overlay present).
//   node apps/browser-runtime/e2e/perf.mjs [--port 3198] [--turn] [--reload] [--world whitechapel]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { startUiHost } from './ui-host.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const host = await startUiHost({ port: Number(opt('--port', 3198)), quiet: true });
const CACHE = path.join(os.homedir(), 'Library/Caches/ms-playwright');
const shell = fs.readdirSync(CACHE).filter((d) => d.startsWith('chromium_headless_shell-')).sort().reverse()
  .map((d) => path.join(CACHE, d, 'chrome-headless-shell-mac-arm64/chrome-headless-shell')).find((p) => fs.existsSync(p));
const MARK = `--airp-perf=${process.pid}`; // finds OUR browser's renderers (other headless shells may be running)
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME ?? shell, args: [MARK] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
const TRACE = opt('--trace', null); // boot | open | turn: trace that phase, summarise long tasks per thread
const traceFile = path.join(os.tmpdir(), `airp-perf-trace-${process.pid}.json`);
const PROF = opt('--profile-page', null); // boot | open | turn: CPU profile of the page main thread, top self time
let profCdp = null;
async function profStart(ph) { if (PROF !== ph) return; profCdp = await ctx.newCDPSession(page); await profCdp.send('Profiler.enable'); await profCdp.send('Profiler.setSamplingInterval', { interval: 200 }); await profCdp.send('Profiler.start'); }
async function profStop(ph) {
  if (PROF !== ph || !profCdp) return;
  const { profile } = await profCdp.send('Profiler.stop');
  const dt = {}; const self = {};
  profile.samples.forEach((id, i) => { dt[id] = (dt[id] ?? 0) + (profile.timeDeltas[i] ?? 0); });
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const parent = new Map(); for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const total = {};
  for (const n of profile.nodes) {
    const f = n.callFrame; const k = `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber + 1}:${f.columnNumber + 1}`;
    self[k] = (self[k] ?? 0) + (dt[n.id] ?? 0) / 1000;
    // inclusive: walk up once per sampled node
    let cur = n.id; const seen = new Set();
    while (cur !== undefined) { const c = byId.get(cur).callFrame; const kk = `${c.functionName || '(anon)'} ${c.url.split('/').pop()}:${c.lineNumber + 1}:${c.columnNumber + 1}`; if (!seen.has(kk)) { total[kk] = (total[kk] ?? 0) + (dt[n.id] ?? 0) / 1000; seen.add(kk); } cur = parent.get(cur); }
  }
  const top = (o) => Object.entries(o).filter(([k]) => !/^\((program|idle|root|garbage collector)\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => `${Math.round(v)}ms ${k}`);
  out.pageProfile = { phase: ph, self: top(self), inclusive: top(total) };
}
// CPU profile of the runtime Worker (raw CDP through the page session: Target.sendMessageToTarget).
const WPROF = opt('--profile-worker', null);
let wprof = null;
async function wprofStart(ph) {
  if (WPROF !== ph) return;
  const cdp = await ctx.newCDPSession(page);
  const { targetInfos } = await cdp.send('Target.getTargets');
  const w = targetInfos.find((t) => t.type === 'worker' && t.url.includes('worker.js'));
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: w.targetId, flatten: false });
  let n = 0; const waiting = new Map();
  cdp.on('Target.receivedMessageFromTarget', (e) => { const m = JSON.parse(e.message); if (waiting.has(m.id)) { waiting.get(m.id)(m.result); waiting.delete(m.id); } });
  const send = (method, params = {}) => new Promise((res) => { const id = ++n; waiting.set(id, res); void cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) }); });
  await send('Profiler.enable'); await send('Profiler.setSamplingInterval', { interval: 200 }); await send('Profiler.start');
  wprof = { send };
}
async function wprofStop(ph) {
  if (WPROF !== ph || !wprof) return;
  const { profile } = await wprof.send('Profiler.stop');
  const dt = {}; profile.samples.forEach((id, i) => { dt[id] = (dt[id] ?? 0) + (profile.timeDeltas[i] ?? 0); });
  const byId = new Map(profile.nodes.map((x) => [x.id, x])); const parent = new Map();
  for (const x of profile.nodes) for (const c of x.children ?? []) parent.set(c, x.id);
  const key = (f) => `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber + 1}`;
  const self = {}, total = {};
  for (const x of profile.nodes) {
    const t = (dt[x.id] ?? 0) / 1000; if (!t) continue;
    self[key(x.callFrame)] = (self[key(x.callFrame)] ?? 0) + t;
    const seen = new Set(); let cur = x.id;
    while (cur !== undefined) { const k = key(byId.get(cur).callFrame); if (!seen.has(k)) { total[k] = (total[k] ?? 0) + t; seen.add(k); } cur = parent.get(cur); }
  }
  const top = (o) => Object.entries(o).filter(([k]) => !/^\((program|idle|root|garbage collector)\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `${Math.round(v)}ms ${k}`);
  out.workerProfile = { phase: ph, self: top(self), inclusive: top(total) };
}
async function traceStart(ph) { if (TRACE === ph) await browser.startTracing(page, { path: traceFile, categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'v8.execute', 'toplevel', 'blink.user_timing'] }); }
async function traceStop(ph) {
  if (TRACE !== ph) return;
  await browser.stopTracing();
  const evs = JSON.parse(fs.readFileSync(traceFile, 'utf8')).traceEvents ?? [];
  const names = {};
  for (const e of evs) if (e.name === 'thread_name') names[`${e.pid}:${e.tid}`] = e.args.name;
  const tasks = evs.filter((e) => e.ph === 'X' && (e.name === 'RunTask' || e.name === 'ThreadControllerImpl::RunTask') && e.dur > 50000);
  const byThread = {};
  for (const t of tasks) {
    const k = `${t.pid}:${t.tid}`;
    const th = (byThread[names[k] ?? k] ??= { longTasks: 0, ms: 0, max: 0, top: {} });
    th.longTasks++; th.ms += t.dur / 1000; th.max = Math.max(th.max, t.dur / 1000);
    for (const e of evs) {
      if (e.ph !== 'X' || e.pid !== t.pid || e.tid !== t.tid || e.ts < t.ts || e.ts > t.ts + t.dur || e === t || !(e.dur > 10000)) continue;
      if (!['FunctionCall', 'EvaluateScript', 'v8.compile', 'v8.compileModule', 'v8.evaluateModule', 'ParseHTML', 'Layout', 'UpdateLayoutTree', 'Paint', 'MajorGC', 'MinorGC', 'V8.GCFinalizeMC', 'TimerFire', 'HandlePostMessage', 'EventDispatch', 'FireAnimationFrame', 'v8.run', 'v8.produceModuleCache', 'V8.GC_MC_BACKGROUND_MARKING'].includes(e.name)) continue;
      const d = e.args?.data ?? {};
      const label = `${e.name} ${(d.url ?? d.fileName ?? d.type ?? '').split('/').pop().slice(0, 40)}${d.functionName ? ` ${d.functionName}` : ''}`;
      th.top[label] = (th.top[label] ?? 0) + e.dur / 1000;
    }
  }
  for (const th of Object.values(byThread)) { th.ms = Math.round(th.ms); th.max = Math.round(th.max); th.top = Object.entries(th.top).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${Math.round(v)}ms ${k}`); }
  out.trace = { phase: ph, byThread };
  fs.rmSync(traceFile, { force: true });
}

await ctx.addInitScript(() => {
  const P = (window.__perf = { phase: 'boot', long: [], raf: {}, rtt: {} });
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) P.long.push([P.phase, Math.round(e.duration)]); }).observe({ type: 'longtask', buffered: true }); } catch { /* no longtask */ }
  let last = performance.now();
  const tick = (t) => { const g = t - last; last = t; P.raf[P.phase] = Math.max(P.raf[P.phase] ?? 0, Math.round(g)); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  const ping = async () => {
    const rt = window.__airpRuntime;
    if (rt && window.__airpBrowserMode) {
      const t = performance.now();
      await rt.call({ type: 'ping' });
      (P.rtt[P.phase] ??= []).push(Math.round(performance.now() - t));
    }
    setTimeout(ping, 100);
  };
  setTimeout(ping, 100);
});

const out = { runs: [] };
let peakRss = 0;
const rssNow = () => {
  try {
    const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,rss=,command=']).toString().split('\n').map((l) => l.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/)).filter(Boolean);
    const root = rows.find((r) => r[4].includes(MARK) && !r[4].includes('--type='));
    if (!root) return 0;
    return rows.filter((r) => r[2] === root[1] && r[4].includes('--type=renderer')).reduce((t, r) => t + Number(r[3]) / 1024, 0);
  } catch { return 0; }
};
const rssTimer = setInterval(() => { peakRss = Math.max(peakRss, rssNow()); }, 250);
const setPhase = (p) => page.evaluate((x) => { window.__perf.phase = x; }, p);
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null; };

const NETWORK = args.includes('--network-mode'); // the same flow against the host (reference numbers)
// A long-running host has hashed its catalog already; do not bill a fresh host's first hash to the tab.
await fetch(`${host.url}/api/browser-runtime/catalog/v1/resources?scope=public&product=livingcanvas&kind=world`).catch(() => {});
async function load(label) {
  if (label === 'cold') { await traceStart('boot'); await profStart('boot'); }
  const t0 = Date.now();
  await page.goto(`${host.url}/?mode=${NETWORK ? 'network' : 'browser'}`);
  if (!NETWORK) await page.waitForFunction(() => window.__airpBrowserMode || /启动失败/.test(document.body.innerText), null, { timeout: 120000 });
  const bm = NETWORK ? null : await page.evaluate(() => window.__airpBrowserMode);
  const bootWall = Date.now() - t0;
  await page.locator('.world-launcher__hit').first().waitFor({ timeout: 60000 });
  const launcher = Date.now() - t0;
  if (label === 'cold') { await traceStop('boot'); await profStop('boot'); }
  await setPhase('launcher');
  await page.waitForTimeout(2500);
  const titles = [...new Set(await page.locator('.world-launcher__caption b').allInnerTexts())];
  return { label, bootWallMs: bootWall, bootMs: bm?.bootMs, marks: bm?.marks, imageBytes: bm?.imageBytes, persist: bm?.persist, launcherMs: launcher, launcherWorlds: titles.length, titles: titles.slice(0, 40) };
}

try {
  out.runs.push(await load('cold'));
  const want = opt('--world', 'Holmes');
  await setPhase('open');
  const clicked = await page.evaluate((w) => {
    const hits = [...document.querySelectorAll('.world-launcher__hit')];
    const d = (b) => { const r = b.getBoundingClientRect(); return Math.hypot(r.x + r.width / 2 - innerWidth / 2, r.y + r.height / 2 - innerHeight / 2); };
    const worlds = hits.filter((h) => h.getAttribute('aria-expanded') !== null);
    const named = worlds.filter((h) => new RegExp(w, 'i').test(h.getAttribute('aria-label') ?? ''));
    const pick = (named.length ? named : worlds).sort((a, b) => d(a) - d(b))[0];
    pick.click();
    return pick.getAttribute('aria-label');
  }, want);
  const start = page.getByRole('button', { name: /Start a new game|Start game|开始新游戏|开始游戏|新しいゲーム|ゲーム開始|게임 시작|새 게임/ }).first();
  await start.waitFor({ timeout: 15000 });
  await traceStart('open'); await profStart('open'); await wprofStart('open');
  const tOpen = Date.now();
  await start.evaluate((b) => b.click());
  await page.locator('.world-launcher').waitFor({ state: 'detached', timeout: 120000 });
  await page.waitForFunction(() => [...document.images].some((i) => i.complete && i.naturalWidth > 0 && i.src.includes('/api/asset')), null, { timeout: 120000 });
  out.world = { clicked, openToReadyMs: Date.now() - tOpen };
  await traceStop('open'); await profStop('open'); await page.waitForTimeout(1500); await wprofStop('open');
  await setPhase('canvas');
  await page.waitForTimeout(3000);
  out.relay = await page.evaluate(async () => {
    const ts = [];
    for (let i = 0; i < 20; i++) { const t = performance.now(); await (await fetch('/api/world-settings')).text(); ts.push(performance.now() - t); }
    ts.sort((a, b) => a - b);
    return { medianMs: +ts[10].toFixed(1), p95Ms: +ts[18].toFixed(1) };
  });
  if (args.includes('--turn')) {
    const calls0 = (await (await fetch(`${host.url}/api/browser-runtime/status`)).json()).modelCalls;
    await setPhase('turn');
    out.turn = await page.evaluate(async () => new Promise((resolve) => {
      const ws = new WebSocket(`${location.origin.replace("http", "ws")}/ws?v=1`);
      const t0 = performance.now(); let first = null; const lat = [];
      const probe = setInterval(async () => { const t = performance.now(); await (await fetch('/api/world-settings')).text(); lat.push(Math.round(performance.now() - t)); }, 250);
      const done = (extra) => { clearInterval(probe); lat.sort((a, b) => a - b); resolve({ ms: Math.round(performance.now() - t0), firstDeltaMs: first, apiDuringTurn: { p50: lat[lat.length >> 1], max: lat[lat.length - 1], n: lat.length }, ...extra }); };
      const types = {}; let err = null;
      ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } types[m.type] = (types[m.type] ?? 0) + 1; if (m.type === 'error' && !err) err = String(m.message).slice(0, 200); if (m.type === 'writer_delta' && first === null) first = Math.round(performance.now() - t0); if (m.type === 'writer_idle' && first !== null) done({ types }); };
      ws.onopen = async () => ws.send(JSON.stringify({ type: 'writer_prompt', savePath: (await (await fetch('/api/world-settings')).json()).world, message: 'I look around and read the note on the desk.' }));
      setTimeout(() => done({ timeout: true, types, err }), 120000);
    }));
    out.turn.modelCalls = (await (await fetch(`${host.url}/api/browser-runtime/status`)).json()).modelCalls - calls0;
  }
  const perf = await page.evaluate(() => window.__perf);
  out.jank = {};
  for (const ph of ['boot', 'launcher', 'open', 'canvas', 'turn']) {
    const lt = perf.long.filter(([p]) => p === ph).map(([, d]) => d);
    const rtt = perf.rtt[ph] ?? [];
    out.jank[ph] = { longTasks: lt.length, longTaskMs: lt.reduce((a, b) => a + b, 0), maxLongTask: lt.length ? Math.max(...lt) : 0, maxRafGap: perf.raf[ph] ?? null, workerRttP95: q(rtt, 0.95), workerRttMax: rtt.length ? Math.max(...rtt) : null };
  }
  if (!NETWORK) out.stats = await page.evaluate(() => window.__airpRuntime.stats().then((s) => ({ piSpawns: s.stats?.piSpawns, persist: s.stats?.persist, worlds: s.stats?.worlds, marks: s.marks })));
  if (args.includes('--reload')) {
    if (!NETWORK) await page.evaluate(() => window.__airpRuntime.flush());
    out.runs.push(await load('warm'));
  }
} catch (e) {
  out.error = String(e?.stack ?? e).slice(0, 1500);
  await page.screenshot({ path: path.join(path.dirname(new URL(import.meta.url).pathname), 'out', 'perf-error.png') }).catch(() => {});
} finally {
  clearInterval(rssTimer);
  out.peakRendererRssMB = Math.round(peakRss);
  console.log(JSON.stringify(out, null, 1));
  await browser.close();
  host.child.kill();
}
