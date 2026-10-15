/**
 * Entity-side `on` bindings — the trigger hooks, the two frozen code sets, and
 * the ONE binding parser shared by the write gate and the trigger layer.
 *
 * Lands `the design notes` §2.4 / §2.5 / §2.6 / §3.5 / §10 in code.
 * Signatures follow the frozen implementation contract §3.3 verbatim.
 *
 * `parseOnBindings` is PURE, SYNCHRONOUS and does NO I/O: it validates an
 * already-parsed frontmatter mapping and returns structured errors. Two
 * consequences, both deliberate (`02` §3.5 / §11.1):
 *   - Three of the twenty §10.1 codes are DECLARED here but never PRODUCED:
 *     `on_command_not_found`, `on_with_unknown_param` and
 *     `on_missing_required_param` all need the `command/<id>.yaml` file, which
 *     this module is forbidden to read. `07`'s write gate owns them (§7).
 *   - Line/column are omitted: this module never sees the YAML source, so
 *     `OnBindingError.line` / `.col` are NOT part of the contract §3.3 shape.
 *
 * Dependency direction (contract §2): `bindings.ts ──► limits.ts`, nothing else.
 * `condition.js` owns the `when` grammar and is NOT imported here — so `when`
 * is validated structurally (type / length) and the grammar verdict belongs to
 * `03`, invoked by `07` (§11.1: `parseCommandWhen` is `03`'s).
 */

import {
  COMMAND_ID_RE,
  MAX_COMMAND_WHEN_LENGTH,
  RESERVED_ROOTS,
  TEMPLATE_RE,
} from './limits.js';
import type { CommandEffectOutcome } from './execute.js';

/* ── §2.2 / §2.6: trigger vocabulary ─────────────────────────────────────── */

/**
 * The three trigger points. §2.2's single rule: the hook name IS the world
 * event type the action appended, which is why the set is closed at three.
 */
export type CommandTriggerHook = 'roll_resolved' | 'choice_selected' | 'use_item_on';

/** §3 steps 1 / 1b: `fresh` = the action just landed; `resume` = finish a partial run. */
export type CommandTriggerMode = 'fresh' | 'resume';

/** The closed hook set in §2.4's documented order (the error message lists it). */
export const COMMAND_TRIGGER_HOOKS = Object.freeze([
  'roll_resolved',
  'choice_selected',
  'use_item_on',
] as const);

/**
 * §10.2.1 — the 16 error codes. Bidirectionally equal to that table's `code`
 * column (contract §R.25: EQUAL, never a union). Kept as a runtime frozen list
 * so the union and the list cannot drift and the equality is checkable.
 */
export const COMMAND_OUTCOME_CODES = Object.freeze([
  // Parse layer — the write gate should already have stopped these (second line).
  'on_malformed',
  'choice_actions_conflict',
  'command_not_found',
  'command_malformed',
  'param_invalid',
  'when_malformed',
  // `from` / entry binding layer (contract §R.19 / §R.20).
  'on_from_missing_key',
  'on_from_not_a_list',
  'on_from_empty_list',
  'on_entry_unavailable',
  'on_entry_not_bound',
  // `resume` only: this binding must be evaluated, but its facts cannot be rebuilt.
  'facts_unavailable',
  'command_resume_drifted',
  // Execution layer — shape and semantics belong to `03`.
  'effect_failed',
  'limit_exceeded',
  'internal',
] as const);
export type CommandOutcomeCode = (typeof COMMAND_OUTCOME_CODES)[number];

/**
 * §10.2.2 — `skipped` reasons are a SEPARATE enumeration, not codes (contract
 * B-1). `already_done` means "this did not happen again", not "this failed".
 */
export const COMMAND_SKIP_REASONS = Object.freeze([
  'when_false',
  'reentrant',
  'short_circuit',
  'already_done',
] as const);
export type CommandSkipReason = (typeof COMMAND_SKIP_REASONS)[number];

