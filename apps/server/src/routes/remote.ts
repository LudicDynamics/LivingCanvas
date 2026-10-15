import { Router, type Response } from 'express';
import type { LocalWorldStore } from '@airp/shared';
import { localRequest } from './connection-settings.js';
import { BundleError } from '../sync/bundle.js';
import {
  LOGIN_STATE,
  RemoteError,
  finishLogin,
  logoutRemote,
  publishOnRemote,
  unpublishOnRemote,
  forceUnpublishOnRemote,
  pullFromRemote,
  pushToRemote,
  remoteSettingsView,
  remoteCover,
  remoteWhoami,
  remoteWorlds,
  saveRemoteUrl,
  startLogin,
  startDeviceLogin,
  cancelDeviceLogin,
  verifyEmailCode,
  listApiKeys,
  createApiKey,
  revokeApiKey,
} from '../sync/remote-client.js';
import { guestTrial } from '../sync/guest-session.js';
import { keepBoth, keepInCloud, syncWorlds, worldSyncStatus } from '../sync/world-sync.js';

/**
 * The local proxy to a hosted AIRP: the page
 * never holds the account session; it asks this server to sign in (「用账号登录」)
 * and to push or pull, and this server calls the remote with the session.
 *
 * Localhost only, like the connection settings next to it: these routes act
 * with the owner's remote identity, so a hosted seat (or anyone reaching a dev
 * server over the LAN) must not be able to drive them.
 */
