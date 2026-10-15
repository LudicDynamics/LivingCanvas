/**
 * The card's big action buttons
 * Pure: which primary actions a card offers,
 * how long the pointer must rest before they show, and where the floating
 * pill sits next to the card on screen.
 *
 * The buttons only TRIGGER the actions that already existed (take = the
 * action layer's `take`, enter = the gate's enter request, talk = the
 * character / NPC dialogue); nothing here decides game logic. The rules for
 * "collectable" are the ones the side panel always used
 * (`EntityInteractions`) and the tutorial's `isTakeable` mirrors.
 */

export type CardActionId = 'open' | 'take' | 'enter' | 'converse' | 'talk';

/** Pointer dwell on a card before the pill shows (no flash on a pass-over). */
export const CARD_DWELL_MS = 300;
/** Grace after the pointer leaves the card or pill, so moving between them never closes it. */
export const CARD_GRACE_MS = 240;
/** On-screen width a lifted card grows to, so its face is readable at any zoom. */
export const CARD_READABLE_WIDTH = 300;
/** The lift never shrinks a card and never balloons it past this. */
export const CARD_MAX_LIFT = 1.8;
/** Space between the card's edge and the pill, and the pill's margin to the viewport edge. */
export const CARD_PILL_GAP = 10;
export const CARD_PILL_MARGIN = 8;

export interface CardActionItem {
  path: string;
  kind?: string;
  frontmatter: Record<string, any> | null;
}

export function isPlaceCard(item: CardActionItem): boolean {
  const fm = item.frontmatter;
  return item.kind === 'gate' || fm?.type === 'gate' || fm?.visual === 'door' || item.path.endsWith('/README.md');
}

export function isPersonCard(item: CardActionItem): boolean {
  const fm = item.frontmatter;
  return fm?.type === 'character' || fm?.type === 'sprite';
}

/** An NPC card is someone to talk to, never something to pocket. */
export function isNpcCardFm(fm: Record<string, any> | null | undefined): boolean {
  return fm?.type === 'npc';
}

/** Same rule as the side panel's 「收入随身」 always had. */
export function isCollectable(item: CardActionItem): boolean {
  const fm = item.frontmatter;
  if (isPlaceCard(item) || isPersonCard(item) || isNpcCardFm(fm)) return false;
  if (fm?.type === 'chalk') return false;
  return item.path.startsWith('world/') && fm?.portable !== false;
}

/**
 * The primary actions a card offers, in button order. `open` is only offered
 * where the owner can open a reading view (`canOpen`); `enter` / `talk` only
 * where the owner wired the handler.
 */
export function cardPrimaryActions(
  item: CardActionItem,
  wired: { canOpen?: boolean; canEnter?: boolean; canTalk?: boolean } = {},
): CardActionId[] {
  const out: CardActionId[] = [];
  if (wired.canOpen) out.push('open');
  if (isCollectable(item)) out.push('take');
  if (isPlaceCard(item) && wired.canEnter) out.push('enter');
  if (isNpcCardFm(item.frontmatter)) out.push('converse');
  if (isPersonCard(item) && wired.canTalk) out.push('talk');
  return out;
}

/**
 * How much a lifted card grows: up to a readable on-screen width, never
 * below its own size, never past `CARD_MAX_LIFT`. A card already readable
 * gets only a hint of lift.
 */
export function cardLiftScale(onScreenWidth: number): number {
  if (!Number.isFinite(onScreenWidth) || onScreenWidth <= 0) return 1;
  const wanted = CARD_READABLE_WIDTH / onScreenWidth;
  return Math.round(Math.min(CARD_MAX_LIFT, Math.max(1.04, wanted)) * 100) / 100;
}

export interface Box { left: number; top: number; width: number; height: number }

/**
 * Where the pill goes for a card on screen: centred on the card, above it by
 * default (`prefer: 'below'` for a place whose detail sheet hangs above), on
 * the other side when there is no room, and always inside the viewport.
 */
export function pillPosition(
  card: Box,
  pill: { width: number; height: number },
  viewport: { width: number; height: number },
  prefer: 'above' | 'below' = 'above',
): { left: number; top: number; side: 'above' | 'below' } {
  const above = card.top - CARD_PILL_GAP - pill.height;
  const below = card.top + card.height + CARD_PILL_GAP;
  const fitsAbove = above >= CARD_PILL_MARGIN;
  const fitsBelow = below + pill.height <= viewport.height - CARD_PILL_MARGIN;
  let side: 'above' | 'below' = prefer;
  if (prefer === 'above' && !fitsAbove && fitsBelow) side = 'below';
  if (prefer === 'below' && !fitsBelow && fitsAbove) side = 'above';
  const rawTop = side === 'above' ? above : below;
  const top = Math.max(CARD_PILL_MARGIN, Math.min(viewport.height - CARD_PILL_MARGIN - pill.height, rawTop));
  const centred = card.left + card.width / 2 - pill.width / 2;
  const left = Math.max(CARD_PILL_MARGIN, Math.min(viewport.width - CARD_PILL_MARGIN - pill.width, centred));
  return { left: Math.round(left), top: Math.round(top), side };
}
