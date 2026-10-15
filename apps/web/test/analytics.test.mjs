// 改进产品 (lib/analytics.ts): the closed event list + prop whitelist + size limits, scrubbing (emails / tokens / URL
// queries, stack frames), the switch (default on, DNT / GPC = off, the player's choice wins), batching (≤ 50, beacon
// when anonymous on the browser version, the server route with the account when signed in, 429 / 5xx handling, the
// local version signed out = nothing), error dedupe (first sent, repeats counted on leaving) and the 20-per-session cap.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const A = await jiti.import('../src/lib/analytics.ts');

const mem = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
};

test('closed list, prop whitelist, required props, size', () => {
  assert.deepEqual(A.validateEvent('lobby_view', undefined, undefined, 5), { name: 'lobby_view', at: 5 });
  assert.equal(A.validateEvent('page_view'), null, 'not on the list');
  assert.equal(A.validateEvent('lobby_view', { prompt: 'hi' }), null, 'unknown prop');
  assert.equal(A.validateEvent('turn', {}), null, 'count is required');
  assert.equal(A.validateEvent('turn', { count: 0 }), null);
  assert.equal(A.validateEvent('turn', { count: 1.5 }), null);
  assert.deepEqual(A.validateEvent('turn', { count: 10 }, 'whitechapel', 1).props, { count: 10 });
  assert.equal(A.validateEvent('tutorial_step', { step: 'speak', action: 'clicked' }), null, 'enum');
  assert.ok(A.validateEvent('tutorial_step', { step: 'writer-send', action: 'skipped' }));
  assert.equal(A.validateEvent('ending_reached', { ending: 'has space' }), null, 'word only');
  assert.equal(A.validateEvent('world_enter', { resumed: 'yes' }), null, 'bool');
  assert.equal(A.validateEvent('world_tile_open', {}, 'has space?'), null, 'world id format');
  assert.equal(A.validateEvent('world_tile_open', {}, 'x'.repeat(129)), null);
  assert.ok(A.validateEvent('world_tile_open', { tab: undefined }, 'livingcanvas/world/whitechapel-jp'), 'undefined props are left out');
  assert.equal(A.validateEvent('error', { kind: 'error', message: 'x'.repeat(301) }), null, 'message ≤ 300');
  assert.equal(A.validateEvent('error', { kind: 'error', message: 'm', stack: ['a.js:1', 'b.js:2', 'c.js:3', 'd.js:4', 'e.js:5', 'f.js:6'] }), null, '≤ 5 frames');
  assert.equal(A.validateEvent('error', { kind: 'error', message: 'line\nbreak' }), null, 'no control characters');
  // every event JSON ≤ 2 KB (checked in bytes): 5 frames of ≤ 160 + a 300-char CJK message + a route still fit
  const big = A.validateEvent('error', { kind: 'error', message: '错'.repeat(300), stack: Array(5).fill('f'.repeat(150) + '.js:1:1'), route: '/r' });
  assert.ok(big, 'the largest whitelisted error event still fits');
  assert.ok(Buffer.byteLength(JSON.stringify(big)) <= A.MAX_EVENT_BYTES, 'the 2 KB per-event budget holds for the largest allowed props');
  assert.ok(A.validateEvent('error', { kind: 'worker', message: '错'.repeat(300), stack: ['worker.js:1:2'] }));
  assert.equal(A.asWord('ending.good-1'), 'ending.good-1');
  assert.equal(A.asWord('不是'), undefined);
  assert.equal(A.ANALYTICS_EVENTS.length, 23);
});

