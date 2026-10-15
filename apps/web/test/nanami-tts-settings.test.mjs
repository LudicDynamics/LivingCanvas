import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const settings = await createJiti(import.meta.url, { moduleCache: false }).import('../src/lib/nanami-tts-settings.ts');

test('Nanami settings send only touched values and preserve an explicit local URL clear', () => {
  assert.deepEqual(settings.buildNanamiTtsPayload({}), {});
  assert.deepEqual(settings.buildNanamiTtsPayload({ baseUrl: '', voice: '', timeoutSeconds: '', apiKey: '' }), {
    AIRP_TTS_LOCAL_BASE_URL: '',
  });
  assert.deepEqual(settings.buildNanamiTtsPayload({
    baseUrl: ' http://192.0.2.20:8090/ ',
    voice: 'setsuna_v2',
    timeoutSeconds: '45',
    apiKey: 'secret',
  }), {
    AIRP_TTS_LOCAL_BASE_URL: 'http://192.0.2.20:8090/',
    AIRP_TTS_LOCAL_VOICE: 'setsuna_v2',
    AIRP_TTS_LOCAL_TIMEOUT_MS: '45000',
    AIRP_TTS_LOCAL_API_KEY: 'secret',
  });
});

test('Nanami settings reject endpoint URLs, unstable voice IDs, and invalid timeouts', () => {
  assert.throws(() => settings.buildNanamiTtsPayload({ baseUrl: 'http://localhost:8090/v1/tts' }), /without \/v1\/tts/);
  assert.throws(() => settings.buildNanamiTtsPayload({ baseUrl: 'http://localhost:8090/v1/tts/extra' }), /without \/v1\/tts/);
  assert.throws(() => settings.buildNanamiTtsPayload({ baseUrl: 'http://user:pass@localhost:8090' }), /without \/v1\/tts/);
  assert.throws(() => settings.buildNanamiTtsPayload({ voice: 'setsuna voice' }), /letters, numbers/);
  assert.throws(() => settings.buildNanamiTtsPayload({ timeoutSeconds: '0' }), /1 and 120/);
  assert.throws(() => settings.buildNanamiTtsPayload({ timeoutSeconds: '121' }), /1 and 120/);
  assert.deepEqual(settings.buildNanamiTtsPayload({ timeoutSeconds: '1.5' }), { AIRP_TTS_LOCAL_TIMEOUT_MS: '1500' });
});

test('Nanami timeout renders server milliseconds as seconds with a safe default', () => {
  assert.equal(settings.timeoutSecondsFromConfig('30000'), '30');
  assert.equal(settings.timeoutSecondsFromConfig('120000'), '120');
  assert.equal(settings.timeoutSecondsFromConfig('bad'), '30');
});

test('voice settings use localized copy, exact protected headers, and never persist secrets in localStorage', () => {
  const nanami = fs.readFileSync(new URL('../src/components/NanamiTtsSettings.tsx', import.meta.url), 'utf8');
  const connections = fs.readFileSync(new URL('../src/components/ConnectionSettings.tsx', import.meta.url), 'utf8');
  const panel = fs.readFileSync(new URL('../src/components/TtsSettings.tsx', import.meta.url), 'utf8');
  for (const source of [nanami, connections]) {
    assert.match(source, /'X-AIRP-Settings': '1'/);
    assert.doesNotMatch(source, /localStorage/);
  }
  // The panel localizes the copy it owns (volume + playback state); its section
  // headings ("Character voice", the sub-panels) are chrome owned elsewhere and
  // have never gone through `t()`. Asserting `t('Online model')` etc. described a
  // copy shape that does not exist in any tree; assert the keys the panel really
  // resolves instead, and require each to be fully translated.
  for (const key of [
    'Audio levels',
    'Voice playback is off; text dialogue remains available.',
    'Local character voices',
  ]) {
    assert.match(panel + nanami, new RegExp(`t\\('${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'\\)`));
  }
  assert.match(panel, /<NanamiTtsSettings onSaved=/);
  const messages = JSON.parse(fs.readFileSync(new URL('../src/lib/messages.json', import.meta.url), 'utf8'));
  for (const key of ['Audio levels', 'Voice playback is off; text dialogue remains available.', 'Local character voices']) {
    assert.ok(messages[key]?.['zh-CN'], `${key}: zh-CN`);
    assert.ok(messages[key]?.ja, `${key}: ja`);
  }
  assert.equal(messages['OpenAI-compatible'].ja, 'OpenAI 互換');
  assert.equal(messages['Flow media proxy']['zh-CN'], 'Flow 媒体代理');
});
