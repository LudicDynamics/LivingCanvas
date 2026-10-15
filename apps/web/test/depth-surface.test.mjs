import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';

const moduleSource = await readFile(new URL('../src/lib/depth-surface.ts', import.meta.url), 'utf8');
const indexCss = await readFile(new URL('../src/index.css', import.meta.url), 'utf8');
const sceneShellCss = await readFile(new URL('../src/scene-shell.css', import.meta.url), 'utf8');
const moduleUrl = `data:text/javascript;base64,${Buffer.from(ts.transpileModule(moduleSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText).toString('base64')}`;
const depth = await import(moduleUrl);

const expectedTokens = {
  background: '--depth-background',
  world: '--depth-world',
  overlay: '--depth-overlay',
  entity: '--depth-entity',
  writer: '--depth-writer',
  modal: '--depth-modal',
  ui: '--depth-ui',
};

test('depth surface registry maps every legal kind to one token and class', () => {
  assert.deepEqual([...depth.DEPTH_SURFACE_KINDS], Object.keys(expectedTokens));
  for (const [kind, token] of Object.entries(expectedTokens)) {
    assert.deepEqual(depth.depthSurface(kind), {
      kind,
      token,
      className: `depth-surface--${kind}`,
    });
    assert.equal(depth.depthTokenFor(kind), token);
    assert.equal(depth.depthClassFor(kind), `depth-surface--${kind}`);
  }
});

test('unknown depth surface kinds are rejected instead of coerced', () => {
  for (const unknown of [undefined, null, '', 'stage', 'performance', {}, 2]) {
    assert.throws(() => depth.depthSurface(unknown), RangeError);
    assert.throws(() => depth.depthTokenFor(unknown), RangeError);
    assert.throws(() => depth.depthClassFor(unknown), RangeError);
  }
});

test('registry bands are strictly monotonic and performance stays below modal', () => {
  const values = Object.fromEntries(Object.entries(expectedTokens).map(([kind, token]) => {
    const match = indexCss.match(new RegExp(`${token}\\s*:\\s*(\\d+)\\s*;`));
    assert.ok(match, `${token} must have one numeric registry value`);
    return [kind, Number(match[1])];
  }));
  const order = depth.depthSurfaceOrder();
  for (let index = 1; index < order.length; index += 1) {
    assert.ok(values[order[index]] > values[order[index - 1]], `${order[index - 1]} must precede ${order[index]}`);
  }
  assert.ok(values.overlay < values.modal, 'performance/overlay must never cross modal');
  assert.ok(values.modal < values.ui, 'ui must remain above modal');
  assert.match(sceneShellCss, /\.depth-surface--ui\s*\{\s*z-index:\s*var\(--depth-ui\)/);
  assert.match(sceneShellCss, /\.depth-layer--phantom\s*\{\s*z-index:\s*var\(--depth-overlay\)/);
  assert.match(sceneShellCss, /\.depth-layer--performance\s*\{\s*z-index:\s*var\(--depth-overlay-performance\)/);
  assert.match(sceneShellCss, /\.depth-layer--character\s*\{\s*z-index:\s*var\(--depth-modal\)/);
  assert.match(sceneShellCss, /\.depth-layer--dialogue\s*\{\s*z-index:\s*var\(--depth-modal-dialogue\)/);
});

test('scene shell depth declarations consume registry variables', () => {
  const css = sceneShellCss.replace(/\/\*[\s\S]*?\*\//g, '');
  const declarations = [...css.matchAll(/z-index\s*:\s*([^;}]*)/g)].map((match) => match[1].trim());
  assert.ok(declarations.length > 0);
  for (const value of declarations) {
    assert.match(value, /^var\(--depth-[a-z0-9-]+\)(?:\s*!important)?$/);
  }
});
