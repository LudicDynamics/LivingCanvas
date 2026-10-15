/**
 * World commands: upper bounds, the three machine-field regexes, the reserved
 * root names, and the `{{ }}` interpolator.
 *
 * Lands two frozen designs in code:
 * - `the design notes` §2.8 / §8.1 — the constant table and
 *     the regular expressions the command-file parser validates against.
 * - `the design notes` §14 — template resolution plus the
 *     bounded-array rules (`list-args` / `fold-args` both consume this value).
 *
 * Signatures follow the frozen implementation contract §3.2 verbatim.
 *
 * ZERO runtime dependencies: the only imports are `import type`, so they are
 * erased at compile time and this module never participates in a runtime cycle.
 * The type-only edges (`./condition.js` for `Scalar`, `./execute.js` for
 * `WorldCommandRuntimeErrorCode`) are one-directional and therefore safe even
 * though `execute.ts` imports this file at runtime.
 */

import type { Scalar } from './condition.js';
import type { WorldCommandRuntimeErrorCode } from './execute.js';

/* ── 01 §2.8: upper bounds ─────────────────────────────────────────────── */

export const MAX_COMMAND_ID_LENGTH = 48;
export const MAX_COMMAND_NAME_LENGTH = 80;
export const MAX_COMMAND_DESC_LENGTH = 200;
export const MAX_COMMAND_FILE_BYTES = 32000;
export const MAX_COMMAND_PARAMS = 12;
/**
 * Declared `do[]` entries per command file. **This is `03`'s
 * `WORLD_COMMAND_STEP_LIMIT = 12`, NOT a second number.**
 *
 * Contract §R.17 (and §R.13's "阈值只存在一处") removed `01`'s own 16/32: two
 * constants for one quantity drift, and here the drift is load-bearing — `03`'s
 * T11 asserts that a 13-step command is REFUSED at write time. With 16 it was
 * accepted, and the check the whole budget argument rests on silently stopped
 * being a check. `execute.ts` also reads this name, so one value now decides
 * write-time validation and pre-flight alike.
 */
export const MAX_COMMAND_STEPS = 12;
/**
 * Hard cap on EXPANDED effects per TRIGGER, across every matching command
 * (`03` §6.2). Lives here, not in `execute.ts`, so that consumers of the
 * constant (`idempotency.ts`) do not pull the whole executor — and through it
 * the entire action layer — into their runtime import graph.
 *
 * Declared BEFORE the two names derived from it: `const` bindings are in the
 * temporal dead zone until initialised, so a forward reference would throw at
 * module load, not at first use.
 */
export const WORLD_COMMAND_EFFECT_BUDGET = 24;
/**
 * Hard cap on a command's DECLARED `do[]` effects at write time (`01` §3.1's
 * S11). A `list-args` step expands, so the expanded count can exceed the step
 * count; this bounds the DECLARATION. `01` §R.17 fixes it at `03`'s
 * `WORLD_COMMAND_EFFECT_BUDGET` (24) — the same number the per-trigger gate uses,
 * because a single command can never lawfully exceed a whole trigger's budget.
 *
 * Two different quantities live here; do not conflate them:
 *   - `MAX_COMMAND_STEPS` (12) = declared `do[]` entries.
 *   - `MAX_COMMAND_EFFECTS` (24) = declared effects after `list-args` expansion,
 *     and ALSO the per-TRIGGER budget across every matching command (`03` §6.2).
 */
export const MAX_COMMAND_EFFECTS = WORLD_COMMAND_EFFECT_BUDGET;
export const MAX_COMMAND_STRING = 2000;
export const MAX_COMMAND_ARG_DEPTH = 6;
export const MAX_COMMAND_ARG_KEYS = 16;
export const MAX_COMMAND_REFS = 24;
export const MAX_COMMAND_WHEN_LENGTH = 200;
export const MAX_ENUM_VALUES = 16;
export const MAX_RUN_DEPTH = 1;
/** Post-substitution total across every arg of one command (§2.3 hard rule 2).
 *  `R.17` fixes it at `MAX_COMMAND_EFFECTS × MAX_COMMAND_STRING` = 48 000. */
export const MAX_COMMAND_TOTAL_CHARS = MAX_COMMAND_EFFECTS * MAX_COMMAND_STRING;
/**
 * ENTITY-SIDE schema bounds, NOT command-file limits. They are the anchor of
 * `09`'s R10 argument (iteration count is decided by a quantity the untrusted
 * side cannot rewrite). They MUST live in the entity's Zod schema, e.g.
 * `rewards: z.array(RewardSchema).max(MAX_ARRAY_REWARDS)`.
 */
export const MAX_ARRAY_REWARDS = 3;
export const MAX_ARRAY_OPTIONS = 2;

/* ── 01 §2.1 / §2.3 / §2.7: machine fields ─────────────────────────────── */

