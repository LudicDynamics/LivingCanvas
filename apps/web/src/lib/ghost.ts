/**
 * Image-ghost helpers — pure functions for the `image_generation_progress` /
 * `image_landed` lane. No React, no DOM: the sizes, the
 * progress copy, and the layer filter are all testable in isolation.
 *
 * Owner: the design notes
 */
/** How long a landed image ghost lingers before the real card's refetch wins. */
export const LANDED_DWELL_MS = 15_000;
/** Same, when the image was a cache hit (no real generation happened). */
export const REUSED_DWELL_MS = 5_000;
/** Ambient bed started while an image generates. */
export const GHOST_WAIT_AMBIENT = 'rain';

const GHOST_W = 320;
const GHOST_H_MIN = 180;
const GHOST_H_MAX = 420;

/** Clamp a possibly-missing numeric field. */
export function asNum(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** Box for an image ghost: honour the announced size, else a tall default. */
export function ghostSizeFor(w?: unknown, h?: unknown): { w: number; h: number } {
  const width = asNum(w) ?? GHOST_W;
  const rawH = asNum(h);
  const height = rawH === undefined ? Math.round(GHOST_W * 0.75) : rawH;
  return {
    w: Math.max(80, Math.round(width)),
    h: Math.min(GHOST_H_MAX, Math.max(GHOST_H_MIN, Math.round(height))),
  };
}

/** One-line progress copy; `elapsedMs` makes a stalled generation legible. */
export function stageText(stage?: unknown, elapsedMs?: unknown): string {
  const secs = asNum(elapsedMs);
  const since = secs === undefined ? '' : ` · ${Math.round(secs / 1000)}s`;
  switch (stage) {
    case 'resolving':
      return `Preparing…${since}`;
    case 'generating':
      return `Painting…${since}`;
    default:
      return `Waiting for the image…${since}`;
  }
}

/** Layer filter: undefined entry layer = don't filter (tolerate older frames). */
export function ghostVisibleOn(entryLayer: string | undefined, currentLayer: string): boolean {
  return entryLayer === undefined || entryLayer === currentLayer;
}
