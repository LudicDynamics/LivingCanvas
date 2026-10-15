// The provider seam as the call store sees it.
//
// The claim under test is that voice-live is a different TRANSPORT, not a
// different call: the same snapshot, the same `stop(owner)` guard, the same
// subtitle projection. A fake transport stands in for `voice-live-call.ts`, so
// nothing here needs a socket, a microphone, or a running voice-live.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';

let store = null;
let activityStore = null;
try {
  const { createJiti } = await import('../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs');
  const jiti = createJiti(import.meta.url, { moduleCache: true, tryNative: true });
  store = await jiti.import('../src/lib/live-call-store.ts');
  activityStore = await jiti.import('../src/lib/agent-activity-store.ts');
} catch (err) {
  console.error('jiti/bootstrap unavailable:', err?.message ?? err);
}

test('bootstrap: the store loaded', () => {
  assert.ok(store, 'live-call-store.ts failed to import');
});


const SAVE_A = '/saves/a';
const SAVE_B = '/saves/b';
const settle = () => new Promise((resolve) => setImmediate(resolve));

/** A fetch double whose `/api/live/config` answer names the provider. */
function makeFetch(state) {
  return async (url) => {
    const route = String(url);
    state.calls.push(route);
    const body =
      route === '/api/live/config'
        ? { ok: true, available: true, model: 'm', voices: [], ...(state.provider ? { provider: state.provider } : {}) }
        : { ok: true };
    return { ok: true, status: 200, async text() { return JSON.stringify(body); } };
  };
}

/** Stands in for `startVoiceLiveCall`; the test drives its handlers by hand. */
function makeTransport(state) {
  return async (handlers) => {
    state.opened += 1;
    state.handlers = handlers;
    if (state.openThrows) {
      handlers.onError('connection');
      throw new Error('connection');
    }
    return { stop: () => { state.stopped += 1; } };
  };
}

async function harness(over = {}, startVoiceLive) {
  const state = {
    provider: 'voice-live',
    calls: [],
    opened: 0,
    stopped: 0,
    handlers: null,
    openThrows: false,
    ...over,
  };
  const listeners = new Map();
  state.dispatch = (type, detail) => listeners.get(type)?.({ detail });
  const saveStore = activityStore.createAgentActivityStore();
  saveStore.selectSave(SAVE_A);
  const created = store.createLiveCallStore({
    events: {
      addEventListener(type, fn) { listeners.set(type, fn); },
      removeEventListener(type) { listeners.delete(type); },
    },
    now: () => state.clock ?? 0,
    activeSaveStore: saveStore,
    fetch: makeFetch(state),
    startVoiceLive: startVoiceLive ?? makeTransport(state),
  });
  const start = created.start;
  created.start = (opts) => start({ savePath: SAVE_A, ...opts });
  created.ensureConfig();
  await settle();
  return { store: created, state, saveStore };
}

/** Start a call and let `hello` promote it to live. */
async function liveCall(h, opts = { characterId: 'nanami', owner: 'nook:nanami' }) {
  const started = h.store.start({ locale: 'en', ...opts });
  await settle();
  h.state.handlers.onReady({ session: 's1', tts: 'setsuna', brain: 'airp' });
  await started;
}

test('the server decides the provider, and the store reports it', async () => {
  const onVoiceLive = await harness({ provider: 'voice-live' });
  assert.equal(onVoiceLive.store.getProvider(), 'voice-live');

  const onGptLive = await harness({ provider: 'gpt-live' });
  assert.equal(onGptLive.store.getProvider(), 'gpt-live');

  // An older server has no `provider` field at all. That answer must mean
  // gpt-live — exactly what this store did before the seam existed.
  const older = await harness({ provider: null });
  assert.equal(older.store.getProvider(), 'gpt-live');
});

test('on voice-live the call runs on the transport, never on WebRTC or /api/live/session', async () => {
  const h = await harness();
  await liveCall(h);

  assert.equal(h.store.getSnapshot().phase, 'live');
  assert.equal(h.state.opened, 1);
  // No SDP is exchanged and no upstream session is created: our server
  // reverse-proxies the socket, and the call IS the socket.
  assert.ok(!h.state.calls.includes('/api/live/session'));
  assert.deepEqual(h.state.calls, ['/api/live/config']);
});

