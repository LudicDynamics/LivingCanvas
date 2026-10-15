import { test } from 'node:test';
import assert from 'node:assert/strict';
test('missing config coalesces checks, warns once, and can recover explicitly', async () => {
  const events = [];
  globalThis.window = { dispatchEvent: event => events.push(event.type) };
  const values = new Map();
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  let checks = 0;
  globalThis.fetch = async () => { checks++; return Response.json({ configured: false, model: 'test', defaultVoice: 'test' }); };
  const tts = await import('../apps/web/src/lib/tts-readiness.ts');
  assert.deepEqual(await Promise.all([tts.canRequestTts(), tts.canRequestTts(), tts.canRequestTts()]), [false, false, false]);
  assert.equal(checks, 1); assert.equal(events.length, 1);
  assert.equal(await tts.canRequestTts(), false); assert.equal(checks, 1);
  globalThis.fetch = async () => Response.json({ configured: true, model: 'test', defaultVoice: 'test' });
  await tts.readTtsConfig(true);
  assert.equal(await tts.canRequestTts(), true);
  // one failed line is skipped quietly; three in a row pause voice
  tts.invalidateTts(); assert.equal(await tts.canRequestTts(), true);
  tts.noteTtsSuccess(); tts.invalidateTts(); tts.invalidateTts(); assert.equal(await tts.canRequestTts(), true);
  tts.invalidateTts(); assert.equal(await tts.canRequestTts(), false);
  await tts.readTtsConfig(true);
  tts.setTtsEnabled(false); assert.equal(await tts.canRequestTts(), false);
});

test('voices need an account: one quiet hint, no more requests this session, re-read after signing in', async () => {
  const events = [];
  const listeners = new Map();
  globalThis.window = { dispatchEvent: (event) => { events.push(event.type); for (const f of listeners.get(event.type) ?? []) f(event); }, addEventListener: (type, f) => listeners.set(type, [...(listeners.get(type) ?? []), f]) };
  const values = new Map();
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  let checks = 0;
  globalThis.fetch = async () => { checks++; return Response.json({ configured: false, requiresAccount: true, model: 'm', defaultVoice: 'v' }); };
  const tts = await import('../apps/web/src/lib/tts-readiness.ts?requires-account');
  assert.equal(await tts.canRequestTts(), false);
  assert.equal(await tts.canRequestTts(), false);
  assert.equal(checks, 1, 'asked once');
  assert.deepEqual(events, [tts.TTS_REQUIRES_ACCOUNT_EVENT], 'one hint, and not the 「voice is unavailable」 notice');
  // a line refused later (the readiness said yes, the server said 401): same, still one hint
  tts.noteTtsRequiresAccount();
  assert.equal(await tts.canRequestTts(), false);
  assert.equal(events.length, 1);
  // signing in re-reads
  globalThis.fetch = async () => { checks++; return Response.json({ configured: true, model: 'm', defaultVoice: 'v' }); };
  globalThis.window.dispatchEvent(new Event('airp:account-changed'));
  assert.equal(await tts.canRequestTts(), true);
});
