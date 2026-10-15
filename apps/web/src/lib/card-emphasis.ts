/**
 * card-emphasis — "which card is this option about?".
 *
 * Hovering an option in the left rail lifts the card it belongs to and dims
 * the rest. The camera never moves: the point of the companion layout is that
 * the canvas is a stable picture you read, not a viewport that jumps whenever
 * the pointer crosses a list.
 *
 * Written as direct DOM writes rather than React state, the same way
 * `highlightLinks` (LinkLayer) does it. A rail hover otherwise re-renders every
 * card on the layer — on a 40-card layer that is a visible stutter for an
 * effect that is two CSS properties. One attribute on the emphasised `.object`,
 * one on the canvas root so CSS can dim its siblings, and nothing in a render
 * path.
 */

/** Marks the emphasised card; CSS lifts it. */
const CARD_ATTR = 'data-emphasis';
/** Marks the canvas root while ANY card is emphasised; CSS dims the others. */
const ROOT_ATTR = 'data-emphasis-active';

let current: string | null = null;

function cardFor(path: string): HTMLElement | null {
  // `CSS.escape` keeps a path with quotes or brackets from breaking the selector.
  const escaped = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
    ? CSS.escape(path)
    : path.replace(/["\\]/g, '\\$&');
  return document.querySelector<HTMLElement>(`.object[data-path="${escaped}"]`);
}

function roots(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.depth-surface--world'));
}

/** Clear the current emphasis. Safe to call when nothing is emphasised. */
export function clearCardEmphasis(): void {
  if (current === null) return;
  cardFor(current)?.removeAttribute(CARD_ATTR);
  for (const root of roots()) root.removeAttribute(ROOT_ATTR);
  current = null;
}

/**
 * Emphasise one card by its world-relative path, or clear when `path` is null.
 * A path with no card on screen (another layer, or not yet rendered) clears
 * instead of leaving the previous card lit.
 */
export function emphasizeCard(path: string | null): void {
  if (path === current) return;
  clearCardEmphasis();
  if (!path) return;
  const card = cardFor(path);
  if (!card) return;
  card.setAttribute(CARD_ATTR, 'on');
  for (const root of roots()) root.setAttribute(ROOT_ATTR, 'on');
  current = path;
}

/** Test seam: the path currently emphasised, or null. */
export function emphasizedCardPath(): string | null {
  return current;
}
