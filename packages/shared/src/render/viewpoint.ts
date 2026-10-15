/**
 * The ONE definition of "the camera moved" and "what geometry goes on the wire"
 * (00 §5.3, doc-22 §5). Both ends of the viewpoint wire import these — the
 * browser reports, the server sanitises — so there is a single 1/8-viewport
 * quantisation in the codebase, not the two divergent inline expressions
 * Nodesign grew (AUDIT §1).
 *
 * Pure, total, no I/O, no DOM, no Date.
 */

/** An axis-aligned world-space view rectangle. Matches the camera model of
 *  apps/web/src/lib/camera.ts (screen = world * z, centred): the visible world
 *  rect's top-left is (cam.x - vw / (2 * z), cam.y - vh / (2 * z)). */
export interface ViewRect { x: number; y: number; w: number; h: number; }

/** doc-22 §5: a step of one eighth of the viewport. `Math.max(1, …)` keeps a
 *  degenerate viewport (a collapsing pane) from producing a zero/NaN step. */
export function viewStep(w: number, h: number): { sx: number; sy: number } {
  return { sx: Math.max(1, w / 8), sy: Math.max(1, h / 8) };
}

/** Floor onto the grid — NOT Math.round. `floor` covers a strictly half-open
 *  cell `[k*sx, (k+1)*sx)`, so a given output means exactly "inside this cell",
 *  with no boundary flicker between two adjacent readings. It is also
 *  idempotent (`q(q(r)) === q(r)`), which `Math.round(x/s)*s` is not for
 *  non-integer steps — and our steps ARE non-integer (1600 / 8 = 200,
 *  900 / 8 = 112.5).
 *
 *  Called by the browser BEFORE it decides to report. The server does NOT
 *  re-quantise the wire rect: `sanitizeViewpoint` folds the rect to a CENTRE,
 *  and a centre is not a displacement (05 §2.3). */
export function quantiseViewRect(rect: ViewRect): ViewRect {
  const { sx, sy } = viewStep(rect.w, rect.h);
  return {
    x: Math.floor(rect.x / sx) * sx,
    y: Math.floor(rect.y / sy) * sy,
    w: rect.w,
    h: rect.h,
  };
}

/** The wire form: 'x:y:sx:sy' (integers). '' when there is no view rect.
 *  `sx:sy` is the step for the reported `w/h`, so the viewport SIZE survives
 *  the round-trip inside a quantised bound. Deterministic across both ends. */
export function encodeViewRect(rect: ViewRect | null): string {
  if (!rect) return '';
  const q = quantiseViewRect(rect);
  const { sx, sy } = viewStep(rect.w, rect.h);
  return `${Math.round(q.x)}:${Math.round(q.y)}:${Math.round(sx)}:${Math.round(sy)}`;
}

/** Inverse of encodeViewRect. Anything that is not exactly 4 integer fields
 *  (including `<= 4` fields) → null. */
export function decodeViewRect(text: string): { x: number; y: number } | null {
  const parts = text.split(':');
  if (parts.length !== 4) return null;
  if (parts.some((p) => p === '' || !Number.isInteger(Number(p)))) return null;
  const nums = parts.map((p) => Number(p));
  return { x: nums[0], y: nums[1] };
}

/** The stable change key for a report: quantised layer + camera + selected +
 *  bagCount. Two reports with the same key are the same viewpoint (doc-22 §5,
 *  gate 1: the browser only POSTs when this changes). */
export function viewpointKey(input: {
  layer: string;
  camera: ViewRect | null;
  selected: string[];
  bagCount: number;
}): string {
  const cam = input.camera ? encodeViewRect(input.camera) : '';
  return `${input.layer}|${cam}|${input.selected.join(',')}|${input.bagCount}`;
}

/** The report throttle floor (doc-22 §5 gate 1), ms. Frontend-only: the
 *  injection side has no reason to know it. Lives here, not in local-store.ts,
 *  because it is a client policy, and here it is next to its sibling constants. */
export const VIEWPOINT_MIN_INTERVAL_MS = 1200;

/** Slow heartbeat (00 §5.1.1): even with NO semantic change, re-report at least
 *  this often so the 10-minute TTL never expires while the player sits still —
 *  expiry cascades away `layer_files` / `cast` (00 §11). Half the TTL. */
export const VIEWPOINT_HEARTBEAT_MS = 5 * 60 * 1000;
