/**
 * H1-M1 acceptance: the `html` kind's derivation, footprint row, and the three
 * scan surfaces.
 *
 * Imports the built barrel (`dist/index.js`) so the component-kind resolver is
 * registered exactly as the server / extensions see it (contract §5.3b-1).
 * Build first:
 *   pnpm --filter @airp/shared build
 * then
 *   node --test packages/shared/test/forms-html.test.mjs
 *
 * T1–T8 / T11–T14 live here (U6 ruling: one new file, no hunk in the frozen
 * `components.test.mjs`). T9 / T10 are render-side and live in
 * `apps/web/test/card-skeleton.test.mjs`.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  CARD_FORMS,
  COMPONENT_KINDS,
  COMPONENT_REGISTRY,
  LocalWorldStore,
  bagLine,
  cardFormOf,
  cardKindOf,
  cardsOfLayer,
  characterRootConfigOf,
  listBackpack,
  nookCardPaths,
  nookSceneCards,
  resolveComponentKind,
  seatFileOf,
} from '../dist/index.js';

const HTTP_LINE =
  '<!DOCTYPE html><html><head><title>Bag page</title></head><body>y</body></html>';

// ------------------------------------------------------------------ T1 (V2)

test('T1: CARD_FORMS.html is the frozen row (label/w/h/chrome)', () => {
  assert.deepEqual(CARD_FORMS.html, {
    label: 'Web page',
    w: 360,
    h: 203,
    chrome: 'panel',
  });
  assert.ok(Object.keys(CARD_FORMS).includes('html'));
});

// -------------------------------------------------- T2 / T3 / T12 / T13(a,b)

test('T2: resolveComponentKind resolves `.html` by filename, case-insensitively', () => {
  assert.equal(resolveComponentKind(null, 'x.html'), 'html');
  assert.equal(resolveComponentKind(null, 'x.HTML'), 'html');
  // Unchanged: a bare markdown file is still a note.
  assert.equal(resolveComponentKind(null, 'x.md'), 'note');
});

test('T3: the html branch sits BEFORE the registry loop (position is load-bearing)', () => {
  // Non-component branches win over the html filename.
  assert.equal(resolveComponentKind({ type: 'chalk' }, 'x.html'), 'chalk');
  assert.equal(resolveComponentKind({ type: 'gate' }, 'x.html'), 'gate');
  assert.equal(resolveComponentKind({ type: 'sprite' }, 'x.html'), 'sprite');
  // ...but the html filename wins over every REGISTERED component predicate.
  // If the branch moved after the loop, `lock` would win here.
  assert.equal(
    resolveComponentKind({ type: 'component', component: 'lock' }, 'x.html'),
    'html'
  );
  // `{}` matches the note predicate — so a branch after the loop would be swallowed.
  assert.equal(resolveComponentKind({}, 'x.html'), 'html');
  assert.equal(resolveComponentKind({}, 'README.md'), 'gate');
  // Extension is the LAST segment only.
  assert.equal(resolveComponentKind(null, 'x.html.md'), 'note');
  assert.equal(resolveComponentKind(null, 'x.md.html'), 'html');
  assert.equal(resolveComponentKind(null, '.html'), 'html');
});

test('T12: a `.html` whose content starts with `---` still loses to its parsed type', () => {
  // Contract §4.2 priority: the html branch is filename-driven, so a real
  // chalk frontmatter on a `.html` file stays chalk (define, do not "fix").
  assert.equal(resolveComponentKind({ type: 'chalk' }, 'x.html'), 'chalk');
});

test('T13: the branch is FILENAME-driven and path-tolerant (seatFileOf route)', () => {
  // (a) an fm-driven branch (`f.type === 'html'`) would return `html` here.
  assert.equal(resolveComponentKind({ type: 'html' }, 'x.md'), 'note');
  // (b) `isHtmlPath` is `$`-anchored, so a FULL path works too — this is what
  // `move.ts:193-197` feeds `seatFileOf` when a `.html` enters the backpack.
  assert.equal(resolveComponentKind(null, 'player/x.html'), 'html');
  assert.equal(resolveComponentKind(null, 'world/a/x.HTML'), 'html');
  // (c) the observable consequence: the seat is 360×203, not note's 200×168.
  const seat = seatFileOf(null, 'player/page.html');
  assert.equal(seat.w, 360);
  assert.equal(seat.h, 203);
  // Unchanged: a `.md` seat still comes from its own row.
  assert.deepEqual(seatFileOf(null, 'player/note.md'), { path: 'player/note.md', w: 200, h: 168 });
});

// --------------------------------------------------------------- T4 层 + 大小写

test('T4: cardsOfLayer admits `.html` (any case) and still rejects `.MD`', () => {
  const files = [
    'world/a/X.HTML',
    'world/a/X.MD',
    'world/a/X.md',
    'world/a/README.html',
    'world/a/README.md',
    'world/a/README.MD',
  ];
  const result = cardsOfLayer('world/a', files);
  // `cards.push(f)` pushes the FULL path, in input order. `README.html` is NOT
  // the layer's own config (only the exact string `README.md` is) → a real card.
  assert.deepEqual(result, ['world/a/X.HTML', 'world/a/X.md', 'world/a/README.html']);
  // Bidirectional: the `.MD` pair must stay invisible, not merely be absent.
  assert.ok(!result.includes('world/a/X.MD'), 'X.MD must stay invisible (case-sensitive .md)');
  assert.ok(!result.includes('world/a/README.MD'), 'README.MD must stay invisible');
  assert.ok(!result.includes('world/a/README.md'), 'the layer README is config, not a card');
});

// ----------------------------------------------------------- T5 / T6 nook

test('T5: nookCardPaths admits `.html` and still drops the four root config files', () => {
  const dir = 'characters/ryo';
  const files = [
    `${dir}/README.md`,
    `${dir}/identity.md`,
    `${dir}/memory.MD`,
    `${dir}/diary.md`,
    `${dir}/page.HTML`,
    `${dir}/page.html`,
    `${dir}/letters/unsent.md`,
  ];
  const result = nookCardPaths(files, dir);
  assert.deepEqual(result, [`${dir}/diary.md`, `${dir}/page.HTML`, `${dir}/page.html`]);
  // The four root config files never enter (identity.md is a config, not a card).
  assert.ok(!result.includes(`${dir}/identity.md`));
  assert.ok(!result.includes(`${dir}/README.md`));
  // `.MD` stays invisible here too (the case-sensitive half of the asymmetry).
  assert.ok(!result.includes(`${dir}/memory.MD`));
});

test('T6: characterRootConfigOf stays null for `.html` and exact for `.md`', () => {
  // Regression nail: the config quadruple MUST NOT grow an `.html` member —
  // a `README.html` is content, not the nook's config.
  assert.equal(characterRootConfigOf('characters/x/README.html'), null);
  assert.equal(characterRootConfigOf('characters/x/memory.html'), null);
  assert.equal(characterRootConfigOf('characters/x/README.md'), 'README.md');
  assert.equal(characterRootConfigOf('characters/x/memory.md'), 'memory.md');
});

test('T7: the nook ROOT and a SUB-SCENE both show `.html` (both branches)', () => {
  const root = 'characters/ryo';
  const all = [
    `${root}/diary.md`,
    `${root}/page.html`,
    `${root}/letters/unsent.md`,
    `${root}/letters/doodle.html`,
  ];
  // Root scene → `nookCardPaths`; sub-scene → `cardsOfLayer`. Changing only one
  // of the two surfaces leaves one of these empty — that is the whole point.
  assert.deepEqual(nookSceneCards(root, all), [`${root}/diary.md`, `${root}/page.html`]);
  assert.deepEqual(nookSceneCards(`${root}/letters`, all), [
    `${root}/letters/unsent.md`,
    `${root}/letters/doodle.html`,
  ]);
});

// ----------------------------------------------------------- T8 背包 (M4M5 landed)

test('T8: the backpack lists `.html` with the virtual frontmatter and no source body', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-forms-html-'));
  try {
    const store = new LocalWorldStore(root);
    await store.writeFile(
      'world.json',
      JSON.stringify({
        id: 'forms-html-test',
        name: 'T',
        description: '',
        author: '',
        genre: 'test',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      })
    );
    await store.writeFile('player/key.md', '---\ntitle: Key\n---\nbody');
    await store.writeFile('player/page.html', HTTP_LINE);
    await store.writeFile('player/README.html', '<title>Not config</title>');

    const bag = await listBackpack(store);
    const paths = bag.map((i) => i.path);
    // `.html` is neither an extension filter nor a config: `player/README.html`
    // IS listed (only the exact string `player/README.md` is the bag's config).
    assert.deepEqual(paths, ['player/README.html', 'player/key.md', 'player/page.html']);

    const page = bag.find((i) => i.path === 'player/page.html');
    assert.equal(page.frontmatter.type, 'html');
    assert.equal(page.body, '', 'page source MUST NOT reach a renderer as prose');

    // The observable consequence for the injected `bag` section: no `<`.
    const line = bagLine(page);
    assert.ok(!line.includes('<'), `bagLine leaked markup: ${line}`);
    assert.ok(line.includes('player/page.html'), line);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------ T11 (V1)

test('T11: COMPONENT_REGISTRY still holds exactly 19 kinds — `.html` is NOT registered', () => {
  const kinds = Object.keys(COMPONENT_REGISTRY);
  assert.equal(kinds.length, 19);
  assert.deepEqual([...COMPONENT_KINDS].sort(), kinds.slice().sort());
  assert.ok(!kinds.includes('html'), '`.html` is a derived kind, never a registered one');
});

// --------------------------------------------------------------- T14 (静态)

test('T14: `cardWritingFrame` (event-bridge) has NO `.html` branch — M1 alone suffices', async () => {
  const source = await fs.readFile(
    path.resolve(import.meta.dirname, '../../../apps/server/src/engine/event-bridge.ts'),
    'utf8'
  );
  assert.ok(
    !source.includes('isHtmlPath'),
    'event-bridge MUST NOT grow an isHtmlPath consumer (contract §6.6: zero changes)'
  );
  // ...and the resolver it does call already answers `html` on its own.
  assert.equal(cardKindOf(null, 'x.html'), 'html');
});

// ----------------------------------------------- cardKindOf (bare fm) nails

test('cardKindOf: `.html` resolves by filename even when frontmatter is null', () => {
  // The real `.html` frontmatter is always `null` — this is the server's path.
  assert.equal(cardKindOf(null, 'x.html'), 'html');
  assert.equal(cardKindOf(null, 'x.HTML'), 'html');
  // A non-html type on a `.html` filename still wins (branch order unchanged).
  assert.equal(cardKindOf({ type: 'chalk' }, 'x.html'), 'chalk');
  // Unchanged: fm-driven, filename-driven, and fallback forms.
  assert.equal(cardKindOf(null, 'x.md'), 'note');
  assert.equal(cardKindOf({ type: 'html' }, 'x.md'), 'note');
  // A `type: note` on a `.html` filename loses too: `note` matches inside the
  // registry loop, and the html branch sits before it (T3's rule, one layer up).
  assert.equal(cardKindOf({ type: 'note' }, 'x.html'), 'html');
  assert.deepEqual(cardFormOf(null, 'x.html'), {
    label: 'Web page',
    w: 360,
    h: 203,
    chrome: 'panel',
  });
  // The pre-existing note row is untouched (chrome stays `note`).
  assert.equal(CARD_FORMS.note.chrome, 'note');
});
