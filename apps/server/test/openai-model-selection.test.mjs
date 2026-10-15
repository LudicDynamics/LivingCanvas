import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AgentLifecycleManager } from '../dist/engine/lifecycle.js';

const OPENAI_ENV = ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'AIRP_CUSTOM_OPENAI_BASE_URL', 'AIRP_CUSTOM_OPENAI_API_KEY', 'AIRP_CUSTOM_OPENAI_GENERATION'];

async function withOpenAIEnv(callback) {
  const previous = Object.fromEntries(OPENAI_ENV.map(name => [name, process.env[name]]));
  try { await callback(); }
  finally {
    for (const name of OPENAI_ENV) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
}

test('AIRP refuses new selections of pi-rp account-routed openai models', async () => {
  await withOpenAIEnv(async () => {
    const lifecycle = new AgentLifecycleManager({ repoRoot: '/unused', vendorCliPath: '/unused' });
    await assert.rejects(lifecycle.changeModel('/unused', 'writer', {
      provider: 'openai', model: 'gpt-5.6-luna', thinking: 'low',
    }), /cannot be selected in AIRP/);
  });
});

test('official and custom OpenAI selections fail closed without their own committed credentials', async () => {
  await withOpenAIEnv(async () => {
    const lifecycle = new AgentLifecycleManager({ repoRoot: '/unused', vendorCliPath: '/unused' });
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;
    await assert.rejects(lifecycle.changeModel('/unused', 'writer', {
      provider: 'airp-openai-official', model: 'gpt-6-luna', thinking: 'low',
    }), /official API key is configured/);
    await assert.rejects(lifecycle.changeModel('/unused', 'writer', {
      provider: 'openai-compatible', model: 'model-not-active', thinking: 'low',
    }), /custom OpenAI model is not active/);
  });
});
test('server rejects a turn before dispatch when its saved official model has no official key', async () => {
  await withOpenAIEnv(async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;
    const lifecycle = new AgentLifecycleManager({ repoRoot: '/unused', vendorCliPath: '/unused' });
    lifecycle.writerWorld = '/unused';
    lifecycle.writer = {
      getState: async () => ({ model: { provider: 'airp-openai-official', id: 'gpt-6-luna' } }),
    };
    let dispatched = false;
    await assert.rejects(lifecycle.dispatchWriterCommand('/unused', async () => { dispatched = true; }), /no configured official key/);
    assert.equal(dispatched, false);
  });
});
test('external writer starts remain blocked during a model transaction', async () => {
  const lifecycle = new AgentLifecycleManager({ repoRoot: '/unused', vendorCliPath: '/unused' });
  lifecycle.switchingModels = true;
  let launches = 0;
  lifecycle.startWriterProcess = async () => { launches++; };
  await assert.rejects(lifecycle.startWriter('/unused'), /Models are switching/);
  assert.equal(launches, 0);
});
test('character close side effects are deferred when a model transaction is locked', async () => {
  const lifecycle = new AgentLifecycleManager({ repoRoot: '/unused', vendorCliPath: '/unused' });
  lifecycle.switchingModels = true;
  let sideEffects = 0;
  const statuses = [];
  const status = await lifecycle.stopCharacterWithAction('character-a', '/unused', async () => { sideEffects++; }, value => statuses.push(value));
  assert.equal(status, 'deferred');
  assert.equal(sideEffects, 0);
  assert.deepEqual(statuses, ['deferred']);
});
