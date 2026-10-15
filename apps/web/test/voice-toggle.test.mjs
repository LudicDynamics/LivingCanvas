// One-tap character voice on/off in play: the edge controls
// carry a VoiceToggle that flips the SAME switch as Settings
// (`airp-tts-enabled`), and turning it off cuts the line sounding now.
// Run: node --test apps/web/test/voice-toggle.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..');
const repoRoot = path.resolve(webRoot, '../..');
const read = rel => fs.readFileSync(path.join(webRoot, rel), 'utf8');

async function loadToggle() {
  const require = createRequire(pathToFileURL(path.join(webRoot, 'test/x.mjs')));
  const esbuild = require(path.join(repoRoot, 'node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild/lib/main.js'));
  const stubs = {
    name: 'stubs',
    setup(build) {
      build.onResolve({ filter: /lib\/(audio|i18n)\.js$/ }, args => ({ path: args.path, namespace: 'stub' }));
      build.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({
        loader: 'js',
        contents: args.path.endsWith('audio.js')
          ? 'export function stopVoice() { globalThis.__stops = (globalThis.__stops ?? 0) + 1; }'
          : 'export function useLocale() { return { t: (s) => s }; }',
      }));
    },
  };
  const out = await esbuild.build({
    entryPoints: [path.join(webRoot, 'src/components/chrome/VoiceToggle.tsx')],
    bundle: true, write: false, format: 'esm', jsx: 'automatic', platform: 'node', logLevel: 'error',
    external: ['react', 'react/jsx-runtime', 'lucide-react'], plugins: [stubs],
  });
  const cacheDir = path.join(webRoot, 'node_modules/.cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  const file = path.join(fs.mkdtempSync(path.join(cacheDir, 'airp-voice-toggle-')), 'voice-toggle.mjs');
  fs.writeFileSync(file, out.outputFiles[0].text);
  return import(pathToFileURL(file).href);
}

test('off persists, cuts the current line, and announces the change; on does not stop anything', async () => {
  const store = new Map();
  const events = [];
  globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
  globalThis.window = { dispatchEvent: e => events.push(e.type), addEventListener() {}, removeEventListener() {}, location: { search: '' } };
  const { toggleCharacterVoice, VoiceToggle } = await loadToggle();
  globalThis.__stops = 0;
  toggleCharacterVoice(false);
  assert.equal(store.get('airp-tts-enabled'), 'false');
  assert.equal(globalThis.__stops, 1, 'muting stops the line that is playing');
  assert.deepEqual(events, ['airp:prefs-changed'], 'Settings and the account sync hear it');
  toggleCharacterVoice(true);
  assert.equal(store.get('airp-tts-enabled'), 'true');
  assert.equal(globalThis.__stops, 1);

  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');
  store.set('airp-tts-enabled', 'false');
  const off = renderToStaticMarkup(React.createElement(VoiceToggle));
  assert.match(off, /aria-pressed="false"/);
  assert.match(off, /aria-label="Character voice off \(tap to turn on\)"/);
  store.set('airp-tts-enabled', 'true');
  assert.match(renderToStaticMarkup(React.createElement(VoiceToggle)), /data-voice-on="true"/);
});

test('reachable in play, synced with Settings, labelled in four locales', () => {
  const app = read('src/App.tsx');
  const edge = app.slice(app.indexOf('className="prototype-edge-controls'), app.indexOf('</div>', app.indexOf('className="prototype-edge-controls')));
  assert.match(edge, /<VoiceToggle \/>/, 'the edge controls (on screen with the header closed) hold the toggle');
  const settings = read('src/components/TtsSettings.tsx');
  assert.match(settings, /addEventListener\('airp:prefs-changed', sync\)/);
  assert.match(settings, /toggleCharacterVoice\(e\.target\.checked\)/);
  const messages = JSON.parse(read('src/lib/messages.json'));
  for (const key of ['Character voice on (tap to turn off)', 'Character voice off (tap to turn on)']) {
    for (const locale of ['zh-CN', 'ja', 'ko']) assert.ok(messages[key]?.[locale], `${key} → ${locale}`);
  }
});
