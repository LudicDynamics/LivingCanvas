/**
 * Seating mirror of the server's seatUnplaced (plan §3.4): same Ulam spiral,
 * same anchor/step constants, same PAD-disjoint judgement. P0 does NOT wire
 * this into the main path (seating happens server-side and persists) — it
 * exists for a fallback display under races and for the T3.4 ghostWrite seat
 * preview. Constants must stay isomorphic with packages/shared local-store.
 */

import { PAD, makeBox, overlap, type Box } from './collide.js';

export const SEAT_ANCHOR = { x: 960, y: 540 };
export const SEAT_STEP = 96;
export const SEAT_MAX_CANDIDATES = 100;

// Ulam spiral cells: R -> D -> L -> U, step lengths [1,1,2,2,3,3,...], starting
// at (0,0). Same generator shape as the server (local-store spiralCells).
function* spiralCells(): Generator<[number, number]> {
  const dirs: Array<[number, number]> = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ];
  let x = 0;
  let y = 0;
  yield [x, y];
  let step = 1;
  let dir = 0;
  while (true) {
    for (let i = 0; i < 2; i++) {
      for (let s = 0; s < step; s++) {
        x += dirs[dir][0];
        y += dirs[dir][1];
        yield [x, y];
      }
      dir = (dir + 1) % 4;
    }
    step++;
  }
}

/**
 * First spiral cell (anchored at `anchor`, stepped by SEAT_STEP) whose box of
 * `w × h` does not overlap any box in `occupied`. Returns the top-left corner.
 * After SEAT_MAX_CANDIDATES tries, falls below occupied bounds rather than
 * overlapping the centre. This fallback is for provisional client seats.
 */
export function seatSpiral(
  anchor: { x: number; y: number },
  occupied: Box[],
  w: number,
  h: number
): { x: number; y: number } {
  let tries = 0;
  for (const [gx, gy] of spiralCells()) {
    if (tries++ >= SEAT_MAX_CANDIDATES) break;
    const cx = anchor.x + gx * SEAT_STEP;
    const cy = anchor.y + gy * SEAT_STEP;
    const cand = makeBox(cx - w / 2, cy - h / 2, w, h);
    if (!occupied.some((o) => overlap(cand, o, PAD))) {
      return { x: cand.l, y: cand.t };
    }
  }
  // A crowded search window must not stack new text at its centre.
  return {
    x: anchor.x - w / 2,
    y: Math.max(anchor.y - h / 2, ...occupied.map(box => box.t + box.h + PAD)),
  };
}
