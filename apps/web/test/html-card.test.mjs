// the design notes — M7 (card face) + M8 (second layer).
//
// Three layers of evidence, matching the design's own list:
//   §10.1 T1–T6  source contracts (mechanically checkable)
//   §10.2 U1–U7  `computeBudgetAllowed` — a PURE function, imported directly
//   §10.3 E1/E3/E5/E7  the real component tree through `renderToStaticMarkup`
//                (the repo has no jsdom; TSX is bundled with esbuild first)
//
// EVERY ordering assertion pins its anchors first: an unguarded
// `indexOf(a) < indexOf(b)` is TRUE when both are missing (-1 < -1 is false,
// but -1 < +N passes), which silently turns a moved anchor into a green test.
//
// Run: node --test apps/web/test/html-card.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(new URL(import.meta.url).pathname);
const webRoot = path.resolve(here, '..');
const repoRoot = path.resolve(webRoot, '../..');
const require = createRequire(pathToFileURL(path.join(webRoot, 'test/x.mjs')));

const budgetSrc = await readFile(path.join(webRoot, 'src/lib/html-card-budget.ts'), 'utf8');
const mediaSrc = await readFile(path.join(webRoot, 'src/components/html/HtmlMedia.tsx'), 'utf8');
const cardSrc = await readFile(path.join(webRoot, 'src/components/html/HtmlCard.tsx'), 'utf8');
const detailSrc = await readFile(path.join(webRoot, 'src/components/html/HtmlDetailDialog.tsx'), 'utf8');
const cssSrc = await readFile(path.join(webRoot, 'src/components/html/html.css'), 'utf8');
const rendererSrc = await readFile(path.join(webRoot, 'src/components/canvas/CardRenderer.tsx'), 'utf8');
const objectSrc = await readFile(path.join(webRoot, 'src/components/canvas/CanvasObject.tsx'), 'utf8');
const canvasSrc = await readFile(path.join(webRoot, 'src/components/canvas/Canvas.tsx'), 'utf8');

// ---------------------------------------------------------------------------
// §10.2 — the budget rule, as behaviour
// ---------------------------------------------------------------------------

let budget = null;
try {
  const { createJiti } = await import('../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs');
  const jiti = createJiti(import.meta.url, { moduleCache: false, tryNative: true });
  budget = await jiti.import('../src/lib/html-card-budget.ts');
} catch (err) {
  console.error('jiti/bootstrap unavailable, skipping budget group:', err?.message ?? err);
}
const skipBudget = budget ? false : 'jiti or pi-rp submodule unavailable';
const compute = budget?.computeBudgetAllowed;

const frame = (id, z, visible = true, layer = 'L1') => ({ id, layer, z, visible });
const ids = (set) => [...set].sort();

test('U1 seven visible cards in one layer: six iframes, the last seat is out', { skip: skipBudget }, () => {
  const entries = Array.from({ length: 7 }, (_, i) => frame(`c${i + 1}`, i + 1));
  const allowed = compute(entries);
  assert.equal(allowed.size, 6);
  assert.equal(allowed.has('c7'), false, 'the z=7 card must lose its iframe');
  assert.deepEqual(ids(allowed), ['c1', 'c2', 'c3', 'c4', 'c5', 'c6']);
});

test('U2 shuffling the registration order cannot change the answer', { skip: skipBudget }, () => {
  const entries = Array.from({ length: 7 }, (_, i) => frame(`c${i + 1}`, i + 1));
  const forward = ids(compute(entries));
  const backward = ids(compute([...entries].reverse()));
  assert.deepEqual(backward, forward);
});

test('U3 an invisible card takes no slot — the budget reaches past it', { skip: skipBudget }, () => {
  const entries = [frame('c1', 1, false), ...Array.from({ length: 6 }, (_, i) => frame(`c${i + 2}`, i + 2))];
  const allowed = compute(entries);
  assert.equal(allowed.has('c1'), false);
  assert.deepEqual(ids(allowed), ['c2', 'c3', 'c4', 'c5', 'c6', 'c7']);
});

