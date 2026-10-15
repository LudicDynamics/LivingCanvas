// Browser mode: the account sign-in path from inside the tab.
//   node apps/browser-runtime/e2e/account.mjs [--port 3198] [--send-mail]
// Boots browser mode headless, then through the Service Worker → in-Worker server:
//   1. Google: /api/remote/login returns an auth.worldlines.gg authorize URL — which
//      means /auth/config was read from the remote through /api/browser-runtime/net;
//      the identity service accepts that URL (redirects on to Google).
//   2. The callback, opened in a NEW tab as the provider would, reaches the tab
//      that started the sign-in (the SW fans it out): a bogus code is rejected BY
//      THE IDENTITY SERVICE (exchange went through the proxy), a replay is "expired".
//   3. --send-mail: email start to browser-mode-test@example.com (one real OTP request).
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { startUiHost } from './ui-host.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const result = {};
const host = await startUiHost({ port: Number(opt('--port', 3198)), quiet: true });
const CACHE = path.join(process.env.HOME, 'Library/Caches/ms-playwright');
const shell = fs.readdirSync(CACHE).filter((d) => d.startsWith('chromium_headless_shell-')).sort().reverse()
  .map((d) => path.join(CACHE, d, 'chrome-headless-shell-mac-arm64/chrome-headless-shell')).find((p) => fs.existsSync(p));
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME ?? shell });
const context = await browser.newContext();
const page = await context.newPage();
const api = (url, body) => page.evaluate(async ([u, b]) => {
  const r = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json', 'X-AIRP-Settings': '1' }, body: JSON.stringify(b) });
  return { status: r.status, body: await r.json().catch(() => null) };
}, [url, body]);
let failed = false;
const check = (name, ok, detail) => { result[name] = ok ? 'ok' : { failed: detail }; if (!ok) failed = true; };
try {
  await page.goto(`${host.url}/?mode=browser`);
  await page.waitForFunction(() => window.__airpBrowserMode || /启动失败/.test(document.body.innerText), null, { timeout: 90000 });
  const origin = new URL(host.url).origin;

  const g = await api('/api/remote/login', { method: 'google', origin });
  const authorize = g.body?.authorizeUrl ? new URL(g.body.authorizeUrl) : null;
  check('googleStart', authorize?.origin === 'https://auth.worldlines.gg', g);
  if (authorize) {
    const redirect = new URL([...authorize.searchParams.values()].find((v) => v.includes('/api/remote/login/callback/')) ?? 'http://x/');
    check('redirectIsLocal', redirect.origin === origin, redirect.href);
    const up = await fetch(authorize, { redirect: 'manual' });
    check('identityAcceptsAuthorize', up.status >= 300 && up.status < 400, { status: up.status, location: up.headers.get('location')?.slice(0, 80) });
    result.authorizeRedirectsTo = new URL(up.headers.get('location') ?? 'http://none/').host;

    const tab = await context.newPage();
    await tab.goto(`${redirect.href}?code=browser-mode-bogus-code`);
    const first = await tab.locator('body').innerText();
    check('callbackReachesStartingTab', !/sign-in link has expired/i.test(first) && /code is invalid/i.test(first), first.slice(0, 200));
    result.callbackText = first.slice(0, 160);
    await tab.goto(`${redirect.href}?code=browser-mode-bogus-code`);
    const second = await tab.locator('body').innerText();
    check('callbackReplayExpired', /sign-in link has expired/i.test(second), second.slice(0, 200));
  }
  if (args.includes('--send-mail')) {
    const m = await api('/api/remote/login', { method: 'email', email: 'browser-mode-test@example.com', origin });
    check('emailStart', m.status === 200 && m.body?.sent === true, m);
  }
  const stats = await (await fetch(`${host.url}/api/browser-runtime/status`)).json();
  check('wentThroughProxy', stats.netCalls >= 2, stats);
} catch (e) {
  failed = true;
  result.error = String(e?.stack ?? e).slice(0, 600);
} finally {
  await browser.close();
  host.child.kill();
  console.log(JSON.stringify(result, null, 1));
  process.exit(failed ? 1 : 0);
}
