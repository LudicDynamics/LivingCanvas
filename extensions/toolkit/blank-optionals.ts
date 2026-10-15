/**
 * Blank optional arguments are absent arguments.
 *
 * Some models (observed: gpt-5.6 through the Vercel gateway) fill EVERY declared
 * parameter, sending `append_to: ""` or `near: ""` for the ones they do not
 * mean. The action layer rightly treats a present-but-empty value as a
 * contradiction ("chalk accepts either path or append_to, not both") and
 * refuses — and the model, seeing the refusal, retries the identical call.
 * In first-snow-zh that was seven `chalk` calls in a row, seven streamed
 * phantoms on the canvas, and nothing landed.
 *
 * The fix lives at the transport edge, once, for every tool: a declared
 * OPTIONAL property whose value is null, undefined or whitespace-only is
 * dropped before the shell sees it. Required properties are never touched —
 * an empty required string is still the model's error to hear about.
 */
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';

interface ObjectSchemaLike {
  required?: readonly string[];
}

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

/** Pure: `params` without its blank optional properties (required ones are kept verbatim). */
export function stripBlankOptionals<T extends Record<string, unknown>>(schema: ObjectSchemaLike | undefined, params: T): T {
  const required = new Set(Array.isArray(schema?.required) ? schema.required : []);
  const out: Record<string, unknown> = { ...params };
  for (const [key, value] of Object.entries(out)) {
    if (required.has(key)) continue;
    if (isBlank(value)) delete out[key];
  }
  return out as T;
}

/** The same tool, with `execute` seeing normalised params. Name, schema and prompt text are untouched. */
export function withoutBlankOptionals<T extends ToolDefinition>(tool: T): T {
  const execute = tool.execute.bind(tool) as (...args: unknown[]) => unknown;
  return {
    ...tool,
    execute: (toolCallId: unknown, params: unknown, ...rest: unknown[]) =>
      execute(toolCallId, stripBlankOptionals(tool.parameters as ObjectSchemaLike, (params ?? {}) as Record<string, unknown>), ...rest),
  } as T;
}
