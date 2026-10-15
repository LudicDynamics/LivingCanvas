// credit-ready, the Node side of a writer / character turn hitting the wallet gate. Runs against
// built dist: `pnpm build` first. The chain: ai answers 402 → gatewayFetch (local app / agents' loopback proxy)
// rewrites it into the friendly, non-retryable stop (same text as the browser runtime) → the openai SDK's error text
// → pi does not retry → the agent's message_end error → mapEngineEvent's `error` frame names the stop (`billing`) →
// the page's notice + card (apps/web/test/credit-stops.test.mjs) — for the writer and a character alike.
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';
import { CREDITS_MESSAGES, billingStopOf, billingStopResponse, gatewayFetch, quotaErrorOf } from '../dist/ai-gateway.js';
import { mapEngineEvent } from '../dist/engine/event-bridge.js';

globalThis.__airpAccountToken = async () => 'acct';
process.env.AIRP_REMOTE_CONFIG = path.join(os.tmpdir(), `airp-credit-stops-none-${process.pid}.json`);
const jiti = createJiti(import.meta.url, { moduleCache: false });
const { isRetryableAssistantError } = await jiti.import('../../../vendor/pi-rp/packages/ai/src/utils/retry.ts');
const { APIError } = await import('../../../vendor/pi-rp/node_modules/openai/index.mjs');

const refusal = (reason) => new Response(JSON.stringify({ error: { message: 'raw', code: 'insufficient_credits', kind: 'chat', reason, billing_url: 'https://billing.worldlines.gg/subscribe?reason=quota' } }), { status: 402, headers: { 'content-type': 'application/json' } });
const frames = (source, event, characterId) => mapEngineEvent(source, event, new Map(), characterId, new Map(), `orphan:${source}`, undefined).map(({ timestamp: _t, ...rest }) => rest);

test('writer / character turn → 402 → one clean error frame naming the stop; never retried', async () => {
  for (const [reason, stop] of [['claim_required', 'claim_required'], ['insufficient_credits', 'insufficient_credits'], ['debt_limit', 'debt_limit']]) {
    const res = await gatewayFetch({ base: 'https://ai.test/v1', apiKey: 'worldlines-account', account: true }, 'https://ai.test/v1/chat/completions', { method: 'POST', body: '{}' }, async () => refusal(reason));
    assert.equal(res.status, 402);
    const body = await res.json();
    assert.deepEqual([body.error.code, body.error.reason, body.error.message], ['insufficient_credits', reason, CREDITS_MESSAGES[reason]]);
    assert.equal(body.error.billing_url, 'https://billing.worldlines.gg/subscribe?reason=quota');
    const sdk = APIError.generate(402, body, undefined, new Headers());
    assert.equal(isRetryableAssistantError({ stopReason: 'error', errorMessage: sdk.message }), false, `${reason}: pi stops`);
    for (const [source, characterId] of [['writer', undefined], ['character', 'alice']]) {
      const out = frames(source, { type: 'message_end', message: { role: 'assistant', content: [], stopReason: 'error', errorMessage: sdk.message } }, characterId);
      const err = out.find((f) => f.type === 'error');
      assert.ok(err, `${source} ${reason}`);
      assert.equal(err.billing, stop, `${source} ${reason}`);
      assert.equal(err.source, source);
      assert.equal(out.filter((f) => f.type === 'error').length, 1);
    }
  }
  const plain = frames('writer', { type: 'message_end', message: { role: 'assistant', content: [], stopReason: 'error', errorMessage: '500 upstream broke' } });
  assert.equal(plain.find((f) => f.type === 'error').billing, undefined, 'other errors unchanged');
});

test('billingStopResponse: idempotent, other statuses untouched; media routes keep their codes (debt_limit too)', async () => {
  const once = await billingStopResponse(refusal('debt_limit'));
  const twice = await billingStopResponse(once.clone());
  assert.deepEqual(await twice.json(), await once.json());
  const ok = new Response('x', { status: 200 });
  assert.equal(await billingStopResponse(ok), ok);
  const q = await quotaErrorOf(await billingStopResponse(refusal('debt_limit')));
  assert.equal(q.code, 'debt_limit');
  assert.equal(billingStopOf(CREDITS_MESSAGES.debt_limit), 'debt_limit');
  assert.equal(billingStopOf(CREDITS_MESSAGES.claim_required), 'claim_required');
});
