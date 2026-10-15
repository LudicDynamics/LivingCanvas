// The account's settings / favorites / ratings / save summaries (sync/account-data.ts,
// routes/account-data.ts) against a FAKE data service that keeps the platform's rules
// that matter here: records per owner, quota (setting = 1), If-Match revs, where[] on
// index fields, the public stats. Runs against built dist (`pnpm --filter @airp/server build`).
//
// Pinned:
//   - signed out / not allowed / unreachable = { ok: false, available: false } (200), never an error;
//   - settings: only the manifest's fields travel (an API key never does), last write wins
//     (a stale rev is retried at the service's rev; a second device's record is reused);
//   - favorites, one review per world (duplicates folded), public ratings without a token;
//   - save summaries upsert by save id; a full list forgets the oldest;
//   - a 401 refreshes the token once; the page never sees a token; localhost + header only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import express from 'express';

import { createAccountDataRouter } from '../dist/routes/account-data.js';
import { cleanSettings, clearLogCache, dedupeAnnouncements, rewardOf } from '../dist/sync/account-data.js';

const TOKEN = 'tok-alice-0123456789';
const QUOTA = { setting: 1, favorite: 500, review: 500, 'save-summary': 3, report: 200, like: 2000, profile: 1, 'bug-report': 200 };
const INDEX = { setting: [], favorite: ['world_id'], review: ['world_id', 'rating'], 'save-summary': ['save_id', 'world_id'], report: ['target', 'reason'], like: ['world_id'], profile: [], 'bug-report': ['kind', 'world_id', 'place', 'edition', 'client_version'] };
const GUEST_TOKEN = 'tok-guest-0123456789';

