/**
 * Pointer vocabulary of the player's clue board.
 * Pure DOM lookups, no React: Canvas calls these from its one pointer dispatcher.
 */

/** How long a touch must rest on blank canvas before it means "pin a note here". */
export const LONG_PRESS_MS = 550;

/** Shortcut keys (ignored while typing). */
export const NOTE_KEY = 'n';
export const BOARD_KEY = 'b';

/**
 * The clue-board endpoint under an element: a card's world path, or
 * `characters/<id>` for a character standing on the canvas. null = blank.
 */
export function boardEndpointAt(el: Element | null): string | null {
  if (!el) return null;
  const card = el.closest<HTMLElement>('.object[data-path]');
  if (card?.dataset.path) return card.dataset.path;
  const presence = el.closest<HTMLElement>('[data-presence-id]');
  if (presence?.dataset.presenceId) return `characters/${presence.dataset.presenceId}`;
  return null;
}

/** True when a key event is typing into a field (shortcuts must stay quiet). */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== 'function') return false;
  return Boolean(el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]'));
}
