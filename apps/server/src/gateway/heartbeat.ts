/**
 * Server-side WebSocket liveness.
 *
 * A browser cannot send a protocol-level ping, so the SERVER drives it: every
 * `intervalMs` a sweep marks each client not-alive, pings it, and terminates any
 * client that was still not-alive AT THE START of the sweep — i.e. it missed the
 * previous pong. One missed pong = terminate: a NAT black-holed socket accepts
 * writes at the OS buffer, so `send` never throws and `broadcast`'s per-client
 * catch never fires (03 §3.2 step 6). The member leak is completely SILENT; only
 * active probing can reclaim it.
 *
 * Pure decision + timer, no `ws` import — the tests drive `tick()` directly.
 */

/** Ping cadence in ms. `0` (or a non-positive value) disables the heartbeat. */
const DEFAULT_INTERVAL_MS = 30_000;

export interface HeartbeatOptions {
  /** Ping cadence. Default `AIRP_WS_HEARTBEAT_MS` ?? 30_000. */
  intervalMs?: number;
  /** Injected clock — tests drive liveness without real timers. */
  now?: () => number;
}

export interface HeartbeatHandle {
  /** One sweep. Exported shape so a test can drive it directly. */
  tick(): void;
  stop(): void;
}

/** The subset of `ws.WebSocket` a sweep needs; keeps this module pure. */
export interface HeartbeatClient {
  isAlive?: boolean;
  ping(): void;
  terminate(): void;
  on(event: 'pong', handler: () => void): void;
}

/**
 * Pure decision for one client: a socket that did not answer the previous ping
 * is dead and MUST be terminated. `undefined` is a liveness UNKNOWN (the
 * connection-scoped init never ran) and MUST NOT be read as dead.
 */
export function shouldTerminate(state: { isAlive: boolean }): boolean {
  return state.isAlive === false;
}

/**
 * Start the liveness sweeper. It ONLY walks `wss.clients` when the timer fires,
 * so it **cannot** install the per-connection `isAlive = true` / `on('pong')`
 * wiring for connections created later — a connection made after a sweep would
 * keep `undefined` and never reset, so the next sweep would kill it. That wiring
 * MUST live in `wss.on('connection')` (`index.ts`, 03 §3.2 step 7 / §8).
 *
 * Mirrors `~/projects/an earlier Worldlines project/services/gateway/ws.mjs:134-155`.
 */
export function startHeartbeat(
  wss: { clients: Iterable<HeartbeatClient> },
  options?: HeartbeatOptions,
): HeartbeatHandle {
  // One `>0` idiom for both the env override and the "0 disables" contract
  // (same shape as `AIRP_TURN_TIMEOUT_MS`, lifecycle.ts:328).
  const envMs = Number(process.env.AIRP_WS_HEARTBEAT_MS);
  const intervalMs = options?.intervalMs ?? (envMs > 0 ? envMs : DEFAULT_INTERVAL_MS);
  let stopped = false;

  const tick = (): void => {
    if (stopped) return;
    // Snapshot first: a terminate mid-loop mutates `wss.clients`.
    for (const client of [...wss.clients]) {
      // `undefined` means the connection-scoped init never ran: read it as
      // ALIVE, or a socket created after the last sweep would be falsely killed
      // (03 §3.2 step 7). Normalise here, then let the pure decision rule.
      if (shouldTerminate({ isAlive: client.isAlive !== false })) {
        try {
          client.terminate();
        } catch {
          /* already gone — the next sweep would only retry the same socket */
        }
        continue;
      }
      client.isAlive = false;
      try {
        client.ping();
      } catch {
        /* a CLOSING socket throws here; the next sweep terminates it */
      }
    }
  };

  // `intervalMs <= 0` disables the heartbeat — same `>0` idiom as
  // `AIRP_TURN_TIMEOUT_MS` (lifecycle.ts:328). The returned handle stays valid
  // so the shutdown path needs no branch.
  const timer = intervalMs > 0 ? setInterval(tick, intervalMs) : undefined;
  // Never keep the process (or a test run) alive for a ping cadence.
  timer?.unref();

  return {
    tick,
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}
