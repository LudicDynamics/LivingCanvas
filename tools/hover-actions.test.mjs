import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LocalWorldStore } from '../packages/shared/dist/store/local-store.js';

test('collecting an item cannot overwrite a same-name item already in the bag', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-move-test-'));
  const store = new LocalWorldStore(root);
  try {
    await fs.mkdir(path.join(root, 'world'));
    await fs.mkdir(path.join(root, 'player'));
    await fs.writeFile(path.join(root, 'world/key.md'), 'New key');
    await fs.writeFile(path.join(root, 'player/key.md'), 'Existing key');
    await assert.rejects(store.move('world/key.md', 'player/key.md'), { code: 'EEXIST' });
    assert.equal(await store.readFile('world/key.md'), 'New key');
    assert.equal(await store.readFile('player/key.md'), 'Existing key');
  } finally { store.close(); await fs.rm(root, { recursive: true, force: true }); }
});

test('hover controls float outside the entity and use a transparent container', async () => {
  const css = await fs.readFile(new URL('../apps/web/src/scene-shell.css', import.meta.url), 'utf8');
  assert.match(css, /entity-interactions \{ position: absolute; left: 100%;/);
  assert.match(css, /object:hover > \.entity-interactions/);
  assert.match(css, /entity-interactions \.fm-body \{[^}]*background: transparent/);
  const code = await fs.readFile(new URL('../apps/web/src/components/narrative/EntityInteractions.tsx', import.meta.url), 'utf8');
  // the design notes P2: the authoritative request moved into the shared hook so the
  // card panel and the left rail answer a click the same way. The panel keeps
  // the hover placement logic below; it now *uses* the action instead of
  // implementing it, and still never reaches the gateway directly.
  assert.match(code, /runAction\s*\(/);
  assert.match(code, /useDeclaredChoice\(\{/);
  assert.doesNotMatch(code, /airpGateway\.(choose|move)\(/);
  assert.match(code, /setSide\(best.side\)/);
  assert.match(code, /side: 'below'/);
  assert.match(code, /candidate.side === placement/);
  assert.doesNotMatch(code, /observer.observe\(el\)/);
  assert.doesNotMatch(code, /addEventListener\('pointermove'/);
});

test('canvas uses the merged action and event contracts', async () => {
  const read = file => fs.readFile(new URL(`../apps/web/src/${file}`, import.meta.url), 'utf8');
  assert.match(await read('lib/airp-gateway.ts'), /choose:[\s\S]*\/api\/choice/);
  assert.match(await read('components/narrative/DiceRoller.tsx'), /path: filePath/);
  assert.match(await read('state/useWorld.ts'), /case 'world_event':/);
  const widgets = await read('lib/fm.tsx');
  assert.match(widgets, /visibleChoiceOptions\(interactive.choice\)/);
  assert.match(widgets, /choice.id \?\? choice.label/);
});

/**
 * The hover lift must be driven by the stationary `.object` shell, never by the
 * card that moves. `.gate:hover` / `.letter:hover` applying `transform` is
 * self-referential: the lift pulls the card's own edge out from under a pointer
 * resting in that strip, so the pointer alternately lands inside and outside,
 * and the card (plus its floating detail sheet) flashes. A probe parked on a
 * real card measured 15 sheet toggles / 90 with the old rules vs 0 / 90 with
 * `.object:hover` driving it.
 */
test('hover lift is driven by the stationary shell, not by the card that moves', async () => {
  const css = await fs.readFile(new URL('../apps/web/src/index.css', import.meta.url), 'utf8');
  const blocks = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(match => ({ selector: match[1].trim(), body: match[2] }));
  const displacing = blocks.filter(({ body }) => /transform:\s*(?!none)[^;]*translate/.test(body));
  for (const rule of displacing) {
    const selectors = rule.selector.split(',').map(part => part.trim().replace(/\s+/g, ' '));
    for (const selector of selectors) {
      // A rule on a card itself (or its `:hover`) moves the element that owns the
      // hover state; the compound `.object:hover .gate` form is the safe one.
      const targetsCard = /(^|[ >])\.(gate|letter|note|chalk)(--[\w-]+)?(:hover|:focus-within)?\s*$/.test(selector);
      if (!targetsCard) continue;
      assert.ok(
        !/:hover\s*$/.test(selector),
        `${selector} owns :hover and displaces itself — move the rule to .object:hover ${selector.split(':')[0]}`,
      );
    }
  }
  // The safe form is actually present for the two cards that lift.
  assert.match(css, /\.object:hover \.gate,\s*\n\.object:focus-within \.gate \{/);
  assert.match(css, /\.object:hover \.letter,\s*\n\.object:focus-within \.letter \{/);
  // The place's hover detail sheet is gone: its full text is read in the
  // card's focus view.
  assert.doesNotMatch(css, /gate__detail/);
});