export function createRemoteRouter(repoRoot: string, deps: { getActiveStore?: () => LocalWorldStore | null; fetch?: typeof fetch } = {}): Router {
  const router = Router();
  const remoteDeps = { activeStore: deps.getActiveStore, fetch: deps.fetch };
  router.use('/remote', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!localRequest(req)) return res.status(403).json({ ok: false, code: 'local_only', error: 'Remote sync is available on localhost only.' });
    if (req.method !== 'GET' && req.headers['x-airp-settings'] !== '1') return res.status(403).json({ ok: false, code: 'bad_request', error: 'Invalid remote request.' });
    next();
  });
  const failure = (res: Response, err: unknown) => {
    if (err instanceof RemoteError || err instanceof BundleError) return res.status(err.status).json({ ok: false, code: err.code, error: err.message });
    console.warn('[Remote] failed:', err instanceof Error ? err.message : String(err));
    return res.status(500).json({ ok: false, code: 'internal', error: err instanceof Error ? err.message : String(err) });
  };

  // The guest trial: GET = its state; POST {device} = start it (guest session + trial credits), idempotent.
  router.get('/remote/guest', async (_req, res) => {
    try { res.json({ ok: true, ...(await guestTrial(null, { fetch: deps.fetch })) }); } catch (err) { failure(res, err); }
  });
  router.post('/remote/guest', async (req, res) => {
    try { res.json({ ok: true, ...(await guestTrial(req.body?.device, { start: true, fetch: deps.fetch })) }); } catch (err) { failure(res, err); }
  });
  router.get('/remote/settings', async (_req, res) => {
    try { res.json({ ok: true, ...(await remoteSettingsView(repoRoot)) }); } catch (err) { failure(res, err); }
  });
  // 「高级」: the remote address. Changing it signs out (another remote, maybe another account system).
  router.post('/remote/settings', async (req, res) => {
    try {
      await saveRemoteUrl(repoRoot, { url: req.body?.url });
      res.json({ ok: true, ...(await remoteSettingsView(repoRoot)) });
    } catch (err) { failure(res, err); }
  });

  // 「用账号登录」. Neutral names: the auth
  // provider behind them (Supabase today) is an adapter, not part of the API.
  router.post('/remote/login', async (req, res) => {
    try { res.json(await startLogin(repoRoot, { method: req.body?.method, email: req.body?.email, origin: req.body?.origin, device: req.body?.device }, remoteDeps)); } catch (err) { failure(res, err); }
  });
  // Sign in with a code (no browser here): the page shows the code, the owner
  // approves on any device, this server polls; `GET /remote/settings` reports
  // `device.status` until it is done.
  router.post('/remote/login/device', async (_req, res) => {
    try { res.json(await startDeviceLogin(repoRoot, remoteDeps)); } catch (err) { failure(res, err); }
  });
  router.post('/remote/login/device/cancel', (_req, res) => {
    cancelDeviceLogin();
    res.json({ ok: true });
  });
  router.post('/remote/login/verify', async (req, res) => {
    try {
      await verifyEmailCode(repoRoot, { email: req.body?.email, code: req.body?.code }, remoteDeps);
      res.json({ ok: true, ...(await remoteSettingsView(repoRoot)) });
    } catch (err) { failure(res, err); }
  });
  // Where the provider sends the browser back. A PKCE `?code=` is exchanged
  // right here; an implicit-flow fragment never reaches a server, so the page
  // reads it and posts it back to the same path (with the settings header).
  router.get('/remote/login/callback/:state', async (req, res) => {
    const problem = [req.query.error_description, req.query.error].find((v) => typeof v === 'string') as string | undefined;
    if (problem) return res.status(400).type('html').send(callbackPage('fail', problem));
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    if (!code) return res.type('html').send(callbackPage('fragment', ''));
    try {
      const { email } = await finishLogin(repoRoot, req.params.state, { code }, remoteDeps);
      res.type('html').send(callbackPage('done', email ?? ''));
    } catch (err) {
      res.status(err instanceof RemoteError ? err.status : 500).type('html').send(callbackPage('fail', err instanceof Error ? err.message : String(err)));
    }
  });
  router.post('/remote/login/callback/:state', async (req, res) => {
    try {
      if (!LOGIN_STATE.test(req.params.state)) throw new RemoteError(400, 'login_expired', 'Unknown sign-in.');
      const expiresIn = Number(req.body?.expires_in);
      const { email } = await finishLogin(repoRoot, req.params.state, {
        accessToken: typeof req.body?.access_token === 'string' ? req.body.access_token : undefined,
        refreshToken: typeof req.body?.refresh_token === 'string' ? req.body.refresh_token : undefined,
        expiresIn: Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : undefined,
      }, remoteDeps);
      res.json({ ok: true, email });
    } catch (err) { failure(res, err); }
  });
  router.post('/remote/logout', async (_req, res) => {
    try {
      await logoutRemote(repoRoot, remoteDeps);
      res.json({ ok: true, ...(await remoteSettingsView(repoRoot)) });
    } catch (err) { failure(res, err); }
  });
  router.post('/remote/test', async (_req, res) => {
    try { res.json(await remoteWhoami(repoRoot, remoteDeps)); } catch (err) { failure(res, err); }
  });
  router.get('/remote/worlds', async (_req, res) => {
    try { res.json(await remoteWorlds(repoRoot, remoteDeps)); } catch (err) { failure(res, err); }
  });
  // A remote world's cover, relayed with the account session.
  // `h` matching the bytes → immutable, so the page downloads each cover once.
  router.get('/remote/cover', async (req, res) => {
    try {
      const cover = await remoteCover(repoRoot, { id: req.query.id, from: req.query.from, h: req.query.h, rev: req.query.rev }, remoteDeps);
      res.set({ 'Content-Type': cover.type, 'Cache-Control': cover.pinned ? 'private, max-age=31536000, immutable' : 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.send(cover.bytes);
    } catch (err) { failure(res, err); }
  });
  router.post('/remote/push', async (req, res) => {
    try { res.json(await pushToRemote(repoRoot, req.body?.worldPath, remoteDeps)); } catch (err) { failure(res, err); }
  });
  router.post('/remote/pull', async (req, res) => {
    try { res.json(await pullFromRemote(repoRoot, { id: req.body?.id, from: req.body?.from, replace: req.body?.replace }, remoteDeps)); } catch (err) { failure(res, err); }
  });
  router.post('/remote/publish', async (req, res) => {
    try { res.json(await publishOnRemote(repoRoot, req.body?.id, remoteDeps)); } catch (err) { failure(res, err); }
  });
  // 撤回发布: `{ id }` (a remote world) or `{ worldPath }` (a local original's remembered pair).
  router.post('/remote/unpublish', async (req, res) => {
    try { res.json(await unpublishOnRemote(repoRoot, { id: req.body?.id, worldPath: req.body?.worldPath }, remoteDeps)); } catch (err) { failure(res, err); }
  });
  // 强制撤回 (admins): `{ id, reason? }`; the remote checks who is an admin.
  router.post('/remote/force-unpublish', async (req, res) => {
    try { res.json(await forceUnpublishOnRemote(repoRoot, { id: req.body?.id, reason: req.body?.reason }, remoteDeps)); } catch (err) { failure(res, err); }
  });
  // 本机 / 云端: the 云端 worlds' sync — status, a pass (on leaving a world, every
  // few minutes, 「立即同步」), 「上传到云端」 for a 本机 world, 「两份都保留」 for a conflict.
  router.get('/remote/sync', async (_req, res) => {
    try { res.json(await worldSyncStatus()); } catch (err) { failure(res, err); }
  });
  router.post('/remote/sync', async (req, res) => {
    try {
      const worldPath = typeof req.body?.worldPath === 'string' ? req.body.worldPath : undefined;
      res.json(await syncWorlds(repoRoot, remoteDeps, worldPath));
    } catch (err) { failure(res, err); }
  });
  router.post('/remote/sync/cloud', async (req, res) => {
    try { res.json(await keepInCloud(repoRoot, req.body?.worldPath, remoteDeps)); } catch (err) { failure(res, err); }
  });
  router.post('/remote/sync/keep-both', async (req, res) => {
    try { res.json(await keepBoth(repoRoot, req.body?.worldPath, remoteDeps)); } catch (err) { failure(res, err); }
  });
  // API keys (wl_pat_…) for the Worldlines model gateway. The create answer carries the value
  // once (Cache-Control: no-store above); nothing here keeps or logs it.
  router.get('/remote/api-keys', async (_req, res) => {
    try { res.json(await listApiKeys(repoRoot, remoteDeps)); } catch (err) { failure(res, err); }
  });
  router.post('/remote/api-keys', async (req, res) => {
    try { res.json(await createApiKey(repoRoot, { name: req.body?.name, expiresInDays: req.body?.expiresInDays, scopes: req.body?.scopes }, remoteDeps)); } catch (err) { failure(res, err); }
  });
  router.delete('/remote/api-keys/:id', async (req, res) => {
    try { res.json(await revokeApiKey(repoRoot, req.params.id, remoteDeps)); } catch (err) { failure(res, err); }
  });
  return router;
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * The page the sign-in provider returns to. `fragment`: read the implicit-flow
 * tokens from `location.hash` and post them to this same path, then clear the
 * hash so they do not linger in history. No token is ever written into the
 * HTML by the server.
 */
function callbackPage(kind: 'done' | 'fail' | 'fragment', detail = ''): string {
  const style = 'body{margin:0;min-height:100vh;display:grid;place-items:center;background:#16140f;color:#e9e1cf;font:16px/1.7 system-ui,sans-serif;text-align:center;padding:0 16px}';
  // The interface language the page stored (lib/i18n.ts, `airp-ui-locale` — set from ?lang= or a pick; the callback
  // comes back to the same origin), not the browser's: Chinese → Chinese big, anything else → English big
  //. Runs before the lines are drawn.
  const pick = `<script>try{if(localStorage.getItem('airp-ui-locale')==='zh-CN')document.documentElement.setAttribute('data-lead','zh')}catch(e){}</script>`;
  const swap = `<script>(function(){if(document.documentElement.getAttribute('data-lead')!=='zh')return;document.documentElement.lang='zh-CN';var a=document.getElementById('msg'),b=document.getElementById('sub');if(a&&b){var t=a.textContent;a.textContent=b.textContent;b.textContent=t;}})()</script>`;
  const shell = (body: string) => `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="referrer" content="no-referrer"><title>AIRP</title><style>${style}</style>${pick}<main>${body}</main>`;
  // Two lines: English big, Chinese small until `swap` right after them (escaped HTML in, never a token).
  const lines = (zh: string, en: string) => `<p id="msg">${en}</p><p><small id="sub">${zh}</small></p>${swap}`;
  if (kind === 'done') {
    const who = detail ? escapeHtml(detail) : '';
    return shell(`${lines(`已登录${who ? `为 ${who}` : ''}。可以关闭这个页面，回到 AIRP。`, `Signed in${who ? ` as ${who}` : ''}. You can close this tab and go back to AIRP.`)}<script>history.replaceState(null,'',location.pathname.replace(/[^/]+$/,'done'));setTimeout(()=>window.close(),800)</script>`);
  }
  if (kind === 'fail') return shell(lines(`登录未完成：${escapeHtml(detail)}`, `Sign-in did not complete: ${escapeHtml(detail)}. Try again from Settings → Remote.`));
  return shell(`${lines('正在登录…', 'Signing in…')}<script>
  (async () => {
    const lead = document.documentElement.getAttribute('data-lead') === 'zh' ? 'zh' : 'en';
    const show = (zh, en) => { document.getElementById('msg').textContent = lead === 'zh' ? zh : en; document.getElementById('sub').textContent = lead === 'zh' ? en : zh; };
    const hash = new URLSearchParams(location.hash.slice(1));
    history.replaceState(null, '', location.pathname);
    const problem = hash.get('error_description') || hash.get('error');
    if (problem) { show('登录未完成：' + problem, 'Sign-in did not complete: ' + problem); return; }
    if (!hash.get('access_token')) { show('没有收到登录信息，请从「设置 → 远端」重新登录。', 'Nothing came back. Start again from Settings → Remote.'); return; }
    const res = await fetch(location.pathname, { method: 'POST', headers: { 'content-type': 'application/json', 'X-AIRP-Settings': '1' },
      body: JSON.stringify({ access_token: hash.get('access_token'), refresh_token: hash.get('refresh_token'), expires_in: hash.get('expires_in') }) });
    const body = await res.json().catch(() => ({}));
    if (res.ok) { show('已登录' + (body.email ? '为 ' + body.email : '') + '。可以关闭这个页面。', 'Signed in' + (body.email ? ' as ' + body.email : '') + '. You can close this tab.'); setTimeout(() => window.close(), 800); return; }
    show('登录未完成：' + (body.error || res.status), 'Sign-in did not complete: ' + (body.error || res.status));
  })();
</script>`);
}
