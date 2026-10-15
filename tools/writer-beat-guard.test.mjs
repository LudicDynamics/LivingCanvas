import test from 'node:test';
import assert from 'node:assert/strict';
import { createJiti } from '../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  tryNative: true,
  alias: {
    '@earendil-works/pi-coding-agent': new URL('../vendor/pi-rp/packages/coding-agent/dist/index.js', import.meta.url).pathname,
  },
});
const guard = await jiti.import('../extensions/toolkit/writer-beat-guard.ts');
const { airpEnv } = await jiti.import('../apps/server/src/engine/presets.ts');

function fakePi() {
  const handlers = new Map();
  return {
    pi: { on: (event, handler) => handlers.set(event, handler) },
    handlers,
  };
}

function toolCall(handlers, toolName = 'read') {
  return handlers.get('tool_call')({ type: 'tool_call', toolCallId: 'test-call', toolName, input: {} });
}

function withEnv(key, value, callback) {
  const previous = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try {
    return callback();
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
}

test('strict parser accepts only safe positive decimal integers', () => {
  const parse = guard.parseWriterMaxToolCalls;
  assert.equal(parse(undefined), 24);
  assert.equal(parse('24'), 24);
  assert.equal(parse('1'), 1);
  assert.equal(parse('100'), 100);
  for (const raw of ['', '0', '-1', '+1', '1.5', '1e2', '0x10', ' 24', '24 ', '9007199254740992']) {
    assert.equal(parse(raw), 24, `expected ${JSON.stringify(raw)} to fall back`);
  }
  assert.equal(parse('bad', 7), 7);
  assert.equal(parse('bad', 0), 24);
});

test('environment configuration is read once and blocks exactly N+1', () => {
  withEnv('AIRP_WRITER_MAX_TOOL_CALLS', '2', () => {
    const { pi, handlers } = fakePi();
    guard.registerWriterToolCallGuard(pi, { role: 'writer', scope: 'writer-top-level' });
    process.env.AIRP_WRITER_MAX_TOOL_CALLS = '99';
    assert.equal(toolCall(handlers), undefined);
    assert.equal(toolCall(handlers), undefined);
    const blocked = toolCall(handlers, 'write');
    assert.equal(blocked.block, true);
    assert.equal(blocked.terminate, true);
    assert.match(blocked.reason, /limit \(2\)/);
    assert.doesNotMatch(blocked.reason, /write|test-call|input/);
  });
});

test('agent run budget spans engine turns and resets only at the next agent start', () => {
  const { pi, handlers } = fakePi();
  guard.registerWriterToolCallGuard(pi, { maxToolCalls: 2, role: 'writer', scope: 'writer-top-level' });
  handlers.get('agent_start')({ type: 'agent_start' });
  assert.equal(toolCall(handlers), undefined);
  assert.equal(toolCall(handlers), undefined);
  // pi-rp emits turn_start again for the next tool-loop provider request.
  // It is not a new player run, so the accumulated budget must remain spent.
  handlers.get('turn_start')?.({ type: 'turn_start', turnIndex: 1, timestamp: Date.now() });
  const blocked = toolCall(handlers);
  assert.equal(blocked.block, true);
  assert.equal(blocked.terminate, true);
  assert.match(blocked.reason, /limit \(2\)/);
  // A genuinely new prompt emits agent_start and receives a fresh budget.
  handlers.get('agent_start')({ type: 'agent_start' });
  assert.equal(toolCall(handlers), undefined);
});

test('non-writer roles and non-top-level scopes do not register hooks', () => {
  for (const [role, scope] of [
    ['character:alice', 'character'],
    ['functional:scene', 'functional'],
    ['writer', 'initializer'],
    ['unknown', 'writer-top-level'],
    [undefined, 'writer-top-level'],
    ['writer', undefined],
  ]) {
    const { pi, handlers } = fakePi();
    guard.registerWriterToolCallGuard(pi, { role, scope, maxToolCalls: 1 });
    assert.equal(handlers.size, 0, `${role}/${scope} unexpectedly enabled guard`);
  }
});

test('all tools share only the total budget and blocked calls do not execute', () => {
  const { pi, handlers } = fakePi();
  // Merge rationale: duplicate Chalk and native write/edit are allowed because
  // those the team limits directly prevent a Writer from fully initializing a scene.
  guard.registerWriterToolCallGuard(pi, { maxToolCalls: 8, role: 'writer', scope: 'writer-top-level' });
  const names = ['chalk', 'chalk', 'write', 'edit', 'read', 'custom', 'chalk', 'write'];
  let executions = 0;
  for (const name of names) {
    const result = toolCall(handlers, name);
    if (result === undefined) executions++;
  }
  const blocked = toolCall(handlers, 'edit');
  assert.equal(executions, 8);
  assert.equal(blocked.block, true);
  assert.equal(blocked.terminate, true);
  // There is no context/file/event dependency here: the guard is preflight only.
  assert.equal(Object.keys(blocked).sort().join(','), 'block,reason,terminate');
});

test('server env passthrough exposes the configured limit without copying unrelated env', () => {
  withEnv('AIRP_WRITER_MAX_TOOL_CALLS', '3', () => {
    withEnv('PATH', '/tmp/should-not-pass', () => {
      const env = airpEnv({ role: 'writer' });
      assert.equal(env.AIRP_WRITER_MAX_TOOL_CALLS, '3');
      assert.equal(env.PATH, undefined);
      assert.equal(env.AIRP_AGENT_ROLE, 'writer');
    });
  });
});
