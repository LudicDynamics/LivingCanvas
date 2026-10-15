import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOpenAIImageProvider } from '../extensions/toolkit/image-openai-provider.ts';
import { normalizeOpenAIImageSize } from '../packages/shared/dist/index.js';
const env = { OPENAI_API_KEY: 'test-only', AIRP_IMAGE_BASE_URL: 'https://images.example.test/v1/' };
const req = { prompt: 'A cabin', width: 1024, height: 1024 };
test('upstream diagnostics preserve the cause but redact credentials and prompt', async () => {
  const provider = createOpenAIImageProvider('test', env, async () => Response.json({ error: {
    code: 'invalid_size', param: 'size', type: 'invalid_request_error',
    message: 'Unsupported 1024x576 test-only Bearer other-secret sk-secret A cabin',
  }, request: { prompt: 'must not log' } }, { status: 400 }));
  const result = await provider.generate({ ...req, height: 576 }, {});
  assert.equal(result.ok, false);
  assert.match(result.message, /HTTP 400.*size=1536x1024.*invalid_size.*param=size/);
  assert.doesNotMatch(result.message, /test-only|other-secret|sk-secret|A cabin|must not log/);
});
test('gateway HTML is not copied into logs', async () => {
  const result = await createOpenAIImageProvider('test', env, async () => new Response('<html>secret diagnostic dump</html>', { status: 502 })).generate(req, {});
  assert.match(result.message, /HTTP 502/);
  assert.doesNotMatch(result.message, /secret diagnostic/);
});
for (const edit of [false, true]) test(edit ? 'reference uses multipart edits' : 'generation uses JSON', async () => {
  const provider = createOpenAIImageProvider('test-image', env, async (url, init) => {
    assert.equal(url, `https://images.example.test/v1/images/${edit ? 'edits' : 'generations'}`);
    assert.equal(init.headers.Authorization, 'Bearer test-only');
    if (edit) { assert.ok(init.body instanceof FormData); assert.ok(init.body.get('image') instanceof Blob); }
    else assert.deepEqual(JSON.parse(init.body), { model: 'test-image', prompt: 'A cabin', n: 1, output_format: 'png', size: '1024x1024', quality: 'medium' });
    return Response.json({ data: [{ b64_json: 'aGk=' }] });
  });
  assert.equal((await provider.generate({ ...req, ...(edit ? { reference: { dataB64: 'aGk=', mimeType: 'image/png' } } : {}) }, {})).ok, true);
});
test('missing credentials, empty response and HTTP failures do not fake success', async () => {
  assert.equal((await createOpenAIImageProvider('test', {}).generate(req, {})).reason, 'no_credentials');
  for (const [response, reason] of [[Response.json({ data: [] }), 'no_image'], [new Response('', { status: 429 }), 'provider_error']]) {
    let calls = 0;
    const result = await createOpenAIImageProvider('test', env, async () => { calls++; return response; }).generate(req, {});
    assert.equal(result.reason, reason); assert.equal(calls, 1);
  }
});
test('cancellation and timeout remain distinct', async () => {
  const controller = new AbortController(); controller.abort();
  assert.equal((await createOpenAIImageProvider('test', env, async () => { throw Error('must not call'); }).generate(req, { signal: controller.signal })).reason, 'aborted');
  const provider = createOpenAIImageProvider('test', env, async (_url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Error('aborted')), { once: true })));
  assert.equal((await provider.generate(req, { timeoutMs: 5 })).reason, 'timeout');
});
test('sizes snap to the three gpt-image buckets', async () => {
  const cases = [[1024, 1024, '1024x1024'], [1024, 576, '1536x1024'], [1920, 1080, '1536x1024'], [576, 1024, '1024x1536'],
    [768, 1024, '1024x1536'], [1100, 1000, '1024x1024'], [256, 256, '1024x1024'], [4096, 4096, '1024x1024'], [1536, 1024, '1536x1024'], [0, 1, '1024x1024']];
  for (const [w, h, want] of cases) assert.equal(normalizeOpenAIImageSize(w, h), want, `${w}x${h}`);
  let sent;
  await createOpenAIImageProvider('gpt-image-1', env, async (_u, init) => { sent = JSON.parse(init.body); return Response.json({ data: [{ b64_json: 'aGk=' }] }); })
    .generate({ prompt: 'p', width: 2048, height: 512 }, {});
  assert.equal(sent.size, '1536x1024');
});
test('quality defaults to medium; AIRP_IMAGE_QUALITY still overrides', async () => {
  for (const [extra, want] of [[{}, 'medium'], [{ AIRP_IMAGE_QUALITY: 'low' }, 'low'], [{ AIRP_IMAGE_QUALITY: ' ' }, 'medium']]) {
    let sent;
    await createOpenAIImageProvider('gpt-image-1', { ...env, ...extra }, async (_u, init) => { sent = JSON.parse(init.body); return Response.json({ data: [{ b64_json: 'aGk=' }] }); }).generate(req, {});
    assert.equal(sent.quality, want);
  }
});
