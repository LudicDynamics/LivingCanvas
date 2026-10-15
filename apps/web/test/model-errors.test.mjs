// Gateway errors a player can act on become plain sentences with translations.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';
const { friendlyModelError } = await createJiti(import.meta.url, { moduleCache: false }).import('../src/lib/model-errors.ts');
const messages = JSON.parse(await readFile(new URL('../src/lib/messages.json', import.meta.url), 'utf8'));

test('quota, sign-in and cut stream map to translated sentences; anything else stays raw', () => {
  const cases = [
    '429: {"message":"Your plan (quota exceeded).","code":"quota_exceeded"}',
    '401: {"code":"auth_required"}',
    'network error: the model stream was cut (terminated); retrying is safe',
  ];
  for (const raw of cases) {
    const key = friendlyModelError(raw);
    assert.ok(key, raw);
    assert.ok(messages[key]?.['zh-CN'] && messages[key]?.ja, `translated: ${key}`);
  }
  assert.equal(friendlyModelError('The writer could not finish this turn.'), null);
});

test('billing stops (image / TTS / STT notices): insufficient_credits has its own translated sentence; claim_required wins', async () => {
  const { isBillingStop } = await createJiti(import.meta.url, { moduleCache: false }).import('../src/lib/model-errors.ts');
  const short = friendlyModelError('insufficient_credits');
  assert.ok(short && messages[short]?.['zh-CN'] && messages[short]?.ja && messages[short]?.ko, short);
  assert.equal(friendlyModelError('402: {"code":"insufficient_credits","reason":"claim_required"}'), friendlyModelError('claim_required'));
  for (const code of ['quota_exceeded', 'claim_required', 'insufficient_credits']) assert.equal(isBillingStop(code), true);
  assert.equal(isBillingStop('tts_unconfigured'), false);
  const world = await readFile(new URL('../src/state/useWorld.ts', import.meta.url), 'utf8');
  assert.match(world, /isBillingStop\(msg\.billing\)\) billingNotice\(msg\.billing\)/);
  assert.match(world, /const billingNotice = [\s\S]{0,200}airp:notice/);
  const claim = await readFile(new URL('../src/components/chrome/DailyClaim.tsx', import.meta.url), 'utf8');
  assert.match(claim, /insufficient_credits[\s\S]*openAccountPanel\(\)/);
});
