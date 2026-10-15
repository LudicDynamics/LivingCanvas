/**
 * When ambient life must hold still (pure; the design notes §暂停).
 *
 * Two gates: cursors stop for anything that takes the player's hands or eyes
 * (typing, dragging, a dialog, the dice, the tutorial, a hidden tab); bubbles
 * stop for all of that AND whenever an agent is really generating — a bark over
 * a real answer would read as part of it.
 */

export type PauseReason =
  | 'off'
  | 'hidden'
  | 'typing'
  | 'dragging'
  | 'dialog'
  | 'ceremony'
  | 'tutorial'
  | 'writer'
  | 'agent';

export interface GateProbe {
  /** 「世界小动作」 setting. */
  enabled: boolean;
  /** `document.hidden`. */
  hidden: boolean;
  typing: boolean;
  /** A pointer is down on the canvas (card drag, pan, pinch). */
  dragging: boolean;
  /** A modal dialog / character conversation / sheet is open. */
  dialog: boolean;
  /** Dice ceremony, CG reveal, milestone or a stage performance. */
  ceremony: boolean;
  /** Forced tutorial bubble on screen. */
  tutorial: boolean;
  /** The writer is generating a turn. */
  writerBusy: boolean;
  /** A character agent is generating / acting. */
  agentBusy: boolean;
}

export function cursorPauseOf(p: GateProbe): PauseReason | null {
  if (!p.enabled) return 'off';
  if (p.hidden) return 'hidden';
  if (p.dialog) return 'dialog';
  if (p.ceremony) return 'ceremony';
  if (p.tutorial) return 'tutorial';
  if (p.dragging) return 'dragging';
  if (p.typing) return 'typing';
  return null;
}

export function bubblePauseOf(p: GateProbe): PauseReason | null {
  const hard = cursorPauseOf(p);
  if (hard) return hard;
  if (p.writerBusy) return 'writer';
  if (p.agentBusy) return 'agent';
  return null;
}

/** How long after the last keystroke into a field the player still counts as typing. */
export const TYPING_GRACE_MS = 3500;
/** A draft the player has touched this recently still counts (pausing mid-sentence to think). */
export const DRAFT_GRACE_MS = 20000;

interface FieldLike {
  closest?(selector: string): unknown;
  value?: unknown;
  isContentEditable?: boolean;
  textContent?: string | null;
}

const FIELD = 'input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="button"]), textarea, [contenteditable=""], [contenteditable="true"]';

/**
 * Typing = the focus is in a text field AND a key went in recently — or a
 * draft is there that the player touched within the last 20 s. An autofocused
 * empty box, or a reply the UI pre-filled and nobody has touched, is not
 * typing, or the world would freeze whenever the composer has focus.
 */
export function isTyping(active: FieldLike | null | undefined, lastKeyAt: number, now: number): boolean {
  if (!active || typeof active.closest !== 'function' || !active.closest(FIELD)) return false;
  const sinceKey = now - lastKeyAt;
  if (sinceKey < TYPING_GRACE_MS) return true;
  if (sinceKey >= DRAFT_GRACE_MS) return false;
  const draft = typeof active.value === 'string' ? active.value : active.isContentEditable ? active.textContent ?? '' : '';
  return draft.trim().length > 0;
}

/** Selectors whose presence means "something is staged over the canvas". */
export const DIALOG_SELECTOR = '[aria-modal="true"], [role="alertdialog"], .character-modal, .prototype-nook, .rotate-hint';
export const CEREMONY_SELECTOR = '.dice-ceremony-overlay, .cg-reveal, .milestone-stage, .declared-action-dialog';
/** The tutorial bubble / veil. Its paused form (only the way-out buttons, while the stage performs) is not "on screen". */
export const TUTORIAL_SELECTOR = '.forced-tutorial:not(.forced-tutorial--paused)';

interface ElementLike {
  getClientRects?(): { length: number };
}

interface QueryRoot {
  querySelectorAll(selector: string): ArrayLike<ElementLike>;
}

/**
 * Rendered = it has a box. Some overlays live in the DOM while CSS keeps them
 * `display: none` — RotateHint is mounted for the whole play view and only its
 * media query (touch phone held upright) shows it. Matching by selector alone
 * held every desktop at `dialog` forever: the pointers sat still on
 * canvas.worldlines.gg (release canvas-20261010-1501).
 */
function rendered(el: ElementLike): boolean {
  return typeof el.getClientRects !== 'function' || el.getClientRects().length > 0;
}

function anyRendered(root: QueryRoot, selector: string): boolean {
  const list = root.querySelectorAll(selector);
  for (let i = 0; i < list.length; i++) if (rendered(list[i])) return true;
  return false;
}

export function probeOverlays(root: QueryRoot): Pick<GateProbe, 'dialog' | 'ceremony' | 'tutorial'> {
  return {
    dialog: anyRendered(root, DIALOG_SELECTOR),
    ceremony: anyRendered(root, CEREMONY_SELECTOR),
    tutorial: anyRendered(root, TUTORIAL_SELECTOR),
  };
}
