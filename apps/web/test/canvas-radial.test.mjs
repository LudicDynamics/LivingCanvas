// The right-click / long-press radial on blank canvas
// Right-click, long-press always open the ONE radial;
// its satellites come from `radialItemsFor(category, authoring)`:
//   authoring → creators + 便签; free / story / no category play → creators + 便签;
//   TRPG play → 便签 / 线索板 / 写行动 / 要提示, no creators.
// The pure table runs through jiti; RadialMenu and StickyNote render with
// React's server renderer (esbuild bundle, nothing written in src); App /
// Canvas wiring as source contracts.
// Run: node --test apps/web/test/canvas-radial.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..');
const repoRoot = path.resolve(webRoot, '../..');
const read = (rel) => fs.readFileSync(path.join(webRoot, rel), 'utf8');
const require = createRequire(pathToFileURL(path.join(webRoot, 'test/x.mjs')));

const jiti = createJiti(import.meta.url, { moduleCache: false });
const items = await jiti.import('../src/lib/radial-items.ts');
const app = read('src/App.tsx');
const clue = read('src/components/canvas/ClueBoard.tsx');
const canvas = read('src/components/canvas/Canvas.tsx');
const messages = JSON.parse(read('src/lib/messages.json'));

let React = null;
let renderToStaticMarkup = null;
let mod = null;
try {
  const esbuild = require(path.join(repoRoot, 'node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild/lib/main.js'));
  React = await import('react');
  ({ renderToStaticMarkup } = await import('react-dom/server'));
  const out = await esbuild.build({
    stdin: {
      contents: "export { RadialMenu } from './src/components/god/RadialMenu.tsx'; export { StickyNote } from './src/components/canvas/StickyNote.tsx';",
      resolveDir: webRoot,
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'esm',
    jsx: 'automatic',
    loader: { '.css': 'empty' },
    external: ['react', 'react/jsx-runtime', 'react-dom', 'lucide-react'],
    platform: 'node',
    absWorkingDir: webRoot,
  });
  const cacheDir = path.join(webRoot, 'node_modules/.cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  const dir = fs.mkdtempSync(path.join(cacheDir, 'airp-radial-'));
  const file = path.join(dir, 'radial.mjs');
  fs.writeFileSync(file, out.outputFiles[0].text, 'utf-8');
  try { mod = await import(pathToFileURL(file).href); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
} catch (err) {
  console.error('render bootstrap unavailable, skipping group:', err?.message ?? err);
}
const skip = mod ? false : 'esbuild/react unavailable';

test('radialItemsFor: TRPG play gets only the player tools; free / story / none play get the creators + 线索板 + 便签; authoring the creators + 便签', () => {
  const creators = ['gate', 'character', 'clue', 'chalk'];
  assert.deepEqual(items.radialItemsFor('trpg', false), { creators: [], tools: ['note', 'board', 'write', 'hint'], mode: 'play' });
  // No standing 「便签 · 线索板」 pill: the radial is where both live in every play category.
  for (const category of ['free', 'story', null, undefined]) {
    assert.deepEqual(items.radialItemsFor(category, false), { creators, tools: ['board', 'note'], mode: 'play' }, String(category));
  }
  for (const category of ['trpg', 'free', 'story', null]) {
    assert.deepEqual(items.radialItemsFor(category, true), { creators, tools: ['note'], mode: 'authoring' }, String(category));
  }
  // 便签 is never missing, and never first while creators are present.
  assert.equal(items.radialItemsFor('story', false).tools.at(-1), 'note');
});

test('radialAngles: evenly round the hub, the first on top; four keep the old cross', () => {
  assert.deepEqual(items.radialAngles(4), [-90, 0, 90, 180]);
  assert.deepEqual(items.radialAngles(5), [-90, -18, 54, 126, 198]);
});

test('App: right-click and long-press both open the radial; right-click no longer drops a note directly', () => {
  assert.match(app, /onOpenRadialMenu=\{openRadial\}/);
  assert.match(app, /onLongPress=\{openRadial\}/);
  assert.doesNotMatch(app, /if \(attention !== 'authoring'\) \{ clueBoard\.openNoteAt/);
  assert.match(app, /const radialItems = radialItemsFor\(worldCategoryIdOf\(manifest\), attention === 'authoring'\);/);
  const open = app.match(/const openRadial = [\s\S]*?\n  \};/)[0];
  assert.match(open, /overlayAdmission\.request\('radial', 'workspace'\)/, 'admission as before');
  assert.doesNotMatch(open, /attention/, 'no mode gate: the menu always opens');
  assert.match(app, /creators=\{radialItems\.creators\} tools=\{radialItems\.tools\}/);
  // the tools route to the clue board / writer
  assert.match(app, /tool === 'note'\) clueBoard\.openNoteAt\(x, y, worldX, worldY\)/);
  assert.match(app, /tool === 'board'\) clueBoard\.toggleBoard\(\)/);
  assert.match(app, /tool === 'hint'\) prepareWriterHint\(\)/);
  // a creation says where it came from: the server gates TRPG play
  assert.match(app, /godAction\('create', filePath, [^;]*, radialItems\.mode\)/);
  // the note composer also opens while authoring
  assert.match(app, /notesEnabled: boardCanvas/);
  assert.match(clue, /notesEnabled && pop\?\.kind === 'note'/);
  assert.doesNotMatch(clue, /onLongPress/, 'long-press belongs to the radial now');
  // N key stays a note; Canvas still arms long-press only when given a handler
  assert.match(clue, /key === NOTE_KEY\) \{ e\.preventDefault\(\); noteAtCentre\(\); \}/);
  // No standing 「便签 N · 线索板 B」 pill — radial + N / B only.
  assert.doesNotMatch(clue, /className="clue-toolbar"/);
  assert.match(clue, /key === BOARD_KEY\) \{ e\.preventDefault\(\); setBoardMode/);
  assert.match(canvas, /e\.pointerType === 'touch' && onLongPress/);
});

