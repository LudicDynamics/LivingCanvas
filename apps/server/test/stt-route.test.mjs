// Voice input — /api/stt server assertions.
// Runs against built dist: `pnpm build` first.
// The OpenAI transcription endpoint is REPLACED by a local stub: readSttConfig()
// reads env per request, so setting OPENAI_BASE_URL after import redirects it.
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { test } from 'node:test';
import { createSttRouter, audioExtension } from '../dist/routes/stt.js';

const AUDIO = Buffer.from('OggS fake opus frames');

/** Stub transcription API: captures the multipart request, answers with `reply`. */
async function openAiStub({ status = 200, reply = { text: ' こんにちは ' } } = {}) {
  const calls = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      calls.push({ url: req.url, auth: req.headers.authorization, type: req.headers['content-type'], body: Buffer.concat(chunks).toString('latin1') });
      res.statusCode = status;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(status === 200 ? reply : { error: { message: 'stub failure' } }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${server.address().port}/v1`, calls, close: () => new Promise((r) => server.close(r)) };
}

async function harness(env) {
  const saved = { ...process.env };
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_BASE_URL;
  delete process.env.AIRP_STT_MODEL;
  Object.assign(process.env, env);
  const app = express();
  app.use(express.json());
  app.use('/api', createSttRouter());
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const url = `http://127.0.0.1:${server.address().port}/api`;
  return {
    url,
    async close() {
      await new Promise((r) => server.close(r));
      process.env = saved;
    },
  };
}

const post = (url, body, type = 'audio/webm;codecs=opus') =>
  fetch(url, { method: 'POST', headers: { 'content-type': type }, body });

test('config reports availability without exposing the key', async () => {
  const h = await harness({ OPENAI_API_KEY: 'sk-secret', AIRP_STT_MODEL: 'whisper-1' });
  try {
    const body = await (await fetch(`${h.url}/stt/config`)).json();
    assert.deepEqual(body, { available: true, model: 'whisper-1' });
    assert.doesNotMatch(JSON.stringify(body), /sk-secret/);
  } finally { await h.close(); }
});

test('a recording is forwarded as multipart with model and language, and the trimmed text returns', async () => {
  const stub = await openAiStub();
  const h = await harness({ OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: `${stub.base}/` });
  try {
    const res = await post(`${h.url}/stt?language=ja`, AUDIO);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, text: 'こんにちは' });
    assert.equal(stub.calls.length, 1);
    const [call] = stub.calls;
    assert.equal(call.url, '/v1/audio/transcriptions');
    assert.equal(call.auth, 'Bearer sk-test');
    assert.match(call.type, /^multipart\/form-data; boundary=/);
    assert.match(call.body, /name="model"\r\n\r\ngpt-4o-transcribe/);
    assert.match(call.body, /name="language"\r\n\r\nja/);
    assert.match(call.body, /name="file"; filename="speech\.webm"/);
  } finally { await h.close(); await stub.close(); }
});

test('an unknown language hint is dropped so the model auto-detects', async () => {
  const stub = await openAiStub();
  const h = await harness({ OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: stub.base });
  try {
    assert.equal((await post(`${h.url}/stt?language=klingon`, AUDIO)).status, 200);
    assert.doesNotMatch(stub.calls[0].body, /name="language"/);
  } finally { await h.close(); await stub.close(); }
});

test('no key is 503 and nothing is sent upstream', async () => {
  const stub = await openAiStub();
  const h = await harness({ OPENAI_BASE_URL: stub.base });
  try {
    const res = await post(`${h.url}/stt`, AUDIO);
    assert.equal(res.status, 503);
    assert.equal((await res.json()).code, 'stt_unavailable');
    assert.equal(stub.calls.length, 0);
  } finally { await h.close(); await stub.close(); }
});

test('empty or non-audio bodies are 400', async () => {
  const stub = await openAiStub();
  const h = await harness({ OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: stub.base });
  try {
    assert.equal((await post(`${h.url}/stt`, Buffer.alloc(0))).status, 400);
    assert.equal((await post(`${h.url}/stt`, 'hello', 'text/plain')).status, 400);
    assert.equal(stub.calls.length, 0);
  } finally { await h.close(); await stub.close(); }
});

test('an upstream failure is 502 with a generic message', async () => {
  const stub = await openAiStub({ status: 401 });
  const h = await harness({ OPENAI_API_KEY: 'sk-bad', OPENAI_BASE_URL: stub.base });
  try {
    const res = await post(`${h.url}/stt`, AUDIO);
    assert.equal(res.status, 502);
    const body = await res.json();
    assert.equal(body.code, 'stt_failed');
    assert.doesNotMatch(JSON.stringify(body), /sk-bad|127\.0\.0\.1/);
  } finally { await h.close(); await stub.close(); }
});

test('upload extension follows the recorder container', () => {
  assert.equal(audioExtension('audio/webm'), 'webm');
  assert.equal(audioExtension('audio/mp4'), 'mp4');
  assert.equal(audioExtension('audio/ogg'), 'ogg');
  assert.equal(audioExtension('text/plain'), null);
});
