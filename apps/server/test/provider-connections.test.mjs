import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { airpEnv } from '../dist/engine/presets.js';
import { ensureProviderConfig } from '../dist/engine/provider-config.js';
import { createConnectionSettingsRouter } from '../dist/routes/connection-settings.js';

function copyBundledProvider(root) {
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.copyFileSync(new URL('../../../config/deepseek-models.example.json', import.meta.url), path.join(root, 'config/deepseek-models.example.json'));
}

test('bundled DeepSeek model has the expected shape and never introduces a secret', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'airp-provider-config-'));
  const previous = process.env.DEEPSEEK_API_KEY;
  try {
    process.env.DEEPSEEK_API_KEY = 'test-only-secret';
    assert.equal(airpEnv({ role: 'writer' }).DEEPSEEK_API_KEY, 'test-only-secret');
    copyBundledProvider(root);
    const bundled = JSON.parse(fs.readFileSync(path.join(root, 'config/deepseek-models.example.json'), 'utf8'));
    assert.equal(bundled.providers.deepseek.apiKey, '$DEEPSEEK_API_KEY');
    assert.equal(bundled.providers.deepseek.models[0].id, 'deepseek-v4-flash');
    assert.ok(!JSON.stringify(bundled).includes('test-only-secret'));
    ensureProviderConfig(root);
    const file = path.join(root, '.pi', 'agent', 'models.json');
    const config = JSON.parse(fs.readFileSync(file, 'utf8'));
    const provider = config.providers.deepseek;
    const model = provider.models.find(({ id }) => id === 'deepseek-v4-flash');
    assert.equal(provider.baseUrl, 'https://api.deepseek.com');
    assert.equal(provider.api, 'openai-completions');
    assert.equal(provider.apiKey, '$DEEPSEEK_API_KEY');
    assert.deepEqual(model, {
      id: 'deepseek-v4-flash',
      name: 'DeepSeek V4 Flash',
      reasoning: true,
      input: ['text'],
      contextWindow: 1000000,
      maxTokens: 8192,
      compat: {
        supportsStore: false,
        supportsDeveloperRole: false,
        maxTokensField: 'max_tokens',
        requiresReasoningContentOnAssistantMessages: true,
        thinkingFormat: 'deepseek',
      },
    });
    assert.ok(!JSON.stringify(config).includes('test-only-secret'));

    config.providers.custom = { apiKey: '$CUSTOM_KEY' };
    config.providers.deepseek.apiKey = '$CUSTOM_DEEPSEEK_KEY';
    config.providers.deepseek.models = [];
    fs.writeFileSync(file, JSON.stringify(config));
    ensureProviderConfig(root);
    const saved = fs.readFileSync(file, 'utf8');
    ensureProviderConfig(root);
    assert.equal(fs.readFileSync(file, 'utf8'), saved);
    const merged = JSON.parse(saved);
    assert.equal(merged.providers.deepseek.apiKey, '$CUSTOM_DEEPSEEK_KEY');
    assert.deepEqual(merged.providers.custom, { apiKey: '$CUSTOM_KEY' });
  } finally {
    if (previous === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test('provider config merge fails soft for invalid source or existing configuration', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'airp-provider-invalid-'));
  try {
    fs.mkdirSync(path.join(root, 'config'), { recursive: true });
    fs.writeFileSync(path.join(root, 'config/deepseek-models.example.json'), '{invalid');
    ensureProviderConfig(root);
    assert.equal(fs.existsSync(path.join(root, '.pi', 'agent', 'models.json')), false);

    copyBundledProvider(root);
    const target = path.join(root, '.pi', 'agent', 'models.json');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, '{invalid');
    ensureProviderConfig(root);
    assert.equal(fs.readFileSync(target, 'utf8'), '{invalid');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('connection settings are localhost-only and redact DeepSeek credentials', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'airp-provider-settings-'));
  const previous = process.env.DEEPSEEK_API_KEY;
  fs.writeFileSync(path.join(root, '.env.local'), '# Existing settings\nOPENAI_API_KEY="existing"\n');
  const app = express();
  app.use(express.json());
  app.use('/api', createConnectionSettingsRouter(root));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/connection-settings`;
  const send = (body, extra = {}) => fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-AIRP-Settings': '1', ...extra },
    body: JSON.stringify(body),
  });
  try {
    assert.equal((await fetch(url)).status, 200);
    const initial = await (await fetch(url)).json();
    assert.equal(initial.DEEPSEEK_API_KEY, Boolean(previous?.trim()));
    assert.ok(!JSON.stringify(initial).includes('existing'));
    assert.equal((await send({ DEEPSEEK_API_KEY: 'test-only-secret' }, { Origin: 'https://evil.example' })).status, 403);
    assert.equal((await send({ DEEPSEEK_API_KEY: 'test-only-secret' }, { 'X-Forwarded-For': '203.0.113.8' })).status, 403);
    assert.equal((await send({ DEEPSEEK_API_KEY: 'test-only-secret' })).status, 200);
    const responseText = await (await fetch(url)).text();
    assert.equal(JSON.parse(responseText).DEEPSEEK_API_KEY, true);
    assert.ok(!responseText.includes('test-only-secret'));
    assert.match(fs.readFileSync(path.join(root, '.env.local'), 'utf8'), /DEEPSEEK_API_KEY="test-only-secret"/);
  } finally {
    if (previous === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previous;
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
