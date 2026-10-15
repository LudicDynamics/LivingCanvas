/**
 * What the right-click / long-press radial on blank canvas offers
 *. One menu, always — its items depend on the world's
 * category and on whether the writer sheet is open:
 *
 *   - authoring (any world): the four creators + 便签;
 *   - play, free / story / no category: the same four creators + 线索板 + 便签 —
 *     the player makes the world directly; board and note are the private,
 *     secondary items (no standing 「便签 · 线索板」 pill since 2026-10-13, so the
 *     radial is where both live in every play category);
 *   - play, TRPG: the player's own tools only — 便签, 线索板, 写行动, 要提示.
 *     A player-made clue or NPC would break the case (the server refuses it
 *     too: `/api/god-action` `mode: 'play'`).
 *
 * Pure — no React — so the table is tested on its own.
 */
import { playersMayCreate, type WorldCategoryId } from '@airp/shared/themes';

export type RadialCreatorType = 'gate' | 'character' | 'clue' | 'chalk';
export type RadialToolId = 'note' | 'board' | 'write' | 'hint';

export const RADIAL_CREATORS: readonly RadialCreatorType[] = ['gate', 'character', 'clue', 'chalk'];

export interface RadialItems {
  /** The four world-fact creators (New Scene / Summon NPC / Place Clue / Inscribe Chalk). */
  creators: readonly RadialCreatorType[];
  /** The player's tools, in menu order after the creators. */
  tools: readonly RadialToolId[];
  /** Sent with a creation: TRPG play never gets here; free/story play says `play`. */
  mode: 'play' | 'authoring';
}

export function radialItemsFor(category: WorldCategoryId | null | undefined, authoring: boolean): RadialItems {
  if (authoring) return { creators: RADIAL_CREATORS, tools: ['note'], mode: 'authoring' };
  if (playersMayCreate(category)) return { creators: RADIAL_CREATORS, tools: ['board', 'note'], mode: 'play' };
  return { creators: [], tools: ['note', 'board', 'write', 'hint'], mode: 'play' };
}

/**
 * Satellite angles (degrees, 0 = right, clockwise in screen space): evenly
 * round the hub, the first one on top — four items keep today's cross.
 */
export function radialAngles(count: number): number[] {
  return Array.from({ length: count }, (_, i) => -90 + (360 / Math.max(1, count)) * i);
}
