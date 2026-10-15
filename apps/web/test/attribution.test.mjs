// 渠道 / 来源 (lib/attribution.ts): `?src=` / utm_* / `ref=` parsing + sanitizing, first touch kept / last touch
// replaced, referrer HOST only, params stripped from the address bar (?invite= left for its own reader), survival
// across the sign-in redirect, and the hosted sign-in carrying it (email-code body, Google ?att=) then forgetting it
// (all but the first-touch channel keyword, kept for the usage events' `src`).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const mem = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
};
const kv = mem();
Object.defineProperty(globalThis, 'localStorage', { value: kv, configurable: true });

const jiti = createJiti(import.meta.url, { moduleCache: false });
const A = await jiti.import('../src/lib/attribution.ts');
const H = await jiti.import('../src/lib/hosted-login.ts');
const { captureInviteParam, pendingInvite } = await jiti.import('../src/lib/invite.ts');

const hist = () => {
  const h = { state: { s: 1 }, urls: [], replaceState(state, _t, url) { h.urls.push(url); } };
  return h;
};
const NOW = Date.parse('2026-10-05T03:00:00Z');

test('keyword / referrer host sanitizing', () => {
  assert.equal(A.keyword(' XHS.Oct '), 'xhs.oct');
  assert.equal(A.keyword('wechat group'), 'wechat-group');
  assert.equal(A.keyword('ｘｈｓ'), 'xhs');
  for (const bad of ['', '小红书', 'a/b', 'x'.repeat(41), null]) assert.equal(A.keyword(bad), undefined, String(bad));
  assert.equal(A.referrerHost('https://www.xiaohongshu.com/explore/123?x=secret', 'canvas.worldlines.gg'), 'www.xiaohongshu.com');
  assert.equal(A.referrerHost('https://canvas.worldlines.gg/foo', 'canvas.worldlines.gg'), undefined, 'own site');
  assert.equal(A.referrerHost('android-app://com.xingin', 'x'), undefined);
  assert.equal(A.referrerHost('', 'x'), undefined);
});

test('capture: first touch kept, last touch replaced, params stripped, ?invite= left alone, survives the sign-in redirect', () => {
  const s = mem();
  const h1 = hist();
  const a = A.captureAttribution({ href: 'https://canvas.worldlines.gg/?src=XHS-Oct&utm_medium=social&utm_campaign=Oct%202026&invite=WL-ABCDEF#top' }, s, h1, 'https://www.xiaohongshu.com/explore/1?token=secret', NOW);
  assert.deepEqual(a.first, { at: NOW, src: 'xhs-oct', utm: { medium: 'social', campaign: 'oct-2026' }, referrer_host: 'www.xiaohongshu.com', landing: '/' });
  assert.deepEqual(h1.urls, ['/?invite=WL-ABCDEF#top'], 'only the channel params leave the address bar');
  assert.ok(!s.m.get(A.ATTRIBUTION_KEY).includes('secret'), 'never the referrer path / query');
  // ?invite= is still readable by its own capture afterwards
  const s2 = mem();
  assert.equal(captureInviteParam({ href: `https://canvas.worldlines.gg${h1.urls[0]}` }, s2, hist(), NOW), 'WL-ABCDEF');
  assert.equal(pendingInvite(s2, NOW), 'WL-ABCDEF');

  // the sign-in redirect comes back without params: nothing changes, nothing is stripped
  const h2 = hist();
  assert.deepEqual(A.captureAttribution({ href: 'https://canvas.worldlines.gg/auth/callback-landed' }, s, h2, 'https://accounts.google.com/', NOW + 1000), a);
  assert.deepEqual(h2.urls, []);

  // a second link: first stays, last is the new one
  const b = A.captureAttribution({ href: 'https://canvas.worldlines.gg/play?ref=Itch' }, s, hist(), '', NOW + 2000);
  assert.equal(b.first.src, 'xhs-oct');
  assert.deepEqual(b.last, { at: NOW + 2000, ref: 'itch', landing: '/play' });

  // junk keywords: stripped from the bar, nothing remembered
  const s3 = mem();
  const h3 = hist();
  assert.equal(A.captureAttribution({ href: 'https://canvas.worldlines.gg/?src=%E5%B0%8F%E7%BA%A2%E4%B9%A6' }, s3, h3, '', NOW), null);
  assert.deepEqual(h3.urls, ['/']);
  assert.equal(s3.m.size, 0);
});

