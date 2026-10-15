// The local app signs in like Claude Code (identity app login: `livingcanvas-local`,
// consent, scoped tokens; loopback or device code), and without its own provider
// keys uses that account through ai.worldlines.gg — chat via the agents' loopback
// proxy, speech / text jobs directly. Built dist: `pnpm --filter @airp/server build`.
//
// The identity service and the AI service are local FAKES: no real sign-in, no
// paid call. The session lives only in a temp remote.json (AIRP_REMOTE_CONFIG).
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { lstatSync, readlinkSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import express from 'express';

import { startLogin, startDeviceLogin, remoteSettingsView, accountAccessToken, appLogin } from '../dist/sync/remote-client.js';
import { readAiGateway, gatewayFetch, createAiProxyRouter, localAiProxyBase, aiRoutes, textModelEndpoint } from '../dist/ai-gateway.js';
import { accountAgentDir } from '../dist/engine/provider-config.js';

const ENV_KEYS = ['AIRP_REMOTE_CONFIG', 'AIRP_ID_BASE', 'AIRP_STORAGE_BASE', 'AIRP_REMOTE_URL', 'AIRP_AUTH_PROVIDER', 'AIRP_AUTH_URL', 'AIRP_LOGIN_CLIENT_ID', 'AIRP_LOGIN_SCOPES',
  'AIRP_AI_BASE', 'AIRP_AI_KEY', 'AIRP_AI_ACCOUNT', 'AIRP_AI_ACCOUNT_BASE', 'AIRP_AI_MODEL_MAP', 'PORT',
  'DEEPSEEK_API_KEY', 'OPENAI_API_KEY', 'DASHSCOPE_API_KEY', 'OPENROUTER_API_KEY', 'AIRP_TTS_LOCAL_BASE_URL', 'AIRP_IMAGE_MODEL'];

function useEnv(t, values) {
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, values);
  t.after(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
}

async function listen(t, handler) {
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }));
  return { base: `http://127.0.0.1:${server.address().port}`, port: server.address().port };
}

const readBody = (req) => new Promise((r) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => r(Buffer.concat(c))); });

const USER = { id: 'AAAA-uid', email: 'owner@example.com', anonymous: false };
const tokens = (n, extra = {}) => ({ access_token: `access-${n}`, refresh_token: `refresh-${n}`, expires_in: 900, user: USER, client_id: 'livingcanvas-local', scope: 'api:use storage:read', ...extra });

/** Fake identity: device code (pending once, then tokens), rotating refresh. */
async function fakeIdentity(t, { deny = false } = {}) {
  const calls = [];
  let polls = 0;
  let n = 1;
  const { base } = await listen(t, async (req, res) => {
    const raw = await readBody(req);
    const body = raw.length ? JSON.parse(raw) : {};
    calls.push({ path: req.url, body });
    const send = (status, value) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
    if (req.url === '/v1/device/code') return send(200, { device_code: 'dev-1', user_code: 'ABCD-EFGH', verification_uri: `${base}/device`, verification_uri_complete: `${base}/device?code=ABCD-EFGH`, expires_in: 600, interval: 1 });
    if (req.url === '/v1/token' && body.grant_type?.includes('device_code')) {
      if (deny) return send(400, { error: 'access_denied' });
      return polls++ === 0 ? send(400, { error: 'authorization_pending' }) : send(200, tokens(n++));
    }
    if (req.url === '/v1/token/refresh') return body.refresh_token === `refresh-${n - 1}` ? send(200, tokens(n++, { client_id: undefined, scope: undefined })) : send(401, { error: 'invalid_grant' });
    if (req.url === '/v1/logout') return send(200, { ok: true });
    send(404, { error: 'not_found' });
  });
  return { base, calls };
}

/** Fake ai.worldlines.gg: records auth + product; 401 for a stale token. */
async function fakeAi(t, { stale = null } = {}) {
  const calls = [];
  const { base } = await listen(t, async (req, res) => {
    const raw = await readBody(req);
    calls.push({ path: req.url, auth: req.headers.authorization, product: req.headers['x-worldlines-product'], type: req.headers['content-type'], body: raw.toString() });
    if (stale && req.headers.authorization === `Bearer ${stale}`) { res.writeHead(401, { 'content-type': 'application/json' }); return res.end('{"error":{"code":"invalid_token"}}'); }
    if (req.url.endsWith('/chat/completions')) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"content":"o"}}]}\n\n');
      return res.end('data: [DONE]\n\n');
    }
    res.writeHead(404).end();
  });
  return { base: `${base}/v1`, calls };
}

