/**
 * doc-01 acceptance: the `cards.width/height` data layer + `reseatLayer` drift
 * table.
 *
 * Imports the built `dist/` modules directly (not the barrel): `dist/index.js`
 * transitively re-exports every tool module in the batch, so one unfinished
 * sibling blocks the whole barrel at import time. Build first:
 *   pnpm --filter @airp/shared build
 * then
 *   node --test packages/shared/test/footprint.test.mjs
 *
 * doc-05 appends its own end-to-end cases to THIS file (01 lands first, A4).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { CARD_FORMS, cardFormVersionOf } from '../dist/schemas/forms.js';
import { LocalWorldStore } from '../dist/store/local-store.js';

const CHALK = CARD_FORMS.chalk; // 460 x 190
const NOTE = CARD_FORMS.note; // 200 x 168

function declared(kind) {
  return { kind, w: CARD_FORMS[kind].w, h: CARD_FORMS[kind].h };
}

async function tempStore() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-footprint-test-'));
  const store = new LocalWorldStore(root);
  // `getMaxSeq` (the "no event was appended" assertion) resolves the project id,
  // which reads world.json — so the fixture needs one.
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
  return { store, root };
}

/** Raw `cards` row — for asserting what the methods must NOT touch. */
function rawRow(root, id) {
  const db = new DatabaseSync(path.join(root, '.airpworld', 'canvas.db'));
  try {
    const row = db.prepare('SELECT * FROM cards WHERE id = ?').get(id);
    return row ? { ...row } : null;
  } finally {
    db.close();
  }
}

function rawExec(root, sql, params = []) {
  const db = new DatabaseSync(path.join(root, '.airpworld', 'canvas.db'));
  try {
    db.prepare(sql).run(...params);
  } finally {
    db.close();
  }
}

async function cleanup(store, root) {
  store.close();
  await fs.rm(root, { recursive: true, force: true });
}

// ------------------------------------------------------------ pure helper

test('01 §2.1: cardFormVersionOf changes iff kind/w/h change (hash input contains kind)', () => {
  // MINOR-10: `map` and `thread` share a 300x200 box but paint at different
  // heights (scroll vs paper chrome), so `(w,h)` alone would miss a resize.
  assert.notEqual(cardFormVersionOf('map', 300, 200), cardFormVersionOf('thread', 300, 200));
  assert.equal(cardFormVersionOf('chalk', 460, 190), cardFormVersionOf('chalk', 460, 190));
  assert.notEqual(cardFormVersionOf('chalk', 460, 190), cardFormVersionOf('chalk', 460, 240));
  assert.notEqual(cardFormVersionOf('chalk', 460, 190), cardFormVersionOf('note', 460, 190));
  // Frozen anchors: changing the hash function or its input format would fail
  // every row's version match and re-seat the whole world (01 §12 第 6 条).
  assert.equal(cardFormVersionOf('chalk', 460, 190), '6b725a72');
  assert.equal(cardFormVersionOf('note', 200, 168), '8e6c6ee4');
});

// -------------------------------------------------- 01 §5.1(a) — I2 core

