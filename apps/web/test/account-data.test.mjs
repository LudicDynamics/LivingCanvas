// lib/account-data.ts against a fake /api/account-data (the app's server; its own
// tests cover the data service side): local-only when signed out, changes made
// meanwhile replayed at sign-in, settings newest-wins without echo, save summaries
// at most once a minute per save, an account's mirror dropped at sign-out.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false, tryNative: true });
const { createAccountData, worldKeyOf, STORAGE_KEY } = await jiti.import('../src/lib/account-data.ts');

function fakeServer() {
  const s = { signedIn: false, favorites: new Set(), reviews: {}, saves: [], settings: null, calls: [], ratings: { whitechapel: { count: 3, average: 4.33 } }, review: { status: 200, takenDown: false }, comments: [], reports: [], likes: new Set(), turns: [], nickname: null };
  const json = (body) => ({ ok: true, status: 200, json: async () => body });
  s.fetch = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    s.calls.push({ method, url, body, settingsHeader: init.headers?.['x-airp-settings'] ?? null });
    const rel = url.replace('/api/account-data', '');
    let m;
    if (rel.startsWith('/ratings')) return json({ ok: true, available: true, ratings: Object.fromEntries(new URL(`http://x${rel}`).searchParams.get('worlds').split(',').map((w) => [w, s.ratings[w] ?? { count: 0, average: null }])) });
    if (rel.startsWith('/comments')) {
      const cursor = new URL(`http://x${rel}`).searchParams.get('cursor');
      return json({ ok: true, available: true, comments: cursor ? s.comments.slice(1) : s.comments.slice(0, 1), nextCursor: cursor || s.comments.length < 2 ? null : 'p2' });
    }
    if (rel.startsWith('/world-stats')) {
      const q = new URL(`http://x${rel}`).searchParams;
      return json({ ok: true, available: true, stats: Object.fromEntries(q.get('worlds').split(',').map((w) => [w, { rating: { count: 1, average: 5 }, likes: s.likes.has(w) ? 1 : 0, plays: (q.get('refs').split(',').find((x) => x.startsWith(`${w}:`)) ?? '').includes('whitechapel-jp') ? 42 : null, players: null }])) });
    }
    if (!s.signedIn) return json({ ok: false, available: false, reason: 'signed_out' });
    if ((m = /^\/likes\/(.+)$/.exec(rel))) { if (body.on) s.likes.add(m[1]); else s.likes.delete(m[1]); return json({ ok: true, available: true, liked: body.on }); }
    if (rel === '/profile') {
      if (body.nickname.includes('bad')) return { ok: false, status: 400, json: async () => ({ ok: false, available: true, code: 'content_refused' }) };
      s.nickname = body.nickname.trim() || null;
      return json({ ok: true, available: true, nickname: s.nickname });
    }
    if (rel === '/turns') { s.turns.push(body); return json({ ok: true, available: true, reported: true }); }
    if (rel === '/redeem') {
      s.redeems = [...(s.redeems ?? []), body];
      if (body.code === 'USED') return { ok: false, status: 409, json: async () => ({ ok: false, available: true, code: 'already_redeemed', error: 'You have already redeemed this code.' }) };
      if (body.code === 'DOWN') throw new Error('offline');
      return json({ ok: true, available: true, redeemed: { outcome: 'trial_started', code: body.code, plan: 'story', endsAt: '2026-11-01T03:00:00.000Z', credits: 0, alreadyMember: false } });
    }
    if (rel === '/claim-daily') {
      s.claims = (s.claims ?? 0) + 1;
      if (s.claimMode === 'refuse') return { ok: false, status: 409, json: async () => ({ ok: false, available: true, code: 'nothing_to_claim', error: 'This plan has no daily allowance for this product.' }) };
      if (s.claimMode === 'down') throw new Error('offline');
      return json({ ok: true, available: true, claimed: { credits: 250, duplicated: s.claims > 1, available: 262.5, daily: { allowance: 250, claimed: 250, claimable: false, resetsAt: '2026-10-03T12:00:00.000Z' } } });
    }
    if (rel === '/usage') return json({ ok: true, available: true, usage: { plan: 'free', today: { tokens: 10, usd: 0 }, month: { tokens: 20, usd: 0 }, wallet: null } });
    if ((m = /^\/reports\/(.+)$/.exec(rel))) { s.reports.push({ id: m[1], ...body }); return json({ ok: true, available: true, reported: true }); }
    if (rel === '' && method === 'GET') return json({ ok: true, available: true, settings: s.settings, favorites: [...s.favorites], likes: [...s.likes], nickname: s.nickname, reviews: s.reviews, saves: s.saves });
    if (rel === '/settings') { s.settings = { prefs: body.prefs, updatedAt: new Date(s.clock()).toISOString() }; return json({ ok: true, available: true, updatedAt: s.settings.updatedAt }); }
    if ((m = /^\/favorites\/(.+)$/.exec(rel))) { if (body.on) s.favorites.add(decodeURIComponent(m[1])); else s.favorites.delete(decodeURIComponent(m[1])); return json({ ok: true, available: true, favorite: body.on }); }
    if ((m = /^\/reviews\/(.+)$/.exec(rel))) {
      if (s.review.status === 429) return { ok: false, status: 429, json: async () => ({ ok: false, available: true, code: 'rate_limited' }) };
      if (body?.comment?.includes('加微信')) return { ok: false, status: 422, json: async () => ({ ok: false, available: true, code: 'content_refused' }) };
      if (method === 'DELETE') delete s.reviews[m[1]]; else s.reviews[m[1]] = { rating: body.rating, comment: body.comment ?? null, note: body.note ?? null, updatedAt: 'x' };
      return json({ ok: true, available: true, public: !s.review.takenDown, takenDown: s.review.takenDown });
    }
    if ((m = /^\/saves\/(.+)$/.exec(rel))) { s.saves = [...s.saves.filter((x) => x.saveId !== m[1]), { saveId: m[1], ...body, updatedAt: new Date(s.clock()).toISOString() }]; return json({ ok: true, available: true }); }
    return { ok: false, json: async () => ({ ok: false }) };
  };
  return s;
}