test('U4 the budget is isolated per layer, not shared across layers', { skip: skipBudget }, () => {
  const entries = [
    ...Array.from({ length: 7 }, (_, i) => frame(`a${i + 1}`, i + 1, true, 'A')),
    ...Array.from({ length: 7 }, (_, i) => frame(`b${i + 1}`, i + 1, true, 'B')),
  ];
  const allowed = compute(entries);
  assert.equal(allowed.size, 12);
  assert.deepEqual(ids(allowed), ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'b1', 'b2', 'b3', 'b4', 'b5', 'b6']);
});

test('U5 equal z breaks by id, so the answer is deterministic', { skip: skipBudget }, () => {
  const allowed = compute([frame('nn', 5), frame('aa', 5), frame('mm', 5)], 2);
  assert.deepEqual(ids(allowed), ['aa', 'mm']);
});

test('U6 budget 0 yields an empty Set, never undefined', { skip: skipBudget }, () => {
  const allowed = compute([frame('c1', 1)], 0);
  assert.ok(allowed instanceof Set);
  assert.equal(allowed.size, 0);
});

test('U7 an entry with an empty layer still never throws', { skip: skipBudget }, () => {
  assert.equal(compute([frame('c1', 1, true, '')]).size, 0);
  assert.equal(compute([]).size, 0);
});

// The registry itself, not just the rule: one card never mounts twice, and the
// snapshot keeps its REFERENCE while the content is unchanged (the
// `useSyncExternalStore` contract — a new Set every report would re-render
// every card on the canvas).

test('the registry reports, unregisters, and keeps a stable snapshot reference', { skip: skipBudget }, () => {
  const { reportCardFrame, htmlFrameAllowedSnapshot, subscribeHtmlBudget } = budget;
  const before = htmlFrameAllowedSnapshot();
  let notified = 0;
  const unsubscribe = subscribeHtmlBudget(() => { notified += 1; });
  const offA = reportCardFrame({ id: 'reg/a.html', layer: 'L9', z: 1, visible: true });
  const first = htmlFrameAllowedSnapshot();
  assert.notEqual(first, before);
  assert.equal(first.has('reg/a.html'), true);
  // Same content reported again → same reference, and no notification.
  const offA2 = reportCardFrame({ id: 'reg/a.html', layer: 'L9', z: 1, visible: true });
  assert.equal(htmlFrameAllowedSnapshot(), first, 'unchanged content must keep the reference');
  assert.equal(notified, 1, 'a no-op report must not wake subscribers');
  // An entry with no layer never registers (the "宁可少挂" rule).
  const offBad = reportCardFrame({ id: 'reg/bad.html', layer: '', z: 1, visible: true });
  assert.equal(htmlFrameAllowedSnapshot().has('reg/bad.html'), false);
  offBad();
  // The STALE unregister must not evict the newer registration.
  offA();
  assert.equal(htmlFrameAllowedSnapshot().has('reg/a.html'), true, 'stale unregister evicted a live card');
  offA2();
  assert.equal(htmlFrameAllowedSnapshot().has('reg/a.html'), false);
  offA2();
  unsubscribe();
});

// ---------------------------------------------------------------------------
// §10.1 — source contracts
// ---------------------------------------------------------------------------

test('T1 sandbox is allow-scripts ONLY, and the file never spells the escape hatch', () => {
  const hits = mediaSrc.match(/sandbox="allow-scripts"/g) ?? [];
  assert.equal(hits.length, 1, 'exactly one sandbox literal');
  // Built from two halves so THIS test file is not a hit for V8's repo-wide grep.
  assert.ok(!mediaSrc.includes('allow-same-' + 'origin'), 'allow-same-origin removes the isolation');
});