// RadialMenu keeps itself inside the viewport: give the server render one.
globalThis.window ??= { innerWidth: 1440, innerHeight: 900 };
const baseProps = { x: 400, y: 300, worldX: 10, worldY: 20, onClose() {}, onCreate() {}, onTool() {} };
const itemsOf = (html) => [...html.matchAll(/data-radial-item="([a-z]+)"/g)].map((m) => m[1]);

test('RadialMenu renders the TRPG player wheel: 便签 / 线索板 / 写行动 / 要提示, no creators', { skip }, () => {
  const html = renderToStaticMarkup(React.createElement(mod.RadialMenu, { ...baseProps, ...items.radialItemsFor('trpg', false), boardOn: true }));
  assert.deepEqual(itemsOf(html), ['note', 'board', 'write', 'hint']);
  assert.match(html, /data-radial-menu="player"/);
  assert.match(html, /role="menu"/);
  assert.match(html, /data-radial-item="board"[^>]*aria-pressed="true"/);
});

test('RadialMenu renders the studio wheel in free / story play and authoring: four creators, 便签 last', { skip }, () => {
  for (const [cat, authoring] of [['free', false], ['story', false], [null, false], ['trpg', true]]) {
    const html = renderToStaticMarkup(React.createElement(mod.RadialMenu, { ...baseProps, ...items.radialItemsFor(cat, authoring) }));
    assert.deepEqual(itemsOf(html), ['gate', 'character', 'clue', 'chalk', ...(authoring ? [] : ['board']), 'note'], `${cat}/${authoring}`);
    assert.match(html, /data-radial-menu="studio"/);
  }
});

test('every radial label and sub line is translated in zh-CN / ja / ko', () => {
  const src = read('src/components/god/RadialMenu.tsx');
  const keys = [...src.matchAll(/(?:label|sub|placeholder): '((?:[^'\\]|\\.)+)'/g)].map((m) => m[1].replace(/\\'/g, "'"));
  assert.ok(keys.length >= 20, `found ${keys.length}`);
  for (const key of [...keys, 'World Studio', 'Your tools', 'On — tap to leave']) {
    for (const loc of ['zh-CN', 'ja', 'ko']) assert.ok(messages[key]?.[loc], `${key} → ${loc}`);
  }
});


// ---- the note card ----------------
const note = (frontmatter, body = '钟楼的钟慢了七分钟') => ({
  path: 'world/inn/player-note-1.md',
  filename: 'player-note-1.md',
  frontmatter: { type: 'player-note', ...frontmatter },
  body,
});

test('StickyNote renders a paper slip: tone class, size class, tape, foot line, text, edit button', { skip }, () => {
  const html = renderToStaticMarkup(React.createElement(mod.StickyNote, { item: note({ color: 'pink', size: 'l' }) }));
  assert.match(html, /class="sticky sticky--pink sticky--size-l"/);
  assert.match(html, /data-sticky-note="world\/inn\/player-note-1\.md"/);
  assert.match(html, /class="sticky__tape"/);
  assert.match(html, /class="sticky__stamp"/);
  assert.match(html, /<div class="sticky__text">钟楼的钟慢了七分钟<\/div>/);
  assert.match(html, /class="sticky__edit"/);
  // unknown stored values fall back to the parchment tone, medium size
  const odd = renderToStaticMarkup(React.createElement(mod.StickyNote, { item: note({ color: 'neon', size: 'xxl' }) }));
  assert.match(odd, /class="sticky sticky--yellow sticky--size-m"/);
});

test('note paper is the canvas material: ivory texture, ux tokens, card face font, tones mixed from canvas colours', () => {
  const css = read('src/components/canvas/player-board.css');
  const sticky = css.match(/\n\.sticky \{[\s\S]*?\n\}/)[0];
  assert.match(sticky, /url\('\/materials\/ivory-paper-v1\.webp'\)/, 'the same paper as .paper-reading');
  assert.match(sticky, /var\(--ux-font-human\)/, 'the card face font, not the chalk hand');
  assert.match(sticky, /border: 1px solid var\(--ux-color-line\)/);
  assert.match(sticky, /box-shadow: var\(--ux-shadow-soft\)/);
  assert.doesNotMatch(sticky, /#[0-9a-f]{3,8}\b/i, 'no raw neon post-it colour on the card itself');
  for (const [tone, token] of [['pink', 'rust'], ['blue', 'blue'], ['green', 'sage']]) {
    assert.match(css, new RegExp(`\\.sticky--${tone}[^{]*\\{ --sticky-tone: color-mix\\(in srgb, var\\(--ux-color-cream\\) \\d+%, var\\(--ux-color-${token}\\)\\); \\}`));
  }
  assert.ok(fs.existsSync(path.join(webRoot, 'public/materials/ivory-paper-v1.webp')), 'the texture ships in the repo');
  for (const key of ['Parchment', 'Rose paper', 'Mist paper', 'Sage paper']) {
    for (const loc of ['zh-CN', 'ja', 'ko']) assert.ok(messages[key]?.[loc], `${key} → ${loc}`);
  }
});
