// One speaker's voice queue (apps/web/src/lib/speaker-voice.ts):
//   「关掉 NPC / 角色对话回到桌面，它剩下的话还在继续读，还从陪伴角色那里接着读；
//     没有办法让角色停下来」 + 「第三人称的旁白不读」.
// Behaviour is driven through injected deps: no DOM, no AudioContext, no network.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { SpeakerVoice, forgetSpokenLines } = await jiti.import('../src/lib/speaker-voice.ts');

const src = (rel) => readFile(new URL(rel, import.meta.url), 'utf8');
const dock = await src('../src/components/sidebar/CharacterDock.tsx');
const npc = await src('../src/components/sidebar/NpcDialogue.tsx');
const modal = await src('../src/components/overlay/CharacterModal.tsx');
const controls = await src('../src/components/chrome/SpeakerControls.tsx');
const hook = await src('../src/lib/use-spoken-lines.ts');
const queueSrc = await src('../src/lib/speaker-voice.ts');
const request = await src('../src/lib/tts-request.ts');
const messages = JSON.parse(await src('../src/lib/messages.json'));

const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const line = (id, text, over = {}) => ({ id, who: 'character', text, emo: 'normal', pending: false, ...over });
const OPTS = { language: 'zh', names: ['夏澄'] };

/** A fake channel: requests stay open until the test resolves them. */
function harness() {
  const log = { requests: [], played: [], stops: 0 };
  let voicing = false;
  let clock = 0;
  const deps = {
    fetchVoice(req, stillValid, signal) {
      return new Promise((resolve) => {
        const entry = { req, stillValid, signal, resolve: (url) => resolve(signal.aborted || !stillValid() ? { status: 'stale' } : { status: 'ready', url }) };
        signal.addEventListener('abort', () => resolve({ status: 'stale' }));
        log.requests.push(entry);
      });
    },
    play(url) { log.played.push(url); voicing = true; },
    stop() { log.stops += 1; voicing = false; },
    isVoicing: () => voicing,
    wait: () => Promise.resolve(),
    // Advancing clock: a wait that never ends is bounded by the 30 s timeout.
    now: () => (clock += 100),
  };
  return { log, deps, end: () => { voicing = false; } };
}

test('narration is not sent to TTS; a narration-only line is not requested at all', async () => {
  forgetSpokenLines();
  const { log, deps } = harness();
  const voice = new SpeakerVoice(deps);
  voice.setSpeaker('xia-cheng');
  voice.speak('xia-cheng', [
    line(1, '（她没有回答，只是把名单攥得更紧了。）'),
    line(2, '她低下头，指尖摩挲着信封。我没看见那封信。'),
  ], OPTS);
  await flush();
  assert.equal(log.requests.length, 1);
  assert.equal(log.requests[0].req.text, '我没看见那封信。');
  assert.equal(log.requests[0].req.characterId, 'xia-cheng');
});

test('closing the dialogue stops the clip, drops the queue, aborts the request, discards late audio', async () => {
  forgetSpokenLines();
  const { log, deps } = harness();
  const voice = new SpeakerVoice(deps);
  voice.setSpeaker('vera');
  voice.speak('vera', [line(1, 'First.'), line(2, 'Second.'), line(3, 'Third.')], OPTS);
  await flush();
  log.requests[0].resolve('a.mp3');
  await flush();
  assert.deepEqual(log.played, ['a.mp3']);
  assert.equal(voice.speaking, true);
  // line 2 is in flight when the player closes
  assert.equal(log.requests.length, 2);
  const inFlight = log.requests[1];
  const stopsBefore = log.stops;
  voice.setSpeaker(null);
  assert.equal(inFlight.signal.aborted, true, 'in-flight request aborted');
  assert.ok(log.stops > stopsBefore, 'current clip stopped');
  assert.equal(voice.speaking, false);
  inFlight.resolve('b.mp3'); // arrives late
  await flush();
  assert.deepEqual(log.played, ['a.mp3'], 'late audio for a closed dialogue is never played');
  assert.equal(log.requests.length, 2, 'the queued third line was dropped, not requested');
});

test('another character never continues the previous one’s lines', async () => {
  forgetSpokenLines();
  const { log, deps } = harness();
  const voice = new SpeakerVoice(deps);
  voice.setSpeaker('old-mo');
  const moLines = [line(10, '那十二分钟，是我把灯熄的。'), line(11, '我不替它编。')];
  voice.speak('old-mo', moLines, OPTS);
  await flush();
  const moRequest = log.requests[0];
  // The player turns to the companion. For one render the dock still holds
  // 老莫's scrollback; handing it over under the companion's id is refused.
  voice.setSpeaker('vera');
  voice.speak('old-mo', moLines, OPTS);
  moRequest.resolve('mo.mp3');
  await flush();
  assert.deepEqual(log.played, []);
  assert.equal(log.requests.length, 1, 'nothing of 老莫 is requested for 薇拉');
  // The companion's own line still speaks, in her own name.
  voice.speak('vera', [line(20, 'You came back.')], OPTS);
  await flush();
  assert.equal(log.requests.length, 2);
  assert.equal(log.requests[1].req.characterId, 'vera');
  log.requests[1].resolve('vera.mp3');
  await flush();
  assert.deepEqual(log.played, ['vera.mp3']);
});