function setup({ storage = new Map(), prefs = { locale: 'en' } } = {}) {
  const server = fakeServer();
  let now = Date.parse('2026-10-02T10:00:00Z');
  server.clock = () => now;
  const timers = [];
  const applied = [];
  const env = {
    fetch: server.fetch,
    storage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) },
    now: () => now,
    readPrefs: () => prefs,
    applyPrefs: (p) => { applied.push(p); data.prefsChanged(); }, // applying fires the setters' own events: must not echo
    setTimeout: (fn, ms) => { const h = { fn, at: now + ms }; timers.push(h); return h; },
    clearTimeout: (h) => { const i = timers.indexOf(h); if (i >= 0) timers.splice(i, 1); },
  };
  const data = createAccountData(env);
  const tick = async (ms) => {
    now += ms;
    for (const h of [...timers].filter((x) => x.at <= now)) { timers.splice(timers.indexOf(h), 1); h.fn(); }
    await new Promise((r) => setTimeout(r, 0));
  };
  return { data, server, storage, applied, tick, setNow: (t) => { now = t; }, get now() { return now; } };
}

test('worldKeyOf: editions of a curated world share one key; a made world is itself', () => {
  assert.equal(worldKeyOf({ id: 'whitechapel-jp' }), 'whitechapel');
  assert.equal(worldKeyOf({ id: 'first-snow-zh' }), 'first-snow');
  assert.equal(worldKeyOf({ id: 'made-0000abcd-jp', workshop: {} }), 'made-0000abcd-jp');
});

