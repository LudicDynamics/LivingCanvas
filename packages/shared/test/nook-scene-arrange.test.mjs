/**
 * N2c — `arrangeCards` write side for nook SUB-SCENES.
 *
 * Before this batch the scene of a card was `nookIdOf(characterIdOfPath(path))`,
 * which only ever answers "which character" — so a card under
 * `characters/elias/office/` was written to the CHARACTER ROOT page
 * (`cards.layer = 'characters/elias'`) with no error at all, and a layout on
 * `characters/elias/office` failed its per-path ownership check with the
 * misleading `"<p>" is not on layer "characters/elias/office"`.
 *
 * Runs against built `dist/`: `pnpm --filter @airp/shared build`.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { ActionError } from '../dist/actions/errors.js';
import { createActionService } from '../dist/actions/service.js';
import { arrangeCards } from '../dist/actions/canvas.js';
import { LocalWorldStore } from '../dist/store/local-store.js';

const ACTOR = { type: 'writer' };
const OFFICE = 'characters/elias/office';
const ROOT_CARD = 'characters/elias/unspoken.md';
const SCENE_CARD = 'characters/elias/office/desk.md';

const CARD = (title) => `---\ntitle: ${title}\ntype: note\n---\n\n${title} body.\n`;

/** Temp world: character `elias` with a root card and an `office` sub-scene. */
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-nook-scene-arrange-'));
  const store = new LocalWorldStore(root);
  await store.writeFile(
    'world.json',
    JSON.stringify({
      id: 'n2c',
      name: 'N2c',
      description: '',
      author: '',
      genre: 'test',
      characters: [{ id: 'elias', name: 'Elias', home: 'world/inn' }],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
  );
  await store.writeFile('world/README.md', '---\nname: Map\ntype: readme\n---\n\n# Map\n');
  await store.writeFile('world/inn/README.md', '---\nname: Inn\ntype: readme\n---\n\n# Inn\n');
  await store.writeFile('characters/elias/README.md', '---\nname: Elias\ntype: readme\n---\n\n# Elias\n');
  await store.writeFile(ROOT_CARD, CARD('Unspoken'));
  await store.writeFile(`${OFFICE}/README.md`, '---\nname: Office\ntype: readme\n---\n\n# Office\n');
  await store.writeFile(SCENE_CARD, CARD('Desk'));
  await store.writeFile(`${OFFICE}/work-log.md`, CARD('Work Log'));
  return { store, root };
}

function service(store) {
  return createActionService(store, ACTOR, { turn: 'n2c:test' });
}

function isActionError(code) {
  return (err) => {
    assert.ok(err instanceof ActionError, `expected ActionError, got ${err}`);
    assert.equal(err.code, code, err.message);
    return true;
  };
}

// ------------------------------------------------- place: scene = dirOf(path)

test('N2c-A1 arrangeCards({place}) on a sub-scene card lands on the SUB-SCENE, not the character root', async () => {
  const { store, root } = await fixture();
  try {
    const svc = service(store);
    const res = await svc.arrangeCards({ place: { path: SCENE_CARD, x: 730, y: 445 } });

    // BEFORE the fix this was `'characters/elias'` (the root) — same shape, wrong
    // page, no error. Asserting the full id is what makes this red before.
    assert.equal(res.details.layer, OFFICE, JSON.stringify(res.details));
    assert.equal(res.details.action, 'placed');

    const row = store.getLayerCards([SCENE_CARD])[0];
    assert.ok(row, 'the card must have a row');
    assert.equal(row.layer, OFFICE, 'cards.layer MUST be the full nookSceneId (docs/nook-scene/03 §4.4)');
    assert.equal(row.x, 730);
    assert.equal(row.y, 445);

    // The root page is untouched: the scene is NOT the character root.
    const rootRows = store.getLayerCards(store.cardsInLayer('characters/elias'));
    assert.deepEqual(rootRows.map((r) => r.id), [], 'placing in a sub-scene must not write a root-page row');
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('N2c-A2 place regression: a root-scene card still resolves to `characters/<id>`', async () => {
  const { store, root } = await fixture();
  try {
    const res = await service(store).arrangeCards({ place: { path: ROOT_CARD, x: 10, y: 20 } });
    assert.equal(res.details.layer, 'characters/elias');
    assert.equal(store.getLayerCards([ROOT_CARD])[0].layer, 'characters/elias');
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('N2c-A3 place regression: an ordinary layer path resolves via resolveLayer (unchanged)', async () => {
  const { store, root } = await fixture();
  try {
    await store.writeFile('world/inn/a.md', CARD('A'));
    const res = await service(store).arrangeCards({ place: { path: 'world/inn/a.md', x: 5, y: 6 } });
    assert.equal(res.details.layer, 'world/inn');
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

// --------------------------------------- layout: members, inference, guard

test('N2c-A4 layout with an explicit sub-scene layer rearranges THAT scene and leaves the root alone', async () => {
  const { store, root } = await fixture();
  try {
    const svc = service(store);
    // Seat the root card first so "the root did not move" is observable.
    await svc.arrangeCards({ place: { path: ROOT_CARD, x: 900, y: 900 } });
    const rootBefore = store.getLayerCards([ROOT_CARD])[0];

    // `paths` omitted: members come from the SCENE (pre-fix: from the root, and
    // the per-path guard then failed with `not_found`).
    const res = await svc.arrangeCards({ layout: { mode: 'grid', layer: OFFICE } });

    assert.equal(res.details.action, 'laid-out');
    assert.equal(res.details.layer, OFFICE, JSON.stringify(res.details));
    assert.ok(res.details.cards.length >= 2, JSON.stringify(res.details.cards));
    for (const c of res.details.cards) assert.ok(c.path.startsWith(`${OFFICE}/`), c.path);

    // Every scene card moved onto the scene's own page.
    for (const p of [SCENE_CARD, `${OFFICE}/work-log.md`]) {
      assert.equal(store.getLayerCards([p])[0].layer, OFFICE, p);
    }
    // The root page is byte-identical.
    const rootAfter = store.getLayerCards([ROOT_CARD])[0];
    assert.equal(rootAfter.x, rootBefore.x);
    assert.equal(rootAfter.y, rootBefore.y);
    assert.equal(rootAfter.layer, 'characters/elias');
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('N2c-A5 layout with explicit sub-scene paths infers that sub-scene (pre-fix inferred the root)', async () => {
  const { store, root } = await fixture();
  try {
    const res = await service(store).arrangeCards({
      layout: { mode: 'row', paths: [SCENE_CARD, `${OFFICE}/work-log.md`] },
    });
    assert.equal(res.details.layer, OFFICE, JSON.stringify(res.details));
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('N2c-A6 guard is NOT relaxed: a path from another scene is rejected', async () => {
  const { store, root } = await fixture();
  try {
    await store.writeFile('characters/elias/balcony/view.md', CARD('View'));
    await assert.rejects(
      () =>
        service(store).arrangeCards({
          layout: { mode: 'grid', layer: OFFICE, paths: [SCENE_CARD, 'characters/elias/balcony/view.md'] },
        }),
      isActionError('not_found')
    );
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('N2c-A7 a sub-scene layer with a trailing slash is a shape error (400), not "Unknown layer"', async () => {
  const { store, root } = await fixture();
  try {
    await assert.rejects(
      () => service(store).arrangeCards({ layout: { mode: 'grid', layer: `${OFFICE}/` } }),
      isActionError('invalid_argument')
    );
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('N2c-A8 a sub-scene layer that has no directory is not_found', async () => {
  const { store, root } = await fixture();
  try {
    await assert.rejects(
      () => service(store).arrangeCards({ layout: { mode: 'grid', layer: 'characters/elias/ghost-scene' } }),
      isActionError('not_found')
    );
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("N2c-A9 `layer: 'map'` + a sub-scene path stays not_found (no `layerOfPath` map fallback)", async () => {
  const { store, root } = await fixture();
  try {
    await assert.rejects(
      () => service(store).arrangeCards({ layout: { mode: 'grid', layer: 'map', paths: [SCENE_CARD] } }),
      isActionError('not_found')
    );
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('N2c-A10 layout regression: an ordinary layer is unchanged', async () => {
  const { store, root } = await fixture();
  try {
    await store.writeFile('world/inn/a.md', CARD('A'));
    await store.writeFile('world/inn/b.md', CARD('B'));
    const res = await service(store).arrangeCards({ layout: { mode: 'grid', layer: 'world/inn' } });
    assert.equal(res.details.layer, 'world/inn');
    assert.equal(res.details.cards.length, 2, JSON.stringify(res.details.cards));
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('N2c-A11 direct `arrangeCards(ctx, …)` shares the same branch (no HTTP-only fix)', async () => {
  const { store, root } = await fixture();
  try {
    const svc = service(store);
    const res = await arrangeCards(svc.ctx, { place: { path: SCENE_CARD, z: 5 } });
    assert.equal(res.details.layer, OFFICE);
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
