import { useEffect, useState } from 'react';

/**
 * Which portrait may play, given every card on a canvas (nook 03 §③-6).
 *
 * The canvas-level invariant is "at most ONE portrait video decodes at a time"
 * (AGENTS §7.6: the cost of many videos is compositor layers, not paint). Cards
 * arrive in server row order (z ascending), so the LAST portrait is the visual
 * focus and keeps the clip; every other portrait is forced still.
 *
 * Pure and DOM-free so it is unit-testable, and so the rule lives in one place
 * rather than being re-derived per caller.
 */
export function portraitPlayStateOf(cards: { path: string; kind: string }[]): {
  playing: string | null;
  still: Set<string>;
} {
  const portraits = cards.filter((c) => c.kind === 'portrait');
  const playing = portraits.length ? portraits[portraits.length - 1].path : null;
  const still = new Set(portraits.filter((p) => p.path !== playing).map((p) => p.path));
  return { playing, still };
}

/**
 * Live `prefers-reduced-motion: reduce` probe (nook 03 §③-6 L3 / §③-4).
 * The media query is subscribed for the lifetime of the component so a
 * system preference change takes effect without remounting the stage.
 */
function reducedMotionMatches(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function useStill(): boolean {
  const [still, setStill] = useState(reducedMotionMatches);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = (event?: MediaQueryListEvent): void => {
      setStill(event ? event.matches : query.matches);
    };
    update();
    const modernListener = typeof query.addEventListener === 'function';
    if (modernListener) {
      query.addEventListener('change', update);
    } else {
      // Safari < 14 and a few test DOMs only expose the deprecated listener.
      query.addListener?.(update);
    }
    return () => {
      if (modernListener) {
        query.removeEventListener?.('change', update);
      } else {
        query.removeListener?.(update);
      }
    };
  }, []);
  return still;
}
