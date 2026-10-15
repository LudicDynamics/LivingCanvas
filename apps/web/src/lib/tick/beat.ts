/**
 * The player's beat, as the page counts it.
 *
 * A beat = one player input that has settled: a choice, a roll, a door, a take,
 * a line to a character / NPC / the writer — and the answer it caused. Several
 * signals belong to ONE beat (a choice starts a writer turn; an NPC line is a
 * writer turn too), so they are coalesced: the beat is sent once the writer is
 * idle, nothing is being staged over the page (dice, CG, tutorial), and no new
 * signal came for `quietMs`.
 *
 * Pure (timers injected), so the coalescing rules are unit-testable.
 */

export interface BeatEnv {
  /** Something still owns the moment: the writer is writing, a ceremony is on screen. */
  busy(): boolean;
  /** Send the beat (POST /api/turn-end). */
  send(): void;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

export interface BeatCoalescer {
  /** Something the player did (or an answer landing) belongs to the current beat. */
  signal(source: string): void;
  /** Re-check now (the writer went idle, a ceremony closed). */
  poke(): void;
  /** Drop a pending beat (world changed, page left). */
  cancel(): void;
  pending(): boolean;
}

export const BEAT_QUIET_MS = 1200;
/** While busy, look again this often. */
export const BEAT_RECHECK_MS = 700;

export function createBeatCoalescer(env: BeatEnv, quietMs: number = BEAT_QUIET_MS): BeatCoalescer {
  let waiting = false;
  let timer: unknown = null;
  const clear = () => {
    if (timer !== null) env.clearTimer(timer);
    timer = null;
  };
  const arm = (ms: number) => {
    clear();
    timer = env.setTimer(fire, ms);
  };
  function fire(): void {
    timer = null;
    if (!waiting) return;
    if (env.busy()) {
      arm(BEAT_RECHECK_MS);
      return;
    }
    waiting = false;
    env.send();
  }
  return {
    signal() {
      waiting = true;
      arm(quietMs);
    },
    poke() {
      if (waiting && !env.busy()) arm(Math.min(quietMs, 400));
    },
    cancel() {
      waiting = false;
      clear();
    },
    pending: () => waiting,
  };
}

/** World events that are the player's own move (forwarded by useWorld as `airp:player-act`). */
export const PLAYER_ACT_EVENTS: readonly string[] = ['choice_selected', 'roll_resolved', 'layer_entered', 'use_item_on', 'entity_moved'];

export const PLAYER_ACT_EVENT = 'airp:player-act';

/** Player routes whose success is the player's own move (the request path, independent of the socket). */
export const PLAYER_ACT_ROUTES: readonly string[] = ['/api/choice', '/api/enter-layer', '/api/use-item', '/api/move', '/api/dice', '/api/skill-check'];
