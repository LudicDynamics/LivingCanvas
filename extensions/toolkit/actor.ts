/**
 * Agent identity for every tool shell.
 *
 * pi-rp has NO "who am I" extension API — `ExtensionContext` carries
 * `sessionManager` / `ui` / `mode` / `cwd`, no role field. The ONLY identity
 * difference between the writer process and a character process is the env var
 * `AIRP_AGENT_ROLE`, injected by `airpEnv()` at spawn
 * (apps/server/src/engine/presets.ts).
 *
 * `resolveAgentActor` (packages/shared) is pure and never throws, so the whole
 * degradation table is unit-testable there; the warning is logged ONCE here.
 * Per-call logging would spam stderr a dozen times per scene-init, because
 * subagents (`spawnAgent` / `subagent`) run in this same process and inherit
 * this same env value.
 */
import { resolveAgentActor, AGENT_ROLE_ENV, type Actor } from '../../packages/shared/dist/index.js';

let actor: Actor | null = null;
let warned = false;

export function agentActor(): Actor {
  if (!actor) {
    const resolved = resolveAgentActor(process.env[AGENT_ROLE_ENV]);
    actor = resolved.actor;
    if (resolved.warning && !warned) {
      warned = true;
      process.stderr.write(`[airp/toolkit] ${resolved.warning}\n`);
    }
  }
  return actor;
}

/** Test seam — the process-level cache is one actor for the whole process. */
export function resetActorForTests(): void {
  actor = null;
  warned = false;
}