test('01 §5.1(a): measured drift re-seats once, then is stable (I2 + seatH chain)', async () => {
  const { store, root } = await tempStore();
  try {
    // declared: chalk = 460x190 (forms.ts)
    await store.seatUnplaced('world/inn', [{ path: 'world/inn/a.md', w: CHALK.w, h: CHALK.h }]);
    // The first `/api/layer` pass: declared arrives with `files` (kind feeds the hash).
    await store.reseatLayer('world/inn', [{ path: 'world/inn/a.md', ...declared('chalk') }]);
    const seated = store.getLayerCards(['world/inn/a.md'])[0];
    assert.equal(seated.seatH, CHALK.h, 'SEAT baseline recorded (contract §5.2)');
    assert.ok(seated.formVersion, 'legacy row backfilled with formVersion (表第 8 行)');

    // Frontend measurement: the column height becomes 578 while `seatH`/`seatW`
    // stay put (contract §5.2 / §8 反模式 9) — that gap IS the drift signal.
    await store.writeFootprints('world/inn', [{ path: 'world/inn/a.md', w: CHALK.w, h: 578 }]);
    const measured = store.getLayerCards(['world/inn/a.md'])[0];
    assert.equal(measured.h, 578);
    assert.equal(measured.seatH, CHALK.h, 'seatH is NOT touched by writeFootprints');
    assert.equal(measured.seatW, CHALK.w, 'seatW is NOT touched by writeFootprints');
    assert.ok(measured.measuredAt, 'measuredAt marker is written');

    // First reseat: 表第 4 行 hits (row.h 578 !== seatH 190) -> seat at the ROW value.
    await store.reseatLayer('world/inn', [{ path: 'world/inn/a.md', ...declared('chalk') }]);
    const first = store.getLayerCards(['world/inn/a.md'])[0];
    assert.equal(first.h, 578, 're-seated at the MEASURED height (row value)');
    assert.equal(first.w, CHALK.w);
    assert.equal(first.seatH, 578, 'seatH advances to the new baseline — the drift signal clears');
    assert.equal(first.measuredAt, measured.measuredAt, 'measuredAt preserved through the measured seat');

    // Second reseat: steady state -> no-op (I2: declared 190 must not clobber 578).
    const returned = await store.reseatLayer('world/inn', [
      { path: 'world/inn/a.md', ...declared('chalk') },
    ]);
    const second = store.getLayerCards(['world/inn/a.md'])[0];
    assert.deepEqual(returned, [], 'idempotent: nothing re-seated on a steady pass');
    assert.equal(second.w, CHALK.w, 'I2: measured width survives reseatLayer');
    assert.equal(second.h, 578, 'I2: measured height survives (NOT clobbered by declared)');
    assert.equal(second.x, first.x, 'x stable in the steady state');
    assert.equal(second.y, first.y, 'y stable — the new seat persists');
    assert.equal(second.seatH, 578, 'seatH stable');
  } finally {
    await cleanup(store, root);
  }
});

// -------------------------------------------- 01 §5.1(b) — kind resize

test('01 §5.1(b): kind resize (rowVersion mismatch) re-seats at DECLARED and clears measuredAt', async () => {
  const { store, root } = await tempStore();
  try {
    await store.seatUnplaced('world/inn', [{ path: 'world/inn/a.md', w: CHALK.w, h: CHALK.h }]);
    // A measured row whose version marker says the kind was resized in code.
    rawExec(
      root,
      'UPDATE cards SET width = 460, height = 578, metadata = ? WHERE id = ?',
      [JSON.stringify({ formVersion: '00000000', measuredAt: '2026-09-12T00:00:00.000Z', seatW: 460, seatH: 578 }), 'world/inn/a.md']
    );

    const out = await store.reseatLayer('world/inn', [
      { path: 'world/inn/a.md', ...declared('chalk') },
    ]);
    assert.equal(out.length, 1, 'the resized kind re-seats (MAJOR-2: the ability is not silently removed)');
    const row = store.getLayerCards(['world/inn/a.md'])[0];
    const raw = rawRow(root, 'world/inn/a.md');
    const meta = JSON.parse(raw.metadata);
    assert.equal(row.h, CHALK.h, 'seated at declared height');
    assert.equal(row.w, CHALK.w, 'seated at declared width');
    assert.equal(meta.measuredAt, undefined, 'measuredAt cleared — the stale measurement is invalid');
    assert.equal(row.seatH, CHALK.h, 'seat baseline re-baselined to declared');
    assert.equal(meta.formVersion, cardFormVersionOf('chalk', CHALK.w, CHALK.h));

    // And the next pass is a no-op (the cleared marker must not bounce us back).
    assert.deepEqual(
      await store.reseatLayer('world/inn', [{ path: 'world/inn/a.md', ...declared('chalk') }]),
      []
    );
  } finally {
    await cleanup(store, root);
  }
});

// -------------------------- 01 §5.1(c) — missing row / dirty w|h