test('scrubbing: emails, tokens, URLs with query strings; stack frames are file:line:col only', () => {
  const s = A.scrubText('failed for alice.b+x@example.co.jp at https://user:pw@canvas.worldlines.gg/play/x?token=abc&email=a@b.cc#frag Bearer abc.def.ghi');
  assert.ok(!s.includes('alice'), s);
  assert.ok(!s.includes('token=abc') && !s.includes('#frag') && !s.includes('pw@'), s);
  assert.ok(s.includes('https://canvas.worldlines.gg/play/x'), s);
  assert.ok(s.includes('[email]') && s.includes('Bearer [token]'), s);
  assert.equal(A.scrubText('jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig_part-x'), 'jwt [token]');
  assert.equal(A.scrubText('key wl_pat_abcdefghijkl and sk-proj-ABCDEF123456'), 'key [token] and [token]');
  assert.equal(A.scrubText('id 0123456789abcdef0123456789abcdef'), 'id [token]');
  assert.equal(A.scrubText('b64 QWxhZGRpbjpvcGVuIHNlc2FtZTEyMzQ1Njc4OTA='), 'b64 [token]');
  assert.equal(A.scrubText('Cannot read properties of undefined (reading "map")'), 'Cannot read properties of undefined (reading "map")', 'plain messages stay');
  assert.equal([...A.scrubText('x'.repeat(400))].length, 300);
  const stack = [
    'TypeError: boom',
    '    at render (https://canvas.worldlines.gg/assets/index-BhX9a.js?v=3:12:345)',
    '    at https://canvas.worldlines.gg/assets/vendor-1.js:1:2',
    '    at foo@http://localhost:5173/src/App.tsx?t=1:44:7',
    '    at Worker.run (blob:https://canvas.worldlines.gg/0f0e-aa:9:1)',
    '    at a (x.js:1:1)', '    at b (y.js:2:2)', '    at c (z.js:3:3)',
  ].join('\n');
  assert.deepEqual(A.stackTop5(stack), ['index-BhX9a.js:12:345', 'vendor-1.js:1:2', 'App.tsx:44:7', 'x.js:1:1', 'y.js:2:2']);
  assert.deepEqual(A.stackTop5(undefined), []);
  assert.equal(A.routeOf('/play/whitechapel?invite=WL-1#x'), '/play/whitechapel');
});

test('the switch: default on; Do Not Track / GPC off by default; the player\'s choice wins', () => {
  const kv = mem();
  assert.equal(A.analyticsEnabled(kv, {}), true);
  assert.equal(A.analyticsEnabled(kv, { doNotTrack: '1' }), false);
  assert.equal(A.analyticsEnabled(kv, { globalPrivacyControl: true }), false);
  A.setAnalyticsEnabled(true, kv);
  assert.equal(kv.m.get(A.OPT_KEY), '1');
  assert.equal(A.analyticsEnabled(kv, { doNotTrack: '1' }), true, 'chose on despite DNT');
  A.setAnalyticsEnabled(false, kv);
  assert.equal(A.analyticsEnabled(kv, {}), false);
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() {} };
  assert.equal(A.analyticsEnabled(blocked, {}), true, 'blocked storage = the default');
  A.setAnalyticsEnabled(false, blocked);
  // the send rule
  assert.equal(A.modeFor({ enabled: false, signedIn: true, staticSite: true }), 'off');
  assert.equal(A.modeFor({ enabled: true, signedIn: true, staticSite: false }), 'server', 'local version signed in');
  assert.equal(A.modeFor({ enabled: true, signedIn: false, staticSite: false }), 'off', 'local version signed out sends nothing');
  assert.equal(A.modeFor({ enabled: true, signedIn: false, staticSite: true }), 'direct', 'browser version anonymous');
});

test('session id per tab (kept in sessionStorage), turn milestones, app version', () => {
  const ss = mem();
  const id = A.sessionIdOf(ss);
  assert.match(id, /^[A-Za-z0-9_-]{22,64}$/);
  assert.equal(A.sessionIdOf(ss), id);
  assert.notEqual(A.sessionIdOf(mem()), id);
  assert.match(A.sessionIdOf(null), /^[A-Za-z0-9_-]{22,64}$/, 'memory when blocked');
  assert.deepEqual([1, 2, 4, 5, 6, 10, 15].map((n) => A.turnEvent(n)?.name ?? null), ['first_turn', null, null, 'turn', null, 'turn', 'turn']);
  assert.equal(A.turnEvent(0), null);
  assert.equal(A.appVersionOf({ VITE_AIRP_RUNTIME_BASE: '/runtime/r-2026-10-05-ab12/' }), 'r-2026-10-05-ab12');
  assert.equal(A.appVersionOf({ VITE_AIRP_APP_VERSION: '1.2.3 beta', VITE_AIRP_RUNTIME_BASE: '/runtime/x/' }), '1.2.3beta');
  assert.equal(A.appVersionOf({}), 'local');
});

