#!/usr/bin/env node
/**
 * Asset-load baseline: open worlds in a real
 * headless Chromium and report, per step, how long until the first scene is
 * usable and how many bytes crossed the network.
 *
 *   node tools/measure-asset-load.mjs [--base http://127.0.0.1:5183/] [--json out.json]
 *                                     [--worlds fpal,whitechapel,wuwu] [--edition whitechapel:ja]
 *                                     [--throttle 20]   (Mbit/s down, 40 ms RTT: a remote seat)
 *
 * It DRIVES THE PAGE like a player (launcher brick → 「＋ Start a new game」),
 * so it loads worlds on the target server: every run makes new saves there and
 * switches that server's active world. Point it at a throwaway server (the doc
 * shows one with its own AIRP_WORLDS_ROOT and dead provider keys), never at
 * someone's live session. The server must let play start without an account
 * (`AIRP_PLAY_WITHOUT_ACCOUNT=1`).
 *
 * One persistent browser profile for the whole run, so the HTTP cache and a
 * Service Worker behave as they would for one returning player:
 *   1. cold      — empty profile, launcher, open world A
 *   2. warm      — reload, open A again (a second new game of the same world)
 *   3. switch    — reload, open B (never seen)
 *   4. back      — reload, open A again after B
 *   5. edition   — switch the UI language, open B's other edition (same art)
 *   6. switch    — reload, open C (never seen)
 *
 * Per step: `entered` = the launcher closed (world loaded, entry layer fetched);
 * `settled` = no media request pending for QUIET_MS and every <img> decoded.
 * Bytes are CDP `encodedDataLength` (what came over the wire): `media` counts
 * /api/asset, /api/audio, /api/media and /api/worlds/cover; `cache` counts media
 * answered by the disk cache or the Service Worker without touching the wire.
 */
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const BASE = arg('base', 'http://127.0.0.1:5183/').replace(/\/?$/, '/');
const [A, B, C] = arg('worlds', 'fpal,whitechapel,wuwu').split(',');
const [EDITION_WORLD, EDITION_LANG] = arg('edition', `${B}:ja`).split(':');
const OUT = arg('json', '');
const QUIET_MS = Number(arg('quiet', '2000'));
const TIMEOUT_MS = Number(arg('timeout', '120000'));
const THROTTLE_MBPS = Number(arg('throttle', '0'));

const LANG_BUTTON = { en: 'English', ja: '日本語', 'zh-CN': '中文' };
const START = { en: '＋ Start a new game', ja: '＋ 新しく始める', 'zh-CN': '＋ 开始新游戏' };
const MEDIA = /\/api\/(?:asset|audio|media|worlds\/cover)(?:[/?]|$)/;

const require = createRequire(path.join(REPO, 'apps/server/package.json'));
const { chromium } = require('playwright');

/** `--chromium <path>`, else Playwright's own build, else any headless shell already downloaded. */
function chromiumPath() {
  const declared = arg('chromium', '');
  if (declared) return declared;
  if (existsSync(chromium.executablePath())) return undefined;
  const cache = path.join(os.homedir(), 'Library/Caches/ms-playwright');
  const shells = existsSync(cache) ? readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell-')).sort().reverse() : [];
  for (const dir of shells) {
    for (const sub of ['chrome-headless-shell-mac-arm64', 'chrome-headless-shell-mac-x64', 'chrome-headless-shell-linux64']) {
      const exe = path.join(cache, dir, sub, 'chrome-headless-shell');
      if (existsSync(exe)) return exe;
    }
  }
  return undefined;
}

