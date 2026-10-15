/**
 * Domain failures must reach the runtime as failures.
 *
 * the design notes lets a shell RETURN `ActionError.toToolResult` —
 * `{ content, isError: true, details: { code, httpStatus } }`. The vendored
 * pi-rp does not read that flag: `executePreparedToolCall` wraps whatever a
 * tool returns as `{ result, isError: false }` and only a THROWN error becomes
 * `isError: true` (vendor/pi-rp/packages/agent/src/agent-loop.ts). So every
 * `invalid_argument` / `not_found` the action layer refused was recorded as a
 * success whose text happened to say otherwise: the model saw no error and
 * retried the identical call (first-snow-zh: seven `chalk` calls in a row),
 * the event bridge emitted `chalk_landed`, the canvas kept every phantom, and
 * the activity panel showed a green tick.
 *
 * pi-rp DOES honour `isError` returned from a `tool_result` extension hook
 * (extensions/runner.ts → agent-session.ts). This hook is that one line: an
 * `ActionError` shape in `details` flips the flag. Success details never
 * carry `httpStatus`, so nothing else matches.
 */
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

/** Pure: does this tool result carry an `ActionError.toToolResult()` payload the runtime missed? */
export function actionErrorMissed(event: { isError?: boolean; details?: unknown }): boolean {
  if (event.isError) return false;
  const details = event.details;
  if (!details || typeof details !== 'object') return false;
  const { code, httpStatus } = details as { code?: unknown; httpStatus?: unknown };
  return typeof code === 'string' && typeof httpStatus === 'number' && httpStatus >= 400;
}

export function registerActionErrorFlag(pi: ExtensionAPI): void {
  pi.on('tool_result', (event) => (actionErrorMissed(event) ? { isError: true } : undefined));
}
