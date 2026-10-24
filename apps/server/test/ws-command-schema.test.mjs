import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WsCommandSchema } from '@airp/shared';

const savePath = '/saves/harbor-case';
const legitimateFrames = [
  { type: 'writer_prompt', savePath, message: 'Look around.', layer: 'map' },
  { type: 'writer_prompt', savePath, message: 'Add a clue.', mode: 'steer' },
  { type: 'writer_prompt', savePath, message: 'Continue.', mode: 'followUp' },
  { type: 'airp_init', savePath, kind: 'scene', target: 'market', by: 'player', request: 'A rainy morning', template: true },
  { type: 'writer_abort', savePath },
  { type: 'abort', savePath },
  { type: 'character_start', savePath, characterId: 'sarah', recentContext: 'The last exchange.' },
  { type: 'character_prompt', savePath, characterId: 'sarah', message: 'What happened?', mode: 'followUp' },
  { type: 'character_prompt', savePath, characterId: 'sarah', message: 'Add this detail.', mode: 'steer' },
  // Said over a voice call: answered with thinking off (lifecycle.applyCharacterThinking).
  { type: 'character_prompt', savePath, characterId: 'sarah', message: 'Are you there?', via: 'voice' },
  { type: 'character_abort', savePath, characterId: 'sarah' },
  { type: 'character_stop', savePath, characterId: 'sarah', turns: 3 },
  { type: 'character_stop', savePath, characterId: 'sarah' },
  // Chat end for the writer's summary (lib/chat-end.ts): how it ended, and no beat while held.
  { type: 'character_stop', savePath, characterId: 'sarah', via: 'voice', beat: false },
  { type: 'character_talk_end', savePath, characterId: 'sarah', via: 'dialogue' },
  { type: 'character_talk_end', savePath, characterId: 'sarah', via: 'voice', beat: false },
];

test('every current WebSocket command accepts its legitimate captured-save payload', () => {
  for (const frame of legitimateFrames) {
    assert.equal(WsCommandSchema.safeParse(frame).success, true, frame.type);
  }
});

test('every command requires a non-empty captured root and rejects extra fields', () => {
  for (const frame of legitimateFrames) {
    const { savePath: _savePath, ...unscoped } = frame;
    assert.equal(WsCommandSchema.safeParse(unscoped).success, false, `${frame.type} without savePath`);
    assert.equal(WsCommandSchema.safeParse({ ...frame, secretPromptEcho: 'must not be accepted' }).success, false,
      `${frame.type} with an undeclared field`);
  }
  assert.equal(WsCommandSchema.safeParse({ ...legitimateFrames[0], savePath: '' }).success, false);
});

test('command-specific values are type-checked before dispatch', () => {
  assert.equal(WsCommandSchema.safeParse({ type: 'writer_prompt', savePath, message: 42 }).success, false);
  assert.equal(WsCommandSchema.safeParse({ type: 'airp_init', savePath, kind: 'scene', target: 'market', template: 'yes' }).success, false);
  assert.equal(WsCommandSchema.safeParse({ type: 'character_prompt', savePath, characterId: 7, message: 'hello' }).success, false);
  assert.equal(WsCommandSchema.safeParse({ type: 'character_stop', savePath, characterId: 'sarah', turns: '3' }).success, false);
  assert.equal(WsCommandSchema.safeParse({ type: 'unknown_command', savePath }).success, false);
});

test('character_prompt.via is only dialogue or voice', () => {
  assert.equal(WsCommandSchema.safeParse({ type: 'character_prompt', savePath, characterId: 'sarah', message: 'hi', via: 'phone' }).success, false);
});
