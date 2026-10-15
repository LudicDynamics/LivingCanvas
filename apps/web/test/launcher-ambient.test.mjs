// The launcher draws no live blur: the glow behind the wall
// is a pre-blurred static bitmap (src/lib/launcher-ambient.ts), the glass is
// rgba fills, and wheel motion holds hover so no brick transitions mid-scroll.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const ambient = await createJiti(import.meta.url, { moduleCache: false }).import('../src/lib/launcher-ambient.ts');
const src = (file) => readFile(new URL(`../src/${file}`, import.meta.url), 'utf8');

test('box blur: three passes approximate the Gaussian σ and spread a point evenly', () => {
  // σ² of n box passes of radius r is n·((2r+1)²−1)/12.
  for (const sigma of [2, 4.8, 17.7]) {
    const r = ambient.boxRadiusForSigma(sigma);
    const achieved = Math.sqrt((3 * ((2 * r + 1) ** 2 - 1)) / 12);
    assert.ok(Math.abs(achieved - sigma) / sigma < 0.25, `σ ${sigma} → r ${r} (σ≈${achieved.toFixed(2)})`);
  }
  assert.equal(ambient.boxRadiusForSigma(0), 0);
  const width = 21, height = 21;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let p = 0; p < data.length; p += 4) data[p + 3] = 255;
  const centre = (10 * width + 10) * 4;
  data[centre] = data[centre + 1] = data[centre + 2] = 255;
  ambient.boxBlurRGBA(data, width, height, 2, 3, [0, 0, 0]);
  assert.ok(data[centre] < 255 && data[centre] > 0, 'the bright point is spread out');
  assert.equal(data[(10 * width + 9) * 4], data[(10 * width + 11) * 4], 'symmetric left / right');
  assert.equal(data[(9 * width + 10) * 4], data[(11 * width + 10) * 4], 'symmetric up / down');
  assert.equal(data[0], 0, 'far corner untouched');
});

test('box blur fades into the launcher background at the edges, like the old filter over #04050c', () => {
  const data = new Uint8ClampedArray(8 * 8 * 4).fill(255);
  ambient.boxBlurRGBA(data, 8, 8, 2, 3, [4, 5, 12]);
  assert.ok(data[0] < data[(4 * 8 + 4) * 4], 'corner darker than centre');
});

test('grade = CSS saturate() then brightness(): grey stays grey, colour gets stronger, all scaled', () => {
  const grey = new Uint8ClampedArray([100, 100, 100, 255]);
  ambient.gradeRGBA(grey, 1.25, 0.34);
  assert.deepEqual([...grey], [34, 34, 34, 255]);
  const red = new Uint8ClampedArray([200, 100, 100, 255]);
  ambient.gradeRGBA(red, 1.25, 1);
  assert.ok(red[0] > 200 && red[1] < 100, `saturated: ${[...red]}`);
});

test('cover crop centres like background-size: cover', () => {
  assert.deepEqual(ambient.coverCrop(200, 100, 50, 100), { sx: 75, sy: 0, sw: 50, sh: 100 });
  assert.deepEqual(ambient.coverCrop(100, 200, 100, 50), { sx: 0, sy: 75, sw: 100, sh: 50 });
});

test('the glow bitmap is tiny and its σ follows the viewport (70px on a box 130% of it)', () => {
  const desktop = ambient.ambientBitmapSize(1440, 900, 70);
  assert.equal(desktop.width, 128);
  assert.equal(desktop.height, 80);
  assert.ok(Math.abs(desktop.sigma - (70 * 128) / (1440 * 1.3)) < 1e-9);
  const phone = ambient.ambientBitmapSize(390, 844, 70);
  assert.ok(phone.height > phone.width && phone.sigma > desktop.sigma);
});

test('cover thumbnails: downscale only what is larger than a brick can show (≤520 CSS px, ≤2x)', () => {
  assert.equal(ambient.coverThumbWidth(1536, 432, 2), 864);
  assert.equal(ambient.coverThumbWidth(1536, 520, 3), 1040, 'dpr capped at 2');
  assert.equal(ambient.coverThumbWidth(900, 432, 2), null, 'already small enough: keep the original');
  assert.equal(ambient.coverThumbWidth(4000, 900, 1), 520, 'width capped at the largest brick');
});

test('launcher CSS: no live blur and no backdrop-filter; launcher scope is a :root attribute, not body:has()', async () => {
  const css = await src('components/world-launcher.css');
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/filter:\s*blur\(/.test(rules), 'no filter: blur() on the launcher');
  assert.ok(!/backdrop-filter:\s*(?!\s|none)/.test(rules), 'every launcher backdrop-filter is none');
  assert.ok(!rules.includes('body:has(.world-launcher)'), 'launcher scope must not be a :has() on <body>');
  assert.match(rules, /\.world-launcher__ambient-image\s*\{/);
  assert.match(rules, /:root\[data-airp-blur="off"\] \.world-launcher__ambient-image \{ display: none; \}/);
  assert.match(rules, /\.world-launcher\.is-moving \.world-launcher__tile \{ transition: none; \}/);
  assert.ok(!/\.world-launcher__image \{[^}]*filter/.test(rules), 'the cover dim is a tint, not a filter');
});

test('WorldLauncher: pre-blurred glow, <img> covers sized up front, hover held while the wall moves', async () => {
  const tsx = await src('components/WorldLauncher.tsx');
  assert.match(tsx, /ambientBackdropUrl\(ambientCovers, ambientColumns, window\.innerWidth, window\.innerHeight, ambientRadius\)/);
  assert.match(tsx, /className=\{`world-launcher__ambient-image/);
  assert.match(tsx, /coverThumbUrl\(original, brickWidth, dpr\)/);
  const img = tsx.slice(tsx.indexOf('className="world-launcher__image"') - 20, tsx.indexOf('className="world-launcher__image"') + 260);
  for (const attr of ['width={width}', 'height={height}', 'loading="lazy"', 'decoding="async"']) assert.ok(img.includes(attr), `cover <img> carries ${attr}`);
  assert.match(tsx, /html\.dataset\.airpLauncher = 'open'/);
  assert.match(tsx, /if \(!drag\.current\?\.moved && !moving\.current\.on\) setHovered\(key\);/);
  // Every source of wheel / key / glide motion marks the wall as moving.
  assert.ok((tsx.match(/markMoving\(\);/g) ?? []).length >= 3);
});
