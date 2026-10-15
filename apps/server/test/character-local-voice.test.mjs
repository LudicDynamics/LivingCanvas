import { test } from 'node:test';
import assert from 'node:assert/strict';
import { characterLocalVoice, parseCharacterVoices } from '../dist/routes/local-tts.js';

test('no character shares the local voice by gender or voice category', () => {
  // The local service speaks with ONE voice; routing every female character to
  // it made the whole cast sound like setsuna. Only an explicit override routes.
  const old = process.env.AIRP_TTS_CHARACTER_VOICES;
  delete process.env.AIRP_TTS_CHARACTER_VOICES;
  try {
    assert.equal(characterLocalVoice('vera', 'playful-teasing'), null);
    assert.equal(characterLocalVoice('nanami', 'shy-sweet'), null);
    assert.equal(characterLocalVoice('new-person', 'gentle-calm', 'female'), null);
    assert.equal(characterLocalVoice('man', 'wise-elder'), null);
    assert.equal(characterLocalVoice('unknown', undefined), null);
    assert.equal(characterLocalVoice('man', 'gentle-calm', 'male'), null);
  } finally { if (old !== undefined) process.env.AIRP_TTS_CHARACTER_VOICES = old; }
});
test('per-character overrides and opt-out take priority', () => {
  const old = process.env.AIRP_TTS_CHARACTER_VOICES;
  process.env.AIRP_TTS_CHARACTER_VOICES = 'vera=custom,nanami=online';
  try {
    assert.equal(characterLocalVoice('vera', 'playful-teasing'), 'custom');
    assert.equal(characterLocalVoice('nanami', 'shy-sweet'), null);
    assert.throws(() => parseCharacterVoices('vera=../../private'));
    assert.throws(() => parseCharacterVoices('__proto__=voice'));
  } finally { if (old === undefined) delete process.env.AIRP_TTS_CHARACTER_VOICES; else process.env.AIRP_TTS_CHARACTER_VOICES = old; }
});