function rig({ mode = 'direct', enabled = true, beacon = true, beaconOk = true, fetchStatus = 202, serverBody = null, directFallback = true } = {}) {
  const calls = { beacon: [], fetch: [] };
  let state = { mode, enabled };
  const env = {
    endpoint: 'https://chronicle.test/v1/events',
    sessionId: 'abcdefghijklmnopqrstuv',
    appVersion: 'r1',
    locale: () => 'zh',
    src: () => 'xhs',
    enabled: () => state.enabled,
    mode: () => (state.enabled ? state.mode : 'off'),
    directFallback: () => directFallback,
    now: () => 1000,
    fetch: async (url, init) => {
      calls.fetch.push({ url, init, body: JSON.parse(init.body) });
      const status = typeof fetchStatus === 'function' ? fetchStatus(url) : fetchStatus;
      if (status === 'throw') throw new TypeError('network');
      return { status, ok: status < 300, json: async () => (url === A.SERVER_PATH ? (serverBody ?? { ok: true, available: true, status, accepted: 1 }) : { accepted: 1 }) };
    },
    sendBeacon: beacon ? (url, blob) => { calls.beacon.push({ url, blob }); return beaconOk; } : null,
  };
  const c = A.createAnalytics(env);
  return { c, calls, set: (next) => { state = { ...state, ...next }; } };
}

test('batching: anonymous browser version → sendBeacon text/plain, ≤ 50 per batch, the envelope', async () => {
  const { c, calls } = rig();
  for (let i = 0; i < 120; i += 1) c.track('dice_roll', { outcome: 'pass' }, 'w1');
  assert.equal(c.track('nope'), false);
  assert.equal(c.pending().length, 120);
  await c.flush();
  assert.equal(calls.beacon.length, 1, 'one batch per tick');
  assert.equal(c.pending().length, 70);
  const b = calls.beacon[0];
  assert.equal(b.url, 'https://chronicle.test/v1/events');
  assert.equal(b.blob.type, 'text/plain');
  const body = JSON.parse(await b.blob.text());
  assert.deepEqual(Object.keys(body), ['product', 'session_id', 'app_version', 'locale', 'src', 'events']);
  assert.equal(body.product, 'livingcanvas');
  assert.equal(body.events.length, 50);
  assert.deepEqual(body.events[0], { name: 'dice_roll', at: 1000, world_id: 'w1', props: { outcome: 'pass' } });
  await c.flush(true);
  assert.equal(c.pending().length, 0, 'leaving sends everything');
  assert.equal(calls.beacon.length, 3);
  assert.equal(calls.fetch.length, 0);
});

test('batches stay under the 64 KB keepalive / beacon limit', async () => {
  const { c, calls } = rig();
  for (let i = 0; i < 50; i += 1) c.trackError({ kind: 'error', message: `${'错'.repeat(280)} ${i}`, stack: 'at x (a.js:1:1)' });
  await c.flush(true);
  for (const b of calls.beacon) assert.ok(b.blob.size <= A.MAX_BODY_BYTES + 200, String(b.blob.size));
});

test('a refused beacon falls back to fetch keepalive; 429 keeps the batch, 5xx retries once, 4xx drops', async () => {
  let r = rig({ beaconOk: false, fetchStatus: 429 });
  r.c.track('lobby_view');
  await r.c.flush();
  assert.equal(r.calls.fetch.length, 1);
  assert.equal(r.calls.fetch[0].init.keepalive, true);
  assert.equal(r.calls.fetch[0].init.headers['content-type'], 'text/plain');
  assert.equal(r.calls.fetch[0].init.credentials, 'omit');
  assert.equal(r.c.pending().length, 1, '429 → kept');
  await r.c.flush();
  assert.equal(r.c.pending().length, 1, 'still kept');

  r = rig({ beacon: false, fetchStatus: 503 });
  r.c.track('lobby_view');
  await r.c.flush();
  assert.equal(r.c.pending().length, 1, 'retried once');
  await r.c.flush();
  assert.equal(r.c.pending().length, 0, 'then dropped');

  r = rig({ beacon: false, fetchStatus: 400 });
  r.c.track('lobby_view');
  await r.c.flush();
  assert.equal(r.c.pending().length, 0);

  r = rig({ beacon: false, fetchStatus: 'throw' });
  r.c.track('lobby_view');
  await r.c.flush();
  assert.equal(r.c.pending().length, 1, 'network error → once more');
});

