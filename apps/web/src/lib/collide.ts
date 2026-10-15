/**
 * Soft-collision math (v2 prototype, 画布世界v2-niko.html L279-300), pure
 * functions only — no DOM, no React. Callers write the returned offsets into
 * element positions (drag: direct DOM writes; drop: merged into React state
 * and persisted via POST /api/card/position).
 *
 * Boxes are the UNROTATED layout box: `rot` never participates (plan §6.8).
 */

/** Collision padding around card bounds, world px (v2 L279). */
export const PAD = 22;

export interface Box {
  l: number;
  t: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
}

export function makeBox(l: number, t: number, w: number, h: number): Box {
  return { l, t, w, h, cx: l + w / 2, cy: t + h / 2 };
}

function overlapAmounts(a: Box, b: Box, pad = PAD): { ox: number; oy: number } {
  return {
    ox: (a.w + b.w) / 2 + pad - Math.abs(a.cx - b.cx),
    oy: (a.h + b.h) / 2 + pad - Math.abs(a.cy - b.cy),
  };
}

/** True when two boxes overlap (including padding). */
export function overlap(a: Box, b: Box, pad = PAD): boolean {
  const { ox, oy } = overlapAmounts(a, b, pad);
  return ox > 0 && oy > 0;
}

/**
 * Push every box in `others` that overlaps `drag` away from it (v2 L282-288):
 * the shallower axis wins (ox < oy → horizontal, else vertical) and the shift
 * is 0.72× the overlap. Returns per-other-index offsets the caller applies.
 */
export function pushFrom(
  drag: Box,
  others: Box[]
): Array<{ i: number; dx: number; dy: number }> {
  const out: Array<{ i: number; dx: number; dy: number }> = [];
  for (let i = 0; i < others.length; i++) {
    const o = others[i];
    const { ox, oy } = overlapAmounts(drag, o);
    if (ox <= 0 || oy <= 0) continue;
    if (ox < oy) {
      const dir = o.cx >= drag.cx ? 1 : -1;
      out.push({ i, dx: ox * 0.72 * dir, dy: 0 });
    } else {
      const dir = o.cy >= drag.cy ? 1 : -1;
      out.push({ i, dx: 0, dy: oy * 0.72 * dir });
    }
  }
  return out;
}

/**
 * Resolve residual overlap across all boxes: 4 full pair-wise rounds, each
 * overlapping pair split in half (±ox*0.5 / ±oy*0.5) like v2 L289-297. Boxes
 * are mutated in place as the iteration progresses (mirrors the prototype's
 * interleaved physics); the returned accumulated offsets are what the caller
 * applies to the DOM, and equal the boxes' final minus initial positions.
 */
export function relaxAll(boxes: Box[]): Array<{ i: number; dx: number; dy: number }> {
  const acc: Array<{ i: number; dx: number; dy: number }> = [];
  for (let round = 0; round < 4; round++) {
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        const { ox, oy } = overlapAmounts(a, b);
        if (ox <= 0 || oy <= 0) continue;
        const sx = ox * 0.5;
        const sy = oy * 0.5;
        const ax = a.cx <= b.cx ? -sx : sx;
        const ay = a.cy <= b.cy ? -sy : sy;
        a.l += ax;
        a.cx += ax;
        a.t += ay;
        a.cy += ay;
        acc.push({ i, dx: ax, dy: ay });
        const bx = -ax;
        const by = -ay;
        b.l += bx;
        b.cx += bx;
        b.t += by;
        b.cy += by;
        acc.push({ i: j, dx: bx, dy: by });
      }
    }
  }
  return acc;
}