function fakeData({ tokens = { [TOKEN]: 'alice', [GUEST_TOKEN]: 'guest-1' } } = {}) {
  const rows = new Map(); // id → { kind, owner, body, rev, updated_at, deleted }
  const seen = [];
  let n = 0;
  let clock = Date.parse('2026-10-02T00:00:00Z');
  const state = { sub: null, claims: [], claimedToday: false, redeemed: [], forbid: false, expired: new Set(), raceOnce: false, takenDown: new Set(), rateLimited: false, announcements: { platform: [], livingcanvas: [] }, displayName: 'Fog Walker', chronicle: [], plays: {}, activity: {}, activityDown: false };
  const send = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const view = (id, r) => ({ id, collection: `livingcanvas/${r.kind}`, owner: r.owner, visibility: r.visibility ?? 'private', body: r.body, rev: r.rev, updated_at: new Date(r.updated_at).toISOString() });
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString('utf8');
    const body = raw ? JSON.parse(raw) : null;
    const url = new URL(req.url, 'http://data.test');
    seen.push({ method: req.method, path: url.pathname, search: url.search, auth: req.headers.authorization ?? null, ifMatch: req.headers['if-match'] ?? null, body });
    const stats = /^\/v1\/public\/stats\/livingcanvas\/review$/.exec(url.pathname);
    if (stats) {
      const groups = {};
      for (const w of (url.searchParams.get('in') ?? '').split(',')) {
        const latest = new Map();
        for (const r of rows.values()) if (r.kind === 'review' && !r.deleted && r.body.world_id === w && (!latest.has(r.owner) || latest.get(r.owner).updated_at < r.updated_at)) latest.set(r.owner, r);
        const list = [...latest.values()];
        groups[w] = { count: list.length, avg: { rating: list.length ? list.reduce((s, r) => s + r.body.rating, 0) / list.length : null } };
      }
      return send(res, 200, { collection: 'livingcanvas/review', by: 'world_id', groups });
    }
    // the other Worldlines services, as far as account-data uses them (AIRP_*_BASE point here too)
    if (url.pathname === '/v1/me' && req.method === 'GET') return send(res, 200, { id: 'alice', email: 'alice@example.test', display_name: state.displayName });
    if (url.pathname === '/v1/usage/me') return send(res, 200, { plan: 'free', today: { usd: 0.012, tokens: 3400 }, month: { usd: 0.4, tokens: 98000 }, header: req.headers['x-worldlines-product'] });
    if (url.pathname === '/v1/me/balance') return send(res, 200, { product: 'worldlines', point_name: { daily: 'credits', persistent: 'credits' }, available_mc: 12500 + (state.claimedToday ? 250000 : 0), daily: { allowance: 250000, claimed: state.claimedToday ? 250000 : 0, used: 300, resets_at: '2026-10-03T00:00:00Z', claimable: !state.claimedToday, ...(state.tier ?? {}) } });
    if (url.pathname === '/v1/stats/activity') {
      if (state.activityDown) return send(res, 503, { error: { code: 'down' } });
      const ids = url.searchParams.get('ids').split(',');
      return send(res, 200, { product: url.searchParams.get('product'), tokens_since: '2026-10-04', worlds: Object.fromEntries(ids.filter((id) => state.activity[id]).map((id) => [id, state.activity[id]])) });
    }
    if (url.pathname === '/v1/stats/worlds') return send(res, 200, { worlds: url.searchParams.get('refs').split(',').map((r) => (state.plays[r] ? { world_ref: r, public: true, ...state.plays[r] } : { world_ref: r, public: false, reason: 'too_few_players' })) });
    if (url.pathname === '/v1/events' && req.method === 'POST') { state.usage = [...(state.usage ?? []), { auth: req.headers.authorization ?? null, body }]; return send(res, state.usageStatus ?? 202, { accepted: body.events.length, rejected: 0 }); }
    if (url.pathname === '/v1/events:batch') { state.chronicle.push({ auth: req.headers.authorization, ...body }); return send(res, 200, { product: body.product, via: 'user', counts: { created: body.events.length } }); }
    const pubStats = /^\/v1\/public\/stats\/livingcanvas\/like$/.exec(url.pathname);
    if (pubStats) {
      const groups = {};
      for (const w of url.searchParams.get('in').split(',')) groups[w] = { count: new Set([...rows.values()].filter((r) => r.kind === 'like' && !r.deleted && r.body.world_id === w).map((r) => r.owner)).size, avg: {} };
      return send(res, 200, { groups });
    }
    if (url.pathname === '/v1/public/logs') {
      // v5 (platform / banner / before, next_before, ETag + 304); logsVersion 4 = the older deploy that ignores
      // those parameters and answers without next_before; no state.logs = a deploy without logs (404)
      state.logQueries = [...(state.logQueries ?? []), url.search];
      state.logConditional = [...(state.logConditional ?? []), req.headers['if-none-match'] ?? null];
      if (state.logsDown) return send(res, 503, { error: 'unavailable' });
      if (!state.logs) return send(res, 404, { error: 'not_found' });
      const sp = url.searchParams;
      const v5 = state.logsVersion !== 4;
      const scopes = (sp.get('scope') ?? '').split(',').filter(Boolean);
      const surface = sp.get('surface');
      const platform = v5 ? sp.get('platform') : null;
      const banner = v5 ? sp.get('banner') : null;
      const before = v5 ? sp.get('before') : null;
      const now = Date.now();
      // staleBanners: a cached answer from before a banner ended (the client must check the window itself)
      const on = (b) => state.staleBanners || (Date.parse(b.starts_at) <= now && !(b.ends_at && Date.parse(b.ends_at) <= now));
      const list = state.logs.filter((l) => (!scopes.length || scopes.includes(l.scope)) && (!surface || (l.surfaces ?? []).includes(surface)) && (!platform || (l.platforms ?? []).includes(platform)) && (!banner || (l.banner && on(l.banner))) && (!before || l.published_at < before));
      const limit = Number(sp.get('limit') ?? 20);
      const page = list.slice(0, limit);
      const answer = v5 ? { logs: page, next_before: !banner && list.length > limit ? page.at(-1).published_at : null } : { logs: page.map(({ banner: _b, platforms: _p, ...l }) => l) };
      const etag = `"${createHash('sha256').update(JSON.stringify(answer)).digest('hex').slice(0, 24)}"`;
      if (req.headers['if-none-match'] === etag) { res.writeHead(304, { etag }); return res.end(); }
      res.writeHead(200, { 'content-type': 'application/json', etag });
      return res.end(JSON.stringify(answer));
    }
    const ann = /^\/v1\/public\/records\/(platform|livingcanvas)\/announcement$/.exec(url.pathname);
    if (ann) return state.announcements[ann[1]] === null ? send(res, 404, { error: 'unknown_collection' }) : send(res, 200, { scope: 'public', records: state.announcements[ann[1]], next_cursor: null });
    if (url.pathname === '/v1/public/records/livingcanvas/review') {
      const w = url.searchParams.get('where[world_id]');
      const list = [...rows].filter(([, r]) => r.kind === 'review' && !r.deleted && r.visibility === 'published' && r.body.world_id === w);
      const start = Number(url.searchParams.get('cursor') ?? 0);
      const page = list.reverse().slice(start, start + Number(url.searchParams.get('limit') ?? 50));
      // public_author: the owner's profile nickname, joined here (as data does), never the uid
      const nick = (owner) => [...rows.values()].find((x) => x.kind === 'profile' && !x.deleted && x.owner === owner)?.body.nickname ?? null;
      return send(res, 200, { scope: 'public', records: page.map(([i, r]) => ({ ...view(i, r), owner: null, author_tag: 'a1b2c3d4e5', author_name: nick(r.owner), body: { world_id: r.body.world_id, rating: r.body.rating, ...(r.body.comment ? { comment: r.body.comment } : {}) } })), next_cursor: start + page.length < list.length ? String(start + page.length) : null });
    }
    const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    if (state.expired.has(token)) return send(res, 401, { error: 'invalid_token' });
    const uid = tokens[token];
    if (!uid) return send(res, 401, { error: 'unauthorized' });
    // billing (AIRP_BILLING_BASE points here): the membership and redemption codes
    if (url.pathname === '/v1/me/subscription' && state.sub) return send(res, 200, state.sub);
    const claim = /^\/v1\/claims\/([a-z0-9-]+)\/daily$/.exec(url.pathname);
    if (claim && req.method === 'POST') {
      state.claims.push({ auth: req.headers.authorization, product: claim[1], ...(req.headers['x-worldlines-device'] ? { device: req.headers['x-worldlines-device'] } : {}) });
      if (state.claimRefuse) return send(res, 409, { error: 'nothing_to_claim', message: 'This plan has no daily allowance for this product.' });
      const dup = state.claimedToday;
      state.claimedToday = true;
      return send(res, dup ? 200 : 201, { status: dup ? 'duplicated' : 'created', duplicated: dup, day: '2026-10-02', amount_mc: 250000, balance: { product: 'worldlines', available_mc: 262500, daily: { allowance: 250000, claimed: 250000, used: 300, resets_at: '2026-10-03T00:00:00Z', claimable: false } } });
    }
    const gift = /^\/v1\/claims\/([a-z0-9-]+)\/newcomer$/.exec(url.pathname);
    if (gift && req.method === 'POST') {
      (state.gifts ??= []).push({ auth: req.headers.authorization, product: gift[1], device: req.headers['x-worldlines-device'] ?? null });
      if (state.giftLimited) return send(res, 429, { error: 'claim_limited', message: 'Too many accounts have claimed free credits on this device; try again later.' });
      const dup = !!state.giftGiven;
      state.giftGiven = true;
      return send(res, dup ? 200 : 201, { status: dup ? 'duplicated' : 'created', duplicated: dup, amount_mc: 500000, expires_at: '2026-11-04T03:00:00.000Z', balance: { product: 'worldlines', available_mc: 500000 } });
    }
    if (url.pathname === '/v1/me/redeem' && req.method === 'POST') {
      state.redeemed.push({ auth: req.headers.authorization, body });
      const answers = {
        'PLAYTEST-7KQX-M3TB': [200, { outcome: 'trial_started', code: 'PLAYTEST-7KQX-M3TB', plan: 'story', ends_at: '2026-11-01T03:00:00.000Z', credits: 100 }],
        GIFT: [200, { outcome: 'credits_only', code: 'GIFT', plan: 'vivid', ends_at: null, credits: 300, already_member: true }],
        USED: [409, { error: 'already_redeemed', message: 'You have already redeemed this code.' }],
        SPAM: [429, { error: 'rate_limited', message: 'Too many redemption attempts; try again later.', retry_after: 60 }],
        'WL-7KQXM3': [200, { outcome: 'invite', code: 'WL-7KQXM3', credits: 500, pending_verification: true, reward_id: '00000000-0000-4000-8000-000000000002' }],
        'WL-OWNOWN': [409, { error: 'own_code', message: 'You cannot redeem your own invite code.' }],
      };
      state.redeemed.at(-1).device = req.headers['x-worldlines-device'] ?? null;
      const [st, b] = answers[body.code] ?? [400, { error: 'invalid_code', message: 'This code is not valid (unknown, expired, disabled or used up).' }];
      return send(res, st, b);
    }
    // 邀请好友 (billing src/invite.mjs)
    if (url.pathname === '/v1/me/invite' && req.method === 'GET') return send(res, 200, { code: 'WL-ABCDEF', status: 'active', share_url: 'https://canvas.worldlines.gg/?invite=WL-ABCDEF', enabled: true, invitee_credits: 500, inviter_credits: 200, monthly_cap: 30, window_days: 7, stats: { invited: 2, played: 1, rewarded: 1, capped: 0, credits_earned: 200, credits_claimed: 0, credits_pending: 200, rewarded_this_month: 1, remaining_this_month: 29 }, redeemed: null, can_redeem: true });
    if (url.pathname === '/v1/me/milestones' && req.method === 'POST') {
      (state.milestones ??= []).push(body);
      return send(res, 200, { kind: body.kind, first: state.milestones.length === 1, first_at: '2026-10-03T00:00:00.000Z', invite: 'rewarded' });
    }
    if (url.pathname === '/v1/me/rewards' && req.method === 'GET') return send(res, 200, { rewards: [
      { id: '00000000-0000-4000-8000-000000000001', kind: 'invite', ref: 'invitee:x', credits: 200, state: state.claimed ? 'claimed' : 'claimable', status: state.claimed ? 'claimed' : 'pending', progress: null, expires_at: null, created_at: '2026-10-03T00:00:00.000Z', claimed_at: null },
      { id: '00000000-0000-4000-8000-000000000002', kind: 'invite_welcome', credits: 500, state: 'pending_verification', status: 'pending_verification', progress: { calls: 7, need: 20, ending_needed: true, ending: false }, expires_at: '2026-10-10T00:00:00.000Z', created_at: '2026-10-03T00:00:00.000Z', claimed_at: null },
      // an older billing: no state / progress, the legacy status only
      { id: '00000000-0000-4000-8000-000000000003', kind: 'trial_rest', credits: 1000, status: 'pending_verification', created_at: '2026-10-03T00:00:00.000Z', claimed_at: null },
    ] });
    const rewardClaim = /^\/v1\/me\/rewards\/([0-9a-f-]{36})\/claim$/.exec(url.pathname);
    if (rewardClaim && req.method === 'POST') {
      state.rewardClaimDevices = [...(state.rewardClaimDevices ?? []), req.headers['x-worldlines-device'] ?? null];
      if (state.claimed) return send(res, 409, { error: 'already_claimed', message: 'This reward was already claimed.' });
      state.claimed = true;
      return send(res, 200, { reward: { id: rewardClaim[1], kind: 'invite', credits: 200, status: 'claimed', created_at: '2026-10-03T00:00:00.000Z', claimed_at: '2026-10-03T01:00:00.000Z' }, balance: null });
    }
    if (state.forbid) return send(res, 403, { error: 'insufficient_scope' });
    const pub = /^\/v1\/records\/livingcanvas\/review\/([^/]+)\/publish$/.exec(url.pathname);
    if (pub) {
      const r = rows.get(pub[1]);
      if (!r || r.owner !== uid) return send(res, 404, { error: 'not_found' });
      if (state.takenDown.has(pub[1])) return send(res, 409, { error: 'taken_down' });
      r.visibility = 'published';
      return send(res, 200, { id: pub[1], visibility: 'published' });
    }
    const m = /^\/v1\/records\/livingcanvas\/([a-z-]+)(?:\/([^/]+))?$/.exec(url.pathname);
    if (!m || !QUOTA[m[1]]) return send(res, 404, { error: 'unknown_collection' });
    const kind = m[1];
    const id = m[2] && decodeURIComponent(m[2]);
    const ifRev = Number(String(req.headers['if-match'] ?? '').replace(/"/g, '')) || null;
    if (!id && req.method === 'GET') {
      const where = [...url.searchParams].filter(([k]) => k.startsWith('where[')).map(([k, v]) => [k.slice(6, -1), v]);
      for (const [f] of where) if (!INDEX[kind].includes(f)) return send(res, 400, { error: 'invalid_where' });
      const order = url.searchParams.get('order') ?? '-updated_at';
      const list = [...rows].filter(([, r]) => r.kind === kind && r.owner === uid && !r.deleted && where.every(([f, v]) => String(r.body[f]) === v))
        .sort(([, a], [, b]) => (order === 'updated_at' ? a.updated_at - b.updated_at : b.updated_at - a.updated_at));
      return send(res, 200, { scope: 'mine', records: list.slice(0, Number(url.searchParams.get('limit') ?? 50)).map(([i, r]) => view(i, r)), next_cursor: null });
    }
    if (state.rateLimited && kind === 'review' && req.method !== 'GET' && req.method !== 'DELETE') return send(res, 429, { error: 'rate_limited', message: 'Too many livingcanvas/review writes; try again in 300 s.' });
    if (!id && req.method === 'POST') {
      const used = [...rows.values()].filter((r) => r.kind === kind && r.owner === uid && !r.deleted).length;
      if (used >= QUOTA[kind]) return send(res, 429, { error: 'quota_count_exceeded' });
      const rid = `r_${++n}`;
      rows.set(rid, { kind, owner: uid, body: body.body, rev: 1, updated_at: (clock += 1000) });
      return send(res, 201, view(rid, rows.get(rid)));
    }
    const r = rows.get(id);
    if (!r || r.deleted || r.owner !== uid) return send(res, 404, { error: 'not_found' });
    if (req.method === 'PUT') {
      if (state.raceOnce) { state.raceOnce = false; r.rev += 1; r.updated_at = (clock += 1000); } // another device wrote between our read and write
      if (ifRev !== r.rev) return send(res, 409, { error: 'rev_mismatch', rev: r.rev });
      Object.assign(r, { body: body.body, rev: r.rev + 1, updated_at: (clock += 1000) });
      return send(res, 200, view(id, r));
    }
    if (req.method === 'DELETE') {
      r.deleted = true;
      return send(res, 200, { id, deleted: true });
    }
    return send(res, 405, { error: 'method_not_allowed' });
  });
  return { server, rows, seen, state };
}

