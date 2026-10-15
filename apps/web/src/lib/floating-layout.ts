/**
 * Floating-panel layout
 *
 *
 * The screen is shared by fixed chrome that already owns its region — the top
 * bar, the left options rail, the right character rail, the bottom row (player
 * orb · bag · writer button). A panel that floats over the canvas (the writer
 * sheet) is placed into the free slot that covers the least of that chrome,
 * instead of a hard-coded corner that lands on whatever happens to be there on
 * this viewport.
 *
 * Pure geometry: no DOM, so the rule is unit-tested (apps/web/test/
 * floating-layout.test.mjs) and the hook (`use-floating-panel.ts`) only
 * measures and applies.
 *
 * Obstacles are `hard` (a control that must stay pressable) or `soft` (a long
 * rail that can shrink above the panel — the character rail scrolls). Hard
 * overlap always outweighs soft overlap; among equal scores the earlier slot
 * (the designer's preference order) wins.
 */

export interface Rect { x: number; y: number; w: number; h: number }
export interface Size { w: number; h: number }
export interface Obstacle extends Rect { soft?: boolean; name?: string }

/** Where a slot hangs the panel from. `x`/`y` are viewport px for the anchor point. */
export interface Slot {
  name: string;
  /** Which corner of the panel sits on the anchor point. */
  corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'bottom-center';
  x: number;
  y: number;
}

export interface Placement extends Rect {
  slot: string;
  /** Overlap area with hard chrome (0 = nothing pressable is covered). */
  hard: number;
  /** Overlap area with soft chrome (rails that shrink above the panel). */
  soft: number;
}

/** Keeps panels off the very edge and out of the notch / home-indicator area. */
export interface SafeArea { top: number; right: number; bottom: number; left: number }
const NO_INSET: SafeArea = { top: 0, right: 0, bottom: 0, left: 0 };
export const EDGE_MARGIN = 8;

export function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Clamp a rect fully inside the viewport (minus margin and safe area); a rect bigger than the room is pinned top-left. */
export function clampToViewport(rect: Rect, viewport: Size, safe: SafeArea = NO_INSET, margin = EDGE_MARGIN): Rect {
  const minX = safe.left + margin;
  const minY = safe.top + margin;
  const maxX = viewport.w - safe.right - margin - rect.w;
  const maxY = viewport.h - safe.bottom - margin - rect.h;
  return {
    ...rect,
    x: Math.round(Math.max(minX, Math.min(maxX, rect.x))),
    y: Math.round(Math.max(minY, Math.min(maxY, rect.y))),
  };
}

export function rectAt(slot: Slot, size: Size): Rect {
  switch (slot.corner) {
    case 'top-left': return { x: slot.x, y: slot.y, ...size };
    case 'top-right': return { x: slot.x - size.w, y: slot.y, ...size };
    case 'bottom-left': return { x: slot.x, y: slot.y - size.h, ...size };
    case 'bottom-right': return { x: slot.x - size.w, y: slot.y - size.h, ...size };
    case 'bottom-center': return { x: slot.x - size.w / 2, y: slot.y - size.h, ...size };
  }
}

export function scoreRect(rect: Rect, obstacles: readonly Obstacle[]): { hard: number; soft: number } {
  let hard = 0;
  let soft = 0;
  for (const o of obstacles) {
    const a = overlapArea(rect, o);
    if (o.soft) soft += a; else hard += a;
  }
  return { hard, soft };
}

/**
 * Pick the slot whose (clamped) rect covers the least hard chrome, then the
 * least soft chrome. Ties keep the caller's order.
 */
export function placeFloating(input: {
  viewport: Size;
  size: Size;
  obstacles: readonly Obstacle[];
  slots: readonly Slot[];
  safe?: SafeArea;
  margin?: number;
}): Placement {
  const { viewport, size, obstacles, slots, safe = NO_INSET, margin = EDGE_MARGIN } = input;
  let best: Placement | null = null;
  for (const slot of slots) {
    const rect = clampToViewport(rectAt(slot, size), viewport, safe, margin);
    const { hard, soft } = scoreRect(rect, obstacles);
    if (!best || hard < best.hard || (hard === best.hard && soft < best.soft)) {
      best = { ...rect, slot: slot.name, hard, soft };
    }
  }
  if (best) return best;
  const rect = clampToViewport({ x: viewport.w - size.w, y: viewport.h - size.h, ...size }, viewport, safe, margin);
  return { ...rect, slot: 'fallback', ...scoreRect(rect, obstacles) };
}

/**
 * Like `placeFloating`, but when every slot still covers hard chrome the panel
 * may narrow (down to `minWidth`) to fit beside it — a phone held upright with
 * the options rail's grip on the left edge has no 366px-wide free band, but it
 * has a 330px one.
 */
export function placeFloatingFit(input: Parameters<typeof placeFloating>[0] & { minWidth?: number }): Placement {
  const { minWidth = 280, ...rest } = input;
  let best = placeFloating(rest);
  if (best.hard === 0) return best;
  for (const factor of [0.92, 0.85, 0.78, 0.7]) {
    const w = Math.round(rest.size.w * factor);
    if (w < minWidth) break;
    const next = placeFloating({ ...rest, size: { w, h: rest.size.h } });
    if (next.hard < best.hard) best = next;
    if (best.hard === 0) break;
  }
  return best;
}

/**
 * The writer sheet's candidate slots, in preference order, derived from where
 * its button sits (`anchor`): straight above the button (its home since
 * the design notes), left of the button on the bottom row, bottom-centre, then the
 * free middle-left band under the top bar. The viewport decides which of these
 * is clear; nothing here is per-device.
 */
export function writerSheetSlots(viewport: Size, anchor: Rect, gap = 10): Slot[] {
  const top = 72;
  return [
    { name: 'above-button', corner: 'bottom-right', x: anchor.x + anchor.w, y: anchor.y - gap },
    { name: 'beside-button', corner: 'bottom-right', x: anchor.x - gap, y: anchor.y + anchor.h },
    { name: 'bottom-center', corner: 'bottom-center', x: viewport.w / 2, y: anchor.y + anchor.h },
    { name: 'above-center', corner: 'bottom-center', x: viewport.w / 2, y: anchor.y - gap },
    { name: 'middle-left', corner: 'top-left', x: 96, y: top + 100 },
    { name: 'top-left', corner: 'top-left', x: 0, y: top },
  ];
}

/** A remembered drag position, re-clamped to today's viewport (a rotated phone, a smaller window). */
export function restorePosition(saved: { x: number; y: number } | null, size: Size, viewport: Size, safe: SafeArea = NO_INSET): Rect | null {
  if (!saved || !Number.isFinite(saved.x) || !Number.isFinite(saved.y)) return null;
  return clampToViewport({ x: saved.x, y: saved.y, ...size }, viewport, safe);
}

/** True when the panel cannot show its labels comfortably: icons only, secondary tools folded into one menu. */
export function isCompactViewport(viewport: Size): boolean {
  return viewport.w < 600 || viewport.h < 500;
}
