// Browser mode on a static site (canvas.worldlines.gg): the in-tab server lets
// sign-in return to the page's own declared origin (AIRP_LOGIN_ORIGIN) besides
// loopback, and hands the runtime a fresh account token in-process
// (accountAccessToken / globalThis.__airpAccountToken), refreshing when expired.
// Runs against built dist.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-static-login-'));
process.env.AIRP_REMOTE_CONFIG = path.join(dir, 'remote.json');
process.env.AIRP_AUTH_PROVIDER = 'worldlines';
process.env.AIRP_AUTH_URL = 'https://auth.example';
const { startLogin, accountAccessToken } = await import('../dist/sync/remote-client.js');

const calls = [];
const fakeFetch = async (url, init) => {
  calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null });
  if (String(url).endsWith('/v1/login/otp')) return Response.json({ ok: true });
  if (String(url).endsWith('/v1/token/refresh')) return Response.json({ access_token: 'fresh', refresh_token: 'r2', expires_in: 900, user: { id: 'U1', email: 'a@example.test' } });
  return new Response('{}', { status: 404 });
};

test('sign-in returns only to loopback or the declared https page origin', async () => {
  const start = (origin) => startLogin('/repo', { method: 'email', email: 'a@example.test', origin }, { fetch: fakeFetch });
  delete process.env.AIRP_LOGIN_ORIGIN;
  await assert.rejects(start('https://canvas.example'), /this computer/);
  assert.equal((await start('http://127.0.0.1:3197')).sent, true);
  process.env.AIRP_LOGIN_ORIGIN = 'https://canvas.example';
  assert.equal((await start('https://canvas.example')).sent, true);
  await assert.rejects(start('https://evil.example'), /this computer/);
  process.env.AIRP_LOGIN_ORIGIN = 'http://canvas.example'; // plain http is never declared
  await assert.rejects(start('http://canvas.example'), /this computer/);
  delete process.env.AIRP_LOGIN_ORIGIN;
});

test('account token: null signed out, current when valid, refreshed when expired or forced', async () => {
  assert.equal(await accountAccessToken(), null);
  assert.equal(globalThis.__airpAccountToken, accountAccessToken);
  const session = { accessToken: 'old', refreshToken: 'r1', expiresAt: Date.now() + 3_600_000, uid: 'u1', email: null };
  await fs.writeFile(process.env.AIRP_REMOTE_CONFIG, JSON.stringify({ auth: { provider: 'worldlines', issuer: 'https://auth.example' }, session }));
  assert.equal(await accountAccessToken(), 'old');
  const realFetch = globalThis.fetch;
  globalThis.fetch = fakeFetch;
  try {
    assert.equal(await accountAccessToken({ force: true }), 'fresh');
    assert.equal(calls.at(-1).body.refresh_token, 'r1');
    assert.equal(JSON.parse(await fs.readFile(process.env.AIRP_REMOTE_CONFIG, 'utf8')).session.accessToken, 'fresh');
  } finally { globalThis.fetch = realFetch; }
});
