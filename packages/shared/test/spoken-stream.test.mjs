// A voice call's reply streams in (apps/server/src/engine/voice-fast-brain.ts,
// voice-live-brain.ts): what goes to voice-live for SPEECH is cleaned piece by
// piece (createSpokenStream); the subtitles / history keep the raw text elsewhere.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSpokenStream } from '../dist/rules/tts-text.js';

const spokenOf = (chunks, options) => {
  const stream = createSpokenStream(options);
  const out = [];
  for (const chunk of chunks) {
    const piece = stream.push(chunk);
    if (piece) out.push(piece);
  }
  const tail = stream.end();
  if (tail) out.push(tail);
  return out;
};

test('stage directions split across deltas are dropped; the words stay', () => {
  const out = spokenOf(['我是千鹤，', '这间旅店的女将。\n（把茶碗', '推过去）天凉，喝口热的。']);
  const said = out.join('');
  assert.equal(said.includes('茶碗'), false, 'the action is never spoken');
  assert.equal(said.includes('（') || said.includes('）'), false);
  assert.match(said, /我是千鹤，这间旅店的女将。/);
  assert.match(said, /天凉，喝口热的。$/);
  assert.equal(out[0], '我是千鹤，', 'the first clause leaves at once, before the reply is complete');
});

test('every bracket style and asterisks; an unclosed bracket speaks nothing', () => {
  assert.equal(spokenOf(['【叹气】', '好的。']).join(''), '好的。');
  assert.equal(spokenOf(['(laughs) ', 'Sure.']).join(''), 'Sure.');
  assert.equal(spokenOf(['Hello, *pushes the', ' cup over* have some tea.']).join(''), 'Hello, have some tea.');
  assert.equal(spokenOf(['[emo: 微笑]好', '的']).join(''), '好的', 'a non-ASCII emo tag is a bracket, never spoken');
  assert.deepEqual(spokenOf(['（未闭合', '的话']), [], 'fail-closed, like sanitiseTtsText');
  assert.equal(spokenOf(['千鹤低下头。', '你来了。'], { names: ['千鹤'] }).join(''), '你来了。', 'unmarked narration by name');
});

test("voice-live's own [emo: word] tag stays at the front of its piece (voice-live reads it, never speaks it)", () => {
  assert.equal(spokenOf(['[emo: smile] 我是', '千鹤。']).join(''), '[emo: smile]我是千鹤。');
});

test('nothing is held back while no bracket is open', () => {
  const stream = createSpokenStream();
  assert.equal(stream.push('你好。'), '你好。');
  assert.equal(stream.push('（'), '');
  assert.equal(stream.push('笑）'), '');
  assert.equal(stream.push('再见'), '');
  assert.equal(stream.end(), '再见');
});