test('signed in → the app server route (the account token is added there), never a beacon', async () => {
  const r = rig({ mode: 'server' });
  r.c.track('first_turn', undefined, 'w1');
  await r.c.flush();
  assert.equal(r.calls.beacon.length, 0);
  assert.equal(r.calls.fetch[0].url, A.SERVER_PATH);
  assert.equal(r.calls.fetch[0].init.headers['x-airp-settings'], '1');
  assert.equal(r.calls.fetch[0].init.keepalive, true);
  assert.equal(r.calls.fetch[0].body.events[0].name, 'first_turn');
  // chronicle said 429 through the server → kept
  const busy = rig({ mode: 'server', serverBody: { ok: true, available: true, status: 429 } });
  busy.c.track('lobby_view');
  await busy.c.flush();
  assert.equal(busy.c.pending().length, 1);
  // the server says "not signed in": the browser version sends it anonymously instead; the local version drops it
  const out = rig({ mode: 'server', serverBody: { ok: false, available: false, reason: 'signed_out' } });
  out.c.track('lobby_view');
  await out.c.flush();
  assert.equal(out.calls.beacon.length, 1);
  const local = rig({ mode: 'server', directFallback: false, serverBody: { ok: false, available: false, reason: 'signed_out' } });
  local.c.track('lobby_view');
  await local.c.flush();
  assert.equal(local.calls.beacon.length, 0);
  assert.equal(local.c.pending().length, 0);
});

test('leaving the browser version signed in: a beacon, not the in-tab server route (the tab is going away)', async () => {
  const r = rig({ mode: 'server' });
  r.c.track('world_enter', { resumed: false }, 'w1');
  await r.c.flush(true);
  assert.equal(r.calls.fetch.length, 0);
  assert.equal(r.calls.beacon.length, 1);
  // the local version (a real server, no direct path) keeps using its server route
  const local = rig({ mode: 'server', directFallback: false });
  local.c.track('world_enter', { resumed: false }, 'w1');
  await local.c.flush(true);
  assert.equal(local.calls.fetch[0].url, A.SERVER_PATH);
  assert.equal(local.calls.beacon.length, 0);
});

test('off: nothing queued or sent; turning off drops the queue; the local version signed out sends nothing', async () => {
  const r = rig({ enabled: false });
  assert.equal(r.c.track('lobby_view'), false);
  assert.equal(r.c.pending().length, 0);
  const s = rig();
  s.c.track('lobby_view');
  s.set({ enabled: false });
  await s.c.flush(true);
  assert.equal(s.calls.beacon.length + s.calls.fetch.length, 0);
  assert.equal(s.c.pending().length, 0);
  const local = rig({ mode: 'off' });
  local.c.track('lobby_view');
  await local.c.flush(true);
  assert.equal(local.calls.beacon.length + local.calls.fetch.length, 0);
});

test('errors: scrubbed, the first of each sent, repeats counted and sent once on leaving, ≤ 20 per session', async () => {
  const r = rig();
  const e = { kind: 'error', message: 'Failed to fetch https://x.test/a?k=secret for bob@example.com', stack: 'Error\n    at f (https://canvas.worldlines.gg/assets/index-1.js?x=1:3:4)', route: '/play?invite=1' };
  assert.equal(r.c.trackError(e), true);
  assert.equal(r.c.trackError(e), false, 'repeat: counted, not sent');
  r.c.trackError(e);
  const first = r.c.pending()[0];
  assert.equal(first.props.message, 'Failed to fetch https://x.test/a for [email]');
  assert.deepEqual(first.props.stack, ['index-1.js:3:4']);
  assert.equal(first.props.route, '/play');
  assert.equal(first.props.count, 1);
  await r.c.flush(true);
  const sent = (await Promise.all(r.calls.beacon.map((b) => b.blob.text()))).flatMap((t) => JSON.parse(t).events);
  assert.deepEqual(sent.map((x) => x.props.count), [1, 2], 'the follow-up carries the repeats');
  for (let i = 0; i < 30; i += 1) r.c.trackError({ kind: 'rejection', message: `distinct ${i}` });
  assert.equal(r.c.pending().length, 19, '20 kinds per session in all');
  assert.equal(r.c.trackError({ kind: 'worker', message: 'more' }), false);
});