test('signed out: everything works on this device; at sign-in the changes are sent, the account copy shown', async () => {
  const t = setup();
  await t.data.refresh();
  assert.equal(t.data.getState().sync, 'local');
  await t.data.toggleFavorite('whitechapel');
  await t.data.setReview('kirifu', 4, '  雾  ');
  assert.ok(t.data.getState().favorites.has('whitechapel'));
  assert.deepEqual(t.data.getState().reviews.kirifu, { rating: 4, comment: '雾', note: null });
  assert.ok(JSON.parse(t.storage.get(STORAGE_KEY)).pending.favorites.whitechapel === true, 'kept for later');

  t.server.signedIn = true;
  t.server.favorites.add('first-snow'); // favorited on another device
  await t.data.refresh();
  const s = t.data.getState();
  assert.equal(s.sync, 'synced');
  assert.deepEqual([...s.favorites].sort(), ['first-snow', 'whitechapel']);
  assert.deepEqual([...t.server.favorites].sort(), ['first-snow', 'whitechapel']);
  assert.deepEqual(t.server.reviews.kirifu.rating, 4);
  assert.deepEqual(JSON.parse(t.storage.get(STORAGE_KEY)).pending, { favorites: {}, likes: {}, reviews: {} });
  assert.ok(t.server.calls.filter((c) => c.method !== 'GET').every((c) => c.settingsHeader === '1'));

  // signed out again: this device stops showing that account's things
  t.server.signedIn = false;
  await t.data.refresh();
  assert.deepEqual([t.data.getState().sync, t.data.getState().favorites.size, Object.keys(t.data.getState().reviews).length], ['local', 0, 0]);
});

test('settings: the newer copy wins; applying the account copy does not echo back; a change is pushed debounced', async () => {
  const t = setup();
  t.server.signedIn = true;
  t.server.settings = { prefs: { v: 1, locale: 'ja' }, updatedAt: new Date(t.now - 1000).toISOString() };
  await t.data.refresh();
  assert.deepEqual(t.applied, [{ v: 1, locale: 'ja' }], 'no local change yet: the account copy applies');
  assert.equal(t.server.calls.filter((c) => c.url.endsWith('/settings')).length, 0, 'and is not written back');
  await t.tick(5_000);
  assert.equal(t.server.calls.filter((c) => c.url.endsWith('/settings')).length, 0);

  t.data.prefsChanged();
  t.data.prefsChanged();
  await t.tick(1_000);
  assert.equal(t.server.calls.filter((c) => c.url.endsWith('/settings')).length, 0, 'debounced');
  await t.tick(1_000);
  const puts = t.server.calls.filter((c) => c.url.endsWith('/settings'));
  assert.deepEqual(puts.map((c) => c.body), [{ prefs: { locale: 'en' } }]);

  // this device changed something while offline, after the account's copy: this one wins at the next sync
  t.server.signedIn = false;
  await t.data.refresh();
  await t.tick(60_000);
  t.data.prefsChanged();
  await t.tick(2_000);
  t.server.signedIn = true;
  t.server.settings = { prefs: { v: 1, locale: 'zh-CN' }, updatedAt: new Date(t.now - 30_000).toISOString() };
  t.applied.length = 0;
  await t.data.refresh();
  assert.deepEqual(t.applied, [], 'older account copy not applied');
  assert.deepEqual(t.server.settings.prefs, { locale: 'en' }, 'pushed instead');
});

test('save summaries: counted per turn, written at most once a minute per save, latest wins; ratings cached', async () => {
  const t = setup();
  t.server.signedIn = true;
  await t.data.refresh();
  const turn = (scene) => t.data.noteTurn({ saveId: 'whitechapel-jp-aaaa1111', worldId: 'whitechapel', worldName: 'Whitechapel', scene });
  turn('The street');
  await t.tick(0);
  turn('The pub');
  turn('The morgue');
  await t.tick(30_000);
  const saves = () => t.server.calls.filter((c) => c.url.includes('/saves/'));
  assert.equal(saves().length, 1, 'the second write waits for the minute');
  await t.tick(30_000);
  assert.equal(saves().length, 2);
  assert.deepEqual(saves()[1].body, { worldId: 'whitechapel', worldName: 'Whitechapel', scene: 'The morgue', turns: 3, text: 'Whitechapel · The morgue' });
  assert.equal(t.data.getState().saves[0].turns, 3);
  t.data.noteTurn({ saveId: '../x', worldId: 'w' });
  assert.equal(t.data.getState().saves.length, 1, 'bad ids are ignored');

  await t.data.loadRatings(['whitechapel', 'nowhere']);
  await t.data.loadRatings(['whitechapel']);
  assert.equal(t.server.calls.filter((c) => c.url.includes('/ratings')).length, 1, 'five minutes per world');
  assert.deepEqual(t.data.getState().ratings.whitechapel, { count: 3, average: 4.33 });
});