test('T1/V8 no web source names the escape hatch (the grep V8 runs)', () => {
  const webSrc = path.join(webRoot, 'src');
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (fs.readFileSync(full, 'utf8').includes('allow-same-' + 'origin')) offenders.push(full);
    }
  };
  walk(webSrc);
  assert.deepEqual(offenders, []);
});

test('T2 V10 the budget constant is defined once, in one module, with value 6', () => {
  const definition = /HTML_CARD_IFRAME_BUDGET\s*=\s*6\b/;
  assert.match(budgetSrc, definition);
  const roots = [path.join(webRoot, 'src'), path.join(repoRoot, 'packages/shared/src')];
  const holders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name) && definition.test(fs.readFileSync(full, 'utf8'))) holders.push(full);
    }
  };
  roots.forEach(walk);
  assert.equal(holders.length, 1, `the constant must live in exactly one module: ${holders.join(', ')}`);
});

test('T3 the card-frame rule removes pointer events', () => {
  const start = cssSrc.indexOf('.html-media--card .html-media__frame');
  assert.notEqual(start, -1, 'the card frame rule moved');
  const rule = cssSrc.slice(start, cssSrc.indexOf('}', start));
  assert.match(rule, /pointer-events:\s*none/);
  // …and the live view does NOT: the second layer is where the page is usable.
  const detailStart = cssSrc.indexOf('.html-media--detail .html-media__frame');
  assert.notEqual(detailStart, -1, 'the detail frame rule moved');
  assert.doesNotMatch(cssSrc.slice(detailStart, cssSrc.indexOf('}', detailStart)), /pointer-events:\s*none/);
});

test('T4 CardRenderer keys html off the virtual frontmatter type and never imports isHtmlPath', () => {
  assert.match(rendererSrc, /frontmatter\?\.type === 'html'/);
  assert.doesNotMatch(rendererSrc, /isHtmlPath/);
  assert.match(rendererSrc, /import \{ HtmlCard \} from '\.\.\/html\/HtmlCard\.js'/);
});

test('T4b the html branch is LAST, so no earlier branch can claim a page', () => {
  const htmlBranch = rendererSrc.indexOf("frontmatter?.type === 'html'");
  const noteFallback = rendererSrc.indexOf('const noteTitle =');
  const photoBranch = rendererSrc.indexOf("frontmatter?.component === 'photo'");
  const chalkBranch = rendererSrc.indexOf("frontmatter?.type === 'chalk'");
  assert.ok(htmlBranch !== -1 && noteFallback !== -1 && photoBranch !== -1 && chalkBranch !== -1, 'renderer anchors moved');
  assert.ok(photoBranch < htmlBranch, 'the page branch must follow the photo branch');
  assert.ok(chalkBranch < htmlBranch, 'the page branch must follow the chalk branch');
  assert.ok(htmlBranch < noteFallback, 'the page branch must precede the default note fallback');
});

test('T5 the second layer sits between the photo dialog and the generic reader', () => {
  const photo = objectSrc.indexOf('reading && isPhoto ?');
  const html = objectSrc.indexOf('reading && isHtml ?');
  // The generic reader is the card's focus view.
  const generic = objectSrc.indexOf('reading && !isPhoto && !isHtml && (');
  assert.ok(photo !== -1 && html !== -1 && generic !== -1, 'the reading chain anchors moved');
  assert.ok(photo < html, 'the page branch must follow the photo branch');
  assert.ok(html < generic, 'the page branch must precede the generic reader');
  // One criterion in both files — the face and the reader can never disagree.
  assert.match(objectSrc, /const isHtml = item\.frontmatter\?\.type === 'html'/);
  assert.match(objectSrc, /isPhoto \|\| isHtml/);
});

