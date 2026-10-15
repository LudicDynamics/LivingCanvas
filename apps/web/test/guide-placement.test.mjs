// Where the onboarding bubble goes (lib/guide-placement.ts).:
// the creator step on the bottom writer bar drew its bubble BELOW the bar, off
// screen, with 「下次不要再显示」 unreachable.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const { placeGuideBubble } = await createJiti(import.meta.url, { moduleCache: false }).import('../src/lib/guide-placement.ts');

const inside = (p, vw, vh, h, margin = 12) => {
  const shown = Math.min(h, p.maxHeight);
  assert.ok(p.top >= margin - 0.01, `top ${p.top}`);
  assert.ok(p.left >= margin - 0.01, `left ${p.left}`);
  assert.ok(p.left + p.width <= vw - margin + 0.01, `right ${p.left + p.width} > ${vw - margin}`);
  assert.ok(p.top + shown <= vh - margin + 0.01, `bottom ${p.top + shown} > ${vh - margin}`);
};
const clear = (p, box, h) => {
  const shown = Math.min(h, p.maxHeight);
  const overlapX = p.left < box.left + box.width && p.left + p.width > box.left;
  const overlapY = p.top < box.top + box.height && p.top + shown > box.top;
  assert.ok(!(overlapX && overlapY), 'bubble covers its target');
};

test('a full-width bar at the bottom puts the bubble above it, inside the viewport', () => {
  const vw = 1280, vh = 720, bubble = { width: 248, height: 120 };
  const bar = { top: 650, left: 0, width: 1280, height: 56 };
  const p = placeGuideBubble({ box: bar, viewport: { width: vw, height: vh }, bubble });
  assert.equal(p.side, 'above');
  assert.ok(p.top + bubble.height <= bar.top, 'bubble ends above the bar');
  inside(p, vw, vh, bubble.height);
  clear(p, bar, bubble.height);
});

test('a target in the top half with no side room goes below', () => {
  const box = { top: 70, left: 0, width: 800, height: 40 };
  const p = placeGuideBubble({ box, viewport: { width: 800, height: 600 }, bubble: { width: 248, height: 100 } });
  assert.equal(p.side, 'below');
  inside(p, 800, 600, 100);
  clear(p, box, 100);
});

test('a column target keeps the bubble beside it, and flips left at the right edge', () => {
  const rail = { top: 100, left: 0, width: 240, height: 400 };
  const r = placeGuideBubble({ box: rail, viewport: { width: 1280, height: 720 }, bubble: { width: 248, height: 100 } });
  assert.equal(r.side, 'right');
  inside(r, 1280, 720, 100);
  const dock = { top: 100, left: 1000, width: 280, height: 500 };
  const l = placeGuideBubble({ box: dock, viewport: { width: 1280, height: 720 }, bubble: { width: 248, height: 100 } });
  assert.equal(l.side, 'left');
  inside(l, 1280, 720, 100);
  clear(l, dock, 100);
});

test('a bubble taller than the room is capped and scrolls, still inside the viewport', () => {
  const vw = 1280, vh = 360, bubble = { width: 248, height: 900 };
  const bar = { top: 300, left: 0, width: 1280, height: 48 };
  const p = placeGuideBubble({ box: bar, viewport: { width: vw, height: vh }, bubble });
  assert.equal(p.side, 'above');
  assert.ok(p.maxHeight < bubble.height && p.maxHeight > 0);
  inside(p, vw, vh, bubble.height);
  clear(p, bar, bubble.height);
});

test('on a phone the bubble narrows to the screen and stays inside it', () => {
  const vw = 360, vh = 640;
  for (const box of [
    { top: 580, left: 300, width: 48, height: 48 }, // writer FAB, bottom right
    { top: 0, left: 0, width: 360, height: 60 },    // top bar
    { top: 560, left: 0, width: 360, height: 80 },  // bottom writer bar
  ]) {
    const p = placeGuideBubble({ box, viewport: { width: vw, height: vh }, bubble: { width: 248, height: 140 } });
    inside(p, vw, vh, 140);
    clear(p, box, 140);
  }
  const tiny = placeGuideBubble({ box: { top: 10, left: 10, width: 20, height: 20 }, viewport: { width: 200, height: 300 }, bubble: { width: 248, height: 80 } });
  assert.equal(tiny.width, 200 - 24);
  inside(tiny, 200, 300, 80);
});

test('the guide uses the placement and keeps its off switch out of the scrolling part', async () => {
  const guide = await readFile(new URL('../src/components/chrome/OnboardingGuide.tsx', import.meta.url), 'utf8');
  const css = await readFile(new URL('../src/components/chrome/onboarding-guide.css', import.meta.url), 'utf8');
  assert.match(guide, /placeGuideBubble\(\{/);
  assert.match(guide, /maxHeight: `\$\{Math\.floor\(place\.maxHeight\)\}px`/);
  assert.match(guide, /<div ref=\{lineRef\} className="onboarding-guide__scroll">[\s\S]*<\/div>\s*<button type="button" className="onboarding-guide__off"/);
  assert.match(css, /\.onboarding-guide__scroll \{[^}]*overflow-y: auto/);
  assert.match(css, /\.onboarding-guide__off \{[^}]*flex: 0 0 auto/);
  // Above every resting chrome, including the 素材 panel.
  const index = await readFile(new URL('../src/index.css', import.meta.url), 'utf8');
  assert.match(index, /--depth-chrome-art-panel: calc\(var\(--depth-writer\) \+ 12\)/);
  assert.match(index, /--depth-chrome-guide: calc\(var\(--depth-writer\) \+ 14\)/);
});
