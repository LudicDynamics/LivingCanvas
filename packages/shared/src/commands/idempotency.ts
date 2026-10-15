/**
 * World-command idempotency — `the design notes`, sections 2 to 4 and 8.
 *
 * The truth source for "has this run already settled?" is the `command_log`
 * array in the TRIGGERED ENTITY's own frontmatter. The event table is an audit
 * surface and is NEVER queried to decide whether to run (05 §4.3): it has no
 * index for the question, the command id only lives inside a JSON blob, and it
 * is append-only, so it cannot follow a rollback. The file can (05 §4.4).
 *
 * The attempt identity is `commandKey = source × hook × command × fact` — and
 * NOTHING else. `args` (`with:` and `{{ trigger.* }}`) and the command file's
 * own contents are deliberately absent (05 §3.5): the entity's frontmatter is
 * both what the command reads and what its effects write back, so a key that
 * covered args would be re-derived differently on the second trigger and the
 * run would be paid out twice. `plan` records which version of the rule wrote
 * the receipt, but it is provenance only and MUST NOT participate in the S3
 * verdict (05 §11.7).
 *
 * Everything here except `writeCommandLog` is pure and does NO file I/O.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ActionContext } from '../actions/types.js';
import type { ActionErrorCode } from '../actions/errors.js';
import { fail } from '../actions/errors.js';
import { parseFrontmatter, stringifyFrontmatter } from '../schemas/frontmatter.js';
import { WORLD_COMMAND_EFFECTS } from './effects.js';
import { WORLD_COMMAND_EFFECT_BUDGET } from './execute.js';
import type { CommandTriggerHook } from './bindings.js';
import { COMMAND_ID_RE, TEMPLATE_RE } from './limits.js';

/* ────────────────────────────────────────────────────────────────────────────
 * 1. Shape (05 §2.1) — the table is implemented entry for entry
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Maximum `command_log` entries per entity (05 §2.1).
 *
 * Over the limit the engine REFUSES; it never truncates. Dropping the oldest
 * entry would make that settled run look unsettled and it would be paid out a
 * second time — the exact failure this module exists to prevent. 32 distinct
 * runs on one entity is far above what a one-shot check card needs (it uses 1).
 */
export const COMMAND_LOG_MAX = 32;

