// Headless end to end: boot the real AIRP server + pi-rp CLI in a Chromium
// Worker, then play one writer turn through the model proxy.
//   node e2e/run.mjs [--boot-only] [--world whitechapel] [--quiet-ms 20000] [--browser chromium|webkit]
// --browser webkit: Playwright's WebKit (Safari's engine; no CDP, so no heap numbers).
// --no-regexp-v: the Worker's RegExp refuses the `v` flag (Safari < 17 / Chrome < 112), e2e/server.mjs NO_REGEXP_V.
import { chromium, webkit } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startHost } from './server.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const world = opt('--world', 'whitechapel');
const quietMs = Number(opt('--quiet-ms', 20000));
const log = [];
const out = (s) => { log.push(s); if (!args.includes('--silent')) console.log(s); };

const host = await startHost({ world, maxModelCalls: Number(opt('--max-calls', 10)), noRegExpV: args.includes('--no-regexp-v') });
// Reuse a cached headless shell (newest first) instead of downloading one.
const CACHE = path.join(process.env.HOME, 'Library/Caches/ms-playwright');
const shell = fs.existsSync(CACHE) && fs.readdirSync(CACHE).filter((d) => d.startsWith('chromium_headless_shell-')).sort().reverse()
  .map((d) => path.join(CACHE, d, 'chrome-headless-shell-mac-arm64/chrome-headless-shell')).find((p) => fs.existsSync(p));
