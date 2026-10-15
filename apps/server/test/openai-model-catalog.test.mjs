import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { discoverModels, ModelCatalogError, validateCatalogUrl, officialOpenAIModel, readCatalogSnapshot, readCatalogGeneration, writeCatalogSnapshot, writeCatalogGeneration, OFFICIAL_OPENAI_PROVIDER, OFFICIAL_OPENAI_MODEL } from '../dist/engine/openai-model-catalog.js';
const response = (body, init = {}) => new Response(body, init);

test('catalog discovery accepts user-configured loopback endpoints and applies safe metadata defaults', async () => {
  let requestedUrl = '';
  let authorization = '';
  const result = await discoverModels({ baseUrl: 'http://127.0.0.1:8080/v1/', apiKey: 'private-test-secret' }, async (url, init) => {
    requestedUrl = String(url);
    authorization = init.headers.Authorization;
    return response(JSON.stringify({ data: [
      { id: 'alpha', name: 'Alpha', context_window: 64000, max_tokens: 4000 },
      { id: 'beta' },
      { id: 'alpha' },
      { name: 'missing-id' },
    ] }));
  });
  assert.equal(requestedUrl, 'http://127.0.0.1:8080/v1/models');
  assert.equal(authorization, 'Bearer private-test-secret');
  assert.deepEqual(result.models, [
    { id: 'alpha', name: 'Alpha', contextWindow: 64000, maxTokens: 4000 },
    { id: 'beta', name: 'beta', contextWindow: 128000, maxTokens: 8192 },
  ]);
});

test('catalog discovery rejects URL credentials, redirects, malformed payloads, and empty catalogs without details', async () => {
  assert.throws(() => validateCatalogUrl('https://user:pass@example.test/v1'), error => error instanceof ModelCatalogError && error.category === 'invalid-url');
  await assert.rejects(discoverModels({ baseUrl: 'https://endpoint.example/v1', apiKey: 'secret' }, async () => response('', { status: 302 })), error => error.category === 'redirect');
  await assert.rejects(discoverModels({ baseUrl: 'https://endpoint.example/v1', apiKey: 'secret' }, async () => response('{"data":{}}')), error => error.category === 'invalid-response');
  await assert.rejects(discoverModels({ baseUrl: 'https://endpoint.example/v1', apiKey: 'secret' }, async () => response('{"data":[{"id":" "}]}')), error => error.category === 'empty-catalog');
});

test('catalog discovery caps declared and streamed response sizes', async () => {
  await assert.rejects(discoverModels({ baseUrl: 'https://endpoint.example/v1', apiKey: 'secret' }, async () => response('', { headers: { 'content-length': '1048577' } })), error => error.category === 'response-too-large');
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(1_048_577)); controller.close(); } });
  await assert.rejects(discoverModels({ baseUrl: 'https://endpoint.example/v1', apiKey: 'secret' }, async () => new Response(stream)), error => error.category === 'response-too-large');
});
test('official OpenAI model identity is singular and committed snapshots are generation-bound', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-openai-snapshot-'));
  try {
    const model = officialOpenAIModel();
    assert.equal(`${OFFICIAL_OPENAI_PROVIDER}/${model.id}`, `${OFFICIAL_OPENAI_PROVIDER}/${OFFICIAL_OPENAI_MODEL}`);
    assert.equal(model.api, 'openai-responses');
    assert.equal(model.baseUrl, 'https://api.openai.com/v1');
    const snapshot = { generation: 4, baseUrl: 'http://127.0.0.1:9900/v1', models: [{ id: 'local', name: 'Local', contextWindow: 128000, maxTokens: 8192 }] };
    writeCatalogSnapshot(root, snapshot);
    writeCatalogGeneration(root, 4);
    assert.deepEqual(readCatalogSnapshot(root), snapshot);
    assert.equal(readCatalogGeneration(root), 4);
    writeCatalogGeneration(root, 5);
    assert.equal(readCatalogSnapshot(root)?.generation, 4);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
