/**
 * reveal-gate.ts — hold the layer refetch until the dice ceremony has finished
 *.
 *
 * WHY THIS EXISTS. A world command's file writes land during the HTTP request
 * (server-side, synchronous), so `file_changed` (~150ms, EventBridge's watcher
 * debounce) and `world_event` (~10-50ms) both reach the client LONG before the
 * ceremony settles (1200ms roll + 1300ms settle). Without a gate, the reward
 * cards the command just created slide onto the canvas while the dice are still
 * tumbling — behind the z-50 mask, so the player is spoiled, not informed. And
 * once the ceremony ends the refetch must still happen: the canvas is the truth,
 * and a gate that never opens is a dead end (hard gate 7).
 *
 * It is not a cache, a queue, or a store: it holds at most ONE pending closure.
 * Several arrivals inside one ceremony collapse into the last one — one refetch
 * used to mean one request per frame, each running the server's two serialising
 * write transactions (`seatUnplaced` / `reseatLayer`).
 *
 * Shape mirrors lib/dice-ceremony.ts: module state, no React, no side effects.
 */
import { getCeremonySnapshot } from './dice-ceremony.js';

/**
 * Failsafe: a defer MUST be released within this window even if no ceremony ever
 * reports done (a layer switch mid-ceremony, a dropped teardown, a bug). A
 * permanently frozen canvas would be far worse than an early reveal.
 *
 * Derived from the ceremony's own budget — `ROLL_MS (1200) + SETTLE_MS (1300)`
 * (apps/web/src/components/narrative/DiceRoller.tsx) plus 1000ms of slack. It is
 * a literal only because those two live in a `.tsx` module this file must not
 * import; the test asserts the inequality against that source, so a later timing
 * change cannot quietly fall outside the window.
 */
export const WATCHDOG_MS = 3500;

let pending: (() => void) | null = null;
/** Disarms the outstanding watchdog; null when none is armed. */
let cancelWatchdog: (() => void) | null = null;

/** Node's timer object keeps the process alive and has `unref`; a browser number does not. */
function armWatchdog(): void {
  if (cancelWatchdog !== null) return;
  const handle = setTimeout(() => {
    cancelWatchdog = null;
    flush();
  }, WATCHDOG_MS) as unknown as { unref?: () => void };
  handle.unref?.();
  cancelWatchdog = () => clearTimeout(handle as unknown as number);
}

function disarm(): void {
  const cancel = cancelWatchdog;
  cancelWatchdog = null;
  cancel?.();
}

/** Run the held refetch exactly once and drop it. */
function flush(): void {
  disarm();
  const run = pending;
  pending = null;
  run?.();
}

/**
 * Postpone one refetch until the ceremony ends. With no ceremony playing it runs
 * immediately; during one, a later call replaces the earlier closure, so a whole
 * ceremony costs a single refetch.
 */
export function deferReveal(run: () => void): void {
  if (getCeremonySnapshot() === null) {
    run();
    return;
  }
  pending = run;
  armWatchdog();
}

/** End the ceremony: release the held refetch. Idempotent, safe to call twice. */
export function releaseReveal(): void {
  if (pending === null) {
    disarm();
    return;
  }
  flush();
}

/** True while a refetch is waiting for the ceremony to end. */
export function isRevealHeld(): boolean {
  return pending !== null;
}

/**
 * Test seam, mirroring `resetSeenForTest` in dice-ceremony.ts: drop the held
 * closure and its watchdog so one test cannot leak into the next.
 */
export function resetRevealGateForTest(): void {
  disarm();
  pending = null;
}
