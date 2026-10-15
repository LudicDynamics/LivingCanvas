/**
 * The server's half of a clock that moves with the player's turns (world.json
 * `clock.perTurns`, packages/shared/src/actions/turn-clock.ts): the turns that
 * are not an action — the player's message to the writer (`request`) and one
 * line said to a character agent or an NPC card (`talk`). Options, rolls and
 * item uses are counted by the action hook in the shared package.
 *
 * Never fails the request it counts: a counting error is logged and dropped.
 * An author's request inside their own workshop world is not a player turn.
 */
import { randomUUID } from 'node:crypto';
import { countPlayerTurn, createActionService, type LocalWorldStore, type PlayerTurnKind, type TurnClockResult } from '@airp/shared';
import { isAuthoringWorld } from '../world-workshop.js';

export async function countServerPlayerTurn(store: LocalWorldStore | null | undefined, kind: Extract<PlayerTurnKind, 'request' | 'talk'>): Promise<TurnClockResult | null> {
  if (!store) return null;
  try {
    const raw = JSON.parse(await store.readFile('world.json')) as Record<string, unknown>;
    if (!(raw.clock as { perTurns?: unknown } | undefined)?.perTurns) return null;
    if (isAuthoringWorld(store.worldRoot, raw)) return null;
    return await countPlayerTurn(createActionService(store, { type: 'player' }, { turn: `turn-clock:${kind}:${randomUUID()}` }).ctx, kind);
  } catch (err) {
    console.warn('[AIRP] player turn count failed:', err instanceof Error ? err.message : String(err));
    return null;
  }
}
