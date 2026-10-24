// A character answers a voice call with thinking off;
// the next typed turn gets its launch level back. lifecycle.applyCharacterThinking.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AgentLifecycleManager } from '../dist/engine/lifecycle.js';

function fakeClient(level = 'low') {
  const calls = [];
  return {
    calls,
    async getState() { return { thinkingLevel: level }; },
    async setThinkingLevel(next) { calls.push(next); level = next; },
  };
}

test('a voice turn switches thinking off once; a dialogue turn restores the launch level', async () => {
  const manager = new AgentLifecycleManager({ repoRoot: '.', vendorCliPath: 'unused' });
  const client = fakeClient('medium');
  await manager.applyCharacterThinking(client, 'voice');
  await manager.applyCharacterThinking(client, 'voice');
  assert.deepEqual(client.calls, ['off'], 'switched only when it changes');
  await manager.applyCharacterThinking(client, 'dialogue');
  assert.deepEqual(client.calls, ['off', 'medium']);
});

test('a character never on a call is never touched', async () => {
  const manager = new AgentLifecycleManager({ repoRoot: '.', vendorCliPath: 'unused' });
  const client = fakeClient('low');
  await manager.applyCharacterThinking(client, 'dialogue');
  assert.deepEqual(client.calls, []);
});

test('a failed switch never fails the turn', async () => {
  const manager = new AgentLifecycleManager({ repoRoot: '.', vendorCliPath: 'unused' });
  const client = { async getState() { return { thinkingLevel: 'low' }; }, async setThinkingLevel() { throw new Error('rpc closed'); } };
  const warn = console.warn;
  console.warn = () => {};
  try {
    await manager.applyCharacterThinking(client, 'voice');
  } finally {
    console.warn = warn;
  }
});