test('comments: public list without an account; your comment goes public, or says why not; reports need the account', async () => {
  const t = setup();
  t.server.comments = [{ id: 'r_9', rating: 2, comment: 'meh', author: '3f2a', mine: false, updatedAt: '2026-10-02T00:00:00Z' }];
  await t.data.refresh(); // signed out
  await t.data.loadComments('whitechapel');
  assert.deepEqual(t.data.getState().comments.whitechapel.map((c) => c.comment), ['meh']);
  assert.equal(await t.data.report('r_9', 'abuse'), false, 'signed out: no report');
  await t.data.setReview('whitechapel', 5, 'lovely');
  assert.equal(t.data.getState().notices.whitechapel, 'signed_out');

  t.server.signedIn = true;
  await t.data.refresh();
  assert.equal(t.server.reviews.whitechapel.comment, 'lovely', 'sent at sign-in');
  t.server.review.takenDown = true;
  await t.data.setReview('whitechapel', 4, 'edited');
  assert.equal(t.data.getState().notices.whitechapel, 'taken_down');
  t.server.review = { status: 429, takenDown: false };
  await t.data.setReview('whitechapel', 3, 'again');
  assert.equal(t.data.getState().notices.whitechapel, 'rate_limited');
  assert.deepEqual(JSON.parse(t.storage.get(STORAGE_KEY)).pending.reviews, {}, 'a refused edit is not queued for later');
  t.server.review = { status: 200, takenDown: false };
  await t.data.setReview('kirifu', 3, '加微信 123');
  assert.equal(t.data.getState().notices.kirifu, 'content_refused', 'a refused comment says why and is not queued');
  assert.equal(JSON.parse(t.storage.get(STORAGE_KEY)).pending.reviews.kirifu, undefined);
  assert.equal(await t.data.report('r_9', 'abuse', '  rude  '), true);
  assert.deepEqual(t.server.reports, [{ id: 'r_9', reason: 'abuse', note: 'rude' }]);
});

test('likes are public counts (shown at once, sent or kept for later); numbers per world with edition refs; turns reported; comment pages; the private note kept', async () => {
  const t = setup();
  await t.data.refresh(); // signed out
  await t.data.toggleLike('whitechapel');
  assert.ok(t.data.getState().likes.has('whitechapel'));
  t.server.signedIn = true;
  await t.data.refresh();
  assert.ok(t.server.likes.has('whitechapel'), 'sent at sign-in');
  await t.data.loadNumbers(['whitechapel', 'kirifu'], { whitechapel: ['whitechapel', 'whitechapel-jp'] });
  assert.deepEqual(t.data.getState().numbers.whitechapel, { rating: { count: 1, average: 5 }, likes: 1, plays: 42, players: null });
  assert.equal(t.data.getState().numbers.kirifu.plays, null);
  await t.data.toggleLike('whitechapel');
  assert.equal(t.data.getState().numbers.whitechapel.likes, 0, 'shown at once');
  assert.ok(!t.server.likes.has('whitechapel'));

  t.data.noteTurn({ saveId: 'whitechapel-jp-aaaa', worldId: 'whitechapel', worldRef: 'whitechapel-jp', worldName: 'W', scene: 'Pub' });
  await t.tick(0);
  assert.deepEqual(t.server.turns, [{ saveId: 'whitechapel-jp-aaaa', worldRef: 'whitechapel-jp', worldName: 'W' }]);

  t.server.comments = [{ id: 'r_1', rating: 5, comment: 'a', author: 'Ann', mine: false, createdAt: 'x', updatedAt: 'x' }, { id: 'r_2', rating: 4, comment: 'b', author: null, mine: false, createdAt: 'x', updatedAt: 'x' }];
  await t.data.loadComments('whitechapel', true);
  assert.equal(t.data.getState().commentsNext.whitechapel, 'p2');
  await t.data.loadMoreComments('whitechapel');
  assert.deepEqual([t.data.getState().comments.whitechapel.map((c) => c.id), t.data.getState().commentsNext.whitechapel], [['r_1', 'r_2'], null]);

  await t.data.setReview('whitechapel', 5, 'public words', 'private words');
  assert.deepEqual([t.server.reviews.whitechapel.comment, t.server.reviews.whitechapel.note], ['public words', 'private words']);
  await t.data.setReview('whitechapel', 4, '');
  assert.equal(t.server.reviews.whitechapel.note, 'private words', 'deleting the comment keeps the private note');
  assert.equal((await t.data.loadUsage()).today.tokens, 10);
});

