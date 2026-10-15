// The no-model gate (engine/model-availability.ts): one usable route is enough; none = refuse at once.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { modelAvailable } from '../dist/engine/model-availability.js';

const repo = () => fs.mkdtempSync(path.join(os.tmpdir(), 'airp-model-'));
const base = { AIRP_AI_ACCOUNT: '0' };

test('no key, no account, no gateway, no custom provider: unavailable', () => {
  assert.equal(modelAvailable(repo(), { ...base }), false);
  // voice / image-proxy keys do not count
  assert.equal(modelAvailable(repo(), { ...base, DASHSCOPE_API_KEY: 'x', FLOW_API_KEY: 'y', OPENAI_API_KEY: '  ' }), false);
});

test('any chat provider key, a gateway, a pi login or a custom provider with a key: available', () => {
  assert.equal(modelAvailable(repo(), { ...base, OPENAI_API_KEY: 'k' }), true);
  assert.equal(modelAvailable(repo(), { ...base, OPENROUTER_API_KEY: 'k' }), true);
  assert.equal(modelAvailable(repo(), { ...base, AIRP_AI_BASE: 'http://127.0.0.1:9/v1', AIRP_AI_KEY: 'k' }), true);
  const withAuth = repo();
  fs.mkdirSync(path.join(withAuth, '.pi', 'agent'), { recursive: true });
  fs.writeFileSync(path.join(withAuth, '.pi', 'agent', 'auth.json'), '{"anthropic":{"type":"oauth"}}');
  assert.equal(modelAvailable(withAuth, { ...base }), true);
  const custom = repo();
  fs.mkdirSync(path.join(custom, '.pi', 'agent'), { recursive: true });
  fs.writeFileSync(path.join(custom, '.pi', 'agent', 'models.json'), JSON.stringify({ providers: { local: { apiKey: '$LOCAL_LLM_KEY' }, deepseek: { apiKey: 'DEEPSEEK_API_KEY' } } }));
  assert.equal(modelAvailable(custom, { ...base }), false, 'a provider whose variable is unset does not count');
  assert.equal(modelAvailable(custom, { ...base, LOCAL_LLM_KEY: 'k' }), true);
  fs.writeFileSync(path.join(custom, '.pi', 'agent', 'models.json'), JSON.stringify({ providers: { ollama: { apiKey: 'ollama' } } }));
  assert.equal(modelAvailable(custom, { ...base }), true, 'a literal key counts');
});
