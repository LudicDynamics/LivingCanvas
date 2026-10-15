import assert from 'node:assert/strict';
import { test } from 'node:test';

import { flowColumns } from '../dist/index.js';

const config = {
  origin: { x: 0, y: 0 },
  columnHeight: 100,
  gapX: 10,
  gapY: 10,
  obstacleGap: 5,
  maxColumns: 8,
};

function overlaps(a, b, gap = 0) {
  return (
    a.x < b.x + b.w + gap &&
    a.x + a.w > b.x - gap &&
    a.y < b.y + b.h + gap &&
    a.y + a.h > b.y - gap
  );
}

test('flowColumns uses the frozen default origin when no config is supplied', () => {
  const result = flowColumns([{ id: 'default', w: 1, h: 1 }], []);
  assert.deepEqual(result.placements, [{ id: 'default', x: 360, y: 96, w: 1, h: 1 }]);
  assert.equal(result.columnsUsed, 1);
  assert.equal(result.exhausted, false);
});

test('flowColumns orders by order then ASCII id and flows top-to-bottom before opening a column', () => {
  const result = flowColumns(
    [
      { id: 'zeta', w: 10, h: 30, order: 2 },
      { id: 'alpha', w: 10, h: 30, order: 1 },
      { id: 'beta', w: 10, h: 30 },
      { id: 'aardvark', w: 10, h: 30 },
    ],
    [],
    config,
  );
  assert.deepEqual(result.placements.map(({ id }) => id), ['alpha', 'zeta', 'aardvark', 'beta']);
  assert.deepEqual(
    result.placements.map(({ x, y }) => ({ x, y })),
    [
      { x: 0, y: 0 },
      { x: 0, y: 40 },
      { x: 20, y: 0 },
      { x: 20, y: 40 },
    ],
  );
  assert.equal(result.columnsUsed, 2);
  assert.equal(result.exhausted, false);
});

test('flowColumns scans right of an old obstacle without changing the old rectangle', () => {
  const old = { id: 'old', x: 15, y: 0, w: 100, h: 20 };
  const occupied = [old];
  const result = flowColumns(
    [
      { id: 'first', w: 10, h: 90 },
      { id: 'second', w: 10, h: 20 },
    ],
    occupied,
    config,
  );

  assert.deepEqual(old, { id: 'old', x: 15, y: 0, w: 100, h: 20 });
  const second = result.placements.find(({ id }) => id === 'second');
  assert.ok(second);
  assert.ok(second.x >= old.x + old.w + config.obstacleGap);
  assert.equal(result.exhausted, false);
});

test('flowColumns permits an oversized card to occupy one column', () => {
  const result = flowColumns(
    [{ id: 'long-chalk', w: 20, h: 220 }],
    [],
    { ...config, columnHeight: 100 },
  );

  assert.deepEqual(result.placements, [{ id: 'long-chalk', x: 0, y: 0, w: 20, h: 220 }]);
  assert.equal(result.columnsUsed, 1);
  assert.equal(result.exhausted, false);
});

test('flowColumns reports exhausted at maxColumns while retaining a deterministic placement', () => {
  const result = flowColumns(
    [
      { id: 'one', w: 20, h: 40 },
      { id: 'two', w: 20, h: 40 },
    ],
    [],
    { ...config, columnHeight: 50, maxColumns: 1, gapY: 0 },
  );

  assert.deepEqual(result.placements[1], { id: 'two', x: 0, y: 45, w: 20, h: 40 });
  assert.equal(overlaps(result.placements[0], result.placements[1], config.obstacleGap), false);
  assert.equal(result.placements.length, 2);
  assert.notDeepEqual(result.placements[1], { id: 'two', x: 360, y: 96, w: 20, h: 40 });
});

test('flowColumns keeps every successful placement clear of occupied and same-batch rectangles', () => {
  const occupied = [
    { id: 'old-a', x: 0, y: 0, w: 25, h: 25 },
    { id: 'old-b', x: 45, y: 0, w: 25, h: 25 },
  ];
  const result = flowColumns(
    [
      { id: 'a', w: 20, h: 20 },
      { id: 'b', w: 20, h: 20 },
      { id: 'c', w: 20, h: 20 },
    ],
    occupied,
    { ...config, origin: { x: 0, y: 0 }, columnHeight: 200 },
  );

  for (const placement of result.placements) {
    for (const old of occupied) assert.equal(overlaps(placement, old, config.obstacleGap), false);
  }
  for (let i = 0; i < result.placements.length; i += 1) {
    for (let j = i + 1; j < result.placements.length; j += 1) {
      assert.equal(overlaps(result.placements[i], result.placements[j], config.obstacleGap), false);
    }
  }
});
