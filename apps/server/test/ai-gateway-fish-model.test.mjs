// Fish through ai.worldlines.gg is on by default (fish-s2.1-pro, platform migration 0022); AIRP_AI_TTS_FISH_MODEL overrides
// it and `off` switches it off. Runs against built dist: `pnpm build`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_GATEWAY_FISH_MODEL, aiModels } from '../dist/ai-gateway.js';

test('the service Fish model: default fish-s2.1-pro, overridable, `off` turns it off, an empty .env line keeps the default', () => {
  assert.equal(DEFAULT_GATEWAY_FISH_MODEL, 'fish-s2.1-pro');
  assert.equal(aiModels({}).ttsFish, 'fish-s2.1-pro');
  assert.equal(aiModels({ AIRP_AI_TTS_FISH_MODEL: '' }).ttsFish, 'fish-s2.1-pro');
  assert.equal(aiModels({ AIRP_AI_TTS_FISH_MODEL: 'fish-s2-pro' }).ttsFish, 'fish-s2-pro');
  for (const off of ['off', 'OFF', 'none', '0', 'false']) assert.equal(aiModels({ AIRP_AI_TTS_FISH_MODEL: off }).ttsFish, '', off);
  assert.equal(aiModels({ AIRP_AI_TTS_MODEL: 'fish-s1' }).ttsFish, 'fish-s1', 'the older single-variable form still works');
  assert.equal(aiModels({}).tts, 'qwen3-tts-flash', 'qwen stays the qwen model');
});
