/**
 * The clock that moves with the player's turns (world.json `clock.perTurns`,
 * the design notes).：「我们进行的对话次数可以直接
 * 根据 turn 的数量，让时间推进，不需要用撕日历的方式」.
 *
 * Every PLAYER TURN adds one to the clock card's `status.data.turns`; the turn
 * that fills it to `perTurns` puts it back to 0 and moves the clock one step
 * (`tickClock`, the same write a command's `tick` makes), then the world's
 * triggers are evaluated — the ordinary `clock` triggers, a clock ending, a
 * `loop_reset` all happen exactly as if a command had ticked.
 *
 * A player turn is exactly one of:
 *   - `request` — the player's own message to the writer (`writer_prompt`,
 *     any mode; not an author's request in their workshop world);
 *   - `talk`    — one line the player says to a character agent
 *     (`character_prompt`) or to an NPC card (`POST /api/npc/talk`);
 *   - the player's own `chooseOption` (an option on a card), `rollDice`
 *     (a dice / search / skill-check card) or `useItemOn` — counted by the
 *     action hook below, only for `actor.type === 'player'` at command depth 0.
 * Never a turn: quiet beats and the writer's turns they start, character tick
 * beats, the writer's or a character's own actions (a writer picking an option
 * for the player included), the engine's / a command's effects, a god action
 * (a forced roll), reading, entering a place, moving cards, notes and the board.
 *
 * The counter lives on the clock card itself, so the save keeps it, a
 * snapshot / rollback carries it, and `loop_reset` (which restores the card
 * from the loop start) puts it back to 0 — loop.ts also writes the 0
 * explicitly. It is bookkeeping: written without an event (the file watcher
 * still refreshes the card); only the tick itself lands an `entity_edited`.
 * A card may declare a number state `turns` to show it in words (bands).
 */
import { parseFrontmatter, stringifyFrontmatter } from '../schemas/frontmatter.js';
import type { WorldClock } from '../schemas/world.js';
import { withSourceLock } from '../commands/serial.js';
import { runWorldTriggers, type FiredTrigger } from '../commands/world-triggers.js';
import { reachedEnding, clockLeft } from './closed-world-state.js';
import { tickClock } from './closed-world.js';
import { registerActionHook, type ActionInput, type ActionMethodName } from './service.js';
import type { ActionContext, ActionResult } from './types.js';
import type { WorldManifest } from '../schemas/world.js';

/** The clock card's `status.data` key that counts the turns spent in this step. */
export const TURN_CLOCK_KEY = 'turns';

/** The kinds of player turn the server reports (the action hook covers the rest). */
export type PlayerTurnKind = 'request' | 'talk' | 'choice' | 'roll' | 'use';

/** Player actions that are one turn each (the hook below). */
export const PLAYER_TURN_ACTIONS: Readonly<Partial<Record<ActionMethodName, PlayerTurnKind>>> = Object.freeze({
  chooseOption: 'choice',
  rollDice: 'roll',
  useItemOn: 'use',
});

