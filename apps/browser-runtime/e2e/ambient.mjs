// Ambient life in the REAL UI, browser mode:
//   node e2e/ambient.mjs [--port 3187] [--network-mode] [--wait-ms 25000]
// Opens The Last Train in the in-tab server (no model call: only the opening
// scene is loaded, the bundled keys are not needed), returning player (tutorial
// hidden, as on canvas.worldlines.gg after the first world), desktop window.
// Asserts: the ambient layer is mounted, its clock is NOT paused (`data-pause`
// empty) while the RotateHint sits in the DOM unrendered, and at least one fake
// pointer actually moves within --wait-ms. Regression for release
// canvas-20261010-1501 「光标并没有动」: RotateHint (display:none on desktop)
// matched the dialog selector, so every desktop paused at `dialog` forever.
// `--network-mode` runs the same walk against the ordinary Node server.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startUiHost } from './ui-host.mjs';
import { chromiumPath } from './session-steps.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out');
fs.mkdirSync(OUT, { recursive: true });
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const network = args.includes('--network-mode');
const waitMs = Number(opt('--wait-ms', 25000));

// No model keys: nothing here may call a model.
process.env.OPENAI_API_KEY = '';
process.env.DEEPSEEK_API_KEY = '';
process.env.AIRP_KEYS_FILE = '/dev/null';
const host = await startUiHost({ port: Number(opt('--port', 3187)), quiet: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME ?? chromiumPath() });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.addInitScript(() => {
  try {
    localStorage.setItem('airp-ui-locale', 'en');
    localStorage.setItem('airp:tutorial:hidden', '1');
  } catch { /* storage blocked */ }
});
const errors = [];
const ambientFetches = [];
page.on('response', (r) => { if (new URL(r.url()).pathname === '/api/ambient') ambientFetches.push({ status: r.status() }); });
page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
const result = { mode: network ? 'network' : 'browser' };
let ok = false;
try {
  await page.goto(`${host.url}/${network ? '' : '?mode=browser'}`);
  // First visit may still show the language picker / landing.
  await page.getByText('English', { exact: true }).first().click({ timeout: 60000 }).catch(() => {});
  await page.getByText('See all worlds').first().click({ timeout: 5000 }).catch(() => {});
  await page.locator('.world-launcher__hit').first().waitFor({ timeout: 90000 });
  await page.waitForTimeout(1000);
  const picked = await page.evaluate(() => {
    const hit = [...document.querySelectorAll('.world-launcher__hit')].find((h) => /Last Train/.test(h.getAttribute('aria-label') ?? ''));
    hit?.click();
    return Boolean(hit);
  });
  if (!picked) throw new Error('The Last Train is not on the launcher');
  const start = page.getByRole('button', { name: /^(Start game|Start a new game)/ }).first();
  await start.waitFor({ timeout: 15000 });
  await start.evaluate((b) => b.click());
  await page.locator('.world-launcher').waitFor({ state: 'detached', timeout: 60000 }).catch(() => {});
  await page.locator('.ambient-layer .ambient-cursor').first().waitFor({ state: 'attached', timeout: 60000 });
  // Close any first-entry popover the way a player would.
  await page.getByText("Don't show this again").first().click({ timeout: 1000 }).catch(() => {});
  await page.getByText("Don't show again").first().click({ timeout: 1000 }).catch(() => {});

  // The page itself must read /api/ambient once the world is open (the canvas mounts behind the lobby, where the
  // read is a 409; it reads again when the cast arrives). The in-tab server answers it; a storage world published
  // before ambient/ existed answers {} — pointers still run, only barks are missing.
  for (let i = 0; i < 20 && !ambientFetches.some((f) => f.status === 200); i++) await page.waitForTimeout(500);
  result.ambientFetches = ambientFetches.map((f) => f.status);
  if (!ambientFetches.some((f) => f.status === 200)) throw new Error(`the page never read /api/ambient with the world open: ${JSON.stringify(result.ambientFetches)}`);
  // A read made before any world was open (409) was the canvas host's ONLY read on canvas-20261010-1501.
  if (ambientFetches.some((f) => f.status === 409)) throw new Error(`/api/ambient was read with no world open: ${JSON.stringify(result.ambientFetches)}`);
  result.ambientApi = await page.evaluate(async () => {
    const r = await fetch('/api/ambient');
    const body = await r.json().catch(() => null);
    return { status: r.status, actors: Object.keys(body?.entries ?? {}) };
  });
  const sample = () => page.evaluate(() => {
    const layer = document.querySelector('.ambient-layer');
    const hint = document.querySelector('.rotate-hint');
    return {
      surface: layer?.getAttribute('data-surface') ?? null,
      pause: layer?.getAttribute('data-pause') ?? null,
      cursors: Object.fromEntries([...document.querySelectorAll('.ambient-layer .ambient-cursor')].map((c) => [c.getAttribute('data-ambient-actor'), c.style.transform])),
      rotateHint: hint ? { inDom: true, rendered: hint.getClientRects().length > 0 } : { inDom: false },
    };
  });
  const first = await sample();
  result.first = first;
  const t0 = Date.now();
  let moved = null;
  let last = first;
  while (Date.now() - t0 < waitMs) {
    await page.waitForTimeout(1000);
    last = await sample();
    const id = Object.keys(last.cursors).find((k) => first.cursors[k] !== undefined && last.cursors[k] !== first.cursors[k]);
    if (id) { moved = { actor: id, afterMs: Date.now() - t0, from: first.cursors[id], to: last.cursors[id] }; break; }
  }
  result.last = last;
  result.moved = moved;
  await page.screenshot({ path: path.join(OUT, `ambient-${result.mode}.png`) });
  if (last.pause) throw new Error(`ambient clock paused: data-pause="${last.pause}"`);
  if (!moved) throw new Error(`no ambient pointer moved within ${waitMs} ms`);
  ok = true;
} catch (e) {
  result.error = String(e?.message ?? e).slice(0, 500);
} finally {
  result.pageErrors = errors.slice(0, 5);
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
  host.child.kill();
}
process.exit(ok ? 0 : 1);