test('01 §5.1(c): reseatLayer seats rows that are missing or have w|h <= 0', async () => {
  const { store, root } = await tempStore();
  try {
    // (i) no row at all -> INSERT at declared, with the seat baseline.
    const inserted = await store.reseatLayer('world/inn', [
      { path: 'world/inn/a.md', ...declared('note') },
    ]);
    assert.equal(inserted.length, 1, 'a rowless card is seated');
    const fresh = store.getLayerCards(['world/inn/a.md'])[0];
    assert.equal(fresh.w, NOTE.w);
    assert.equal(fresh.h, NOTE.h);
    assert.equal(fresh.seatW, NOTE.w);
    assert.equal(fresh.seatH, NOTE.h);

    // (ii) dirty height -> overwritten from declared (never left to poison collision).
    rawExec(root, 'UPDATE cards SET height = 0 WHERE id = ?', ['world/inn/a.md']);
    const repaired = await store.reseatLayer('world/inn', [
      { path: 'world/inn/a.md', ...declared('note') },
    ]);
    assert.equal(repaired.length, 1, 'a w|h <= 0 row is repaired');
    const fixed = store.getLayerCards(['world/inn/a.md'])[0];
    assert.equal(fixed.h, NOTE.h);
    assert.equal(fixed.seatH, NOTE.h);
  } finally {
    await cleanup(store, root);
  }
});

// --------------------------------------------------- 01 §5.2 — legacy rows

test('01 §5.2: legacy row (metadata null) is migrated once, then stable on the next reseat', async () => {
  const { store, root } = await tempStore();
  try {
    // The pre-batch shape: a row written by the old code, metadata NULL, and its
    // values EQUAL to the declared form (all 8 rows of holmes-world look like this).
    await store.seatUnplaced('world/inn', [{ path: 'world/inn/a.md', w: CHALK.w, h: CHALK.h }]);
    rawExec(root, 'UPDATE cards SET metadata = NULL WHERE id = ?', ['world/inn/a.md']);
    await store.placeCard('world/inn', 'world/inn/a.md', { x: 111, y: 222 });

    await store.reseatLayer('world/inn', [{ path: 'world/inn/a.md', ...declared('chalk') }]);
    const migrated = store.getLayerCards(['world/inn/a.md'])[0];
    assert.equal(migrated.x, 111, 'x untouched — the player\'s own drag survives (表第 8 行)');
    assert.equal(migrated.y, 222, 'y untouched');
    assert.equal(migrated.formVersion, cardFormVersionOf('chalk', CHALK.w, CHALK.h));
    assert.equal(migrated.seatW, CHALK.w);
    assert.equal(migrated.seatH, CHALK.h);

    assert.deepEqual(
      await store.reseatLayer('world/inn', [{ path: 'world/inn/a.md', ...declared('chalk') }]),
      [],
      'idempotent: the second pass hits 表第 6 行'
    );
  } finally {
    await cleanup(store, root);
  }
});

// --------------------------- 01 §5.1(d) — measured row, no version (race)

test('01 §5.1(d): a row with measuredAt but no formVersion is left alone (race guard, 表第 9 行)', async () => {
  const { store, root } = await tempStore();
  try {
    await store.seatUnplaced('world/inn', [{ path: 'world/inn/a.md', w: CHALK.w, h: CHALK.h }]);
    await store.placeCard('world/inn', 'world/inn/a.md', { x: 50, y: 60 });
    // A `writeFootprints` that has landed but whose row has no version marker yet.
    // Note the row value (260) differs from declared (190): the legacy branch
    // (表第 7 行) would re-seat on it, so 表第 9 行 must win.
    rawExec(root, 'UPDATE cards SET width = 460, height = 260, metadata = ? WHERE id = ?', [
      JSON.stringify({ measuredAt: '2026-09-12T00:00:00.000Z', seatW: 460, seatH: 260 }),
      'world/inn/a.md',
    ]);

    const out = await store.reseatLayer('world/inn', [
      { path: 'world/inn/a.md', ...declared('chalk') },
    ]);
    assert.deepEqual(out, [], 'nothing re-seated, nothing backfilled');
    const row = store.getLayerCards(['world/inn/a.md'])[0];
    assert.equal(row.h, 260, 'the just-measured height survives');
    assert.equal(row.x, 50);
    assert.equal(row.y, 60);
  } finally {
    await cleanup(store, root);
  }
});

