/**
 * AIRP agent-activity protocol types (extension side).
 *
 * The engine (pi-rp ≥ the transient-activity change) forwards subagent tool
 * activity as transient `agent_activity` events on the parent session's event
 * stream, and extensions self-report command activity via `pi.emitActivity`.
 * There is no hidden-custom-message relay anymore — the former
 * `airp_agent_activity` envelope-over-custom-message transport and its
 * observers (`relayActivityViaParentMessage`, `observeSubagentSession`) are
 * gone; the server's projector (`apps/server/src/engine/agent-activity.ts`)
 * consumes the engine events directly and owns the authoritative versions of
 * these shapes (plus `ActivitySource`, `AgentActivityFrame`, projection).
 *
 * This module only mirrors the wire shapes that extensions need to build
 * well-formed `emitActivity` payloads. Keep in sync with the server module.
 */

export type ActivitySource = 'writer' | 'character' | 'functional';

export interface ActivityTurnContext {
  source: ActivitySource;
  agentId: string;
  turnId: string;
}
