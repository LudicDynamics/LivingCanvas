// The guest trial, server side: the guest session beside the account session,
// the trial credits from billing, the guest token only for the trial world and only while signed out, and the
// trial saves joining the account on sign-in. Runs against built dist (`pnpm --filter @airp/server build`).
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { guestTrial, guestAccessToken, startGuest, migrateGuestToAccount, localTrialSaves, guestFile, refusedByOf } from '../dist/sync/guest-session.js';
import { remoteSettingsView } from '../dist/sync/remote-client.js';

const DEVICE = 'device-guest-test-0001';
const jwtish = (n) => `guest-access-${n}`;

async function setup(t, { enabled = true } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-guest-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const saved = { ...process.env };
  t.after(() => { for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]; Object.assign(process.env, saved); });
  Object.assign(process.env, {
    AIRP_REMOTE_CONFIG: path.join(dir, 'config', 'remote.json'),
    AIRP_ID_BASE: 'https://id.test', AIRP_STORAGE_BASE: 'https://storage.test', AIRP_BILLING_BASE: 'https://billing.test', AIRP_DATA_BASE: 'https://data.test',
  });
  if (enabled) process.env.AIRP_GUEST_TRIAL = '1'; else delete process.env.AIRP_GUEST_TRIAL;
  delete process.env.AIRP_WORLDS_ROOT;
  delete process.env.AIRP_USER_ID;
  const calls = [];
  const state = { remainingMc: 200_000, claim: 201, claimBody: { error: 'claim_limited' }, guestStatus: 200, guestBody: { error: 'guest_limited', message: 'Too many guest sessions from this network or device. Sign in to keep playing.' }, n: 0, records: [] };
  const fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method: init.method ?? 'GET', url: u.href, headers, body });
    const json = (status, b) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
    if (u.href === 'https://id.test/v1/guest') {
      if (state.guestStatus !== 200) return json(state.guestStatus, state.guestBody);
      state.n += 1;
      return json(200, { access_token: jwtish(state.n), refresh_token: `guest-refresh-${state.n}`, expires_in: 900, user: { id: 'AAAAAAAA-0000-4000-8000-00000000000' + state.n, anonymous: true, email: null } });
    }
    if (u.href === 'https://id.test/v1/token/refresh') {
      state.n += 1;
      return json(200, { access_token: jwtish(state.n), refresh_token: `guest-refresh-${state.n}`, expires_in: 900, user: { id: 'aaaaaaaa-0000-4000-8000-000000000001', anonymous: true } });
    }
    if (u.href === 'https://billing.test/v1/claims/worldlines/guest-trial') {
      if (state.claim === 429) return json(429, state.claimBody);
      const r = json(state.claim, { status: state.claim === 201 ? 'created' : 'duplicated', amount_mc: 200_000, remaining_mc: state.remainingMc });
      state.claim = 200;
      return r;
    }
    if (u.hostname === 'data.test') {
      if ((init.method ?? 'GET') === 'GET') return json(200, { records: [] });
      state.records.push(body);
      return json(201, { id: `r${state.records.length}`, rev: 1, body, updated_at: new Date().toISOString() });
    }
    return json(404, { error: 'not_found' });
  };
  return { dir, fetch, calls, state };
}

async function signIn(dir) {
  const file = path.join(dir, 'config', 'remote.json');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify({ auth: { provider: 'worldlines', issuer: 'https://id.test' }, session: { accessToken: 'account-access', refreshToken: 'account-refresh', expiresAt: Date.now() + 3600_000, uid: 'bbbbbbbb-0000-4000-8000-000000000001', email: 'p@example.test' } }));
}

