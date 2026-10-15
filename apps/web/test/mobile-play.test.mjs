// Phones during play: the rotate-to-landscape hint (components/chrome/RotateHint.tsx) and keeping the focused field
// above the iOS keyboard (lib/keyboard-lift.ts). Browser evidence: Playwright device runs (iPhone 15, Pixel 7).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const K = await jiti.import('../src/lib/keyboard-lift.ts');
const read = (p) => readFile(new URL(p, import.meta.url), 'utf8');

test('liftFor: lifts by exactly the covered amount (+ margin), never down', () => {
  // 844-tall layout viewport, keyboard leaves 500 visible; field bottom at 800 → lift 308.
  assert.equal(K.liftFor(800, 0, 0, 500), 308);
  // Already lifted 308 (rect now 492): stays 308.
  assert.equal(K.liftFor(492, 308, 0, 500), 308);
  // iOS scrolled the visual viewport down 100: less to lift.
  assert.equal(K.liftFor(800, 0, 100, 500), 208);
  // Keyboard closed / field visible: no lift.
  assert.equal(K.liftFor(300, 0, 0, 844), 0);
  assert.equal(K.liftFor(492, 308, 0, 844), 0);
});

test('rotate hint: CSS-only visibility on upright touch phones, play view only, dismissal per session', async () => {
  const css = await read('../src/components/chrome/rotate-hint.css');
  assert.match(css, /^\.rotate-hint \{ display: none; \}/m);
  assert.match(css, /@media \(orientation: portrait\) and \(max-width: 600px\) and \(pointer: coarse\)/);
  assert.match(css, /z-index: var\(--depth-chrome-hint\)/); // below modals / account / menus
  const app = await read('../src/App.tsx');
  // The first-run prologue has its own upright layout: no rotate hint there.
  assert.match(app, /\{!launcherOpen && !prologueOpen && <RotateHint \/>\}/);
  const tsx = await read('../src/components/chrome/RotateHint.tsx');
  assert.match(tsx, /sessionStorage/);
});

test('keyboard lift is installed for the app (not the perception page) and composes via `translate`', async () => {
  const main = await read('../src/main.tsx');
  assert.match(main, /if \(!perceptionRoot\) installKeyboardLift\(\);/);
  const css = await read('../src/keyboard-lift.css');
  assert.match(css, /\[data-kb-lift\] \{ translate: 0 calc\(-1 \* var\(--kb-lift, 0px\)\)/);
});