/** Upper bound of a declaration site, `do[<i>]` or `do[<i>]#<k>` (k is 1-based). */
const STEP_AT_RE = /^do\[\d+\](#\d+)?$/;
const COMMAND_KEY_RE = /^[0-9a-f]{16}$/;
const PLAN_DIGEST_RE = /^[0-9a-f]{8}$/;
const EVENT_ID_RE = /^evt-\d+$/;

/**
 * One effect receipt. `step` is the FLATTENED execution order after `list-args`
 * expansion and is strictly contiguous from 0 (05 §5.7) — three `give` items
 * expanded from one `do[0]` get three distinct steps and share one `at`. The
 * resume cursor is `steps.length`, so a gap would resume from the wrong place.
 */
export const CommandLogStepSchema = z
  .object({
    step: z.number().int().min(0).max(WORLD_COMMAND_EFFECT_BUDGET - 1),
    at: z.string().regex(STEP_AT_RE),
    action: z.enum(WORLD_COMMAND_EFFECTS),
    /** `null` when the effect records no event (`link` rides on `give`). */
    event: z.string().regex(EVENT_ID_RE).nullable(),
  })
  .strict();

/**
 * One settled (or half-settled) run.
 *
 * `index` is the `on.<hook>[]` slot it was declared in. It is used to LOCATE
 * the binding again on resume and is kept out of the key on purpose: inserting
 * an entry mid-array would otherwise shift every later index and turn every
 * already-settled run back into "never ran" (05 §3.4).
 */
export const CommandLogEntrySchema = z
  .object({
    key: z.string().regex(COMMAND_KEY_RE),
    command: z.string().regex(COMMAND_ID_RE),
    hook: z.enum(['roll_resolved', 'choice_selected', 'use_item_on']),
    index: z.number().int().min(0).max(63),
    status: z.enum(['partial', 'done']),
    /** ISO-8601, produced by `ctx.now?.()` (the action layer's injectable clock). */
    at: z.string().min(1),
    /** `ctx.turn` verbatim; the action layer never parses it, only forwards it. */
    turn: z.string().nullable(),
    plan: z.string().regex(PLAN_DIGEST_RE),
    steps: z.array(CommandLogStepSchema).max(WORLD_COMMAND_EFFECT_BUDGET),
  })
  .strict();

export type CommandLogEntry = z.infer<typeof CommandLogEntrySchema>;
export type CommandLogStep = z.infer<typeof CommandLogStepSchema>;

/**
 * True when `steps[].step` is `0..n-1` with no gap and no repeat.
 *
 * A plain zod object cannot state this (it constrains each element, not the
 * sequence), so `readCommandLog` enforces it. §2.1 gives it its own error line,
 * and the reason it matters is §5.7: the resume cursor is `steps.length`, so a
 * hole would restart the run at the wrong effect.
 */
function isGapFreePrefix(steps: readonly CommandLogStep[]): boolean {
  return steps.every((s, i) => s.step === i);
}

/* ────────────────────────────────────────────────────────────────────────────
 * 2. The key (05 §3.1) — four components, no fifth
 * ──────────────────────────────────────────────────────────────────────────── */

export interface CommandKeyInput {
  /** World-relative path of the triggered entity (= target). */
  source: string;
  /** Trigger point; the set belongs to `02`. */
  hook: CommandTriggerHook;
  /** The `command/<id>.yaml` id (= intent). */
  command: string;
  /** The settled world fact for this run (05 §3.3) — already computed by the caller. */
  fact: string;
}

/**
 * 16 lowercase hex characters. Pure and synchronous, callable from both the
 * action layer and the extension side.
 *
 * NUL separates the components because neither a world path nor a command id
 * can contain it, so no escaping is needed and no component can bleed into the
 * next. The digest is truncated to 64 bits because the collision space that
 * matters is the ≤32 entries on ONE entity, where the odds are about 3e-17;
 * the full 64 characters would only make the frontmatter uglier.
 *
 * `fact` arrives pre-computed. Reading the item file in here would turn an
 * O(entries-on-this-entity) lookup with zero extra I/O into a disk read per
 * binding — which would demolish the reason `command_log` beat the event table.
 */
export function commandKey(input: CommandKeyInput): string {
  const material = [input.source, input.hook, input.command, input.fact].join('\u0000');
  return createHash('sha256').update(material, 'utf8').digest('hex').slice(0, 16);
}

/** Full sha256 hex of a file's raw contents. Pure — the caller supplies the text. */
export function revisionOf(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

/**
 * 8 hex characters: the digest of the command's DECLARED `do`, not of the
 * substituted form.
 *
 * PROVENANCE ONLY, NEVER A VERDICT (05 §11.7). It answers "which version of the
 * rule wrote this receipt", which is only useful if it can be compared against
 * the CURRENT file. A substituted digest would fold runtime values
 * (`{{ roll.result }}`, `{{ trigger.fm.* }}`) into the answer, so the same file
 * would digest differently on different triggers — and `{{ trigger.fm.* }}`
 * reads fields the command itself writes back, which is the self-reference
 * `05 §3.5` excludes from the key. If anyone makes `plan` a reason to re-run,
 * that excluded channel comes straight back.
 */
export function planDigest(declaredDo: unknown): string {
  return createHash('sha256').update(canonicalTextOf(declaredDo)).digest('hex').slice(0, 8);
}

/**
 * Structural canonicalization of a declared (unsubstituted) value: object keys
 * sorted, `{{ x.y }}` collapsed to `{{x.y}}`. Reuses the grammar's own regex
 * from `limits.ts` rather than restating it.
 */
function canonicalTextOf(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') {
    return value.replace(new RegExp(TEMPLATE_RE.source, 'g'), (whole, ref: string) => `{{${ref}}}`);
  }
  if (typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalTextOf).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalTextOf(record[k])}`).join(',')}}`;
  }
  return JSON.stringify(String(value));
}

/* ────────────────────────────────────────────────────────────────────────────
 * 3. Reading and writing the log
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * The failure record written to the entity's frontmatter (05 §2.2). SINGULAR,
 * not an array: a failure is the current state to act on, not a history. It is
 * cleared by the write that reaches `status: done`.
 */
export interface CommandError {
  key: string;
  command: string;
  hook: string;
  step: number;
  action: string;
  /** The action layer's own code, untranslated. */
  code: ActionErrorCode;
  /** `ActionError.message`, capped at 1000 characters. */
  message: string;
  /** Effects still outstanding, on the FLATTENED basis: `planned - done`. */
  pending: number;
  at: string;
}

/**
 * Parse `command_log` out of an already-parsed frontmatter mapping.
 *
 * FAIL-CLOSED (05 §5.1): a missing key means "never ran" and yields `[]`, but a
 * PRESENT key that does not match §2.1 throws `command_log_corrupt` instead of
 * being skipped. Skipping it would silently turn a corrupted receipt into
 * "never ran" and pay the run out a second time.
 */
export function readCommandLog(
  frontmatter: Record<string, unknown> | null,
  source: string
): CommandLogEntry[] {
  const raw = frontmatter === null ? undefined : frontmatter['command_log'];
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    fail('command_log_corrupt', corruptMessage(source, undefined, 'must be an array of entries'));
  }
  const entries: CommandLogEntry[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const parsed = CommandLogEntrySchema.safeParse(raw[i]);
    if (!parsed.success) {
      const issue = parsed.error.issues[0]!;
      fail('command_log_corrupt', corruptMessage(source, i, describeIssue(issue, raw[i])));
    }
    const entry = parsed.data;
    // §2.1's own row: `steps` must be a gap-free prefix. Enforced here because a
    // field-level zod schema cannot see the sequence.
    if (!isGapFreePrefix(entry.steps)) {
      fail(
        'command_log_corrupt',
        corruptMessage(source, i, "steps is not a gap-free prefix of the run's effect sequence")
      );
    }
    entries.push(entry);
  }
  return entries;
}