async function signedIn(t, file, session = {}) {
  await fs.writeFile(file, JSON.stringify({
    auth: { provider: 'worldlines', issuer: process.env.AIRP_ID_BASE },
    session: { accessToken: 'access-1', refreshToken: 'refresh-1', expiresAt: Date.now() + 600_000, uid: 'aaaa-uid', email: USER.email, clientId: 'livingcanvas-local', scopes: ['api:use'], ...session },
  }), { mode: 0o600 });
}

async function tempDir(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-applogin-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

test('loopback sign-in is the app login: client_id livingcanvas-local + scopes; the static site and the email code keep the plain sign-in', async (t) => {
  const dir = await tempDir(t);
  useEnv(t, { AIRP_REMOTE_CONFIG: path.join(dir, 'remote.json'), AIRP_ID_BASE: 'https://auth.example', AIRP_LOGIN_ORIGIN: undefined });
  const google = new URL((await startLogin('', { method: 'google', origin: 'http://localhost:5173' })).authorizeUrl);
  assert.equal(google.origin + google.pathname, 'https://auth.example/v1/login/start');
  assert.equal(google.searchParams.get('client_id'), 'livingcanvas-local');
  assert.equal(google.searchParams.get('scope'), appLogin().scopes.join(' '));
  assert.equal(google.searchParams.get('provider'), 'google');
  assert.match(google.searchParams.get('redirect'), /^http:\/\/localhost:5173\/api\/remote\/login\/callback\/[A-Za-z0-9_-]{32}$/);
  const chooser = new URL((await startLogin('', { method: 'account', origin: 'http://127.0.0.1:3001' })).authorizeUrl);
  assert.equal(chooser.searchParams.get('client_id'), 'livingcanvas-local');
  assert.equal(chooser.searchParams.get('provider'), null); // the service's own sign-in page
  // Turned off → the plain sign-in, as before.
  process.env.AIRP_LOGIN_CLIENT_ID = 'none';
  const plain = new URL((await startLogin('', { method: 'google', origin: 'http://localhost:5173' })).authorizeUrl);
  assert.equal(plain.searchParams.get('client_id'), null);
  // Scopes are configurable and validated by the service, not here.
  process.env.AIRP_LOGIN_CLIENT_ID = '';
  process.env.AIRP_LOGIN_SCOPES = 'api:use, storage:read';
  const narrow = new URL((await startLogin('', { method: 'google', origin: 'http://localhost:5173' })).authorizeUrl);
  assert.equal(narrow.searchParams.get('scope'), 'api:use storage:read');
});

test('device code: the page gets the code; once approved the session lands in remote.json (0600) with the app and its scopes', async (t) => {
  const dir = await tempDir(t);
  const id = await fakeIdentity(t);
  const file = path.join(dir, 'remote.json');
  useEnv(t, { AIRP_REMOTE_CONFIG: file, AIRP_ID_BASE: id.base });
  const code = await startDeviceLogin('');
  assert.equal(code.userCode, 'ABCD-EFGH');
  assert.equal(code.verificationUri, `${id.base}/device`);
  assert.deepEqual(id.calls[0].body, { client_id: 'livingcanvas-local', scope: appLogin().scopes.join(' ') });
  assert.equal((await remoteSettingsView()).device.status, 'waiting');
  const until = Date.now() + 8000;
  while ((await remoteSettingsView()).device?.status !== 'done') {
    assert.ok(Date.now() < until, 'device login did not finish');
    await new Promise((r) => setTimeout(r, 100));
  }
  const view = await remoteSettingsView();
  assert.equal(view.signedIn, true);
  assert.equal(view.email, USER.email);
  assert.deepEqual(view.app, { clientId: 'livingcanvas-local', scopes: ['api:use', 'storage:read'] });
  assert.equal(JSON.stringify(view).includes('access-'), false); // never a token
  assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).session.clientId, 'livingcanvas-local');
});