const KIND = opt('--browser', 'chromium');
const browser = KIND === 'webkit' ? await webkit.launch({ headless: true }) : await chromium.launch({ headless: true, executablePath: process.env.CHROME ?? shell });
const page = await browser.newPage();
const onConsole = (src) => (m) => out(`[${src}:${m.type()}] ${m.text().slice(0, 400)}`);
page.on('console', onConsole('page'));
page.on('pageerror', (e) => out(`[pageerror] ${String(e.stack ?? e).slice(0, 600)}`));
const result = { world, browser: KIND };
// Worker JS heap via CDP (measureUserAgentSpecificMemory is absent in the headless shell)
// plus renderer process RSS from ps.
import { execFileSync } from 'node:child_process';
async function memory() {
  if (KIND === 'webkit') return null;
  const cdp = await browser.newBrowserCDPSession();
  const { targetInfos } = await cdp.send('Target.getTargets');
  const out = {};
  for (const t of targetInfos.filter((t) => t.type === 'worker' || t.type === 'page')) {
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: t.targetId, flatten: false });
    const id = Math.floor(Math.random() * 1e6);
    const got = new Promise((res) => cdp.on('Target.receivedMessageFromTarget', (m) => { const j = JSON.parse(m.message); if (j.id === id) res(j.result); }));
    await cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method: 'Runtime.getHeapUsage' }) });
    const r = await Promise.race([got, new Promise((res) => setTimeout(() => res(null), 3000))]);
    out[t.type] = r && { usedMB: +(r.usedSize / 2 ** 20).toFixed(1), totalMB: +(r.totalSize / 2 ** 20).toFixed(1) };
  }
  const ps = execFileSync('ps', ['-axo', 'rss=,command=']).toString().split('\n').filter((l) => l.includes('chrome-headless-shell') && l.includes('--type=renderer'));
  out.rendererRssMB = ps.map((l) => +(parseInt(l) / 1024).toFixed(0));
  await cdp.detach();
  return out;
}
try {
  await page.goto(`http://127.0.0.1:${host.port}/`);
  await page.waitForFunction(() => window.__loaded);
  const env = {
    AIRP_REPO_ROOT: '/repo', AIRP_WORLD: `templates/${world}`, PI_PACKAGE_DIR: '/repo/vendor/pi-rp/packages/coding-agent',
    AIRP_WRITER_THINKING: 'low', PI_OFFLINE: '1', ...(args.includes('--trace') ? { AIRP_BROWSER_TRACE: '1' } : {}),
  };
  const persist = args.includes('--persist') || args.includes('--persist-test') ? { ns: 'e2e' } : undefined;
  result.boot = await page.evaluate(([e, p]) => window.airp.boot(e, { persist: p }), [env, persist]);
  result.vfsJsonBytes = host.vfsBytes();
  out(`BOOT ${JSON.stringify(result.boot)}`);
  result.health = await page.evaluate(() => window.airp.request('GET', '/api/manifest'));
  out(`GET /api/manifest -> ${result.health.status} ${result.health.text.slice(0, 160)}`);
  // Let the writer process come up (spawned asynchronously at boot).
  await page.waitForTimeout(3000);
  result.statsAfterBoot = await page.evaluate(() => window.airp.stats());
  result.memoryAfterBoot = await memory();
  if (args.includes('--persist-test')) {
    // Write a file and let the server write its own state, flush, reload, check both survived.
    const stamp = `persist-${Date.now()}`;
    await page.evaluate((s) => window.airp.write('/repo/worlds/persist-probe.txt', s), stamp);
    await page.evaluate(() => window.airp.request('GET', '/api/manifest'));
    result.flush = (await page.evaluate(() => window.airp.flush())).saved;
    await page.reload();
    await page.waitForFunction(() => window.__loaded);
    result.bootAfterReload = await page.evaluate(([e, p]) => window.airp.boot(e, { persist: p }), [env, persist]);
    const got = (await page.evaluate(() => window.airp.read('/repo/worlds/persist-probe.txt'))).data;
    result.persistOk = got === stamp;
    out(`PERSIST ${result.persistOk ? 'OK' : 'FAIL'} read-back=${got} flush=${JSON.stringify(result.flush)} restored=${JSON.stringify(result.bootAfterReload.persist)}`);
  } else if (!args.includes('--boot-only')) {
    const id = await page.evaluate(() => window.airp.openWs('/ws?v=1'));
    await page.waitForFunction(() => (window.__frames ?? []).some((f) => f.type === 'ws-message' && f.data.includes('replay_done')), null, { timeout: 30000 });
    // Every WS command names the open save (packages/shared ws-command.ts).
    const savePath = await page.evaluate(async () => (await (await fetch('/api/world-settings')).json()).world);
    const sentAt = await page.evaluate(([i, savePath]) => window.airp.send(i, { type: 'writer_prompt', savePath, message: 'I step out of the cab and look around the street.', layer: 'map' }), [id, savePath]);
    let last = sentAt, n = 0;
    const deadline = Date.now() + 240000;
    while (Date.now() < deadline) {
      await page.waitForTimeout(2000);
      const frames = await page.evaluate(() => window.__frames);
      if (frames.length !== n) { n = frames.length; last = frames[frames.length - 1].t; }
      const now = await page.evaluate(() => Math.round(performance.now()));
      if (host.stats.modelCalls > 0 && now - last > quietMs) break;
    }
    const frames = await page.evaluate(() => window.__frames);
    const types = {};
    for (const f of frames) { const t = f.type === 'ws-message' ? JSON.parse(f.data).type : f.type; types[t] = (types[t] ?? 0) + 1; }
    const deltas = frames.filter((f) => f.type === 'ws-message' && f.t > sentAt).map((f) => JSON.parse(f.data));
    const firstDelta = frames.find((f) => f.t > sentAt && f.data?.includes('writer_delta'));
    result.turn = {
      frameTypes: types, lastFrameMs: last - sentAt, firstWriterDeltaMs: firstDelta ? firstDelta.t - sentAt : null,
      writerText: deltas.filter((d) => d.type === 'writer_delta').map((d) => d.delta ?? d.text ?? '').join('').slice(0, 600),
      tools: deltas.filter((d) => d.type === 'tool_start').map((d) => d.toolName ?? d.name),
      errors: deltas.filter((d) => d.type === 'error').map((d) => d.message),
      toolErrors: deltas.filter((d) => d.type === 'tool_end' && d.isError).map((d) => d.toolName),
    };
    result.memoryAfterTurn = await memory();
    // Tool failures with their text, from the writer's session log in the VFS.
    const { paths } = await page.evaluate(() => window.airp.tree(`/repo/worlds`));
    const failures = [];
    for (const p of paths.filter((p) => p.endsWith('.jsonl') && p.includes('session'))) {
      const { data } = await page.evaluate((x) => window.airp.read(x), p);
      for (const line of (data ?? '').split('\n')) {
        try { const e = JSON.parse(line); const m = e.message; if (m?.role === 'toolResult' && m.isError) failures.push(`${m.toolName}: ${JSON.stringify(m.content).slice(0, 240)}`); } catch { /* partial line */ }
      }
    }
    result.turn.toolFailures = failures;
  }
  result.stats = await page.evaluate(() => window.airp.stats());
} catch (e) {
  result.error = String(e?.stack ?? e).slice(0, 1500);
} finally {
  result.proxy = host.stats;
  out(`RESULT ${JSON.stringify(result, null, 1)}`);
  fs.writeFileSync(path.join(HERE, 'last-run.log'), log.join('\n'));
  await browser.close();
  host.server.close();
}
