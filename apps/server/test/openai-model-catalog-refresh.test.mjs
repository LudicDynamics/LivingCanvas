import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { AgentLifecycleManager } from '../dist/engine/lifecycle.js';
import { readCatalogGeneration, readCatalogSnapshot, OFFICIAL_OPENAI_MODEL, OFFICIAL_OPENAI_PROVIDER } from '../dist/engine/openai-model-catalog.js';

const ENV_NAMES = [
  'AIRP_CUSTOM_OPENAI_PENDING_BASE_URL', 'AIRP_CUSTOM_OPENAI_PENDING_API_KEY', 'AIRP_CUSTOM_OPENAI_PENDING_GENERATION',
  'AIRP_CUSTOM_OPENAI_BASE_URL', 'AIRP_CUSTOM_OPENAI_API_KEY', 'AIRP_CUSTOM_OPENAI_GENERATION', 'OPENAI_API_KEY', 'OPENAI_BASE_URL',
];

async function withEnv(callback) {
  const previous = Object.fromEntries(ENV_NAMES.map(name => [name, process.env[name]]));
  for (const name of ENV_NAMES) delete process.env[name];
  try { await callback(); }
  finally {
    for (const name of ENV_NAMES) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
}

function startEndpoint(handler) {
  const server = createServer(handler);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}/v1` });
    });
  });
}

function fakeWriterModels(repoRoot) {
  const snapshot = readCatalogSnapshot(repoRoot);
  const activeGeneration = Number.parseInt(process.env.AIRP_CUSTOM_OPENAI_GENERATION ?? '', 10);
  const activeBaseUrl = process.env.AIRP_CUSTOM_OPENAI_BASE_URL?.replace(/\/+$/, '');
  const models = [{ provider: OFFICIAL_OPENAI_PROVIDER, id: OFFICIAL_OPENAI_MODEL, name: 'GPT-6 Luna' }];
  if (snapshot && snapshot.generation === activeGeneration && snapshot.baseUrl === activeBaseUrl && readCatalogGeneration(repoRoot) === activeGeneration) {
    for (const model of snapshot.models) models.push({ provider: 'openai-compatible', id: model.id, name: model.name });
  }
  return models;
}

function installFakeWriter(lifecycle, repoRoot, omitNextCustom = { value: false }, writerActivity = { busy: false }) {
  lifecycle.startWriterProcess = async function (worldRoot) {
    const models = fakeWriterModels(repoRoot);
    if (omitNextCustom.value) {
      omitNextCustom.value = false;
      for (let index = models.length - 1; index >= 0; index--) if (models[index].provider === 'openai-compatible') models.splice(index, 1);
    }
    const client = {
      getState: async () => {
        if (writerActivity.stateGate) await writerActivity.stateGate;
        return { model: { provider: 'deepseek', id: 'deepseek-flash' }, thinkingLevel: 'low', isStreaming: writerActivity.busy };
      },
      getAvailableModels: async () => models,
      stop: async () => {},
    };
    this.writerEpoch++;
    this.writer = client;
    this.writerWorld = worldRoot;
    return client;
  };
}

async function waitForTerminal(lifecycle) {
  for (let attempt = 0; attempt < 500; attempt++) {
    const result = lifecycle.getOpenAIRefreshStatus();
    if (!['discovering', 'waiting', 'activating'].includes(result.status)) return result;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Catalog refresh did not reach a terminal state.');
}

async function waitForStatus(lifecycle, expected) {
  for (let attempt = 0; attempt < 500; attempt++) {
    const result = lifecycle.getOpenAIRefreshStatus();
    if (result.status === expected) return result;
    if (!['discovering', 'waiting', 'activating'].includes(result.status)) throw new Error(`Catalog refresh stopped at ${result.status}.`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`Catalog refresh never reached ${expected}.`);
}

test('catalog activation waits for a live writer to become idle before committing the new generation', async () => {
  await withEnv(async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-openai-commit-'));
    const worldRoot = path.join(root, 'world');
    await fs.mkdir(worldRoot);
    let requests = 0;
    const endpoint = await startEndpoint((_req, res) => {
      requests++;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ data: [{ id: 'custom-v2', name: 'Custom V2' }] }));
    });
    const lifecycle = new AgentLifecycleManager({ repoRoot: root, vendorCliPath: '/unused' });
    const writerActivity = { busy: true };
    try {
      process.env.AIRP_CUSTOM_OPENAI_PENDING_BASE_URL = endpoint.baseUrl;
      process.env.AIRP_CUSTOM_OPENAI_PENDING_API_KEY = 'pending-test-key';
      process.env.AIRP_CUSTOM_OPENAI_PENDING_GENERATION = '9';
      lifecycle.completeWorldTransition(worldRoot);
      installFakeWriter(lifecycle, root, undefined, writerActivity);
      await lifecycle.startWriter(worldRoot);

      assert.equal((await lifecycle.refreshOpenAICatalog(worldRoot)).status, 'discovering');
      assert.equal((await waitForStatus(lifecycle, 'waiting')).status, 'waiting');
      assert.equal(process.env.AIRP_CUSTOM_OPENAI_BASE_URL, undefined);
      assert.equal(readCatalogSnapshot(root), null);
      let closeEffects = 0;
      const closeStatuses = [];
      assert.equal(await lifecycle.stopCharacterWithAction('character-a', worldRoot, async () => { closeEffects++; }, status => closeStatuses.push(status)), 'deferred');
      assert.equal(closeEffects, 0);
      assert.deepEqual(closeStatuses, ['deferred']);
      writerActivity.busy = false;
      const result = await waitForTerminal(lifecycle);
      assert.equal(closeEffects, 1);
      assert.deepEqual(closeStatuses, ['deferred', 'completed']);
      assert.deepEqual(result, { status: 'success', count: 1 });
      assert.equal(requests, 1);
      assert.equal(process.env.AIRP_CUSTOM_OPENAI_BASE_URL, endpoint.baseUrl);
      assert.equal(process.env.AIRP_CUSTOM_OPENAI_API_KEY, 'pending-test-key');
      assert.equal(process.env.AIRP_CUSTOM_OPENAI_GENERATION, '1');
      assert.equal(readCatalogGeneration(root), 1);
      assert.deepEqual(readCatalogSnapshot(root)?.models.map(model => model.id), ['custom-v2']);
      const status = await lifecycle.modelStatus(worldRoot);
      assert.ok(status.models.some(model => model.provider === 'openai-compatible' && model.id === 'custom-v2'));
      assert.ok(status.models.some(model => model.provider === OFFICIAL_OPENAI_PROVIDER && model.id === OFFICIAL_OPENAI_MODEL));
    } finally {
      await lifecycle.stopAll();
      await new Promise(resolve => endpoint.server.close(resolve));
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

test('catalog activation rolls back when the restarted writer does not expose the staged model', async () => {
  await withEnv(async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-openai-rollback-'));
    const worldRoot = path.join(root, 'world');
    await fs.mkdir(worldRoot);
    const endpoint = await startEndpoint((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ data: [{ id: 'candidate' }] }));
    });
    const lifecycle = new AgentLifecycleManager({ repoRoot: root, vendorCliPath: '/unused' });
    try {
      process.env.AIRP_CUSTOM_OPENAI_BASE_URL = 'http://127.0.0.1:9999/old/v1';
      process.env.AIRP_CUSTOM_OPENAI_API_KEY = 'old-active-key';
      process.env.AIRP_CUSTOM_OPENAI_GENERATION = '3';
      process.env.AIRP_CUSTOM_OPENAI_PENDING_BASE_URL = endpoint.baseUrl;
      process.env.AIRP_CUSTOM_OPENAI_PENDING_API_KEY = 'new-pending-key';
      process.env.AIRP_CUSTOM_OPENAI_PENDING_GENERATION = '4';
      await fs.writeFile(path.join(root, '.airp-openai-catalog.json'), JSON.stringify({
        generation: 3, baseUrl: 'http://127.0.0.1:9999/old/v1', models: [{ id: 'old-model', name: 'Old model', contextWindow: 128000, maxTokens: 8192 }],
      }));
      await fs.writeFile(path.join(root, '.airp-openai-generation.json'), JSON.stringify({ generation: 3 }));
      await fs.writeFile(path.join(root, '.env.local'), 'AIRP_CUSTOM_OPENAI_BASE_URL="http://127.0.0.1:9999/old/v1"\nAIRP_CUSTOM_OPENAI_API_KEY="old-active-key"\nAIRP_CUSTOM_OPENAI_GENERATION="3"\n');
      lifecycle.completeWorldTransition(worldRoot);
      const omitNextCustom = { value: false };
      installFakeWriter(lifecycle, root, omitNextCustom);
      await lifecycle.startWriter(worldRoot);
      omitNextCustom.value = true;

      await lifecycle.refreshOpenAICatalog(worldRoot);
      const result = await waitForTerminal(lifecycle);
      assert.deepEqual(result, { status: 'rolled-back', error: 'activation-failed' });
      assert.equal(process.env.AIRP_CUSTOM_OPENAI_BASE_URL, 'http://127.0.0.1:9999/old/v1');
      assert.equal(process.env.AIRP_CUSTOM_OPENAI_API_KEY, 'old-active-key');
      assert.equal(process.env.AIRP_CUSTOM_OPENAI_GENERATION, '3');
      assert.equal(readCatalogGeneration(root), 3);
      assert.deepEqual(readCatalogSnapshot(root)?.models.map(model => model.id), ['old-model']);
    } finally {
      await lifecycle.stopAll();
      await new Promise(resolve => endpoint.server.close(resolve));
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

test('duplicate refreshes share one discovery and cancellation keeps active catalog untouched', async () => {
  await withEnv(async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-openai-cancel-'));
    const worldRoot = path.join(root, 'world');
    await fs.mkdir(worldRoot);
    let releaseResponse;
    let requests = 0;
    const responseGate = new Promise(resolve => { releaseResponse = resolve; });
    const endpoint = await startEndpoint(async (_req, res) => {
      requests++;
      await responseGate;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ data: [{ id: 'not-committed' }] }));
    });
    const lifecycle = new AgentLifecycleManager({ repoRoot: root, vendorCliPath: '/unused' });
    try {
      lifecycle.completeWorldTransition(worldRoot);
      process.env.AIRP_CUSTOM_OPENAI_PENDING_BASE_URL = endpoint.baseUrl;
      process.env.AIRP_CUSTOM_OPENAI_PENDING_API_KEY = 'pending-key';
      process.env.AIRP_CUSTOM_OPENAI_PENDING_GENERATION = '1';
      assert.equal((await lifecycle.refreshOpenAICatalog(worldRoot)).status, 'discovering');
      assert.equal((await lifecycle.refreshOpenAICatalog(worldRoot)).status, 'discovering');
      for (let attempt = 0; attempt < 100 && requests === 0; attempt++) await new Promise(resolve => setTimeout(resolve, 5));
      assert.equal(requests, 1);
      assert.deepEqual(await lifecycle.cancelOpenAIRefresh(), { status: 'cancelled' });
      releaseResponse();
      assert.deepEqual(await waitForTerminal(lifecycle), { status: 'cancelled' });
      assert.equal(process.env.AIRP_CUSTOM_OPENAI_API_KEY, undefined);
      assert.equal(readCatalogSnapshot(root), null);
      assert.equal(readCatalogGeneration(root), 0);
    } finally {
      releaseResponse();
      await new Promise(resolve => endpoint.server.close(resolve));
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

test('pending pair replacement during discovery prevents the staged candidate from committing', async () => {
  await withEnv(async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-openai-stale-pending-'));
    const worldRoot = path.join(root, 'world');
    await fs.mkdir(worldRoot);
    let releaseResponse;
    let requests = 0;
    const responseGate = new Promise(resolve => { releaseResponse = resolve; });
    const endpoint = await startEndpoint(async (_req, res) => {
      requests++;
      await responseGate;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ data: [{ id: 'stale-candidate' }] }));
    });
    const lifecycle = new AgentLifecycleManager({ repoRoot: root, vendorCliPath: '/unused' });
    try {
      lifecycle.completeWorldTransition(worldRoot);
      process.env.AIRP_CUSTOM_OPENAI_PENDING_BASE_URL = endpoint.baseUrl;
      process.env.AIRP_CUSTOM_OPENAI_PENDING_API_KEY = 'first-pending-key';
      process.env.AIRP_CUSTOM_OPENAI_PENDING_GENERATION = '1';
      await lifecycle.refreshOpenAICatalog(worldRoot);
      for (let attempt = 0; attempt < 100 && requests === 0; attempt++) await new Promise(resolve => setTimeout(resolve, 5));
      assert.equal(requests, 1);
      process.env.AIRP_CUSTOM_OPENAI_PENDING_BASE_URL = 'http://127.0.0.1:1/replaced/v1';
      process.env.AIRP_CUSTOM_OPENAI_PENDING_API_KEY = 'replacement-key';
      process.env.AIRP_CUSTOM_OPENAI_PENDING_GENERATION = '2';
      releaseResponse();
      assert.deepEqual(await waitForTerminal(lifecycle), { status: 'error', error: 'configuration-changed' });
      assert.equal(process.env.AIRP_CUSTOM_OPENAI_BASE_URL, undefined);
      assert.equal(process.env.AIRP_CUSTOM_OPENAI_API_KEY, undefined);
      assert.equal(readCatalogSnapshot(root), null);
      assert.equal(readCatalogGeneration(root), 0);
    } finally {
      releaseResponse();
      await new Promise(resolve => endpoint.server.close(resolve));
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
test('a gateway command admitted before the refresh lock finishes before active configuration changes', async () => {
  await withEnv(async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-openai-dispatch-lease-'));
    const worldRoot = path.join(root, 'world');
    await fs.mkdir(worldRoot);
    const endpoint = await startEndpoint((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ data: [{ id: 'after-dispatch' }] }));
    });
    const lifecycle = new AgentLifecycleManager({ repoRoot: root, vendorCliPath: '/unused' });
    let releaseWriterState;
    const writerActivity = { busy: false, stateGate: new Promise(resolve => { releaseWriterState = resolve; }) };
    let dispatched = false;
    try {
      lifecycle.completeWorldTransition(worldRoot);
      installFakeWriter(lifecycle, root, undefined, writerActivity);
      await lifecycle.startWriter(worldRoot);
      const command = lifecycle.dispatchWriterCommand(worldRoot, async () => { dispatched = true; });
      process.env.AIRP_CUSTOM_OPENAI_PENDING_BASE_URL = endpoint.baseUrl;
      process.env.AIRP_CUSTOM_OPENAI_PENDING_API_KEY = 'pending-key';
      process.env.AIRP_CUSTOM_OPENAI_PENDING_GENERATION = '1';
      await lifecycle.refreshOpenAICatalog(worldRoot);
      assert.equal((await waitForStatus(lifecycle, 'waiting')).status, 'waiting');
      assert.equal(dispatched, false);
      assert.equal(process.env.AIRP_CUSTOM_OPENAI_BASE_URL, undefined);
      releaseWriterState();
      await command;
      assert.equal(dispatched, true);
      assert.deepEqual(await waitForTerminal(lifecycle), { status: 'success', count: 1 });
    } finally {
      releaseWriterState();
      await lifecycle.stopAll();
      await new Promise(resolve => endpoint.server.close(resolve));
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