/** §2.6 — the trigger layer's ONLY output shape. */
export interface CommandOutcome {
  /** `<binding>.run`, verbatim. */
  command: string;
  hook: CommandTriggerHook;
  /** The entity carrying `on` == the subject of the event that triggered it. */
  source: string;
  /** 0-based index inside `on.<hook>`; declaration order IS execution order (§2.3). */
  binding: number;
  status: 'ok' | 'skipped' | 'error';
  /** Present iff `status === 'skipped'`. Not a failure (§10.2.2). */
  skipped?: CommandSkipReason;
  /** Present iff `status === 'error'`. */
  code?: CommandOutcomeCode;
  message?: string;
  /**
   * The idempotency verdict, surfaced verbatim (`02:537`): the trigger's ONLY
   * same-turn channel for telling "this actually ran" from "this reused an
   * earlier result". Both are correct outcomes, but conflating them lies to the
   * reader. Structurally typed rather than imported from `run.ts`, because the
   * dependency direction is `run.ts → bindings.ts`, never the reverse — so this
   * shape MUST stay STRUCTURALLY IDENTICAL to `run.ts`'s `SettleReport` or it
   * stops being a structural match and becomes a second, drifting truth.
   *
   * Two things that must not be dropped:
   *   - `effects` on every verb, including `reused`: without it "this was a
   *     reuse" collapses to a bare verb with no way to see WHICH effects were
   *     reused. `reused` entries are rebuilt from the settled `command_log`.
   *   - `resumed`'s `from` / `to` (`05` §5.6): the model reads "how many steps
   *     were completed", and `resumed` MUST NOT be folded into `reused`.
   */
  settleReport?: {
    ran: ReadonlyArray<{ key: string; command: string; steps: number; effects: ReadonlyArray<CommandEffectOutcome> }>;
    reused: ReadonlyArray<{ key: string; command: string; steps: number; effects: ReadonlyArray<CommandEffectOutcome> }>;
    resumed: ReadonlyArray<{ key: string; command: string; steps: number; effects: ReadonlyArray<CommandEffectOutcome>; from: number; to: number }>;
    failed?: { key: string; command: string; step: number; code: string; message: string };
  };
  /** Per-effect projection from the evaluator; type owned by `03` (`execute.ts`). */
  effects?: CommandEffectOutcome[];
}

/* ── §10.1: the write-time code set ─────────────────────────────────────── */

/**
 * §10.1 — the 20 codes. Bidirectionally equal to that table's `code` column
 * (contract §R.25: EQUAL, never a union). NOT a new `ActionErrorCode`: §10.1
 * routes every one of these through the existing `invalid_field_value`
 * (`actions/errors.ts:3-22`); these are the stable message prefixes.
 */
export const ON_BINDING_ERROR_CODES = Object.freeze([
  // `on` / `on.<hook>` shape (write time).
  'on_not_a_mapping',
  'on_unknown_hook',
  'on_not_a_list',
  'on_too_many_bindings',
  // `<binding>` shape (write time).
  'on_missing_run',
  'on_bad_command_id',
  'on_command_not_found',
  'on_bad_when',
  'on_with_unknown_var',
  'on_with_unknown_param',
  'on_missing_required_param',
  'on_with_not_scalar',
  'on_reserved_param_name',
  'on_unquoted_template',
  // §9.2: `choice_actions` and `on.choice_selected` resolve in different layers
  // and would double-settle; declaring both is refused, not merged.
  'choice_actions_conflict',
  // Cross-field `from` reference (contract §R.19 / §R.20, §2.4).
  'on_from_missing_key',
  'on_from_not_a_list',
  'on_from_empty_list',
  'on_entry_unavailable',
  'on_entry_not_bound',
] as const);
export type OnBindingErrorCode = (typeof ON_BINDING_ERROR_CODES)[number];

