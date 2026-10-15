// Steps shared by e2e/prod-sim.mjs and the release gate (deploy/canvas/release-smoke.mjs).
import fs from 'node:fs';
import path from 'node:path';

export const REMOTE_JSON = '/home/web/.config/airp/remote.json';

/** The local Playwright headless shell (CHROME overrides). */
export function chromiumPath() {
  if (process.env.CHROME) return process.env.CHROME;
  const cache = path.join(process.env.HOME, 'Library/Caches/ms-playwright');
  if (!fs.existsSync(cache)) return undefined;
  return fs.readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell-')).sort().reverse()
    .flatMap((d) => ['chrome-headless-shell-mac-arm64', 'chrome-headless-shell-mac-x64', 'chrome-headless-shell-linux64'].map((p) => path.join(cache, d, p, 'chrome-headless-shell')))
    .find((p) => fs.existsSync(p));
}

/**
 * An access token lasts 15 minutes: an expired session must refresh through the identity client
 * (canvas-20261007-0455..: the client was missing from server.js, so after 15 minutes every world download and
 * model call answered 401). Marks the in-tab session expired and makes one authenticated call.
 */
export function expireSessionAndCall(page) {
  return page.evaluate(async (file) => {
    const stored = JSON.parse((await window.__airpRuntime.call({ type: 'read', path: file })).data);
    stored.session.expiresAt = 0;
    await window.__airpRuntime.call({ type: 'write', path: file, data: JSON.stringify(stored) });
    const r = await fetch('/api/remote/test', { method: 'POST', headers: { 'content-type': 'application/json', 'X-AIRP-Settings': '1' }, body: '{}' });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, REMOTE_JSON);
}
