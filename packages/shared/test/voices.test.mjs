/**
 * Voice-palette rules — the resolver is pure, so it is tested
 * against the built `dist/` directly.
 *
 * These defend the three failures that actually shipped (07 §0), not the
 * implementation: an alias resolves to its wire id; a raw palette id passes
 * through unchanged; and a NEAR-MISS (`Eldric`, `Sage`) resolves to null rather
 * than being silently accepted.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { VOICES, VOICE_COUNT, resolveVoice, voiceEntry } from '../dist/index.js';

test('palette is non-empty and aliases/ids are unique', () => {
  assert.ok(VOICE_COUNT > 0);
  const aliases = VOICES.map((v) => v.alias);
  const ids = VOICES.map((v) => v.id);
  assert.equal(new Set(aliases).size, aliases.length, 'alias collision');
  assert.equal(new Set(ids).size, ids.length, 'id collision');
});

test('every alias resolves to its own wire id, and every id resolves to itself', () => {
  for (const v of VOICES) {
    assert.equal(resolveVoice(v.alias), v.id, `alias ${v.alias}`);
    assert.equal(resolveVoice(v.id), v.id, `id ${v.id}`);
  }
});

test('an effect alias carries the meaning, not the proper name (07 §2)', () => {
  assert.equal(resolveVoice('wise-elder'), 'Eldric Sage');
  assert.equal(resolveVoice('hoarse-weathered'), 'Vincent');
  assert.equal(resolveVoice('news-anchor'), 'Neil');
});

test('a raw id with a SPACE resolves unchanged (07 §0 regression)', () => {
  // The old regex `/^[A-Za-z0-9_-]+$/` rejected this and silently fell back to
  // the default voice, muting the character in a way no log made obvious.
  assert.equal(resolveVoice('Eldric Sage'), 'Eldric Sage');
  assert.equal(resolveVoice('Ono Anna'), 'Ono Anna');
  assert.equal(resolveVoice('Radio Gol'), 'Radio Gol');
});

test('a near-miss is NOT silently accepted — it resolves to null', () => {
  // `Eldric` and `Sage` are the two halves of `Eldric Sage`. Both were once
  // declared in real READMEs and both 400'd upstream → silent pages.
  assert.equal(resolveVoice('Eldric'), null);
  assert.equal(resolveVoice('Sage'), null);
  assert.equal(resolveVoice('cherry'), null, 'ids are case-sensitive');
  assert.equal(resolveVoice('Wise Elder'), null, 'aliases are kebab-case');
  assert.equal(resolveVoice(''), null);
  assert.equal(resolveVoice('nonexistent-voice'), null);
});

test('voiceEntry looks up by either vocabulary', () => {
  assert.equal(voiceEntry('wise-elder')?.id, 'Eldric Sage');
  assert.equal(voiceEntry('Eldric Sage')?.id, 'Eldric Sage');
  assert.equal(voiceEntry('Eldric'), undefined);
  assert.equal(voiceEntry('wise-elder')?.gender, 'male');
});