test('window error capture: script errors and rejections become events; resource load errors do not', () => {
  const handlers = {};
  const got = [];
  A.installErrorCapture({ addEventListener: (k, fn) => { handlers[k] = fn; }, location: { pathname: '/w' } }, { trackError: (x) => got.push(x) });
  handlers.error({ message: 'boom', error: { message: 'boom', stack: 'at a (a.js:1:1)' } });
  handlers.error({ target: {} });
  handlers.unhandledrejection({ reason: new Error('nope') });
  handlers.unhandledrejection({ reason: 'plain' });
  assert.deepEqual(got.map((g) => [g.kind, g.message, g.route]), [['error', 'boom', '/w'], ['rejection', 'nope', '/w'], ['rejection', 'plain', '/w']]);
});

test('track() before startAnalytics is a no-op (tests, SSR, the perception page)', () => {
  A.track('lobby_view');
  A.trackTurn(5, 'w');
  A.reportError({ kind: 'error', message: 'x' });
  A.reportWorkerError('Error: x\n    at a (worker.js:1:1)');
});

test('turns per visit: milestones are the first turn of each console bucket, then 51, 101, 201, 501 …', () => {
  const hits = [];
  for (let n = 1; n <= 2_100; n++) if (A.isVisitMilestone(n)) hits.push(n);
  assert.deepEqual(hits, [1, 2, 3, 6, 11, 21, 51, 101, 201, 501, 1001, 2001]);
  for (const bad of [0, -1, 1.5, 100_001]) assert.equal(A.isVisitMilestone(bad), false);
});

test('visit tracker: resumed saves still report this visit; leave carries turns + place once per change', () => {
  const sent = [];
  const v = A.createVisitTracker((name, props, world) => sent.push([name, props, world]));
  v.turn(); // no world yet
  v.leave();
  assert.deepEqual(sent, []);
  v.enter('whitechapel', 'map');
  for (let i = 0; i < 6; i++) v.turn(i < 3 ? 'office' : 'street');
  assert.deepEqual(sent.map(([n, p]) => [n, p.n, p.place]), [['session_turn', 1, 'office'], ['session_turn', 2, 'office'], ['session_turn', 3, 'office'], ['session_turn', 6, 'street']]);
  sent.length = 0;
  v.leave(); // tab hidden
  v.leave(); // hidden again, nothing new
  v.place('has space'); // not a word: keeps the last place
  v.leave();
  assert.deepEqual(sent, [['world_leave', { turns: 6, place: 'street' }, 'whitechapel']]);
  sent.length = 0;
  // another world: the first one is left, the new one starts at 0; leaving with no turn is a 0-turn visit
  v.enter('noir', null);
  v.leave({ close: true });
  assert.deepEqual(sent, [['world_leave', { turns: 0 }, 'noir']]);
  // back to whitechapel in the same tab: the count continues (chronicle counts session × world)
  sent.length = 0;
  v.enter('whitechapel');
  v.turn('street');
  assert.deepEqual(sent, []); // 7 is not a milestone
  v.leave();
  assert.deepEqual(sent, [['world_leave', { turns: 7, place: 'street' }, 'whitechapel']]);
});

test('visit events pass the closed list; world_enter says it is tracked', () => {
  assert.ok(A.validateEvent('session_turn', { n: 3, place: 'office' }, 'whitechapel'));
  assert.equal(A.validateEvent('session_turn', {}), null, 'n is required');
  assert.equal(A.validateEvent('session_turn', { n: 0 }), null);
  assert.ok(A.validateEvent('world_leave', { turns: 0 }, 'whitechapel'));
  assert.equal(A.validateEvent('world_leave', { turns: 2, place: 'has space' }), null);
  assert.ok(A.validateEvent('world_enter', { resumed: true, tracked: true }, 'whitechapel'));
});
