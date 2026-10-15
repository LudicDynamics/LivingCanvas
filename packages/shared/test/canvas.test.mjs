/**
 * doc-09 `link` / `arrange` acceptance tests (canvas.db state, no events).
 *
 * Imports the built `dist/` modules directly (not the barrel): `dist/index.js`
 * transitively re-exports every tool module in the batch, so one unfinished
 * sibling blocks the whole barrel at import time.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { ActionError } from '../dist/actions/errors.js';
import { createActionService } from '../dist/actions/service.js';
import {
  arrangeCards,
  clampCoord,
  computeCircle,
  computeGrid,
  computeRow,
  linkCards,
  normalizeLinkStyle,
} from '../dist/actions/canvas.js';
import { linkIdOf } from '../dist/schemas/canvas.js';
import { initCanvasDatabase } from '../dist/db/schema.js';
import { LocalWorldStore } from '../dist/store/local-store.js';

const ACTOR = { type: 'writer' };

async function tempStore() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-canvas-test-'));
  const store = new LocalWorldStore(root);
  await store.writeFile(
    'world.json',
    JSON.stringify({
      id: 'proj-1',
      name: 'T',
      description: '',
      author: '',
      genre: 'test',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
  );
  await store.writeFile('world/README.md', '---\nname: Map\ntype: readme\n---\n\n# Map\n');
  await store.writeFile('world/inn/README.md', '---\nname: Inn\ntype: readme\n---\n\n# Inn\n');
  await store.writeFile('world/inn/a.md', '---\ntitle: A\ntype: chalk\n---\n\nA.\n');
  await store.writeFile('world/inn/b.md', '---\ntitle: B\ntype: note\n---\n\nB.\n');
  await store.writeFile('world/inn/c.md', '---\ntitle: C\ntype: chalk\n---\n\nC.\n');
  await store.writeFile('world/baker/README.md', '---\nname: Baker\ntype: readme\n---\n\n# Baker\n');
  await store.writeFile('player/key.md', '---\ntitle: Key\ntype: note\n---\n\nKey.\n');
  return { store, root };
}

function service(store) {
  return createActionService(store, ACTOR, { turn: 'req:test' });
}

function isActionError(code) {
  return (err) => {
    assert.ok(err instanceof ActionError, `expected ActionError, got ${err}`);
    assert.equal(err.code, code, err.message);
    return true;
  };
}

// ---------------------------------------------------------------- pure fns

test('normalizeLinkStyle maps all eight presets to stored primitives (doc-09 §2.4)', () => {
  const expected = {
    solid: { style: 'ink', color: null, directed: false },
    dashed: { style: 'dashed', color: null, directed: false },
    arrow: { style: 'ink', color: null, directed: true },
    bold: { style: 'bold', color: null, directed: false },
    red: { style: 'ink', color: 'rust', directed: false },
    hand: { style: 'hand', color: null, directed: false },
    thread: { style: 'thread', color: null, directed: false },
    road: { style: 'road', color: null, directed: false },
  };
  for (const [token, want] of Object.entries(expected)) {
    assert.deepEqual(normalizeLinkStyle(token), want, token);
  }
  assert.deepEqual(normalizeLinkStyle('solid', 'rust'), { style: 'ink', color: 'rust', directed: false });
  assert.deepEqual(normalizeLinkStyle('thread', undefined, true), {
    style: 'thread',
    color: null,
    directed: true,
  });
  assert.deepEqual(normalizeLinkStyle(), expected.solid, 'default is solid');
});

test('linkIdOf is deterministic on the endpoint pair, direction included', () => {
  const a = linkIdOf('world/inn', 'world/inn/a.md', 'world/inn/b.md');
  const b = linkIdOf('world/inn', 'world/inn/a.md', 'world/inn/b.md');
  assert.equal(a, b, 'same inputs → same id');
  assert.match(a, /^lnk-[0-9a-f]{8}$/);
  assert.notEqual(a, linkIdOf('world/inn', 'world/inn/b.md', 'world/inn/a.md'), 'direction matters');
  assert.notEqual(a, linkIdOf('map', 'world/inn/a.md', 'world/inn/b.md'), 'layer matters');
});

test('layout calculators: count, non-overlap, order-independence (doc-09 §10.1)', () => {
  const boxes = [
    { path: 'world/inn/c.md', w: 200, h: 170 },
    { path: 'world/inn/a.md', w: 460, h: 190 },
    { path: 'world/inn/b.md', w: 200, h: 168 },
  ];
  for (const [name, fn] of Object.entries({ grid: computeGrid, circle: computeCircle, row: computeRow })) {
    const out = fn(boxes);
    assert.equal(out.length, boxes.length, `${name} count`);
    assert.equal(new Set(out.map((p) => p.path)).size, boxes.length, `${name} unique paths`);
    for (const pos of out) {
      assert.ok(Number.isFinite(pos.x) && Number.isFinite(pos.y), `${name} finite coords`);
    }
    const shuffled = fn([...boxes].reverse());
    assert.deepEqual(out, shuffled, `${name} result is order-independent`);
    if (name !== 'circle') {
      for (let i = 0; i < out.length; i++) {
        for (let j = i + 1; j < out.length; j++) {
          const ox = Math.abs(out[i].x - out[j].x) >= Math.min(boxes[i].w, boxes[j].w);
          const oy = Math.abs(out[i].y - out[j].y) >= Math.min(boxes[i].h, boxes[j].h);
          const overlap = !ox && !oy;
          assert.equal(overlap, false, `${name} ${out[i].path} vs ${out[j].path} do not overlap`);
        }
      }
    }
  }
  assert.deepEqual(computeGrid([]), []);
});

test('clampCoord: NaN/Infinity throw, 1e9 clamps to 4000 (doc-09 §10.1)', () => {
  assert.equal(clampCoord(1e9, 'x'), 4000);
  assert.equal(clampCoord(-1e9, 'y'), -4000);
  assert.equal(clampCoord(10, 'x'), 10);
  assert.throws(() => clampCoord(Number.NaN, 'x'), isActionError('invalid_argument'));
  assert.throws(() => clampCoord(Number.POSITIVE_INFINITY, 'x'), isActionError('invalid_argument'));
});

// ------------------------------------------------------------------- link

test('link create writes one row, is idempotent, and appends no event', async () => {
  const { store, root } = await tempStore();
  try {
    const maxSeqBefore = await store.getMaxSeq();
    const svc = service(store);
    const res = await svc.linkCards({ op: 'create', from: 'world/inn/a.md', to: 'world/inn/b.md', style: 'road', label: 'walk' });
    assert.equal(res.details.kind, 'links');
    assert.equal(res.details.action, 'created');
    assert.equal(res.details.layer, 'world/inn');
    assert.equal(res.details.path, 'world/inn/a.md');
    assert.equal(res.details.links.length, 1);
    assert.equal(res.details.links[0].style, 'road');
    assert.equal(res.details.links[0].label, 'walk');
    assert.equal(res.details.links[0].directed, false);

    await svc.linkCards({ op: 'create', from: 'world/inn/a.md', to: 'world/inn/b.md', style: 'solid' });
    const rows = await store.getLayerLinks('world/inn');
    assert.equal(rows.length, 1, 'same endpoint pair → one identity (idempotent create)');
    assert.equal(rows[0].style, 'ink', 'style changed on the SAME row, not a second line');

    assert.equal(await store.getMaxSeq(), maxSeqBefore, 'link appends no event');
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('link create with distinct explicit ids allows multiple lines between the same pair', async () => {
  const { store, root } = await tempStore();
  try {
    const svc = service(store);
    await svc.linkCards({ op: 'create', from: 'world/inn/a.md', to: 'world/inn/b.md', id: 'lnk-aaaa1111', style: 'dashed' });
    await svc.linkCards({ op: 'create', from: 'world/inn/a.md', to: 'world/inn/b.md', id: 'lnk-bbbb2222', style: 'thread' });
    assert.equal((await store.getLayerLinks('world/inn')).length, 2);
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('link create rejects a squatted id that names a different pair', async () => {
  const { store, root } = await tempStore();
  try {
    const svc = service(store);
    await svc.linkCards({ op: 'create', from: 'world/inn/a.md', to: 'world/inn/b.md', id: 'lnk-abc12345' });
    await assert.rejects(
      () => svc.linkCards({ op: 'create', from: 'world/inn/b.md', to: 'world/inn/c.md', id: 'lnk-abc12345' }),
      isActionError('already_exists')
    );
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('link create validates endpoints, layers, style, and label', async () => {
  const { store, root } = await tempStore();
  try {
    const svc = service(store);
    await assert.rejects(
      () => svc.linkCards({ op: 'create', from: 'world/inn/missing.md', to: 'world/inn/b.md' }),
      isActionError('not_found')
    );
    await assert.rejects(
      () => svc.linkCards({ op: 'create', from: 'world/inn/a.md', to: 'player/key.md' }),
      isActionError('invalid_argument')
    );
    await assert.rejects(
      () => svc.linkCards({ op: 'create', from: 'world/inn/a.md', to: 'world/baker/README.md' }),
      isActionError('invalid_argument'),
      'cross-layer lines are never rendered'
    );
    await assert.rejects(
      () => svc.linkCards({ op: 'create', from: '../etc/passwd', to: 'world/inn/b.md' }),
      isActionError('invalid_path')
    );
    await assert.rejects(
      () => svc.linkCards({ op: 'create', from: 'world/inn/a.md', to: 'world/inn/b.md', style: 'wavy' }),
      isActionError('invalid_field_value')
    );
    await assert.rejects(
      () => svc.linkCards({ op: 'create', from: 'world/inn/a.md', to: 'world/inn/b.md', label: 'x'.repeat(41) }),
      isActionError('invalid_argument')
    );
    await assert.rejects(() => svc.linkCards({ op: 'nope', from: 'a', to: 'b' }), isActionError('invalid_argument'));
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('link update by id changes fields; update by (from,to) with multiple rows is invalid_argument (m-10)', async () => {
  const { store, root } = await tempStore();
  try {
    const svc = service(store);
    const created = await svc.linkCards({ op: 'create', from: 'world/inn/a.md', to: 'world/inn/b.md', style: 'solid' });
    const id = created.details.links[0].id;

    const updated = await svc.linkCards({ op: 'update', id, style: 'arrow' });
    assert.equal(updated.details.action, 'updated');
    assert.equal(updated.details.links[0].style, 'ink');
    assert.equal(updated.details.links[0].directed, true, 'arrow preset sets directed');
    assert.equal((await store.getLayerLinks('world/inn')).length, 1);

    await svc.linkCards({ op: 'create', from: 'world/inn/a.md', to: 'world/inn/b.md', id: 'lnk-cccc3333', style: 'dashed' });
    await assert.rejects(
      () => svc.linkCards({ op: 'update', from: 'world/inn/a.md', to: 'world/inn/b.md', style: 'bold' }),
      isActionError('invalid_argument'),
      'two rows match the pair → must pass an id'
    );

    await assert.rejects(
      () => svc.linkCards({ op: 'update', id: 'lnk-nope0000', style: 'bold' }),
      isActionError('not_found')
    );
    await assert.rejects(
      () => svc.linkCards({ op: 'update', from: 'world/inn/b.md', to: 'world/inn/c.md', style: 'bold' }),
      isActionError('not_found')
    );
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('link delete by id removes the row; (from,to) multi-row and unknown ids fail (m-10)', async () => {
  const { store, root } = await tempStore();
  try {
    const svc = service(store);
    const created = await svc.linkCards({ op: 'create', from: 'world/inn/a.md', to: 'world/inn/b.md' });
    const id = created.details.links[0].id;

    const del = await svc.linkCards({ op: 'delete', id });
    assert.equal(del.details.action, 'deleted');
    assert.equal((await store.getLayerLinks('world/inn')).length, 0);

    await assert.rejects(() => svc.linkCards({ op: 'delete', id }), isActionError('not_found'));

    await svc.linkCards({ op: 'create', from: 'world/inn/a.md', to: 'world/inn/b.md', id: 'lnk-dddd4444' });
    await svc.linkCards({ op: 'create', from: 'world/inn/a.md', to: 'world/inn/b.md', id: 'lnk-eeee5555' });
    await assert.rejects(
      () => svc.linkCards({ op: 'delete', from: 'world/inn/a.md', to: 'world/inn/b.md' }),
      isActionError('invalid_argument'),
      'N>1 rows match → require an id (REVIEW m-10)'
    );
    assert.equal((await store.getLayerLinks('world/inn')).length, 2, 'multi-row delete removed nothing');

    const single = await svc.linkCards({ op: 'delete', id: 'lnk-dddd4444' });
    assert.equal(single.details.action, 'deleted');
    assert.equal((await store.getLayerLinks('world/inn')).length, 1);
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- arrange

test('arrange place writes x/y/z and never touches width/height (doc-09 §10.2)', async () => {
  const { store, root } = await tempStore();
  try {
    await store.seatUnplaced('world/inn', [{ path: 'world/inn/a.md', w: 460, h: 190 }]);
    const before = store.getLayerCards(['world/inn/a.md'])[0];
    assert.equal(before.w, 460);
    assert.equal(before.h, 190);

    const maxSeqBefore = await store.getMaxSeq();
    const svc = service(store);
    const res = await svc.arrangeCards({ place: { path: 'world/inn/a.md', x: 123, y: 456, z: 7 } });
    assert.equal(res.details.kind, 'cards');
    assert.equal(res.details.action, 'placed');
    assert.equal(res.details.layer, 'world/inn');
    assert.deepEqual(res.details.cards, [{ path: 'world/inn/a.md', x: 123, y: 456, z: 7 }]);

    const after = store.getLayerCards(['world/inn/a.md'])[0];
    assert.equal(after.x, 123);
    assert.equal(after.y, 456);
    assert.equal(after.z, 7);
    assert.equal(after.w, before.w, 'width byte-identical');
    assert.equal(after.h, before.h, 'height byte-identical');
    assert.equal(await store.getMaxSeq(), maxSeqBefore, 'arrange appends no event');
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('an agent placement that lands on another card keeps its seat; a player drop is honoured', async () => {
  const { store, root } = await tempStore();
  try {
    await store.seatUnplaced('world/inn', [
      { path: 'world/inn/a.md', w: 460, h: 190 },
      { path: 'world/inn/c.md', w: 460, h: 190 },
    ]);
    const a = store.getLayerCards(['world/inn/a.md'])[0];
    const seat = store.getLayerCards(['world/inn/c.md'])[0];

    // The writer asks for c right on top of a: refused, c stays where the seat put it.
    const kept = await service(store).arrangeCards({ place: { path: 'world/inn/c.md', x: a.x + 10, y: a.y + 10 } });
    assert.match(kept.text, /Kept .* overlapped another card/);
    const afterKept = store.getLayerCards(['world/inn/c.md'])[0];
    assert.equal(afterKept.x, seat.x);
    assert.equal(afterKept.y, seat.y);

    // A free spot is placed as requested; z-only moves are never judged.
    const free = await service(store).arrangeCards({ place: { path: 'world/inn/c.md', x: a.x + 2000, y: a.y + 2000 } });
    assert.match(free.text, /^Placed /);
    const z = await service(store).arrangeCards({ place: { path: 'world/inn/c.md', z: 9 } });
    assert.match(z.text, /^Placed /);

    // The player may stack cards on purpose.
    const player = createActionService(store, { type: 'player' }, { turn: 'req:test' });
    const dropped = await player.arrangeCards({ place: { path: 'world/inn/c.md', x: a.x + 10, y: a.y + 10 } });
    assert.match(dropped.text, /^Placed /);
    assert.equal(store.getLayerCards(['world/inn/c.md'])[0].x, a.x + 10);
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('arrange place clamps out-of-range coords and rejects NaN', async () => {
  const { store, root } = await tempStore();
  try {
    const svc = service(store);
    const res = await svc.arrangeCards({ place: { path: 'world/inn/a.md', x: 1e9, y: -1e9 } });
    assert.equal(res.details.cards[0].x, 4000);
    assert.equal(res.details.cards[0].y, -4000);
    await assert.rejects(
      () => svc.arrangeCards({ place: { path: 'world/inn/a.md', x: Number.NaN } }),
      isActionError('invalid_argument')
    );
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('arrange rejects w/h with unsupported and writes nothing (§11 冲突 1)', async () => {
  const { store, root } = await tempStore();
  try {
    await store.seatUnplaced('world/inn', [{ path: 'world/inn/a.md', w: 460, h: 190 }]);
    const svc = service(store);
    await assert.rejects(
      () => svc.arrangeCards({ place: { path: 'world/inn/a.md', x: 10, y: 10 }, w: 500 }),
      isActionError('unsupported')
    );
    const row = store.getLayerCards(['world/inn/a.md'])[0];
    assert.equal(row.x, 360, 'initial flow-column x remains unchanged when w is present');
    assert.equal(row.w, 460);

    await store.placeCard('world/inn', 'world/inn/a.md', { x: 10, y: 10 });
    await assert.rejects(() => svc.arrangeCards({ place: { path: 'world/inn/a.md', x: 99 }, h: 300 }), isActionError('unsupported'));
    assert.equal(store.getLayerCards(['world/inn/a.md'])[0].x, 10, 'rejected before any write');
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('arrange place/layout are mutually exclusive; place needs a path and a coord', async () => {
  const { store, root } = await tempStore();
  try {
    const svc = service(store);
    await assert.rejects(() => svc.arrangeCards({}), isActionError('invalid_argument'));
    await assert.rejects(
      () => svc.arrangeCards({ place: { path: 'world/inn/a.md', x: 1 }, layout: { mode: 'row' } }),
      isActionError('invalid_argument')
    );
    await assert.rejects(
      () => svc.arrangeCards({ place: { path: 'world/inn/a.md' } }),
      isActionError('invalid_argument'),
      'place needs at least one coordinate'
    );
    await assert.rejects(
      () => svc.arrangeCards({ place: { path: 'player/key.md', x: 1 } }),
      isActionError('not_found'),
      'bag paths are not on a canvas layer'
    );
    await assert.rejects(
      () => svc.arrangeCards({ place: { path: 'world/inn/missing.md', x: 1 } }),
      isActionError('not_found')
    );
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('arrange layout re-flows a whole layer from scratch and is deterministic', async () => {
  const { store, root } = await tempStore();
  try {
    const svc = service(store);
    const res = await svc.arrangeCards({ layout: { mode: 'grid', layer: 'world/inn' } });
    assert.equal(res.details.action, 'laid-out');
    assert.equal(res.details.layer, 'world/inn');
    assert.equal(res.details.cards.length, 3, 'a.md + b.md + c.md (README is not a card)');

    const resByPath = Object.fromEntries(res.details.cards.map((c) => [c.path, c]));

    // Second run with explicit reverse-order paths yields the same seats.
    const second = await svc.arrangeCards({
      layout: { mode: 'grid', layer: 'world/inn', paths: ['world/inn/c.md', 'world/inn/b.md', 'world/inn/a.md'] },
    });
    for (const card of second.details.cards) {
      assert.equal(card.x, resByPath[card.path].x, `stable x for ${card.path} regardless of input order`);
      assert.equal(card.y, resByPath[card.path].y, `stable y for ${card.path} regardless of input order`);
    }
    assert.deepEqual(
      second.details.cards.map((c) => c.path),
      res.details.cards.map((c) => c.path),
      'deterministic order'
    );

    for (const mode of ['circle', 'row']) {
      const laid = await svc.arrangeCards({ layout: { mode, paths: ['world/inn/a.md', 'world/inn/b.md'] } });
      assert.equal(laid.details.action, 'laid-out');
      assert.equal(laid.details.cards.length, 2);
    }
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('arrange subset treats unselected cards as obstacles and falls back safely (E-GEO-02)', async () => {
  const { store, root } = await tempStore();
  try {
    await store.seatUnplaced('world/inn', [
      { path: 'world/inn/a.md', w: 200, h: 180 },
      { path: 'world/inn/b.md', w: 200, h: 180 },
    ]);
    const selectedOnly = computeRow([{ path: 'world/inn/a.md', w: 200, h: 180 }])[0];
    await store.placeCard('world/inn', 'world/inn/b.md', { x: selectedOnly.x, y: selectedOnly.y });
    const obstacle = store.getLayerCards(['world/inn/b.md'])[0];
    const oldOverlap =
      selectedOnly.x < obstacle.x + obstacle.w &&
      obstacle.x < selectedOnly.x + 200 &&
      selectedOnly.y < obstacle.y + obstacle.h &&
      obstacle.y < selectedOnly.y + 180;
    assert.equal(oldOverlap, true, 'the selected-only candidate overlaps the unselected fixture card');
    const staleVersion = store.getCanvasVersion('world/inn');
    const svc = service(store);
    await svc.arrangeCards({
      layout: { mode: 'row', layer: 'world/inn', paths: ['world/inn/a.md'] },
    });
    assert.ok(store.getCanvasVersion('world/inn') > staleVersion, 'a committed position advances canvasVersion');
    await assert.rejects(
      () => store.arrangeCanvasLayer({
        operationId: 'stale-version',
        layer: 'world/inn',
        mode: 'row',
        expectedRevision: 0,
        expectedCanvasVersion: staleVersion,
        snapshotId: '',
        policy: 'deoverlap',
        allowMoveStableCards: true,
        preserveLinks: true,
        paths: ['world/inn/a.md'],
      }),
      isActionError('conflict')
    );
    const rows = store.queryCanvas(
      'SELECT id, x, y, width, height FROM cards WHERE layer = ? ORDER BY id',
      ['world/inn']
    );
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const a = rows[i];
        const b = rows[j];
        assert.equal(
          a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height,
          false,
          `${a.id} and ${b.id} do not overlap after safe arrange`
        );
      }
    }
    assert.equal(store.getLayerCards(['world/inn/b.md'])[0].x, selectedOnly.x, 'obstacle x is preserved');
    assert.equal(store.getLayerCards(['world/inn/b.md'])[0].y, selectedOnly.y, 'obstacle y is preserved');
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('arrange layout is all-or-nothing: one bad path moves nothing', async () => {
  const { store, root } = await tempStore();
  try {
    await store.placeCard('world/inn', 'world/inn/a.md', { x: 11, y: 22 });
    await store.placeCard('world/inn', 'world/inn/b.md', { x: 33, y: 44 });
    const svc = service(store);
    await assert.rejects(
      () => svc.arrangeCards({ layout: { mode: 'row', paths: ['world/inn/a.md', 'world/inn/missing.md'] } }),
      isActionError('not_found')
    );
    const rows = Object.fromEntries(store.getLayerCards(['world/inn/a.md', 'world/inn/b.md']).map((r) => [r.id, r]));
    assert.equal(rows['world/inn/a.md'].x, 11);
    assert.equal(rows['world/inn/a.md'].y, 22);
    assert.equal(rows['world/inn/b.md'].x, 33);
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('arrange layout rejects a card outside the target layer', async () => {
  const { store, root } = await tempStore();
  try {
    const svc = service(store);
    await assert.rejects(
      () => svc.arrangeCards({ layout: { mode: 'grid', layer: 'world/inn', paths: ['world/baker/README.md'] } }),
      isActionError('not_found')
    );
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

// ------------------------------------------------------- delete/rename (04)

test('dropCard cascades: removing a card deletes every line that touches it (doc-09 §4.4)', async () => {
  const { store, root } = await tempStore();
  try {
    const svc = service(store);
    await svc.linkCards({ op: 'create', from: 'world/inn/a.md', to: 'world/inn/b.md' });
    await svc.linkCards({ op: 'create', from: 'world/inn/c.md', to: 'world/inn/a.md' });
    await svc.linkCards({ op: 'create', from: 'world/inn/b.md', to: 'world/inn/c.md' });

    const result = await store.dropCard('world/inn/a.md');
    assert.equal(result.links, 2, 'both lines touching a.md are gone');
    assert.equal((await store.getLayerLinks('world/inn')).length, 1, 'the unrelated line survives');
    assert.equal(store.getLayerCards(['world/inn/a.md']).length, 0);
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------- store layer

test('getLayerLinks returns ORDER BY z_index, id and scopes by layer', async () => {
  const { store, root } = await tempStore();
  try {
    await store.upsertLink({ id: 'lnk-zzz', layer: 'world/inn', from: 'world/inn/a.md', to: 'world/inn/b.md', z: 0 });
    await store.upsertLink({ id: 'lnk-aaa', layer: 'world/inn', from: 'world/inn/b.md', to: 'world/inn/c.md', z: 0 });
    await store.upsertLink({ id: 'lnk-mmm', layer: 'world/inn', from: 'world/inn/c.md', to: 'world/inn/a.md', z: 5 });
    await store.upsertLink({ id: 'lnk-other', layer: 'map', from: 'world/README.md', to: 'world/inn/README.md', z: 9 });

    assert.deepEqual(
      (await store.getLayerLinks('world/inn')).map((l) => l.id),
      ['lnk-aaa', 'lnk-zzz', 'lnk-mmm'],
      'same z sorts by id; higher z comes last'
    );
    assert.equal((await store.getLayerLinks()).length, 4, 'omitting layer returns the whole canvas');
    assert.equal(store.queryCanvas('SELECT COUNT(*) AS n FROM links')[0].n, 4);
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('placeCards is one transaction: a failure part-way leaves every row untouched', async () => {
  const { store, root } = await tempStore();
  try {
    await store.placeCard('world/inn', 'world/inn/a.md', { x: 11, y: 22 });
    await store.placeCard('world/inn', 'world/inn/b.md', { x: 33, y: 44 });

    // NaN binds as NULL, which violates `x REAL NOT NULL` on the second row —
    // the first row's write must be rolled back with it.
    await assert.rejects(() =>
      store.placeCards([
        { layer: 'world/inn', path: 'world/inn/a.md', x: 100, y: 200 },
        { layer: 'world/inn', path: 'world/inn/b.md', x: Number.NaN, y: 400 },
      ])
    );

    const rows = Object.fromEntries(store.getLayerCards(['world/inn/a.md', 'world/inn/b.md']).map((r) => [r.id, r]));
    assert.equal(rows['world/inn/a.md'].x, 11, 'first row rolled back');
    assert.equal(rows['world/inn/a.md'].y, 22);
    assert.equal(rows['world/inn/b.md'].x, 33, 'second row untouched');
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('upsertLink same spec twice leaves one row; a different explicit id coexists (doc-09 §10.2)', async () => {
  const { store, root } = await tempStore();
  try {
    const spec = { layer: 'world/inn', from: 'world/inn/a.md', to: 'world/inn/b.md' };
    await store.upsertLink({ ...spec, style: 'ink' });
    await store.upsertLink({ ...spec, style: 'ink' });
    assert.equal(store.queryCanvas('SELECT COUNT(*) AS n FROM links')[0].n, 1);

    await store.upsertLink({ ...spec, style: 'dashed' });
    assert.equal(store.queryCanvas('SELECT COUNT(*) AS n FROM links')[0].n, 1, 'restyle is the same row');
    assert.equal((await store.getLayerLinks('world/inn'))[0].style, 'dashed');

    await store.upsertLink({ ...spec, id: 'lnk-second00' });
    assert.equal(store.queryCanvas('SELECT COUNT(*) AS n FROM links')[0].n, 2, 'distinct id = a second line');

    assert.equal(await store.deleteLink('lnk-does-not-exist'), false, 'deleting an unknown id is false, not a throw');
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('links table shape-probe migration: old six-column shape is rebuilt, the new shape survives re-init', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-canvas-migrate-'));
  const dbPath = path.join(root, 'canvas.db');
  try {
    const old = new DatabaseSync(dbPath);
    old.exec(`
      CREATE TABLE links (
        id TEXT PRIMARY KEY, layer TEXT NOT NULL, from_id TEXT NOT NULL,
        to_id TEXT NOT NULL, style TEXT DEFAULT 'solid', label TEXT
      );
    `);
    old.close();

    const migrated = new DatabaseSync(dbPath);
    initCanvasDatabase(migrated);
    const cols = migrated.prepare('PRAGMA table_info(links)').all().map((c) => c.name);
    for (const col of ['color', 'directed', 'z_index', 'created_at']) {
      assert.ok(cols.includes(col), `rebuilt links has ${col}`);
    }
    migrated
      .prepare('INSERT INTO links (id, layer, from_id, to_id, created_at) VALUES (?,?,?,?,?)')
      .run('lnk-1', 'world/inn', 'world/inn/a.md', 'world/inn/b.md', 'now');

    // Second init must NOT wipe the row (REVIEW B-4 discipline).
    initCanvasDatabase(migrated);
    assert.equal(Number(migrated.prepare('SELECT COUNT(*) AS n FROM links').get().n), 1);
    assert.ok(migrated.prepare('PRAGMA index_list(links)').all().some((i) => i.name === 'idx_links_layer'));
    migrated.close();
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('linkCards / arrangeCards are callable through the registered service', async () => {
  const { store, root } = await tempStore();
  try {
    // Module-level registerAction must have bound both names.
    const svc = service(store);
    const link = await svc.linkCards({ op: 'create', from: 'world/inn/a.md', to: 'world/inn/b.md' });
    assert.equal(link.details.kind, 'links');
    const arrange = await svc.arrangeCards({ place: { path: 'world/inn/a.md', x: 5, y: 6 } });
    assert.equal(arrange.details.kind, 'cards');
    // Direct calls share the same code path and produce the same shapes.
    assert.equal((await linkCards(svc.ctx, { op: 'create', from: 'world/inn/b.md', to: 'world/inn/c.md' })).details.kind, 'links');
    assert.equal((await arrangeCards(svc.ctx, { place: { path: 'world/inn/b.md', x: 1, y: 2 } })).details.kind, 'cards');
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
