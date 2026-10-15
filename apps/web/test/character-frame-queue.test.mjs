// Character relay FIFO tests. Run: node --test apps/web/test/character-frame-queue.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';

let mod = null;
let dialogue = null;
try {
  const { createJiti } = await import('../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs');
  const jiti = createJiti(import.meta.url, { moduleCache: false, tryNative: true });
  mod = await jiti.import('../src/lib/character-frame-queue.ts');
  dialogue = await jiti.import('../src/components/overlay/dialogue-pages.ts');
} catch (err) {
  console.error('jiti/bootstrap unavailable, skipping character-frame-queue tests:', err?.message ?? err);
}
const skip = mod && dialogue ? false : 'jiti or pi-rp submodule unavailable';

const delta = (characterId, text) => ({ type: 'character_delta', source: 'character', characterId, delta: text });
const message = (characterId, text) => ({ type: 'character_message', source: 'character', characterId, text });
const idle = (characterId) => ({ type: 'character_idle', source: 'character', characterId });

function queue() {
  mod.resetCharacterFrameQueueForTest();
  return mod.getCharacterFrameQueue();
}

test('FIFO preserves every delta and keeps message as a barrier', { skip }, () => {
  const q = queue();
  q.enqueue(delta('nanami', 'a'), q.nextDeliverySeq());
  q.enqueue(delta('nanami', 'b'), q.nextDeliverySeq());
  q.enqueue(message('nanami', 'ab'), q.nextDeliverySeq());
  q.enqueue(delta('nanami', 'c'), q.nextDeliverySeq());
  assert.deepEqual(q.drainUntil('nanami').map((frame) => frame.type + ':' + (frame.delta ?? frame.text ?? '')), [
    'character_delta:a',
    'character_delta:b',
    'character_message:ab',
    'character_delta:c',
  ]);
});

test('multiple assistant messages, including equal text, are not content-deduplicated', { skip }, () => {
  const q = queue();
  q.enqueue(message('nanami', 'same'), 1);
  q.enqueue(message('nanami', 'same'), 2);
  q.enqueue(idle('nanami'), 3);
  assert.equal(q.drainUntil('nanami').filter((frame) => frame.type === 'character_message').length, 2);
});

test('idle, error, and abort remain ordered terminal barriers', { skip }, () => {
  const q = queue();
  q.enqueue(idle('nanami'), 1);
  q.enqueue({ type: 'error', source: 'character', characterId: 'nanami', message: 'down' }, 2);
  q.enqueue({ type: 'turn_aborted', source: 'character', characterId: 'nanami', message: 'cancelled' }, 3);
  assert.deepEqual(q.drainUntil('nanami').map((frame) => frame.type), ['character_idle', 'error', 'turn_aborted']);
});

test('delivery gaps emit an observable failure, clear buffered frames, and block silent continuation', { skip }, () => {
  const q = queue();
  const events = [];
  q.subscribe((event) => {
    if (event) events.push(event);
  });
  q.enqueue(delta('nanami', 'first'), 10);
  q.enqueue(delta('nanami', 'missing'), 12);
  assert.deepEqual(q.drainUntil('nanami'), []);
  assert.equal(q.peek(), null);
  assert.deepEqual(events.map((event) => event.kind), ['gap']);
  assert.equal(events[0].expectedSeq, 11);
  assert.equal(events[0].receivedSeq, 12);
  // Frames after a gap do not silently append until the integrator resets.
  q.enqueue(message('nanami', 'authoritative'), 13);
  assert.deepEqual(q.drainUntil('nanami'), []);
  q.clear('gap');
  q.enqueue(message('nanami', 'authoritative'), 1);
  assert.deepEqual(q.drainUntil('nanami').map((frame) => frame.text), ['authoritative']);
});

test('unsequenced legacy frames preserve arrival order and report unavailable sequence', { skip }, () => {
  const q = queue();
  const events = [];
  q.subscribe((event) => {
    if (event) events.push(event);
  });
  q.enqueue(delta('nanami', 'a'), null);
  q.enqueue(delta('nanami', 'b'));
  assert.deepEqual(q.drainUntil('nanami').map((frame) => frame.delta), ['a', 'b']);
  assert.equal(events.filter((event) => event.kind === 'sequence-unavailable').length, 1);
});

test('barrier drain stops at message while legacy character drain remains compatible', { skip }, () => {
  const q = queue();
  q.enqueue(delta('nanami', 'a'), 1);
  q.enqueue(message('nanami', 'a'), 2);
  q.enqueue(delta('nanami', 'b'), 3);
  assert.deepEqual(q.drainUntil('character_message').map((frame) => frame.type), [
    'character_delta',
    'character_message',
  ]);
  assert.equal(q.peek()?.delta, 'b');
});

test('invalid or unassigned frames never enter the queue', { skip }, () => {
  const q = queue();
  q.enqueue({ type: 'character_delta', source: 'character', delta: 'orphan' }, 1);
  q.enqueue({ type: 'character_delta', source: 'character', characterId: '../evil', delta: 'bad' }, 2);
  q.enqueue({ type: 'error', source: 'writer', characterId: 'nanami', message: 'wrong lane' }, 3);
  assert.deepEqual(q.drainUntil('nanami'), []);
  assert.equal(mod.isCharacterFrame({ type: 'character_delta', characterId: 'nanami', delta: 'ok' }), true);
  assert.equal(mod.isCharacterFrame({ type: 'character_delta', delta: 'orphan' }), false);
});

test('consumer applies drained frames in order and keeps assistant messages across idle barrier', { skip }, () => {
  const q = queue();
  q.enqueue(delta('nanami', 'first'), q.nextDeliverySeq());
  q.enqueue(message('nanami', 'first'), q.nextDeliverySeq());
  q.enqueue(message('nanami', 'second'), q.nextDeliverySeq());
  q.enqueue(idle('nanami'), q.nextDeliverySeq());

  let buffer = dialogue.createCharacterTurn();
  let projection;
  for (const frame of q.drainUntil('nanami')) {
    const input = frame.type === 'character_delta'
      ? { type: frame.type, delta: frame.delta }
      : frame.type === 'character_message'
        ? { type: frame.type, text: frame.text }
        : { type: frame.type };
    projection = dialogue.consumeCharacterFrame(buffer, input);
    buffer = projection.buffer;
  }
  assert.equal(projection.turnClosed, true);
  assert.deepEqual(buffer.messages, ['first', 'second']);
});
