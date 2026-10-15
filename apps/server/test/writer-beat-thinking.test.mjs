// the design notes: ordinary beats run with thinking off, big beats keep the launch level.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writerBeatThinking, writerThinkingConfigFromEnv, DEFAULT_BIG_BEAT_PATTERN } from '../dist/engine/writer-beat-policy.js';
import { AgentLifecycleManager } from '../dist/engine/lifecycle.js';

const adaptive = writerThinkingConfigFromEnv({});
const decide = (message, over = {}) => writerBeatThinking(message, { base: 'low', lastBeatToolError: false, config: adaptive, ...over });

test('ordinary beats think off; turning points keep the base level', () => {
  assert.deepEqual(decide('[Current Layer] world/front-hall\n[Player Request] 我看看住宿簿'), { level: 'off', reason: 'ordinary' });
  for (const words of ['我想一个人下山', '让时间过去', '结束这一切', 'I want to leave the inn', 'wait until tomorrow', 'もう帰る', '[Player Event] {"option_id":"leave-alone"}']) {
    assert.equal(decide(`[Current Layer] map\n[Player Request] ${words}`).level, 'low', words);
  }
  assert.equal(decide('[Player Event] The player rolled the skill check "world/a/check.md": 12 — 成功').level, 'off');
});

test('the layer line is routing, not the request', () => {
  assert.equal(decide('[Current Layer] world/exit-hall\n[Player Request] 看看四周').level, 'off');
});

test('a tool error in the last beat, an authoring request, fixed mode and a base of off', () => {
  assert.deepEqual(decide('[Player Request] 看看', { lastBeatToolError: true }), { level: 'low', reason: 'tool-error' });
  assert.equal(decide('brief\n\n[Current Layer] map\n[Author Request] add a room').reason, 'authoring');
  assert.deepEqual(decide('[Player Request] 看看', { config: writerThinkingConfigFromEnv({ AIRP_WRITER_THINKING_MODE: 'fixed' }) }), { level: 'low', reason: 'fixed' });
  assert.deepEqual(decide('[Player Request] 下山', { base: 'off' }), { level: 'off', reason: 'base-off' });
  assert.deepEqual(decide('[Player Request] 下山', { base: 'medium' }), { level: 'medium', reason: 'big-beat' });
});

test('a custom keyword pattern replaces the default; an invalid one falls back', () => {
  const custom = writerThinkingConfigFromEnv({ AIRP_WRITER_BIG_BEAT: '密室' });
  assert.equal(decide('[Player Request] 打开密室', { config: custom }).level, 'low');
  assert.equal(decide('[Player Request] 下山', { config: custom }).level, 'off');
  assert.equal(writerThinkingConfigFromEnv({ AIRP_WRITER_BIG_BEAT: '(' }).bigBeat.source, new RegExp(DEFAULT_BIG_BEAT_PATTERN, 'i').source);
});

function fakeWriter(trace) {
  const listeners = new Set();
  let level = 'low';
  return {
    trace,
    onEvent(handler) { listeners.add(handler); return () => listeners.delete(handler); },
    emit(event) { for (const handler of [...listeners]) handler(event); },
    async getState() { return { model: null, thinkingLevel: level }; },
    async setThinkingLevel(next) { level = next; trace.push(`thinking:${next}`); },
    async prompt(message) {
      trace.push(`prompt:${message}`);
      setTimeout(() => this.emit({ type: 'agent_settled' }), 1);
    },
  };
}

test('lifecycle switches only on change, re-thinks after a tool error, and restores the base for /airp-init', async () => {
  const trace = [];
  const manager = new AgentLifecycleManager({ repoRoot: '.', vendorCliPath: 'unused' });
  const client = fakeWriter(trace);
  manager.startWriter = async () => client;
  await manager.submitWriter('/demo', '[Player Request] 看看');
  await manager.submitWriter('/demo', '[Player Request] 再看看');
  // A failed tool in this beat → the next beat thinks.
  manager.writer = client;
  manager.writerWorld = '/demo';
  const third = manager.submitWriter('/demo', '[Player Request] 拿起灯笼');
  await new Promise((r) => setTimeout(r, 0));
  manager.handleEngineEvent('writer', { type: 'tool_execution_end', toolName: 'edit', toolCallId: 't1', isError: true }, 'writer', client, '/demo', manager.writerEpoch);
  await third;
  await manager.submitWriter('/demo', '[Player Request] 再试一次');
  await manager.submitWriter('/demo', '[Player Request] 坐下');
  await manager.restoreWriterThinking(client);
  assert.deepEqual(trace.filter((t) => t.startsWith('thinking:')), ['thinking:off', 'thinking:low', 'thinking:off', 'thinking:low']);
  const status = await manager.modelStatus('/demo', false).catch(() => null);
  if (status) assert.equal(status.writer.thinking, 'low', 'the panel shows the launch level, not the per-beat switch');
});
