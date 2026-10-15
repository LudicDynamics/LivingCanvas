// Phantom seating assertions.
import assert from 'node:assert/strict';
import { test } from 'node:test';

let seating = null;
let phantom = null;
try {
  const { createJiti } = await import('../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs');
  const jiti = createJiti(import.meta.url, { moduleCache: true, tryNative: false });
  phantom = await jiti.import('../src/lib/phantom.js');
  seating = await jiti.import('../src/lib/phantom-seat.ts');
} catch (err) {
  console.error('jiti/bootstrap unavailable, skipping phantom group:', err?.message ?? err);
}
const { register, land, drop, evict, reconcileLanded, getPhantomsSnapshot } = phantom ?? {};
const skip = seating && phantom ? false : 'jiti or shared build unavailable';
const { phantomSeatFor, publishSeatItems } = seating ?? {};

function overlapArea(a, b) {
  const width = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return width * height;
}

test('two same-layer Chalk phantoms receive disjoint seats', { skip }, () => {
  const layer = 'phantom-test/chalk-overlap';
  publishSeatItems(layer, []);
  const first = phantomSeatFor({ w: 460, h: 190 }, layer);
  register('chalk-overlap-a', { kind: 'chalk', source: 'writer', seat: first.seat, layer });
  assert.equal(getPhantomsSnapshot().some((entry) => entry.toolCallId === 'chalk-overlap-a'), true);
  const second = phantomSeatFor({ w: 460, h: 190 }, layer);

  assert.equal(second.occupied.some((rect) => rect.id === 'chalk-overlap-a'), true);
  assert.equal(overlapArea(first.seat, second.seat), 0);
  drop('chalk-overlap-a');
});

test('real rows occupy the shared flow obstacle set', { skip }, () => {
  const layer = 'phantom-test/real-row';
  const row = { x: 360, y: 96, w: 460, h: 190, z: 7 };
  publishSeatItems(layer, [row]);
  const next = phantomSeatFor({ w: 460, h: 190 }, layer);

  assert.equal(next.occupied.some((rect) => rect.x === row.x && rect.y === row.y), true);
  assert.equal(overlapArea(next.seat, row), 0);
});

test('rows from another layer do not affect phantom seating', { skip }, () => {
  publishSeatItems('phantom-test/other-layer', [{ x: 360, y: 96, w: 460, h: 190, z: 9 }]);
  const next = phantomSeatFor({ w: 460, h: 190 }, 'phantom-test/current-layer');

  assert.deepEqual(
    { x: next.seat.x, y: next.seat.y },
    { x: 360, y: 96 },
  );
  assert.equal(next.occupied.length, 0);
});

test('landing transfers the path without changing the phantom seat', { skip }, () => {
  const layer = 'phantom-test/landing';
  publishSeatItems(layer, []);
  const before = phantomSeatFor({ w: 320, h: 240 }, layer).seat;
  register('land-seat', { kind: 'chalk', source: 'writer', seat: before, layer });
  land('land-seat', { path: 'world/landed.md' });

  const landed = getPhantomsSnapshot().find((entry) => entry.toolCallId === 'land-seat');
  assert.deepEqual(landed?.seat, before);
  assert.equal(landed?.path, 'world/landed.md');
  reconcileLanded(new Set(['world/landed.md']));
  assert.equal(getPhantomsSnapshot().some((entry) => entry.toolCallId === 'land-seat'), false);
});

// the design notes — ruling L / F-7. A failed `write` gets `tool_end{isError}`
// (→ evict) followed by the unconditional `chalk_landed` (→ land). Without the
// phase guard in `land()`, the late `land` resurrects the phantom as 'landed' and
// the evicted-drop never fires, so the skeleton sticks forever. Non-emptiness:
// drop the `if (entry.phase === 'evicted') return;` line and this reads 'landed'.
test('a late land cannot resurrect an evicted phantom', { skip }, () => {
  const layer = 'phantom-test/evict-land';
  publishSeatItems(layer, []);
  const seat = phantomSeatFor({ w: 200, h: 168 }, layer).seat;
  register('evict-then-land', { kind: 'component', source: 'writer', seat, layer, cardKind: 'note' });
  evict('evict-then-land');
  land('evict-then-land', { path: 'world/never-written.md' });

  const entry = getPhantomsSnapshot().find((e) => e.toolCallId === 'evict-then-land');
  assert.equal(entry?.phase, 'evicted');
  drop('evict-then-land');
});