test('T6 the budget ranks by seat order and never reads the DOM', () => {
  assert.match(budgetSrc, /a\.z - b\.z/, 'the ranking must come from item.z');
  assert.doesNotMatch(budgetSrc, /querySelectorAll/);
  // The gate WIRING, which no rule test can reach: a card is live only when the
  // observer says visible AND the registry ranks it inside the budget. Without
  // this line the seventh card mounts a frame — the "implemented but never
  // wired" failure the design notes calls out by name. (The subscribe side is
  // wrapped by a probe counter; the SNAPSHOT getter must stay the registry's
  // own function so the gate keeps reading the budget, never the DOM.)
  assert.match(cardSrc, /const allowed = useSyncExternalStore\(subscribeBudget, htmlFrameAllowedSnapshot, htmlFrameAllowedSnapshot\)/);
  assert.match(cardSrc, /subscribeHtmlBudget\(\(\) => \{\s*probeCount\('budgetNotify'\);\s*onStoreChange\(\);/);
  assert.match(cardSrc, /const active = visible && allowed\.has\(item\.path\)/);
  assert.match(cardSrc, /reportCardFrame\(\{ id: item\.path, layer, z, visible \}\)/);
  assert.match(cardSrc, /IntersectionObserver/);
  // `layer` / `z` / `w` are explicit props all the way down — never a DOM read.
  assert.match(objectSrc, /layer: string/);
  assert.match(canvasSrc, /layer=\{currentLayer\}/);
  assert.match(objectSrc, /w=\{item\.w\}/);
  assert.match(objectSrc, /z=\{item\.z\}/);
  assert.match(rendererSrc, /w=\{w\}/);
});

test('T7 the second layer reuses the photo family mechanisms, one for one', () => {
  // The dialog portals to `body` and returns null without a document, so it
  // cannot be server-rendered (apps/web/test/character-rail.test.mjs:8-10: no
  // jsdom in this repo). The eight mechanisms are pinned at source level.
  assert.match(detailSrc, /createPortal\(/);
  assert.match(detailSrc, /document\.body/);
  assert.match(detailSrc, /typeof document === 'undefined'\) return null/);
  assert.match(detailSrc, /registerSurface\(\{/);
  assert.match(detailSrc, /owner: 'workspace'/);
  assert.match(detailSrc, /priority: 340/);
  assert.match(detailSrc, /key: `html:\$\{item\.path\}`/);
  assert.match(detailSrc, /lease\.markClosing\(\)/);
  assert.match(detailSrc, /returnFocusRef\?\.current/);
  assert.match(detailSrc, /event\.target === event\.currentTarget/);
  assert.match(detailSrc, /role="dialog"/);
  assert.match(detailSrc, /aria-modal="true"/);
  assert.match(detailSrc, /aria-labelledby=\{titleId\}/);
  assert.match(detailSrc, /tabIndex=\{-1\}/);
  assert.match(detailSrc, /FOCUSABLE/);
  assert.match(detailSrc, /getClientRects\(\)\.length > 0/);
  assert.match(detailSrc, /\{\.\.\.appearance\?\.attrs\}/);
  assert.match(detailSrc, /variant="detail"/);
  // Named export: M10M11's bag dispatch imports it by name.
  assert.match(detailSrc, /export function HtmlDetailDialog/);
  assert.doesNotMatch(detailSrc, /export default/);
});

// ---------------------------------------------------------------------------
// §10.3 — the real tree (React's server renderer; no jsdom in this repo)
// ---------------------------------------------------------------------------

let React = null;
let renderToStaticMarkup = null;
let HtmlMedia = null;
let HtmlCard = null;
let reportCardFrame = null;
let htmlFrameAllowedSnapshot = null;
let skipRender = 'esbuild/react unavailable';
try {
  const esbuild = require(path.join(repoRoot, 'node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild/lib/main.js'));
  React = await import('react');
  ({ renderToStaticMarkup } = await import('react-dom/server'));
  const cacheDir = path.join(webRoot, 'node_modules/.cache');
  fs.mkdirSync(cacheDir, { recursive: true });

  // One entry re-exporting the components AND the registry, so the test drives
  // the very instance the rendered cards read (the registry is module state).
  // The entry lives under `node_modules/.cache`, never inside the source tree.
  const entryDir = path.join(cacheDir, 'airp-html-entry');
  fs.rmSync(entryDir, { recursive: true, force: true });
  fs.mkdirSync(entryDir, { recursive: true });
  const entry = path.join(entryDir, 'entry.ts');
  fs.writeFileSync(entry, [
    `export { HtmlMedia } from ${JSON.stringify(path.join(webRoot, 'src/components/html/HtmlMedia.tsx'))};`,
    `export { HtmlCard } from ${JSON.stringify(path.join(webRoot, 'src/components/html/HtmlCard.tsx'))};`,
    `export { reportCardFrame, htmlFrameAllowedSnapshot } from ${JSON.stringify(path.join(webRoot, 'src/lib/html-card-budget.ts'))};`,
    '',
  ].join('\n'), 'utf-8');
  const built = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: 'esm',
    jsx: 'automatic',
    loader: { '.css': 'empty' },
    external: ['react', 'react/jsx-runtime'],
    platform: 'node',
    absWorkingDir: webRoot,
  });
  const outFile = path.join(cacheDir, 'airp-html-entry.mjs');
  fs.writeFileSync(outFile, built.outputFiles[0].text, 'utf-8');
  ({ HtmlMedia, HtmlCard, reportCardFrame, htmlFrameAllowedSnapshot } = await import(pathToFileURL(outFile).href));
  fs.rmSync(outFile, { force: true });
  fs.rmSync(entryDir, { recursive: true, force: true });
  skipRender = false;
} catch (err) {
  console.error('render bootstrap unavailable, skipping render group:', err?.message ?? err);
}
const htmlItem = (over = {}) => ({
  path: 'world/a/puzzle.html',
  filename: 'puzzle.html',
  frontmatter: { type: 'html', title: 'Custom Puzzle', preview: '', design: 'desktop', ...over },
  body: '',
});

test('E1 the card face renders the page subtree, never the note/markdown one', { skip: skipRender }, () => {
  const markup = renderToStaticMarkup(React.createElement(HtmlMedia, {
    path: htmlItem().path,
    title: 'Custom Puzzle',
    preview: '',
    designWidth: 1280,
    cardWidth: 360,
    variant: 'card',
    active: true,
  }));
  assert.match(markup, /class="html-media html-media--card"/);
  assert.match(markup, /<iframe/);
  // The thumbnail is scaled to the card's painted width, pinned top-left.
  assert.match(markup, /transform:scale\(0\.28125\)/);
  assert.match(markup, /transform-origin:top left/);
  assert.match(markup, /aspect-ratio:16 \/ 9/);
  assert.match(markup, /src="\/api\/world-file\?path=world%2Fa%2Fpuzzle\.html"/);
});

test('E7 the mounted frame carries sandbox="allow-scripts" (DOM attribute, not grep)', { skip: skipRender }, () => {
  const markup = renderToStaticMarkup(React.createElement(HtmlMedia, {
    path: 'world/a/x.html', title: 'X', preview: '', designWidth: 1280, cardWidth: 360, variant: 'card', active: true,
  }));
  assert.match(markup, /sandbox="allow-scripts"/);
});

test('E3/E4 the inactive card degrades to a titled panel and mounts NO iframe', { skip: skipRender }, () => {
  const markup = renderToStaticMarkup(React.createElement(HtmlMedia, {
    path: 'world/a/x.html', title: 'Seventh Page', preview: '', designWidth: 1280, cardWidth: 360, variant: 'card', active: false,
  }));
  assert.doesNotMatch(markup, /<iframe/, 'an over-budget card must not mount a frame');
  assert.match(markup, /class="html-media html-media--card"/);
  assert.match(markup, /Seventh Page/);
  assert.match(markup, /data-html-state="static"/);
});

test('E5 an empty preview renders the title alone — no blank row, no placeholder', { skip: skipRender }, () => {
  const markup = renderToStaticMarkup(React.createElement(HtmlMedia, {
    path: 'world/a/x.html', title: 'Only A Title', preview: '', designWidth: 1280, cardWidth: 360, variant: 'card', active: false,
  }));
  assert.match(markup, /html-media__title">Only A Title</);
  assert.doesNotMatch(markup, /html-media__preview/);
  assert.doesNotMatch(markup, /\(none\)/);
});

test('E2 the detail variant is live: no pointer-events lock, mounted regardless of the gate', { skip: skipRender }, () => {
  const markup = renderToStaticMarkup(React.createElement(HtmlMedia, {
    path: 'world/a/x.html', title: 'X', preview: '', designWidth: 834, cardWidth: 360, variant: 'detail', active: false,
  }));
  assert.match(markup, /html-media--detail/);
  assert.match(markup, /<iframe/, 'the second layer is singular and never takes a budget slot');
  // The detail view renders at its OWN design width; the card scale is absent.
  assert.match(markup, /width:min\(834px, 90vw\)/);
  assert.doesNotMatch(markup, /transform:scale/);
});

test('E3/E4 seven real cards in one layer yield exactly six frames; the seventh keeps its panel', { skip: skipRender }, () => {
  // The whole chain, with the REAL registry: seven reports → one budget → the
  // `active` prop of each card. The server renderer runs no effects, so the
  // observer gate reads as visible (no `IntersectionObserver` in Node) and the
  // snapshot comes from the third `useSyncExternalStore` argument — which is
  // exactly the state the seventh card has to lose its frame in.
  const layer = 'E3-LAYER';
  const cards = Array.from({ length: 7 }, (_, i) => {
    const id = `world/a/p${i + 1}.html`;
    return { id, z: i + 1, element: React.createElement(HtmlCard, {
      key: `p${i + 1}`,
      item: { path: id, filename: `p${i + 1}.html`, frontmatter: { type: 'html', title: `Page ${i + 1}`, preview: '', design: 'desktop' }, body: '' },
      w: 360,
      layer,
      z: i + 1,
    }) };
  });
  const offs = cards.map(card => reportCardFrame({ id: card.id, layer, z: card.z, visible: true }));
  try {
    assert.equal(htmlFrameAllowedSnapshot().size, 6, 'the budget must admit exactly six');
    const markup = renderToStaticMarkup(React.createElement('div', null, cards.map(card => card.element)));
    const frames = (markup.match(/<iframe/g) ?? []).length;
    assert.equal(frames, 6, `seven in-view cards must mount six frames, got ${frames}`);
    // E4: the seventh still paints a titled panel — and, because the whole card
    // stays in the shell's click chain, it still opens the second layer.
    assert.equal((markup.match(/<figure class="html-card"/g) ?? []).length, 7);
    assert.equal((markup.match(/html-media--card/g) ?? []).length, 7);
    assert.match(markup, /data-html-state="static"/);
    assert.match(markup, /Page 7/);
  } finally {
    offs.forEach(off => off());
  }
  assert.equal(htmlFrameAllowedSnapshot().size, 0, 'unregister must release every slot');
});

test('E6 the card face is wrapped in the drag/drop seam the shell owns', { skip: skipRender }, () => {
  // The handlers live on the `figure`: dragging reaches `.object`, which is what
  // makes `pointer-events: none` on the frame load-bearing rather than cosmetic.
  const markup = renderToStaticMarkup(React.createElement(HtmlCard, {
    item: htmlItem(),
    w: 360,
    layer: 'L1',
    z: 1,
    onDragOver: () => {},
    onDrop: () => {},
  }));
  assert.match(markup, /<figure class="html-card"/);
  assert.match(markup, /aria-label="Custom Puzzle"/);
});