test('`hello` is what promotes the call to live, not the socket opening', async () => {
  const h = await harness();
  const started = h.store.start({ characterId: 'nanami', owner: 'nook:nanami', locale: 'en' });
  await settle();
  // The transport resolved, but voice-live has not said hello yet.
  assert.equal(h.store.getSnapshot().phase, 'connecting');
  h.state.handlers.onReady({ session: 's1', tts: 'say', brain: 'pirp' });
  await started;
  assert.equal(h.store.getSnapshot().phase, 'live');
});

test('the snapshot and the subtitle projection are filled the same way', async () => {
  const h = await harness();
  await liveCall(h);

  h.state.handlers.onInputText('こんばんは');
  h.state.handlers.onLine('Good evening.');
  h.store.tick();

  const snapshot = h.store.getSnapshot();
  assert.equal(snapshot.inputText, 'こんばんは');
  assert.equal(snapshot.characterId, 'nanami');
  assert.equal(snapshot.owner, 'nook:nanami');
  // Her words land in the same `lines` the dialogue and the nook already read.
  assert.deepEqual(h.store.getLines().lines, ['Good evening.']);
});

test('hanging up stops the transport and skips the pointless close POST', async () => {
  const h = await harness();
  await liveCall(h);
  await h.store.stop();

  assert.equal(h.state.stopped, 1, 'the transport owns the mic and the socket');
  assert.equal(h.store.getSnapshot().phase, 'idle');
  // voice-live has no server-side session to release; posting would 404 on a
  // character that never had a GPT Live call.
  assert.ok(!h.state.calls.includes('/api/live/close'));
});

test('`stop(owner)` keeps its lifecycle guard on this transport too', async () => {
  const h = await harness();
  await liveCall(h, { characterId: 'nanami', owner: 'nook:nanami' });
  await h.store.stop('dialogue:watson');
  assert.equal(h.store.getSnapshot().phase, 'live', 'another entry must not hang up this call');
  assert.equal(h.state.stopped, 0);
  await h.store.stop('nook:nanami');
  assert.equal(h.store.getSnapshot().phase, 'idle');
  assert.equal(h.state.stopped, 1);
});

test('save A voice callbacks cannot update the call after save B is selected', async () => {
  const h = await harness();
  await liveCall(h);
  const staleHandlers = h.state.handlers;
  assert.equal(staleHandlers.savePath, SAVE_A);
  assert.equal(staleHandlers.isCurrent(), true);

  h.saveStore.selectSave(SAVE_B);
  assert.equal(h.store.getSnapshot().phase, 'idle');
  assert.equal(h.state.stopped, 1);
  assert.equal(staleHandlers.signal.aborted, true, 'save change cancels a pending transport before it can reopen');
  staleHandlers.onInputText('late A');
  staleHandlers.onLine('late A line');
  staleHandlers.onThought('late thought');
  staleHandlers.onBotState('speaking');
  assert.equal(h.store.getSnapshot().phase, 'idle');
  assert.equal(h.store.getSnapshot().inputText, '');
  assert.deepEqual(h.store.getLines().lines, []);
  assert.equal(staleHandlers.isCurrent(), false);

  await h.store.start({ characterId: 'nanami', owner: 'nook:nanami', locale: 'en', savePath: SAVE_A });
  assert.equal(h.state.opened, 1, 'a late save-A action must not open another voice call in save B');
});

test('late save-A transport completion cannot stop or replace a save-B call', async () => {
  const pendingA = {};
  let resolveA;
  pendingA.promise = new Promise((resolve) => { resolveA = resolve; });
  const opened = [];
  const stopped = [];
  const h = await harness({}, async (handlers) => {
    opened.push(handlers);
    if (handlers.savePath === SAVE_A) return pendingA.promise;
    return { stop: () => stopped.push(handlers.savePath) };
  });

  const startA = h.store.start({
    characterId: 'nanami', locale: 'en', owner: 'nook:nanami', savePath: SAVE_A,
  });
  await settle();
  const aHandlers = opened.find((handlers) => handlers.savePath === SAVE_A);
  assert.ok(aHandlers);
  h.saveStore.selectSave(SAVE_B);

  const startB = h.store.start({
    characterId: 'nanami', locale: 'en', owner: 'rail:nanami', savePath: SAVE_B,
  });
  await settle();
  const bHandlers = opened.find((handlers) => handlers.savePath === SAVE_B);
  assert.ok(bHandlers);
  bHandlers.onReady({ session: 'b', tts: 'tts', brain: 'brain' });
  await startB;
  assert.equal(h.store.getSnapshot().phase, 'live');

  aHandlers.onReady({ session: 'a', tts: 'tts', brain: 'brain' });
  resolveA({ stop: () => stopped.push(SAVE_A) });
  await startA;
  assert.equal(h.store.getSnapshot().phase, 'live');
  assert.equal(h.store.getSnapshot().owner, 'rail:nanami');
  assert.deepEqual(stopped, [SAVE_A], 'only the stale A transport is disposed');
});