/**
 * §11.1 — structured, NOT a prose `string[]`: `07`'s write gate picks these into
 * `block.reason` one by one, and prefix-matching prose silently breaks whenever
 * a message is reworded.
 */
export interface OnBindingError {
  code: OnBindingErrorCode;
  /** One English line, for the agent to self-repair. */
  message: string;
  /** Index of the offending binding within its hook list; omitted for group-level errors. */
  bindingIndex?: number;
}

/** §2.4 / §11.1 — one normalized binding. */
export interface OnBinding {
  /** Optional expression; absent = unconditional (§2.4). Grammar belongs to `03`. */
  when?: string;
  /** REQUIRED. Names the world command, `command/<run>.yaml` (§2.2). */
  run: string;
  /**
   * Optional (§R.20). Names an array in THIS entity's own frontmatter; binding
   * `i` takes entry `i` (contract §R.19, one-to-one by index).
   */
  from?: string;
  /** Actual arguments. Values are scalars or `{{ … }}` templates (§2.4). */
  with: Record<string, unknown>;
  /** Default `stop` (§2.4): a half-finished consequence is worse than none. */
  onError: 'stop' | 'continue';
}

/** §11.1 — the parser's result. */
export interface OnBindingsParseResult {
  /** `null` = the entity does not declare this hook (not an error). */
  bindings: OnBinding[] | null;
  /** Non-empty = NO binding of this hook may run (fail-closed, §3 step 4). */
  errors: OnBindingError[];
}

/* ── §2.5: the closed variable table ────────────────────────────────────── */

/**
 * The variables every hook exposes (§2.5 "通用变量"). `trigger.fm.*` and
 * `trigger.entry.*` are open PATHS, so they are listed with a `.*` marker that
 * `isKnownReference` treats as a prefix — the marker is not a variable name.
 *
 * `trigger.entry.*` is the only OPTIONAL member (contract §R.24): it exists
 * iff this binding declares `from`. That conditional is enforced separately by
 * `on_entry_not_bound`, not by membership here.
 *
 * Deliberately absent: `ctx.turn` (opaque merge anchor, never parsed — see
 * §2.5), `roll.rolls` (a `number[]`; `when` compares scalars only, T-6) and
 * `status.*` (exposing it would force §3 step 3 to re-read the file).
 */
const COMMON_VARIABLES: readonly string[] = Object.freeze([
  'trigger.path',
  'trigger.name',
  'trigger.id',
  'trigger.hook',
  'trigger.fm.*',
  'trigger.entry.*',
  'actor',
  'actor_id',
  'layer',
]);

/** §2.5 `roll_resolved`. `roll.crit`/`fumble`/`forged` are `fresh`-only (§3 step 5b). */
const ROLL_VARIABLES: readonly string[] = Object.freeze([
  'roll.result',
  'roll.passed',
  'roll.crit',
  'roll.fumble',
  'roll.forged',
  'roll.dice',
  'roll.expect',
  'roll.desc',
  'roll.name',
  'roll.layer',
  // The four-band grade every roll with a known convention gets, and a skill
  // check's tier / skill / target.
  'roll.grade',
  'roll.rank',
  'roll.tier',
  'roll.skill',
  'roll.target',
  // The shared outcome tier: crit_success /
  // success / fail / crit_fail, and its rank 1..4 (== roll.rank when graded).
  'roll.outcome',
  'roll.outcome_rank',
]);

/** §2.5 `choice_selected`. `choice.option_id` is `NEW` (the only stable dispatch key). */
const CHOICE_VARIABLES: readonly string[] = Object.freeze([
  'choice.option_id',
  'choice.option',
  'choice.index',
  'choice.count',
  'choice.name',
]);

/** §2.5 `use_item_on`. `target.*` (never `item.*`) is the trigger entity. */
const USE_ITEM_VARIABLES: readonly string[] = Object.freeze([
  'item.path',
  'item.name',
  'target.path',
  'target.name',
  'target.kind',
  'handled',
  'effect',
  'reason',
]);

