import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const css = fs.readFileSync(path.join(root, 'src/decoration.css'), 'utf8');
const sceneCss = fs.readFileSync(path.join(root, 'src/scene-shell.css'), 'utf8');

function uncomment(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '');
}

test('all five material URLs resolve to optimized WebP assets', () => {
  const urls = [...new Set([...css.matchAll(/url\('([^']+)'\)/g)].map((match) => match[1]))];
  // Five since 2026-10-02: the place's hover detail sheet (location-hover-paper)
  // was removed — its text is read in the card's focus view.
  assert.equal(urls.length, 5);
  assert.ok(!urls.some(url => url.includes('location-hover-paper')));
  let total = 0;
  for (const url of urls) {
    const bytes = fs.readFileSync(path.join(root, 'public', url));
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
    total += bytes.length;
  }
  assert.ok(total < 900000);
  assert.match(css, /scene-backdrop:not\(:has\(\.scene-backdrop__img\)\)/);
  assert.match(css, /\[data-nook\] \.paper-reading/);
});

test('decoration uses the existing semantic palette and registered depth only', () => {
  const source = uncomment(css);
  assert.match(source, /var\(--(?:ink|muted|paper|cream|wall|rust|sage|blue|line)\b/);
  assert.doesNotMatch(source, /#(?:7853ae|b39acb|483956|292332|302638)/i);
  for (const value of [...source.matchAll(/z-index\s*:\s*([^; }\n]+)/g)].map((match) => match[1])) {
    assert.match(value, /^var\(--depth-[a-z0-9-]+\)$/,
      `decoration has an unregistered numeric or compound z-index: ${value}`);
  }
  assert.match(sceneCss, /@import ['"]\.\/decoration\.css['"]/);
});

test('settings portal styling is isolated from world-picker styling', () => {
  assert.match(css, /\.settings-panel\s*\{/);
  assert.match(css, /overscroll-behavior:\s*contain/);
  assert.match(css, /:is\(button, input\):focus-visible/);
  assert.doesNotMatch(css, /\.settings-panel[^}]*z-index\s*:/s);
});
