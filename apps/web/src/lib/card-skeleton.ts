/**
 * Skeleton shape for the `component` phantom lane.
 *
 * A component card is born from a writer `write`; the server announces it with a
 * `card_writing` frame carrying the resolved `kind`. This module turns that kind
 * into a *structure-only* shape — bands of grey lines plus a material vocabulary
 * flag — so `CardSkeleton` can sketch the card's footprint BEFORE the file
 * lands. It is a pure function: no React, no DOM, no I/O.
 *
 * The chrome is read from the ONE size/identity table (`CARD_FORMS`); we never
 * keep a second kind list here — a new kind picks up its skeleton for free.
 */

import { CARD_FORMS } from '@airp/shared/forms';

/** The eight material tiers. Matches `CardChrome`. */
export type SkeletonChrome =
  | 'paper'
  | 'note'
  | 'slab'
  | 'board'
  | 'panel'
  | 'scroll'
  | 'cover'
  | 'bare';

/** One grey placeholder line: `w` = percent of the inner width (1–100), `h` = px. */
export interface SkeletonLine {
  w: number;
  h: number;
}

/**
 * The material vocabulary switches for a chrome tier.
 *
 * `ruled` / `inset` / `grid` / `wash` are **CSS-only switches** (expressed as a
 * class on the root or an existing node) — MUST NOT build a DOM element for
 * them. Only `clip` / `block` / `band` / `seal` /
 * `edges` map to real child elements.
 */
export interface SkeletonDecor {
  /** CSS only: ruled notepaper lines. */
  ruled: boolean;
  /** Element: the note's paper clip. */
  clip: boolean;
  /** Element: the slab's centre panel. */
  block: boolean;
  /** CSS only: the slab's inner shading. */
  inset: boolean;
  /** CSS only: the board's grid texture. */
  grid: boolean;
  /** CSS only: the panel's pale ink wash. */
  wash: boolean;
  /** Element: the cover's top band. */
  band: boolean;
  /** Element: the cover's numbered seal. */
  seal: boolean;
  /** Elements: the scroll's two ruled edges. */
  edges: boolean;
}

export interface SkeletonShape {
  chrome: SkeletonChrome;
  /** `false` = draw nothing (the `bare` tier: chalk / sprite / portrait). */
  visible: boolean;
  lines: SkeletonLine[];
  decor: SkeletonDecor;
}

/** Top gap (px) reserved for the paper edge / colour band / seal. */
const LINE_TOP = 44;
/** Line pitch (px). */
const LINE_PITCH = 34;
/** Deterministic ragged-line pattern, taken by row index modulo. */
const WIDTHS = [92, 78, 86, 60, 74, 66];

/** Per-tier line-count clamp `[min, max]`; `form.h` drives the raw count. */
const LINES_BAND: Record<SkeletonChrome, [number, number]> = {
  paper: [3, 4],
  note: [3, 3],
  panel: [2, 5],
  cover: [2, 4],
  slab: [0, 0],
  board: [0, 0],
  scroll: [0, 0],
  bare: [0, 0],
};

/** Per-tier material switches. `bare` is all-false (it never renders). */
const DECOR_BY_CHROME: Record<SkeletonChrome, SkeletonDecor> = {
  paper: { ruled: false, clip: false, block: false, inset: false, grid: false, wash: false, band: false, seal: false, edges: false },
  note: { ruled: true, clip: true, block: false, inset: false, grid: false, wash: false, band: false, seal: false, edges: false },
  slab: { ruled: false, clip: false, block: true, inset: true, grid: false, wash: false, band: false, seal: false, edges: false },
  board: { ruled: false, clip: false, block: false, inset: false, grid: true, wash: false, band: false, seal: false, edges: false },
  panel: { ruled: false, clip: false, block: false, inset: false, grid: false, wash: true, band: false, seal: false, edges: false },
  scroll: { ruled: false, clip: false, block: false, inset: false, grid: false, wash: false, band: false, seal: false, edges: true },
  cover: { ruled: false, clip: false, block: false, inset: false, grid: false, wash: false, band: true, seal: true, edges: false },
  bare: { ruled: false, clip: false, block: false, inset: false, grid: false, wash: false, band: false, seal: false, edges: false },
};

/** Clamp `n` into `[lo, hi]`. */
function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Shape for a resolved component kind (the server's `card_writing.kind`).
 *
 * Unknown kinds, and `undefined`, fall back to the `paper` tier via
 * `CARD_FORMS.default` — this function always returns a non-empty shape so a
 * test (and `CardSkeleton`) can call it for any string.
 * Registration-time rejection of unknown/bare/gate kinds is `cardWritingGuard`.
 */
export function skeletonShapeFor(kind: string | undefined): SkeletonShape {
  const form = (kind !== undefined ? CARD_FORMS[kind] : undefined) ?? CARD_FORMS.default;
  const chrome = form.chrome as SkeletonChrome;
  const [min, max] = LINES_BAND[chrome];
  const count = clamp(Math.floor((form.h - LINE_TOP) / LINE_PITCH), min, max);
  // `panel` reads as an instrument face: equal-width bars, no ragged pattern.
  const widths = chrome === 'panel' ? new Array(count).fill(80) : WIDTHS.slice(0, count);
  return {
    chrome,
    visible: chrome !== 'bare',
    // Fresh arrays/objects every call — never leak a shared frozen reference.
    lines: widths.map((w) => ({ w, h: 10 })),
    decor: { ...DECOR_BY_CHROME[chrome] },
  };
}

/**
 * Whitelist gate for registering a `card_writing` phantom (the design notes
 * §3.1⑤, rulings F + M + O).
 *
 * A skeleton may only be registered when the write will actually land in some
 * layer's `items` — otherwise `reconcileLanded` (path-keyed) never removes it
 * and the phantom leaks forever (F-10). So: a known non-`bare` form, a kind
 * that is not `gate` (README never enters `items`), and a resolved non-empty
 * layer. Pure: no React / DOM.
 */
export function cardWritingGuard(
  form: { chrome: SkeletonChrome } | undefined,
  kind: string | undefined,
  layer: string | undefined
): boolean {
  return !!form && form.chrome !== 'bare' && kind !== 'gate' && typeof layer === 'string' && layer !== '';
}
