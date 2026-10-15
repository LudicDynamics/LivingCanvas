// voice-live's wire protocol, tested as the pure thing
// it is: no socket, no microphone, no AudioContext, no voice-live running.
//
// The two rules under test are the ones integration.md flags as easy to get
// wrong: an audio frame is a header plus N binaries, and a `filler` is not
// something she said.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const frames = await jiti.import('../src/lib/voice-live-frames.ts');
const { VoiceLiveFrameReader, PlaybackLedger, pcm16ToFloat32 } = frames;

const json = (message) => ({ json: message });
const bytes = (...values) => {
  const buffer = new ArrayBuffer(values.length * 2);
  const view = new DataView(buffer);
  values.forEach((value, i) => view.setInt16(i * 2, value, true));
  return { binary: buffer };
};

/** Feed a whole sequence, keeping only the events the reader produced. */
function readAll(sequence) {
  const reader = new VoiceLiveFrameReader();
  const out = [];
  for (const frame of sequence) {
    const event = reader.read(frame);
    if (event) out.push(event);
  }
  return { events: out, reader };
}

test('a header without `chunks` owns exactly the next binary', () => {
  const { events, reader } = readAll([
    json({ type: 'segment', id: 1, text: 'hello', sr: 16000 }),
    bytes(100, 200),
    // The next binary has no header: it must be dropped, not attached to 1.
    bytes(300),
  ]);
  assert.equal(events[0].kind, 'segment');
  assert.equal(events[0].chunks, false);
  const audio = events.filter((e) => e.kind === 'audio');
  assert.equal(audio.length, 1, 'a single-shot header must not swallow later audio');
  assert.equal(audio[0].id, 1);
  assert.equal(audio[0].sampleRate, 16000);
  assert.equal(reader.orphanAudioFrames, 1);
});

test('`chunks: true` keeps the header open until segment_end', () => {
  // The clipping bug this prevents: stopping after the first chunk truncates
  // every streamed line, and it sounds like her, only cut short.
  const { events } = readAll([
    json({ type: 'segment', id: 4, text: 'a longer line', sr: 16000, chunks: true }),
    bytes(1), bytes(2), bytes(3),
    json({ type: 'segment_end', id: 4, ms: 1200 }),
    bytes(9),
  ]);
  const audio = events.filter((e) => e.kind === 'audio');
  assert.equal(audio.length, 3, 'all three chunks belong to segment 4');
  assert.ok(audio.every((e) => e.id === 4 && e.filler === false));
  assert.deepEqual(
    events.find((e) => e.kind === 'segment-end'),
    { kind: 'segment-end', id: 4, ms: 1200 },
  );
  // And the header really did close: the binary after segment_end is an orphan.
  assert.equal(audio.length, 3);
});

test('a filler carries its audio but is marked as not-her-words', () => {
  const { events } = readAll([
    json({ type: 'filler', id: 77, kind: 'hmm', text: 'ええと', sr: 16000, ms: 300 }),
    bytes(5, 6),
    bytes(7),
  ]);
  const filler = events.find((e) => e.kind === 'filler');
  assert.equal(filler.text, 'ええと');
  const audio = events.filter((e) => e.kind === 'audio');
  assert.equal(audio.length, 1, 'a filler is never chunked');
  assert.equal(audio[0].filler, true, 'the flag is what keeps it out of the history');
});

test('a filler between chunks does not steal the open segment’s audio', () => {
  // The reflex layer can slip a filler in; when it does, the segment header it
  // interrupted is finished by its own `segment_end`, not by the filler.
  const { events } = readAll([
    json({ type: 'segment', id: 2, text: 'line', sr: 16000, chunks: true }),
    bytes(1),
    json({ type: 'filler', id: 90, text: 'あの', sr: 16000 }),
    bytes(2),
    json({ type: 'segment_end', id: 2, ms: 500 }),
  ]);
  const audio = events.filter((e) => e.kind === 'audio');
  assert.deepEqual(audio.map((e) => [e.id, e.filler]), [[2, false], [90, true]]);
});

test('hello sets the sample rate that later frames inherit', () => {
  const { events } = readAll([
    json({ type: 'hello', session: 's1', sample_rate: 24000, tts: 'setsuna', brain: 'airp' }),
    json({ type: 'segment', id: 1, text: 'x' }),
  ]);
  assert.deepEqual(events[0], {
    kind: 'hello', session: 's1', sampleRate: 24000, tts: 'setsuna', brain: 'airp',
  });
  // `sr` is absent on the segment, so the session rate is what applies.
  assert.equal(events[1].sampleRate, 24000);
});

