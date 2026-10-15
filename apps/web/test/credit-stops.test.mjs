// credit-ready: billing enforcing credits must never leave a player with a retry loop, a raw error
// or a half-finished turn. Browser gateway: a 402 becomes a friendly, non-retryable error naming the reason
// (claim_required / insufficient_credits / debt_limit) with billing_url, like the 429; pi does not retry it. The notice
// picks the card (claim button vs account card) in every locale. The daily stays a click (2026-10-05: the auto daily
// claim was reverted); only the one-time newcomer gift is asked for automatically.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const gw = await jiti.import('../../browser-runtime/src/platform/model-gateway.ts');
const { isRetryableAssistantError } = await jiti.import('../../../vendor/pi-rp/packages/ai/src/utils/retry.ts');
const { friendlyModelError, creditsStopOf, isBillingStop, CREDITS_PAUSED, CREDITS_SHORT } = await jiti.import('../src/lib/model-errors.ts');
const gift = await jiti.import('../src/lib/newcomer-gift.ts');
const src = (p) => readFile(new URL(p, import.meta.url), 'utf8');
const messages = JSON.parse(await src('../src/lib/messages.json'));

const BASE = 'https://ai.example/v1';
const refusal = (reason) => new Response(JSON.stringify({ error: { message: 'Claim today\'s credits (or top up) to go on.', type: 'invalid_request_error', code: 'insufficient_credits', kind: 'chat', reason, resets_at: '2026-10-05T12:00:00.000Z', billing_url: 'https://billing.worldlines.gg/subscribe?product=livingcanvas&reason=quota' } }), { status: 402, headers: { 'content-type': 'application/json' } });
const gatewayWith = (res) => gw.createGatewayFetch(async () => res, { base: BASE, product: 'livingcanvas', token: async () => 't', onAuthRequired: () => {} });

