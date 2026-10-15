// Share cards (lib/share-card.ts) + the QR encoder (lib/qr.ts) + invite links (lib/invite.ts), against a recording
// fake 2D context: both cards in all four locales and both formats have the right size, carry the invite code,
// the locale's line and every dark QR module; the QR is structurally valid; `?invite=` survives the sign-in.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false, tryNative: true });
const card = await jiti.import('../src/lib/share-card.ts');
const { encodeQr } = await jiti.import('../src/lib/qr.ts');
const inv = await jiti.import('../src/lib/invite.ts');

/** A canvas whose context records text and rectangles (enough of the 2D API for the renderer). */
function fakeCanvas(width, height, log) {
  const grad = () => ({ addColorStop() {} });
  const ctx = {
    font: '10px sans-serif', fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, textAlign: 'left', textBaseline: 'alphabetic', globalAlpha: 1, globalCompositeOperation: 'source-over', shadowColor: '', shadowBlur: 0, shadowOffsetY: 0, filter: 'none',
    save() {}, restore() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arcTo() {}, arc() {}, quadraticCurveTo() {}, fill() {}, stroke() {}, clip() {},
    fillRect(x, y, w, h) { log.rects.push({ x, y, w, h, fill: ctx.fillStyle }); },
    fillText(text) { log.text.push(String(text)); },
    measureText(text) { const px = Number(/(\d+)px/.exec(ctx.font)?.[1] ?? 10); return { width: [...String(text)].reduce((w, ch) => w + (/[　-鿿가-힯＀-￯]/.test(ch) ? px : px * 0.6), 0) }; },
    drawImage(...a) { log.images.push(a.length); },
    createLinearGradient: grad, createRadialGradient: grad,
    createPattern() { return {}; },
    createImageData(w, h) { return { data: new Uint8ClampedArray(w * h * 4) }; },
    putImageData() {},
  };
  return { width, height, getContext: () => ctx };
}
const render = async (fn, input) => {
  const log = { text: [], rects: [], images: [] };
  const canvas = await fn(input, { loadFonts: false, createCanvas: (w, h) => fakeCanvas(w, h, log) });
  return { canvas, log, joined: log.text.join('') };
};
const CODE = 'WL-7KQXM3';
const URL_ = 'https://canvas.worldlines.gg/?invite=WL-7KQXM3';
const LINES = { 'zh-CN': '用我的邀请码，送你 500 积分', ja: '招待コードで 500 クレジットをプレゼント', ko: '내 초대 코드로 500 크레딧을 드려요', en: 'Use my invite code — get 500 credits' };

test('invite card: every locale × format — size, the code, the line, the link and all QR modules', async () => {
  const qrDark = encodeQr(URL_).modules.flat().filter(Boolean).length;
  for (const locale of ['zh-CN', 'ja', 'ko', 'en']) {
    for (const format of ['portrait', 'landscape']) {
      const art = { image: {}, width: 1600, height: 900 };
      const { canvas, log, joined } = await render(card.renderInviteCard, { locale, format, code: CODE, url: URL_, credits: 500, art, worldTitle: '归乡', endingTitle: 'E', quote: 'q' });
      assert.deepEqual([canvas.width, canvas.height], format === 'portrait' ? [1080, 1350] : [1200, 630], `${locale} ${format}`);
      assert.ok(joined.includes(CODE), `${locale} ${format}: the code (drawn letter by letter)`);
      assert.ok(log.text.includes(LINES[locale]), `${locale}: ${LINES[locale]}`);
      assert.ok(log.text.some((x) => x.startsWith('canvas.worldlines.gg/?invite=')), 'the link without https://');
      assert.equal(log.rects.filter((r) => r.fill === '#0d1020').length, qrDark, 'every dark QR module');
      assert.ok(log.images.length >= 1, 'the CG is drawn');
    }
  }
});

test('result card: stats, ending kicker, corner code + QR; numbers per locale', async () => {
  const { canvas, log, joined } = await render(card.renderResultCard, { locale: 'ko', code: CODE, url: URL_, credits: 500, worldTitle: '귀향', endingTitle: '우물가의 이름', quote: '비가 그쳤다.', playtimeMinutes: 72, turns: 38, secrets: { found: 5, total: 7 } });
  assert.deepEqual([canvas.width, canvas.height], [1080, 1350]);
  for (const s of ['1시간 12분', '38', '5 / 7', CODE, '스캔하고 500 크레딧 받기']) assert.ok(log.text.includes(s) || joined.includes(s), s);
  assert.ok(joined.includes('엔딩 달성 · 우물가의 이름'));
  const en = await render(card.renderResultCard, { locale: 'en', format: 'landscape', code: CODE, url: URL_, playtimeMinutes: 48, turns: null, secrets: null });
  assert.deepEqual([en.canvas.width, en.canvas.height], [1200, 630]);
  assert.ok(en.log.text.includes('48 min') && !en.log.text.includes('TURNS'.split('').join('')), 'missing numbers are left out');
  assert.equal(card.playtimeLabel('zh-CN', 125), '2 小时 5 分');
  assert.equal(card.playtimeLabel('ja', 40), '40分');
});

test('no picture → painted art (never an empty card); wrapLines / coverRect', async () => {
  const { log } = await render(card.renderInviteCard, { locale: 'en', code: CODE, url: URL_ });
  assert.equal(log.images.length, 0);
  assert.ok(log.text.includes('LivingCanvas'), 'the brand stands in for a world title');
  const ctx = { measureText: (t) => ({ width: [...t].length * 10 }) };
  assert.deepEqual(card.wrapLines(ctx, '一二三四五六七八九十', 40, 2), ['一二三四', '五六七…']);
  assert.deepEqual(card.wrapLines(ctx, 'aa bb cc', 50, 3), ['aa bb', 'cc']);
  const r = card.coverRect(2000, 1000, 1080, 1350);
  assert.ok(Math.abs(r.sw / r.sh - 1080 / 1350) < 1e-9 && Math.abs(r.sh - 1000) < 1e-9);
  assert.equal(card.cardLocale('zh'), 'zh-CN');
  assert.equal(card.cardLocale('fr'), 'en');
});

