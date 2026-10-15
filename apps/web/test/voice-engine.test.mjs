// Voice channel + pagination request-state assertions (TTS batch, the design notes).
// Web Audio is unavailable in node → initAudio() returns null, so V-group ONLY
// asserts the request state the engine recorded, never ctx/decode/mixing.
// P-group drives the pure pagination fn — the "no newline = 1
// page" degenerate form is the batch's key non-emptiness assertion (§6.2 warning).
// Run: node --test apps/web/test/voice-engine.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';

let audio = null;
let pages = null;
try {
  const { createJiti } = await import('../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs');
  const jiti = createJiti(import.meta.url, { moduleCache: false, tryNative: true });
  audio = await jiti.import('../src/lib/audio.ts');
  pages = await jiti.import('../src/components/overlay/dialogue-pages.ts');
} catch (err) {
  console.error('jiti/bootstrap unavailable, skipping engine group:', err?.message ?? err);
}
const skip = audio && pages ? false : 'jiti or pi-rp submodule unavailable';

// ── V 组：语音通道（契约 §5 / 02 §12.2） ──

test('V1 playVoice 无 ctx 不抛，且记录 url；isVoicing() 恒 false', { skip }, () => {
  assert.equal(audio.initAudio(), null);
  const url = '/api/tts/audio/0123456789abcdef0123.wav';
  assert.doesNotThrow(() => audio.playVoice(url));
  assert.equal(audio.voiceDebugState().url, url);
  assert.equal(audio.isVoicing(), false);
});

test('V2 stopVoice 清空 url 且幂等（连调两次不抛）', { skip }, () => {
  audio.playVoice('/api/tts/audio/aaaaaaaaaaaaaaaaaaaa.wav');
  assert.doesNotThrow(() => audio.stopVoice());
  assert.equal(audio.voiceDebugState().url, null);
  assert.doesNotThrow(() => audio.stopVoice());
  assert.equal(audio.voiceDebugState().url, null);
});

test('V3 playVoice 新调用打断旧调用（最后胜出）', { skip }, () => {
  audio.playVoice('/api/tts/audio/aaaaaaaaaaaaaaaaaaaa.wav');
  audio.playVoice('/api/tts/audio/bbbbbbbbbbbbbbbbbbbb.wav');
  assert.equal(audio.voiceDebugState().url, '/api/tts/audio/bbbbbbbbbbbbbbbbbbbb.wav');
});

test('V4 audioDebugState 形状仍严格四键（契约 §5 冻结）', { skip }, () => {
  assert.deepEqual(Object.keys(audio.audioDebugState()).sort(), ['ambient', 'bgm', 'loaded', 'theme']);
});

test('V5 四个新导出均为 function', { skip }, () => {
  for (const name of ['playVoice', 'stopVoice', 'isVoicing', 'voiceDebugState']) {
    assert.equal(typeof audio[name], 'function', `${name} must be exported`);
  }
});

test('V6 playVoice("") 不抛；无 ctx 下 isVoicing 恒 false', { skip }, () => {
  assert.doesNotThrow(() => audio.playVoice(''));
  assert.equal(audio.isVoicing(), false);
  audio.stopVoice();
});

// ── P 组：分页纯函数（契约 §6 / §6.2 实测警告；编号以 03 §10.1 为准） ──

test('P1 NON-EMPTINESS: 无换行 → 整段 = 1 页（不空白、不报错）', { skip }, () => {
  const r = pages.parseEmoPages('done', { final: true });
  assert.equal(r.pages.length, 1);
  assert.equal(r.pages[0].text, 'done');
  assert.equal(r.pages[0].sealed, true);
});

test('P2 空输入 → 0 页（空页丢弃）', { skip }, () => {
  assert.equal(pages.parseEmoPages('', { final: true }).pages.length, 0);
});