test('off by default: no guest session, no token, settings say so', async (t) => {
  const { fetch, calls } = await setup(t, { enabled: false });
  await assert.rejects(startGuest(DEVICE, fetch), (e) => e.code === 'guest_trial_off');
  assert.deepEqual(await guestTrial(DEVICE, { start: true, fetch }), { enabled: false, signedIn: false, active: false, credits: 200, remaining: null, low: false, refused: null, refusedBy: null });
  assert.equal(await guestAccessToken({ world: 'last-train-zh', fetch }), null);
  assert.equal((await remoteSettingsView()).guestTrial, false);
  assert.equal(calls.length, 0);
});

test('start: identity guest session (device header) + billing trial credits; idempotent; kept outside every world (0600)', async (t) => {
  const { fetch, calls } = await setup(t);
  assert.equal((await remoteSettingsView()).guestTrial, true);
  const v = await guestTrial(DEVICE, { start: true, fetch });
  assert.deepEqual(v, { enabled: true, signedIn: false, active: true, credits: 200, remaining: 200, low: false, refused: null, refusedBy: null });
  const guestCall = calls.find((c) => c.url === 'https://id.test/v1/guest');
  assert.equal(guestCall.headers['x-worldlines-device'], DEVICE);
  const claim = calls.find((c) => c.url.endsWith('/guest-trial'));
  assert.equal(claim.headers.authorization, `Bearer ${jwtish(1)}`);
  assert.equal(claim.headers['x-worldlines-device'], DEVICE);
  await guestTrial(DEVICE, { start: true, fetch });
  assert.equal(calls.filter((c) => c.url === 'https://id.test/v1/guest').length, 1, 'one guest per browser');
  const st = await fs.stat(guestFile());
  assert.equal(st.mode & 0o777, 0o600);
  assert.equal(path.dirname(guestFile()), path.dirname(process.env.AIRP_REMOTE_CONFIG));
  // without `start`, only the state (no new session)
  assert.equal((await guestTrial(null, { fetch })).active, true);
});

test('the guest token: trial world only, signed out only; refreshed when expired', async (t) => {
  const { dir, fetch } = await setup(t);
  await guestTrial(DEVICE, { start: true, fetch });
  assert.equal(await guestAccessToken({ world: 'last-train-jp', fetch }), jwtish(1));
  for (const world of ['harbor-of-masks', null, 'last-train-xx']) assert.equal(await guestAccessToken({ world, fetch }), null, String(world));
  assert.equal(await guestAccessToken({ world: 'last-train', fetch, force: true }), jwtish(2), 'force → refreshed (rotating)');
  await signIn(dir);
  assert.equal(await guestAccessToken({ world: 'last-train', fetch }), null, 'signed in: the account pays');
  assert.deepEqual(await guestTrial(DEVICE, { start: true, fetch }).then((v) => [v.signedIn, v.active]), [true, false]);
});

test('credits nearly used → low; trial already used on this device / network → refused; guest limit → refused', async (t) => {
  const { fetch, state } = await setup(t);
  state.remainingMc = 30_000;
  const low = await guestTrial(DEVICE, { start: true, fetch });
  assert.deepEqual([low.remaining, low.low], [30, true]);
  state.claim = 429;
  const used = await guestTrial(DEVICE, { fetch });
  assert.deepEqual([used.active, used.remaining, used.refused], [false, 0, 'claim_limited']);
  // Live 2026-10-11 (canvas-20261011-0250): billing's per-network cap — the page has to say 「这个网络」, not 「这台设备」.
  state.claimBody = { error: 'claim_limited', message: 'The guest trial was already used on this network. Sign in to keep playing.' };
  assert.deepEqual(await guestTrial(DEVICE, { fetch }).then((v) => [v.refused, v.refusedBy]), ['claim_limited', 'network']);
  state.claimBody = { error: 'claim_limited', message: 'The guest trial was already used on this device. Sign in to keep playing.' };
  assert.deepEqual(await guestTrial(DEVICE, { fetch }).then((v) => [v.refused, v.refusedBy]), ['claim_limited', 'device']);
  state.claimBody = { error: 'claim_limited' };
  assert.equal((await guestTrial(DEVICE, { fetch })).refusedBy, 'device-or-network', 'no message: either');
});