test('QR: version by length, finder patterns, timing, format bits match the chosen mask (both copies)', () => {
  for (const [text, ver] of [['HELLO', 1], [URL_, 4], ['x'.repeat(200), 10]]) {
    const q = encodeQr(text);
    assert.equal(q.version, ver, text.slice(0, 10));
    assert.equal(q.size, ver * 4 + 17);
    const m = q.modules;
    for (const [cx, cy] of [[3, 3], [q.size - 4, 3], [3, q.size - 4]]) {
      for (let d = -3; d <= 3; d++) {
        assert.equal(m[cy - 3][cx + d], true);
        assert.equal(m[cy + d][cx - 2] === (Math.abs(d) === 3), true, 'the white ring');
      }
      assert.equal(m[cy][cx], true, 'the centre');
    }
    for (let i = 8; i < q.size - 8; i++) assert.equal(m[6][i], i % 2 === 0, 'timing');
    // format bits (ECC M = 00, mask) read back from around the top-left finder
    let bits = 0;
    const read = [];
    for (let i = 0; i <= 5; i++) read.push(m[i][8]);
    read.push(m[7][8], m[8][8], m[8][7]);
    for (let i = 9; i < 15; i++) read.push(m[8][14 - i]);
    read.forEach((b, i) => { if (b) bits |= 1 << i; });
    const data = ((bits ^ 0x5412) >>> 10) & 0x1f;
    assert.equal(data, q.mask, 'ECC M (00) + the mask');
    assert.equal(m[q.size - 8][8], true, 'the dark module');
  }
  assert.throws(() => encodeQr('z'.repeat(400)), /too long/);
});

test('invite links: normalize, share URL, remembered through the sign-in, redeemed once, final refusals dropped', async () => {
  assert.equal(inv.normalizeInvite(' wl-7kqxm3 '), CODE);
  assert.equal(inv.normalizeInvite('ＷＬ７ＫＱＸＭ３'), CODE);
  assert.equal(inv.normalizeInvite('WL-7KQXM0'), null, '0 is not in the alphabet');
  assert.equal(inv.normalizeInvite('PLAYTEST-AAAA'), null);
  assert.equal(inv.inviteShareUrl(CODE), URL_);
  const kv = new Map();
  const store = { getItem: (k) => kv.get(k) ?? null, setItem: (k, v) => kv.set(k, String(v)), removeItem: (k) => kv.delete(k) };
  const replaced = [];
  const hist = { state: null, replaceState: (_s, _t, u) => replaced.push(u) };
  assert.equal(inv.captureInviteParam({ href: 'https://canvas.worldlines.gg/?invite=wl-7kqxm3&lang=ko#top' }, store, hist), CODE);
  assert.deepEqual(replaced, ['/?lang=ko#top'], 'the code leaves the address bar');
  // the Google / email sign-in reloads the page: the remembered code is still there
  assert.equal(inv.pendingInvite(store), CODE);
  const calls = [];
  let answer = { ok: false, code: 'signed_out' };
  const data = { redeem: async (code, locale, device) => { calls.push({ code, locale, device }); return answer; } };
  assert.equal((await inv.redeemPendingInvite(data, 'ko', store)).status, 'later');
  assert.equal(inv.pendingInvite(store), CODE, 'not signed in yet: kept');
  answer = { ok: true, redeemed: { outcome: 'invite', code: CODE, plan: null, endsAt: null, credits: 500, alreadyMember: false } };
  const done = await inv.redeemPendingInvite(data, 'ko', store);
  assert.deepEqual([done.status, done.redeemed.credits], ['redeemed', 500]);
  assert.equal(inv.pendingInvite(store), null, 'redeemed once, then forgotten');
  assert.equal((await inv.redeemPendingInvite(data, 'ko', store)).status, 'none');
  assert.match(calls[1].device, /^[0-9a-f]{36}$/, 'a device id for billing');
  inv.captureInviteParam({ href: 'https://canvas.worldlines.gg/?invite=WL-7KQXM3' }, store, hist);
  answer = { ok: false, code: 'own_code' };
  assert.deepEqual(await inv.redeemPendingInvite(data, 'en', store), { status: 'refused', code: CODE, error: 'own_code' });
  assert.equal(inv.pendingInvite(store), null);
  inv.captureInviteParam({ href: 'https://x/?invite=WL-7KQXM3' }, store, hist, 0);
  assert.equal(inv.pendingInvite(store, 31 * 86_400_000), null, 'forgotten after 30 days');
});

test('i18n: every new UI string has zh-CN, ja and ko', () => {
  const messages = JSON.parse(readFileSync(new URL('../src/lib/messages.json', import.meta.url), 'utf8'));
  for (const key of ['Invite friends', 'Create share image', 'Copy link', 'Share result', 'Share image', 'Your rewards', 'Unlocks after you play a bit', '{calls}/{need} turns', 'Then reach one ending', 'Claim', 'Invite code applied: {credits} credits added.', 'Invite code applied: your {credits} credits unlock after you play a bit.', 'Portrait', 'Landscape', 'Download', 'You cannot use your own invite code.']) {
    for (const l of ['zh-CN', 'ja', 'ko']) assert.ok(messages[key]?.[l], `${key} [${l}]`);
  }
});
