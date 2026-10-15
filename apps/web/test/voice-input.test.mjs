// Voice input capture helpers.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const voice = await createJiti(import.meta.url, { moduleCache: false }).import('../src/lib/voice-input.ts');

test('48kHz capture resamples to 24kHz without dropping or duplicating across chunks', () => {
  const resampler = new voice.LinearResampler(48000, 24000);
  let total = 0;
  for (let chunk = 0; chunk < 10; chunk += 1) total += resampler.process(new Float32Array(4800).fill(0.5)).length;
  assert.ok(Math.abs(total - 24000) <= 1, `expected ~24000 samples, got ${total}`);
});

test('resampling interpolates on the continuous signal, carrying the last sample', () => {
  const resampler = new voice.LinearResampler(48000, 24000);
  assert.deepEqual([...resampler.process(Float32Array.from([0, 1, 2, 3, 4, 5, 6, 7]))], [0, 1, 3, 5]);
  // The next chunk continues from 7 at an even step: 7, then 9, 11 …
  assert.deepEqual([...resampler.process(Float32Array.from([8, 9, 10, 11]))], [7, 9]);
});

test('equal rates pass audio through untouched', () => {
  const input = Float32Array.from([0.1, -0.2, 0.3]);
  assert.equal(new voice.LinearResampler(24000, 24000).process(input), input);
});

test('float samples clamp into PCM16', () => {
  assert.deepEqual([...voice.floatToPcm16(Float32Array.from([1, -1, 0, 2, -2]))], [32767, -32768, 0, 32767, -32768]);
});

test('a completed utterance replaces its deltas and order is kept', () => {
  const text = new voice.TranscriptAssembler();
  text.delta('a', 'こん');
  text.delta('b', 'また');
  text.delta('a', 'にち');
  assert.equal(text.value, 'こんにち また');
  assert.equal(text.settled, false);
  text.complete('a', 'こんにちは');
  text.complete('b', 'またね');
  assert.equal(text.value, 'こんにちは またね');
  assert.equal(text.settled, true);
  assert.equal(voice.joinDraft('Hello', 'world'), 'Hello world');
  assert.equal(voice.joinDraft('', 'world'), 'world');
});
