/**
 * ToolResult wrapping for the A entry (the design notes table assigns this file
 * to doc-tools/12).
 *
 * Success and failure are two different code paths on purpose: `ActionResult`
 * has no `ok` field — "silently downgrading a failure into
 * a success result" is the bug this shape exists to prevent.
 */
import { ActionError } from '../../packages/shared/dist/index.js';
import type { AgentToolResult } from '@earendil-works/pi-coding-agent';

/** `{ text, details }` from the action layer → pi-rp tool result. */
export function ok<TDetails>(result: { text: string; details: TDetails }): AgentToolResult<TDetails> {
  return { content: [{ type: 'text', text: result.text }], details: result.details };
}

/** Add a real image attachment while retaining truthful structured details. */
export function okWithImage<TDetails>(
  result: { text: string; details: TDetails },
  image: { data: string; mimeType: 'image/png' }
): AgentToolResult<TDetails> {
  return {
    content: [
      { type: 'text', text: result.text },
      { type: 'image', data: image.data, mimeType: image.mimeType },
    ],
    details: result.details,
  };
}

/** `ActionError` → the frozen `isError:true` shape. */
export function fail(err: unknown): AgentToolResult<any> {
  if (err instanceof ActionError) return err.toToolResult();
  // A non-ActionError is a real bug: rethrow it so pi-rp's tool executor turns it
  // into a generic error result (agent-loop.ts) instead of us faking a domain error.
  throw err;
}

/**
 * Every shell's catch block is exactly this:
 *
 *   try { return ok(await svc.moveEntity(...)); }
 *   catch (err) { return fail(err); }
 *
 * Re-throwing a non-ActionError is deliberate: pi-rp turns it into a generic
 * error tool result, which is the honest outcome for an unexpected crash —
 * faking a domain error result would hide it.
 */
