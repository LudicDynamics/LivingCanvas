// Sign-up guard (platform identity 0009, anti-abuse): the page's device id — the same one billing
// gets for invites / claims — reaches the Worldlines identity service as X-Worldlines-Device on the email-code
// request / verify and the PKCE code exchange, and as device_id on the /v1/login/start link. A malformed id is never sent.
import assert from 'node:assert/strict';
import { test } from 'node:test';

const { worldlinesProvider, withDeviceParam } = await import('../dist/sync/auth-provider.js');

const ISSUER = 'https://auth.example.test';
const DEV = 'a1b2c3d4e5f6a7b8c9d0e1f2';
const tokens = { access_token: 'a', refresh_token: 'r', expires_in: 900, user: { id: '11111111-1111-4111-8111-111111111111', email: 'p@example.test' } };

function recorder() {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), device: new Headers(init.headers).get('x-worldlines-device') });
    return Response.json(String(url).endsWith('/v1/login/otp') ? { ok: true } : tokens);
  };
  return { calls, fetchImpl };
}

test('email code: the request and the verify carry X-Worldlines-Device', async () => {
  const r = recorder();
  const p = worldlinesProvider({ provider: 'worldlines', issuer: ISSUER }, r.fetchImpl);
  await p.beginLogin({ method: 'email', redirectTo: 'http://localhost:5173/api/remote/login/callback/s', email: 'p@example.test', device: DEV });
  await p.completeLogin({ email: 'p@example.test', otp: '123456', device: DEV });
  assert.deepEqual(r.calls.map((c) => [new URL(c.url).pathname, c.device]), [['/v1/login/otp', DEV], ['/v1/login/otp/verify', DEV]]);
});

test('Google / account: device_id on the login link; the code exchange carries the header', async () => {
  const r = recorder();
  const p = worldlinesProvider({ provider: 'worldlines', issuer: ISSUER }, r.fetchImpl);
  const redirectTo = 'http://localhost:5173/api/remote/login/callback/s';
  const started = await p.beginLogin({ method: 'google', redirectTo, device: DEV });
  const u = new URL(started.authorizeUrl);
  assert.equal(u.origin, ISSUER);
  assert.equal(u.searchParams.get('device_id'), DEV);
  await p.completeLogin({ code: 'c', verifier: started.verifier, redirectTo, device: DEV });
  assert.equal(r.calls.at(-1).device, DEV);
});

test('no or malformed device id: nothing is sent', async () => {
  for (const device of [undefined, '', 'short', 'has space here!!', 'x'.repeat(129)]) {
    const r = recorder();
    const p = worldlinesProvider({ provider: 'worldlines', issuer: ISSUER }, r.fetchImpl);
    const started = await p.beginLogin({ method: 'google', redirectTo: 'http://localhost:5173/cb/s', device });
    assert.equal(new URL(started.authorizeUrl).searchParams.has('device_id'), false, String(device));
    await p.beginLogin({ method: 'email', redirectTo: 'http://localhost:5173/cb/s', email: 'p@example.test', device });
    assert.equal(r.calls.at(-1).device, null, String(device));
  }
  assert.equal(withDeviceParam(`${ISSUER}/v1/login/start?a=1`, DEV), `${ISSUER}/v1/login/start?a=1&device_id=${DEV}`);
});
