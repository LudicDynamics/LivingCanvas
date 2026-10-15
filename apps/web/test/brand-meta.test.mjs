// Brand + share preview contract: index.html carries the title, icons,
// manifest and og/twitter tags with absolute https URLs on canvas.worldlines.gg; every referenced
// brand file exists in public/ with the right pixel size and stays small enough for crawlers.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';

const WEB = new URL('../', import.meta.url);
const PUB = new URL('public/', WEB);
const html = fs.readFileSync(new URL('index.html', WEB), 'utf8');
const ORIGIN = 'https://canvas.worldlines.gg';

const metaAll = (attr, key) => [...html.matchAll(new RegExp(`<meta\\s+${attr}="${key.replace(/[:]/g, '\\:')}"\\s+content="([^"]*)"`, 'g'))].map((m) => m[1]);
const meta = (attr, key) => metaAll(attr, key)[0];

function pngSize(buf) {
  assert.equal(buf.toString('ascii', 1, 4), 'PNG');
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}
function jpegSize(buf) {
  assert.equal(buf.readUInt16BE(0), 0xffd8);
  for (let i = 2; i < buf.length; ) {
    const marker = buf.readUInt16BE(i), len = buf.readUInt16BE(i + 2);
    if (marker >= 0xffc0 && marker <= 0xffcf && ![0xffc4, 0xffc8, 0xffcc].includes(marker)) return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
    i += 2 + len;
  }
  throw new Error('no SOF');
}
const pub = (url) => new URL(url.replace(ORIGIN, '').replace(/^\//, ''), PUB);

test('title and description name LivingCanvas, not the old AIRP title or the Vite favicon', () => {
  assert.match(html, /<title>LivingCanvas · Worldlines<\/title>/);
  assert.ok((meta('name', 'description') ?? '').length > 20);
  assert.doesNotMatch(html, /vite\.svg|Infinite Canvas Narrative/);
});

test('og + twitter tags are complete and point at absolute https URLs', () => {
  for (const k of ['og:type', 'og:site_name', 'og:title', 'og:description', 'og:url', 'og:image', 'og:image:alt', 'og:locale']) assert.ok(meta('property', k), k);
  assert.equal(meta('property', 'og:url'), `${ORIGIN}/`);
  assert.deepEqual(metaAll('property', 'og:locale:alternate').sort(), ['ja_JP', 'ko_KR', 'zh_CN']);
  assert.equal(meta('name', 'twitter:card'), 'summary_large_image');
  for (const img of [meta('property', 'og:image'), meta('name', 'twitter:image')]) {
    assert.match(img, /^https:\/\/canvas\.worldlines\.gg\/brand\/og\.(jpg|png)$/);
  }
  assert.equal(meta('property', 'og:image'), meta('name', 'twitter:image'));
});

test('og image: 1200×630, ≤ 300 KB, declared size matches the file', () => {
  const url = meta('property', 'og:image');
  const buf = fs.readFileSync(pub(url));
  assert.ok(buf.length <= 300 * 1024, `${buf.length} bytes`);
  assert.deepEqual(url.endsWith('.png') ? pngSize(buf) : jpegSize(buf), [1200, 630]);
  assert.equal(meta('property', 'og:image:width'), '1200');
  assert.equal(meta('property', 'og:image:height'), '630');
});

test('every linked icon / manifest exists; PNG icons have the declared pixel size', () => {
  const links = [...html.matchAll(/<link\s+rel="(icon|apple-touch-icon|manifest)"([^>]*)>/g)].map((m) => ({ rel: m[1], href: m[2].match(/href="([^"]+)"/)[1], sizes: m[2].match(/sizes="([^"]+)"/)?.[1] }));
  assert.ok(links.some((l) => l.rel === 'manifest'));
  assert.ok(links.some((l) => l.rel === 'apple-touch-icon'));
  for (const l of links) {
    assert.ok(fs.existsSync(pub(l.href)), l.href);
    if (l.href.endsWith('.png') && l.sizes) assert.deepEqual(pngSize(fs.readFileSync(pub(l.href))).join('x'), l.sizes, l.href);
  }
  assert.deepEqual(pngSize(fs.readFileSync(new URL('brand/apple-touch-icon.png', PUB))), [180, 180]);
});

test('web manifest: LivingCanvas, colors match theme-color, 192/512/maskable icons exist at size', () => {
  const m = JSON.parse(fs.readFileSync(new URL('manifest.webmanifest', PUB), 'utf8'));
  assert.equal(m.name, 'LivingCanvas');
  assert.ok(m.short_name && m.short_name.length <= 12);
  assert.equal(m.theme_color, meta('name', 'theme-color'));
  assert.match(m.background_color, /^#[0-9a-f]{6}$/i);
  const png = m.icons.filter((i) => i.type === 'image/png');
  for (const i of png) assert.deepEqual(pngSize(fs.readFileSync(pub(i.src))).join('x'), i.sizes, i.src);
  for (const s of ['192x192', '512x512']) assert.ok(png.some((i) => i.sizes === s && (i.purpose ?? 'any') === 'any'), s);
  assert.ok(png.some((i) => i.purpose === 'maskable'));
});

test('brand SVGs are self-contained (outlined text, no webfont or external refs)', () => {
  for (const f of ['wordmark.svg', 'wordmark-light.svg', 'icon.svg']) {
    const svg = fs.readFileSync(new URL(`brand/${f}`, PUB), 'utf8');
    assert.match(svg, /viewBox="/, f);
    assert.doesNotMatch(svg, /<text|@import|@font-face|href="http/, f);
    assert.ok(svg.length < 40 * 1024, f);
  }
});