const HOOK_VARIABLES: Readonly<Record<CommandTriggerHook, readonly string[]>> = Object.freeze({
  roll_resolved: Object.freeze([...COMMON_VARIABLES, ...ROLL_VARIABLES]),
  choice_selected: Object.freeze([...COMMON_VARIABLES, ...CHOICE_VARIABLES]),
  use_item_on: Object.freeze([...COMMON_VARIABLES, ...USE_ITEM_VARIABLES]),
});

/**
 * The closed variable-name set for one hook (§2.5). Write-time callers use it to
 * check `{{ }}` statically; the trigger layer uses it for the same check at
 * `param_invalid` time.
 *
 * An unrecognized hook (only reachable by bypassing the type) yields `[]` — an
 * empty set recognizes nothing, which fails closed.
 */
export function triggerVariables(hook: CommandTriggerHook): readonly string[] {
  return HOOK_VARIABLES[hook] ?? [];
}

/** True iff `ref` names a variable of `hook`; `trigger.fm.` / `trigger.entry.` prefix-match. */
function isKnownReference(hook: CommandTriggerHook, ref: string): boolean {
  for (const name of triggerVariables(hook)) {
    if (name.endsWith('.*')) {
      if (ref.startsWith(name.slice(0, -1))) return true;
    } else if (name === ref) {
      return true;
    }
  }
  return false;
}

/**
 * §2.4 — the parser. Pure, synchronous, no I/O (§3.5 / §11.1).
 *
 * `hook === null` validates the WHOLE `on` (write-time use by `07`); a given
 * hook validates only that group (trigger-time use, §3 step 4). Non-empty
 * `errors` always yields `bindings: null` — fail-closed, one bad binding stops
 * the whole hook group rather than half-running it (§3.1 of the result shape).
 *
 * In whole-`on` mode `bindings` stays `null` by construction: there is no single
 * group to return, and `07` consumes `errors` only.
 */
export function parseOnBindings(
  frontmatter: Record<string, any> | null,
  hook: CommandTriggerHook | null
): OnBindingsParseResult {
  const errors: OnBindingError[] = [];
  if (!isPlainObject(frontmatter)) return { bindings: null, errors };

  const raw = frontmatter['on'];
  // An absent key and an empty one are the same statement: this entity binds
  // nothing. Only a WRONG-typed value is an error (§2.4).
  if (raw === undefined || raw === null) return { bindings: null, errors };
  if (!isPlainObject(raw)) {
    errors.push({
      code: 'on_not_a_mapping',
      message: `"on" must be a mapping of hook names to binding lists, got ${typeName(raw)}.`,
    });
    return { bindings: null, errors };
  }

  const hooks = hook === null ? COMMAND_TRIGGER_HOOKS : [hook];
  if (hook === null) {
    for (const key of Object.keys(raw)) {
      if (!(COMMAND_TRIGGER_HOOKS as readonly string[]).includes(key)) {
        errors.push({
          code: 'on_unknown_hook',
          message: `unknown trigger hook "${key}". The three hooks are: ${COMMAND_TRIGGER_HOOKS.join(', ')}.`,
        });
      }
    }
  }

  // §9.2: both layers would settle the same choice; refuse the ambiguity rather
  // than pick a winner. Checked only where the conflict is in scope — asking
  // about `roll_resolved` must not fail because of a `choice_selected` clash.
  if (
    (hook === null || hook === 'choice_selected') &&
    isDeclared(raw['choice_selected']) &&
    isDeclared(frontmatter['choice_actions'])
  ) {
    errors.push({
      code: 'choice_actions_conflict',
      message:
        'This entity declares both "choice_actions" and "on.choice_selected". Pick one: they resolve in different layers and would double-settle. See docs/command/02 §9.2.',
    });
  }

  let bindings: OnBinding[] | null = null;
  for (const group_hook of hooks) {
    const group = raw[group_hook];
    if (group === undefined || group === null) continue;
    if (!Array.isArray(group)) {
      errors.push({
        code: 'on_not_a_list',
        message: `"on.${group_hook}" must be a list of bindings, even when there is only one.`,
      });
      continue;
    }
    if (group.length > MAX_BINDINGS_PER_HOOK) {
      errors.push({
        code: 'on_too_many_bindings',
        message: `"on.${group_hook}" declares ${group.length} bindings; the limit is ${MAX_BINDINGS_PER_HOOK}.`,
      });
    }
    const parsed: OnBinding[] = [];
    for (let i = 0; i < group.length; i++) {
      const entry: unknown = group[i];
      if (!isPlainObject(entry)) {
        errors.push({
          code: 'on_not_a_list',
          bindingIndex: i,
          message: `Binding ${i} of "on.${group_hook}" must be a mapping of when / from / run / with / on_error, got ${typeName(entry)}.`,
        });
        continue;
      }
      const one = parseOneBinding(entry, group_hook, i, frontmatter, errors);
      if (one !== null) parsed.push(one);
    }
    if (hook !== null) bindings = parsed;
  }

  return { bindings: errors.length > 0 ? null : bindings, errors };
}

