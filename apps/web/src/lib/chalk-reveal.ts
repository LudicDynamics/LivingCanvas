/**
 * Chalk wet-ink reveal — pure timing math for `ChalkMark`.
 *
 * The server replays the whole chalk body in one burst at `toolcall_end`, so a
 * streaming look can only come from a local clock, independent of frame arrival
 * — which is what makes "delayed confirmation costs nothing" true
 *.
 *
 * Pace: one character per `REVEAL_STEP_MS` (~24ms, the prototype rhythm), but
 * never longer than `MAX_REVEAL_MS` for the whole body. A typical narration
 * (a couple of hundred characters) reveals at the honest one-by-one pace; a
 * very long body compresses to the cap instead of crawling for a minute. The
 * cap only kicks in for bodies long enough that nobody would call it "writing"
 * anyway.
 *
 * No React, no DOM: testable with `node --test`.
 */

/** Milliseconds per reveal tick (prototype rhythm, the design notes). */
export const REVEAL_STEP_MS = 24;

/** Longest a single body may take to finish revealing. */
export const MAX_REVEAL_MS = 6_000;

/** Effective ms-per-character for a given body length. */
export function stepFor(textLength: number, stepMs = REVEAL_STEP_MS): number {
  const len = Math.max(0, Math.floor(textLength));
  if (!(stepMs > 0) || len === 0) return stepMs;
  return Math.min(stepMs, MAX_REVEAL_MS / len);
}

/**
 * Advance the shown-character count toward `textLength` after `elapsedMs`.
 *
 * `textLength` is in UTF-16 code units (the same unit `String#slice` uses), so
 * a surrogate pair counts as two steps. `textLength <= 0` → 0; a
 * non-positive `elapsedMs` or `stepMs` leaves `currentShown` clamped unchanged.
 */
export function revealChars(
  textLength: number,
  elapsedMs: number,
  currentShown: number,
  stepMs = REVEAL_STEP_MS
): number {
  const len = Math.max(0, Math.floor(textLength));
  const shown = Math.max(0, Math.floor(currentShown));
  if (len === 0) return 0;
  if (!(elapsedMs > 0) || !(stepMs > 0)) return Math.min(len, shown);
  const step = stepFor(len, stepMs);
  const steps = Math.floor(elapsedMs / step);
  if (steps <= 0) return Math.min(len, shown);
  return Math.min(len, shown + steps);
}