test('the rest of the table maps to events, and unknown frames are inert', () => {
  const { events } = readAll([
    json({ type: 'state', bot: 'speaking' }),
    json({ type: 'user_start' }),
    json({ type: 'user_end' }),
    json({ type: 'transcript', text: 'こんばんは', lang: 'ja' }),
    json({ type: 'thought', text: 'she wonders', emo: 'calm' }),
    json({ type: 'duck', on: true }),
    json({ type: 'interrupt', reply: 3, grace_ms: 400 }),
    json({ type: 'resume', reply: 3 }),
    json({ type: 'yield', reply: 4 }),
    json({ type: 'backchannel', text: 'うん' }),
    json({ type: 'unprompted', reply: 5, text: 'still there?' }),
    json({ type: 'error', where: 'tts', message: 'gateway down' }),
    json({ type: 'turn', p: null, timeout: true }),
    json({ type: 'decision', state: 'wait' }),
    json({ type: 'span', name: 'cortex' }),
    json({ type: 'something_new_in_2027' }),
  ]);
  assert.deepEqual(events.map((e) => e.kind), [
    'state', 'user-start', 'user-end', 'transcript', 'thought', 'duck',
    'interrupt', 'resume', 'yield', 'backchannel', 'unprompted', 'error',
    'ignored', 'ignored', 'ignored', 'ignored',
  ]);
  assert.equal(events[0].bot, 'speaking');
  assert.equal(events[5].on, true);
  assert.equal(events[6].graceMs, 400);
  assert.equal(events[11].where, 'tts');
  // A frame voice-live adds later must not break a call in progress.
  assert.equal(events[15].type, 'something_new_in_2027');
  // `state` with a bot value we do not know is dropped rather than guessed.
  const reader = new VoiceLiveFrameReader();
  assert.equal(reader.read(json({ type: 'state', bot: 'dreaming' })), null);
});

test('a real segment is reported played exactly once, and only when complete', () => {
  const ledger = new PlaybackLedger();
  ledger.schedule(1, 1_000, 1_500, false);
  // No `segment_end` yet: more chunks may still come, so nothing is owed.
  assert.equal(ledger.finish(1), null);
  ledger.schedule(1, 1_500, 2_000, false);
  ledger.complete(1);
  assert.deepEqual(ledger.finish(1), {
    type: 'played', seg: 1, started_at: 1_000, ended_at: 2_000,
  });
  // Never twice — a duplicate receipt corrupts her idea of what was heard.
  assert.equal(ledger.finish(1), null);
});

test('a filler is never reported played', () => {
  const ledger = new PlaybackLedger();
  ledger.schedule(90, 500, 800, true);
  ledger.complete(90);
  assert.equal(ledger.finish(90), null, 'reporting a filler makes her think she answered');
  assert.equal(ledger.isPending(90), false);
});

test('an interrupt reports how far the sounding segment actually got', () => {
  const ledger = new PlaybackLedger();
  ledger.schedule(3, 1_000, 4_000, false);
  ledger.complete(3);
  assert.deepEqual(ledger.interrupt(2_200), {
    type: 'interrupted', seg: 3, played_ms: 1_200, started_at: 1_000,
  });
  // Everything pending is forgotten: none of it will finish, so none of it can
  // still owe a `played`.
  assert.equal(ledger.finish(3), null);
});

test('an interrupt picks the segment that was sounding, not one still queued', () => {
  const ledger = new PlaybackLedger();
  ledger.schedule(1, 1_000, 2_000, false);
  ledger.complete(1);
  ledger.schedule(2, 2_000, 3_000, false); // scheduled, has not begun at t=1500
  ledger.complete(2);
  const receipt = ledger.interrupt(1_500);
  assert.equal(receipt.seg, 1);
  assert.equal(receipt.played_ms, 500);
});

test('an interrupt with nothing sounding still answers', () => {
  const ledger = new PlaybackLedger();
  assert.deepEqual(ledger.interrupt(900), {
    type: 'interrupted', seg: null, played_ms: 0, started_at: 900,
  });
  // A filler alone is not something an interrupt reports either.
  ledger.schedule(5, 100, 200, true);
  assert.equal(ledger.interrupt(150).seg, null);
});

test('played_ms never exceeds the segment’s own length', () => {
  const ledger = new PlaybackLedger();
  ledger.schedule(1, 1_000, 1_400, false);
  ledger.complete(1);
  // The interrupt arrived after the audio had already finished sounding.
  assert.equal(ledger.interrupt(9_999).played_ms, 400);
});

test('PCM16 LE decodes to the [-1, 1) range, offset and endianness safe', () => {
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  for (const [i, value] of [0, 32767, -32768, -1].entries()) view.setInt16(i * 2, value, true);
  const out = pcm16ToFloat32(buffer);
  assert.equal(out.length, 4);
  assert.equal(out[0], 0);
  assert.ok(Math.abs(out[1] - 0.99997) < 0.001);
  assert.equal(out[2], -1);
  assert.ok(Math.abs(out[3] + 0.0000305) < 0.0001);
  // An odd trailing byte is ignored rather than read past the end.
  assert.equal(pcm16ToFloat32(new ArrayBuffer(5)).length, 2);
});

test('the module is pure: nothing here opens anything', async () => {
  const source = await readFile(new URL('../src/lib/voice-live-frames.ts', import.meta.url), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const forbidden of ['WebSocket', 'AudioContext', 'fetch(', 'setTimeout', 'navigator']) {
    assert.ok(!code.includes(forbidden), `voice-live-frames.ts must not reference ${forbidden}`);
  }
});
