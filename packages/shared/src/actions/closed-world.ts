/**
 * Closed worlds, write side — move the clock, end the story
 *. Read side: `closed-world-state.ts`.
 */
import { parseFrontmatter } from '../schemas/frontmatter.js';
import { clockEndingHolds } from '../schemas/world.js';
import type { WorldEnding } from '../schemas/world.js';
import { ActionError } from './errors.js';
import type { ActionContext } from './types.js';
import { editEntity } from './delete.js';
import { clockLeft, ENDING_RECORD_PATH, modeHasEndings, reachedEnding } from './closed-world-state.js';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Merge `values` into a card's `status.data` through the ONE edit path. */
async function mergeStatusData(ctx: ActionContext, path: string, values: Record<string, unknown>) {
  const fm = parseFrontmatter(await ctx.store.readFile(path)).frontmatter;
  const status = isPlainObject(fm?.status) ? fm.status : {};
  const data = isPlainObject(status.data) ? status.data : {};
  return editEntity(ctx, { path, frontmatter: { status: { ...status, data: { ...data, ...values } } } });
}

export interface EndResult {
  ending: WorldEnding;
  /** False when the world had already ended (the call changed nothing). */
  fresh: boolean;
}

/**
 * End the story. Idempotent: a world that has already ended keeps its first
 * ending — a replayed trigger or a double click never produces a second one.
 */
export async function endWorld(ctx: ActionContext, endingId: string): Promise<EndResult> {
  const manifest = await ctx.store.getManifest();
  if (!modeHasEndings(manifest.mode)) {
    throw new ActionError({ code: 'unsupported', message: 'Only a world with endings (world.json "mode": "closed" or "semi") can end.' });
  }
  const ending = (manifest.endings ?? []).find((e) => e.id === endingId);
  if (!ending) {
    throw new ActionError({
      code: 'invalid_argument',
      message: `Unknown ending "${endingId}". world.json endings: ${(manifest.endings ?? []).map((e) => e.id).join(', ') || '(none)'}`,
    });
  }
  const already = await reachedEnding(ctx.store, manifest);
  if (already) return { ending: already, fresh: false };

  await mergeStatusData(ctx, ENDING_RECORD_PATH, { ending: ending.id, endingTurn: ctx.turn ?? null });
  await ctx.store.appendEvent({
    type: 'ending_reached',
    actor: ctx.actor,
    subject: ending.path,
    turn: ctx.turn,
    detail: { ending: ending.id, title: ending.title, path: ending.path },
  });
  return { ending, fresh: true };
}

export interface TickResult {
  left: number;
  /** The clock ending this tick triggered, if any. */
  ended: EndResult | null;
}

/**
 * Move the clock by `by` (default −1, never below 0), then check the
 * clock-triggered endings in declaration order; the first that holds ends the
 * story. A world that has already ended does not tick.
 */
export async function tickClock(ctx: ActionContext, by = -1): Promise<TickResult> {
  const manifest = await ctx.store.getManifest();
  const clock = manifest.clock;
  if (!clock) {
    throw new ActionError({ code: 'unsupported', message: 'This world has no clock (world.json "clock").' });
  }
  if (!Number.isInteger(by)) {
    throw new ActionError({ code: 'invalid_argument', message: `tick "by" must be an integer, got ${by}` });
  }
  const current = (await clockLeft(ctx.store, manifest)) ?? clock.start;
  if (await reachedEnding(ctx.store, manifest)) return { left: current, ended: null };

  const left = Math.max(0, current + by);
  await mergeStatusData(ctx, clock.path, { [clock.key]: left });
  // Only a closed world has endings to reach; an open world's clock just counts.
  if (!modeHasEndings(manifest.mode)) return { left, ended: null };
  const due = (manifest.endings ?? []).find((e) => e.when !== undefined && clockEndingHolds(e.when, left));
  return { left, ended: due ? await endWorld(ctx, due.id) : null };
}
