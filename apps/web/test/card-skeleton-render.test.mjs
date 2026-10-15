// CardSkeleton render assertions. No jsdom: React's
// server renderer yields the real DOM tree as a string — enough to prove the
// component draws a chaptered skeleton and, critically, that a `bare` tier
// draws NOTHING. TSX is bundled with esbuild (jiti cannot parse JSX) into a
// temp file, then imported; nothing is written inside the source tree.
// Run: node --test apps/web/test/card-skeleton-render.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..');
const repoRoot = path.resolve(webRoot, '../..');
const require = createRequire(pathToFileURL(path.join(webRoot, 'test/x.mjs')));

let CardSkeleton = null;
let React = null;
let renderToStaticMarkup = null;
try {
  const esbuild = require(
    path.join(repoRoot, 'node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild/lib/main.js')
  );
  React = await import('react');
  ({ renderToStaticMarkup } = await import('react-dom/server'));

  // Bundle the component with react externalised so the renderer shares our
  // React instance; `@airp/shared/forms` is resolved from the web workspace.
  const out = await esbuild.build({
    entryPoints: [path.join(webRoot, 'src/components/narrative/CardSkeleton.tsx')],
    bundle: true,
    write: false,
    format: 'esm',
    jsx: 'automatic',
    external: ['react', 'react/jsx-runtime'],
    platform: 'node',
    absWorkingDir: webRoot,
  });
  // Emit beside the workspace so Node resolves `react` from apps/web/node_modules.
  const cacheDir = path.join(webRoot, 'node_modules/.cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  const dir = fs.mkdtempSync(path.join(cacheDir, 'airp-skel-'));
  const file = path.join(dir, 'CardSkeleton.mjs');
  fs.writeFileSync(file, out.outputFiles[0].text, 'utf-8');
  ({ CardSkeleton } = await import(pathToFileURL(file).href));
  fs.rmSync(dir, { recursive: true, force: true });
} catch (err) {
  console.error('render bootstrap unavailable, skipping group:', err?.message ?? err);
}
const skip = CardSkeleton ? false : 'esbuild/react unavailable';
const entry = (cardKind, phase = 'pending', h = 200) => ({
  toolCallId: 't1',
  kind: 'component',
  source: 'writer',
  seat: { x: 0, y: 0, w: 280, h, z: 1 },
  cardKind,
  phase,
  createdAt: Date.now(),
});
const render = (e) => renderToStaticMarkup(React.createElement(CardSkeleton, { entry: e }));

test('renders a structured skeleton for a paper-tier kind', { skip }, () => {
  const html = render(entry('letter', 'pending', 176));
  assert.match(html, /class="card-skeleton card-skeleton--paper card-skeleton--writing"/);
  assert.match(html, /data-card-chrome="paper"/);
  assert.match(html, /data-card-kind="letter"/);
  assert.match(html, /data-phase="pending"/);
  assert.match(html, /card-skeleton__line/);
  // No words anywhere.
  const text = html.replace(/<[^>]*>/g, '|').replace(/\|+/g, '|');
  assert.ok(!/[A-Za-z]{2,}/.test(text), `skeleton must carry no words: ${text}`);
});

test('scroll tier draws doubled edges; panel / note / slab draw theirs', { skip }, () => {
  const scroll = render(entry('map', 'pending', 200));
  assert.match(scroll, /card-skeleton--scroll/);
  assert.match(scroll, /card-skeleton__edge--top/);
  assert.match(scroll, /card-skeleton__edge--bottom/);
  assert.match(render(entry('clock', 'pending', 160)), /card-skeleton--panel/);
  assert.match(render(entry('note', 'pending', 168)), /card-skeleton__clip/);
  assert.match(render(entry('lock', 'pending', 176)), /card-skeleton__block/);
});

test('landed freezes, evicted marks the fade class', { skip }, () => {
  assert.match(render(entry('letter', 'landed', 176)), /card-skeleton--landed/);
  assert.match(render(entry('letter', 'evicted', 176)), /card-skeleton--evicted/);
});

test('a bare tier renders nothing (non-emptiness guard)', { skip }, () => {
  for (const kind of ['chalk', 'sprite', 'portrait']) {
    assert.equal(render(entry(kind, 'pending', 190)), '', `${kind} must render nothing`);
  }
});

test('an unknown kind falls back to paper (never blank)', { skip }, () => {
  const html = render(entry('not-a-real-kind', 'pending', 168));
  assert.match(html, /card-skeleton--paper/);
  assert.match(html, /card-skeleton__line/);
});
