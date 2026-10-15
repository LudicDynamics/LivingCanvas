// the free plan's daily credits (2026-10-05: 100 a day for everyone;
// before that 0008's newcomer 100 for 8 days, then 50) are claim-only — never claimed automatically — and LivingCanvas has
// the button — in the account panel's balance area (UsageSummary → DailyClaim), through the app server (no
// token in the page), and a gentle prompt only after a claim_required refusal. Helpers, source contract, i18n.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { dailyClaimState, newcomerOf, resetLabel, claimError, isClaimRequired } = await jiti.import('../src/lib/daily-claim.ts');
const { friendlyModelError } = await jiti.import('../src/lib/model-errors.ts');
const { PLAN_TIERS } = await jiti.import('../src/lib/plans.ts');
const { translate } = await jiti.import('../src/lib/translate.ts');
const src = (p) => readFile(new URL(p, import.meta.url), 'utf8');
const messages = JSON.parse(await src('../src/lib/messages.json'));

test('status: claimable / claimed with the reset in JST / nothing for a plan without a daily allowance', () => {
  assert.deepEqual(dailyClaimState({ allowance: 250, claimed: 0, claimable: true, resetsAt: '2026-10-03T12:00:00.000Z' }), { kind: 'claimable', allowance: 250, newcomer: null });
  // the worldlines wallet day is AoE (UTC−12): it ends at 12:00 UTC = 21:00 in Tokyo
  assert.deepEqual(dailyClaimState({ allowance: 250, claimed: 250, claimable: false, resetsAt: '2026-10-03T12:00:00.000Z' }), { kind: 'claimed', claimed: 250, resets: '21:00 JST', newcomer: null });
  for (const none of [null, undefined, { allowance: 0, claimed: 0, claimable: false, resetsAt: null }]) assert.deepEqual(dailyClaimState(none), { kind: 'none' });
  assert.equal(resetLabel('2026-10-03T15:30:00Z'), '00:30 JST');
  for (const bad of [null, '', 'tomorrow']) assert.equal(resetLabel(bad), null);
  const errs = ['nothing_to_claim', 'signed_out', 'session_required', 'rate_limited', 'unreachable', 'whatever'].map(claimError);
  assert.equal(new Set(errs).size, 4);
  assert.equal(isClaimRequired('402 {"error":{"code":"insufficient_credits","reason":"claim_required"}}'), true);
  assert.equal(isClaimRequired('429 quota_exceeded'), false);
  assert.equal(friendlyModelError('402: {"error":{"reason":"claim_required"}}'), "Today's free credits are waiting. Claim them to go on.");
});