test('expiry (30 days), clear, payload / base64url param', () => {
  const s = mem();
  A.captureAttribution({ href: 'https://canvas.worldlines.gg/?utm_source=Reddit' }, s, hist(), '', NOW);
  assert.equal(A.attributionPayload(s, NOW).first.utm.source, 'reddit');
  const p = A.attributionParam(s, NOW);
  assert.match(p, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(JSON.parse(Buffer.from(p, 'base64url').toString()), A.readAttribution(s, NOW));
  assert.equal(A.readAttribution(s, NOW + A.ATTRIBUTION_TTL_MS + 1), null);
  assert.equal(s.m.has(A.ATTRIBUTION_KEY), false, 'expired → removed');
  assert.equal(A.readChannel(s, NOW + A.ATTRIBUTION_TTL_MS + 1), 'reddit', 'the channel keyword alone outlives the 30-day record');
  assert.equal(A.readChannel(s, NOW + A.CHANNEL_TTL_MS + 1), undefined, '… for 180 days');
  A.captureAttribution({ href: 'https://canvas.worldlines.gg/?src=a' }, s, hist(), '', NOW);
  A.clearAttribution(s);
  assert.equal(A.attributionPayload(s, NOW), undefined);
  assert.equal(A.attributionParam(s, NOW), undefined);
});

test('hosted sign-in: the email-code verify carries it and forgets it on success; a failure keeps it; Google gets ?att=', async () => {
  kv.m.clear();
  A.captureAttribution({ href: 'https://canvas.worldlines.gg/?src=xhs-oct' }, kv, hist(), '', Date.now());
  assert.match(H.hostedGoogleUrl('published/tea'), /^\/login\/google\?return=published%2Ftea&att=[A-Za-z0-9_-]+$/);
  assert.equal(H.hostedGoogleUrl('', ''), '/login/google', 'nothing remembered → no att');

  const calls = [];
  const reply = (status, body) => async (url, init) => { calls.push(JSON.parse(init.body)); return new Response(JSON.stringify(body), { status }); };
  await H.verifyHostedCode('a@b.test', '000000', reply(400, { ok: false, code: 'invalid_code' })).catch(() => {});
  assert.equal(calls[0].attribution.first.src, 'xhs-oct');
  assert.ok(A.readAttribution(kv), 'kept after a wrong code');
  await H.verifyHostedCode('a@b.test', '123456', reply(200, { ok: true, uid: 'u1', email: 'a@b.test' }));
  assert.equal(calls[1].attribution.first.src, 'xhs-oct');
  assert.equal(A.readAttribution(kv), null, 'forgotten once signed in');
  assert.equal(A.analyticsSrc(kv), 'xhs-oct', 'the channel keyword stays for the usage events');
  assert.deepEqual(Object.keys(JSON.parse(kv.m.get(A.CHANNEL_KEY))).sort(), ['at', 'src'], 'only the keyword + when');
  await H.verifyHostedCode('a@b.test', '123456', reply(200, { ok: true, uid: 'u1', email: 'a@b.test' }));
  assert.equal('attribution' in calls[2], false, 'nothing to send → no field');
});

test('usage-event src: first touch (src > ref > utm_source), kept after sign-in, an older kept keyword wins', () => {
  const s = mem();
  assert.equal(A.analyticsSrc(s, NOW), undefined);
  A.captureAttribution({ href: 'https://canvas.worldlines.gg/?ref=Itch&utm_source=reddit' }, s, hist(), '', NOW);
  A.captureAttribution({ href: 'https://canvas.worldlines.gg/?src=xhs' }, s, hist(), '', NOW + 1000);
  assert.equal(A.analyticsSrc(s, NOW + 2000), 'itch', 'first touch, not the last');
  A.settleAttribution(s, NOW + 3000);
  assert.equal(A.readAttribution(s, NOW + 3000), null);
  assert.equal(A.analyticsSrc(s, NOW + 3000), 'itch');
  // a later link + another sign-in on this device: the kept first keyword is not replaced
  A.captureAttribution({ href: 'https://canvas.worldlines.gg/?src=wechat' }, s, hist(), '', NOW + 4000);
  assert.equal(A.readAttribution(s, NOW + 4000).first.src, 'wechat', 'the new record is still sent with a sign-in');
  A.settleAttribution(s, NOW + 5000);
  assert.equal(A.analyticsSrc(s, NOW + 5000), 'itch');
  // junk in storage → dropped
  s.setItem(A.CHANNEL_KEY, JSON.stringify({ src: 'Not OK', at: NOW }));
  assert.equal(A.readChannel(s, NOW), undefined);
  assert.equal(s.m.has(A.CHANNEL_KEY), false);
});
