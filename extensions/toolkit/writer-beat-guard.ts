/**
 * Writer top-level total tool-call guard.
 *
 * This is deliberately a runtime loop safety limit, not a Chalk or file policy.
 * The removed the team restrictions (one Chalk per turn, duplicate Chalk checks,
 * native write/edit blocking, path/name/content rules) would directly prevent a
 * Writer from fully initializing a scene, which may require many file changes.
 */
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

export const DEFAULT_WRITER_MAX_TOOL_CALLS = 24;
const WRITER_SCOPE = 'writer-top-level';
const WRITER_ROLE = 'writer';

function isSafePositiveInteger(value: number): value is number {
  return Number.isSafeInteger(value) && value > 0;
}

/**
 * Parse the process configuration without accepting JavaScript's looser number
 * syntax (whitespace, signs, decimals, exponents, or hexadecimal).
 */
export function parseWriterMaxToolCalls(raw: string | undefined, fallback = DEFAULT_WRITER_MAX_TOOL_CALLS): number {
  const safeFallback = isSafePositiveInteger(fallback) ? fallback : DEFAULT_WRITER_MAX_TOOL_CALLS;
  if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw)) return safeFallback;

  const value = Number(raw);
  return isSafePositiveInteger(value) ? value : safeFallback;
}

export interface WriterToolCallGuardOptions {
  maxToolCalls?: number;
  role?: string;
  scope?: string;
}

/**
 * Register the pre-execution hook and the agent-run reset hook.
 *
 * The guard spans one `agent_start` → `agent_end` run. pi-rp emits another
 * `turn_start` for each provider request inside a tool loop, so `turn_start`
 * is deliberately not a reset boundary here.
 */
export function registerWriterToolCallGuard(
  pi: ExtensionAPI,
  options: WriterToolCallGuardOptions = {},
): void {
  const role = options.role ?? process.env.AIRP_AGENT_ROLE;
  const scope = options.scope ?? process.env.AIRP_AGENT_SCOPE;
  if (role !== WRITER_ROLE || scope !== WRITER_SCOPE) return;

  const configuredMaxToolCalls = options.maxToolCalls;
  const maxToolCalls = configuredMaxToolCalls === undefined
    ? parseWriterMaxToolCalls(process.env.AIRP_WRITER_MAX_TOOL_CALLS)
    : isSafePositiveInteger(configuredMaxToolCalls)
      ? configuredMaxToolCalls
      : DEFAULT_WRITER_MAX_TOOL_CALLS;

  let toolCallsThisRun = 0;

  // agent_start is the player-request boundary. A tool loop emits additional
  // turn_start events, but those are continuation requests in this same run.
  pi.on('agent_start', () => {
    toolCallsThisRun = 0;
  });
  pi.on('tool_call', () => {
    toolCallsThisRun += 1;
    if (toolCallsThisRun <= maxToolCalls) return;

    return {
      block: true,
      reason: `Writer tool-call limit (${maxToolCalls}) reached for this agent run. Stop using tools and return a concise response; the player can continue on the next turn.`,
      terminate: true,
    };
  });
}
