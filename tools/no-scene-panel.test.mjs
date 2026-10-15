import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
const source = path => readFileSync(new URL(`../apps/web/src/${path}`, import.meta.url), 'utf8');
test('canvas has one entity path and no fixed scene panel', () => {
  assert.equal(existsSync(new URL('../apps/web/src/components/narrative/SceneChalk.tsx', import.meta.url)), false);
  for (const path of ['components/canvas/Canvas.tsx', 'App.tsx', 'components/nook/NookView.tsx']) assert.doesNotMatch(source(path), /SceneChalk|sceneCopy/);
  assert.doesNotMatch(source('index.css'), /\.scene-chalk/);
  assert.match(source('components/canvas/Canvas.tsx'), /<CanvasObject/);

  const card = source('components/canvas/CardRenderer.tsx');
  const chalkStart = card.indexOf("if (frontmatter?.type === 'chalk')");
  const chalkEnd = card.indexOf('\n  // 2. Gate Card', chalkStart);
  assert.ok(chalkStart >= 0 && chalkEnd > chalkStart, 'canvas must retain its Chalk entity branch');
  // The single entity path must still render the actual ChalkCard, not a
  // fixed scene-panel substitute; multiline JSX is intentional here.
  assert.match(card.slice(chalkStart, chalkEnd), /return <ChalkCard\b[\s\S]*\bitem=\{item\}/);
});