test('the stop control interrupts without closing, and what was cut off is never read later', async () => {
  forgetSpokenLines();
  const { log, deps, end } = harness();
  const voice = new SpeakerVoice(deps);
  let changes = 0;
  voice.subscribe(() => { changes += 1; });
  voice.setSpeaker('nanami');
  const lines = [line(1, 'あと九十秒で放送は終わり。'), line(2, '最後の曲、まだ決めてないの。')];
  voice.speak('nanami', lines, OPTS);
  await flush();
  assert.equal(voice.speaking, true);
  log.requests[0].resolve('1.mp3');
  await flush();
  voice.stop(lines);
  assert.equal(voice.speaking, false);
  assert.equal(voice.currentSpeaker, 'nanami', 'still on stage: stop is not close');
  assert.ok(changes >= 2, 'speaking state is observable for the stop control');
  end();
  // Same scrollback again (a re-render): nothing is re-queued.
  voice.speak('nanami', lines, OPTS);
  await flush();
  assert.equal(log.requests.length, 2, 'only the request that was already in flight');
  assert.equal(log.requests[1].signal.aborted, true);
  // A new answer after the stop speaks normally.
  voice.speak('nanami', [...lines, line(3, 'うん。', { who: 'player' }), line(4, 'じゃあ、それにする。')], OPTS);
  await flush();
  assert.equal(log.requests.at(-1).req.text, 'じゃあ、それにする。');
});

test('the speaking flag clears on its own once the last line ends', async () => {
  forgetSpokenLines();
  const { log, deps, end } = harness();
  const voice = new SpeakerVoice(deps);
  voice.setSpeaker('vera');
  voice.speak('vera', [line(1, 'Loud and clear.')], OPTS);
  await flush();
  log.requests[0].resolve('x.mp3');
  await flush();
  assert.equal(voice.speaking, true, 'still sounding');
  end();
  await flush();
  assert.equal(voice.speaking, false);
});

test('an intentional stop is not a TTS failure (no pause after many stops)', async () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  globalThis.window = globalThis.window ?? { dispatchEvent() {}, addEventListener() {}, removeEventListener() {} };
  let mode = 'hang';
  globalThis.fetch = async (url, init = {}) => {
    if (url === '/api/tts/config') return { ok: true, json: async () => ({ configured: true, model: 'm', defaultVoice: 'v' }) };
    if (mode === 'ok') return { ok: true, headers: { get: () => null }, json: async () => ({ ok: true, url: '/tts/ok.mp3' }) };
    return new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  };
  const { fetchVoiceUrl } = await jiti.import('../src/lib/tts-request.ts');
  for (let i = 0; i < 5; i++) {
    const controller = new AbortController();
    const pending = fetchVoiceUrl({ text: '好', language: 'zh', characterId: 'c', emotion: 'normal' }, () => true, controller.signal);
    await flush();
    controller.abort();
    assert.deepEqual(await pending, { status: 'stale' });
  }
  mode = 'ok';
  assert.deepEqual(
    await fetchVoiceUrl({ text: '好', language: 'zh', characterId: 'c', emotion: 'normal' }),
    { status: 'ready', url: '/tts/ok.mp3' },
    'five stops did not pause voice',
  );
  assert.match(request, /signal,\n\s+\}\);/);
});

test('every character dialogue has the stop control, Esc, interrupt-on-send and narration styling', () => {
  for (const [name, source] of [['CharacterDock', dock], ['NpcDialogue', npc]]) {
    assert.match(source, /<StopVoiceButton onStop=\{voiceLine\.stop\}/, `${name}: stop control`);
    assert.match(source, /\{voiceLine\.speaking && \(/, `${name}: only while speaking`);
    assert.match(source, /useStopVoiceOnEscape\(rootRef, /, `${name}: Esc`);
    assert.match(source, /voiceLine\.stop\(\);\n/, `${name}: a new line interrupts`);
    assert.match(source, /<NarratedText text=/, `${name}: narration styled`);
    assert.match(source, /names: speakerNames/, `${name}: speaker name reaches the extractor`);
  }
  assert.match(modal, /<NarratedText text=\{visiblePageShown\} names=\{speakerNames\} \/>/);
  // The dock closes = the voice closes; the scrollback owner guards the switch.
  assert.match(dock, /open: onStage,/);
  assert.match(hook, /if \(liveKey !== null\) speaker\.markSpoken\(liveKey, lines\);/);
  // Esc stops first (window capture beats the App's document capture), only inside the dialogue.
  assert.match(controls, /window\.addEventListener\('keydown', onKey, true\)/);
  assert.match(controls, /root\.current\?\.contains\(active\)/);
  // Localised in every interface language.
  const entry = messages['Stop {name} speaking'];
  for (const locale of ['zh-CN', 'ja', 'ko']) assert.ok(entry?.[locale]?.includes('{name}'), locale);
  // Closing marks what was on screen as spoken, so a reopen never resumes it.
  assert.match(hook, /if \(liveKey !== null\) speaker\.markSpoken\(liveKey, linesRef\.current\);/);
  assert.match(queueSrc, /this\.controller\?\.abort\(\);/);
});