test('device code denied: reported as failed, nothing saved', async (t) => {
  const dir = await tempDir(t);
  const id = await fakeIdentity(t, { deny: true });
  const file = path.join(dir, 'remote.json');
  useEnv(t, { AIRP_REMOTE_CONFIG: file, AIRP_ID_BASE: id.base });
  await startDeviceLogin('');
  const until = Date.now() + 8000;
  while ((await remoteSettingsView()).device?.status !== 'failed') {
    assert.ok(Date.now() < until, 'device login did not fail');
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal((await remoteSettingsView()).signedIn, false);
  await assert.rejects(fs.access(file));
});

test('account mode: signed in and no own key → the service with the session token + product header; refreshed on 401, app kept', async (t) => {
  const dir = await tempDir(t);
  const id = await fakeIdentity(t);
  const ai = await fakeAi(t, { stale: 'access-0' });
  const file = path.join(dir, 'remote.json');
  useEnv(t, { AIRP_REMOTE_CONFIG: file, AIRP_ID_BASE: id.base, AIRP_AI_ACCOUNT_BASE: ai.base });
  assert.equal(readAiGateway(), null); // not signed in yet
  // The service no longer takes access-0; the fake identity rotates refresh-0 → access-1.
  await signedIn(t, file, { accessToken: 'access-0', refreshToken: 'refresh-0' });
  const gateway = readAiGateway();
  assert.deepEqual(gateway, { base: ai.base, apiKey: 'worldlines-account', account: true });
  const res = await gatewayFetch(gateway, `${ai.base}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(res.status, 200);
  assert.deepEqual(ai.calls.map((c) => [c.auth, c.product]), [['Bearer access-0', 'livingcanvas'], ['Bearer access-1', 'livingcanvas']]);
  const stored = JSON.parse(await fs.readFile(file, 'utf8')).session;
  assert.equal(stored.accessToken, 'access-1');
  assert.equal(stored.clientId, 'livingcanvas-local'); // survives a refresh that does not repeat it
  // Own keys win; AIRP_AI_ACCOUNT=0 turns the account path off.
  assert.equal(textModelEndpoint({ ...process.env, DEEPSEEK_API_KEY: 'own' }).baseUrl, 'https://api.deepseek.com');
  assert.equal(textModelEndpoint().baseUrl, ai.base);
  process.env.AIRP_AI_ACCOUNT = '0';
  assert.equal(readAiGateway(), null);
});

test('signed out: account calls answer 401 auth_required without reaching the service', async (t) => {
  const ai = await fakeAi(t);
  const dir = await tempDir(t);
  useEnv(t, { AIRP_REMOTE_CONFIG: path.join(dir, 'none.json') });
  assert.equal(await accountAccessToken(), null);
  const res = await gatewayFetch({ base: ai.base, apiKey: 'x', account: true }, `${ai.base}/audio/speech`, { method: 'POST', body: '{}' });
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error.code, 'auth_required');
  assert.equal(ai.calls.length, 0);
});

test('agents\' proxy: loopback + per-process secret; adds the token and product, renames the model, streams back', async (t) => {
  const dir = await tempDir(t);
  const id = await fakeIdentity(t);
  const ai = await fakeAi(t);
  const file = path.join(dir, 'remote.json');
  const app = express();
  app.use(createAiProxyRouter());
  const server = await listen(t, app);
  useEnv(t, { AIRP_REMOTE_CONFIG: file, AIRP_ID_BASE: id.base, AIRP_AI_ACCOUNT_BASE: ai.base, PORT: String(server.port), AIRP_AI_MODEL_MAP: '{"deepseek-v4-flash":"deepseek-chat"}' });
  const proxy = localAiProxyBase();
  assert.match(proxy, new RegExp(`^http://127\\.0\\.0\\.1:${server.port}/api/ai-proxy/[A-Za-z0-9_-]{20,}/v1$`));
  const chat = () => fetch(`${proxy}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer worldlines-account' }, body: JSON.stringify({ model: 'deepseek-v4-flash', stream: true }) });
  const out = await chat();
  assert.equal(out.status, 503); // not signed in
  await signedIn(t, file);
  const ok = await chat();
  assert.equal(ok.status, 200);
  assert.match(await ok.text(), /\[DONE\]/);
  const last = ai.calls.at(-1);
  assert.equal(last.path, '/v1/chat/completions');
  assert.equal(last.auth, 'Bearer access-1');
  assert.equal(last.product, 'livingcanvas');
  assert.equal(JSON.parse(last.body).model, 'deepseek-chat');
  const wrong = await fetch(`${proxy.replace(/ai-proxy\/[^/]+/, 'ai-proxy/guess')}/chat/completions`, { method: 'POST', body: '{}' });
  assert.equal(wrong.status, 403);
});

test('agents get a sibling agent dir whose models go to the proxy only for providers without their own key', async (t) => {
  const repo = await tempDir(t);
  const agent = path.join(repo, '.pi', 'agent');
  await fs.mkdir(agent, { recursive: true });
  await fs.writeFile(path.join(agent, 'models.json'), JSON.stringify({ providers: { deepseek: { baseUrl: 'https://api.deepseek.com', api: 'openai-completions', apiKey: '$DEEPSEEK_API_KEY', models: [{ id: 'deepseek-v4-flash' }] }, flow: { baseUrl: 'http://127.0.0.1:8317', apiKey: 'literal' } } }));
  await fs.writeFile(path.join(agent, 'settings.json'), '{}');
  const dir = accountAgentDir(repo, 'http://127.0.0.1:3001/api/ai-proxy/s/v1', {});
  assert.equal(dir, path.join(repo, '.pi', 'agent-account'));
  const models = JSON.parse(await fs.readFile(path.join(dir, 'models.json'), 'utf8'));
  assert.equal(models.providers.deepseek.baseUrl, 'http://127.0.0.1:3001/api/ai-proxy/s/v1');
  assert.equal(models.providers.deepseek.apiKey, 'worldlines-account');
  assert.equal(models.providers.flow.baseUrl, 'http://127.0.0.1:8317'); // a literal key is the owner's own
  assert.equal(models.providers.openai.baseUrl, 'http://127.0.0.1:3001/api/ai-proxy/s/v1');
  assert.ok(lstatSync(path.join(dir, 'settings.json')).isSymbolicLink());
  assert.equal(readlinkSync(path.join(dir, 'settings.json')), path.join('..', 'agent', 'settings.json'));
  // The owner's own file is untouched.
  assert.equal(JSON.parse(await fs.readFile(path.join(agent, 'models.json'), 'utf8')).providers.deepseek.baseUrl, 'https://api.deepseek.com');
  // Own keys for everything → nothing to route.
  assert.equal(accountAgentDir(repo, 'http://x/v1', { DEEPSEEK_API_KEY: 'k', OPENAI_API_KEY: 'k' }), null);
  const partial = JSON.parse(await fs.readFile(path.join(accountAgentDir(repo, 'http://x/v1', { DEEPSEEK_API_KEY: 'k' }), 'models.json'), 'utf8'));
  assert.equal(partial.providers.deepseek.baseUrl, 'https://api.deepseek.com');
  assert.equal(partial.providers.openai.baseUrl, 'http://x/v1');
});

test('the panel view: own key / local TTS / account / none per capability, never a key', async (t) => {
  const dir = await tempDir(t);
  const file = path.join(dir, 'remote.json');
  useEnv(t, { AIRP_REMOTE_CONFIG: file, AIRP_ID_BASE: 'https://auth.example' });
  assert.deepEqual(aiRoutes(), { chat: { deepseek: 'none', openai: 'none' }, tts: 'none', stt: 'none', image: 'none', signedIn: false });
  await signedIn(t, file);
  assert.deepEqual(aiRoutes(), { chat: { deepseek: 'account', openai: 'account' }, tts: 'account', stt: 'account', image: 'account', signedIn: true });
  assert.deepEqual(aiRoutes({ ...process.env, DEEPSEEK_API_KEY: 'sk', DASHSCOPE_API_KEY: 'k' }), { chat: { deepseek: 'own', openai: 'account' }, tts: 'own', stt: 'account', image: 'account', signedIn: true });
  assert.deepEqual(aiRoutes({ ...process.env, AIRP_AI_BASE: 'https://ai.example/v1', AIRP_AI_KEY: 'pat' }).tts, 'service');
});