async function listen(server) {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${server.address().port}`;
}

async function stack(t, { token = async () => TOKEN, dataBase, guestToken } = {}) {
  const data = fakeData();
  const base = await listen(data.server);
  t.after(() => data.server.close());
  const ENVS = { AIRP_DATA_BASE: dataBase ?? base, AIRP_ID_BASE: base, AIRP_AI_BASE: `${base}/v1`, AIRP_BILLING_BASE: base, AIRP_CHRONICLE_BASE: base };
  const saved = Object.fromEntries(Object.keys(ENVS).map((k) => [k, process.env[k]]));
  Object.assign(process.env, ENVS);
  t.after(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
  const app = express();
  app.use(express.json());
  app.use('/api', createAccountDataRouter({ token, ...(guestToken ? { guestToken } : {}) }));
  const server = http.createServer(app);
  const local = await listen(server);
  t.after(() => server.close());
  const texts = [];
  const page = async (method, rel, body) => {
    const res = await fetch(`${local}/api${rel}`, { method, headers: body === undefined ? {} : { 'content-type': 'application/json', 'x-airp-settings': '1' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    texts.push(text);
    return { status: res.status, body: JSON.parse(text) };
  };
  return { data, page, texts, local };
}

test('signed out, no data scopes, unreachable: "not available", never an error; ratings need no account', async (t) => {
  const s = await stack(t, { token: async () => null });
  assert.deepEqual((await s.page('GET', '/account-data')).body, { ok: false, available: false, reason: 'signed_out' });
  assert.deepEqual((await s.page('PUT', '/account-data/favorites/whitechapel', { on: true })).body, { ok: false, available: false, reason: 'signed_out' });
  const r = await s.page('GET', '/account-data/ratings?worlds=whitechapel,../x');
  assert.deepEqual(r.body, { ok: true, available: true, ratings: { whitechapel: { count: 0, average: null } } });
  assert.equal(s.data.seen.at(-1).auth, null, 'the public stats go without a token');
  assert.equal(s.data.seen.at(-1).search, '?in=whitechapel', 'bad ids never travel');

  const scoped = await stack(t);
  scoped.data.state.forbid = true;
  assert.deepEqual((await scoped.page('GET', '/account-data')).body, { ok: false, available: false, reason: 'not_allowed' });

  const down = await stack(t, { dataBase: 'http://127.0.0.1:9' });
  assert.deepEqual((await down.page('GET', '/account-data')).body, { ok: false, available: false, reason: 'unreachable' });
});

test('settings: only the manifest fields travel; last write wins across devices', async (t) => {
  const s = await stack(t);
  assert.deepEqual(cleanSettings({ v: 9, apiKey: 'sk-live', locale: 'fr', voice: { musicVolume: 3, url: 'x' } }), { v: 1, voice: { musicVolume: 1 } });
  const first = await s.page('PUT', '/account-data/settings', { prefs: { locale: 'ja', apiKey: 'sk-live-123', performance: { preset: 'quality', effectsEnabled: true, remote: 'https://evil' }, voice: { ttsEnabled: false, voiceVolume: 0.333 } } });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const sent = s.data.seen.find((x) => x.method === 'POST').body.body;
  assert.deepEqual(sent, { v: 1, locale: 'ja', performance: { preset: 'quality', effectsEnabled: true }, voice: { ttsEnabled: false, voiceVolume: 0.33 } });
  assert.ok(!JSON.stringify(s.data.seen).includes('sk-live'), 'a key never leaves this computer');

  const [id] = [...s.data.rows.keys()];
  s.data.state.raceOnce = true; // another device writes between our read (rev 1) and our write: this write still wins
  const second = await s.page('PUT', '/account-data/settings', { prefs: { locale: 'en' } });
  assert.equal(second.status, 200);
  const puts = s.data.seen.filter((x) => x.method === 'PUT');
  assert.deepEqual(puts.map((x) => x.ifMatch), ['"1"', '"2"'], 'stale rev → retried at the rev the service reported');
  assert.deepEqual(s.data.rows.get(id).body, { v: 1, locale: 'en' });
  assert.equal(s.data.rows.size, 1, 'one record per account');

  const snap = await s.page('GET', '/account-data');
  assert.deepEqual(snap.body.settings.prefs, { v: 1, locale: 'en' });
  assert.ok(snap.body.settings.updatedAt);
});

test('favorites and reviews: one per world, ratings from the public stats', async (t) => {
  const s = await stack(t);
  assert.deepEqual((await s.page('PUT', '/account-data/favorites/whitechapel', { on: true })).body, { ok: true, available: true, favorite: true });
  await s.page('PUT', '/account-data/favorites/whitechapel', { on: true });
  await s.page('PUT', '/account-data/favorites/kirifu', { on: true });
  await s.page('PUT', '/account-data/favorites/kirifu', { on: false });
  assert.deepEqual((await s.page('GET', '/account-data')).body.favorites, ['whitechapel']);
  assert.equal((await s.page('PUT', '/account-data/favorites/a%20b', { on: true })).status, 400);

  assert.equal((await s.page('PUT', '/account-data/reviews/whitechapel', { rating: 6 })).status, 400);
  assert.equal((await s.page('PUT', '/account-data/reviews/whitechapel', { rating: 4, comment: 'x'.repeat(1001) })).status, 400);
  const r1 = await s.page('PUT', '/account-data/reviews/whitechapel', { rating: 4, comment: '  雾很好  ' });
  assert.deepEqual([r1.body.rating, r1.body.comment], [4, '雾很好']);
  await s.page('PUT', '/account-data/reviews/whitechapel', { rating: 5 });
  assert.equal([...s.data.rows.values()].filter((r) => r.kind === 'review' && !r.deleted).length, 1, 'updated in place');
  const snap = await s.page('GET', '/account-data');
  assert.deepEqual(snap.body.reviews.whitechapel.rating, 5);
  assert.equal(snap.body.reviews.whitechapel.comment, null, 'clearing the note removes it');
  assert.deepEqual((await s.page('GET', '/account-data/ratings?worlds=whitechapel')).body.ratings, { whitechapel: { count: 1, average: 5 } });
  await s.page('DELETE', '/account-data/reviews/whitechapel', {});
  assert.deepEqual((await s.page('GET', '/account-data')).body.reviews, {});
});

test('save summaries: upsert by save id, short fields, the oldest forgotten when full', async (t) => {
  const s = await stack(t);
  const put = (save, extra = {}) => s.page('PUT', `/account-data/saves/${save}`, { worldId: 'whitechapel', worldName: 'Whitechapel', scene: 'The morgue', turns: 3, text: '在白教堂玩到了停尸房', ...extra });
  const a = await put('whitechapel-jp-aaaa1111');
  assert.deepEqual(a.body.summary, { saveId: 'whitechapel-jp-aaaa1111', worldId: 'whitechapel', worldName: 'Whitechapel', scene: 'The morgue', turns: 3, text: '在白教堂玩到了停尸房', updatedAt: a.body.summary.updatedAt });
  await put('whitechapel-jp-aaaa1111', { turns: 4, text: 'y'.repeat(500) });
  const one = [...s.data.rows.values()].filter((r) => r.kind === 'save-summary');
  assert.equal(one.length, 1);
  assert.deepEqual([one[0].body.turns, [...one[0].body.text].length], [4, 200]);
  await put('s2');
  await put('s3');
  await put('s4'); // quota 3 here: the oldest (aaaa1111) goes
  const saves = (await s.page('GET', '/account-data')).body.saves.map((x) => x.saveId).sort();
  assert.deepEqual(saves, ['s2', 's3', 's4']);
  assert.equal((await s.page('PUT', '/account-data/saves/a%20b', { worldId: 'w' })).status, 400);
  assert.equal((await s.page('PUT', '/account-data/saves/s5', { worldId: '' })).status, 400);
});

test('comments are public at once; a taken-down one stays private; too many edits → 429; reports once per comment', async (t) => {
  const s = await stack(t);
  const r = await s.page('PUT', '/account-data/reviews/whitechapel', { rating: 4, comment: 'fog' });
  assert.deepEqual([r.body.public, r.body.takenDown], [true, false]);
  const [rid] = [...s.data.rows.keys()];
  assert.ok(s.data.seen.some((x) => x.method === 'POST' && x.path.endsWith(`/review/${rid}/publish`)));
  const again = await s.page('PUT', '/account-data/reviews/whitechapel', { rating: 5, comment: 'more fog' });
  assert.equal(s.data.seen.filter((x) => x.path.endsWith('/publish')).length, 1, 'already public: no second publish');
  assert.equal(again.body.public, true);

  const list = await s.page('GET', '/account-data/comments?world=whitechapel');
  assert.equal(list.body.comments.length, 1);
  const [c] = list.body.comments;
  assert.deepEqual([c.rating, c.comment, c.author, c.tag, c.mine], [5, 'more fog', null, 'a1b2', true], 'anonymous by default + data\'s per-world tag; mine by the review id');
  assert.ok(!JSON.stringify(list.body).includes('alice'), 'never the uid or email');
  assert.equal((await s.page('GET', '/account-data/comments?world=..%2Fx')).status, 400);

  s.data.state.takenDown.add(rid);
  s.data.rows.get(rid).visibility = 'private';
  const td = await s.page('PUT', '/account-data/reviews/whitechapel', { rating: 5, comment: 'edited after takedown' });
  assert.deepEqual([td.status, td.body.public, td.body.takenDown], [200, false, true]);

  s.data.state.rateLimited = true;
  const slow = await s.page('PUT', '/account-data/reviews/kirifu', { rating: 3 });
  assert.deepEqual([slow.status, slow.body.code], [429, 'rate_limited']);
  s.data.state.rateLimited = false;

  assert.equal((await s.page('POST', `/account-data/reports/${rid}`, { reason: 'because' })).status, 400);
  assert.deepEqual((await s.page('POST', `/account-data/reports/${rid}`, { reason: 'abuse', note: '  rude  ' })).body, { ok: true, available: true, reported: true });
  await s.page('POST', `/account-data/reports/${rid}`, { reason: 'spam' });
  const reports = [...s.data.rows.values()].filter((x) => x.kind === 'report');
  assert.deepEqual(reports.map((x) => x.body), [{ target: `livingcanvas/review/${rid}`, reason: 'abuse', note: 'rude' }], 'one report per comment per player');
});

test('announcements: platform + LivingCanvas, on now only, pinned first; one scope missing still shows the other', async (t) => {
  const s = await stack(t, { token: async () => null });
  const now = Date.now();
  const at = (ms) => new Date(now + ms).toISOString();
  s.data.state.announcements.platform = [
    { id: 'p1', body: { title: { zh: '维护' }, level: 'maintenance', starts_at: at(-3600e3), ends_at: at(3600e3) } },
    { id: 'p-old', body: { title: { en: 'Over' }, level: 'info', starts_at: at(-7200e3), ends_at: at(-60e3) } },
    { id: 'p-later', body: { title: { en: 'Soon' }, level: 'info', starts_at: at(3600e3) } },
  ];
  s.data.state.announcements.livingcanvas = [{ id: 'l1', body: { title: { ja: '新しい世界' }, body: { ja: '**白教堂**' }, level: 'important', starts_at: at(-60e3), pinned: true } }];
  const r = await s.page('GET', '/account-data/announcements');
  assert.deepEqual(r.body.announcements.map((a) => [a.id, a.level, a.pinned]), [['livingcanvas/l1', 'important', true], ['platform/p1', 'maintenance', false]]);
  s.data.state.announcements.livingcanvas = null;
  assert.deepEqual((await s.page('GET', '/account-data/announcements')).body.announcements.map((a) => a.id), ['platform/p1']);
  assert.deepEqual(cleanSettings({ dismissed: ['platform/p1', 'https://evil', 'livingcanvas/l1', 'platform/p1'] }).dismissed, ['platform/p1', 'livingcanvas/l1']);
});

test('a 401 refreshes the token once; the page never sees a token; localhost + header only', async (t) => {
  const calls = [];
  const s = await stack(t, { token: async (o) => { calls.push(o?.force === true); return o?.force ? TOKEN : 'tok-stale'; } });
  s.data.state.expired.add('tok-stale');
  const r = await s.page('GET', '/account-data');
  assert.equal(r.body.ok, true);
  assert.ok(calls.includes(true), 'refreshed on 401');
  assert.ok(s.texts.every((x) => !x.includes(TOKEN) && !x.includes('tok-stale')));
  const noHeader = await fetch(`${s.local}/api/account-data/favorites/whitechapel`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{"on":true}' });
  assert.equal(noHeader.status, 403, 'writes need X-AIRP-Settings');
  const proxied = await fetch(`${s.local}/api/account-data`, { headers: { 'x-forwarded-for': '203.0.113.9' } });
  assert.equal(proxied.status, 403, 'localhost only');
});

test('signed in through the session file (the default token source)', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-account-data-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const saved = process.env.AIRP_REMOTE_CONFIG;
  process.env.AIRP_REMOTE_CONFIG = path.join(dir, 'remote.json');
  t.after(() => { if (saved === undefined) delete process.env.AIRP_REMOTE_CONFIG; else process.env.AIRP_REMOTE_CONFIG = saved; });
  await fs.writeFile(process.env.AIRP_REMOTE_CONFIG, JSON.stringify({
    auth: { provider: 'worldlines', issuer: 'https://auth.example.test' },
    session: { accessToken: TOKEN, refreshToken: 'r', expiresAt: Date.now() + 10 * 60_000, uid: 'alice', email: null },
  }));
  const s = await stack(t, { token: undefined });
  const r = await s.page('PUT', '/account-data/favorites/whitechapel', { on: true });
  assert.equal(r.body.ok, true, JSON.stringify(r.body));
  assert.equal(s.data.seen.at(-1).auth, `Bearer ${TOKEN}`);
});

test('the private note stays out of the public view; anonymous unless the player sets a nickname (never the account name)', async (t) => {
  const s = await stack(t);
  const r = await s.page('PUT', '/account-data/reviews/kirifu', { rating: 4, comment: 'mist', note: 'remember the lighthouse' });
  assert.equal(r.body.note, 'remember the lighthouse');
  const rec = [...s.data.rows.values()].find((x) => x.kind === 'review');
  assert.deepEqual([rec.body.note, rec.body.author_name], ['remember the lighthouse', undefined], 'no name is ever written into the review');
  let pub = (await s.page('GET', '/account-data/comments?world=kirifu')).body;
  assert.ok(!JSON.stringify(pub).includes('lighthouse') && pub.comments[0].author === null);
  assert.ok(!s.data.seen.some((x) => x.path === '/v1/me'), 'the account display name is never looked up');
  assert.equal((await s.page('GET', '/account-data')).body.reviews.kirifu.note, 'remember the lighthouse', 'the author sees it');

  for (const bad of ['a@b.c', 'go https://x', 'shop.com', 'y'.repeat(21)]) assert.deepEqual((await s.page('PUT', '/account-data/profile', { nickname: bad })).body.code, 'invalid_nickname', bad);
  assert.deepEqual((await s.page('PUT', '/account-data/profile', { nickname: '  霧の旅人  ' })).body.nickname, '霧の旅人');
  await s.page('PUT', '/account-data/profile', { nickname: '霧の人' });
  assert.equal([...s.data.rows.values()].filter((x) => x.kind === 'profile' && !x.deleted).length, 1, 'one profile, updated');
  assert.equal((await s.page('GET', '/account-data')).body.nickname, '霧の人');
  pub = (await s.page('GET', '/account-data/comments?world=kirifu')).body;
  assert.equal(pub.comments[0].author, '霧の人', 'shown on the existing comment');
  assert.deepEqual((await s.page('PUT', '/account-data/profile', { nickname: '' })).body.nickname, null);
  assert.equal((await s.page('GET', '/account-data/comments?world=kirifu')).body.comments[0].author, null, 'cleared: anonymous again');
});

test('likes, play counts and ratings per world; usage + wallet; turns reported to chronicle', async (t) => {
  const s = await stack(t);
  assert.deepEqual((await s.page('PUT', '/account-data/likes/whitechapel', { on: true })).body.liked, true);
  await s.page('PUT', '/account-data/likes/whitechapel', { on: true });
  assert.deepEqual((await s.page('GET', '/account-data')).body.likes, ['whitechapel']);
  s.data.state.plays = { 'livingcanvas/world/whitechapel-jp': { playthroughs: 40, players: 12 }, 'livingcanvas/world/whitechapel': { playthroughs: 2, players: 6 } };
  const st = (await s.page('GET', '/account-data/world-stats?worlds=whitechapel,kirifu&refs=whitechapel:whitechapel|whitechapel-jp|whitechapel-zh,kirifu:kirifu')).body.stats;
  assert.deepEqual(st.whitechapel, { rating: { count: 0, average: null }, likes: 1, plays: 42, players: 18, opens: null, tokens: null });
  assert.deepEqual([st.kirifu.likes, st.kirifu.plays], [0, null], 'under 5 players: no number');
  // 「总打开次数 / 总消耗 token 数」: summed over the editions chronicle answered for; tokens only where known
  s.data.state.activity = { 'whitechapel-jp': { opens: 1200, tokens: 1_000_000 }, whitechapel: { opens: 34, tokens: null }, kirifu: { opens: 0, tokens: null } };
  const act = (await s.page('GET', '/account-data/world-stats?worlds=whitechapel,kirifu&refs=whitechapel:whitechapel|whitechapel-jp|whitechapel-zh,kirifu:kirifu')).body.stats;
  assert.deepEqual([act.whitechapel.opens, act.whitechapel.tokens], [1234, 1_000_000]);
  assert.deepEqual([act.kirifu.opens, act.kirifu.tokens], [0, null], 'published, nobody opened it yet; no token data');
  s.data.state.activityDown = true;
  const down = (await s.page('GET', '/account-data/world-stats?worlds=whitechapel&refs=whitechapel:whitechapel')).body.stats.whitechapel;
  assert.deepEqual([down.likes, down.opens, down.tokens], [1, null, null], 'chronicle down: the rest still answers');
  s.data.state.activityDown = false;
  await s.page('PUT', '/account-data/likes/whitechapel', { on: false });
  assert.equal((await s.page('GET', '/account-data/world-stats?worlds=whitechapel')).body.stats.whitechapel.likes, 0);

  const u = (await s.page('GET', '/account-data/usage')).body.usage;
  assert.deepEqual(u, { plan: 'free', today: { tokens: 3400, usd: 0.012 }, month: { tokens: 98000, usd: 0.4 }, wallet: { pointName: 'credits', available: 12.5, usedToday: 0.3, resetsAt: '2026-10-03T00:00:00Z', daily: { allowance: 250, claimed: 0, claimable: true, resetsAt: '2026-10-03T00:00:00Z' } }, membership: null });
  // a 体验会员 (redemption code): billing's membership carries the trial's end
  s.data.state.sub = { plan: 'story', status: 'active', source: 'code', trial_ends_at: '2026-11-01T03:00:00.000Z', stripe_managed: false };
  assert.deepEqual((await s.page('GET', '/account-data/usage')).body.usage.membership, { plan: 'story', source: 'code', trialEndsAt: '2026-11-01T03:00:00.000Z', endsAt: null });
  // canceled in the Stripe portal (newer API: cancel_at): runs to cancel_at, won't renew → endsAt
  s.data.state.sub = { plan: 'story', status: 'active', source: 'stripe', trial_ends_at: null, current_period_end: '2026-11-05T18:09:12.000Z', cancel_at_period_end: true, cancel_at: '2026-11-05T18:09:12.000Z', ends_at: '2026-11-05T18:09:12.000Z', stripe_managed: true };
  assert.deepEqual((await s.page('GET', '/account-data/usage')).body.usage.membership, { plan: 'story', source: 'stripe', trialEndsAt: null, endsAt: '2026-11-05T18:09:12.000Z' });
  // an older billing (no cancel_at): the period end
  s.data.state.sub = { plan: 'story', status: 'active', source: 'stripe', current_period_end: '2026-11-05T18:09:12.000Z', cancel_at_period_end: true, stripe_managed: true };
  assert.equal((await s.page('GET', '/account-data/usage')).body.usage.membership.endsAt, '2026-11-05T18:09:12.000Z');
  // renews (resumed): nothing
  s.data.state.sub = { plan: 'story', status: 'active', source: 'stripe', current_period_end: '2026-11-05T18:09:12.000Z', cancel_at_period_end: false, cancel_at: null, ends_at: null, stripe_managed: true };
  assert.equal((await s.page('GET', '/account-data/usage')).body.usage.membership.endsAt, null);
  s.data.state.sub = null;

  assert.equal((await s.page('POST', '/account-data/turns', { saveId: 'whitechapel-jp-aaaa', worldRef: 'whitechapel-jp', worldName: 'ホワイトチャペル' })).body.reported, true);
  await s.page('POST', '/account-data/turns', { saveId: 'whitechapel-jp-aaaa', worldRef: 'whitechapel-jp' });
  const [first, second] = s.data.state.chronicle;
  assert.deepEqual(first.events.map((e) => e.type), ['playthrough.ensure', 'session.start', 'run.begin', 'run.commit']);
  assert.deepEqual([first.product, first.events[0].world_ref, first.events[0].meta.world_title, first.events[1].client, first.auth], ['livingcanvas', 'livingcanvas/world/whitechapel-jp', 'ホワイトチャペル', 'web', `Bearer ${TOKEN}`]);
  assert.deepEqual(second.events.map((e) => e.type), ['run.begin', 'run.commit'], 'the playthrough and session once per save per process');
  assert.notEqual(first.events[2].run_id, second.events[0].run_id);
  assert.equal((await s.page('POST', '/account-data/turns', { saveId: '../x', worldRef: 'w' })).status, 400);
  // a world opened → one world.open per call with a fresh open id (chronicle folds 30-minute reopens)
  assert.equal((await s.page('POST', '/account-data/opens', { worldRef: 'whitechapel-jp' })).body.reported, true);
  await s.page('POST', '/account-data/opens', { worldRef: 'whitechapel-jp' });
  const opens = s.data.state.chronicle.slice(-2);
  assert.deepEqual(opens.map((b) => b.events.map((e) => [e.type, e.world_ref, e.client])), [[['world.open', 'livingcanvas/world/whitechapel-jp', 'web']], [['world.open', 'livingcanvas/world/whitechapel-jp', 'web']]]);
  assert.notEqual(opens[0].events[0].open_id, opens[1].events[0].open_id);
  assert.match(opens[0].events[0].open_id, /^[A-Za-z0-9._-]{1,128}$/);
  assert.equal(opens[0].auth, `Bearer ${TOKEN}`);
  assert.equal((await s.page('POST', '/account-data/opens', { worldRef: '../x' })).status, 400);
});

test('redemption codes: the account token goes to billing /v1/me/redeem; outcomes and refusals come back for the panel', async (t) => {
  const s = await stack(t);
  const ok = await s.page('POST', '/account-data/redeem', { code: ' PLAYTEST-7KQX-M3TB ', locale: 'zh-CN' });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.redeemed, { outcome: 'trial_started', code: 'PLAYTEST-7KQX-M3TB', plan: 'story', endsAt: '2026-11-01T03:00:00.000Z', credits: 100, alreadyMember: false, pendingVerification: false, rewardId: null });
  const sent = s.data.state.redeemed.at(-1);
  assert.deepEqual(sent.body, { code: 'PLAYTEST-7KQX-M3TB', locale: 'zh' }, 'trimmed; the billing locale');
  assert.equal(sent.auth, `Bearer ${TOKEN}`, 'the account token, never anything from the page');
  assert.deepEqual((await s.page('POST', '/account-data/redeem', { code: 'GIFT', locale: 'ja' })).body.redeemed, { outcome: 'credits_only', code: 'GIFT', plan: 'vivid', endsAt: null, credits: 300, alreadyMember: true, pendingVerification: false, rewardId: null });
  for (const [code, status, reason] of [['nope', 400, 'invalid_code'], ['USED', 409, 'already_redeemed'], ['SPAM', 429, 'rate_limited']]) {
    const r = await s.page('POST', '/account-data/redeem', { code });
    assert.deepEqual([r.status, r.body.ok, r.body.code], [status, false, reason], code);
  }
  const empty = await s.page('POST', '/account-data/redeem', { code: '   ' });
  assert.deepEqual([empty.status, empty.body.code], [400, 'invalid_code']);
  assert.equal(s.data.state.redeemed.length, 5, 'an empty code never leaves this server');
});

test('free tiers (billing 0008): newcomer day n/8 and the regular amount pass through; a paid plan is none; a bogus tier is dropped', async (t) => {
  const s = await stack(t);
  const daily = async () => (await s.page('GET', '/account-data/usage')).body.usage.wallet.daily;
  s.data.state.tier = { tier: 'newcomer', regular_mc: 50000, newcomer_day: 3, newcomer_days: 8, newcomer_ends_at: '2026-10-09T12:00:00.000Z' };
  assert.deepEqual(await daily(), { allowance: 250, claimed: 0, claimable: true, resetsAt: '2026-10-03T00:00:00Z', tier: 'newcomer', regular: 50, newcomerDay: 3, newcomerDays: 8 });
  s.data.state.tier = { tier: 'regular', regular_mc: 50000 };
  assert.deepEqual(await daily(), { allowance: 250, claimed: 0, claimable: true, resetsAt: '2026-10-03T00:00:00Z', tier: 'regular', regular: 50 });
  s.data.state.tier = { tier: 'weird', newcomer_day: 1, newcomer_days: 8 };
  assert.equal('tier' in (await daily()), false);
});

test('「领取今日额度」: the account token claims the shared worldlines wallet (billing POST /v1/claims/worldlines/daily); status before / after; a second press is duplicated; refusals keep billing\'s code', async (t) => {
  const s = await stack(t);
  assert.deepEqual((await s.page('GET', '/account-data/usage')).body.usage.wallet.daily, { allowance: 250, claimed: 0, claimable: true, resetsAt: '2026-10-03T00:00:00Z' });
  const ok = await s.page('POST', '/account-data/claim-daily', {});
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.claimed, { credits: 250, duplicated: false, available: 262.5, daily: { allowance: 250, claimed: 250, claimable: false, resetsAt: '2026-10-03T00:00:00Z' } });
  const sent = s.data.state.claims.at(-1);
  assert.deepEqual(sent, { auth: `Bearer ${TOKEN}`, product: 'worldlines' }, 'the account token, the shared wallet');
  assert.equal((await s.page('GET', '/account-data/usage')).body.usage.wallet.daily.claimable, false);
  assert.equal((await s.page('POST', '/account-data/claim-daily', {})).body.claimed.duplicated, true);
  s.data.state.claimRefuse = true;
  const no = await s.page('POST', '/account-data/claim-daily', {});
  assert.deepEqual([no.status, no.body.ok, no.body.code], [409, false, 'nothing_to_claim']);
  // writes need X-AIRP-Settings: 1 like every other account-data write
  const raw = await fetch(`${s.local}/api/account-data/claim-daily`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(raw.status, 403);
});

test('新手礼包: claim-newcomer → billing POST /v1/claims/worldlines/newcomer with the account token + device; created once, then duplicated; billing\'s cap refusal keeps its code', async (t) => {
  const s = await stack(t);
  const DEV = 'a1b2c3d4e5f6a7b8c9d0e1f2';
  const ok = await s.page('POST', '/account-data/claim-newcomer', { device: DEV });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual(ok.body.gift, { credits: 500, created: true, expiresAt: '2026-11-04T03:00:00.000Z', available: 500 });
  assert.deepEqual(s.data.state.gifts.at(-1), { auth: `Bearer ${TOKEN}`, product: 'worldlines', device: DEV });
  assert.equal((await s.page('POST', '/account-data/claim-newcomer', {})).body.gift.created, false);
  s.data.state.giftLimited = true;
  const no = await s.page('POST', '/account-data/claim-newcomer', { device: DEV });
  assert.deepEqual([no.status, no.body.ok, no.body.code], [429, false, 'claim_limited']);
});

test('invites: the code + link + numbers, invite codes through the redeem field (device header), first ending, claimable rewards', async (t) => {
  const s = await stack(t);
  const inv = await s.page('GET', '/account-data/invite');
  assert.equal(inv.status, 200, JSON.stringify(inv.body));
  assert.deepEqual([inv.body.invite.code, inv.body.invite.shareUrl, inv.body.invite.inviteeCredits, inv.body.invite.inviterCredits, inv.body.invite.monthlyCap], ['WL-ABCDEF', 'https://canvas.worldlines.gg/?invite=WL-ABCDEF', 500, 200, 30]);
  assert.deepEqual(inv.body.invite.stats, { invited: 2, played: 1, rewarded: 1, creditsEarned: 200, creditsPending: 200, remainingThisMonth: 29 });
  const r = await s.page('POST', '/account-data/redeem', { code: 'WL-7KQXM3', locale: 'ko', device: 'dev-0123456789abcdef' });
  // the invitee's 500 is a pending reward now (unlocks after real play), not credits added at redeem
  assert.deepEqual(r.body.redeemed, { outcome: 'invite', code: 'WL-7KQXM3', plan: null, endsAt: null, credits: 500, alreadyMember: false, pendingVerification: true, rewardId: '00000000-0000-4000-8000-000000000002' });
  assert.equal(s.data.state.redeemed.at(-1).device, 'dev-0123456789abcdef', 'the device id goes to billing as X-Worldlines-Device');
  await s.page('POST', '/account-data/redeem', { code: 'WL-OWNOWN', device: 'bad device!' });
  assert.equal(s.data.state.redeemed.at(-1).device, null, 'a malformed device id is dropped');
  const own = await s.page('POST', '/account-data/redeem', { code: 'WL-OWNOWN' });
  assert.deepEqual([own.status, own.body.code], [409, 'own_code']);
  const m = await s.page('POST', '/account-data/milestones', { kind: 'first_clear', world: 'last-train', ending: 'terminus', evil: 'x' });
  assert.deepEqual([m.body.reported, m.body.first, m.body.invite], [true, true, 'rewarded']);
  assert.deepEqual(s.data.state.milestones.at(-1), { kind: 'first_clear', world: 'last-train', ending: 'terminus' });
  assert.equal((await s.page('POST', '/account-data/milestones', { kind: 'everything' })).status, 400);
  const list = await s.page('GET', '/account-data/rewards');
  assert.deepEqual(list.body.rewards.map((x) => [x.kind, x.credits, x.state, x.status]), [
    ['invite', 200, 'claimable', 'pending'],
    ['invite_welcome', 500, 'pending_verification', 'pending_verification'],
    ['trial_rest', 1000, 'pending_verification', 'pending_verification'],
  ]);
  assert.deepEqual(list.body.rewards[1].progress, { calls: 7, need: 20, endingNeeded: true, ending: false });
  assert.equal(list.body.rewards[1].expiresAt, '2026-10-10T00:00:00.000Z');
  assert.deepEqual([list.body.rewards[0].progress, list.body.rewards[2].progress, list.body.rewards[2].expiresAt], [null, null, null]);
  const c = await s.page('POST', `/account-data/rewards/${list.body.rewards[0].id}/claim`, {});
  assert.equal(c.body.reward?.status, 'claimed', JSON.stringify(c));
  const again = await s.page('POST', `/account-data/rewards/${list.body.rewards[0].id}/claim`, {});
  assert.deepEqual([again.status, again.body.code], [409, 'already_claimed']);
  assert.equal((await s.page('POST', '/account-data/rewards/not-an-id/claim', {})).status, 400);
});

test('free claims carry the page device id to billing (per-device claim cap); a malformed id is dropped', async (t) => {
  const s = await stack(t);
  const DEV = 'a1b2c3d4e5f6a7b8c9d0e1f2';
  await s.page('POST', '/account-data/claim-daily', { device: DEV });
  assert.equal(s.data.state.claims.at(-1).device, DEV);
  await s.page('POST', '/account-data/claim-daily', { device: 'bad id!' });
  assert.equal(s.data.state.claims.at(-1).device, undefined);
  const list = await s.page('GET', '/account-data/rewards');
  const id = list.body.rewards[0].id;
  await s.page('POST', `/account-data/rewards/${id}/claim`, { device: DEV });
  await s.page('POST', `/account-data/rewards/${id}/claim`, {});
  assert.deepEqual(s.data.state.rewardClaimDevices, [DEV, null]);
});

test('rewards: state from billing, else from the legacy status; progress and expiry mapped, junk dropped', () => {
  const at = (row) => rewardOf({ id: 'r', kind: 'invite', credits: 200, ...row });
  assert.deepEqual([at({ status: 'pending' }).state, at({ status: 'pending' }).status], ['claimable', 'pending']);
  for (const st of ['pending_verification', 'claimed', 'revoked', 'expired']) assert.equal(at({ status: st }).state, st);
  assert.equal(at({ state: 'pending_verification', status: 'pending' }).state, 'pending_verification', 'state wins over status');
  assert.equal(at({ state: 'claimable' }).status, 'pending');
  assert.deepEqual(at({ state: 'pending_verification', progress: { calls: 3, need: 10, ending_needed: false, ending: false } }).progress, { calls: 3, need: 10, endingNeeded: false, ending: false });
  assert.deepEqual(at({ progress: { calls: 'x', need: null } }).progress, { calls: 0, need: 0, endingNeeded: false, ending: false });
  assert.equal(at({ progress: 'nope' }).progress, null);
  assert.equal(at({ expires_at: 7 }).expiresAt, null);
});

test('usage events (改进产品): a signed-in batch goes to chronicle /v1/events with the account token; envelope checked; signed out = not available', async (t) => {
  const s = await stack(t);
  const batch = { product: 'whatever', session_id: 'abcdefghijklmnopqrstuv', app_version: 'r1', locale: 'zh', events: [{ name: 'lobby_view', at: 1 }] };
  const ok = await s.page('POST', '/account-data/events', batch);
  assert.equal(ok.status, 200);
  assert.deepEqual([ok.body.available, ok.body.status, ok.body.accepted], [true, 202, 1]);
  const sent = s.data.state.usage.at(-1);
  assert.equal(sent.auth, `Bearer ${TOKEN}`);
  assert.equal(sent.body.product, 'livingcanvas', 'the product is fixed here');
  assert.deepEqual(sent.body.events, batch.events, 'events pass through unchanged');
  s.data.state.usageStatus = 429;
  assert.equal((await s.page('POST', '/account-data/events', batch)).body.status, 429, 'chronicle\'s status comes back for the page');
  for (const bad of [{ ...batch, events: [] }, { ...batch, events: Array(51).fill(batch.events[0]) }, { ...batch, extra: 1 }, { events: batch.events }]) {
    assert.equal((await s.page('POST', '/account-data/events', bad)).status, 400);
  }
  assert.equal((await s.page('POST', '/account-data/events', { ...batch, events: Array(50).fill({ name: 'error', props: { message: 'x'.repeat(1500) } }) })).status, 413);
  const out = await stack(t, { token: async () => null });
  assert.deepEqual((await out.page('POST', '/account-data/events', batch)).body, { ok: false, available: false, reason: 'signed_out' });
});

const logEntry = (id, scope, surfaces, day, extra = {}) => ({ id, scope, category: 'world-update', title: { zh: `标题${id}`, ko: `제목${id}` }, body: { en: 'b' }, surfaces, platforms: ['livingcanvas'], published_at: `2026-10-${String(day).padStart(2, '0')}T00:00:00Z`, links: [{ url: 'javascript:alert(1)' }, { url: 'world:whitechapel', label: 'go' }], ...extra });

test('日志: a world\'s latest three (platform livingcanvas, surface world, four languages); never in the announcements', async (t) => {
  clearLogCache();
  const s = await stack(t, { token: async () => null });
  const none = await s.page('GET', '/account-data/logs?world=whitechapel'); assert.deepEqual([none.status, none.body.logs ?? []], [200, []], 'data without logs yet: nothing, never an error');
  const log = logEntry;
  s.data.state.logs = [log('w4', 'world:whitechapel', ['world'], 4), log('w3', 'world:whitechapel', ['world'], 3), log('w2', 'world:whitechapel', ['world'], 2), log('w1', 'world:whitechapel', ['world'], 1), log('l1', 'livingcanvas', ['lobby'], 5), log('site', 'platform', ['website'], 6), log('bad', 'world:whitechapel', ['world'], 1, { title: {} })];
  const r = await s.page('GET', '/account-data/logs?world=whitechapel');
  assert.deepEqual(r.body.logs.map((l) => l.id), ['w4', 'w3', 'w2']);
  assert.deepEqual([r.body.logs[0].title, r.body.logs[0].links, r.body.logs[0].category], [{ zh: '标题w4', ko: '제목w4' }, [{ url: 'world:whitechapel', label: 'go' }], 'world-update']);
  assert.match(s.data.state.logQueries.at(-1), /^\?platform=livingcanvas&scope=world%3Awhitechapel&surface=world&limit=3$/);
  assert.equal((await s.page('GET', '/account-data/logs?world=../x')).status, 400);
  const ann = await s.page('GET', '/account-data/announcements');
  assert.deepEqual(ann.body.announcements, [], 'lobby logs live in the 「日志」 tab now, not in the announcements');
});

test('日志 banners: platform=livingcanvas&banner=active, window checked again, pinned first, ETag / 304, kept while data is down', async (t) => {
  clearLogCache();
  const s = await stack(t, { token: async () => null });
  const now = Date.now();
  const at = (ms) => new Date(now + ms).toISOString();
  s.data.state.announcements.platform = [{ id: 'p1', body: { title: { zh: '旧公告' }, level: 'maintenance', starts_at: at(-3600e3) } }];
  s.data.state.logs = [
    logEntry('b-info', 'livingcanvas', [], 6, { banner: { level: 'info', starts_at: at(-7200e3), ends_at: at(3600e3) } }),
    logEntry('b-pin', 'platform', [], 5, { banner: { level: 'important', starts_at: at(-3600e3), pinned: true, link_url: 'world:whitechapel' }, image_url: 'https://worldlines.gg/x.webp' }),
    logEntry('b-over', 'livingcanvas', [], 7, { banner: { level: 'maintenance', starts_at: at(-7200e3), ends_at: at(-60e3) } }),
    logEntry('b-later', 'livingcanvas', [], 7, { banner: { level: 'maintenance', starts_at: at(3600e3) } }),
    logEntry('b-site', 'platform', [], 7, { platforms: ['worldlines-gg'], banner: { level: 'important', starts_at: at(-60e3) } }),
    logEntry('b-badlink', 'livingcanvas', [], 3, { banner: { level: 'info', starts_at: at(-60e3), link_url: 'javascript:alert(1)' } }),
    logEntry('plain', 'livingcanvas', ['lobby'], 8),
  ];
  s.data.state.staleBanners = true; // a cached answer that still lists an ended one
  const r = await s.page('GET', '/account-data/announcements');
  assert.deepEqual(r.body.announcements.map((a) => [a.id, a.level, a.pinned, a.source, a.linkUrl ?? null]), [
    ['log/b-pin', 'important', true, 'log', 'world:whitechapel'],
    ['log/b-badlink', 'info', false, 'log', null],
    ['log/b-info', 'info', false, 'log', null],
  ]);
  assert.equal(r.body.announcements[0].imageUrl, 'https://worldlines.gg/x.webp');
  assert.match(s.data.state.logQueries.at(-1), /^\?platform=livingcanvas&banner=active&limit=50$/);
  assert.ok(!s.data.seen.some((x) => x.path.endsWith('/announcement')), 'v5: the old announcements are not read');
  // unchanged: asked with If-None-Match, 304, same answer
  const again = await s.page('GET', '/account-data/announcements');
  assert.ok(s.data.state.logConditional.at(-1)?.startsWith('"'), 'If-None-Match sent');
  assert.deepEqual(again.body.announcements.map((a) => a.id), ['log/b-pin', 'log/b-badlink', 'log/b-info']);
  // data down: the last answer (window checked again); offline from the start: "not available", no error
  s.data.state.logsDown = true;
  assert.deepEqual((await s.page('GET', '/account-data/announcements')).body.announcements.map((a) => a.id), ['log/b-pin', 'log/b-badlink', 'log/b-info']);
  clearLogCache();
  assert.deepEqual((await s.page('GET', '/account-data/announcements')).body, { ok: false, available: false, reason: 'unreachable' });
});

test('日志 banners: an older data (logs 404, or v4 without next_before) → the old announcements; a migrated ann-… never shows twice', async (t) => {
  clearLogCache();
  const s = await stack(t, { token: async () => null });
  const now = Date.now();
  const at = (ms) => new Date(now + ms).toISOString();
  s.data.state.announcements.platform = [{ id: 'p1', body: { title: { zh: '旧公告' }, level: 'maintenance', starts_at: at(-3600e3) } }];
  s.data.state.announcements.livingcanvas = [];
  const ids = async () => (await s.page('GET', '/account-data/announcements')).body.announcements.map((a) => [a.id, a.source]);
  assert.deepEqual(await ids(), [['platform/p1', 'announcement']], 'logs 404');
  s.data.state.logs = [logEntry('ann-platform-p1', 'platform', [], 1, { banner: { level: 'maintenance', starts_at: at(-3600e3) } })];
  s.data.state.logsVersion = 4;
  assert.deepEqual(await ids(), [['platform/p1', 'announcement']], 'v4 ignores banner=: not a v5 answer');
  s.data.state.logsVersion = 5;
  assert.deepEqual(await ids(), [['log/ann-platform-p1', 'log']], 'v5: the migrated copy only');
  assert.deepEqual(dedupeAnnouncements([{ id: 'platform/p1' }, { id: 'log/ann-platform-p1' }, { id: 'livingcanvas/l1' }, { id: 'log/ann-livingcanvas-l2' }, { id: 'log/ann-platform-p1' }]).map((a) => a.id), ['log/ann-platform-p1', 'livingcanvas/l1', 'log/ann-livingcanvas-l2']);
});

test('日志 tab: platform=livingcanvas (no surface filter), ten a page, before = next_before; v4 has one page; a bad before is refused', async (t) => {
  clearLogCache();
  const s = await stack(t, { token: async () => null });
  assert.deepEqual((await s.page('GET', '/account-data/logs')).body, { ok: true, available: true, logs: [], nextBefore: null }, 'no logs on this data: empty');
  s.data.state.logs = [...Array.from({ length: 12 }, (_, i) => logEntry(`l${i + 1}`, 'livingcanvas', ['lobby'], i + 1)), logEntry('w', 'world:whitechapel', ['world'], 20), logEntry('other', 'livingcanvas', ['lobby'], 21, { platforms: ['hub'] })].reverse();
  const p1 = await s.page('GET', '/account-data/logs');
  assert.deepEqual([p1.body.logs.map((l) => l.id), p1.body.nextBefore], [['w', 'l12', 'l11', 'l10', 'l9', 'l8', 'l7', 'l6', 'l5', 'l4'], '2026-10-04T00:00:00Z']);
  assert.match(s.data.state.logQueries.at(-1), /^\?platform=livingcanvas&limit=10$/);
  const p2 = await s.page('GET', `/account-data/logs?before=${encodeURIComponent(p1.body.nextBefore)}`);
  assert.deepEqual([p2.body.logs.map((l) => l.id), p2.body.nextBefore], [['l3', 'l2', 'l1'], null]);
  assert.equal((await s.page('GET', '/account-data/logs?before=yesterday')).status, 400);
  s.data.state.logsVersion = 4;
  clearLogCache();
  const v4 = await s.page('GET', '/account-data/logs');
  assert.equal(v4.body.nextBefore, null);
  assert.deepEqual((await s.page('GET', '/account-data/logs?before=2026-10-04T00:00:00Z')).body.logs, [], 'v4 ignores before: never the same page twice');
});

test('报告问题 / 卡住了: the manifest\'s fields only, as the account; signed out → the guest-trial session; neither → signed_out', async (t) => {
  const s = await stack(t);
  const sent = await s.page('POST', '/account-data/feedback', {
    kind: 'stuck', text: '  门打不开  ', world_id: 'last-train', edition: 'last-train-jp', place: 'world/platform', place_title: '月台',
    client_version: 'v2026.10.09', client_mode: 'browser', locale: 'zh-CN', errors: ['a'.repeat(32), 'bad', 'a'.repeat(32)],
    conversation: 'the whole chat', token: 'sk-secret',
  });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.deepEqual([sent.body.ok, sent.body.sent, sent.body.as], [true, true, 'account']);
  const row = [...s.data.rows.values()].find((x) => x.kind === 'bug-report');
  assert.deepEqual(row.body, { kind: 'stuck', text: '门打不开', world_id: 'last-train', edition: 'last-train-jp', place: 'world/platform', place_title: '月台', client_version: 'v2026.10.09', client_mode: 'browser', locale: 'zh-CN', errors: ['a'.repeat(32)] }, 'nothing but the manifest\'s fields; never the conversation or a key');
  assert.equal(row.owner, 'alice');
  assert.equal((await s.page('POST', '/account-data/feedback', { kind: 'complaint' })).status, 400);
  assert.equal((await s.page('POST', '/account-data/feedback', { kind: 'bug', text: 'x'.repeat(1001) })).status, 400);
  assert.equal((await s.page('POST', '/account-data/feedback', { kind: 'idea' }, )).status, 200, 'the kind alone is enough');
  assert.ok(!s.texts.some((x) => x.includes(TOKEN)), 'the page never sees a token');
  // no header = refused (like every write here)
  const bare = await fetch(`${s.local}/api/account-data/feedback`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'bug' }) });
  assert.equal(bare.status, 403);

  // signed out, but this device has a guest-trial session: sent as the guest, marked guest
  const g = await stack(t, { token: async () => null, guestToken: async () => GUEST_TOKEN });
  const asGuest = await g.page('POST', '/account-data/feedback', { kind: 'bug', text: '白屏', world_id: 'last-train' });
  assert.deepEqual([asGuest.body.ok, asGuest.body.as], [true, 'guest']);
  const grow = [...g.data.rows.values()].find((x) => x.kind === 'bug-report');
  assert.deepEqual([grow.owner, grow.body.guest], ['guest-1', true]);
  assert.equal(g.data.seen.findLast((x) => x.path === '/v1/records/livingcanvas/bug-report').auth, `Bearer ${GUEST_TOKEN}`);

  // signed out, no guest: "not available" (the sheet shows the contact channels)
  const none = await stack(t, { token: async () => null, guestToken: async () => null });
  assert.deepEqual((await none.page('POST', '/account-data/feedback', { kind: 'stuck' })).body, { ok: false, available: false, reason: 'signed_out' });
  // a data deploy without bug-report (manifest < v12): unreachable, not an error
  const old = await stack(t);
  delete QUOTA['bug-report'];
  try {
    assert.deepEqual((await old.page('POST', '/account-data/feedback', { kind: 'stuck' })).body, { ok: false, available: false, reason: 'unreachable' });
  } finally {
    QUOTA['bug-report'] = 200;
  }
});
