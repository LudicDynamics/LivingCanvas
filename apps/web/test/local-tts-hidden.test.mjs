// Local studio TTS is hidden by default. With the feature
// off, players see no studio-voice setting and no request asks for the studio
// voice — even if an older visit stored the experimental opt-in.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

const src = (p) => fs.readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

test('flag off by default; ?localTts=1 turns it on for this browser, ?localTts=0 forgets it', async () => {
  const values = new Map([['airp-tts-local-experimental', 'true']]);
  globalThis.localStorage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) };
  globalThis.window = { location: { search: '' }, dispatchEvent: () => {} };
  const tts = await import('../src/lib/tts-readiness.ts');
  assert.equal(tts.localTtsFeature(), false);
  assert.equal(tts.ttsLocalExperiment(), false, 'a stored opt-in from before is ignored while hidden');
  window.location.search = '?localTts=1';
  assert.equal(tts.localTtsFeature(), true);
  window.location.search = '';
  assert.equal(tts.localTtsFeature(), true, 'remembered');
  assert.equal(tts.ttsLocalExperiment(), true);
  window.location.search = '?localTts=0';
  assert.equal(tts.localTtsFeature(), false);
  assert.equal(tts.ttsLocalExperiment(), false);
});

test('flag off: the voice panel lists no studio voice, Nanami local voice, or studio line', () => {
  const panel = src('components/TtsSettings.tsx');
  assert.match(panel, /\{showLocalTts && <NanamiTtsSettings /);
  assert.match(panel, /\{localTtsOn && config\?\.experimentalLocal && <label>/);
  assert.match(panel, /showLocalTts \? t\('Add a DashScope API key below, or configure Nanami local voice/);
  const keys = src('components/chrome/LocalKeySettings.tsx');
  assert.match(keys, /\{localTtsFeature\(\) && <li>\{t\("Studio character voices/);
  // the studio-voice request header is only ever sent through ttsLocalExperiment(), which needs the flag
  assert.match(src('lib/tts-request.ts'), /ttsLocalExperiment\(\) \? \{ 'X-AIRP-TTS-Local': '1' \}/);
  assert.match(src('lib/browser-mode.ts'), /if \(localTtsFeature\(\)\) env\.AIRP_LOCAL_TTS = '1';/);
  const messages = JSON.parse(src('lib/messages.json'));
  const plain = messages['Add a DashScope API key below. Text dialogue remains available.'];
  for (const locale of ['zh-CN', 'ja', 'ko']) {
    assert.ok(plain?.[locale], locale);
    assert.doesNotMatch(plain[locale], /七海|ナナミ|나나미|本机|本機|로컬/);
  }
});