/**
 * §2.4 — one `<binding>`. Returns `null` when the binding is unusable; the
 * reason is appended to `errors` (never thrown: `07` needs the whole list).
 *
 * §R.19's index rule lands here: binding `i` takes entry `i` of the array named
 * by `from`, so a short array is an error, never a silent reuse of the last
 * entry (T13's反面断言).
 */
function parseOneBinding(
  raw: Record<string, unknown>,
  hook: CommandTriggerHook,
  index: number,
  frontmatter: Record<string, any>,
  errors: OnBindingError[]
): OnBinding | null {
  const run = raw['run'];
  if (typeof run !== 'string' || run.trim().length === 0) {
    errors.push({
      code: 'on_missing_run',
      bindingIndex: index,
      message: `Binding ${index} of "on.${hook}" has no "run": a binding must name the world command it runs.`,
    });
    return null;
  }
  if (!COMMAND_ID_RE.test(run)) {
    errors.push({
      code: 'on_bad_command_id',
      bindingIndex: index,
      message: `"${run}" is not a valid command id (lowercase letters, digits and hyphens, must not start with a hyphen).`,
    });
    return null;
  }

  const refs: string[] = [];

  let when: string | undefined;
  if ('when' in raw) {
    const value = raw['when'];
    if (isUnquotedTemplate(value)) {
      errors.push({ code: 'on_unquoted_template', bindingIndex: index, message: UNQUOTED_TEMPLATE_MESSAGE });
      return null;
    }
    if (typeof value !== 'string') {
      errors.push({
        code: 'on_bad_when',
        bindingIndex: index,
        message: `Binding ${index} of "on.${hook}": "when" must be a string expression, got ${typeName(value)}.`,
      });
      return null;
    }
    if (value.length > MAX_COMMAND_WHEN_LENGTH) {
      errors.push({
        code: 'on_bad_when',
        bindingIndex: index,
        message: `Binding ${index} of "on.${hook}": "when" is ${value.length} characters; the limit is ${MAX_COMMAND_WHEN_LENGTH}.`,
      });
      return null;
    }
    when = value;
    refs.push(...scanWhenRefs(value));
  }

  // `from` must name an existing, non-empty array long enough for THIS binding's
  // index (§2.4's five checks 1-4). A `from` that is not a usable key string
  // cannot name anything, so it reports "missing key" — the repair is identical.
  let from: string | undefined;
  if ('from' in raw) {
    const value = raw['from'];
    if (typeof value !== 'string' || value.length === 0 || value.length > MAX_FROM_LENGTH) {
      errors.push({
        code: 'on_from_missing_key',
        bindingIndex: index,
        message: `Binding ${index} of "on.${hook}": "from" must be the name of a list in this entity's frontmatter, got ${typeName(value)}.`,
      });
      return null;
    }
    const list: unknown = frontmatter[value];
    if (list === undefined) {
      errors.push({
        code: 'on_from_missing_key',
        bindingIndex: index,
        message: `Binding ${index} of "on.${hook}": "from" names "${value}", but this entity's frontmatter has no key "${value}".`,
      });
      return null;
    }
    if (!Array.isArray(list)) {
      errors.push({
        code: 'on_from_not_a_list',
        bindingIndex: index,
        message: `Binding ${index}: "from" names "${value}", which is ${typeName(list)}, not a list.`,
      });
      return null;
    }
    if (list.length === 0) {
      errors.push({
        code: 'on_from_empty_list',
        bindingIndex: index,
        message: `Binding ${index}: "from" names "${value}", which is an empty list; no entry can match.`,
      });
      return null;
    }
    if (list.length < index + 1) {
      errors.push({
        code: 'on_entry_unavailable',
        bindingIndex: index,
        message: `Binding ${index}: "from" names "${value}", which has ${list.length} entries; binding ${index} needs entry ${index}. "on.${hook}" and "${value}" must have the same length.`,
      });
      return null;
    }
    from = value;
  }

  const args: Record<string, unknown> = {};
  if ('with' in raw) {
    const value = raw['with'];
    if (isUnquotedTemplate(value)) {
      errors.push({ code: 'on_unquoted_template', bindingIndex: index, message: UNQUOTED_TEMPLATE_MESSAGE });
      return null;
    }
    if (!isPlainObject(value)) {
      errors.push({
        code: 'on_with_not_scalar',
        bindingIndex: index,
        message: `Binding ${index}: "with" must be a mapping of parameter names to values, got ${typeName(value)}.`,
      });
      return null;
    }
    for (const [name, arg] of Object.entries(value)) {
      if (RESERVED_ROOTS.includes(name)) {
        errors.push({
          code: 'on_reserved_param_name',
          bindingIndex: index,
          message: `Binding ${index}: "${name}" is a reserved root name (trigger / roll / choice / item / entry). Pick another name.`,
        });
        return null;
      }
      if (isUnquotedTemplate(arg)) {
        errors.push({ code: 'on_unquoted_template', bindingIndex: index, message: UNQUOTED_TEMPLATE_MESSAGE });
        return null;
      }
      if (typeof arg === 'string') {
        refs.push(...scanTemplates(arg));
      } else if (!isScalar(arg)) {
        errors.push({
          code: 'on_with_not_scalar',
          bindingIndex: index,
          message: `Binding ${index}: "with.${name}" must be a scalar, a "{{ … }}" template, or a static path that resolves to a list. Inline literal lists and mappings are not accepted — the shared rule belongs in command/<id>.yaml, the per-entity content belongs in this entity's own frontmatter.`,
        });
        return null;
      }
      args[name] = arg;
    }
  }

  // §R.24: `trigger.entry.*` exists iff this binding declares `from`. §R.20:
  // omitting `from` is legal, so this is the check that keeps it honest.
  for (const ref of new Set(refs)) {
    if ((ref === 'trigger.entry' || ref.startsWith('trigger.entry.')) && from === undefined) {
      errors.push({
        code: 'on_entry_not_bound',
        bindingIndex: index,
        message: `Binding ${index} references "trigger.entry" but declares no "from". Add \`from: <key>\` or stop referencing trigger.entry.`,
      });
      return null;
    }
    if (!isKnownReference(hook, ref)) {
      errors.push({
        code: 'on_with_unknown_var',
        bindingIndex: index,
        message: `Binding ${index}: "${ref}" is not available on hook "${hook}". Available: ${triggerVariables(hook).join(', ')}.`,
      });
      return null;
    }
    if (refSegments(ref) > MAX_REF_SEGMENTS) {
      errors.push({
        code: 'on_with_unknown_var',
        bindingIndex: index,
        message: `Binding ${index}: "${ref}" is deeper than ${MAX_REF_SEGMENTS} segments; no such value is available on hook "${hook}".`,
      });
      return null;
    }
  }

  // `on_error` is normalized to `stop` when absent (§2.4 default).
  const onError = raw['on_error'] === 'continue' ? 'continue' : 'stop';
  return { ...(when === undefined ? {} : { when }), run, ...(from === undefined ? {} : { from }), with: args, onError };
}