test('a second character closes the first: still one call', async () => {
  const h = await harness();
  await liveCall(h, { characterId: 'nanami', owner: 'nook:nanami' });
  await liveCall(h, { characterId: 'watson', owner: 'dialogue:watson' });
  assert.equal(h.state.opened, 2);
  assert.equal(h.state.stopped, 1, 'the first transport MUST be released, not stacked');
  assert.equal(h.store.getSnapshot().characterId, 'watson');
});

test('the same character adopts the call rather than reopening it', async () => {
  const h = await harness();
  await liveCall(h, { characterId: 'nanami', owner: 'nook:nanami' });
  await h.store.start({ characterId: 'nanami', owner: 'dialogue:nanami', locale: 'en' });
  assert.equal(h.state.opened, 1, 'adopt: keep the transport, move the owner');
  assert.equal(h.store.getSnapshot().owner, 'dialogue:nanami');
});

test('no voice backend is a visible error, not a silent dead socket', async () => {
  const h = await harness({ openThrows: true });
  await h.store.start({ characterId: 'nanami', owner: 'nook:nanami', locale: 'en' });
  const snapshot = h.store.getSnapshot();
  assert.equal(snapshot.phase, 'error');
  assert.ok(snapshot.error, 'the player must be told the call did not come up');
});

test('a backend that goes away mid-call surfaces, rather than leaving a dead call', async () => {
  const h = await harness();
  await liveCall(h);
  h.state.handlers.onClosed();
  await settle();
  assert.equal(h.store.getSnapshot().phase, 'error');
});


//: every duplex call spoke in one woman's voice, men included,
// because nothing told voice-live who was on the call. The store names the
// character, and the transport puts it on the socket URL for the server to cast.
test('the call names its character so the server can cast the right voice', async () => {
  const h = await harness();
  await liveCall(h, { characterId: 'watson', owner: 'nook:watson' });
  assert.equal(h.state.handlers.characterId, 'watson');

  const source = await readFile(new URL('../src/lib/voice-live-call.ts', import.meta.url), 'utf8');
  assert.match(source, /voiceLiveUrl\(window\.location, handlers\.characterId, handlers\.savePath\)/);
  assert.match(source, /if \(characterId\) params\.set\('character', characterId\);/);
});

// ---- Day 1/2 fixes (voice-live audit #2 #3 #5 #7) -------------------------

test('#2 one failed turn shows a notice and keeps the call up; it clears on her next line', async () => {
  const h = await harness();
  await liveCall(h, { characterId: 'nanami', owner: 'nook:nanami', locale: 'en', uiLocale: 'zh-CN' });
  h.state.handlers.onNotice('turn_failed');
  let snapshot = h.store.getSnapshot();
  assert.equal(snapshot.phase, 'live');
  assert.equal(snapshot.notice, '刚才那句没想好，再说一次吧——还在听。');
  assert.equal(snapshot.bot, 'listening');
  assert.equal(h.state.stopped, 0);
  h.state.handlers.onLine('还在。');
  assert.equal(h.store.getSnapshot().notice, undefined);
  // …or after a few seconds on its own.
  h.state.handlers.onNotice('turn_failed');
  h.state.clock = 60_000;
  h.store.tick();
  snapshot = h.store.getSnapshot();
  assert.equal(snapshot.notice, undefined);
  assert.equal(snapshot.phase, 'live');
});

test('#2 a canvas `error` frame for the character on a voice-live call does not end it', async () => {
  const h = await harness();
  await liveCall(h);
  h.state.dispatch('airp:character-frame', { type: 'error', characterId: 'nanami', message: 'Models are switching' });
  assert.equal(h.store.getSnapshot().phase, 'live');
});

