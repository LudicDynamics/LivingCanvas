// The provider seam: which transport a call uses, and
// what the browser is allowed to learn about it. Every function under test is
// pure — env comes in as an argument — so none of this needs a socket, a
// microphone, a key, or a running voice-live.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const provider = await jiti.import('../src/engine/voice-provider.ts');
const {
  VOICE_PROVIDERS,
  VOICE_LIVE_BRAINS,
  DEFAULT_VOICE_LIVE_URL,
  isVoiceProvider,
  isVoiceLiveBrain,
  resolveVoiceProvider,
  resolveVoiceLiveUrl,
  voiceLiveSocketUrl,
  voiceLiveEventsUrl,
  composeVoiceCallConfig,
} = provider;

const GPT_LIVE_READY = { available: true, model: 'gpt-live-1', voices: ['Bellona'] };
const GPT_LIVE_DOWN = {
  available: false,
  reason: 'OPENAI_API_KEY is not set on the server',
  model: 'gpt-live-1',
  voices: ['Bellona'],
};

test('voice-live is the default while testing; production defaults to gpt-live', () => {
  // the team: voice-live by default now, gpt-live for the released build — which is
  // also the only one that CAN run there (the VPS has no Apple Silicon).
  assert.equal(resolveVoiceProvider({}), 'voice-live');
  assert.equal(resolveVoiceProvider({ NODE_ENV: 'development' }), 'voice-live');
  assert.equal(resolveVoiceProvider({ NODE_ENV: 'test' }), 'voice-live');
  assert.equal(resolveVoiceProvider({ NODE_ENV: 'production' }), 'gpt-live');
});

test('AIRP_VOICE_PROVIDER overrides in both directions; a typo falls back', () => {
  assert.equal(resolveVoiceProvider({ AIRP_VOICE_PROVIDER: 'gpt-live' }), 'gpt-live');
  assert.equal(
    resolveVoiceProvider({ AIRP_VOICE_PROVIDER: 'voice-live', NODE_ENV: 'production' }),
    'voice-live',
  );
  assert.equal(resolveVoiceProvider({ AIRP_VOICE_PROVIDER: '  gpt-live  ' }), 'gpt-live');
  // A misspelling must not cost the whole server: it degrades to the default.
  assert.equal(resolveVoiceProvider({ AIRP_VOICE_PROVIDER: 'voicelive' }), 'voice-live');
  assert.equal(
    resolveVoiceProvider({ AIRP_VOICE_PROVIDER: 'nonsense', NODE_ENV: 'production' }),
    'gpt-live',
  );
});

test('the upstream address is server config, with a local default', () => {
  assert.equal(resolveVoiceLiveUrl({}), DEFAULT_VOICE_LIVE_URL);
  assert.equal(resolveVoiceLiveUrl({ VOICE_LIVE_URL: 'http://192.0.2.10:8777/' }), 'http://192.0.2.10:8777');
  // Never 8765 by accident — that port belongs to the local voice-notes tool.
  assert.ok(!DEFAULT_VOICE_LIVE_URL.includes('8765'));
  assert.ok(DEFAULT_VOICE_LIVE_URL.includes('8777'));
});

test('upstream URLs derive the ws scheme and the two endpoints', () => {
  assert.equal(voiceLiveSocketUrl('http://127.0.0.1:8777'), 'ws://127.0.0.1:8777/ws');
  assert.equal(voiceLiveSocketUrl('http://127.0.0.1:8777/'), 'ws://127.0.0.1:8777/ws');
  assert.equal(voiceLiveSocketUrl('https://voice.example'), 'wss://voice.example/ws');
  assert.equal(voiceLiveEventsUrl('http://127.0.0.1:8777'), 'http://127.0.0.1:8777/api/events');
});

test('the two vocabularies are closed sets', () => {
  assert.deepEqual([...VOICE_PROVIDERS], ['gpt-live', 'voice-live']);
  // The brains are voice-live's own (integration.md §4); we only ever name them.
  assert.deepEqual([...VOICE_LIVE_BRAINS], ['deepseek', 'pirp', 'airp']);
  for (const value of VOICE_PROVIDERS) assert.ok(isVoiceProvider(value));
  for (const value of VOICE_LIVE_BRAINS) assert.ok(isVoiceLiveBrain(value));
  assert.equal(isVoiceProvider('gptlive'), false);
  assert.equal(isVoiceProvider(undefined), false);
  assert.equal(isVoiceLiveBrain('gpt'), false);
});

test('`available` describes the ACTIVE provider, not whichever one has a key', () => {
  // The whole bug this prevents: a server with no OPENAI_API_KEY running
  // voice-live used to report available:false and hide the call button.
  const onVoiceLive = composeVoiceCallConfig({ provider: 'voice-live', gptLive: GPT_LIVE_DOWN });
  assert.equal(onVoiceLive.available, true);
  assert.equal(onVoiceLive.reason, undefined);
  assert.equal(onVoiceLive.provider, 'voice-live');

  const onGptLive = composeVoiceCallConfig({ provider: 'gpt-live', gptLive: GPT_LIVE_DOWN });
  assert.equal(onGptLive.available, false);
  assert.match(onGptLive.reason, /OPENAI_API_KEY/);

  const ready = composeVoiceCallConfig({ provider: 'gpt-live', gptLive: GPT_LIVE_READY });
  assert.equal(ready.available, true);
});

test('both providers are always described, so a panel can explain the choice', () => {
  const config = composeVoiceCallConfig({ provider: 'voice-live', gptLive: GPT_LIVE_DOWN });
  assert.equal(config.providers['voice-live'].available, true);
  assert.equal(config.providers['gpt-live'].available, false);
  assert.match(config.providers['gpt-live'].reason, /OPENAI_API_KEY/);
  // GPT Live's model and voice list stay at the top level: the existing UI
  // reads them there, and the provider switch must not move them.
  assert.equal(config.model, 'gpt-live-1');
  assert.deepEqual([...config.voices], ['Bellona']);
});

test('the payload never carries an upstream address', () => {
  // The point of the reverse proxy is that the browser cannot learn where
  // voice-live lives. A field added here that leaks it fails this test.
  for (const active of VOICE_PROVIDERS) {
    const serialised = JSON.stringify(
      composeVoiceCallConfig({ provider: active, gptLive: GPT_LIVE_READY }),
    );
    assert.doesNotMatch(serialised, /8777/);
    assert.doesNotMatch(serialised, /127\.0\.0\.1/);
    assert.doesNotMatch(serialised, /wss?:\/\//);
    assert.doesNotMatch(serialised, /https?:\/\//);
    assert.doesNotMatch(serialised, /VOICE_LIVE_URL/);
  }
});

test('the route hands the composed answer straight out, and reads env per request', async () => {
  const route = await readFile(new URL('../src/routes/live.ts', import.meta.url), 'utf8');
  assert.match(route, /composeVoiceCallConfig\(\{ provider, gptLive, \.\.\.\(local \? \{ localVoiceLive: local \} : \{\}\) \}\)/);
  // No module-level capture: the provider is re-read on every request, the same
  // rule TTS carries, so flipping env needs no restart.
  const body = route.slice(route.indexOf("router.get('/live/config'"));
  assert.match(body.slice(0, 800), /const provider = resolveVoiceProvider\(process\.env, /);
  assert.doesNotMatch(route, /const provider = resolveVoiceProvider\(\);\s*\n\s*export/);
});
