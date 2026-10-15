#!/usr/bin/env node
/**
 * Writer panel e2e (apps/web/test/writer-panel.test.mjs is the unit half).
 *
 *   node tools/e2e-writer-panel.mjs [--base http://127.0.0.1:3041/] [--out dir] [--chromium path]
 *
 * Drives a real headless Chromium on four viewports (1440×900, 1280×720, iPhone
 * landscape, iPhone portrait), canvas and map view:
 *   - opens the writer sheet, types a draft, clicks the canvas OUTSIDE the
 *     sheet → the sheet must stay open and keep the draft;
 *   - bounding boxes: the sheet covers no hard chrome (top controls, options
 *     rail, bag, orb, writer button, companion stage), the old floating
 *     authoring row is gone in companion;
 *   - drags the sheet by its head → it moves, ↺ appears, ↺ puts it back;
 *   - Escape closes it; reopening shows the same draft.
 * With --out it also writes one screenshot per step.
 *
 * It opens "Continue this story" on the target server, so point it at a
 * throwaway instance (own AIRP_WORLDS_ROOT, AIRP_PLAY_WITHOUT_ACCOUNT=1, dead
 * model keys — see the design notes), never at someone's live session.
 * Exit code 1 on any failed check.
 */
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const BASE = arg('base', 'http://127.0.0.1:3041/').replace(/\/?$/, '/');
const OUT = arg('out', '');
const require = createRequire(path.join(REPO, 'apps/server/package.json'));
const { chromium, devices } = require('playwright');

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

const VIEWS = [
  ['desktop-1440x900', { viewport: { width: 1440, height: 900 } }],
  ['desktop-1280x720', { viewport: { width: 1280, height: 720 } }],
  ['iphone-landscape', devices['iPhone 13 landscape']],
  ['iphone-portrait', devices['iPhone 13']],
];
const HARD = ['.prototype-edge-controls', '.view-mode-switch', '.prototype-immersion-toggle', '.world-hover', '.choice-rail',
  '.prototype-belongings', '.prototype-player-orb', '.writer-fab__button', '.character-dock__stage', '.prototype-tools'];

let failures = 0;
const check = (ok, label) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) failures += 1;
};
const shot = async (page, name) => { if (OUT) await page.screenshot({ path: path.join(OUT, `${name}.png`) }); };

async function overlaps(page) {
  return page.evaluate((hard) => {
    const sheet = document.querySelector('.writer-fab__sheet');
    if (!sheet) return ['no sheet'];
    const s = sheet.getBoundingClientRect();
    const out = [];
    if (s.left < 0 || s.top < 0 || s.right > innerWidth || s.bottom > innerHeight) out.push('sheet off screen');
    for (const sel of hard) {
      for (const el of document.querySelectorAll(sel)) {
        if (sheet.contains(el)) continue;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        const r = el.getBoundingClientRect();
        const w = Math.min(s.right, r.right) - Math.max(s.left, r.left);
        const h = Math.min(s.bottom, r.bottom) - Math.max(s.top, r.top);
        if (w > 1 && h > 1) out.push(`${sel} ${Math.round(w)}×${Math.round(h)}`);
      }
    }
    if (document.querySelector('.prototype-authoring')) out.push('floating authoring row present');
    return out;
  }, HARD);
}