test('P3 多行 → 一页一行且全部封口', { skip }, () => {
  const r = pages.parseEmoPages('a\nb\nc', { final: true });
  assert.deepEqual(r.pages.map((p) => p.text), ['a', 'b', 'c']);
  assert.ok(r.pages.every((p) => p.sealed));
});

test('P4 空行丢弃（连续 \\n 不产生空页）', { skip }, () => {
  assert.deepEqual(pages.parseEmoPages('a\n\n\nb', { final: true }).pages.map((p) => p.text), ['a', 'b']);
});

test('P5 [emo:] 继承上一页 + 标签剥离', { skip }, () => {
  const r = pages.parseEmoPages('[emo: smile]a\nb', { final: true });
  assert.equal(r.pages[0].emo, 'smile');
  assert.equal(r.pages[1].emo, 'smile');
  assert.equal(r.pages[0].text, 'a');
});

test('P6 未闭合 [emo 前缀冻结保留（EMO_PREFIX_GUARD）', { skip }, () => {
  const r = pages.parseEmoPages('[emo: smi', { final: false });
  assert.equal(r.tailOpen, true);
  assert.equal(r.pages[0].text, '');
  assert.equal(r.pages[0].sealed, false);
});

test('P7 未封口末页（final:false）：首行封口、末行未封口', { skip }, () => {
  const r = pages.parseEmoPages('a\nb', { final: false });
  assert.equal(r.pages[0].sealed, true);
  assert.equal(r.pages[1].sealed, false);
});

test('P8 clampPageIndex 边界', { skip }, () => {
  assert.equal(pages.clampPageIndex(-1, 3), 0);
  assert.equal(pages.clampPageIndex(5, 3), 2);
  assert.equal(pages.clampPageIndex(0, 0), 0);
});

test('P9 韵律表未被删（charDelay）', { skip }, () => {
  assert.equal(pages.charDelay(','), 300);
  assert.equal(pages.charDelay('。'), 150);
  assert.equal(pages.charDelay('a'), 45);
});

test('P10 GREETING_LINE 冻结文案（ja/en）', { skip }, () => {
  assert.equal(pages.GREETING_LINE.ja.text, 'どうしたの？');
  assert.equal(pages.GREETING_LINE.en.text, 'Something on your mind?');
});

test('P11 超长单行不被截断（页文本原样保留）', { skip }, () => {
  const r = pages.parseEmoPages('x'.repeat(2000), { final: true });
  assert.equal(r.pages.length, 1);
  assert.equal(r.pages[0].text.length, 2000);
});

test('P12 负向：不按标点自动切页（分页单位只有 \\n）', { skip }, () => {
  assert.equal(pages.parseEmoPages('one. two. three.', { final: true }).pages.length, 1);
});

test('P13 角色多 assistant message 按序聚合，delta/message_end 不重复', { skip }, () => {
  let buffer = pages.createCharacterTurn();
  let projection;
  for (const frame of [
    { type: 'character_delta', delta: '先说前台词。' },
    { type: 'character_message', text: '先说前台词。' },
    { type: 'character_delta', delta: '工具回来后的回应。' },
    { type: 'character_message', text: '工具回来后的回应。' },
    { type: 'character_idle' },
  ]) {
    projection = pages.consumeCharacterFrame(buffer, frame);
    buffer = projection.buffer;
  }
  assert.equal(projection.rawText, '先说前台词。\n工具回来后的回应。');
  assert.deepEqual(pages.parseEmoPages(projection.rawText, { final: true }).pages.map((p) => p.text), [
    '先说前台词。',
    '工具回来后的回应。',
  ]);
});

test('P14 纯工具轮与空 message_end 不产生台词', { skip }, () => {
  let buffer = pages.createCharacterTurn();
  let projection = pages.consumeCharacterFrame(buffer, { type: 'character_message', text: '   ' });
  projection = pages.consumeCharacterFrame(projection.buffer, { type: 'character_idle' });
  assert.equal(projection.rawText, '');
  assert.equal(projection.buffer.messages.length, 0);
  assert.equal(projection.buffer.ended, true);
});
