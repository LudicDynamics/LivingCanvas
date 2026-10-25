// The call's one status line (lib/live-call-status-line.ts): 连接中 / 在听 /
// 听到了「…」 / 思考中 / 说话中 / 出错（原因）, a pure projection of the store's
// snapshot — and the store wiring that feeds `heard` from voice-live's frames.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { callStatusLine, HEARD_MAX_CHARS } = await jiti.import('../src/lib/live-call-status-line.ts');

test('every phase and bot state maps to one line', () => {
  assert.equal(callStatusLine({ phase: 'idle' }), null);
  assert.deepEqual(callStatusLine({ phase: 'connecting' }), { kind: 'connecting' });
  assert.deepEqual(callStatusLine({ phase: 'live', bot: 'listening' }), { kind: 'listening' });
  assert.deepEqual(callStatusLine({ phase: 'live', bot: 'listening', heard: ' 你是谁？ ' }), { kind: 'heard', heard: '你是谁？' });
  assert.deepEqual(callStatusLine({ phase: 'live', bot: 'thinking', heard: '你是谁？' }), { kind: 'thinking', heard: '你是谁？' });
  assert.deepEqual(callStatusLine({ phase: 'live', bot: 'speaking', heard: '你是谁？' }), { kind: 'speaking' });
  assert.deepEqual(callStatusLine({ phase: 'error', error: 'voice-live is not ready' }), { kind: 'error', reason: 'voice-live is not ready' });
  assert.deepEqual(callStatusLine({ phase: 'error' }), { kind: 'error' });
});

test('a long transcript is shortened for the line', () => {
  const line = callStatusLine({ phase: 'live', bot: 'listening', heard: '字'.repeat(HEARD_MAX_CHARS + 10) });
  assert.equal(Array.from(line.heard).length, HEARD_MAX_CHARS + 1);
  assert.ok(line.heard.endsWith('…'));
});

test('the store feeds it: transcript → heard, user_start and speaking clear it; the badge renders it; 4 languages', () => {
  const store = fs.readFileSync(new URL('../src/lib/live-call-store.ts', import.meta.url), 'utf8');
  assert.match(store, /if \(text\.trim\(\)\) commitState\(\{ heard: text\.trim\(\) \}\)/);
  assert.match(store, /onUserStart: \(\) => \{/);
  assert.match(store, /state === 'speaking' \? \{ heard: undefined \}/);
  const call = fs.readFileSync(new URL('../src/lib/voice-live-call.ts', import.meta.url), 'utf8');
  assert.match(call, /case 'user-start':\n\s+handlers\.onUserStart\?\.\(\);/);
  const view = fs.readFileSync(new URL('../src/components/live/LiveCallStatus.tsx', import.meta.url), 'utf8');
  assert.match(view, /callStatusLine\(call\)/);
  const messages = JSON.parse(fs.readFileSync(new URL('../src/lib/messages.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(messages['Heard “{text}”']).sort(), ['ja', 'ko', 'zh-CN']);
  assert.equal(messages['Heard “{text}”']['zh-CN'], '听到了「{text}」');
  assert.equal(messages['Characters are starting']['zh-CN'], '角色正在启动');
});