// ------------------------------ 01 §7 — no declared kind/version -> skip

test('01 §7: a SeatFile without kind (or formVersion) is skipped, never guessed', async () => {
  const { store, root } = await tempStore();
  try {
    await store.seatUnplaced('world/inn', [{ path: 'world/inn/a.md', w: CHALK.w, h: CHALK.h }]);
    await store.placeCard('world/inn', 'world/inn/a.md', { x: 7, y: 8 });
    const out = await store.reseatLayer('world/inn', [{ path: 'world/inn/a.md', w: CHALK.w, h: 999 }]);
    assert.deepEqual(out, [], 'no version source -> skip');
    assert.equal(store.getLayerCards(['world/inn/a.md'])[0].x, 7, 'nothing moved');

    // The accelerator form: a pre-computed version is enough (no kind needed).
    const viaVersion = await store.reseatLayer('world/inn', [
      { path: 'world/inn/a.md', w: CHALK.w, h: 999, formVersion: cardFormVersionOf('chalk', 460, 999) },
    ]);
    assert.equal(viaVersion.length, 1, 'formVersion alone is accepted');
  } finally {
    await cleanup(store, root);
  }
});

// ------------------------------------------- 01 §10.2 — writeFootprints

test('01 §10.2: writeFootprints is idempotent, id-keyed, and touches only w/h + measuredAt', async () => {
  const { store, root } = await tempStore();
  try {
    await store.seatUnplaced('world/inn', [{ path: 'world/inn/a.md', w: CHALK.w, h: CHALK.h }]);
    await store.reseatLayer('world/inn', [{ path: 'world/inn/a.md', ...declared('chalk') }]);
    await store.placeCard('world/inn', 'world/inn/a.md', { x: 11, y: 22, z: 3 });
    const before = rawRow(root, 'world/inn/a.md');
    const seqBefore = await store.getMaxSeq();

    const a = await store.writeFootprints('world/inn', [{ path: 'world/inn/a.md', w: 460, h: 578 }]);
    assert.deepEqual(a, { updated: 1, unchanged: 0 });
    const afterWrite = rawRow(root, 'world/inn/a.md');
    assert.equal(afterWrite.width, 460);
    assert.equal(afterWrite.height, 578);
    const metaAfter = JSON.parse(afterWrite.metadata);
    assert.ok(metaAfter.measuredAt, 'measuredAt stamped');
    assert.equal(metaAfter.seatH, CHALK.h, '§8 反模式 9: seatH untouched by writeFootprints');
    assert.equal(metaAfter.seatW, CHALK.w, '§8 反模式 9: seatW untouched');
    assert.equal(metaAfter.formVersion, JSON.parse(before.metadata).formVersion, 'formVersion preserved');
    assert.equal(afterWrite.x, before.x, 'x untouched');
    assert.equal(afterWrite.y, before.y, 'y untouched');
    assert.equal(afterWrite.z_index, before.z_index, 'z untouched');
    assert.equal(afterWrite.layer, before.layer, 'layer untouched');

    // Same values again -> no write at all.
    const b = await store.writeFootprints('world/inn', [{ path: 'world/inn/a.md', w: 460, h: 578 }]);
    assert.deepEqual(b, { updated: 0, unchanged: 1 });
    assert.deepEqual(rawRow(root, 'world/inn/a.md'), afterWrite, 'idempotent: row byte-identical');

    assert.equal(await store.getMaxSeq(), seqBefore, '§3.6: no event is appended');
  } finally {
    await cleanup(store, root);
  }
});

test('01 §10.2: unknown path / bad box -> skipped, counted unchanged, nothing else written', async () => {
  const { store, root } = await tempStore();
  try {
    await store.seatUnplaced('world/inn', [{ path: 'world/inn/a.md', w: CHALK.w, h: CHALK.h }]);
    const before = rawRow(root, 'world/inn/a.md');
    const out = await store.writeFootprints('world/inn', [
      { path: 'world/inn/ghost.md', w: 100, h: 100 },
      { path: 'world/inn/a.md', w: Number.NaN, h: 100 },
      { path: 'world/inn/a.md', w: -5, h: 100 },
    ]);
    assert.deepEqual(out, { updated: 0, unchanged: 3 });
    assert.deepEqual(rawRow(root, 'world/inn/a.md'), before, 'a bad box never lands');
    assert.deepEqual(await store.writeFootprints('world/inn', []), { updated: 0, unchanged: 0 });
  } finally {
    await cleanup(store, root);
  }
});

