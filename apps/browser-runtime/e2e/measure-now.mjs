// One-off check against the running host (default :3197): does the in-tab
// server now name the world's music, are the agents in the tab, and how much
// memory do the tab and its Worker use before and after one writer turn.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const HOST = process.env.HOST ?? 'http://127.0.0.1:3197';
const CACHE = path.join(os.homedir(), 'Library/Caches/ms-playwright');
const shell = fs.readdirSync(CACHE).filter((d) => d.startsWith('chromium_headless_shell-')).sort().reverse()
  .map((d) => path.join(CACHE, d, 'chrome-headless-shell-mac-arm64/chrome-headless-shell')).find((p) => fs.existsSync(p));
const browser = await chromium.launch({ headless: true, executablePath: shell });
const page = await (await browser.newContext()).newPage();
const audio = [];
page.on('response', (r) => { const u = new URL(r.url()); if (u.pathname === '/api/audio' || (u.pathname === '/api/asset' && u.searchParams.get('kind') === 'audio')) audio.push(`${r.status()} ${u.searchParams.get('path')}`); });

const piOnHost = () => execFileSync('ps', ['-axo', 'command=']).toString().split('\n').filter((l) => l.includes('coding-agent') && l.includes('browser-runtime')).length;
async function memory() {
  const cdp = await page.context().newCDPSession(page);
  const { targetInfos } = await cdp.send('Target.getTargets');
  const out = { pageHeapMB: null, workerHeapMB: [] };
  const h = await cdp.send('Runtime.getHeapUsage');
  out.pageHeapMB = +(h.usedSize / 1048576).toFixed(1);
  for (const w of page.workers()) {
    const used = await w.evaluate(() => (performance.memory ? performance.memory.usedJSHeapSize : null)).catch(() => null);
    if (used) out.workerHeapMB.push(+(used / 1048576).toFixed(1));
  }
  const rss = execFileSync('ps', ['-axo', 'rss=,command=']).toString().split('\n')
    .filter((l) => l.includes('chrome-headless-shell') && l.includes('--type=renderer')).map((l) => Math.round(Number(l.trim().split(/\s+/)[0]) / 1024));
  out.rendererRssMB = rss;
  out.targets = targetInfos.map((t) => t.type);
  return out;
}

const result = {};
await page.goto(`${HOST}/?mode=browser`);
await page.waitForFunction(() => !!window.__airpRuntime, null, { timeout: 60000 });
await page.locator('.world-launcher__hit').first().waitFor({ timeout: 30000 });
result.afterBoot = await memory();
result.manifestAudio = await page.evaluate(async () => (await (await fetch('/api/manifest')).json()).audio);
result.piProcessesOnHost = piOnHost();

// One writer turn through the in-tab server's own WebSocket stand-in.
const turn = await page.evaluate(async () => new Promise((resolve) => {
  const ws = new WebSocket(`${location.origin.replace("http", "ws")}/ws?v=1`);
  const t0 = performance.now(); let idle = false; const types = {};
  ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } types[m.type] = (types[m.type] ?? 0) + 1; if (m.type === 'writer_idle' && !idle) { idle = true; resolve({ ms: Math.round(performance.now() - t0), types }); } };
  // Every WS command names the open save (packages/shared ws-command.ts).
  ws.onopen = async () => ws.send(JSON.stringify({ type: 'writer_prompt', savePath: (await (await fetch('/api/world-settings')).json()).world, message: 'I look around the room and read the note on the desk.' }));
  setTimeout(() => resolve({ ms: Math.round(performance.now() - t0), types, timeout: true }), 150000);
}));
result.turn = turn;
result.piProcessesOnHostDuringOrAfterTurn = piOnHost();
result.afterTurn = await memory();
result.audioRequests = audio;
result.hostStatus = await (await fetch(`${HOST}/api/browser-runtime/status`)).json();
console.log(JSON.stringify(result, null, 1));
await browser.close();
