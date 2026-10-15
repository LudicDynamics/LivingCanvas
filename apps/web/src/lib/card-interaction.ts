/**
 * Shared movement gate for card clicks and drags. Keeping this value in one
 * place prevents a short pointer jitter from both moving a card and activating
 * its action/read seam.
 */
export const CARD_POINTER_THRESHOLD = 5;

export function movedBeyondCardThreshold(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): boolean {
  return Math.hypot(endX - startX, endY - startY) > CARD_POINTER_THRESHOLD;
}
