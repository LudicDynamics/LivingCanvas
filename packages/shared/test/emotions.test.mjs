/**
 * Emotion-differential rules — the list and path
 * convention are pure, so they are tested against the built `dist/` directly
 *.
 *
 * These defend the two failures that would ship silently:
 *   1. the shared enum drifting from the `[emo: tag]` vocabulary the parser
 *      accepts (`normal/smile/shock/sad/angry/thinking`) — a mismatch means a
 *      tag the model emits is never a key in the portrait map, so the face
 *      silently freezes on `normal`;
 *   2. the server probe and the web client reading DIFFERENT path conventions.
 *      `emotionPortraitsOf` is the ONE place that assembles `<id>/<emo>.webp`;
 *      if it changes, both ends change together.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { EMOTIONS, isEmotion, emotionPortraitsOf } from '../dist/index.js';

test('the six emotions are exactly the parser vocabulary, in order', () => {
  // Lockstep with apps/web/src/components/overlay/dialogue-pages.ts EMO_TAGS.
  assert.deepEqual(EMOTIONS, ['normal', 'smile', 'shock', 'sad', 'angry', 'thinking']);
});

test('isEmotion narrows the six and rejects everything else', () => {
  for (const e of EMOTIONS) assert.equal(isEmotion(e), true, e);
  for (const bad of ['', 'happy', 'Normal', 'thinking ', 42, null, undefined, {}]) {
    assert.equal(isEmotion(bad), false, String(bad));
  }
});

test('emotionPortraitsOf names a complete, non-colliding six-file set', () => {
  const p = emotionPortraitsOf('watson');
  assert.deepEqual(Object.keys(p).sort(), [...EMOTIONS].sort());
  const values = Object.values(p);
  assert.equal(new Set(values).size, 6, 'portrait paths must be distinct');
  for (const v of values) {
    assert.match(v, /^assets\/characters\/watson\/[a-z]+\.webp$/);
  }
});

test('the convention is <id>/<emo>.webp — a rename here is a rename everywhere', () => {
  // Non-emptiness: if the dir or suffix changes, this fails and both the server
  // probe (world.ts /characters) and the modal `<img src>` must be revisited.
  assert.equal(emotionPortraitsOf('edith').smile, 'assets/characters/edith/smile.webp');
  assert.equal(emotionPortraitsOf('nanami').thinking, 'assets/characters/nanami/thinking.webp');
});
