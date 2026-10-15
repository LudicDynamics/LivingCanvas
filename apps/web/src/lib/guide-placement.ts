/**
 * Where the onboarding guide's bubble goes (components/chrome/OnboardingGuide.tsx).
 *
 *: on an empty new world the creator step pointed at the
 * writer bar along the bottom and the bubble sat BELOW it — off the screen,
 * sentence cut, 「下次不要再显示」 unreachable. So the rule is general, not per
 * step:
 *   1. Beside the target (right, then left) when there is room for the whole
 *      bubble there — the rail and dock are columns, beside is the natural read.
 *   2. Otherwise above / below: the side with more room, preferring above when
 *      the target is in the lower half (a bottom bar, the writer FAB).
 *   3. Whatever side won, the bubble is clamped fully inside the viewport with a
 *      margin; if it is taller than the room it gets `maxHeight` and scrolls
 *      inside (the component keeps the close control outside the scrolling part).
 */

export interface GuideRect { top: number; left: number; width: number; height: number }
export type GuideSide = 'right' | 'left' | 'above' | 'below';

export interface GuidePlacement {
  side: GuideSide;
  top: number;
  left: number;
  /** The bubble's width to use (never wider than the viewport minus margins). */
  width: number;
  /** The most height it may take; taller content scrolls inside. */
  maxHeight: number;
}

export interface GuidePlacementInput {
  box: GuideRect;
  viewport: { width: number; height: number };
  /** The bubble's natural size (measured; an estimate before the first paint). */
  bubble: { width: number; height: number };
  /** Space between the target and the bubble. */
  gap?: number;
  /** Space kept free along every viewport edge. */
  margin?: number;
  /**
   * Panels the bubble should not cover (the design notes: the pulled-up drawer, the writer sheet, a dialogue
   * stage — never the one holding the target). A side whose bubble would land on one is passed over while
   * another side fits; when every side does, the plain placement stands.
   */
  avoid?: readonly GuideRect[];
}

const overlaps = (a: GuideRect, b: GuideRect): boolean =>
  a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;

/** The four sides in preference order, each placed as if it were the only one allowed. */
const SIDES: readonly GuideSide[] = ['right', 'left', 'above', 'below'];

export function placeGuideBubble(input: GuidePlacementInput): GuidePlacement {
  const plain = placeOn(input, null);
  const avoid = input.avoid ?? [];
  const clear = (p: GuidePlacement) => !avoid.some((r) => overlaps({ top: p.top, left: p.left, width: p.width, height: Math.min(input.bubble.height, p.maxHeight) }, r));
  if (avoid.length === 0 || clear(plain)) return plain;
  for (const side of SIDES) {
    const one = placeOn(input, side);
    if (one && clear(one)) return one;
  }
  return plain;
}

/**
 * One side only (`only`), or the general rule (`null`). A forced side returns null when the bubble does
 * not fit there at all.
 */
function placeOn(input: GuidePlacementInput, only: null): GuidePlacement;
function placeOn(input: GuidePlacementInput, only: GuideSide | null): GuidePlacement | null;
function placeOn({ box, viewport, bubble, gap = 16, margin = 12 }: GuidePlacementInput, only: GuideSide | null): GuidePlacement | null {
  if (only !== null) {
    const vw0 = Math.max(0, viewport.width);
    const vh0 = Math.max(0, viewport.height);
    const w = Math.max(0, Math.min(bubble.width, vw0 - margin * 2));
    const full = Math.max(0, vh0 - margin * 2);
    const h = Math.min(bubble.height, full);
    const r = box.left + box.width;
    const b = box.top + box.height;
    if (only === 'right' || only === 'left') {
      const room = only === 'right' ? vw0 - margin - r - gap : box.left - gap - margin;
      if (room < w || bubble.height > full) return null;
      const top = clamp(box.top + box.height / 2 - h / 2, margin, vh0 - margin - h);
      return { side: only, top, left: only === 'right' ? r + gap : box.left - gap - w, width: w, maxHeight: full };
    }
    const room = only === 'above' ? box.top - gap - margin : vh0 - margin - b - gap;
    if (room < bubble.height) return null;
    const top = only === 'above' ? box.top - gap - h : b + gap;
    const left = clamp(box.left + box.width / 2 - w / 2, margin, vw0 - margin - w);
    return { side: only, top: Math.max(0, top), left: Math.max(0, left), width: w, maxHeight: room };
  }
  return placePlain({ box, viewport, bubble, gap, margin });
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

function placePlain({ box, viewport, bubble, gap = 16, margin = 12 }: GuidePlacementInput): GuidePlacement {
  const vw = Math.max(0, viewport.width);
  const vh = Math.max(0, viewport.height);
  const width = Math.max(0, Math.min(bubble.width, vw - margin * 2));
  const fullHeight = Math.max(0, vh - margin * 2);
  const height = Math.min(bubble.height, fullHeight);
  const right = box.left + box.width;
  const bottom = box.top + box.height;

  // 1. Beside — only when the whole bubble fits there.
  const roomRight = vw - margin - right - gap;
  const roomLeft = box.left - gap - margin;
  const besideTop = clamp(box.top + box.height / 2 - height / 2, margin, vh - margin - height);
  if (bubble.height <= fullHeight) {
    if (roomRight >= width) return { side: 'right', top: besideTop, left: right + gap, width, maxHeight: fullHeight };
    if (roomLeft >= width) return { side: 'left', top: besideTop, left: box.left - gap - width, width, maxHeight: fullHeight };
  }

  // 2. Above / below: the side that fits, preferring above for a target in the lower half.
  const roomAbove = Math.max(0, box.top - gap - margin);
  const roomBelow = Math.max(0, vh - margin - bottom - gap);
  const lowerHalf = box.top + box.height / 2 > vh / 2;
  const order: GuideSide[] = lowerHalf ? ['above', 'below'] : ['below', 'above'];
  const room = (side: GuideSide) => (side === 'above' ? roomAbove : roomBelow);
  let side = order.find((one) => room(one) >= bubble.height);
  if (!side) side = room(order[0]) >= room(order[1]) ? order[0] : order[1];
  // No room on either side at all (a target filling the screen): overlap it, inside the viewport.
  const maxHeight = room(side) >= Math.min(bubble.height, 48) ? room(side) : fullHeight;
  const shown = Math.min(bubble.height, maxHeight);
  const rawTop = side === 'above' ? box.top - gap - shown : bottom + gap;
  const top = clamp(rawTop, margin, vh - margin - shown);
  const left = clamp(box.left + box.width / 2 - width / 2, margin, vw - margin - width);

  // 3. Clamped: never outside the viewport, whatever the inputs.
  return { side, top: Math.max(0, top), left: Math.max(0, left), width, maxHeight: Math.max(0, Math.min(maxHeight, fullHeight)) };
}
