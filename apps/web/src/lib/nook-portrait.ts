/**
 * Pure geometry + persistence for the Nook portrait's direct-manipulation
 * position. The React component owns
 * pointer/keyboard wiring and rAF transforms; every decision about *where the
 * portrait may sit* lives here so it can be tested without a DOM.
 *
 * The anchor is the portrait's CENTRE, normalised to the Nook stage, in [0,1].
 */

export interface PortraitAnchor {
  x: number;
  y: number;
}

export interface PortraitBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Fallback bounds when no stage/footprint is measurable (SSR, zero boxes). */
export const DEFAULT_PORTRAIT_BOUNDS: PortraitBounds = { minX: 0.08, maxX: 0.92, minY: 0.08, maxY: 0.92 };

export const DEFAULT_PORTRAIT_DESKTOP: PortraitAnchor = { x: 0.84, y: 0.5 };
export const DEFAULT_PORTRAIT_MOBILE: PortraitAnchor = { x: 0.5, y: 0.72 };

export const PORTRAIT_STORAGE_PREFIX = 'airp:nook-portrait:v1:';

export function portraitStorageKey(worldId: string, characterId: string): string {
  return `${PORTRAIT_STORAGE_PREFIX}${worldId}:${characterId}`;
}

export function isPortraitAnchor(value: unknown): value is PortraitAnchor {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return Number.isFinite(record.x) && Number.isFinite(record.y)
    && typeof record.x === 'number' && typeof record.y === 'number';
}

/**
 * Bounds derived from the portrait's measured footprint against its stage, so
 * the layer never sits half-off-screen at narrow widths (§4: clamp by container
 * footprint, never a fixed size). A footprint larger than its stage cannot
 * satisfy that; the caller falls back to centre-only clamping.
 */
export function portraitBounds(
  footprint: { width: number; height: number } | null | undefined,
  stage: { width: number; height: number } | null | undefined,
): PortraitBounds {
  if (!footprint || !stage || stage.width <= 0 || stage.height <= 0) return DEFAULT_PORTRAIT_BOUNDS;
  const halfW = footprint.width / 2 / stage.width;
  const halfH = footprint.height / 2 / stage.height;
  if (!Number.isFinite(halfW) || !Number.isFinite(halfH) || halfW <= 0 || halfH <= 0) return DEFAULT_PORTRAIT_BOUNDS;
  const spanX = 1 - 2 * halfW;
  const spanY = 1 - 2 * halfH;
  if (spanX <= 0 || spanY <= 0) return DEFAULT_PORTRAIT_BOUNDS;
  return { minX: halfW, maxX: halfW + spanX, minY: halfH, maxY: halfH + spanY };
}

/** One clamp rule for pointer, keyboard, storage and resize paths alike. */
export function clampPortraitAnchor(next: PortraitAnchor, bounds: PortraitBounds = DEFAULT_PORTRAIT_BOUNDS): PortraitAnchor {
  return {
    x: Math.max(bounds.minX, Math.min(bounds.maxX, next.x)),
    y: Math.max(bounds.minY, Math.min(bounds.maxY, next.y)),
  };
}

export function defaultPortraitAnchor(narrow: boolean): PortraitAnchor {
  return narrow ? DEFAULT_PORTRAIT_MOBILE : DEFAULT_PORTRAIT_DESKTOP;
}