function tracker(cdp) {
  const reqs = new Map();
  const workerFetches = [];
  cdp.on('Network.requestWillBeSent', (e) => {
    reqs.set(e.requestId, { url: e.request.url, start: e.timestamp, done: false, bytes: 0, cached: false, sw: false, status: 0 });
  });
  cdp.on('Network.requestServedFromCache', (e) => { const r = reqs.get(e.requestId); if (r) r.cached = true; });
  cdp.on('Network.responseReceived', (e) => {
    const r = reqs.get(e.requestId); if (!r) return;
    r.status = e.response.status;
    if (e.response.fromDiskCache || e.response.fromPrefetchCache) r.cached = true;
    // A Service Worker answer never counts here: when the worker had to fetch
    // it, that fetch is its own request (counted by `workerFetch`).
    if (e.response.fromServiceWorker) { r.sw = true; r.swSource = e.response.serviceWorkerResponseSource; }
  });
  cdp.on('Network.loadingFinished', (e) => { const r = reqs.get(e.requestId); if (r) { r.done = true; r.bytes = e.encodedDataLength; } });
  cdp.on('Network.loadingFailed', (e) => { const r = reqs.get(e.requestId); if (r) { r.done = true; r.failed = true; } });
  return {
    /** A request the Service Worker made itself (Playwright reports it on the context). */
    async workerFetch(request) {
      const sizes = await request.sizes().catch(() => null);
      workerFetches.push({ url: request.url(), bytes: sizes ? sizes.responseBodySize + sizes.responseHeadersSize : 0 });
    },
    reset() { reqs.clear(); workerFetches.length = 0; },
    pendingMedia() { return [...reqs.values()].filter((r) => !r.done && MEDIA.test(r.url)).length; },
    summary() {
      const all = [...reqs.values()];
      const media = all.filter((r) => MEDIA.test(r.url));
      const wire = (list) => list.filter((r) => !r.cached && !r.sw).reduce((n, r) => n + r.bytes, 0);
      const workerBytes = workerFetches.reduce((n, r) => n + r.bytes, 0);
      return {
        requests: all.length,
        totalBytes: wire(all) + workerBytes,
        mediaRequests: media.length,
        mediaBytes: wire(media) + workerBytes,
        media304: media.filter((r) => r.status === 304).length,
        mediaFromCache: media.filter((r) => r.cached || (r.sw && r.swSource !== 'network')).length,
        workerFetches: workerFetches.length,
        media: media.map((r) => ({ url: r.url.replace(/^https?:\/\/[^/]+/, ''), status: r.status, bytes: r.bytes, cached: r.cached, sw: r.sw })),
      };
    },
  };
}