/* ── helpers ────────────────────────────────────────────────────────────── */

/** §2.4: `on.<hook>` holds at most 8 bindings, aligned with `MAX_STAGE_SLOTS`. */
const MAX_BINDINGS_PER_HOOK = 8;
/** §2.4: `from` names a frontmatter key of at most 64 characters. */
const MAX_FROM_LENGTH = 64;
/** §2.4: a `trigger.fm.*` / `trigger.entry.*` path is at most 6 segments. */
const MAX_REF_SEGMENTS = 6;

const UNQUOTED_TEMPLATE_MESSAGE =
  'a value starting with "{{" must be quoted in YAML — write "{{ roll.result }}", not {{ roll.result }}.';

/** Type name as §2.4's messages spell it (`got <type>`). */
function typeName(value: unknown): string {
  if (Array.isArray(value)) return 'a list';
  if (value === null) return 'null';
  if (typeof value === 'object') return 'a mapping';
  return `a ${typeof value}`;
}

/** A YAML mapping (not an array, not `null`). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** §2.4: a `with` value is a scalar, or a `{{ … }}` template string. */
function isScalar(value: unknown): value is string | number | boolean | null {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

/**
 * Detects the unquoted-`{{` YAML trap. `a: {{ roll.result }}` parses as a
 * one-key mapping `{"{ roll.result }": null}` rather than a string, so by the
 * time we see a JS value the damage is already done — that exact shape is the
 * signature, and §2.4 gives this case its own code (`on_unquoted_template`).
 */
function isUnquotedTemplate(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  return keys.length === 1 && keys[0].startsWith('{');
}

/** True iff the key is present and carries at least one member. */
function isDeclared(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  if (typeof value === 'string') return value.length > 0;
  return true;
}

/** Every `{{ path }}` in `text`. Built per call: a shared `/g` regex carries `lastIndex`. */
function scanTemplates(text: string): string[] {
  const refs: string[] = [];
  for (const match of text.matchAll(new RegExp(TEMPLATE_RE.source, 'g'))) refs.push(match[1]);
  return refs;
}

/**
 * Every dotted reference in a `when` expression.
 *
 * Quoted literals are stripped first (`choice.option_id == "refill"` must not be
 * scanned). Only DOTTED references are checked: bare identifiers can only be
 * validated against `03`'s keyword list, which this module must not duplicate.
 * A bare-variable typo (or a keyword) therefore passes here and fails closed in
 * the evaluator — see the module report.
 */
function scanWhenRefs(expr: string): string[] {
  const bare = expr.replace(/"[^"]*"|'[^']*'/g, ' ');
  return bare.match(/[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+/g) ?? [];
}

/** `trigger.fm.a.b[0]` / `trigger.entry.rewards` count from the root NAME, not `trigger`. */
function refSegments(ref: string): number {
  const path = ref.startsWith('trigger.fm.')
    ? ref.slice('trigger.fm.'.length)
    : ref.startsWith('trigger.entry.')
      ? ref.slice('trigger.entry.'.length)
      : ref;
  return (path.match(/\[\d+\]|[A-Za-z_][A-Za-z0-9_]*/g) ?? []).length;
}
