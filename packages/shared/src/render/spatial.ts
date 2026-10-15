import { CARD_FORMS } from '../schemas/forms.js';

/**
 * Spatial humanization (doc-03 §5.4). Pure, no I/O: turns box geometry into the
 * words a reader can act on. Coordinates never leave this module — the whole
 * point of `look_at`'s Layout and `view_canvas`'s Relative block is that a
 * distance becomes a phrase (doc-22 §5: the granularity of a direction word is
 * itself the quantification).
 *
 * Vocabulary and thresholds are frozen by doc-03 §5.4 / §13.1.
 */

/** An axis-aligned canvas box in CSS px. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Normalized centre distance: 1.0 == the two boxes are one average box apart. */
export function normalDistance(a: Box, b: Box): number {
  const dx = a.x + a.w / 2 - (b.x + b.w / 2);
  const dy = a.y + a.h / 2 - (b.y + b.h / 2);
  return Math.hypot(dx / ((a.w + b.w) / 2), dy / ((a.h + b.h) / 2));
}

/**
 * Axis-aligned intersection. Touching edges do NOT count (`<`, never `<=`):
 * a card flush against another is not "stacked" in the sense the player sees
 * (doc-03 §13.1).
 */
export function boxesOverlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * One relationship phrase for `subject` as seen from `anchor`.
 *
 * Thresholds (doc-03 §5.4): both axis gaps within half an average box →
 * `right on top of` (d ≤ 0.4) or `overlapping`; d ≤ 1 → `next to`; otherwise
 * `<above|below>[-<left|right>] of`, with a `far ` prefix past d > 2.5.
 */
export function dirPhrase(subject: Box, anchor: Box): string {
  const dx = subject.x + subject.w / 2 - (anchor.x + anchor.w / 2);
  const dy = subject.y + subject.h / 2 - (anchor.y + anchor.h / 2);
  const avgW = (subject.w + anchor.w) / 2;
  const avgH = (subject.h + anchor.h) / 2;

  const horizontal = dx > 0.5 * avgW ? 'right' : dx < -0.5 * avgW ? 'left' : '';
  const vertical = dy > 0.5 * avgH ? 'below' : dy < -0.5 * avgH ? 'above' : '';
  const d = Math.hypot(dx / avgW, dy / avgH);

  if (!horizontal && !vertical) return d <= 0.4 ? 'right on top of' : 'overlapping';
  if (d <= 1.0) return 'next to';

  const direction = vertical && horizontal ? `${vertical}-${horizontal}` : vertical || horizontal;
  return `${d > 2.5 ? 'far ' : ''}${direction} of`;
}

/**
 * One line per item, pointing at its nearest neighbour. O(n) output — never the
 * full O(n²) graph, because 12 cards would otherwise produce 66 lines
 * (doc-03 §4.2 rule 8).
 *
 * `dir` reads from `path` toward `other`, so the caller prints
 * `<path> — <dir> <other>` with the subject first (doc-03 §13.1).
 */
export function nearestNeighbours(
  items: Array<{ path: string; box: Box }>
): Array<{ path: string; dir: string; other: string }> {
  const out: Array<{ path: string; dir: string; other: string }> = [];
  for (const item of items) {
    let best: { path: string; box: Box } | null = null;
    let bestDistance = Infinity;
    for (const other of items) {
      if (other.path === item.path) continue;
      const d = normalDistance(item.box, other.box);
      if (d < bestDistance) {
        bestDistance = d;
        best = other;
      }
    }
    if (best) out.push({ path: item.path, dir: dirPhrase(item.box, best.box), other: best.path });
  }
  return out;
}

/**
 * A character's footprint box from a presence POINT (02 §3.3 ruling A).
 *
 * Presence `x`/`y` are the avatar CENTRE (`world-store.ts:31`), so they cannot
 * feed a `Box`-shaped function directly: a zero-width box divides `dirPhrase`'s
 * gaps by `(a.w + b.w) / 2` and turns every direction into `Infinity`/`NaN`.
 * The size is NOT invented — `seatPresence` already models a presence with
 * `CARD_FORMS.sprite` when it seats and collision-checks one (`local-store.ts:1005`).
 * Using the engine's own occupancy model keeps the thresholds relative and
 * avoids a second vocabulary of distances (02 §3.3).
 */
export function spriteBox(at: { x: number; y: number }): Box {
  const { w, h } = CARD_FORMS.sprite;
  return { x: at.x - w / 2, y: at.y - h / 2, w, h };
}

/** A placed card the presence phrase can point at (02 §3.3). */
export interface Anchor {
  path: string;
  /** Top-left rectangle, straight from `cards` (`store.getLayerCards`). */
  box: Box;
  name: string;
}

/**
 * Where a point stands relative to its NEAREST anchor, plus that anchor's
 * display name. `null` when the layer has no placed card — the caller then says
 * `somewhere in this layer` rather than pretending to know (02 §3.3).
 */
export function presencePhrase(
  at: { x: number; y: number },
  anchors: Anchor[]
): { dir: string; anchorPath: string; anchorName: string } | null {
  if (anchors.length === 0) return null;
  const subject = spriteBox(at);
  let best = anchors[0];
  let bestD = normalDistance(subject, anchors[0].box);
  for (const a of anchors.slice(1)) {
    const d = normalDistance(subject, a.box);
    if (d < bestD) {
      bestD = d;
      best = a;
    }
  }
  return { dir: dirPhrase(subject, best.box), anchorPath: best.path, anchorName: best.name };
}

/**
 * One `cast` / `Also here` row (02 §3.3): `  <id> — <dir> "<anchor name>"`.
 * ` · following you` only exists in the writer's view AND only when true —
 * a character has no reader value for "who follows the player" (02 §3.2).
 */
export function castLine(
  id: string,
  at: { x: number; y: number },
  anchors: Anchor[],
  opts: { following?: boolean; role: 'writer' | 'character' }
): string {
  const p = presencePhrase(at, anchors);
  const where = p ? `${p.dir} "${p.anchorName}"` : 'somewhere in this layer';
  const tail = opts.role === 'writer' && opts.following ? ' · following you' : '';
  return `  ${id} — ${where}${tail}`;
}
