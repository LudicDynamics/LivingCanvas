import type { WorldEvent } from '../schemas/events.js';
import type { WorldStore } from '../store/world-store.js';
import type { AgentScope, Actor } from './actor.js';

/**
 * Everything an action needs, and nothing else.
 * Deliberately transport-free: no HTTP req/res, no WebSocket, no pi-rp types.
 * Frozen fields: store / actor / turn / now? / rng?. The one later addition is
 * `commandDepth` — the ONLY thing that stops a world
 * command's effects from triggering further world commands. No AbortSignal, no
 * progress channel: a command chain is depth 1 by construction, so nothing
 * needs to interrupt it.
 */
export interface ActionContext {
  store: WorldStore;
  /** Who is acting (00 §3). */
  actor: Actor;
  /** Launcher-injected, model-inaccessible process scope. */
  agentScope?: AgentScope;
  /** Internal capability used only by the validated /api/nook-note adapter. */
  nookNote?: boolean;
  /**
   * How many world commands deep this call is. Absent === 0 === a real actor's
   * first action. Any value > 0 suppresses every implicit command trigger point
   *: a command's effects never trigger further
   * commands. The ONLY writer is `03`'s executor, adding 1 when it invokes an
   * action on a command's behalf.
   */
  commandDepth?: number;
  /**
   * The id of the world command acting right now, when one is (`04` §6.5).
   *
   * Every event an effect appends MUST carry `detail.command` — it is the ONLY
   * key that says "this change came from a command", and `10`'s renderer reads
   * exactly this to give the sentence its subject ("The world, after the player
   * acted, …"). Without it the event is indistinguishable from an ordinary
   * action and the reader is told the player did it themselves.
   *
   * Set by `03`'s executor for the duration of one effect; absent for a real
   * actor's own action. Same shape and same single-writer rule as `commandDepth`.
   */
  commandId?: string;
  /**
   * Merge anchor (doc-21 §3.4). One agent turn, or one HTTP request.
   * Opaque string; the action layer never parses it, only forwards it.
   */
  turn: string;
  /** Injectable clock for tests; defaults to () => new Date().toISOString(). */
  now?: () => string;
  /** Injectable uniform [0,1) source for `rollDice`; defaults to Math.random. */
  rng?: () => number;
}
export type ActionDetails = Record<string, any>;

/**
 * The `detail.command` marker for an event appended on a command's behalf
 * (`04` §6.5). Spread it into every `appendEvent({ detail })`:
 *
 * ```ts
 * detail: { path, name, ...commandDetail(ctx) }
 * ```
 *
 * A helper rather than a literal at each site because the SEVEN effect actions
 * (plus the actions they compose) each build their own `detail`, and a
 * forgotten spread fails silently in the worst way: the event still lands, the
 * world still changes, and the only symptom is that the reader is told the
 * player acted when a command did. `10`'s subject phrase reads exactly this key.
 *
 * Returns `{}` for a real actor's own action, so an ordinary event's `detail`
 * stays byte-for-byte what it was.
 */
export function commandDetail(ctx: ActionContext): { command?: string } {
  return ctx.commandId === undefined ? {} : { command: ctx.commandId };
}

/**
 * The single return shape of the whole action layer.
 * `text` is the human-facing English line (00 §6.2); `details` is the stable
 * structured payload the router and the toolkit wrap differently.
 * `event` is OPTIONAL: read-only actions (lookAt / viewCanvas / getComponent /
 * showComponent) write nothing and therefore carry no event.
 */
export interface ActionResult<TDetails extends ActionDetails = ActionDetails> {
  text: string;
  details: TDetails & { event?: WorldEvent };
}