test('refusedByOf: billing / identity `by` first, else their message; only for the two caps', () => {
  assert.equal(refusedByOf('claim_limited', { by: 'ip' }), 'network');
  assert.equal(refusedByOf('claim_limited', { by: 'device' }), 'device');
  assert.equal(refusedByOf('guest_limited', { message: 'Too many guest sessions from this network or device. Sign in to keep playing.' }), 'device-or-network');
  assert.equal(refusedByOf('guest_unavailable', { message: 'on this network' }), null);
  assert.equal(refusedByOf(null, null), null);
});

test('identity refuses a new guest (per network / device limit) → refused, no session kept', async (t) => {
  const { fetch, state } = await setup(t);
  state.guestStatus = 429;
  const v = await guestTrial(DEVICE, { start: true, fetch });
  assert.deepEqual([v.active, v.refused, v.refusedBy], [false, 'guest_limited', 'device-or-network']);
  await assert.rejects(fs.stat(guestFile()));
});

test('identity busy (its per-IP request limiter, 429 rate_limited) is not 「already used here」', async (t) => {
  const { fetch, state } = await setup(t);
  state.guestStatus = 429;
  state.guestBody = { error: 'rate_limited', message: 'Too many requests.' };
  const v = await guestTrial(DEVICE, { start: true, fetch });
  assert.deepEqual([v.active, v.refused, v.refusedBy], [false, 'guest_unavailable', null]);
});

test('services unreachable → refused guest_unavailable-like (remote_unreachable), the page shows 「暂时连不上」', async (t) => {
  await setup(t);
  const down = async () => { throw new TypeError('fetch failed'); };
  const v = await guestTrial(DEVICE, { start: true, fetch: down });
  assert.deepEqual([v.active, v.refused, v.refusedBy], [false, 'remote_unreachable', null]);
});

test('sign-in: the trial saves join the account (save summaries), other saves are left alone, the guest session is dropped', async (t) => {
  const { dir, fetch, state } = await setup(t);
  const repo = path.join(dir, 'repo');
  const w = async (rel, v) => { await fs.mkdir(path.dirname(path.join(repo, rel)), { recursive: true }); await fs.writeFile(path.join(repo, rel), JSON.stringify(v)); };
  await w('templates/last-train-zh/world.json', { id: 'last-train-zh', name: '末班车' });
  await w('templates/harbor/world.json', { id: 'harbor', name: 'Harbor' });
  await w('worlds/last-train-zh-20261008-abcd/world.json', { id: 'last-train-zh', name: '末班车' });
  await w('worlds/harbor-20261008-abcd/world.json', { id: 'harbor', name: 'Harbor' });
  assert.deepEqual(localTrialSaves(repo).map((s) => s.saveId), ['last-train-zh-20261008-abcd']);
  await guestTrial(DEVICE, { start: true, fetch });
  await signIn(dir);
  const r = await migrateGuestToAccount(repo, { fetch });
  assert.deepEqual(r.migrated, ['last-train-zh-20261008-abcd']);
  assert.deepEqual(state.records.map((r) => r.body ?? r).map((b) => [b.save_id, b.world_id, b.world_name]), [['last-train-zh-20261008-abcd', 'last-train-zh', '末班车']]);
  await assert.rejects(fs.stat(guestFile()), 'guest session dropped');
  await fs.access(path.join(repo, 'worlds/last-train-zh-20261008-abcd/world.json')); // the save itself stays where it is
  assert.deepEqual((await migrateGuestToAccount(repo, { fetch })).migrated, [], 'nothing twice');
});

// The hosted site's assembler (deploy/) is not part of the open-source copy; there the check has nothing to compare.
const ASSEMBLER = path.join(import.meta.dirname, '../../../deploy/canvas/assemble-browser.mjs');
const hasAssembler = await fs.access(ASSEMBLER).then(() => true, () => false);