test('nickname: signed in only; refused words say why; cleared = anonymous; dropped at sign-out', async () => {
  const t = setup();
  await t.data.refresh();
  assert.equal(await t.data.setNickname('霧の人'), 'signed_out');
  t.server.signedIn = true;
  t.server.nickname = 'Old';
  await t.data.refresh();
  assert.equal(t.data.getState().nickname, 'Old');
  assert.equal(await t.data.setNickname('a bad one'), 'content_refused');
  assert.equal(t.data.getState().nickname, 'Old');
  assert.equal(await t.data.setNickname(' 霧の人 '), null);
  assert.equal(t.data.getState().nickname, '霧の人');
  assert.equal(await t.data.setNickname(''), null);
  assert.equal(t.data.getState().nickname, null);
  t.server.nickname = 'Again';
  await t.data.refresh();
  t.server.signedIn = false;
  await t.data.refresh();
  assert.equal(t.data.getState().nickname, null, 'not shown after sign-out');
});

test('redeem: signed out → signed_out; a trial comes back; the billing refusal keeps its code; offline → unreachable', async () => {
  const t = setup();
  assert.deepEqual(await t.data.redeem('PLAYTEST-7KQX-M3TB', 'ja'), { ok: false, code: 'signed_out' });
  t.server.signedIn = true;
  const r = await t.data.redeem('PLAYTEST-7KQX-M3TB', 'ja');
  assert.deepEqual(r, { ok: true, redeemed: { outcome: 'trial_started', code: 'PLAYTEST-7KQX-M3TB', plan: 'story', endsAt: '2026-11-01T03:00:00.000Z', credits: 0, alreadyMember: false } });
  const call = t.server.calls.findLast((c) => c.url === '/api/account-data/redeem');
  assert.deepEqual([call.method, call.body, call.settingsHeader], ['POST', { code: 'PLAYTEST-7KQX-M3TB', locale: 'ja' }, '1']);
  assert.deepEqual(await t.data.redeem('USED', 'en'), { ok: false, code: 'already_redeemed' });
  assert.deepEqual(await t.data.redeem('DOWN', 'en'), { ok: false, code: 'unreachable' });
});

test('claimDaily (「领取今日额度」): POST /api/account-data/claim-daily with X-AIRP-Settings (the app server holds the token); signed out / refused / offline', async () => {
  const t = setup();
  assert.deepEqual(await t.data.claimDaily(), { ok: false, code: 'signed_out' });
  t.server.signedIn = true;
  const r = await t.data.claimDaily();
  assert.deepEqual(r, { ok: true, claimed: { credits: 250, duplicated: false, available: 262.5, daily: { allowance: 250, claimed: 250, claimable: false, resetsAt: '2026-10-03T12:00:00.000Z' } } });
  const call = t.server.calls.findLast((c) => c.url === '/api/account-data/claim-daily');
  assert.deepEqual([call.method, call.body, call.settingsHeader], ['POST', {}, '1']);
  assert.equal((await t.data.claimDaily()).claimed.duplicated, true);
  t.server.claimMode = 'refuse';
  assert.deepEqual(await t.data.claimDaily(), { ok: false, code: 'nothing_to_claim' });
  t.server.claimMode = 'down';
  assert.deepEqual(await t.data.claimDaily(), { ok: false, code: 'unreachable' });
});
