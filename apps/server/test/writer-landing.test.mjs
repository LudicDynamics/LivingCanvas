// the design notes: the first page change releases the player; one beat may wait behind a landed one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLandingTool, earlyReleaseEnabled } from '../dist/engine/writer-beat-policy.js';
import { AgentLifecycleManager } from '../dist/engine/lifecycle.js';

test('landing: a chalk or a world-file write/edit that succeeded', () => {
  assert.equal(isLandingTool('chalk', undefined, false), true);
  assert.equal(isLandingTool('edit', 'world/inn/lamp.md', false), true);
  assert.equal(isLandingTool('write', './world/inn/new.md', false), true);
  assert.equal(isLandingTool('chalk', undefined, true), false, 'a failed call changed nothing');
  assert.equal(isLandingTool('edit', 'characters/kuri/memory.md', false), false, 'character memory is not the page');
  assert.equal(isLandingTool('write', 'player/README.md', false), false);
  for (const name of ['read', 'look_at', 'roll_dice', 'choose', 'link']) assert.equal(isLandingTool(name, 'world/a.md', false), false, name);
  assert.equal(earlyReleaseEnabled({}), true);
  assert.equal(earlyReleaseEnabled({ AIRP_WRITER_EARLY_RELEASE: '0' }), false);
});

function setup() {
  const frames = [];
  const prompts = [];
  const manager = new AgentLifecycleManager({ repoRoot: '.', vendorCliPath: 'unused', frameSink: (f) => frames.push(f) });
  const listeners = new Set();
  const client = {
    onEvent(handler) { listeners.add(handler); return () => listeners.delete(handler); },
    async getState() { return { model: null, thinkingLevel: 'low' }; },
    async setThinkingLevel() {},
    async prompt(message) { prompts.push(message); },
    async abort() { prompts.push('abort'); },
  };
  manager.startWriter = async () => client;
  manager.writer = client;
  manager.writerWorld = '/demo';
  const emit = (event) => {
    manager.handleEngineEvent('writer', event, 'writer', client, '/demo', manager.writerEpoch);
    for (const handler of [...listeners]) handler(event);
  };
  const tick = () => new Promise((r) => setTimeout(r, 0));
  return { manager, frames, prompts, emit, tick };
}

test('after a chalk lands: progress says landed, one beat queues and waits for the real settle', async () => {
  const { manager, frames, prompts, emit, tick } = setup();
  const first = manager.submitWriter('/demo', 'b1');
  await tick();
  emit({ type: 'agent_start' });
  emit({ type: 'turn_start' });
  emit({ type: 'tool_execution_start', toolName: 'read', toolCallId: 'r', args: { path: 'world/inn/README.md' } });
  emit({ type: 'tool_execution_end', toolName: 'read', toolCallId: 'r', isError: false });
  assert.equal(frames.some((f) => f.landed), false, 'reading is not landing');
  await assert.rejects(manager.submitWriter('/demo', 'too early'), /still resolving/);
  emit({ type: 'tool_execution_start', toolName: 'chalk', toolCallId: 'c', args: { content: 'x' } });
  emit({ type: 'tool_execution_end', toolName: 'chalk', toolCallId: 'c', isError: false });
  const landedFrame = frames.find((f) => f.type === 'agent_progress' && f.landed === true);
  assert.ok(landedFrame, 'the landing is announced');
  assert.equal(landedFrame.busy, true);
  const second = manager.submitWriter('/demo', 'b2');
  await assert.rejects(manager.submitWriter('/demo', 'b3'), /still resolving/, 'only one beat may wait');
  // The tail keeps working and keeps saying landed.
  emit({ type: 'tool_execution_start', toolName: 'edit', toolCallId: 'e', args: { path: 'world/inn/lamp.md' } });
  assert.equal(frames.at(-1).landed, true);
  emit({ type: 'tool_execution_end', toolName: 'edit', toolCallId: 'e', isError: false });
  await tick();
  assert.deepEqual(prompts, ['b1'], 'b2 never overlaps b1');
  emit({ type: 'turn_end' });
  emit({ type: 'agent_settled' });
  assert.equal(frames.at(-1).landed, undefined, 'the settle frame is not landed');
  await first;
  await tick();
  assert.deepEqual(prompts, ['b1', 'b2']);
  emit({ type: 'agent_start' });
  assert.equal(frames.at(-1).landed, undefined, 'a new beat starts unlanded');
  emit({ type: 'agent_settled' });
  await second;
});

test('Stop drops the waiting beat before it prompts', async () => {
  const { manager, prompts, emit, tick } = setup();
  const first = manager.submitWriter('/demo', 'b1');
  await tick();
  emit({ type: 'agent_start' });
  emit({ type: 'tool_execution_start', toolName: 'write', toolCallId: 'w', args: { path: 'world/inn/note.md' } });
  emit({ type: 'tool_execution_end', toolName: 'write', toolCallId: 'w', isError: false });
  const second = manager.submitWriter('/demo', 'b2');
  await manager.abortWriter('/demo');
  emit({ type: 'agent_settled' });
  await first;
  await assert.rejects(second, /stopped before your next action/);
  assert.deepEqual(prompts, ['b1', 'abort']);
});

test('AIRP_WRITER_EARLY_RELEASE=0 keeps the old refusal', async () => {
  const saved = process.env.AIRP_WRITER_EARLY_RELEASE;
  process.env.AIRP_WRITER_EARLY_RELEASE = '0';
  try {
    const { manager, frames, emit, tick } = setup();
    const first = manager.submitWriter('/demo', 'b1');
    await tick();
    emit({ type: 'agent_start' });
    emit({ type: 'tool_execution_start', toolName: 'chalk', toolCallId: 'c', args: {} });
    emit({ type: 'tool_execution_end', toolName: 'chalk', toolCallId: 'c', isError: false });
    assert.equal(frames.some((f) => f.landed), false);
    await assert.rejects(manager.submitWriter('/demo', 'b2'), /still resolving/);
    emit({ type: 'agent_settled' });
    await first;
  } finally {
    if (saved === undefined) delete process.env.AIRP_WRITER_EARLY_RELEASE;
    else process.env.AIRP_WRITER_EARLY_RELEASE = saved;
  }
});
