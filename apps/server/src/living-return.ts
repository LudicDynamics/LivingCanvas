import {
  awayDigestPrompt,
  catchUpLivingWorld,
  claimAwayDigest,
  deliverAwayDigestAsEvent,
  loadLivingWorld,
  readLivingState,
  startsChoiceTurn,
  type LivingCatchUp,
  type LocalWorldStore,
} from '@airp/shared';
import { randomUUID } from 'node:crypto';
import { readWorldSettings } from './engine/world-settings.js';

/**
 * A living world was opened. Two steps,
 * because they sit on either side of the world becoming active:
 *
 *   1. `catchUpOnOpen` — BEFORE the event tail starts: the time the player was
 *      away passes (capped), residents walk, overnight rules apply. No model.
 *   2. `deliverReturnDigest` — AFTER the world is active and its writer is
 *      starting: the absence's facts reach the player once — as ONE writer
 *      turn when the player lets the writer start turns on its own
 *      (`autoWrite: scenes-and-choices`) and the world wants it, otherwise (or
 *      when that turn cannot start) as a story event in the engine's own words.
 *
 * Every other world: both are no-ops. Neither throws.
 */
export async function catchUpOnOpen(store: LocalWorldStore): Promise<LivingCatchUp | null> {
  const result = await catchUpLivingWorld({ store, actor: { type: 'engine' }, turn: `living:${randomUUID()}` });
  if (result && result.minutes > 0) {
    console.log(`[AIRP Server] Living world caught up ${result.minutes} world minutes (${result.settle?.days.length ?? 0} new days, ${result.settle?.moved.length ?? 0} residents moved).`);
  }
  return result;
}

export async function deliverReturnDigest(
  store: LocalWorldStore,
  catchUp: LivingCatchUp | null,
  submitWriter: (prompt: string) => Promise<void>,
): Promise<'writer' | 'template' | null> {
  if (!catchUp?.away) return null;
  try {
    const world = await loadLivingWorld(store);
    if (!world) return null;
    const ctx = { store, actor: { type: 'engine' as const }, turn: `living-digest:${randomUUID()}` };
    const wantsWriter = world.living.digest?.writer !== false && startsChoiceTurn(readWorldSettings(store.worldRoot).autoWrite);
    if (!wantsWriter) return (await deliverAwayDigestAsEvent(ctx)) ? 'template' : null;
    const away = await claimAwayDigest(store, 'writer');
    if (!away) return null;
    const seed = (await readLivingState(store))?.seed ?? 0;
    // The writer turn is queued behind its start; if it cannot run (no model,
    // another turn in flight, the world switched), the facts still arrive.
    void submitWriter(awayDigestPrompt(world, seed, away)).catch(async (error) => {
      console.warn('[AIRP Server] Return digest fell back to the engine\'s words:', error instanceof Error ? error.message : String(error));
      await deliverAwayDigestAsEvent(ctx, away).catch(() => false);
    });
    return 'writer';
  } catch {
    return null;
  }
}
