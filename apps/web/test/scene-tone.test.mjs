import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const { declaredTone, toneOfPixels, DARK_LUMINANCE } = await createJiti(import.meta.url, { moduleCache: false }).import('../src/lib/scene-tone.ts');

const css = await readFile(new URL('../src/index.css', import.meta.url), 'utf8');
const canvas = await readFile(new URL('../src/components/canvas/Canvas.tsx', import.meta.url), 'utf8');

test('a declared README tone wins; the server default means "sample the image"', () => {
  assert.equal(declaredTone('dark'), 'dark');
  assert.equal(declaredTone('light'), 'light');
  assert.equal(declaredTone('warm'), null);
  assert.equal(declaredTone(undefined), null);
});

test('mean luminance below the threshold reads as dark', () => {
  const dark = new Uint8ClampedArray([20, 16, 30, 255, 40, 30, 50, 255]);
  const light = new Uint8ClampedArray([240, 236, 228, 255, 200, 190, 180, 255]);
  assert.equal(toneOfPixels(dark), 'dark');
  assert.equal(toneOfPixels(light), 'light');
  assert.equal(toneOfPixels(new Uint8ClampedArray(0)), 'light');
  assert.ok(DARK_LUMINANCE > 0.3 && DARK_LUMINANCE < 0.5);
});

test('bare chalk stays transparent and flips its ink and halo with the scene tone', () => {
  const bare = css.slice(css.indexOf('.chalk--bare {'), css.indexOf('white-space: pre-wrap;', css.indexOf('.chalk--bare {')));
  // No box: legibility comes from the glyph halo, never from a background.
  assert.match(bare, /background: var\(--ux-surface-transparent-ink\);/);
  assert.match(bare, /border: none;/);
  assert.match(bare, /text-shadow: var\(--ux-shadow-chalk-glow\);/);
  assert.doesNotMatch(bare, /padding:/);
  assert.match(css, /\[data-scene-tone="dark"\] \.chalk--bare,\s*\[data-scene-tone="dark"\] \.chalk \{[\s\S]*--ux-color-chalk-ink-dark[\s\S]*--ux-shadow-chalk-glow-dark/);
  assert.match(canvas, /data-scene-tone=\{sceneTone\}/);
  assert.match(canvas, /useSceneTone\(/);
});
