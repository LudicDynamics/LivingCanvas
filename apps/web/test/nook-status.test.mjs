import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false, tryNative: true });
const { portraitStatusOf, statusLineOf } = await jiti.import('../src/lib/nook-status.ts');

const view = await readFile(new URL('../src/components/nook/NookView.tsx', import.meta.url), 'utf8');
const css = await readFile(new URL('../src/components/nook/nook-character-media.css', import.meta.url), 'utf8');

test('a string status.data is the status line', () => {
  assert.equal(statusLineOf({ status: { data: 'mid-thought' } }), 'mid-thought');
  assert.equal(statusLineOf({ status: { data: '  mid-thought  ' } }), 'mid-thought');
});

test('an object status.data is rendered as key: value pairs', () => {
  assert.equal(statusLineOf({ status: { data: { mood: 'tired', room: 'office' } } }), 'mood: tired · room: office');
  assert.equal(statusLineOf({ status: { data: { mood: 'tired', room: '' } } }), 'mood: tired');
});

test('the topbar falls back to the README title, then to nothing', () => {
  assert.equal(statusLineOf({ title: 'Exp · Elias' }), 'Exp · Elias');
  assert.equal(statusLineOf({}), null);
  assert.equal(statusLineOf(null), null);
});

test('the nameplate never repeats the name via the README title fallback', () => {
  // The nameplate already prints the display name; echoing the README title
  // ("Exp · Elias") would print the same identity twice.
  assert.equal(portraitStatusOf({ title: 'Exp · Elias' }), null);
  assert.equal(portraitStatusOf({ status: { data: 'mid-thought' } }), 'mid-thought');
  assert.equal(portraitStatusOf({ status: { data: { mood: 'tired' } } }), 'mood: tired');
  assert.equal(portraitStatusOf(null), null);
});

test('the portrait renders a nameplate and NookView feeds it a status', () => {
  assert.match(css, /\.nook-character-media__nameplate/);
  assert.match(css, /\.nook-character-media__name/);
  assert.match(view, /statusLine=\{portraitStatus\}/);
});