test('01 §3.2: writeFootprints matches by id ONLY — a nested-layer README writes from the map page', async () => {
  const { store, root } = await tempStore();
  try {
    // `world/inn/README.md` is shown on the `map` page but its row's layer is the
    // nested one (BLOCKER-2). Matching on `layer` would skip it and report a
    // misleading `updated: 0`.
    const readme = 'world/inn/README.md';
    await store.seatUnplaced('world/inn', [{ path: readme, w: 288, h: 240 }]);
    const out = await store.writeFootprints('map', [{ path: readme, w: 288, h: 333 }]);
    assert.deepEqual(out, { updated: 1, unchanged: 0 });
    const row = rawRow(root, readme);
    assert.equal(row.height, 333);
    assert.equal(row.layer, 'world/inn', 'layer is never rewritten by the measurement path');
  } finally {
    await cleanup(store, root);
  }
});

// -------------------- 01 §5.1 rows 7/8 — legacy row, size already changed

test('01 §5.1: a legacy row whose stored size differs from declared re-seats once', async () => {
  const { store, root } = await tempStore();
  try {
    await store.seatUnplaced('world/inn', [{ path: 'world/inn/a.md', w: CHALK.w, h: CHALK.h }]);
    // Old code wrote an old constant: neither `formVersion` nor `measuredAt` is
    // present, so only the row-vs-declared comparison can spot it (表第 7 行).
    rawExec(root, 'UPDATE cards SET width = 300, height = 120, metadata = NULL WHERE id = ?', [
      'world/inn/a.md',
    ]);
    const out = await store.reseatLayer('world/inn', [
      { path: 'world/inn/a.md', ...declared('chalk') },
    ]);
    assert.equal(out.length, 1, 'a legacy row at a stale size re-seats');
    const row = store.getLayerCards(['world/inn/a.md'])[0];
    assert.equal(row.w, CHALK.w);
    assert.equal(row.h, CHALK.h);
    assert.equal(row.seatH, CHALK.h, 'the seat baseline is re-established');
    assert.deepEqual(
      await store.reseatLayer('world/inn', [{ path: 'world/inn/a.md', ...declared('chalk') }]),
      []
    );
  } finally {
    await cleanup(store, root);
  }
});

test('01 §3.1: a backfilled sibling stays an obstacle for the card being re-seated', async () => {
  const { store, root } = await tempStore();
  try {
    await store.seatUnplaced('world/inn', [
      { path: 'world/inn/a.md', w: CHALK.w, h: CHALK.h },
      { path: 'world/inn/b.md', w: NOTE.w, h: NOTE.h },
    ]);
    const b = store.getLayerCards(['world/inn/b.md'])[0];
    // `b` is a legacy row at its declared size -> BACKFILL, i.e. it keeps its
    // x/y. `a` is measured-and-moved -> SEAT. The re-seat must not land on `b`.
    rawExec(root, 'UPDATE cards SET metadata = NULL WHERE id = ?', ['world/inn/b.md']);
    rawExec(root, 'UPDATE cards SET height = 578, metadata = ? WHERE id = ?', [
      JSON.stringify({ measuredAt: '2026-09-12T00:00:00.000Z', seatW: 460, seatH: 190 }),
      'world/inn/a.md',
    ]);
    await store.reseatLayer('world/inn', [
      { path: 'world/inn/a.md', ...declared('chalk') },
      { path: 'world/inn/b.md', ...declared('note') },
    ]);
    const a = store.getLayerCards(['world/inn/a.md'])[0];
    const bNow = store.getLayerCards(['world/inn/b.md'])[0];
    assert.equal(bNow.x, b.x, 'the backfilled row did not move');
    assert.equal(bNow.y, b.y, 'the backfilled row did not move');
    const ox = (a.w + bNow.w) / 2 + 22 - Math.abs((a.x + a.w / 2) - (bNow.x + bNow.w / 2));
    const oy = (a.h + bNow.h) / 2 + 22 - Math.abs((a.y + a.h / 2) - (bNow.y + bNow.h / 2));
    assert.ok(ox <= 0 || oy <= 0, 'the re-seated card cleared the unmoved sibling');
  } finally {
    await cleanup(store, root);
  }
});

