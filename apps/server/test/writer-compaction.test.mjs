// the design notes: between beats, a writer past the threshold compacts; the overlay sets what it keeps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compactionDue, writerCompactionFromEnv, writerSettingsOverlay, WRITER_COMPACTION_DEFAULTS } from '../dist/engine/writer-beat-policy.js';
import { AgentLifecycleManager } from '../dist/engine/lifecycle.js';
import { writerLaunch } from '../dist/engine/launch.js';

test('config: defaults, overrides, off switch, keep clamped below the threshold', () => {
  assert.deepEqual(writerCompactionFromEnv({}), WRITER_COMPACTION_DEFAULTS);
  assert.equal(writerCompactionFromEnv({ AIRP_WRITER_COMPACT: '0' }).enabled, false);
  assert.deepEqual(writerCompactionFromEnv({ AIRP_WRITER_COMPACT_AT: '30000', AIRP_WRITER_COMPACT_KEEP: '9000' }), { enabled: true, at: 30000, keep: 9000 });
  assert.equal(writerCompactionFromEnv({ AIRP_WRITER_COMPACT_AT: '30000', AIRP_WRITER_COMPACT_KEEP: '90000' }).keep, 15000);
  assert.equal(writerCompactionFromEnv({ AIRP_WRITER_COMPACT_AT: 'lots' }).at, WRITER_COMPACTION_DEFAULTS.at);
  assert.deepEqual(writerSettingsOverlay({ enabled: true, at: 64000, keep: 20000 }), { compaction: { enabled: true, keepRecentTokens: 20000, thresholdTokens: 128000 } });
  const cfg = writerCompactionFromEnv({});
  assert.equal(compactionDue(63999, cfg), false);
  assert.equal(compactionDue(64000, cfg), true);
  assert.equal(compactionDue(null, cfg), false, 'right after a compaction pi-rp reports null');
  assert.equal(compactionDue(900000, { ...cfg, enabled: false }), false);
});

function setup(tokens) {
  const calls = [];
  const manager = new AgentLifecycleManager({ repoRoot: '.', vendorCliPath: 'unused' });
  const listeners = new Set();
  const client = {
    onEvent(handler) { listeners.add(handler); return () => listeners.delete(handler); },
    async getState() { return { model: null, thinkingLevel: 'off' }; },
    async setThinkingLevel() {},
    async getSessionStats() { calls.push('stats'); return { contextUsage: { tokens: tokens() } }; },
    async compact() { calls.push('compact'); },
    async prompt(message) {
      calls.push(`prompt:${message}`);
      setTimeout(() => { for (const h of [...listeners]) h({ type: 'agent_settled' }); }, 1);
    },
  };
  manager.startWriter = async () => client;
  manager.writer = client;
  manager.writerWorld = '/demo';
  return { manager, calls };
}

const drain = (manager) => manager.writerQueue;

test('compacts after the beat that crosses the threshold, before the next beat', async () => {
  let tokens = 10000;
  const { manager, calls } = setup(() => tokens);
  await manager.submitWriter('/demo', 'a');
  await drain(manager);
  assert.deepEqual(calls, ['prompt:a', 'stats']);
  tokens = 70000;
  await manager.submitWriter('/demo', 'b');
  await drain(manager);
  assert.deepEqual(calls.slice(2), ['prompt:b', 'stats', 'compact']);
  tokens = 21000;
  await manager.submitWriter('/demo', 'd');
  await drain(manager);
  assert.deepEqual(calls.slice(5), ['prompt:d', 'stats']);
});

test('never compacts while a beat waits, or when switched off', async () => {
  const saved = process.env.AIRP_WRITER_COMPACT;
  try {
    const { manager, calls } = setup(() => 90000);
    manager.queuedBeats = 1; // a beat waiting behind
    await manager.compactWriterIfDue('/demo');
    manager.queuedBeats = 0;
    process.env.AIRP_WRITER_COMPACT = '0';
    await manager.compactWriterIfDue('/demo');
    assert.deepEqual(calls, []);
  } finally {
    if (saved === undefined) delete process.env.AIRP_WRITER_COMPACT;
    else process.env.AIRP_WRITER_COMPACT = saved;
  }
});

test('the writer launch carries the overlay, and drops it when compaction is off', () => {
  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
  const world = fs.mkdtempSync(path.join(os.tmpdir(), 'airp-compact-launch-'));
  const saved = process.env.AIRP_WRITER_COMPACT;
  try {
    fs.writeFileSync(path.join(world, 'world.json'), '{}');
    const on = writerLaunch(repoRoot, world, 'cli.js');
    const at = on.args.indexOf('--settings-file');
    assert.ok(at > 0);
    assert.equal(on.args[at + 1], path.join(world, '.airpworld', 'writer-settings.json'));
    assert.deepEqual(JSON.parse(fs.readFileSync(on.args[at + 1], 'utf8')), writerSettingsOverlay(writerCompactionFromEnv({})));
    process.env.AIRP_WRITER_COMPACT = '0';
    assert.equal(writerLaunch(repoRoot, world, 'cli.js').args.includes('--settings-file'), false);
  } finally {
    if (saved === undefined) delete process.env.AIRP_WRITER_COMPACT;
    else process.env.AIRP_WRITER_COMPACT = saved;
    fs.rmSync(world, { recursive: true, force: true });
  }
});