test('source contract: in the balance area, through accountData (no token / fetch in the page); the prompt only on claim_required; free line says the 500 newcomer gift + 100 a day', async () => {
  const usage = await src('../src/components/chrome/UsageSummary.tsx');
  const claim = await src('../src/components/chrome/DailyClaim.tsx');
  const app = await src('../src/App.tsx');
  const panel = await src('../src/components/account/AccountTab.tsx');
  assert.match(usage, /<DailyClaim daily=\{w\.daily\}/, 'under the balance line');
  assert.match(panel, /<UsageSummary \/>/, 'UsageSummary sits in the signed-in account panel');
  assert.match(claim, /data\.claimDaily\(deviceId\(\)\)/, 'through the app server, with the page device id (billing per-device claim cap)');
  assert.doesNotMatch(claim, /fetch\(|authorization|Bearer|innerHTML|dangerouslySetInnerHTML/i, 'no token, no raw HTML');
  assert.match(claim, /isClaimRequired\(detail\)/, 'the claim card opens only on a claim_required notice');
  assert.match(claim, /creditsStopOf\(detail\)[\s\S]*setMode\(stop === 'debt_limit' \? 'paused' : 'short'\)/, 'a wallet-short (or paused) notice opens the redeem / plans card instead');
  assert.match(app, /<ClaimPrompt \/>/);
  const server = await src('../../server/src/sync/account-data.ts');
  assert.match(server, /export const CLAIM_WALLET = 'worldlines'/, 'the shared pricing-v3 wallet');
  assert.match(server, /\/v1\/claims\/\$\{CLAIM_WALLET\}\/daily/);
  const route = await src('../../server/src/routes/account-data.ts');
  assert.match(route, /router\.post\('\/account-data\/claim-daily'/);
  const free = PLAN_TIERS.find((p) => p.id === 'free').lines[0];
  assert.deepEqual(free.vars, { gift: '500', days: '30', daily: '100' });
});

test('every claim string is translated (zh-CN / ja / ko)', async () => {
  const claim = await src('../src/components/chrome/DailyClaim.tsx');
  const strings = new Set([...claim.matchAll(/\bt\((['"])((?:(?!\1).)+)\1/g)].map((m) => m[2]));
  for (const code of ['nothing_to_claim', 'signed_out', 'rate_limited', 'x']) strings.add(claimError(code));
  strings.add("Today's free credits are waiting. Claim them to go on.");
  assert.ok(strings.has("Claim today's credits") && strings.has('Claimed today · resets at {time}'));
  for (const s of strings) for (const lang of ['zh-CN', 'ja', 'ko']) assert.ok(messages[s]?.[lang], `${lang}: ${s}`);
  assert.equal(messages["Claim today's credits"]['zh-CN'], '领取今日额度');
  assert.equal(messages['Claimed today · resets at {time}']['zh-CN'], '今日已领取 · 重置于 {time}');
});

test('newcomer tier (billing 0008): day n/8 while newcomer, nothing after; bogus days ignored', () => {
  const base = { claimed: 0, claimable: true, resetsAt: '2026-10-03T12:00:00.000Z' };
  assert.deepEqual(dailyClaimState({ ...base, allowance: 100, tier: 'newcomer', newcomerDay: 1, newcomerDays: 8, regular: 50 }), { kind: 'claimable', allowance: 100, newcomer: { day: 1, days: 8 } });
  assert.deepEqual(dailyClaimState({ ...base, allowance: 100, tier: 'newcomer', newcomerDay: 8, newcomerDays: 8 }).newcomer, { day: 8, days: 8 });
  assert.deepEqual(dailyClaimState({ ...base, allowance: 50, tier: 'regular', regular: 50 }), { kind: 'claimable', allowance: 50, newcomer: null });
  assert.deepEqual(dailyClaimState({ ...base, claimable: false, claimed: 100, allowance: 100, tier: 'newcomer', newcomerDay: 3, newcomerDays: 8 }), { kind: 'claimed', claimed: 100, resets: '21:00 JST', newcomer: { day: 3, days: 8 } });
  for (const bad of [{ newcomerDay: 9, newcomerDays: 8 }, { newcomerDay: 0, newcomerDays: 8 }, { newcomerDay: 2 }, { newcomerDay: 1.5, newcomerDays: 8 }]) assert.equal(newcomerOf({ ...base, allowance: 100, tier: 'newcomer', ...bad }), null);
});

test('daily copy in en / zh-CN / ja / ko (「今日可领 100」; the 0008 newcomer-day copy stays for an admin who switches it back on) and the free plan line (0011)', () => {
  const nv = { day: 3, days: 8, count: '100', unit: 'credits' };
  const rv = { count: '100', unit: '积分' };
  const want = {
    en: ['New player day 3/8: 100 credits to claim today', 'A {gift}-credit newcomer gift, added automatically (valid {days} days); {daily} credits to claim every day'],
    'zh-CN': ['新手期 第 3/8 天：今日可领 100 credits', '新手礼包 500 积分，自动到账（30 天内有效）；每天可领 100 积分'],
    ja: ['ビギナー期間 3/8 日目：今日は 100 credits を受け取れます', 'ビギナーギフト 500 クレジットを自動で付与（30 日間有効）。毎日 100 クレジットを受け取れます'],
    ko: ['신규 기간 3/8일째: 오늘 100 credits 받기 가능', '신규 선물 500 크레딧 자동 지급 (30일간 유효). 매일 100 크레딧 받기'],
  };
  const free = PLAN_TIERS.find((p) => p.id === 'free').lines[0];
  for (const [lang, [line, plan]] of Object.entries(want)) {
    assert.equal(translate(lang, 'Newcomer day {day}/{days}: {count} {unit} to claim today', nv), line, lang);
    if (lang !== 'en') assert.equal(translate(lang, free.key, free.vars), plan, `${lang} plan line`);
  }
  assert.equal(translate('zh-CN', "Today's free credits: {count} {unit} to claim", rv), '今日可领 100 积分');
  assert.equal(translate('ko', 'Newcomer day {day}/{days}', { day: 1, days: 8 }), '신규 기간 1/8일째');
});
