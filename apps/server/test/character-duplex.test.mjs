import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLiveSidebandChannel, receiptLine, receiptOf } from '../dist/engine/character-duplex.js';

const start = (toolCallId, toolName, args) => ({ type: 'tool_execution_start', toolCallId, toolName, args });
const end = (toolCallId, toolName, result, isError = false) => ({ type: 'tool_execution_end', toolCallId, toolName, result, isError });

test('receiptOf keeps the world-changing calls of a turn, with the paths they reported', () => {
  const events = [
    start('c1', 'look_at', { path: 'world/inn/a.md' }),
    end('c1', 'look_at', { details: {} }),
    start('c2', 'move', { path: 'world/inn/old-key.md', to: 'player' }),
    end('c2', 'move', { details: { path: 'player/old-key.md' } }),
    start('c3', 'chalk', { path: 'world/inn/03-reply.md', content: '…' }),
    end('c3', 'chalk', { details: { path: 'world/inn/03-reply.md' } }),
    start('c4', 'roll_dice', { path: 'world/inn/lock.md' }),
    end('c4', 'roll_dice', { details: {} }, true),
  ];
  assert.deepEqual(receiptOf(events), [
    { tool: 'move', ok: true, path: 'player/old-key.md', target: 'player' },
    { tool: 'chalk', ok: true, path: 'world/inn/03-reply.md' },
    { tool: 'roll_dice', ok: false, path: 'world/inn/lock.md' },
  ]);
  assert.deepEqual(receiptOf([]), []);
});

test('receiptLine phrases done and failed actions for the voice, per language', () => {
  const receipt = receiptOf([
    start('c2', 'move', { path: 'world/inn/old-key.md', to: 'player' }),
    end('c2', 'move', { details: { path: 'player/old-key.md' } }),
    start('c4', 'roll_dice', { path: 'world/inn/lock.md' }),
    end('c4', 'roll_dice', { details: {} }, true),
  ]);
  assert.equal(receiptLine(receipt, 'en'), '(Done: moved old key to player.) (Could not: rolled the dice.)');
  assert.equal(receiptLine(receipt, 'ja'), '（完了：old keyをplayerへ移しました） （できなかったこと：ダイスを振りました）');
  assert.equal(receiptLine([], 'en'), null);
});

test('the GPT Live channel writes the frozen sideband frames and never swallows a failure', () => {
  const sent = [];
  const failures = [];
  let salt = 0;
  const channel = createLiveSidebandChannel({
    socket: { send: (data) => { if (data.includes('boom')) throw new Error('socket gone'); sent.push(JSON.parse(data)); }, close: () => sent.push('closed') },
    salt: () => salt++,
    onFailure: (reason) => failures.push(reason),
  });
  assert.equal(channel.kind, 'gpt-live');
  channel.speak('d1', 'I found the key.');
  channel.notice(null, 'Say it again?');
  channel.speak('d1', 'boom');
  channel.close();
  assert.deepEqual(sent, [
    { type: 'session.commentary.append', event_id: 'commentary_d1_0', delegation_id: 'd1', content: 'I found the key.' },
    { type: 'session.instructions.append', event_id: 'instructions_1', delegation_id: null, content: 'Say it again?' },
    'closed',
  ]);
  assert.deepEqual(failures, ['commentary append failed: socket gone']);
});
