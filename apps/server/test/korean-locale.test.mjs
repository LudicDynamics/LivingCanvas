// Korean (ko, 2026-10-03) on the server: the player's language reaches the
// workshop, the intro, the synced settings, TTS/STT and the realtime call.
// Runs against built dist: `pnpm build`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanSettings } from '../dist/sync/account-data.js';
import { WORKSHOP_LOCALES } from '../dist/world-workshop.js';
import { playerReadmeWithIntro, suggestIntroPrompt } from '../dist/world-intro.js';
import { receiptLine } from '../dist/engine/character-duplex.js';
import { buildLiveInstructions } from '../dist/engine/live-session.js';
import { LiveSessionInputSchema } from '../../../packages/shared/dist/index.js';

test('the synced interface language may be Korean', () => {
  assert.equal(cleanSettings({ locale: 'ko' }).locale, 'ko');
  assert.equal(cleanSettings({ locale: 'ko-KR' }).locale, undefined);
});

test('a world can be made in Korean, and its intro is written in Korean', () => {
  assert.ok(WORKSHOP_LOCALES.includes('ko'));
  const readme = playerReadmeWithIntro(null, { identity: '탐정', goal: '진상', first: '단서' }, 'ko');
  assert.match(readme, /당신은 누구인가/);
  assert.match(suggestIntroPrompt({ name: 'X', description: 'Y', locale: 'ko' }, { identity: '', goal: '', first: '' }), /Write every value in Korean/);
});

test('a realtime call can be primed in Korean', () => {
  assert.ok(LiveSessionInputSchema.safeParse({ character: 'vera', sdp: 'v=0', language: 'ko', savePath: '/saves/a' }).success);
  const text = buildLiveInstructions({ name: '베라', language: 'ko' });
  assert.match(text, /^당신은 베라입니다\./);
  assert.match(text, /Delegation policy:/, 'the API labels stay verbatim');
  assert.equal(receiptLine([{ tool: 'roll_dice', ok: true }], 'ko'), '(완료: 주사위를 굴렸어요)');
});
