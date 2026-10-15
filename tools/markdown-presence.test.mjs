import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = file => readFile(new URL(`../apps/web/src/${file}`, import.meta.url), 'utf8');
test('chalk uses the shared safe Markdown renderer', async () => {
  const code = await read('components/narrative/ChalkCard.tsx');
  // `narrative` is the body with a resolved dice outcome folded in; it still goes through MarkdownText.
  assert.match(code, /<MarkdownText text=\{(?:body|narrative)\}/);
  assert.doesNotMatch(code, /dangerouslySetInnerHTML/);
});
test('presence uses the shared projection and renders stable character ids without cards', async () => {
  const code = await read('components/canvas/PresenceLayer.tsx');
  assert.match(code, /presence\.filter\(\(view\) => view\.state === 'in-scene'/);
  assert.match(code, /view\.avatar/);
  assert.match(code, /onOpenCharacterModal\(view\.id\)/);
  assert.match(code, /view\.id\.charAt\(0\)/);
  assert.doesNotMatch(code, /className="object"/);
});
test('body tooltip is removed while dialogue close keeps its safe offset', async () => {
  const css = await read('scene-shell.css');
  assert.doesNotMatch(css, /markdown-chalk-preview/);
  assert.match(css, /character-modal-layer \.modal-close \{ top: max\(84px/);
});
test('every Markdown form renders its interaction widgets exactly once', async () => {
  // Canvas cards: EntityInteractions is the single footer (CanvasObject mounts
  // it over the card body).
  assert.match(await read('components/canvas/CanvasObject.tsx'), /<EntityInteractions item=\{item\}/);
  // ChalkCard retains an explicit widget seam for standalone callers, while
  // the inline canvas branch delegates to EntityInteractions and MUST NOT also
  // receive those handlers (no double footer).
  assert.match(await read('components/narrative/ChalkCard.tsx'), /renderFrontmatterWidgets/);

  const card = await read('components/canvas/CardRenderer.tsx');
  const chalkStart = card.indexOf("if (frontmatter?.type === 'chalk')");
  const chalkEnd = card.indexOf('\n  // 2. Gate Card', chalkStart);
  assert.ok(chalkStart >= 0 && chalkEnd > chalkStart, 'CardRenderer must keep a dedicated Chalk branch');
  const chalk = card.slice(chalkStart, chalkEnd);
  // Keep this tolerant of multiline JSX while requiring the real item,
  // appearance, and target-drop wiring; this catches a fallback card that
  // silently loses verified styling or material-combination targets.
  assert.match(chalk, /return <ChalkCard\b[\s\S]*\/>;/);
  assert.match(chalk, /\bitem=\{item\}/);
  assert.match(chalk, /\bappearance=\{appearance\}/);
  assert.match(chalk, /\bpuzzleClasses=\{puzzleClasses\}/);
  assert.match(chalk, /onDragOver=\{[\s\S]*setIsDragOver\(true\)/);
  assert.match(chalk, /onDragLeave=\{\(\) => setIsDragOver\(false\)\}/);
  assert.match(chalk, /onDrop=\{handleTargetDrop\}/);
  assert.doesNotMatch(chalk, /onSelectChoice|onDiceRolled/);

  const code = await read('components/narrative/EntityInteractions.tsx');
  assert.match(code, /JSON.stringify\(item.path\)/);
  assert.match(code, /filePath: item.path/);
});
