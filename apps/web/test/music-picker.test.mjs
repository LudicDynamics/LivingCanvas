// Music on the page: the 设定 tab's picker lists the
// shared catalog (same source as set_music), previews at the music volume and
// not while muted, and a music_changed world event re-fetches the layer and the
// manifest so the audio engine crossfades live — no reload.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';
import { MUSIC_CATALOG, AMBIENT_CATALOG, MUSIC_TAGS } from '@airp/shared';

const jiti = createJiti(import.meta.url);
const { MUSIC_TAG_LABEL, pickerOptions, selectedValue, previewUrl, isListed } = await jiti.import('../src/lib/music-picker.ts');
const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');

test('picker options are the shared catalog, keywords first', () => {
  const theme = pickerOptions('theme').map((o) => o.value);
  assert.deepEqual(theme.slice(0, 2), ['default', 'silence']);
  assert.deepEqual(theme.slice(2), MUSIC_CATALOG.map((t) => t.id));
  assert.deepEqual(pickerOptions('bgm').map((o) => o.value), theme);
  const ambient = pickerOptions('ambient').map((o) => o.value);
  assert.deepEqual(ambient, ['default', 'none', ...AMBIENT_CATALOG.map((t) => t.id)]);
  for (const tag of MUSIC_TAGS) assert.ok(MUSIC_TAG_LABEL[tag], `label for ${tag}`);
});

test('selected values and preview URLs', () => {
  assert.equal(selectedValue('theme', null, 'tense'), 'silence', 'no theme = silent world');
  assert.equal(selectedValue('theme', 'tense', 'tense'), 'default');
  assert.equal(selectedValue('theme', 'firstsnow', 'tense'), 'firstsnow');
  assert.equal(selectedValue('bgm', undefined), 'default', 'a place without bgm inherits');
  assert.equal(selectedValue('ambient', 'none'), 'none');
  assert.equal(isListed('bgm', 'assets/audio/own.mp3'), false);
  assert.equal(previewUrl('theme', 'default', 'guixiang'), '/api/audio?path=themes%2Fguixiang.mp3');
  assert.equal(previewUrl('bgm', 'calm'), '/api/audio?path=bgm%2Fcalm.mp3');
  assert.equal(previewUrl('ambient', 'storm'), '/api/audio?path=ambient%2Fpool%2Fstorm.mp3');
  assert.equal(previewUrl('bgm', 'silence'), null);
});

test('the picker component: shared options, saves through the gateway, preview respects mute and volume; mounted in 设定', () => {
  const src = read('../src/components/chrome/MusicPicker.tsx');
  assert.match(src, /from '\.\.\/\.\.\/lib\/music-picker\.js'/);
  assert.match(src, /airpGateway\.saveWorkshopMusic\('world', value, null\)/);
  assert.match(src, /if \(!url \|\| isMuted\(\)\) return;/);
  assert.match(src, /el\.volume = Math\.max\(0, Math\.min\(1, getChannelVolume\('music'\)\)\);/);
  assert.match(src, /disabled=\{!canPreview \|\| muted\}/);
  const panel = read('../src/components/chrome/WorkshopArtPanel.tsx');
  assert.match(panel, /<MusicPicker layer=\{layer\} layerName=\{layerName\} \/>/);
  const lib = read('../src/lib/music-picker.ts');
  assert.match(lib, /from '@airp\/shared\/music'/);
  const gw = read('../src/lib/airp-gateway.ts');
  assert.match(gw, /request<\{ ok: boolean; changed: boolean \}>\('\/api\/workshop\/music', json\('POST', \{ layer, track, ambient \}\)\)/);
});

test('live switch: music_changed is forwarded (manifest refetch) and every world event refetches the layer; the theme rests under a place\'s own track', () => {
  const useWorld = read('../src/state/useWorld.ts');
  const fwd = useWorld.slice(useWorld.indexOf('const forwardWorldEvent'), useWorld.indexOf("window.dispatchEvent(new CustomEvent('airp:world-event'"));
  assert.match(fwd, /'music_changed',/);
  assert.match(useWorld, /deferReveal\(\(\) => \{\s*if \(isFrameCurrent\(\)\) void fetchLayer\(layerRef\.current\);\s*\}\);\n\s+\}/);
  const app = read('../src/App.tsx');
  assert.match(app, /window\.addEventListener\('airp:world-event', onWorldEvent\)/);
  assert.match(app, /airpGateway\.manifest<WorldManifest>\(\)/);
  assert.match(app, /setBGM\(state\.audio\.bgm \?\? null\);/);
  assert.match(app, /setTheme\(themeRests \? null : themeUrl\)/);
});