test('#5 her line is shown once: the canvas frames for the same turn are ignored on voice-live', async () => {
  const h = await harness();
  await liveCall(h);
  h.state.handlers.onLine('こんばんは。');
  h.state.dispatch('airp:character-frame', { type: 'character_delta', characterId: 'nanami', delta: 'こんばん' });
  h.state.dispatch('airp:character-frame', { type: 'character_message', characterId: 'nanami', text: 'こんばんは。' });
  h.store.tick();
  assert.deepEqual(h.store.getLines(), { streaming: '', lines: ['こんばんは。'] });
});

test('#3 the bot state reaches the snapshot as listening / thinking / speaking', async () => {
  const h = await harness();
  await liveCall(h);
  assert.equal(h.store.getSnapshot().bot, 'listening', 'live starts out listening');
  h.state.handlers.onBotState('thinking');
  assert.equal(h.store.getSnapshot().bot, 'thinking');
  h.state.handlers.onBotState('speaking');
  assert.equal(h.store.getSnapshot().bot, 'speaking');
  h.state.handlers.onBotState('idle');
  assert.equal(h.store.getSnapshot().bot, 'listening');
  await h.store.stop();
  assert.equal(h.store.getSnapshot().bot, undefined, 'hanging up leaves a clean idle snapshot');
});

test('#7 the allowance becomes an end time; unlimited is null', async () => {
  const h = await harness();
  h.state.clock = 1_000;
  const started = h.store.start({ characterId: 'nanami', owner: 'nook:nanami', locale: 'en' });
  await settle();
  h.state.handlers.onAllowance(600);
  h.state.handlers.onReady({ session: 's', tts: 'q', brain: 'relay' });
  await started;
  assert.equal(h.store.getSnapshot().endsAt, 601_000);
  h.state.handlers.onAllowance(null);
  assert.equal(h.store.getSnapshot().endsAt, null);
});

test('#7 each refusal reads as its own reason, in the interface language, with the billing link kept', async () => {
  const cases = [
    ['minutes_exhausted', { resetsAt: '2026-10-31T15:00:00.000Z', billingUrl: 'https://worldlines.gg/billing' }, 'zh-CN', '本月的通话分钟已用完，2026-11-01 恢复。'],
    ['minutes_exhausted', {}, 'ja', '今月の通話時間を使い切りました。'],
    ['plan_required', { billingUrl: 'https://worldlines.gg/plans' }, 'ko', '현재 요금제에는 음성 통화가 포함되어 있지 않아요.'],
    ['call_in_progress', {}, 'en', 'You are already on a call in another tab or device. Hang up there first.'],
    ['line_busy', {}, 'zh-CN', '语音线路现在全部占线，过一分钟再试。'],
    ['signed_out', {}, 'ja', '音声通話にはサインインが必要です。'],
    ['network', {}, 'zh-CN', '通话连接断了，请检查网络后再试。'],
    ['time_limit', {}, 'en', 'The call reached its time limit. Call again to keep talking.'],
  ];
  for (const [reason, detail, uiLocale, text] of cases) {
    const h = await harness();
    const started = h.store.start({ characterId: 'nanami', owner: 'nook:nanami', locale: 'en', uiLocale });
    await settle();
    h.state.handlers.onError(reason, detail);
    await started;
    const snapshot = h.store.getSnapshot();
    assert.equal(snapshot.phase, 'error', reason);
    assert.equal(snapshot.error, text, reason);
    assert.equal(snapshot.billingUrl, detail.billingUrl, `${reason} keeps the billing link`);
  }
});

test('#5 the dialogue of another character does not toast for the call’s frames', async () => {
  assert.equal(store.callCarries({ phase: 'live', characterId: 'vera' }, 'vera'), true);
  assert.equal(store.callCarries({ phase: 'connecting', characterId: 'vera' }, 'vera'), true);
  assert.equal(store.callCarries({ phase: 'error', characterId: 'vera' }, 'vera'), false);
  assert.equal(store.callCarries({ phase: 'live', characterId: 'vera' }, 'mo'), false);
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const guard = app.indexOf('if (callCarries(liveCallRef.current, msg.characterId)) return;');
  const toast = app.indexOf('could not be assigned to ${activeId}');
  assert.ok(guard > 0 && guard < toast, 'the call guard runs before the toast');
});