// ============================================================================
// 05 §10.1 — the four contract-level end-to-end assertions (00 §10.1).
// 01's cases above pin the STORE contract branch-by-branch; these pin the
// OBSERVABLE outcome the batch exists for ("the user does not see two cards
// stacked"). Both layers are needed: (b2) is the only one that can catch
// "data layer green, screen still overlapping".
// ============================================================================

/** Real browser-measured painted heights for one layer (contract §2.3). */
const PAINTED = { a: 578, b: 481, c: 107 }; // a/b chalk (declared 190), c note (declared 168)

/**
 * Seed the fixture exactly like a first page load does: seat at DECLARED, then
 * let the frontend's measured writeback land (w/h + measuredAt, seatW/H kept).
 * Returns the layer id.
 */
async function seedMeasuredLayer(store, root, layer = 'world/bs') {
  const files = [
    { path: `${layer}/a.md`, kind: 'chalk' },
    { path: `${layer}/b.md`, kind: 'chalk' },
    { path: `${layer}/c.md`, kind: 'note' },
  ];
  await store.seatUnplaced(layer, files.map((f) => ({ path: f.path, ...declared(f.kind) })));
  await store.writeFootprints(
    layer,
    files.map((f) => ({ path: f.path, w: CARD_FORMS[f.kind].w, h: PAINTED[f.path.split('/').pop()[0]] }))
  );
  return layer;
}

/** Overlapping painted pairs for a layer, judged at the REAL painted height. */
function paintedOverlaps(store, layer, ids) {
  const rows = store.getLayerCards(ids);
  const pad = 22; // SEAT_PAD
  const hits = [];
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i];
      const b = rows[j];
      const ah = PAINTED[a.id.split('/').pop()[0]];
      const bh = PAINTED[b.id.split('/').pop()[0]];
      const ox = (a.w + b.w) / 2 + pad - Math.abs(a.x + a.w / 2 - (b.x + b.w / 2));
      const oy = (ah + bh) / 2 + pad - Math.abs(a.y + ah / 2 - (b.y + bh / 2));
      if (ox > 0 && oy > 0) hits.push([a.id, b.id]);
    }
  }
  return hits;
}

test('05 §10.1(b2): the layer seat path yields NON-OVERLAPPING painted boxes (core regression)', async () => {
  const { store, root } = await tempStore();
  try {
    const layer = await seedMeasuredLayer(store, root);
    const ids = ['world/bs/a.md', 'world/bs/b.md', 'world/bs/c.md'];

    // The next page load runs the same pass `/api/layer` runs.
    await store.reseatLayer(
      layer,
      ids.map((p) => ({ path: p, ...declared(p.endsWith('c.md') ? 'note' : 'chalk') }))
    );

    const hits = paintedOverlaps(store, layer, ids);
    assert.deepEqual(
      hits,
      [],
      `painted boxes must not overlap once measured heights are known; got ${JSON.stringify(hits)}`
    );
  } finally {
    await cleanup(store, root);
  }
});

test('05 §10.1(b2-null): the same scenario FAILS on a design without the seatH chain (attribution lock)', async () => {
  const { store, root } = await tempStore();
  try {
    const layer = await seedMeasuredLayer(store, root);
    const ids = ['world/bs/a.md', 'world/bs/b.md', 'world/bs/c.md'];

    // Simulate the OLD behaviour: reseatLayer no longer sees the measured move
    // (seatH baseline erased), so the seats stay at the declared size while the
    // cards paint tall -> overlap. This is the pre-fix world, made reachable.
    rawExec(root, 'UPDATE cards SET metadata = NULL WHERE id IN (?, ?, ?)', ids);
    await store.reseatLayer(
      layer,
      ids.map((p) => ({ path: p, ...declared(p.endsWith('c.md') ? 'note' : 'chalk') }))
    );

    const hits = paintedOverlaps(store, layer, ids);
    assert.ok(hits.length > 0, 'without the seatH signal the painted boxes DO overlap (proves (b2) is not vacuous)');
  } finally {
    await cleanup(store, root);
  }
});

