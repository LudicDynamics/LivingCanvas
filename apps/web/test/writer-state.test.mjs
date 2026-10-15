// Canonical writer ingress snapshot tests. Run: node --test apps/web/test/writer-state.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';

let mod = null;
try {
  const { createJiti } = await import('../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs');
  const jiti = createJiti(import.meta.url, { moduleCache: false, tryNative: true });
  mod = await jiti.import('../src/lib/writer-state.ts');
} catch (err) {
  console.error('jiti/bootstrap unavailable, skipping writer-state tests:', err?.message ?? err);
}
const skip = mod ? false : 'jiti or pi-rp submodule unavailable';

function reset() {
  mod.reset();
  return mod.getWriterState();
}

test('writer ingress exposes busy stage and tool count without raw listeners', { skip }, () => {
  reset();
  mod.acceptWriterFrame({ type: 'agent_progress', source: 'writer', stage: 'Reading the scene', startedAt: 100, busy: true });
  assert.equal(mod.getWriterState().phase, 'writing');
  assert.equal(mod.getWriterState().startedAt, 100);
  assert.equal(mod.getWriterState().stage, 'Reading the scene');
  mod.acceptWriterFrame({ type: 'tool_start', source: 'writer' });
  assert.equal(mod.getWriterState().toolCount, 1);
  mod.acceptWriterFrame({ type: 'tool_end', source: 'writer' });
  assert.equal(mod.getWriterState().toolCount, 0);
});

test('busy false does not unlock before writer_idle', { skip }, () => {
  reset();
  mod.beginWriterPrompt('look around');
  mod.acceptWriterFrame({ type: 'agent_progress', source: 'writer', stage: 'Ready for your next action', busy: false });
  assert.equal(mod.getWriterState().phase, 'writing');
  mod.acceptWriterFrame({ type: 'writer_idle', source: 'writer' });
  assert.equal(mod.getWriterState().phase, 'idle');
});

test('writer message is retained and completion increments exactly once', { skip }, () => {
  reset();
  const before = mod.getWriterState().completionSeq;
  mod.beginWriterPrompt('continue');
  mod.acceptWriterFrame({ type: 'writer_message', source: 'writer', text: '  Done\nnow  ' });
  mod.acceptWriterFrame({ type: 'writer_idle', source: 'writer' });
  const snapshot = mod.getWriterState();
  assert.equal(snapshot.phase, 'idle');
  assert.equal(snapshot.lastMessage, '  Done\nnow  ');
  assert.equal(snapshot.completionSeq, before + 1);
  mod.acceptWriterFrame({ type: 'writer_idle', source: 'writer' });
  assert.equal(mod.getWriterState().completionSeq, before + 1);
});

test('new prompt clears the prior message; error and abort are retryable terminal states', { skip }, () => {
  reset();
  mod.beginWriterPrompt('first');
  mod.acceptWriterFrame({ type: 'writer_message', source: 'writer', text: 'old response' });
  mod.acceptWriterFrame({ type: 'writer_idle', source: 'writer' });
  mod.beginWriterPrompt('second');
  assert.equal(mod.getWriterState().lastMessage, null);
  mod.acceptWriterFrame({ type: 'error', source: 'writer', message: 'Provider unavailable' });
  assert.deepEqual(mod.getWriterState().error, { message: 'Provider unavailable', retryable: true });
  assert.equal(mod.getWriterState().lastMessage, null);
  assert.equal(mod.retryWriterPrompt(), 'second');
  const afterError = mod.getWriterState().completionSeq;
  mod.beginWriterPrompt('third');
  mod.requestWriterStop();
  assert.equal(mod.requestWriterStop(), false);
  mod.acceptWriterFrame({ type: 'turn_aborted', source: 'writer' });
  assert.equal(mod.getWriterState().completionSeq, afterError + 1);
  assert.equal(mod.getWriterState().phase, 'idle');
});
test('resetForReconnect releases the lock and clears world-scoped receipt state', { skip }, () => {
  mod.reset();
  mod.beginWriterPrompt('old world action');
  mod.acceptWriterFrame({ type: 'writer_message', source: 'writer', text: 'old world response' });
  mod.resetForReconnect('world_change');
  const snapshot = mod.getWriterState();
  assert.equal(snapshot.phase, 'idle');
  assert.equal(snapshot.lastPrompt, null);
  assert.equal(snapshot.lastMessage, null);
  assert.deepEqual(snapshot.error, { message: 'The active world changed. Please try again.', retryable: true });
});