/** `command/<id>.yaml` → `<id>`. Kebab-case, lowercase. */
export const COMMAND_ID_RE: RegExp = /^[a-z0-9][a-z0-9-]{0,47}$/;
/** A declared parameter name (`params:` key, `{{ name }}` shorthand). */
export const PARAM_NAME_RE: RegExp = /^[a-zA-Z_][a-zA-Z0-9_]{0,31}$/;
/**
 * An argument key / any machine field. ASCII printable only — these are never
 * translated (`tools/localize-world-editions.mjs:38`), so a non-ASCII machine
 * field is a silent-corruption risk.
 */
export const ARG_KEY_RE: RegExp = /^[\x20-\x7E]+$/;
/** Reserved roots. `params` MUST NOT collide with these (§2.3). */
export const RESERVED_ROOTS: readonly string[] = ['params', 'trigger', 'roll', 'choice', 'item', 'entry'];

/**
 * Matches one `{{ path }}`. Path = ident ('.' ident | '[' digits ']')*.
 *
 * `01 §2.5` gives this as a grammar, not as a literal regex — the source below
 * is that grammar transcribed, with the "optional spaces" between the braces
 * realized as space-or-tab (the same `ws()` set the condition scanner uses).
 *
 * Deliberately NOT global: a shared exported `RegExp` with `g` carries mutable
 * `lastIndex` state across callers. The interpolator builds its own global
 * scanner from the same source.
 */
const SEGMENT_SRC = '[A-Za-z_][A-Za-z0-9_]*';
const TEMPLATE_PATH_SRC = `${SEGMENT_SRC}(?:\\.${SEGMENT_SRC}|\\[\\d+\\])*`;
const TEMPLATE_SRC = `\\{\\{[ \\t]*(${TEMPLATE_PATH_SRC})[ \\t]*\\}\\}`;
export const TEMPLATE_RE: RegExp = new RegExp(TEMPLATE_SRC);

/* ── 03 §14: interpolation and bounded arrays ──────────────────────────── */

/** 03 §14.4 MUST 2: the array bound comes from the schema, never from measurement. */
export const WORLD_COMMAND_ARG_ARRAY_MAX = 3;

/**
 * The value of one interpolated effect argument. Arrays can only originate from
 * a static path on `trigger.entry.*` / `trigger.fm.*` — a literal inline array
 * is content, and content lives in the entity (Main 方向三).
 *
 * Order is significant: `fold-args` derives its map key order from this array,
 * and `05`'s `plan` digest depends on a stable key order (03 §14.2 contract 3).
 */
export type InterpolatedValue = Scalar | Scalar[];

/** One `{{ ref }}` occurrence inside the raw argument string. */
interface TemplateSegment {
  ref: string;
  /** Offset of the whole `{{ … }}` in `raw`. */
  index: number;
  /** Length of the whole `{{ … }}`, so name + indices are measured in place. */
  length: number;
}

/**
 * One `{{ ref }}`, leading/trailing spaces inside the braces stripped.
 *
 * Built per call, never shared: a module-level `/g` regex carries mutable
 * `lastIndex` across callers (and across nested calls), so sharing one would
 * make the interpolator non-reentrant. Construction cost is negligible next to
 * the string work it does.
 */
const inlineScanRe = (): RegExp => new RegExp(TEMPLATE_SRC, 'g');

/**
 * A `{{` that opens while another `{{` is still open — 03 §14.1 MUST 1. Nested
 * templates MUST be rejected, because a dynamic index would make the effect
 * count unbounded. Tested against the RAW string, not the leftovers: the inner
 * `{{ i }}` of `{{ a[{{ i }}] }}` is itself a well-formed match, so scanning
 * matches alone cannot tell nesting from two adjacent templates.
 */