test('gateway: 402 → friendly non-retryable error per reason, billing_url / kind / resets_at kept; pi does not retry', async () => {
  for (const reason of ['claim_required', 'insufficient_credits', 'debt_limit']) {
    const res = await gatewayWith(refusal(reason))(`${BASE}/chat/completions`, { method: 'POST', body: '{}' });
    assert.equal(res.status, 402);
    const { error } = await res.json();
    assert.deepEqual([error.code, error.type, error.reason, error.kind], ['insufficient_credits', 'insufficient_quota', reason, 'chat']);
    assert.match(error.billing_url, /^https:\/\/billing\.worldlines\.gg\//);
    assert.equal(error.message, gw.CREDITS_MESSAGES[reason]);
    assert.match(error.message, new RegExp(reason));
    // what pi's assistant message carries (openai SDK: "<status> <error.message>")
    const msg = { stopReason: 'error', errorMessage: `402 ${error.message}` };
    assert.equal(isRetryableAssistantError(msg), false, `${reason}: never retried`);
  }
  const odd = await gatewayWith(new Response('not json', { status: 402 }))(`${BASE}/chat/completions`, { method: 'POST', body: '{}' });
  assert.equal((await odd.json()).error.reason, 'insufficient_credits', 'an unreadable 402 is still a clean stop');
  assert.equal(isRetryableAssistantError({ stopReason: 'error', errorMessage: `429 ${gw.QUOTA_MESSAGE}` }), false, 'the 429 too');
});

test('the Node path says exactly the same (apps/server ai-gateway.ts billingStopResponse)', async () => {
  const server = await src('../../server/src/ai-gateway.ts');
  for (const [reason, text] of Object.entries(gw.CREDITS_MESSAGES)) assert.ok(server.includes(JSON.stringify(text).slice(1, -1)) || server.includes(text), `${reason} in step`);
  assert.match(server, /if \(res\.status !== 401\) return billingStopResponse\(res\)/);
});

test('notice → card and sentence, translated (zh-CN / ja / ko; en = key): claim prompt for claim_required, account card otherwise', () => {
  const cases = [
    ['claim_required', 'claim_required', "Today's free credits are waiting. Claim them to go on."],
    ['insufficient_credits', 'insufficient_credits', CREDITS_SHORT],
    ['debt_limit', 'debt_limit', CREDITS_PAUSED],
    [`402 ${gw.CREDITS_MESSAGES.debt_limit}`, 'debt_limit', CREDITS_PAUSED],
    [`402 ${gw.CREDITS_MESSAGES.claim_required}`, 'claim_required', "Today's free credits are waiting. Claim them to go on."],
  ];
  for (const [detail, stop, sentence] of cases) {
    assert.equal(creditsStopOf(detail), stop, detail);
    assert.equal(friendlyModelError(detail), sentence, detail);
    for (const l of ['zh-CN', 'ja', 'ko']) assert.ok(messages[sentence]?.[l], `${l}: ${sentence}`);
  }
  assert.equal(creditsStopOf('quota exceeded'), null);
  assert.equal(isBillingStop('debt_limit'), true);
  const busy = friendlyModelError('503 billing_unavailable');
  for (const l of ['zh-CN', 'ja', 'ko']) assert.ok(messages[busy]?.[l], busy);
});

test('source contract: one billing notice per turn (writer and character errors, images); ClaimPrompt picks the card; the newcomer gift (not the daily) is wired', async () => {
  const world = await src('../src/state/useWorld.ts');
  assert.match(world, /if \(isBillingStop\(msg\.billing\)\) billingNotice\(msg\.billing\);\n\s*else window\.dispatchEvent/, 'writer: the billing notice instead of the raw text');
  assert.equal((world.match(/isBillingStop\(msg\.billing\)\) billingNotice/g) ?? []).length, 3, 'writer, character, image');
  assert.match(world, /if \(billingNoticeRef\.current\) return;/);
  assert.match(world, /void autoNewcomerGift\(\);\n\s*billingNoticeRef\.current = null;/, 'a new action: the newcomer gift + a fresh notice');
  const claim = await src('../src/components/chrome/DailyClaim.tsx');
  assert.match(claim, /creditsStopOf\(detail\)/);
  assert.match(claim, /mode === 'paused' \? CREDITS_PAUSED : CREDITS_SHORT/);
  const app = await src('../src/App.tsx');
  assert.match(app, /if \(layer && !launcherOpen\) void autoNewcomerGift\(\);/, 'entering a scene');
  assert.match(app, /onNewcomerGift\(\(g\) => notify\(t\('Newcomer gift: \{credits\} credits have arrived'/, 'the toast');
  for (const f of [world, app]) assert.doesNotMatch(f, /autoClaimDaily|auto-claim/, 'the daily is never claimed automatically');
});

test('newcomer gift: asked once per session (device id passed), toast only when it arrived now; already / refused / failures', async () => {
  const t = { v: Date.parse('2026-10-05T03:00:00.000Z') };
  const now = () => t.v;
  const calls = [];
  const data = (answer) => ({ claimNewcomer: async (device) => (calls.push(`gift:${device}`), answer) });
  const created = { ok: true, gift: { credits: 500, created: true, expiresAt: '2026-11-04T03:00:00.000Z', available: 500 } };
  const toasts = [];
  const off = gift.onNewcomerGift((g) => toasts.push(g.credits));
  gift.resetNewcomerGift();
  assert.equal(await gift.autoNewcomerGift({ data: data(created), device: 'dev1', now }), 'granted');
  assert.deepEqual([calls, toasts], [['gift:dev1'], [500]]);
  assert.equal(await gift.autoNewcomerGift({ data: data(created), device: 'dev1', now }), 'skipped', 'once per session');
  gift.resetNewcomerGift();
  assert.equal(await gift.autoNewcomerGift({ data: data({ ok: true, gift: { ...created.gift, created: false } }), device: 'dev1', now }), 'already');
  assert.deepEqual(toasts, [500], 'no toast for a gift received before');
  gift.resetNewcomerGift();
  assert.equal(await gift.autoNewcomerGift({ data: data({ ok: false, code: 'claim_limited' }), device: 'dev1', now }), 'refused', "billing's device cap");
  assert.equal(await gift.autoNewcomerGift({ data: data(created), device: 'dev1', now }), 'skipped', 'not asked again this session');
  gift.resetNewcomerGift();
  assert.equal(await gift.autoNewcomerGift({ data: data({ ok: false, code: 'unreachable' }), device: 'dev1', now }), 'failed');
  assert.equal(await gift.autoNewcomerGift({ data: data(created), device: 'dev1', now }), 'skipped', 'a failure waits');
  t.v += gift.RETRY_MS + 1;
  assert.equal(await gift.autoNewcomerGift({ data: data(created), device: 'dev1', now }), 'granted');
  gift.resetNewcomerGift();
  assert.equal(await gift.autoNewcomerGift({ data: null, now }), 'skipped', 'signed out');
  gift.resetNewcomerGift();
  calls.length = 0;
  const both = await Promise.all([gift.autoNewcomerGift({ data: data(created), device: 'd', now }), gift.autoNewcomerGift({ data: data(created), device: 'd', now })]);
  assert.deepEqual([both, calls.length], [['granted', 'granted'], 1], 'one request in flight shared');
  off();
});
