// Phone / tablet layout checks for headers, selects, launcher pills and tabs.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const shell = await read('../src/scene-shell.css');
const launcher = await read('../src/components/world-launcher.css');
const create = await read('../src/components/create-world.css');
const art = await read('../src/components/chrome/workshop-art.css');

/** Body of the last `@media (<query>) { … }` block (balanced braces). */
function media(css, query) {
  const at = css.lastIndexOf(`@media ${query}`);
  assert.notEqual(at, -1, `missing @media ${query}`);
  let depth = 0;
  for (let i = css.indexOf('{', at); i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(css.indexOf('{', at) + 1, i);
  }
  throw new Error('unbalanced');
}

/** Declarations of the rule whose selector list contains `selector` inside `css`. */
function rule(css, selector) {
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (const [, sel, body] of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(re)) {
    if (sel.split(',').map((s) => s.trim()).includes(selector)) return body;
  }
  assert.fail(`no rule for ${selector}`);
}

test('narrow header: pills never shrink or wrap, and the row scrolls instead', () => {
  const narrow = media(shell, '(max-width: 1180px)');
  assert.match(rule(narrow, '.prototype-worldtop > *'), /flex-shrink:\s*0/);
  assert.match(rule(narrow, '.prototype-worldtop button'), /white-space:\s*nowrap/);
});

test('narrow header: its sheets escape the scroller instead of being clipped by it', () => {
  const narrow = media(shell, '(max-width: 1180px)');
  // The sheets pin to the viewport…
  const sheets = rule(narrow, '.prototype-worldtop .contact-panel__sheet');
  assert.equal(rule(narrow, '.prototype-worldtop .agent-settings-panel'), sheets);
  assert.match(sheets, /position:\s*fixed/);
  assert.match(sheets, /width:\s*min\(350px,\s*calc\(100vw - 24px\)\)/);
  // …which requires the header not to be their containing block: no transform
  // while shown and no backdrop filter, including under the blur tiers.
  assert.match(rule(narrow, '.has-header .prototype-worldtop'), /transform:\s*none/);
  const surface = rule(narrow, ':root[data-airp-blur] .prototype-worldtop');
  assert.match(surface, /backdrop-filter:\s*none/);
  assert.match(surface, /-webkit-backdrop-filter:\s*none/);
  // The narrow block must come after the blur tiers it overrides.
  assert.ok(shell.lastIndexOf(':root[data-airp-blur="reduced"] .prototype-worldtop') < shell.lastIndexOf('@media (max-width: 1180px)'));
  // An open sheet lifts the header over the rails.
  assert.match(narrow, /\.prototype-worldtop:has\(\.contact-panel__sheet, \.agent-settings-panel\)\s*\{\s*z-index:\s*var\(--depth-chrome-world-panel\)/);
});

test('phones: touch form controls are at least 16px so iOS does not zoom on focus', () => {
  const phone = media(shell, '(max-width: 700px) and (pointer: coarse)');
  for (const scope of ['.airp-prototype', '.create-world', '.prototype-dialog-backdrop']) {
    assert.match(phone, new RegExp(`\\${scope} select`), `${scope} select`);
    assert.match(phone, new RegExp(`\\${scope} textarea`), `${scope} textarea`);
  }
  assert.match(phone, /font-size:\s*max\(16px,\s*1em\)/);
  // Checkboxes, radios, sliders and file pickers keep their own size.
  assert.match(phone, /input:not\(\[type='checkbox'\]\):not\(\[type='radio'\]\):not\(\[type='range'\]\):not\(\[type='file'\]\)/);
});


test('phones: launcher pills are compact, unwrapped and still finger-sized', () => {
  const phone = media(launcher, '(max-width: 700px)');
  const pill = rule(phone, '.world-launcher__pill');
  assert.equal(rule(phone, '.world-launcher__top .performance-settings-trigger--launcher'), pill);
  assert.match(pill, /min-height:\s*36px/);
  assert.match(pill, /white-space:\s*nowrap/);
  assert.match(pill, /letter-spacing:\s*\.08em/);
});

test('phones: segmented tabs in the create form wrap as rounded rectangles, 40px tall', () => {
  const phone = media(create, '(max-width: 520px)');
  const seg = rule(phone, '.create-world__tabs button');
  assert.equal(rule(phone, '.create-world__langs button'), seg);
  assert.match(seg, /min-height:\s*40px/);
  assert.match(seg, /border-radius:\s*13px/);
  assert.match(rule(phone, '.create-world__panel'), /padding:\s*20px 18px/);
});

test('phones: the workshop panel tabs and switches are thumb-sized', () => {
  const phone = media(art, '(max-width: 640px)');
  assert.match(rule(phone, '.workshop-art__close'), /min-height:\s*36px/);
  assert.match(rule(phone, '.workshop-art__switch'), /flex-wrap:\s*wrap/);
});

test('narrow screens: the options rail stays a left vertical rail with a grip; Esc folds a tapped-open rail', async () => {
  const tsx = await read('../src/components/sidebar/ChoiceRail.tsx');
  assert.doesNotMatch(tsx, /choice-rail-sheet|choice-rail__summary|createPortal/, 'no phone bottom sheet');
  assert.match(tsx, /className="choice-rail__grip"\s+aria-expanded=\{pinned\}/);
  assert.match(tsx, /if \(event\.key !== 'Escape' \|\| !pinned\) return;[\s\S]{0,80}setPinned\(false\)/);
  const css = await read('../src/components/sidebar/choice-rail.css');
  assert.doesNotMatch(css, /choice-rail-sheet|choice-rail__summary/);
});
