import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { deliveryInstructions, hashOf, synthesise } from '../dist/routes/tts.js';

const WAV = Buffer.from('RIFF0000WAVEfmt ');

test('delivery is model-gated and changes instruct-model cache keys only', () => {
  assert.equal(deliveryInstructions('qwen3-tts-flash', 'Cherry'), '');
  const instruction = deliveryInstructions('qwen3-tts-instruct-flash', 'Cherry');
  assert.match(instruction, /not a child voice/);
  assert.equal(
    hashOf('m', 'v', 'English', 'Hello'),
    createHash('sha256').update('m|v|English|Hello').digest('hex').slice(0, 20),
  );
  assert.notEqual(hashOf('m', 'v', 'English', 'Hello'), hashOf('m', 'v', 'English', 'Hello', instruction));
});

test('instruct delivery stays separate from spoken text and maps Japanese explicitly', async () => {
  const previous = globalThis.fetch;
  let request;
  globalThis.fetch = async (_url, options) => {
    if (options?.body) {
      request = JSON.parse(options.body);
      return new Response(JSON.stringify({ output: { audio: { url: 'https://audio.invalid/test.wav' } } }));
    }
    return new Response(WAV);
  };
  try {
    await synthesise({
      model: 'qwen3-tts-instruct-flash',
      text: 'どうしたの？',
      voice: 'Cherry',
      languageType: 'Japanese',
      apiKey: 'test-only',
      baseUrl: 'https://tts.invalid',
      timeoutMs: 1000,
    });
    assert.equal(request.input.text, 'どうしたの？');
    assert.equal(request.input.language_type, 'Japanese');
    assert.match(request.input.instructions, /comfortable conversational pace/);
    assert.equal(request.input.optimize_instructions, false);
  } finally {
    globalThis.fetch = previous;
  }
});

test('delivery rejects an upstream response that has no audio URL', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ output: {} }));
  try {
    await assert.rejects(
      synthesise({
        model: 'qwen3-tts-instruct-flash',
        text: 'hello',
        voice: 'Cherry',
        languageType: 'English',
        apiKey: 'test-only',
        baseUrl: 'https://tts.invalid',
        timeoutMs: 1000,
      }),
      /no output\.audio\.url/,
    );
  } finally {
    globalThis.fetch = previous;
  }
});
