// Headless check of browser mode in the REAL LivingCanvas UI (apps/web dist):
//   node e2e/ui.mjs [--port 3197] [--action "…"] [--quiet-ms 20000] [--skip-turn]
//                   [--reenter]     Homecoming (guixiang) map: enter a place, back out, enter it AGAIN —
//                                   every entry must reach the server, no "Action confirmed" toast
//                   [--world-lost]  (with --reenter) the in-tab server loses the open world mid-play: the page reopens the same save
// Launcher lists the bundled template → start whitechapel → canvas renders →
// send one action → writer turn frames reach the UI. Screenshots in e2e/out/.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startUiHost } from './ui-host.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out');
fs.mkdirSync(OUT, { recursive: true });
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const action = opt('--action', 'I step out of the cab and look around the street.');
const quietMs = Number(opt('--quiet-ms', 20000));
const result = {};
const log = [];

const host = await startUiHost({ port: Number(opt('--port', 3197)), quiet: true });
const CACHE = path.join(process.env.HOME, 'Library/Caches/ms-playwright');
const shell = fs.readdirSync(CACHE).filter((d) => d.startsWith('chromium_headless_shell-')).sort().reverse()
  .map((d) => path.join(CACHE, d, 'chrome-headless-shell-mac-arm64/chrome-headless-shell')).find((p) => fs.existsSync(p));
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME ?? shell });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('console', (m) => log.push(`[${m.type()}] ${m.text().slice(0, 400)}`));
page.on('pageerror', (e) => log.push(`[pageerror] ${String(e.stack ?? e).slice(0, 600)}`));
const hostRequests = [];
page.on('request', (r) => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/') && !u.pathname.startsWith('/api/browser-runtime/')) hostRequests.push(u.pathname); });
const served = { serviceWorker: 0, network: 0 };
page.on('response', (r) => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/') && !u.pathname.startsWith('/api/browser-runtime/')) served[r.fromServiceWorker() ? 'serviceWorker' : 'network']++; });
result.apiFailures = [];
page.on('response', async (r) => {
  const u = new URL(r.url());
  if (!u.pathname.startsWith('/api/') || r.status() < 400) return;
  const body = await r.text().catch(() => '');
  result.apiFailures.push({ status: r.status(), path: u.pathname + u.search, fromSW: r.fromServiceWorker(), body: body.slice(0, 300), request: (r.request().postData() ?? '').slice(0, 200) });
});
const shot = async (name) => { await page.screenshot({ path: path.join(OUT, `${name}.png`) }); };
const frames = () => page.evaluate(() => ({ ...window.__airpRuntime.frames }));
const t0 = Date.now();
try {
  if (args.includes('--network-mode')) {
    // Default (flag off) must be the ordinary app: no Service Worker, /api from the host.
    await page.goto(`${host.url}/`);
    await page.locator('.world-launcher__hit').first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(2000);
    result.networkMode = { swRegistrations: await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length), runtime: await page.evaluate(() => !!window.__airpRuntime), api: { ...served } };
    throw Object.assign(new Error('network-mode check done'), { done: true });
  }
  await page.goto(`${host.url}/?mode=browser`);
  await page.waitForFunction(() => window.__airpBrowserMode || /启动失败/.test(document.body.innerText), null, { timeout: 90000 });
  result.boot = await page.evaluate(() => window.__airpBrowserMode);
  if (!result.boot) throw new Error(await page.evaluate(() => document.body.innerText.slice(0, 500)));
  await page.locator('.world-launcher__hit').first().waitFor({ timeout: 30000 });
  result.launcherMs = Date.now() - t0;
  result.launcherTitles = [...new Set(await page.locator('.world-launcher__caption b').allInnerTexts())];
  await page.waitForTimeout(1500);
  await shot('1-launcher');
  // Every edition is in the catalog: each language shows its own edition of each world.
  const langs = page.locator('.world-launcher__langs button');
  const initialLang = page.locator('.world-launcher__langs button[aria-pressed="true"]');
  const initialLabel = await initialLang.count() ? (await initialLang.first().innerText()).trim() : null;
  result.editions = {};
  for (let i = 0; i < await langs.count(); i++) {
    const b = langs.nth(i);
    const label = (await b.innerText()).trim();
    await b.click();
    await page.waitForTimeout(600);
    result.editions[label] = [...new Set(await page.locator('.world-launcher__caption b').allInnerTexts())].filter((t) => !/Make a world|创造世界|世界を作る|做一个世界/.test(t));
  }
  if (initialLabel) { await langs.filter({ hasText: initialLabel }).first().click(); await page.waitForTimeout(400); }

  // The wall is endless and draggable: open the brick nearest the centre.
  await page.evaluate((want) => {
    // World bricks only (the "make a world" brick has no aria-expanded); Holmes if it is on the wall.
    const hits = [...document.querySelectorAll('.world-launcher__hit')].filter((h) => h.getAttribute('aria-expanded') !== null);
    const d = (b) => { const r = b.getBoundingClientRect(); return Math.hypot(r.x + r.width / 2 - innerWidth / 2, r.y + r.height / 2 - innerHeight / 2); };
    const holmes = hits.filter((h) => new RegExp(want).test(h.getAttribute('aria-label') ?? ''));
    (holmes.length ? holmes : hits).sort((a, b) => d(a) - d(b))[0].click();
  }, args.includes('--reenter') ? 'Homecoming|归乡|帰郷|귀향' : 'Holmes|福尔摩斯|ホームズ');
  const start = page.getByRole('button', { name: /^(Start game|Start a new game|开始新游戏|开始游戏|新しいゲーム|ゲーム開始|게임 시작|새 게임)/ }).first();
  await start.waitFor({ timeout: 10000 });
  const tLoad = Date.now();
  await start.evaluate((b) => b.click());
  await page.locator('.world-launcher').waitFor({ state: 'detached', timeout: 60000 }).catch(() => {});
  // Canvas ready: a world picture from the in-tab server has rendered. (The chrome
  // differs by mode — classic "Write an action" toggle or the companion FAB.)
  await page.waitForFunction(() => [...document.images].some((i) => i.complete && i.naturalWidth > 0 && i.src.includes('/api/asset')), null, { timeout: 60000 });
  await page.waitForTimeout(3000);
  result.worldLoadMs = Date.now() - tLoad;
  result.canvasImages = await page.evaluate(() => [...document.images].filter((i) => i.complete && i.naturalWidth > 0 && i.src.includes('/api/')).length);
  await shot('2-canvas');
  // 改进产品 (lib/analytics.ts): entering the world queued world_enter (names / counts only; locally nothing is sent).
  result.analyticsTracked = await page.evaluate(() => ({ ...(window.__airpAnalytics?.tracked ?? {}) }));
  if (!result.analyticsTracked.world_enter) throw new Error(`world_enter was not tracked: ${JSON.stringify(result.analyticsTracked)}`);
  // Platform audio is static host content: it must bypass the runtime and load from the network.
  const AUDIO = ['licensed/launcher.mp3', 'foley/canvas/se-card.mp3', 'foley/canvas/se-get.mp3', 'foley/canvas/se-paper.mp3'];
  const audioSeen = [];
  const onAudio = (r) => { if (new URL(r.url()).pathname === '/api/audio') audioSeen.push({ status: r.status(), fromSW: r.fromServiceWorker() }); };
  page.on('response', onAudio);
  result.platformAudio = await page.evaluate((ps) => Promise.all(ps.map((p) => fetch(`/api/audio?path=${encodeURIComponent(p)}`).then((r) => `${p} ${r.status}`))), AUDIO);
  page.off('response', onAudio);
  result.platformAudioViaRuntime = audioSeen.filter((a) => a.fromSW).length;
  if (args.includes('--snapshot-test')) {
    // Snapshot (in-process zip) → drop a probe file into player/ → rollback (in-process unzip) → probe gone, content back.
    result.snapshot = await page.evaluate(async () => {
      const rt = window.__airpRuntime;
      const post = async (url, body) => { const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, text: await r.text() }; };
      const snap = await post('/api/snapshot', { reason: 'e2e' });
      const id = /"snapshot":"([^"]+)"/.exec(snap.text)?.[1];
      const { paths } = await rt.call({ type: 'tree', path: '/repo/worlds' });
      const archive = paths.find((p) => id && p.endsWith(`/${id}.zip`));
      const root = archive?.slice(0, archive.indexOf('/.airpworld/'));
      if (!root) return { snap, error: 'no archive found' };
      const readme = (await rt.call({ type: 'read', path: `${root}/world/README.md` })).data;
      await rt.call({ type: 'write', path: `${root}/player/e2e-probe.md`, data: 'probe' });
      await rt.call({ type: 'write', path: `${root}/world/README.md`, data: 'clobbered' });
      const back = await post('/api/rollback', { snapshot: id });
      const probeAfter = (await rt.call({ type: 'read', path: `${root}/player/e2e-probe.md` })).data;
      const readmeAfter = (await rt.call({ type: 'read', path: `${root}/world/README.md` })).data;
      return { snapStatus: snap.status, id, archive, rollbackStatus: back.status, rollback: back.text.slice(0, 200), probeRemoved: probeAfter === null, readmeRestored: readmeAfter === readme };
    });
  }
  if (args.includes('--probe-layers')) {
    // Every scene of the fresh game must be enterable (gate READMEs parse in the Worker as under Node).
    result.layerProbe = await page.evaluate(async () => {
      const m = await (await fetch('/api/manifest')).json();
      const out = [];
      for (const layer of Object.keys(m.layers ?? {})) {
        const r = await fetch('/api/enter-layer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ layer }) });
        const body = await r.text();
        if (r.status !== 200) out.push({ layer, status: r.status, body: body.slice(0, 300) });
      }
      return { layers: Object.keys(m.layers ?? {}).length, failures: out };
    });
  }

  const enterRequests = [];
  page.on('request', (r) => { if (new URL(r.url()).pathname === '/api/enter-layer') enterRequests.push(JSON.parse(r.postData() ?? '{}').layer); });
  const toastText = () => page.evaluate(() => document.querySelector('.prototype-toast')?.textContent ?? '');
  if (args.includes('--reenter')) {
    //: enter a place, come back out, enter the same place again → nothing happened
    // (a settled success was deduped forever in lib/action-feedback.ts). Three rounds, three entries.
    const place = 'world/ah-di-1947';
    const toasts = new Set();
    result.reenter = { rounds: [] };
    for (let k = 0; k < 3; k++) {
      const before = enterRequests.filter((l) => l === place).length;
      await page.getByText("Don't show this again").first().click({ timeout: 500 }).catch(() => {});
      await page.getByText("Don't show again").first().click({ timeout: 500 }).catch(() => {});
      await page.locator('.map-pin__label', { hasText: 'Luo Adi' }).first().click({ force: true });
      const enter = page.getByRole('button', { name: /^Enter place/ }).first();
      await enter.waitFor({ timeout: 10000 });
      await enter.click({ force: true });
      await page.waitForTimeout(4000);
      const t = await toastText(); if (t) toasts.add(t);
      result.reenter.rounds.push(enterRequests.filter((l) => l === place).length - before);
      await page.keyboard.press('Escape'); await page.waitForTimeout(300); await page.keyboard.press('Escape');
      await page.waitForTimeout(3000);
    }
    result.reenter.toasts = [...toasts];
    await shot('5-reenter');
    if (result.reenter.rounds.some((n) => n !== 1)) throw new Error(`re-entering a place did not reach the server: ${JSON.stringify(result.reenter)}`);
    if (result.reenter.toasts.some((x) => /Action confirmed/.test(x))) throw new Error(`a confirmed action still toasts: ${JSON.stringify(result.reenter)}`);
  }
  if (args.includes('--world-lost') && args.includes('--reenter')) {
    // Make the in-tab server lose its world the way a failed swap does: load a save whose
    // world.json parses but cannot open — the old store is already closed, none replaces it.
    const loads = [];
    const onLoad = (r) => { if (new URL(r.url()).pathname === '/api/worlds/load') loads.push(JSON.parse(r.postData() ?? '{}').worldPath); };
    page.on('request', onLoad);
    result.worldLost = await page.evaluate(async () => {
      const rt = window.__airpRuntime;
      await rt.call({ type: 'write', path: '/repo/worlds/e2e-broken/world.json', data: '{"id":"e2e-broken"}' });
      const r = await fetch('/api/worlds/load', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ worldPath: '/repo/worlds/e2e-broken' }) });
      const m = await fetch('/api/manifest');
      return { brokenLoad: r.status, manifestAfter: m.status };
    });
    // The page's next world-scoped request meets no_active_world → it reopens the same save.
    await page.evaluate(() => {
      window.__e2eToasts = [];
      new MutationObserver(() => { const t = document.querySelector('.prototype-toast')?.textContent; if (t && window.__e2eToasts.at(-1) !== t) window.__e2eToasts.push(t); })
        .observe(document.body, { subtree: true, childList: true, characterData: true });
    });
    // The player acts: entering a place is the next world-scoped request.
    await page.locator('.map-pin__label', { hasText: 'Luo Adi' }).first().click({ force: true });
    await page.getByRole('button', { name: /^Enter place/ }).first().click({ force: true, timeout: 10000 });
    await page.waitForFunction(async () => (await fetch('/api/manifest')).status === 200, null, { timeout: 30000, polling: 1000 }).catch(() => {});
    result.worldLost.loads = loads.slice();
    result.worldLost.reopened = loads.filter((p) => p !== '/repo/worlds/e2e-broken');
    result.worldLost.toasts = await page.evaluate(() => window.__e2eToasts);
    result.worldLost.notice = result.worldLost.toasts.some((t) => /Reopening|重新打开|開き直して|다시 여는/.test(t));
    result.worldLost.manifestNow = await page.evaluate(async () => (await fetch('/api/manifest')).status);
    page.off('request', onLoad);
    await shot('6-world-lost');
    if (!result.worldLost.notice || result.worldLost.toasts.some((t) => /409|no_active_world/.test(t)) || result.worldLost.manifestAfter !== 409 || result.worldLost.manifestNow !== 200 || result.worldLost.reopened.length !== 1 || /templates\//.test(result.worldLost.reopened[0])) {
      throw new Error(`the lost world was not reopened: ${JSON.stringify(result.worldLost)}`);
    }
  }

  if (!args.includes('--skip-turn')) {
    const before = await frames();
    const callsBefore = (await (await fetch(`${host.url}/api/browser-runtime/status`)).json()).modelCalls;
    const toggle = page.getByRole('button', { name: /Write an action/ });
    const tSend = Date.now();
    if (await toggle.isVisible().catch(() => false)) {
      await toggle.click();
      const input = page.getByRole('textbox', { name: 'Action' });
      await input.fill(action);
      await input.press('Enter');
    } else {
      // Companion chrome: send the same writer prompt the action box sends, over the app's socket path.
      await page.evaluate((text) => { const ws = new WebSocket(`${location.origin.replace("http", "ws")}/ws?v=1`); ws.onopen = async () => ws.send(JSON.stringify({ type: 'writer_prompt', savePath: (await (await fetch('/api/world-settings')).json()).world, message: text })); }, action);
    }
    let last = JSON.stringify(before), lastChange = Date.now(), firstDelta = null;
    while (Date.now() - tSend < 300000) {
      await page.waitForTimeout(1000);
      const f = await frames();
      if (!firstDelta && (f.writer_delta ?? 0) > (before.writer_delta ?? 0)) firstDelta = Date.now() - tSend;
      if (JSON.stringify(f) !== last) { last = JSON.stringify(f); lastChange = Date.now(); }
      if ((f.writer_idle ?? 0) > (before.writer_idle ?? 0) && Date.now() - lastChange > 3000) break;
      if (Date.now() - lastChange > quietMs) break;
    }
    const after = await frames();
    result.turn = {
      ms: Date.now() - tSend, firstWriterDeltaMs: firstDelta,
      frames: Object.fromEntries(Object.entries(after).map(([k, v]) => [k, v - (before[k] ?? 0)]).filter(([, v]) => v > 0)),
      modelCalls: (await (await fetch(`${host.url}/api/browser-runtime/status`)).json()).modelCalls - callsBefore,
    };
    result.storyText = (await page.evaluate(() => document.querySelector('.prototype-story, [class*="story"]')?.innerText ?? '')).slice(0, 400);
    await shot('3-after-turn');
  }
  result.apiPaths = [...new Set(hostRequests)].slice(0, 20);
  result.apiResponses = { ...served };
  if (args.includes('--reload')) {
    // Saves must survive a reload (OPFS overlay): the brick offers "Continue latest save".
    await page.evaluate(() => window.__airpRuntime.flush());
    await page.reload();
    await page.waitForFunction(() => window.__airpBrowserMode, null, { timeout: 90000 });
    result.afterReload = { persist: await page.evaluate(() => window.__airpBrowserMode.persist) };
    await page.locator('.world-launcher__hit').first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(1500); // the shelf (with its saves) settles after the first bricks
    await page.evaluate(() => [...document.querySelectorAll('.world-launcher__hit')].find((h) => /Holmes|福尔摩斯|ホームズ/.test(h.getAttribute('aria-label') ?? ''))?.click());
    result.afterReload.continueOffered = await page.getByRole('button', { name: /Continue latest save/ }).first().waitFor({ timeout: 10000 }).then(() => true, () => false);
    await shot('4-after-reload');
  }
} catch (e) {
  if (!e.done) {
    result.error = String(e?.stack ?? e).slice(0, 1500);
    await shot('error').catch(() => {});
  }
} finally {
  result.status = await (await fetch(`${host.url}/api/browser-runtime/status`)).json().catch(() => null);
  fs.writeFileSync(path.join(OUT, 'ui-run.log'), `${log.join('\n')}\n\nRESULT ${JSON.stringify(result, null, 1)}\n`);
  console.log(JSON.stringify(result, null, 1));
  await browser.close();
  host.child.kill();
}
