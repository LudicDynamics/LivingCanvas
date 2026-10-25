/**
 * When the header's agent status (components/AgentSettings.tsx) asks GET /api/agent-settings again — pure, tested
 * in apps/web/test/world-load-error.test.mjs. Before any world is open the server answers 409 no_active_world to
 * every call, and the old fixed 5 s loop flooded the console with them (canvas-20261011-0211):
 *   - no world open (`worldOpen` false, or the server said no_active_world): no polling; it starts when one opens;
 *   - other failures: back off 5 s → 10 s → 20 s … up to a minute;
 *   - healthy: every 2 s with the panel open, 5 s closed;
 *   - the agents are starting (503 `agent_starting`: a world load, a restart): every 3 s, no back-off — it is
 *     coming up, and the header says so ("角色正在启动") instead of looking disconnected.
 * Null = do not ask again (until the world changes).
 */
export const AGENT_POLL_MAX_MS = 60_000;

export const AGENT_STARTING_POLL_MS = 3000;

export function agentSettingsPollDelay(input: { open: boolean; worldOpen: boolean; failures: number; noWorld: boolean; starting?: boolean }): number | null {
  if (!input.worldOpen || input.noWorld) return null;
  if (input.starting) return AGENT_STARTING_POLL_MS;
  const base = input.open ? 2000 : 5000;
  if (input.failures <= 0) return base;
  return Math.min(AGENT_POLL_MAX_MS, 5000 * 2 ** (input.failures - 1));
}