async function settle(page, net, t0) {
  let quietSince = Date.now();
  for (;;) {
    if (Date.now() - t0 > TIMEOUT_MS) throw new Error('timed out waiting for media to settle');
    const pending = net.pendingMedia();
    const imagesDone = await page.evaluate(() => [...document.images].every((img) => img.complete)).catch(() => false);
    if (pending > 0 || !imagesDone) quietSince = Date.now();
    else if (Date.now() - quietSince >= QUIET_MS) return quietSince - t0;
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function openLauncher(page, net, lang) {
  net.reset();
  const t0 = Date.now();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.getByRole('dialog', { name: /World launcher|世界|ワールド/ }).first().waitFor({ timeout: TIMEOUT_MS });
  const settled = await settle(page, net, t0);
  const summary = { settled, ...net.summary() };
  // After the launcher settled: the app adopts the active world's language
  // while it boots, which would undo an earlier click.
  if (lang) {
    const button = page.locator('.world-launcher__langs button', { hasText: LANG_BUTTON[lang] }).first();
    if ((await button.getAttribute('aria-pressed')) !== 'true') await button.dispatchEvent('click');
    await page.locator('.world-launcher__langs button[aria-pressed="true"]', { hasText: LANG_BUTTON[lang] }).waitFor({ timeout: TIMEOUT_MS });
  }
  return summary;
}

async function openWorld(page, net, id, lang) {
  const shelf = await page.evaluate(async () => (await fetch('/api/worlds')).json());
  const group = shelf.groups.find((g) => g.id === id);
  if (!group) throw new Error(`world ${id} is not on the shelf`);
  const title = group.name.replace(/\s*·\s*[^·]+$/, '');
  const brick = page.locator(`.world-launcher__hit[aria-label="${title.replace(/"/g, '\\"')}"]`).first();
  await brick.waitFor({ state: 'attached', timeout: TIMEOUT_MS });
  // A brick toggles; the current world's brick may already be open.
  if ((await brick.getAttribute('aria-expanded')) !== 'true') await brick.dispatchEvent('click');
  const start = page.locator('.world-launcher__actions button', { hasText: START[lang] ?? START.en }).first();
  await start.waitFor({ state: 'attached', timeout: TIMEOUT_MS });
  net.reset();
  const t0 = Date.now();
  await start.dispatchEvent('click');
  await page.locator('.world-launcher').first().waitFor({ state: 'detached', timeout: TIMEOUT_MS });
  const entered = Date.now() - t0;
  const settled = await settle(page, net, t0);
  return { entered, settled, ...net.summary() };
}

const langOf = (id) => (id.endsWith('-jp') ? 'ja' : id.endsWith('-zh') ? 'zh-CN' : 'en');

async function main() {
  const profile = mkdtempSync(path.join(os.tmpdir(), 'airp-measure-'));
  const context = await chromium.launchPersistentContext(profile, {
    headless: true, executablePath: chromiumPath(), locale: 'en-US', viewport: { width: 1440, height: 900 },
  });
  const page = context.pages()[0] ?? await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  if (THROTTLE_MBPS > 0) {
    const bytesPerSecond = (THROTTLE_MBPS * 1e6) / 8;
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false, latency: 40, downloadThroughput: bytesPerSecond, uploadThroughput: bytesPerSecond / 4,
    });
  }
  const net = tracker(cdp);
  context.on('requestfinished', (request) => { if (request.serviceWorker()) void net.workerFetch(request); });
  const edition = `${EDITION_WORLD}-${EDITION_LANG === 'ja' ? 'jp' : 'zh'}`;
  const steps = [
    ['launcher (cold)', null, 'en'],
    [`cold: ${A}`, A],
    [`warm: ${A} again`, A],
    [`switch: ${B} (first time)`, B],
    [`back: ${A}`, A],
    [`edition: ${edition} after ${EDITION_WORLD}`, edition],
    [`switch: ${C} (first time)`, C],
  ];
  const rows = [];
  try {
    for (const [label, id, launcherLang] of steps) {
      const lang = id ? langOf(id) : launcherLang;
      const launcher = await openLauncher(page, net, lang);
      if (!id) { rows.push({ step: label, entered: null, ...launcher }); continue; }
      rows.push({ step: label, ...(await openWorld(page, net, id, lang)), launcherBytes: launcher.totalBytes, launcherSettled: launcher.settled, launcherMedia: launcher.media });
      console.error(`done: ${label}`);
    }
  } finally {
    await context.close();
    rmSync(profile, { recursive: true, force: true });
  }
  const mb = (n) => (n / 1e6).toFixed(2);
  console.log(`base ${BASE}${THROTTLE_MBPS ? ` · throttled ${THROTTLE_MBPS} Mbit/s, 40 ms` : ''}`);
  console.log('| step | launcher MB · ms | entered (ms) | settled (ms) | media reqs | media from cache | media 304 | media MB (wire) | all MB (wire) |');
  console.log('|---|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const r of rows) {
    const launcher = r.entered === null ? '(this row)' : `${mb(r.launcherBytes)} · ${r.launcherSettled}`;
    console.log(`| ${r.step} | ${launcher} | ${r.entered ?? '—'} | ${r.settled} | ${r.mediaRequests} | ${r.mediaFromCache} | ${r.media304} | ${mb(r.mediaBytes)} | ${mb(r.totalBytes)} |`);
  }
  if (OUT) writeFileSync(OUT, JSON.stringify({ base: BASE, throttleMbps: THROTTLE_MBPS, at: new Date().toISOString(), rows }, null, 2));
}

main().catch((error) => { console.error(error); process.exit(1); });
