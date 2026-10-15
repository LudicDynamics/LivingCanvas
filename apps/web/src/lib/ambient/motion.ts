/**
 * Human-ish pointer motion for the ambient cursors (pure, no DOM).
 *
 * A hand does not travel in a straight line at constant speed: it curves a
 * little, accelerates, overshoots the target by a few pixels and settles back,
 * with a tremor too small to read as noise. `glidePath` returns world-pixel
 * keyframes for the Web Animations API (compositor `transform` only), so the
 * whole move costs no React render and no per-frame script.
 */

export interface Point {
  x: number;
  y: number;
}

export interface GlideFrame extends Point {
  /** 0..1, monotonic. */
  offset: number;
}

export interface GlidePlan {
  frames: GlideFrame[];
  durationMs: number;
}

export type Rng = () => number;

/** Glide duration bounds (ms) — Fitts-ish: longer moves take longer, within reason. */
export const GLIDE_MIN_MS = 520;
export const GLIDE_MAX_MS = 1500;
const STEPS = 14;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Ease-in-out (cubic): a hand speeds up, then slows into the target. Continuous, 0→0, 1→1. */
export function handEase(t: number): number {
  const u = clamp(t, 0, 1);
  return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
}

export function glideDuration(from: Point, to: Point): number {
  const d = Math.hypot(to.x - from.x, to.y - from.y);
  return Math.round(clamp(GLIDE_MIN_MS + Math.sqrt(d) * 26, GLIDE_MIN_MS, GLIDE_MAX_MS));
}

/**
 * Curved path from `from` to `to` with a small overshoot and settle. Distance 0
 * returns a two-frame hold. Every frame is finite; offsets run 0 → 1.
 */
export function glidePath(from: Point, to: Point, rng: Rng): GlidePlan {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  if (!Number.isFinite(dist) || dist < 1) {
    return { frames: [{ ...from, offset: 0 }, { ...to, offset: 1 }], durationMs: GLIDE_MIN_MS };
  }
  const durationMs = glideDuration(from, to);
  // Normal to the travel direction; the bow is 6–18% of the distance, either side.
  const nx = -dy / dist;
  const ny = dx / dist;
  const bow = (0.06 + rng() * 0.12) * dist * (rng() < 0.5 ? -1 : 1);
  const c = { x: from.x + dx * 0.5 + nx * bow, y: from.y + dy * 0.5 + ny * bow };
  // Overshoot 2–5% past the target (at most 14px), along the travel direction.
  const over = Math.min(14, dist * (0.02 + rng() * 0.03));
  const past = { x: to.x + (dx / dist) * over, y: to.y + (dy / dist) * over };
  const frames: GlideFrame[] = [];
  // 82% of the time is the travel to the overshoot point; the rest settles back.
  const travel = 0.82;
  for (let i = 0; i <= STEPS; i++) {
    const s = i / STEPS;
    const t = handEase(s);
    const a = (1 - t) * (1 - t);
    const b = 2 * (1 - t) * t;
    const e = t * t;
    const tremor = i > 0 && i < STEPS ? (rng() - 0.5) * Math.min(3, dist / 120) : 0;
    frames.push({
      x: a * from.x + b * c.x + e * past.x + tremor * nx,
      y: a * from.y + b * c.y + e * past.y + tremor * ny,
      offset: s * travel,
    });
  }
  frames.push({ x: to.x, y: to.y, offset: 1 });
  return { frames, durationMs };
}

/** A small "drag and put back" wiggle for a card: px offsets, back to 0. */
export function nudgeOffsets(rng: Rng): Point[] {
  const ax = (rng() < 0.5 ? -1 : 1) * (4 + rng() * 6);
  const ay = (rng() - 0.5) * 6;
  return [{ x: 0, y: 0 }, { x: ax, y: ay }, { x: ax * 0.9, y: ay * 0.9 }, { x: 0, y: 0 }];
}

/** Seedable RNG (mulberry32) for tests and reproducible screenshots. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