/**
 * Replace the entry carrying the same key in place, otherwise append.
 *
 * In-place replacement is what keeps a "failed then resumed to success" run
 * looking exactly like a plain success and leaves no trace of the failure in
 * the log (05 §2.2).
 */
export function upsertLogEntry(
  entries: CommandLogEntry[],
  entry: CommandLogEntry
): CommandLogEntry[] {
  const at = entries.findIndex((e) => e.key === entry.key);
  if (at >= 0) {
    const next = entries.slice();
    next[at] = entry;
    return next;
  }
  if (entries.length >= COMMAND_LOG_MAX) {
    fail(
      'command_log_full',
      `command_log already carries ${COMMAND_LOG_MAX} entries, the maximum. Truncating would let a settled run look unsettled and be paid out twice, so the engine refuses instead.`
    );
  }
  return [...entries, entry];
}

/**
 * Re-read the entity, merge `command_log` / `command_error`, write atomically.
 *
 * The re-read is mandatory (05 §5.4): an effect may have just written this very
 * file (`edit` writing `choice_actions` back to the source is a core use of
 * this feature), and writing a stale snapshot back would erase that effect's
 * result. There is no concurrency here — only the run stepping on itself.
 *
 * No event is appended. Every `steps[].event` already points at an event that
 * exists; a receipt for a receipt would be double bookkeeping, and routing this
 * through `editEntity` would emit an `entity_edited` per write and drown the
 * real causality in the writer's injection (05 §8.2).
 *
 * Pass `error: null` to clear a previous failure — that is the delete the write
 * reaching `status: done` performs (05 §2.2).
 */
export async function writeCommandLog(
  ctx: ActionContext,
  source: string,
  entries: CommandLogEntry[],
  error: CommandError | null
): Promise<void> {
  const parsed = parseFrontmatter(await ctx.store.readFile(source));
  if (parsed.frontmatter === null) {
    fail('malformed_entity', `"${source}" has no YAML frontmatter block`);
  }
  const merged: Record<string, unknown> = { ...parsed.frontmatter, command_log: entries };
  if (error === null) {
    delete merged['command_error'];
  } else {
    merged['command_error'] = {
      ...error,
      // Safe to truncate: this is display text, not an idempotency verdict (§2.2).
      message: error.message.length > 1000 ? `${error.message.slice(0, 999)}…` : error.message,
    };
  }
  await ctx.store.writeFileAtomic(source, stringifyFrontmatter(merged, parsed.body));
}

/* ────────────────────────────────────────────────────────────────────────────
 * 4. Error copy (05 §2.1's message column, verbatim)
 * ──────────────────────────────────────────────────────────────────────────── */

/** The §7 model-facing wrapper around one §2.1 message. */
function corruptMessage(source: string, entryIndex: number | undefined, detail: string): string {
  const where = entryIndex === undefined ? 'the command_log' : `entry ${entryIndex}`;
  return `"${source}" has a malformed command_log at ${where}: ${detail}. The engine owns this field — remove the hand-written entry instead of repairing it by hand.`;
}

/** Map one zod issue onto the §2.1 table's wording, interpolating the bad value. */
function describeIssue(issue: z.ZodIssue, entry: unknown): string {
  const path = issue.path;
  const head = String(path[0] ?? '');
  const value = valueAt(entry, path);
  if (head === 'steps' && path.length >= 2) {
    const j = Number(path[1]);
    const leaf = String(path[2] ?? '');
    if (leaf === 'step') return "steps is not a gap-free prefix of the run's effect sequence";
    if (leaf === 'at') return `steps[${j}].at must look like "do[1]" or "do[1]#2"`;
    if (leaf === 'action') {
      return `steps[${j}].action "${String(value)}" is not a known effect`;
    }
    if (leaf === 'event') return `steps[${j}].event must look like "evt-123" or be null`;
    return `steps[${j}] is not a valid step receipt`;
  }
  switch (head) {
    case 'key':
      return 'key must be 16 lowercase hex characters';
    case 'command':
      return `command "${String(value)}" is not a valid command id`;
    case 'hook':
      return `hook "${String(value)}" is not a known trigger point`;
    case 'index':
      return 'index must be a non-negative integer';
    case 'status':
      return 'status must be "partial" or "done"';
    case 'at':
      return 'at must be an ISO-8601 timestamp';
    case 'turn':
      return 'turn must be a string or null';
    case 'plan':
      return 'plan must be 8 lowercase hex characters';
    case 'steps':
      return 'steps must be an array of step receipts';
    default:
      return `${path.join('.') || '(root)'}: ${issue.message}`;
  }
}

/** Follow a zod issue path into the offending value, for the message templates. */
function valueAt(root: unknown, path: readonly (string | number)[]): unknown {
  let current: unknown = root;
  for (const segment of path) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string | number, unknown>)[segment];
  }
  return current;
}