const browser = await chromium.launch({ executablePath: chromiumPath() });
try {
  if (OUT) mkdirSync(OUT, { recursive: true });
  for (const [name, opts] of VIEWS) {
    const ctx = await browser.newContext(opts);
    // First-run tutorial, guide and the "turn sideways" card are not under test here.
    await ctx.addInitScript(() => {
      try {
        localStorage.setItem('airp:tutorial:hidden', '1');
        localStorage.setItem('airp.guide', JSON.stringify({ done: [], off: true }));
        sessionStorage.setItem('airp.rotate-hint.dismissed', '1');
      } catch { /* storage blocked */ }
    });
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.locator('.world-launcher button', { hasText: 'Continue this story' }).first().click({ timeout: 60000 });
    await page.locator('.world-launcher').first().waitFor({ state: 'detached', timeout: 60000 });
    await page.waitForTimeout(3000);
    for (const view of ['canvas', 'map']) {
      console.log(`${name} / ${view}`);
      const sw = page.locator('.view-mode-switch button', { hasText: view === 'map' ? 'Map' : 'Canvas' }).first();
      if (await sw.count()) { await sw.click(); await page.waitForTimeout(1000); }
      const sheet = page.locator('[data-testid="writer-sheet"]');
      if (!(await sheet.count())) await page.locator('.writer-fab__button').click();
      await sheet.waitFor({ timeout: 5000 });
      await page.waitForTimeout(400);
      const draft = `look under the desk (${name} ${view})`;
      const input = sheet.locator('textarea, input[type="text"]').first();
      await input.fill(draft);
      await shot(page, `${name}-${view}-open`);

      const o = await overlaps(page);
      check(o.length === 0, `no overlap${o.length ? `: ${o.join(', ')}` : ''}`);

      // A press on the canvas outside the sheet: top-centre of the free area.
      const box = await sheet.boundingBox();
      const vp = page.viewportSize();
      const x = Math.round(vp.width / 2);
      const y = box.y > vp.height / 2 ? Math.round(Math.max(180, box.y / 2)) : Math.round((box.y + box.height + vp.height) / 2);
      await page.mouse.click(x, y);
      await page.waitForTimeout(400);
      check(await sheet.count() === 1, 'outside click keeps the sheet open');
      check((await input.inputValue().catch(() => '')) === draft, 'outside click keeps the draft');
      // The click is a real canvas click: on a card it opens the card's reader
      // (canvas clicks keep working while the writer is open). Fold the reader
      // with its own ↙ and the sheet is still there.
      if (await page.locator('.paper-reading').count()) {
        console.log('  info the canvas click opened a card reader');
        await page.locator('.paper-reading__fold, .paper-reading [aria-label="Close"]').first().click();
        await page.waitForTimeout(400);
        check(await sheet.count() === 1, 'the sheet is still open after reading the card');
      }
      // Drag by the head; ↺ resets.
      const home = await sheet.boundingBox();
      const head = sheet.locator('.writer-fab__sheet-head');
      const hb = await head.boundingBox();
      const sx = hb.x + 12;
      const sy = hb.y + hb.height / 2;
      await page.mouse.move(sx, sy);
      await page.mouse.down();
      await page.mouse.move(sx - 60, sy - 40, { steps: 6 });
      await page.mouse.up();
      await page.waitForTimeout(200);
      const moved = await sheet.boundingBox();
      check(Math.abs(moved.x - home.x) > 20 || Math.abs(moved.y - home.y) > 20, 'head drag moves the sheet');
      const reset = page.locator('[data-testid="writer-sheet-reset"]');
      check(await reset.count() === 1, 'reset appears after a drag');
      if (await reset.count()) {
        await reset.click();
        await page.waitForTimeout(200);
        const back = await sheet.boundingBox();
        check(Math.abs(back.x - home.x) < 3 && Math.abs(back.y - home.y) < 3, `reset puts it back (${Math.round(back.x)},${Math.round(back.y)} vs ${Math.round(home.x)},${Math.round(home.y)})`);
      }

      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      check(await sheet.count() === 0, 'Escape closes the sheet');
      await page.locator('.writer-fab__button').click();
      await sheet.waitFor({ timeout: 5000 });
      check((await sheet.locator('textarea, input[type="text"]').first().inputValue()) === draft, 'the draft survives a close');
      await sheet.locator('[data-testid="writer-sheet-close"]').click();
      await page.waitForTimeout(300);
      check(await sheet.count() === 0, '× closes the sheet');
      await shot(page, `${name}-${view}-closed`);
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall writer-panel checks passed');
process.exit(failures ? 1 : 0);
