/**
 * show_frame geometry — pure functions, no React, no DOM.
 *
 * The dispatcher (PerformanceLayer) and the unit tests share these, so the
 * "which id is legal" / "what is the default dim" judgements live in ONE place
 * and can never drift between code and test.
 *
 * Every id / default here comes from the frozen sources: SHOW_IDS
 * (packages/shared/src/components/performances.ts:105) and the design notes
 */
import { SHOW_IDS } from '@airp/shared/performances';
import type { ShowFrame } from '@airp/shared';

/**
 * `frame.component` → a legal performance id, else `null` (never throws).
 *
 * The `typeof` guard is load-bearing: a malformed frame (JSON.parse of a bad
 * payload) can carry `undefined`, and `SHOW_IDS.includes(undefined)` is a
 * TypeError that would take down the whole WS message handler (the design notes
 * §8.6, review R4/F-3).
 */
export function resolveShowKind(id: unknown): string | null {
  return typeof id === 'string' && SHOW_IDS.includes(id) ? id : null;
}

/**
 * The thread start points for `evidence_burst`: the top-level `frame.links`
 * wins, `params.links` is the fallback, neither → `[]`.
 *
 * Top-level `links` is world-validated server-side (bad paths already dropped),
 * so when both are present the validated set must be the one rendered.
 */
export function evidenceLinks(frame: Pick<ShowFrame, 'links' | 'params'>): string[] {
  if (Array.isArray(frame.links)) return frame.links as string[];
  const fallback = frame.params?.links;
  return Array.isArray(fallback) ? (fallback as string[]) : [];
}

/**
 * Particle burst count for `fireworks`: default 5, capped
 * internally at 8. The schema declares no upper bound
 * (performances.ts:46 `z.number().int().positive().optional()`), so a `bursts:
 * 1000` would otherwise mean 12000 particles and a dead frame rate. This is a
 * defensive cap for the renderer, NOT a re-validation of the server contract
 *.
 */
export function clampBursts(n?: number): number {
  const v = typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 5;
  return Math.min(Math.floor(v), 8);
}

/**
 * Thread stagger for `evidence_burst`: default 90ms, clamped to [0, 400].
 * A negative value fires every thread at once; a huge one never finishes inside
 * `durationMs` — both collapse the choreography, hence the two-sided clamp
 *.
 */
export function clampStagger(n?: number): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : 90;
  return Math.max(0, Math.min(v, 400));
}

/**
 * `spotlight` dim ratio: default 0.15. `typeof` only —
 * `null` and `undefined` both fall back, and `??` would let a `null` through.
 */
export function spotlightDim(n?: number): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : 0.15;
}

/** `lights_out` dim ratio: default 0.08. */
export function lightsOutDim(n?: number): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : 0.08;
}

/**
 * `camera_focus`'s only parameter. A missing `zoom` MUST return `undefined` so
 * `flyTo(x, y, undefined)` keeps the current z (useCamera.ts:146). Returning a
 * number here would snap the camera to an extreme.
 */
export function zoomOf(params: Record<string, unknown>): number | undefined {
  const z = params?.zoom;
  return typeof z === 'number' && Number.isFinite(z) ? z : undefined;
}

const INK_TONES = ['ink', 'rust', 'blue', 'sage'] as const;

/** `ink_burst` tone: one of the four frozen tokens, else `undefined` (schema guards; front-end defence). */
export function inkToneOf(
  params: Record<string, unknown>
): 'ink' | 'rust' | 'blue' | 'sage' | undefined {
  const tone = params?.tone;
  return typeof tone === 'string' && (INK_TONES as readonly string[]).includes(tone)
    ? (tone as 'ink' | 'rust' | 'blue' | 'sage')
    : undefined;
}

/**
 * Overlap resource key: `spotlight` and `lights_out`
 * share ONE dimming veil, so a new one must take over the old; every other show
 * gets its own key and may run alongside. Without this, two spotlights would
 * multiply their darkness (brightness(0.15)² ≈ 0.02 — a black screen).
 */
export function ruleKeyOf(kind: string): string {
  return kind === 'spotlight' || kind === 'lights_out' ? 'dim' : kind;
}
