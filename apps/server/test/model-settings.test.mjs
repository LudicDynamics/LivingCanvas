import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AgentLifecycleManager } from '../dist/engine/lifecycle.js';
import { modelPreferenceArgs, readModelPreferences, userFacingModels, writeModelPreferences } from '../dist/engine/model-preferences.js';
import { AgentModelSelectionSchema } from '../../../packages/shared/dist/index.js';

test('model preferences remain world-local and keep writer and character separate', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-model-test-'));
  try {
    const preference = { provider: 'openai', model: 'gpt-5.4-mini', thinking: 'off' };
    writeModelPreferences(root, { writer: preference });
    assert.deepEqual(readModelPreferences(root), { writer: preference });
    assert.deepEqual(modelPreferenceArgs(root, 'writer'), ['--provider', 'openai', '--model', 'gpt-5.4-mini', '--thinking', 'off']);
    // No saved character preference → the shipped default (DeepSeek deepseek-v4-flash, low).
    assert.deepEqual(modelPreferenceArgs(root, 'character'), ['--provider', 'deepseek', '--model', 'deepseek-v4-flash', '--thinking', 'low']);
    assert.equal(AgentModelSelectionSchema.safeParse({ ...preference, role: 'writer', world: root }).success, true);
    assert.equal(AgentModelSelectionSchema.safeParse({ ...preference, role: 'writer' }).success, false);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('busy turns reject model switches before touching preferences or clients', async () => {
  const manager = new AgentLifecycleManager({ repoRoot: '.', vendorCliPath: '' });
  manager.queuedBeats = 1;
  await assert.rejects(manager.changeModel('/unused', 'writer', {}), /Wait for the current turn/);
  manager.queuedBeats = 0;
  manager.turnStartedAt.set('character:nanami', Date.now());
  await assert.rejects(manager.changeModel('/unused', 'character', {}), /Wait for the current turn/);
});

test('progress distinguishes landed Chalk from finished work and stops at settled', () => {
  const frames = [];
  const manager = new AgentLifecycleManager({ repoRoot: '.', vendorCliPath: '', frameSink: f => frames.push(f) });
  const client = { abort: async () => {} };
  const emit = event => manager.handleEngineEvent('writer', event, 'writer', client, '/test/save', manager.writerEpoch);
  emit({ type: 'agent_start' });
  emit({ type: 'tool_execution_end', toolName: 'chalk', isError: false });
  emit({ type: 'message_update' });
  assert.match(manager.progress.get('writer').stage, /Chalk is ready/);
  assert.equal(frames.at(-1).busy, true);
  emit({ type: 'agent_settled' });
  assert.equal(frames.at(-1).busy, false);
  assert.equal(manager.turnStartedAt.size, 0);
});

test('Vercel AI Gateway is not offered: hidden from the model list, refused, a saved choice falls back', async () => {
  const catalog = [{ provider: 'deepseek', id: 'deepseek-v4-flash' }, { provider: 'vercel-ai-gateway', id: 'openai/gpt-5' }, { provider: 'openai', id: 'gpt-5-mini' }];
  assert.deepEqual(userFacingModels(catalog).map((m) => m.provider), ['deepseek', 'openai']);
  const manager = new AgentLifecycleManager({ repoRoot: '.', vendorCliPath: '' });
  const writer = { getState: async () => ({ model: { provider: 'deepseek', id: 'deepseek-v4-flash' }, thinkingLevel: 'low', isStreaming: false }), getAvailableModels: async () => catalog };
  manager.startWriter = async () => writer;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-model-test-'));
  try {
    const status = await manager.modelStatus(root);
    // The plain `openai` catalog is replaced by the isolated official / custom providers (openai-model-catalog.ts).
    assert.deepEqual(status.models.map((m) => m.provider), ['deepseek'], 'the Agents panel never lists it');
    await assert.rejects(manager.changeModel(root, 'writer', { provider: 'vercel-ai-gateway', model: 'openai/gpt-5', thinking: 'low' }), /not available/);
    writeModelPreferences(root, { writer: { provider: 'vercel-ai-gateway', model: 'openai/gpt-5', thinking: 'low' } });
    assert.deepEqual(readModelPreferences(root), {});
    assert.deepEqual(modelPreferenceArgs(root, 'writer'), ['--provider', 'deepseek', '--model', 'deepseek-v4-flash', '--thinking', 'low']);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
