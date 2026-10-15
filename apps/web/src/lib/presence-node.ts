/**
 * Geometry + damping thresholds for the canvas presence layer (the design notes,
 * owner: 02). This module computes pixels and durations ONLY — the projection owner
 * is `apps/web/src/lib/presence.ts` (owner: 04). Everything here is pure so the
 * contract's §4.2 numbers are unit-testable verbatim.
 *
 * The thresholds below are copied VERBATIM from the frozen contract
 *. Changing one here without changing the
 * contract is a review failure.
 */
import type { CharacterPresenceView } from './presence.js';

/** Node attribute / class are constants so no component can hand-write them and
 *  accidentally grow a `.object`-shaped node (contract §4.3: presence is never a card). */
export const PRESENCE_NODE_ATTR = 'data-presence-node';
export const PRESENCE_NODE_CLASS = 'presence-avatar';

/** Same-layer coordinate change: the node slides. Contract §4.2. */
export const PRESENCE_SLIDE_MS = 480;
export const PRESENCE_SLIDE_EASE = 'cubic-bezier(.22,.61,.36,1)';
/** Layer switch, leaving: snapshot stays put and fades. Contract §4.2. */
export const PRESENCE_EXIT_MS = 260;
export const PRESENCE_EXIT_EASE = 'ease-out';
/** Layer switch, arriving: fade in + 8px rise, staggered. Contract §4.2. */
export const PRESENCE_ENTER_MS = 360;
export const PRESENCE_ENTER_OFFSET_PX = 8;
export const PRESENCE_STAGGER_MS = 60;
/** Reduced motion / hidden page cap: `≤120ms`, opacity only, no displacement. */
export const PRESENCE_STILL_MS = 120;

export interface PresenceMotionPrefs {
  /** `prefers-reduced-motion` (contract §4.2: one of only two degradation inputs). */
  reducedMotion: boolean;
  /** Page visibility (the other one; restored visibility re-enables damping). */
  pageVisible: boolean;
}

/**
 * true = displacement damping allowed; false = opacity only, immediate or ≤120ms.
 *
 * The Effects toggle (`effectsEnabled`) is deliberately NOT an input: it gates
 * environmental decoration (particles, parallax, animated backdrops), while
 * presence motion carries information ("who followed you here"). Contract §4.2
 * ruling 2026-09-14. `src` must never mention it, and the non-emptiness test asserts that.
 */
export function presenceMotionAllowed(prefs: PresenceMotionPrefs): boolean {
  return !prefs.reducedMotion && prefs.pageVisible;
}

/**
 * The node's world-pixel position — the CENTRE point (`presence.x/y` is a centre,
 * not a top-left; contract §3.1 / the design notes). The shell carries this
 * `translate3d`; an inner box supplies `translate(-50%,-50%)`.
 *
 * A non-finite coordinate falls back to the origin instead of emitting
 * `translate3d(NaNpx, …)`, which would drop the node outside the canvas.
 */
export function presenceRootTransform(view: CharacterPresenceView): string {
  const x = view.position?.x;
  const y = view.position?.y;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return 'translate3d(0px, 0px, 0)';
  return `translate3d(${x}px, ${y}px, 0)`;
}

/**
 * Render order: non-followers first (array order), then followers (array order).
 *
 * This is the SINGLE definition of "followers stagger in last" (contract §4.2).
 * Callers run it once and pass the result index as `order` to the descriptor, so
 * the descriptor never re-implements the grouping. Pure; does not mutate `views`.
 */
export function presenceRenderOrder(
  views: CharacterPresenceView[]
): CharacterPresenceView[] {
  const plain: CharacterPresenceView[] = [];
  const followers: CharacterPresenceView[] = [];
  for (const view of views) (view.arrivedByFollow ? followers : plain).push(view);
  return [...plain, ...followers];
}

/**
 * Entry descriptor for one node. `order` is the index inside the
 * `presenceRenderOrder()` result (monotonic, 0-based): `delayMs = order × stagger`.
 * `offsetPx` / `durationMs` degrade to `0` / `≤120` when motion is not allowed.
 */
export function presenceEntryDescriptor(
  order: number,
  view: CharacterPresenceView,
  prefs: PresenceMotionPrefs
): { delayMs: number; offsetPx: number; durationMs: number } {
  // `view` is unread today: every node's entry is defined by its order, not its
  // identity (a followed-in character takes the SAME entry branch as a plain
  // arrival — contract §4.2 forbids cross-layer sliding). Kept as a parameter so
  // the signature is stable if a per-view rule ever lands.
  void view;
  if (!presenceMotionAllowed(prefs)) return { delayMs: 0, offsetPx: 0, durationMs: PRESENCE_STILL_MS };
  return {
    delayMs: order * PRESENCE_STAGGER_MS,
    offsetPx: PRESENCE_ENTER_OFFSET_PX,
    durationMs: PRESENCE_ENTER_MS,
  };
}
