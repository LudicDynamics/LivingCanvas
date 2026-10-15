/**
 * Turn anchor for the A entry.
 *
 * pi-rp does NOT hand the turn index to a tool body: `ToolDefinition.execute`
 * receives an `ExtensionContext` that has `sessionManager` / `ui` / `mode` /
 * `cwd` — no `turnIndex` (vendor/pi-rp/packages/coding-agent/src/core/extensions/types.ts:315-340).
 * The only exposed source is the `turn_start` extension event, which carries
 * `turnIndex: number` (same file, `TurnStartEvent`).
 *
 * Module-level state is process = session (same precedent as doc-22 §4).
 */
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';

let currentTurnIndex = -1;

export function registerTurnTracking(pi: ExtensionAPI): void {
  pi.on('turn_start', (event) => {
    currentTurnIndex = event.turnIndex;
  });
}

/**
 * `turn:<sessionId>:<turnIndex>` — sessionId keeps two sessions' turn 0 apart
 * (doc-21 §5.4 rule 1 merges "same turn + same type + same actor"), turnIndex is
 * the ordinal within the session.
 *
 * `adhoc` is the documented fallback for "a tool ran before any turn started"
 * (an extension calling an action from `before_agent_start`).
 */
export function currentTurnAnchor(ctx: ExtensionContext): string {
  const sessionId = ctx.sessionManager.getSessionId();
  return currentTurnIndex < 0
    ? `turn:${sessionId}:adhoc`
    : `turn:${sessionId}:${currentTurnIndex}`;
}

/** Test seam: unit tests reset the module-level anchor between sessions. */
export function resetTurnTrackingForTests(): void {
  currentTurnIndex = -1;
}
