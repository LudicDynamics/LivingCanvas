// A character's spoken line never carries the model's reasoning
// Runs against built dist (`pnpm --filter @airp/server build`).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { stripReasoning, createReasoningFilter, REASONING_HOLD_CHARS } from '../dist/engine/reasoning-guard.js';
import { EventBridge } from '../dist/engine/event-bridge.js';

const stream = (text, size = 7) => {
  const f = createReasoningFilter();
  let out = '';
  for (let i = 0; i < text.length; i += size) out += f.push(text.slice(i, i + size));
  return out + f.end();
};

const LEAK = 'Okay, the user says they were asleep. I should respond as Xia Cheng, worried but polite, and push toward the notebook.\n\n「睡着了？……那你也没看见她往哪走。」夏澄咬了咬嘴唇。';
const LINE = '「睡着了？……那你也没看见她往哪走。」夏澄咬了咬嘴唇。';

test('inline think blocks are dropped (whole message and stream, tags split across deltas)', () => {
  const text = '<think>The user wants comfort. Keep it short.</think>「别慌，我们一起找。」';
  assert.equal(stripReasoning(text), '「别慌，我们一起找。」');
  for (const size of [1, 3, 5, 11]) assert.equal(stream(text, size), '「别慌，我们一起找。」', `delta size ${size}`);
  assert.equal(stripReasoning('<thinking>plan</thinking>\n\nHello there.'), 'Hello there.');
  // a reply that starts inside the block (its opening tag never sent)
  assert.equal(stripReasoning('so I will be calm</think>「好。」'), '「好。」');
  // an unclosed block at the end hides the rest
  assert.equal(stripReasoning('「好。」<think>and then'), '「好。」');
});

test('an English planning preamble before a Chinese / Japanese / Korean line is dropped', () => {
  assert.equal(stripReasoning(LEAK), LINE);
  for (const size of [1, 4, 9, 40]) assert.equal(stream(LEAK, size), LINE, `delta size ${size}`);
  const ja = 'Let me think about how Xia Cheng would answer in Japanese.\n「寝てたの？……じゃあ見てないよね。」';
  assert.equal(stripReasoning(ja), '「寝てたの？……じゃあ見てないよね。」');
  const ko = 'I need to respond in character as the conductor. 「주무셨어요? 그럼 못 보셨겠네요.」';
  assert.equal(stripReasoning(ko), '「주무셨어요? 그럼 못 보셨겠네요.」');
});

test('real lines are never eaten', () => {
  const keep = [
    '「K7次的乘客请注意——」夏澄的声音有点发抖。',
    '*Xia Cheng looks at you* 你醒了？',
    'OK，我去5车看看。',
    'Okay, I’ll help you look. Stay close to me.',
    'You were asleep? Then you didn’t see where she went.\n\nLet’s ask the student in seat 20.',
    'Hmm. The notebook is still warm.',
  ];
  for (const line of keep) {
    assert.equal(stripReasoning(line), line, line);
    assert.equal(stream(line, 3), line, `stream: ${line}`);
  }
});

test('an English meta first paragraph is dropped in any language; the hold is bounded', () => {
  const en = 'The user is asking where the passenger went. I should respond as Xia Cheng and stay in character.\n\nI didn’t see her leave. Her bag is still on seat 17.';
  assert.equal(stripReasoning(en), 'I didn’t see her leave. Her bag is still on seat 17.');
  assert.equal(stream(en, 6), 'I didn’t see her leave. Her bag is still on seat 17.');
  // a plain line streams early instead of waiting for the end
  const f = createReasoningFilter();
  assert.equal(f.push('Hello'), 'Hello', 'a line that cannot open a chain of thought streams at once');
  const g0 = createReasoningFilter();
  assert.equal(g0.push('The'), '', '“The” may still become “The user …”: held');
  assert.equal(g0.push(' door is open.'), 'The door is open.');
  // a long head with no decision is let through at the hold limit
  const g = createReasoningFilter();
  assert.ok(g.push('Okay '.repeat(REASONING_HOLD_CHARS / 5 + 1)).length > 0);
});

test('the bridge cleans character_delta and character_message, and leaves the writer alone', () => {
  const sent = [];
  const bridge = new EventBridge({ clients: new Set() });
  bridge.broadcast = (m) => sent.push(m);
  const delta = (d) => ({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: d } });
  for (let i = 0; i < LEAK.length; i += 10) bridge.emitEngine('character', delta(LEAK.slice(i, i + 10)), 'xia-cheng', 't1');
  bridge.emitEngine('character', { type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: LEAK }] } }, 'xia-cheng', 't1');
  const shown = sent.filter((m) => m.type === 'character_delta').map((m) => m.delta).join('');
  assert.equal(shown, LINE);
  assert.equal(sent.find((m) => m.type === 'character_message')?.text, LINE);
  assert.ok(!JSON.stringify(sent).includes('the user says'));
});