const NESTED_TEMPLATE_RE = /\{\{(?:(?!\}\})[\s\S])*\{\{/;

/**
 * Canonical literal of a scalar, used when a `{{ }}` is only part of a larger
 * string (01 §2.5: "number/boolean 用规范字面量"). `null` prints as `null`,
 * matching the literal `normalizeScalar` (\`interactive.ts:54\`) folds back to null.
 */
function canonicalScalar(value: Scalar): string {
  if (value === null) return 'null';
  return typeof value === 'string' ? value : String(value);
}

function interpolationError(
  code: WorldCommandRuntimeErrorCode,
  message: string
): { ok: false; error: { code: WorldCommandRuntimeErrorCode; message: string } } {
  return { ok: false, error: { code, message } };
}

/**
 * Reject an array that the engine cannot bound statically (03 §14.3):
 * longer than `WORLD_COMMAND_ARG_ARRAY_MAX` → `arg_array_too_long`;
 * an element that is itself an array → `nested_arg_array` (otherwise the bound
 * would be `3^n` instead of `3`). An EMPTY array is legal and stays legal —
 * "this band grants nothing" is a real world state (03 §14.3, T21).
 */
function checkArrayShape(
  ref: string,
  value: readonly unknown[]
): { ok: true } | { ok: false; error: { code: WorldCommandRuntimeErrorCode; message: string } } {
  if (value.length > WORLD_COMMAND_ARG_ARRAY_MAX) {
    return interpolationError(
      'arg_array_too_long',
      `"{{ ${ref} }}" has ${value.length} items; the maximum is ${WORLD_COMMAND_ARG_ARRAY_MAX}.`
    );
  }
  for (const element of value) {
    if (Array.isArray(element)) {
      return interpolationError(
        'nested_arg_array',
        `"{{ ${ref} }}": array elements must be scalars; nesting arrays is not allowed.`
      );
    }
  }
  return { ok: true };
}

/**
 * Resolve one effect argument (03 §14.2).
 *
 * Two rules, decided by whether the whole scalar IS the reference (01 §2.5):
 *   - whole-string `"{{ path }}"` → the referenced value keeps its own type
 *     (`number` / `boolean` / array are preserved, never stringified);
 *   - `{{ path }}` inside a larger string → string concatenation, and an array
 *     there is an error rather than a serialization convention.
 *
 * This function is the value source ONLY. It does not know which effect is
 * asking, so it MUST NOT iterate or fold — `list-args` vs `fold-args` is `04`'s
 * effect table, and the array is returned whole (03 §14.2 contracts 1 & 2).
 * It also MUST NOT sort, dedupe, or round-trip through a `Set`/object: order is
 * load-bearing (03 §14.2 contract 3, T19).
 *
 * Parsing happens first, inside this call: a malformed or nested template is
 * rejected before any lookup, so nothing is ever resolved against a partial
 * parse (03 §14.1 MUST 1 requires the nesting rejection to be a parse verdict).
 *
 * `vars` is keyed by the full reference path, e.g. `"trigger.entry.rewards"`.
 * A key that is absent means the reference does not exist → `unresolved_ref`
 * (03 §3.3), which the caller MUST surface rather than treat as false/empty.
 */
export function evaluateInterpolation(
  raw: string,
  vars: ReadonlyMap<string, InterpolatedValue>
): { ok: true; value: InterpolatedValue } | { ok: false; error: { code: WorldCommandRuntimeErrorCode; message: string } } {
  // A pure literal is returned verbatim: substitution is the identity there.
  if (!raw.includes('{{')) return { ok: true, value: raw };

  const segments: TemplateSegment[] = [];
  const scan = inlineScanRe();
  for (let m = scan.exec(raw); m !== null; m = scan.exec(raw)) {
    segments.push({ ref: m[1]!, index: m.index, length: m[0].length });
  }

  // Nesting first: it is an explicit §14.1 MUST with its own code, and the
  // outer half of a nested pair survives as an unmatched `{{` — so a
  // malformed-template check running first would steal the verdict.
  if (NESTED_TEMPLATE_RE.test(raw)) {
    return interpolationError(
      'nested_interpolation',
      `bad template ${JSON.stringify(raw)}: nested {{ }} in a path is not allowed. Indices must be literal integers.`
    );
  }

  // Anything else the matcher did not consume is an unbalanced `{{`. Defensive
  // here — `01`'s parser rejects it at write time — but a hand-written command
  // file could still reach the runtime, so it MUST NOT be silent.
  let leftover = '';
  let cursor = 0;
  for (const segment of segments) {
    leftover += raw.slice(cursor, segment.index);
    cursor = segment.index + segment.length;
  }
  leftover += raw.slice(cursor);
  if (leftover.includes('{{')) {
    return interpolationError(
      // NOTE: `01` owns the write-time code `malformed_template`, which is NOT a
      // member of `WorldCommandRuntimeErrorCode`. A malformed template cannot
      // survive write validation, so this branch reports with the closest
      // runtime code instead of inventing one.
      'type_mismatch',
      `bad template ${JSON.stringify(raw)}: expected "{{ name }}" or "{{ trigger.fm.title }}".`
    );
  }

  const wholeString =
    segments.length === 1 && segments[0]!.index === 0 && segments[0]!.length === raw.length;

  if (wholeString) {
    const ref = segments[0]!.ref;
    const value = vars.get(ref);
    if (value === undefined) {
      return interpolationError('unresolved_ref', `"${ref}" does not exist.`);
    }
    if (Array.isArray(value)) {
      const shape = checkArrayShape(ref, value);
      if (!shape.ok) return shape;
      return { ok: true, value };
    }
    return { ok: true, value };
  }

  // Inline template: literals and scalars only.
  let out = '';
  cursor = 0;
  for (const segment of segments) {
    out += raw.slice(cursor, segment.index);
    cursor = segment.index + segment.length;
    const value = vars.get(segment.ref);
    if (value === undefined) {
      return interpolationError('unresolved_ref', `"${segment.ref}" does not exist.`);
    }
    if (Array.isArray(value)) {
      return interpolationError(
        // NOTE: `01` owns the write-time code `array_in_inline_template`, which
        // is NOT a member of `WorldCommandRuntimeErrorCode` (see the nested case
        // above). Inline arrays are rejected at write time, so this is the
        // defensive arm.
        'type_mismatch',
        `"{{ ${segment.ref} }}" is an array and cannot be embedded in a larger string. Pass it as the whole value.`
      );
    }
    out += canonicalScalar(value);
  }
  out += raw.slice(cursor);
  return { ok: true, value: out };
}