export interface TurnClockResult {
  kind: PlayerTurnKind;
  /** Turns spent in the current step after this one (0 right after a tick). */
  turns: number;
  perTurns: number;
  /** True when this turn moved the clock. */
  ticked: boolean;
  /** Steps left on the clock after this turn. */
  left: number | null;
  /** Triggers the tick fired (clock triggers, a loop reset…). */
  triggers: FiredTrigger[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The clock of a world that moves by turns, or null (no clock / no `perTurns`). Pure. */
export function turnClockOf(manifest: unknown): (WorldClock & { perTurns: number }) | null {
  if (!isPlainObject(manifest) || !isPlainObject(manifest.clock)) return null;
  const clock = manifest.clock as unknown as WorldClock;
  const n = (clock as { perTurns?: unknown }).perTurns;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) return null;
  if (typeof clock.path !== 'string' || typeof clock.key !== 'string') return null;
  return { ...clock, perTurns: n };
}

/** Turns spent in the current step, read from a clock card's `status.data` (0 when absent or unusable). */
export function turnsSpentOf(statusData: unknown, perTurns: number): number {
  const raw = isPlainObject(statusData) ? statusData[TURN_CLOCK_KEY] : undefined;
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
  if (!Number.isInteger(n) || n < 0) return 0;
  return Math.min(n, perTurns - 1);
}

/** Write `turns` on the clock card without an event (bookkeeping). */
async function writeTurns(ctx: ActionContext, path: string, turns: number): Promise<void> {
  const parsed = parseFrontmatter(await ctx.store.readFile(path));
  const fm: Record<string, unknown> = { ...(parsed.frontmatter ?? {}) };
  const status = isPlainObject(fm.status) ? { ...fm.status } : {};
  const data = isPlainObject(status.data) ? { ...status.data } : {};
  data[TURN_CLOCK_KEY] = turns;
  status.data = data;
  fm.status = status;
  await ctx.store.writeFileAtomic(path, stringifyFrontmatter(fm, parsed.body));
}

/** Read world.json directly (`getManifest` rescans every layer; this runs after each player action). */
async function rawManifest(ctx: ActionContext): Promise<Record<string, unknown> | null> {
  try {
    const raw = JSON.parse(await ctx.store.readFile('world.json'));
    return isPlainObject(raw) ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Count one player turn. A no-op (null) for a world whose clock does not move by
 * turns, a world that has ended, or a clock already at 0. Never throws for those;
 * a store failure propagates (callers that must not fail catch it).
 */
export async function countPlayerTurn(ctx: ActionContext, kind: PlayerTurnKind): Promise<TurnClockResult | null> {
  const manifest = await rawManifest(ctx);
  const clock = turnClockOf(manifest);
  if (!clock || !manifest) return null;
  if ((await ctx.store.statKind(clock.path)) !== 'file') return null;
  const m = manifest as unknown as WorldManifest;
  if (await reachedEnding(ctx.store, m)) return null;
  const now = await clockLeft(ctx.store, m);
  if (now !== null && now <= 0) return null;

  const counted = await withSourceLock(ctx.store, `turn-clock:${clock.path}`, async () => {
    const data = parseFrontmatter(await ctx.store.readFile(clock.path)).frontmatter?.status;
    const spent = turnsSpentOf(isPlainObject(data) ? data.data : undefined, clock.perTurns) + 1;
    const due = spent >= clock.perTurns;
    await writeTurns(ctx, clock.path, due ? 0 : spent);
    return { turns: due ? 0 : spent, due };
  });
  const engine: ActionContext = { ...ctx, actor: { type: 'engine' }, commandDepth: 0 };
  // Not yet: the count moved, and a state trigger may read it (`clock.turns`, e.g. the last step's warning).
  if (!counted.due) {
    const triggers = await runWorldTriggers(engine, { kind: 'action', action: 'turnClock' });
    return { kind, turns: counted.turns, perTurns: clock.perTurns, ticked: false, left: now, triggers };
  }

  // The step is spent: the engine moves the clock (not the player — the event says so), then the triggers.
  const ticked = await tickClock(engine, -1);
  const triggers = await runWorldTriggers(engine, { kind: 'action', action: 'turnClock' });
  return { kind, turns: 0, perTurns: clock.perTurns, ticked: true, left: ticked.left, triggers };
}

/**
 * Put the counter back to 0 (a loop reset, a new step set by hand). No-op for a
 * world whose clock does not move by turns.
 */
export async function resetTurnClock(ctx: ActionContext, manifest?: unknown): Promise<void> {
  const clock = turnClockOf(manifest ?? (await rawManifest(ctx)));
  if (!clock || (await ctx.store.statKind(clock.path)) !== 'file') return;
  await withSourceLock(ctx.store, `turn-clock:${clock.path}`, () => writeTurns(ctx, clock.path, 0));
}

/* ─────────────────────────── the ActionService hook ─────────────────────────── */

registerActionHook({
  async after(name: ActionMethodName, ctx: ActionContext, _input: ActionInput, result: ActionResult) {
    const kind = PLAYER_TURN_ACTIONS[name];
    if (!kind || ctx.actor.type !== 'player' || (ctx.commandDepth ?? 0) > 0) return result;
    const counted = await countPlayerTurn(ctx, kind);
    if (!counted) return result;
    const prior = Array.isArray(result.details?.triggers) ? result.details.triggers : [];
    return {
      ...result,
      details: {
        ...result.details,
        turnClock: { turns: counted.turns, perTurns: counted.perTurns, ticked: counted.ticked, left: counted.left },
        ...(counted.triggers.length ? { triggers: [...prior, ...counted.triggers] } : {}),
      },
    };
  },
});
