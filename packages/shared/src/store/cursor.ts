/**
 * 03 §2.3 — the ONE cursor settlement primitive, plus the rollback push-flat
 * anchor. Lives in `packages/shared/` because BOTH processes import it: the
 * writer extension and the character's server-side path
 * (`apps/server/src/index.ts`), and the server cannot import `extensions/`.
 *
 * Both functions NEVER throw: a cursor write failing must not fail a turn
 * (doc 00 §11).
 */
import type { WorldStore } from './world-store.js';

function warn(opts: { onWarn?: (message: string) => void }, message: string): void {
  if (opts.onWarn) opts.onWarn(message);
  else console.warn(message);
}

/**
 * The ONE settlement primitive. Called exactly once per consumption event:
 *   - writer:    at the TURN BOUNDARY, after the cached block was produced;
 *   - character: on overlay CLOSE, with `seq` pinned to the open-time high-water.
 *
 * Default `seq` = `await store.getMaxSeq()`. `writeCursor` is a BARE write — no
 * monotonic clamp, pushing "backwards" is legal, which is what makes the
 * pinned-`seq` form possible. No-op when `reader === null` (player / god /
 * engine have no cursor) or when `opts.advance === false`.
 */
export async function settleTurnCursor(
  store: WorldStore,
  reader: string | null,
  opts?: { advance?: boolean; seq?: number; onWarn?: (message: string) => void }
): Promise<void> {
  const warnOpts = { onWarn: opts?.onWarn };
  if (reader === null) return;
  if (opts?.advance === false) return;

  let seq = opts?.seq;
  if (seq === undefined) {
    try {
      seq = await store.getMaxSeq();
    } catch (err) {
      // Reading the high-water failed: treat as `advance: false` (no write).
      warn(
        warnOpts,
        `[cursor] getMaxSeq() failed for "${reader}"; cursor left unchanged: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      return;
    }
  }

  try {
    await store.writeCursor(reader, seq);
  } catch (err) {
    // Worst case is "next turn repeats a span"; that beats failing the turn.
    warn(
      warnOpts,
      `[cursor] writeCursor("${reader}", ${seq}) failed: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}

// NOTE: rollback's "push every cursor" step is NOT a free function here. It must
// commit in the SAME `historyDb` transaction as the `world_rolled_back` append
// (doc-21 §6), and a transaction handle never leaves the store — so it lives in
// `LocalWorldStore.appendEventAndPushCursors`, called by the rollback action
// (`actions/world.ts`). A caller-side loop over `writeCursor()` would be a
// second, torn path.

