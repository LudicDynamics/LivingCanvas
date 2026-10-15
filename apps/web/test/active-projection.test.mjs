import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const nook = await readFile(new URL('../src/components/nook/NookView.tsx', import.meta.url), 'utf8');
const nookCode = nook.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
const performance = await readFile(new URL('../src/components/performance/PerformanceLayer.tsx', import.meta.url), 'utf8');
const characterModal = await readFile(new URL('../src/components/overlay/CharacterModal.tsx', import.meta.url), 'utf8');

test('App has mutually exclusive layer and Nook projection branches', () => {
  assert.match(app, /\{nookChar\s*&&\s*\(/);
  assert.match(app, /\{!nookChar\s*&&\s*\(/);
  assert.match(app, /data-airp-projection=\{`layer:\$\{layer\}`\}/);
  assert.match(app, /data-airp-projection=\{`nook:\$\{nookChar\}`\}/);
  assert.equal((app.match(/<Canvas\b/g) ?? []).length, 1);
  assert.equal((app.match(/<PerformanceLayer\b/g) ?? []).length, 1);
  assert.doesNotMatch(app, /\{nookChar\s*&&\s*<div className="prototype-nook"/);
});

test('only the active projection owns the active marker and Nook measurement is root-scoped', () => {
  assert.equal((app.match(/data-airp-projection-active="true"/g) ?? []).length, 1);
  assert.equal((nook.match(/data-airp-projection-active="true"/g) ?? []).length, 1);
  assert.doesNotMatch(nookCode, /useWorld\s*\(/);
  assert.doesNotMatch(nookCode, /new\s+WebSocket/);
  assert.doesNotMatch(nookCode, /useCamera\s*\(/);
  assert.match(nook, /rootRef\.current\?\.querySelector\('\.object\.dragging-item'\)/);
});

test('stable PerformanceLayer owns one show listener across projection switches', () => {
  assert.match(app, /<PerformanceLayer[\s\S]*layer=\{nookChar \? `characters\/\$\{nookChar\}` : layer\}/);
  assert.match(app, /<NookView key=\{nookChar\}/);
  assert.match(app, /resolveAssetUrl=\{assetUrl\}/);
  assert.equal((performance.match(/addEventListener\('airp:show-frame'/g) ?? []).length, 1);
  assert.match(performance, /ownerRef\.current/);
  assert.match(performance, /liveCtx === ctx/);
  assert.match(performance, /cancelShow\('performance-context-replaced'\)/);
  assert.match(performance, /cancelShow\('performance-unmount'\)/);
  assert.match(performance, /\[camera, still, hiddenState, effectsEnabled, admission, layer, frozen\]/);
});

test('Nook keeps the response layer and host lifecycle seams', () => {
  assert.match(nook, /currentLayer=\{state\.layer\}/);
  assert.match(nook, /hidden=\{hidden\}/);
  assert.match(nook, /effectsEnabled=\{effectsEnabled\}/);
  assert.match(nook, /reducedMotion=\{effectiveReducedMotion\}/);
  assert.equal((nook.match(/data-nook-zone="canvas"/g) ?? []).length, 1);
  assert.match(nook, /assetUrl=\{resolveAssetUrl\}/);
  assert.match(nook, /const reconcileNook = useCallback/);
  assert.match(nook, /onItemDropOnTarget\?\.\(itemPath, targetPath, reconcileNook\)/);
  assert.doesNotMatch(characterModal, /data-airp-projection-active/);
});

test('rapid Nook replacement unwinds the old camera frame first', () => {
  assert.match(app, /const frame = cameraStack\.popTransition\(caller\);/);
  assert.match(app, /if \(frame\) \{\s*cameraStack\.restoreProjection\(frame\);\s*caller = frame\.caller;/);
});
