import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { commitVoiceOutcomeIfCurrent, fetchVoiceUrl } = await jiti.import('../src/lib/tts-request.ts');
const { createAgentActivityStore } = await jiti.import('../src/lib/agent-activity-store.ts');
const { createSpokenLineValidityCheck } = await jiti.import('../src/lib/use-spoken-lines.ts');

test('the browser sends the caller-captured canonical root with each TTS request', async t => {
  const originalFetch = globalThis.fetch;
  const originalStorage = globalThis.localStorage;
  const calls = [];
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => null, setItem() {} },
  });
  globalThis.fetch = async (url, init) => {
    if (url === '/api/tts/config') {
      return { ok: true, json: async () => ({ configured: true, model: 'test', defaultVoice: 'Cherry' }) };
    }
    calls.push({ url, init });
    return {
      ok: true,
      headers: { get: () => null },
      json: async () => ({ ok: true, url: '/api/tts/audio/test.wav' }),
    };
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalStorage === undefined) delete globalThis.localStorage;
    else Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: originalStorage });
  });

  const request = {
    text: 'You came back.',
    voice: 'Cherry',
    language: 'en',
    savePath: '/saves/a',
    characterId: 'sarah',
    emotion: 'normal',
  };
  const outcome = await fetchVoiceUrl(request, () => true);

  assert.deepEqual(outcome, { status: 'ready', url: '/api/tts/audio/test.wav' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/tts');
  assert.deepEqual(JSON.parse(calls[0].init.body), request);
});

test('a successful TTS response arriving after save detach never resolves the modal voice', async t => {
  const originalFetch = globalThis.fetch;
  const originalStorage = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => null, setItem() {} },
  });
  let resolveTts;
  let markStarted;
  const requestStarted = new Promise(resolve => { markStarted = resolve; });
  globalThis.fetch = async url => {
    if (url === '/api/tts/config') {
      return { ok: true, json: async () => ({ configured: true, model: 'test', defaultVoice: 'Cherry' }) };
    }
    assert.equal(url, '/api/tts');
    markStarted();
    return new Promise(resolve => { resolveTts = resolve; });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalStorage === undefined) delete globalThis.localStorage;
    else Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: originalStorage });
  });

  const activeSaves = createAgentActivityStore();
  activeSaves.selectSave('/saves/a');
  const stillValid = () => activeSaves.isSaveActive('/saves/a');
  const pending = fetchVoiceUrl({
    text: 'A late line.',
    voice: 'Cherry',
    language: 'en',
    savePath: '/saves/a',
    characterId: 'sarah',
    emotion: 'normal',
  }, stillValid);
  await requestStarted;
  activeSaves.selectSave(null);
  resolveTts({
    ok: true,
    headers: { get: () => null },
    json: async () => ({ ok: true, url: '/api/tts/audio/late.wav' }),
  });

  const outcome = await pending;
  let onVoiceResolved = 0;
  const committed = commitVoiceOutcomeIfCurrent(outcome, stillValid, () => { onVoiceResolved += 1; });
  assert.equal(outcome.status, 'stale');
  assert.equal(committed, false);
  assert.equal(onVoiceResolved, 0);
});

test('spoken lines cannot play a successful A response after selectSave(null)', async t => {
  const originalFetch = globalThis.fetch;
  const originalStorage = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => null, setItem() {} },
  });
  let resolveTts;
  let markStarted;
  const requestStarted = new Promise(resolve => { markStarted = resolve; });
  globalThis.fetch = async url => {
    if (url === '/api/tts/config') {
      return { ok: true, json: async () => ({ configured: true, model: 'test', defaultVoice: 'Cherry' }) };
    }
    assert.equal(url, '/api/tts');
    markStarted();
    return new Promise(resolve => { resolveTts = resolve; });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalStorage === undefined) delete globalThis.localStorage;
    else Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: originalStorage });
  });

  const activeSaves = createAgentActivityStore();
  activeSaves.selectSave('/saves/a');
  const turnRef = { current: 1 };
  const characterIdRef = { current: 'sarah' };
  const worldPathRef = { current: '/saves/a' }; // App props can remain A while loadWorld detaches it.
  const valid = createSpokenLineValidityCheck(
    turnRef, 1, characterIdRef, 'sarah', worldPathRef, '/saves/a', activeSaves.isSaveActive,
  );
  const pending = fetchVoiceUrl({
    text: 'A spoken line.',
    voice: 'Cherry',
    language: 'en',
    savePath: '/saves/a',
    characterId: 'sarah',
    emotion: 'normal',
  }, valid);

  await requestStarted;
  activeSaves.selectSave(null);
  assert.equal(valid(), false, 'store detach invalidates the captured A scope synchronously');
  resolveTts({
    ok: true,
    headers: { get: () => null },
    json: async () => ({ ok: true, url: '/api/tts/audio/spoken.wav' }),
  });
  const outcome = await pending;
  let playVoiceCalls = 0;
  const committed = commitVoiceOutcomeIfCurrent(outcome, valid, current => {
    if (current.status === 'ready') playVoiceCalls += 1;
  });

  assert.equal(outcome.status, 'stale');
  assert.equal(committed, false);
  assert.equal(playVoiceCalls, 0);
});

test('spoken lines reject delayed A audio after save detach even while worldPath remains A', async t => {
  const originalFetch = globalThis.fetch;
  const originalStorage = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => null, setItem() {} },
  });
  let resolveTts;
  let markStarted;
  const requestStarted = new Promise(resolve => { markStarted = resolve; });
  globalThis.fetch = async url => {
    if (url === '/api/tts/config') {
      return { ok: true, json: async () => ({ configured: true, model: 'test', defaultVoice: 'Cherry' }) };
    }
    assert.equal(url, '/api/tts');
    markStarted();
    return new Promise(resolve => { resolveTts = resolve; });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalStorage === undefined) delete globalThis.localStorage;
    else Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: originalStorage });
  });

  const activeSaves = createAgentActivityStore();
  activeSaves.selectSave('/saves/a');
  const turnRef = { current: 2 };
  const characterIdRef = { current: 'sarah' };
  const worldPathRef = { current: '/saves/a' };
  const valid = createSpokenLineValidityCheck(
    turnRef, 2, characterIdRef, 'sarah', worldPathRef, '/saves/a', activeSaves.isSaveActive,
  );
  const pending = fetchVoiceUrl({
    text: 'A spoken line.',
    voice: 'Cherry',
    language: 'en',
    savePath: '/saves/a',
    characterId: 'sarah',
    emotion: 'normal',
  }, valid);

  await requestStarted;
  activeSaves.selectSave(null);
  assert.equal(worldPathRef.current, '/saves/a');
  assert.equal(valid(), false, 'selectSave(null) invalidates the hook scope synchronously');
  resolveTts({
    ok: true,
    headers: { get: () => null },
    json: async () => ({ ok: true, url: '/api/tts/audio/spoken.wav' }),
  });
  const outcome = await pending;
  let playVoiceCalls = 0;
  const committed = commitVoiceOutcomeIfCurrent(outcome, valid, current => {
    if (current.status === 'ready') playVoiceCalls += 1;
  });

  assert.equal(outcome.status, 'stale');
  assert.equal(committed, false);
  assert.equal(playVoiceCalls, 0);
});