test('05 §10.1(a): cards.width/height equals the layer-read path, per card', async () => {
  const { store, root } = await tempStore();
  try {
    const layer = await seedMeasuredLayer(store, root);
    const ids = ['world/bs/a.md', 'world/bs/b.md', 'world/bs/c.md'];
    // The read path consumes row values (02): simulate it with getLayerCards,
    // which is exactly what routes/world.ts `enriched` now uses.
    const read = store.getLayerCards(ids);
    for (const r of read) {
      const raw = rawRow(root, r.id);
      assert.equal(r.w, raw.width, `${r.id}: read w must equal the stored column`);
      assert.equal(r.h, raw.height, `${r.id}: read h must equal the stored column`);
      // The read must reflect the ROW, not the kind's declared constant — and
      // for every card that difference is observable (a/b paint taller than
      // declared chalk; c paints shorter than declared note).
      const kind = r.id.endsWith('c.md') ? 'note' : 'chalk';
      const painted = PAINTED[r.id.split('/').pop()[0]];
      assert.notEqual(painted, CARD_FORMS[kind].h, `${r.id}: fixture must differ from declared (else the case is vacuous)`);
      assert.equal(
        r.h,
        painted,
        `${r.id}: read h must be the MEASURED value (${painted}), not declared ${kind} ${CARD_FORMS[kind].h}`
      );
    }
  } finally {
    await cleanup(store, root);
  }
});

test('05 §10.1(c): measured w/h survive reseatLayer, and the second pass is a no-op (I2)', async () => {
  const { store, root } = await tempStore();
  try {
    const layer = await seedMeasuredLayer(store, root);
    const ids = ['world/bs/a.md', 'world/bs/b.md', 'world/bs/c.md'];
    const declaredFiles = ids.map((p) => ({ path: p, ...declared(p.endsWith('c.md') ? 'note' : 'chalk') }));

    await store.reseatLayer(layer, declaredFiles); // pass 1: may move (that is the fix)
    const after1 = store.getLayerCards(ids).map((r) => ({ id: r.id, x: r.x, y: r.y, w: r.w, h: r.h }));

    for (const r of after1) {
      assert.equal(r.h, PAINTED[r.id.split('/').pop()[0]], `${r.id}: column must hold the MEASURED height, not declared`);
    }

    await store.reseatLayer(layer, declaredFiles); // pass 2: steady state
    const after2 = store.getLayerCards(ids).map((r) => ({ id: r.id, x: r.x, y: r.y, w: r.w, h: r.h }));
    assert.deepEqual(after2, after1, 'the second pass must be a no-op (x/y/w/h all stable)');
  } finally {
    await cleanup(store, root);
  }
});

test('05 §10.1(d): a kind resize re-seats even a measured row and clears measuredAt', async () => {
  const { store, root } = await tempStore();
  try {
    const layer = await seedMeasuredLayer(store, root);
    const p = 'world/bs/a.md';
    // Pretend the kind was resized in code: its stored formVersion no longer matches.
    rawExec(root, 'UPDATE cards SET metadata = ? WHERE id = ?', [
      JSON.stringify({ formVersion: 'stale000', measuredAt: '2026-09-12T00:00:00.000Z', seatW: 460, seatH: 190 }),
      p,
    ]);
    await store.reseatLayer(layer, ['world/bs/a.md', 'world/bs/b.md', 'world/bs/c.md'].map((pp) => ({
      path: pp,
      ...declared(pp.endsWith('c.md') ? 'note' : 'chalk'),
    })));
    const row = store.getLayerCards([p])[0];
    assert.equal(row.h, CARD_FORMS.chalk.h, 're-seated at DECLARED (the measured value was taken at the old width)');
    assert.equal(row.measuredAt, null, 'measuredAt cleared so the next measurement re-baselines');
  } finally {
    await cleanup(store, root);
  }
});