// the design notes: the first page change releases the input; the tail never re-locks it.
test('landed progress releases the input; tail frames do not re-lock; idle closes the tail', { skip }, () => {
  reset();
  const before = mod.getWriterState().completionSeq;
  mod.beginWriterPrompt('open the door');
  mod.acceptWriterFrame({ type: 'tool_start', source: 'writer' });
  mod.acceptWriterFrame({ type: 'agent_progress', source: 'writer', stage: 'Chalk is ready · finishing world updates', busy: true, landed: true });
  let s = mod.getWriterState();
  assert.equal(s.phase, 'idle');
  assert.equal(s.tail, true);
  assert.equal(s.toolCount, 0);
  assert.equal(s.completionSeq, before + 1);
  assert.equal(s.stage, 'Ready for your next action');
  for (const frame of [
    { type: 'tool_start', source: 'writer' },
    { type: 'agent_progress', source: 'writer', stage: 'Updating the world', busy: true, landed: true },
    { type: 'agent_progress', source: 'writer', stage: 'Updating the world', busy: true },
    { type: 'writer_delta', source: 'writer', delta: 'x', toolCallId: 't' },
    { type: 'chalk_writing', source: 'writer', toolCallId: 't' },
    { type: 'error', source: 'writer', message: 'tail failed' },
  ]) {
    mod.acceptWriterFrame(frame);
    assert.equal(mod.getWriterState().phase, 'idle', frame.type);
  }
  mod.acceptWriterFrame({ type: 'writer_message', source: 'writer', text: 'The door gives.' });
  assert.equal(mod.getWriterState().lastMessage, 'The door gives.', 'the closing line fills the receipt');
  assert.equal(mod.getWriterState().error, null);
  mod.acceptWriterFrame({ type: 'writer_idle', source: 'writer' });
  s = mod.getWriterState();
  assert.equal(s.tail, false);
  assert.equal(s.phase, 'idle');
  assert.equal(s.completionSeq, before + 1, 'one beat, one completion');
  mod.acceptWriterFrame({ type: 'tool_start', source: 'writer' });
  assert.equal(mod.getWriterState().phase, 'writing', 'after the tail, writer frames lock again as before');
});

test('a prompt sent during the tail stays writing through the old beat frames and idle', { skip }, () => {
  reset();
  mod.beginWriterPrompt('first');
  mod.acceptWriterFrame({ type: 'agent_progress', source: 'writer', stage: 'Chalk is ready', busy: true, landed: true });
  assert.equal(mod.beginWriterPrompt('second'), true);
  const seq = mod.getWriterState().completionSeq;
  mod.acceptWriterFrame({ type: 'agent_progress', source: 'writer', stage: 'Updating the world', busy: true, landed: true });
  mod.acceptWriterFrame({ type: 'writer_message', source: 'writer', text: 'old closing line' });
  mod.acceptWriterFrame({ type: 'turn_aborted', source: 'writer' });
  assert.equal(mod.getWriterState().phase, 'writing', 'the old tail failing is not the new prompt failing');
  assert.equal(mod.getWriterState().lastMessage, null);
  mod.acceptWriterFrame({ type: 'writer_idle', source: 'writer' });
  assert.equal(mod.getWriterState().phase, 'writing', 'the old beat idle does not end the new prompt');
  assert.equal(mod.getWriterState().tail, false);
  mod.acceptWriterFrame({ type: 'agent_progress', source: 'writer', stage: 'Reading the scene', busy: true });
  mod.acceptWriterFrame({ type: 'writer_idle', source: 'writer' });
  assert.equal(mod.getWriterState().phase, 'idle');
  assert.equal(mod.getWriterState().completionSeq, seq + 1);
});

test('Stop on a prompt waiting behind a tail ends it at the abort', { skip }, () => {
  reset();
  mod.beginWriterPrompt('first');
  mod.acceptWriterFrame({ type: 'agent_progress', source: 'writer', busy: true, landed: true });
  mod.beginWriterPrompt('second');
  assert.equal(mod.requestWriterStop(), true);
  mod.acceptWriterFrame({ type: 'turn_aborted', source: 'writer' });
  assert.equal(mod.getWriterState().phase, 'idle');
  mod.acceptWriterFrame({ type: 'writer_idle', source: 'writer' });
  assert.equal(mod.getWriterState().tail, false);
  mod.resetForReconnect('socket_open');
  assert.equal(mod.getWriterState().tail, false);
});
