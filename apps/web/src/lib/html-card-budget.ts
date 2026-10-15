/**
 * html-card-budget.ts — how many page-card iframes may live at once (H1,
 * contract §9.2 / V10, the design notes).
 *
 * A page card is a live sandbox, so ten of them in one layer means ten pages
 * animating at once. The cap is a property of the LAYER, not of any single
 * card: `CardRenderer` renders each card on its own and never sees its
 * siblings, and React's render order is not the seat order. So every card
 * reports itself here, this module decides, and every card reads the answer
 * back through `useSyncExternalStore`.
 *
 * Pure and side-effect free: no React, no CSS, no DOM — which is what makes
 * `computeBudgetAllowed` directly testable.
 */

/** Contract §9.2 / V10: the one definition; MUST NOT be repeated elsewhere. */
export const HTML_CARD_IFRAME_BUDGET = 6;

export interface CardFrameEntry {
  /** `item.path` (world-root relative, stable and unique). */
  id: string;
  /** `currentLayer`; the budget is isolated per layer. */
  layer: string;
  /** `item.z` — the SEAT order, not the DOM order. */
  z: number;
  /** `IntersectionObserver` verdict: this card is currently in the viewport. */
  visible: boolean;
}

/**
 * Which cards get a live iframe. Within one layer, the `visible` entries take
 * the first `budget` seats in ascending `z`; equal `z` breaks by `id`, so the
 * answer never depends on registration order. A card with no layer is outside
 * every budget and takes no slot (§7 U7).
 */
export function computeBudgetAllowed(
  entries: readonly CardFrameEntry[],
  budget: number = HTML_CARD_IFRAME_BUDGET,
): Set<string> {
  const allowed = new Set<string>();
  if (!(budget > 0)) return allowed;
  const byLayer = new Map<string, CardFrameEntry[]>();
  for (const entry of entries) {
    if (!entry || !entry.visible || typeof entry.layer !== 'string' || entry.layer === '') continue;
    const bucket = byLayer.get(entry.layer);
    if (bucket) bucket.push(entry);
    else byLayer.set(entry.layer, [entry]);
  }
  for (const bucket of byLayer.values()) {
    bucket.sort((a, b) => (a.z - b.z) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const entry of bucket.slice(0, budget)) allowed.add(entry.id);
  }
  return allowed;
}

/**
 * Every mounted page card, keyed by path. A card whose `layer` or `z` is
 * missing never registers — fewer iframes beats a wrong seat (§7 of the
 * design: "宁可少挂，不可错占").
 */
const entries = new Map<string, CardFrameEntry>();
const listeners = new Set<() => void>();
let snapshot: ReadonlySet<string> = new Set<string>();

/** Whether two id sets hold exactly the same ids (order is irrelevant). */
function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

function recompute(): void {
  const next = computeBudgetAllowed([...entries.values()]);
  // `useSyncExternalStore` compares snapshots with `Object.is`: keeping the old
  // reference when the CONTENT is unchanged is what stops every re-report from
  // re-rendering every card (same discipline as `lib/live-call-store.ts:18-22`).
  if (sameIds(next, snapshot)) return;
  snapshot = next;
  for (const listener of [...listeners]) listener();
}

/**
 * Register one card. Returns its unregister function; re-reporting the same
 * path replaces the row (the `visible` gate flips many times per session).
 */
export function reportCardFrame(entry: CardFrameEntry): () => void {
  if (!entry || typeof entry.id !== 'string' || !entry.id) return () => {};
  // A card with no layer or no seat never takes a slot at all (§7).
  if (typeof entry.layer !== 'string' || entry.layer === '' || !Number.isFinite(entry.z)) return () => {};
  const stored: CardFrameEntry = { ...entry };
  entries.set(entry.id, stored);
  recompute();
  return () => {
    // A late unmount MUST NOT evict a newer report of the same path.
    if (entries.get(entry.id) !== stored) return;
    entries.delete(entry.id);
    recompute();
  };
}

/** Subscribe to budget changes. */
export function subscribeHtmlBudget(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The current allowed set. Stable reference until the content really changes. */
export function htmlFrameAllowedSnapshot(): ReadonlySet<string> {
  return snapshot;
}
