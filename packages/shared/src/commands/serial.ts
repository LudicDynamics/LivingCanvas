/**
 * World-command serialization gates — `the design notes` §6.1 / §8.3.
 *
 * Two locks, deliberately different in scope:
 *
 *   - `withSourceLock` is the one `settleWorldCommands` takes in S0 (`05` §5.1).
 *     It lives in the ACTION LAYER so every entry point shares it — the player's
 *     HTTP request, the writer agent's toolkit call and a character's tool call
 *     all reach the action layer, which is exactly the property contract §4.1
 *     demands. The copy it replaces (`apps/server/src/engine/declared-actions.ts`)
 *     sits in the server engine and is therefore invisible to the agent process.
 *   - `serialDeclared` is the same in-flight gate, verbatim in shape, exported
 *     from this module so the action layer can use it without reaching into
 *     `apps/server/`. It is generic over an arbitrary key; `withSourceLock` is
 *     its world-command specialization.
 *
 * Both are PROCESS-LOCAL, in-memory and persist nothing: a lock is not world
 * state, and it disappears the moment the work settles. Release is in a
 * `finally` in both cases — the only pollution risk for a module-level map is a
 * key that is never removed (`the design notes` §14.7 as narrowed
 * by contract §R.15.6).
 *
 * Honest limitation (`05` §6.1, kept here so nobody reads the lock as more than
 * it is): server and agent are TWO PROCESSES, each holding its own
 * `LocalWorldStore` over the same world directory. An in-process `Map` cannot
 * see the other process, so a simultaneous player click and writer tool call is
 * NOT covered. The only fallback there is "re-read before writing" (`05` §5.4),
 * which narrows the window without closing it. Closing it needs a cross-process
 * lock file, which is deliberately not built (repo decision D-4).
 */
import type { WorldStore } from '../store/world-store.js';

/**
 * Module-level in-flight map. Key → the promise chain of the work currently
 * holding that key. Mirrors `apps/server/src/engine/declared-actions.ts`'s
 * `inFlight`; the entry is deleted by the holder's `finally`.
 */
const inFlight = new Map<string, Promise<unknown>>();

/**
 * Run `work` after every previously enqueued call for `key` has settled.
 *
 * Calls under one key are strictly serialized in arrival order; different keys
 * never block each other. A rejected predecessor does NOT poison its
 * successors (`previous.catch(() => undefined)`).
 */
export async function serialDeclared<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = inFlight.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(work);
  inFlight.set(key, current);
  try {
    return await current;
  } finally {
    // Only the LAST holder clears the slot: an earlier holder that unwinds
    // while a successor is already queued must not drop the successor's gate.
    if (inFlight.get(key) === current) inFlight.delete(key);
  }
}

/**
 * Serialize world-command settlement per TRIGGERED ENTITY (`05` §8.3).
 *
 * The key is `${worldRoot}\0${source}` — the world root keeps two worlds in one
 * process apart, the NUL separator cannot occur in a world-relative path, so
 * `("a", "b/c")` and `("a\0b", "c")` cannot collide.
 *
 * Scope is deliberately finer than the server's `serialDeclared(store.worldRoot)`:
 * one lock per world would let a click on card A block a click on card B
 * (`05` §6.1 item 3).
 *
 * Why this exists at all (`05` §5.1 S0): a double click can put two HTTP
 * requests into S1 concurrently; both would read "no such key", both would run,
 * both would write the log — and the reward would land twice.
 */
export function withSourceLock<T>(
  store: WorldStore,
  source: string,
  work: () => Promise<T>
): Promise<T> {
  return serialDeclared(`${store.worldRoot}\u0000${source}`, work);
}
