import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const canvasSource = await readFile(new URL('../src/components/canvas/Canvas.tsx', import.meta.url), 'utf8');
const phantomSource = await readFile(new URL('../src/components/canvas/PhantomLayer.tsx', import.meta.url), 'utf8');
const indexCss = await readFile(new URL('../src/index.css', import.meta.url), 'utf8');
const propCardCss = await readFile(new URL('../src/components/canvas/prop-card.css', import.meta.url), 'utf8');
const gateThresholdCss = await readFile(new URL('../src/components/performance/gate-threshold.css', import.meta.url), 'utf8');

function ghostShell(source) {
  const match = source.match(/className="object--ghost"[\s\S]{0,260}?aria-hidden/);
  assert.ok(match, 'ghost producer must mark its shell aria-hidden');
  return match[0];
}

function uncomment(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function depthValues(css) {
  return [...uncomment(css).matchAll(/z-index\s*:\s*([^; }\n]+)/g)].map((match) => match[1]);
}

test('initial and tool-call ghost producers are hidden from assistive technology', () => {
  ghostShell(canvasSource);
  ghostShell(phantomSource);
});
test('ghost shell keeps pointer input disabled without an auto override', () => {
  const css = uncomment(indexCss);
  const shell = css.match(/\.object--ghost[^\{]*\{([\s\S]*?)\}/)?.[1];
  assert.ok(shell, 'canonical ghost shell selector must remain present');
  assert.match(shell, /pointer-events\s*:\s*none\s*;?/);
  assert.doesNotMatch(shell, /pointer-events\s*:\s*auto\b/);
  const descendants = css.match(/\.object--ghost\s*>\s*\*\s*\{([\s\S]*?)\}/)?.[1];
  assert.ok(descendants, 'ghost descendants must keep the non-interactive override');
  assert.match(descendants, /pointer-events\s*:\s*none\s*;?/);
  assert.doesNotMatch(descendants, /pointer-events\s*:\s*auto\b/);
});

test('owned stacking declarations consume semantic depth tokens', () => {
  for (const [file, css] of [
    ['index.css', indexCss],
    ['prop-card.css', propCardCss],
    ['gate-threshold.css', gateThresholdCss],
  ]) {
    const values = depthValues(css);
    assert.ok(values.length > 0, `${file} must retain its registered stacking declarations`);
    for (const value of values) {
      assert.match(value, /^var\(--depth-[a-z0-9-]+\)\s*(?:!important)?$/,
        `${file} has an unregistered numeric or compound z-index value: ${value}`);
    }
  }
});

test('depth registry bands preserve semantic stacking order', () => {
  const expected = {
    '--depth-background': '0',
    '--depth-world': '10',
    '--depth-entity': '20',
    '--depth-overlay': '30',
    '--depth-writer': '40',
    '--depth-modal': '50',
    '--depth-ui': '60',
  };
  for (const [token, value] of Object.entries(expected)) {
    assert.match(indexCss, new RegExp(`${token}\\s*:\\s*${value}\\s*;`), `${token} must stay registered`);
  }
  for (const alias of [
    '--depth-background-scene',
    '--depth-entity-base',
    '--depth-performance-root',
    '--depth-chrome-writer',
    '--depth-dialogue-root',
  ]) {
    assert.match(indexCss, new RegExp(`${alias}\\s*:\\s*var\\(--depth-`), `${alias} must use the registry`);
  }
});

test('Canvas depth markers keep semantic data values and mapper-owned classes', () => {
  for (const kind of ['background', 'world', 'entity', 'overlay']) {
    assert.match(canvasSource, new RegExp(`data-depth-surface=\\{DEPTH_KIND\\.${kind}\\}`));
    assert.match(canvasSource, new RegExp(`DEPTH_MARKER\\('${kind}'\\)`));
  }
  assert.match(canvasSource, /depthClassFor\(DEPTH_KIND\[kind\]\)/);
  assert.doesNotMatch(canvasSource, /data-depth-surface=\{DEPTH_MARKER/);
});