test('one list of trial worlds: shared rules = what the site ships (assemble-browser) = what ai lets guests play (defaults)', { skip: !hasAssembler && 'deploy/ is not in this copy' }, async () => {
  const { GUEST_TRIAL_WORLDS } = await import('@airp/shared');
  const { TRIAL_WORLDS } = await import('../../../deploy/canvas/assemble-browser.mjs');
  assert.deepEqual([...TRIAL_WORLDS].sort(), [...GUEST_TRIAL_WORLDS].sort());
  for (const id of GUEST_TRIAL_WORLDS) await fs.access(path.join(import.meta.dirname, '../../../templates', id, 'world.json'));
});

// the design notes (2026-10-10): the LOCAL app (WORLDLINES_LOGIN=on, signed out, AIRP_GUEST_TRIAL=1) plays the trial worlds
// on the guest's token too — the model gateway turns on with a guest session and its calls carry the guest token.
test('local app: a guest session turns the model gateway on; its calls carry the guest token for a trial world only', async (t) => {
  const { fetch } = await setup(t);
  const { readAiGateway, gatewayFetch, guestSessionHere } = await import('../dist/ai-gateway.js');
  const { setGatewayWorldSource } = await import('../dist/gateway-world.js');
  let world = null;
  setGatewayWorldSource(() => world);
  delete process.env.AIRP_AI_BASE;
  delete process.env.AIRP_AI_ACCOUNT;
  assert.equal(readAiGateway(), null, 'signed out, no guest yet: no gateway');
  await guestTrial(DEVICE, { start: true, fetch });
  assert.equal(guestSessionHere(), true);
  assert.equal(readAiGateway(), null, 'pictures / workshop helpers: a guest is not an account (voices: routes/tts.ts accountGatewayFor)');
  const gateway = readAiGateway(process.env, { guest: true });
  assert.equal(gateway?.account, true, 'the agents (chat): the guest session routes through the service');
  const seen = [];
  const request = async (url, init) => { seen.push(new Headers(init.headers).get('authorization')); return new Response('{}', { status: 200 }); };
  t.after(() => setGatewayWorldSource(() => null));
  world = 'last-train-prologue-zh';
  await gatewayFetch(gateway, 'https://ai.test/v1/chat/completions', { method: 'POST', body: '{}' }, request);
  assert.match(seen.at(-1) ?? '', /^Bearer guest-access-/, 'trial world → the guest token');
  world = 'wuwu';
  const res = await gatewayFetch(gateway, 'https://ai.test/v1/chat/completions', { method: 'POST', body: '{}' }, request);
  assert.equal(res.status, 401, 'any other world → auth required (no token sent)');
  assert.equal(seen.length, 1);
  world = 'last-train-prologue-zh';
  const speech = await gatewayFetch(gateway, 'https://ai.test/v1/audio/speech', { method: 'POST', body: '{}' }, request);
  assert.equal(speech.status, 200, 'trial world → the guest token signs speech too (guest voice allowance)');
  assert.match(seen.at(-1) ?? '', /^Bearer guest-access-/);
  for (const p of ['audio/transcriptions', 'images/generations']) {
    const r = await gatewayFetch(gateway, `https://ai.test/v1/${p}`, { method: 'POST', body: '{}' }, request);
    assert.equal(r.status, 401, `a guest never signs ${p}`);
  }
  assert.equal(seen.length, 2);
  world = 'wuwu';
  assert.equal((await gatewayFetch(gateway, 'https://ai.test/v1/audio/speech', { method: 'POST', body: '{}' }, request)).status, 401, 'speech outside a trial world: auth required');
  assert.equal(seen.length, 2);
  process.env.AIRP_GUEST_TRIAL = '0';
  assert.equal(readAiGateway(process.env, { guest: true }), null, 'trial off → the guest session is ignored');
});
