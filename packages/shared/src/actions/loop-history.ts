/**
 * The current loop's slice of the event log.
 *
 * Several rules read the event log as "what this save has done": a search spot
 * already searched, a dice reward already handed out, an item followed through
 * its moves, a roll whose consequence is still owed. After a `loop_reset` the
 * world files are the loop start's again, so the events before it describe
 * files that are no longer there — those rules read THIS loop only. A world
 * that never looped gets the whole log, exactly as before.
 *
 * Only `loop_reset` is a boundary: its snapshot predates the loop's first
 * event. A rollback can restore a point in the middle of the log (moves
 * before it still explain where things are), so it is not one.
 */
import type { WorldEvent } from '../schemas/events.js';
import type { WorldStore } from '../store/world-store.js';

export function sinceLoopStart(events: readonly WorldEvent[]): WorldEvent[] {
  let from = 0;
  events.forEach((e, i) => { if (e.type === 'loop_reset') from = i + 1; });
  return from === 0 ? [...events] : events.slice(from);
}

export async function eventsThisLoop(store: Pick<WorldStore, 'getEventsSince'>): Promise<WorldEvent[]> {
  return sinceLoopStart(await store.getEventsSince(0));
}
