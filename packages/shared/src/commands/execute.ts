/**
 * World-command executor — the SINGLE definition site for the runtime code set
 * and the evaluation-period result projection (03 §9.5).
 *
 * This is the only file in `commands/` that performs I/O. Everything upstream
 * of it is pure: `condition.ts` parses and evaluates, `world-command.ts`
 * validates the file, `bindings.ts` resolves `on`. By the time control reaches
 * here the world has not been touched yet — stage A is read-only pre-flight,
 * and stage B runs effects one at a time, stopping at the first failure.
 *
 * Why pre-flight exists (03 §5.3): most real failures — a path already taken, a
 * missing item, a condition referencing something absent — are detectable
 * without writing. Checking them up front is not a transaction, but it removes
 * most of what a transaction would otherwise have been needed for.
 */

import type { ActionContext } from '../actions/types.js';
import type { ActionErrorCode } from '../actions/errors.js';
import type { WorldEvent } from '../schemas/events.js';
import type { ConditionEvalError, ConditionScope, Scalar } from './condition.js';
import { evaluateCondition, normalizeScalar } from './condition.js';
import type { InterpolatedValue } from './limits.js';
import type { WorldCommandSpec, WorldCommandStep } from './world-command.js';
import type { EffectInput, EffectOutcome, WorldCommandEffectName } from './effects.js';
import { runEffect } from './effects.js';
import type { CommandTriggerHook } from './bindings.js';
import {
  MAX_COMMAND_STEPS,
  WORLD_COMMAND_ARG_ARRAY_MAX,
  WORLD_COMMAND_EFFECT_BUDGET,
} from './limits.js';

// Re-exported so existing importers keep working; the constant itself lives in
// `limits.ts` with the rest of the caps (see the note there).
export { WORLD_COMMAND_EFFECT_BUDGET };

/* ────────────────────────────────────────────────────────────────────────────
 * 1. Runtime code set (03 §3.2 + §3.3 + §6 + §14.5)
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * The EVALUATION/RUNTIME code set owned by `03`.
 *
 * NOT `01`'s write-time set (`WorldCommandErrorCode`, 46 codes, rejected while
 * the model is still editing the file). The two MUST NOT import or merge:
 * "checkable while writing" and "only knowable while running" are the two edges
 * of §3.4's honesty table.
 */
export type WorldCommandRuntimeErrorCode =
  // §3.2 parse time (rejected at write time by 01)
  | 'condition_syntax'
  | 'unknown_ref_root'
  | 'unknown_ref_member'
  | 'unknown_param'
  | 'bare_ref_forbidden'
  | 'missing_subject'
  | 'invalid_has_path'
  | 'inverted_range'
  | 'hook_ref_mismatch'
  | 'non_ascii_machine_field'
  | 'non_scalar_ref'
  | 'nested_interpolation'
  | 'nested_arg_array'
  // §3.3 run time (aborts the whole command)
  | 'unresolved_ref'
  | 'type_mismatch'
  | 'io_failed'
  // §6 caps (rejected before execution; zero world change)
  | 'step_limit_exceeded'
  | 'effect_budget_exceeded'
  | 'condition_nodes_exceeded'
  | 'has_paths_exceeded'
  | 'arg_array_too_long'
  // §14 bindings and arguments
  | 'on_entry_unavailable'
  | 'entry_index_out_of_range'
  | 'arg_not_array'
  | 'arg_not_scalar';

/** Runtime-frozen mirror so the code set is machine-checkable, not prose-only. */
export const WORLD_COMMAND_RUNTIME_ERROR_CODES: readonly WorldCommandRuntimeErrorCode[] = [
  'condition_syntax', 'unknown_ref_root', 'unknown_ref_member', 'unknown_param',
  'bare_ref_forbidden', 'missing_subject', 'invalid_has_path', 'inverted_range',
  'hook_ref_mismatch', 'non_ascii_machine_field', 'non_scalar_ref',
  'nested_interpolation', 'nested_arg_array',
  'unresolved_ref', 'type_mismatch', 'io_failed',
  'step_limit_exceeded', 'effect_budget_exceeded', 'condition_nodes_exceeded',
  'has_paths_exceeded', 'arg_array_too_long',
  'on_entry_unavailable', 'entry_index_out_of_range',
  'arg_not_array', 'arg_not_scalar',
] as const;

/** Four verbs, shared verbatim with `05`'s `SettleReport`. There is no fifth. */
export type CommandEffectSettle = 'ran' | 'reused' | 'resumed' | 'failed';

/* ────────────────────────────────────────────────────────────────────────────
 * 2. Evaluation-period result projection (03 §9.5)
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * One executed effect — the minimal unit of a world-command receipt.
 *
 * "One effect" = one item AFTER `list-args` expansion (03 §14.4 stage A5). A
 * `list-args` array of 3 yields three outcomes; `fold-args` and scalar effects
 * yield one. NOT one `do[]` entry — `05`'s resume granularity depends on this
 * distinction.
 */
export interface CommandEffectOutcome {
  /** One of `04`'s closed effect names. `link` rides on `give` and never steps alone. */
  action: WorldCommandEffectName;
  /**
   * Flattened index across every expanded effect in this run, 0-based and
   * CONTIGUOUS. `05`'s resume cursor is `steps.length`, so a gap would resume
   * from the wrong place.
   */
  step: number;
  /**
   * Declaration site, e.g. `"do[0]#2"`. For tracing and error copy only —
   * MUST NOT be used as a cursor (three `list-args` items share one `at` but
   * have distinct `step`s).
   */
  at: string;
  settle: CommandEffectSettle;
  /** The world path this effect wrote; `null` for pure-canvas effects (`link`). */
  path: string | null;
  /**
   * Event seq this effect recorded. `null` when failed (nothing landed) and
   * when reused/replayed (this run produced no new event). A null seq does NOT
   * imply failure — read `settle` for the verdict.
   */
  seq: number | null;
  /**
   * The world event this effect appended, when it appended one.
   *
   * Carried alongside `seq` because `10`'s receipt renders each effect line
   * through `renderEvent`; a bare seq would force a second renderer. NOT
   * persisted: `05`'s `receiptOf` stores only the `evt-<seq>` string.
   */
  event?: WorldEvent;
  /** Present only when `settle === 'failed'`. */
  error?: { code: ActionErrorCode | WorldCommandRuntimeErrorCode; message: string };
  /**
   * Dry run only: the arguments this effect WOULD run with (`with`, resolved).
   * Lets a preview say "end → alone" instead of a bare "end". Never persisted.
   */
  args?: ResolvedArg;
}

/**
 * A command's evaluation-period result (`runWorldCommand`'s return).
 *
 * NOT `WorldCommandReceipt` (owned by `04`, and the element type of
 * `details.commands`). Different shapes, not a superset: `hook` / `entry` /
 * `key` are things only the evaluator can compute; `04` projects its own
 * receipt from this result.
 */
export interface CommandRunResult {
  /** Command id (= the `<id>` in `command/<id>.yaml`), also the event's `detail.command`. */
  command: string;
  hook: CommandTriggerHook;
  /** 0-based index of the matched `on.<hook>` entry. */
  entry: number;
  /** `05`'s idempotency key, 16 hex chars. */
  key: string;
  /** Overall verdict: any `failed` effect makes this `'failed'`. */
  settle: CommandEffectSettle;
  effects: CommandEffectOutcome[];
}

/* ────────────────────────────────────────────────────────────────────────────
 * 3. Argument binding (03 §14)
 * ──────────────────────────────────────────────────────────────────────────── */

/** Values a `{{ }}` slot can resolve to during effect-argument evaluation. */
export interface EffectArgScope {
  /**
   * `params.*` — the resolved `with:` values.
   *
   * `Scalar | Scalar[]`, not `Scalar`: `02` §2.4 class 3 lets a whole-array
   * reference through (`with: { rewards: "{{ trigger.entry.rewards }}" }`), and
   * `04`'s `list-args` consumer reads that array whole. A scalar-only type here
   * would make the executor's own contract narrower than the declaration it is
   * executing, so every caller would have to lie.
   */
  params: Readonly<Record<string, Scalar | Scalar[]>>;
  /**
   * The FULL names from `02` §2.5 — `trigger.path`, `trigger.hook`,
   * `trigger.entry.*`, `trigger.fm.*`, `roll.result`, `choice.text`, `item.path`,
   * `actor`, `actor_id`, `layer` — seeded by `02`, NOT bare keys.
   *
   * Full names because §2.5's table is a MIXED namespace (`trigger.`-prefixed
   * members plus bare roots like `roll.result`), and the author writes the name
   * they see in that table. Storing bare keys and prefixing at lookup time (the
   * earlier shape) resolved `trigger.path` but turned `roll.result` into the
   * unresolvable `trigger.roll.result` — so a published `roll.result` reference
   * silently rendered as an empty string.
   */
  trigger: Readonly<Record<string, InterpolatedValue>>;
  /** BARE `status.data` keys; resolved as `status.<key>` (`03` §3.1). */
  status?: Readonly<Record<string, Scalar>>;
}

/**
 * A `do[].args` value after template resolution.
 *
 * Arrays are `Scalar[]`, never `ResolvedArg[]`: `01`'s schema allows only
 * scalar arrays (a nested array is rejected as `nested_arg_array`), and
 * `list-args`/`fold-args` both consume a flat list. Nested maps stay recursive
 * because `04`'s effects take nested argument objects.
 */
export type ResolvedArg = Scalar | Scalar[] | { [key: string]: ResolvedArg };

/** One expanded unit of work: a `do` step plus the argument set it will run with. */
export interface ExpandedEffect {
  /** 0-based contiguous index (stage A5). */
  step: number;
  /** `"do[i]#j"` — three `list-args` items share this; their `step`s differ. */
  at: string;
  action: WorldCommandEffectName;
  stepIndex: number;
  resolved: ResolvedArg;
}

/* ────────────────────────────────────────────────────────────────────────────
 * 4. The executor
 * ──────────────────────────────────────────────────────────────────────────── */

/** Everything `runWorldCommand` needs beyond the spec itself. */
export interface RunWorldCommandOptions {
  hook: CommandTriggerHook;
  /** 0-based index of the matched `on.<hook>` entry (also the `trigger.entry` index). */
  entry: number;
  /** `05`'s idempotency key for this run. */
  key: string;
  /** Effect-argument scope; `trigger` is pre-seeded by `02`. */
  argScope: EffectArgScope;
  /** Values available to conditions: `params.*`, `trigger.*`, `status.*`, … */
  conditionValues: Readonly<Record<string, Scalar>>;
  /** Pre-resolved `has()` answers. The ONLY place I/O results enter evaluation. */
  conditionPaths?: ReadonlyMap<string, 'file' | 'dir' | 'missing'>;
  /**
   * Resume cursor: expanded effects with `step < fromStep` are neither run nor
   * receipted — they already landed in an earlier partial run (`05` §5.1 S5).
   * Steps are stable across runs because expansion is deterministic (a `when`
   * that is false consumes no step number, so no gap ever appears).
   */
  fromStep?: number;
  /**
   * Awaited after EVERY effect lands and before the next one starts, so `05`
   * can append a step receipt and persist it. This is what makes a crash
   * mid-run visible as `partial` instead of silently replaying settled effects
   * (`05` §5.4). `dryRun` never calls it, because a dry run writes nothing.
   */
  onEffectSettled?: (outcome: CommandEffectOutcome) => Promise<void>;
  /** When true, compute everything and write nothing (`05`'s dry run). */
  dryRun?: boolean;
}

/** A stage-A refusal: nothing was written and the world is untouched. */
export interface PreflightFailure {
  ok: false;
  error: { code: WorldCommandRuntimeErrorCode; message: string };
}

/** A completed run: `effects` is non-empty and its `step`s are contiguous. */
export interface RunSuccess {
  ok: true;
  result: CommandRunResult;
}

export type RunWorldCommandResult = RunSuccess | PreflightFailure;

/**
 * Execute one command against the world.
 *
 * Stage A (pre-flight, read-only) → stage B (sequential, stop-at-failure).
 * A stage-A refusal leaves the world byte-identical; a stage-B failure leaves
 * the settled prefix visible and stops, because a half-done causal chain that
 * stops is honest, while one that skips ahead is a lie to the player.
 */
export async function runWorldCommand(
  ctx: ActionContext,
  spec: WorldCommandSpec,
  options: RunWorldCommandOptions
): Promise<RunWorldCommandResult> {
  // ── Stage A1: bounds on the declaration itself.
  if (spec.steps.length > MAX_COMMAND_STEPS) {
    return fail(
      'step_limit_exceeded',
      `command "${spec.id}" declares ${spec.steps.length} steps; at most ${MAX_COMMAND_STEPS} are allowed.`
    );
  }

  // ── Stage A2/A3: keep the steps whose `when` holds, and expand their args.
  // Expansion happens HERE, while the world is still untouched, so the effect
  // count is known before anything is written (03 §14.4 MUST 1).
  const horizon = conditionHorizon(options);
  const expanded: ExpandedEffect[] = [];
  for (let i = 0; i < spec.steps.length; i += 1) {
    const step = spec.steps[i]!;
    const gate = stepGate(step, horizon);
    if (gate.kind === 'error') {
      return fail(gate.error.code, `command "${spec.id}" do[${i}]: ${gate.error.message}`);
    }
    // `when` false ⇒ the step is skipped, NOT failed (03 §5.3). A skipped step
    // contributes no effect and consumes no budget.
    if (gate.kind === 'skip') continue;
    const items = expandStep(step, i, options, expanded.length);
    if (typeof items === 'string') {
      return fail('arg_array_too_long', `command "${spec.id}" do[${i}]: ${items}`);
    }
    expanded.push(...items);
  }

  // ── Stage A6: the budget applies to EXPANDED effects.
  if (expanded.length > WORLD_COMMAND_EFFECT_BUDGET) {
    return fail(
      'effect_budget_exceeded',
      `command "${spec.id}" expands to ${expanded.length} effects; at most ${WORLD_COMMAND_EFFECT_BUDGET} are allowed.`
    );
  }

  // ── Stage B: sequential execution, stopping at the first failure.
  const effects: CommandEffectOutcome[] = [];
  const record = async (outcome: CommandEffectOutcome): Promise<void> => {
    effects.push(outcome);
    if (options.dryRun !== true) await options.onEffectSettled?.(outcome);
  };
  const fromStep = options.fromStep ?? 0;
  for (const item of expanded) {
    // Already settled by an earlier partial run: neither execute nor receipt.
    if (item.step < fromStep) continue;
    const input = toEffectInput(item);
    if (typeof input === 'string') {
      await record(failedOutcome(item, 'arg_not_scalar', input));
      break;
    }
    if (options.dryRun === true) {
      // A dry run reports what WOULD happen and records nothing, so `seq` is null.
      await record({ action: item.action, step: item.step, at: item.at, settle: 'ran', path: null, seq: null, args: item.resolved });
      continue;
    }
    let outcomes: EffectOutcome[];
    try {
      // The command id rides on the context for the duration of this effect, so
      // every event it appends carries `detail.command` (`04` §6.5) — the only
      // key that marks a change as command-produced, and the one `10` reads to
      // give the sentence its subject. Set per call rather than mutated: an
      // ambient field surviving a throw would mislabel a later real action.
      outcomes = await runEffect({ ...ctx, commandId: spec.id, commandDepth: (ctx.commandDepth ?? 0) + 1 }, input);
    } catch (err) {
      await record(failedOutcome(item, 'io_failed', errorText(err)));
      break;
    }
    const first = outcomes[0];
    if (first === undefined) {
      await record(failedOutcome(item, 'io_failed', `effect "${item.action}" produced no outcome`));
      break;
    }
    if (!first.ok) {
      await record({
        action: item.action,
        step: item.step,
        at: item.at,
        settle: 'failed',
        path: first.path,
        seq: null,
        error: {
          code: first.code ?? ('io_failed' as ActionErrorCode),
          message: first.reason ?? 'the effect failed',
        },
      });
      break;
    }
    await record({
      action: item.action,
      step: item.step,
      at: item.at,
      settle: 'ran',
      path: first.path,
      seq: seqOf(first.event),
      // The event OBJECT is kept alongside its seq: `10`'s receipt renders each
      // effect line through `renderEvent`, and a bare seq would force a second
      // renderer beside it (`contract §8` anti-pattern 5). `05` persists only
      // `seq` (via `receiptOf`), so the log stays small.
      ...(first.event === undefined ? {} : { event: first.event }),
    });
  }

  const settle: CommandEffectSettle = effects.some((e) => e.settle === 'failed') ? 'failed' : 'ran';
  return {
    ok: true,
    result: { command: spec.id, hook: options.hook, entry: options.entry, key: options.key, settle, effects },
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * 5. Internals
 * ──────────────────────────────────────────────────────────────────────────── */

function fail(code: WorldCommandRuntimeErrorCode, message: string): PreflightFailure {
  return { ok: false, error: { code, message } };
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function seqOf(event: WorldEvent | undefined): number | null {
  if (event === undefined) return null;
  const seq = (event as { seq?: unknown }).seq;
  return typeof seq === 'number' ? seq : null;
}

function failedOutcome(
  item: ExpandedEffect,
  code: WorldCommandRuntimeErrorCode,
  message: string
): CommandEffectOutcome {
  return {
    action: item.action,
    step: item.step,
    at: item.at,
    settle: 'failed',
    path: null,
    seq: null,
    error: { code, message },
  };
}

/** Build the (pure) scope conditions are evaluated against. */
function conditionHorizon(options: RunWorldCommandOptions): ConditionScope {
  const values = new Map<string, Scalar>();
  for (const [k, v] of Object.entries(options.conditionValues)) values.set(k, v);
  return { values, paths: options.conditionPaths ?? new Map() };
}

/** The verdict on a step's `when`: run it, skip it, or refuse the whole command. */
type StepGate = { kind: 'run' } | { kind: 'skip' } | { kind: 'error'; error: ConditionEvalError };

/**
 * Evaluate a step's `when`.
 *
 * A condition that is merely FALSE skips the step — "this part does not apply
 * here" is a normal world state. Only an ERROR (an unresolvable reference, a
 * type mismatch, a failed `has()` stat) refuses the command, because silently
 * treating an authoring mistake as "false" is exactly the silent failure
 * hard gate 4 forbids (03 §3.4).
 */
function stepGate(step: WorldCommandStep, scope: ConditionScope): StepGate {
  if (step.when === undefined) return { kind: 'run' };
  const ast = step.whenAst;
  if (ast === undefined) {
    // `01` compiled and validated the syntax at write time. Reaching here
    // without an AST means the caller skipped validation, so refuse rather than
    // execute a condition nobody checked.
    // A missing AST is the CALLER's contract violation, not a world-state
    // condition error — surface it as `io_failed`, the only code in
    // `ConditionEvalErrorCode` that means "the evaluation could not proceed".
    return {
      kind: 'error',
      error: { code: 'io_failed', message: `"${step.when}" was not compiled before execution.` },
    };
  }
  const r = evaluateCondition(ast, scope);
  if (!r.ok) return { kind: 'error', error: r.error };
  return r.value ? { kind: 'run' } : { kind: 'skip' };
}

/**
 * Resolve a step's arguments and expand array arguments into concrete effects.
 *
 * `fold-args` stays a single write: its consumer (`04`'s effect table) decides
 * iteration vs folding, so the evaluator only supplies the array value
 * (03 §14.2 contract 1).
 */
function expandStep(
  step: WorldCommandStep,
  stepIndex: number,
  options: RunWorldCommandOptions,
  baseStep: number
): ExpandedEffect[] | string {
  if (step.action === 'link') {
    // `link` rides on `give`; it never becomes a step of its own (04 §2.3).
    return [];
  }
  const resolved = resolveArgs(step.args, options.argScope);
  if (!resolved.ok) return resolved.error;
  const arrays = findArrayArgs(resolved.value);
  for (const arr of arrays) {
    if (arr.length > WORLD_COMMAND_ARG_ARRAY_MAX) {
      return `an array argument has ${arr.length} items; at most ${WORLD_COMMAND_ARG_ARRAY_MAX} are allowed.`;
    }
  }
  const count = arrays.length === 0 ? 1 : arrays.reduce((n, a) => n * a.length, 1);
  const out: ExpandedEffect[] = [];
  for (let j = 0; j < count; j += 1) {
    out.push({
      step: baseStep + j,
      at: `do[${stepIndex}]#${j}`,
      action: step.action as WorldCommandEffectName,
      stepIndex,
      resolved: resolved.value,
    });
  }
  return out;
}

/** Argument resolution result. A separate channel keeps a LITERAL string that
 *  happens to look like an error message from being mistaken for one. */
type ArgResult = { ok: true; value: ResolvedArg } | { ok: false; error: string };

/** Resolve every `{{ }}` in an argument tree. */
function resolveArgs(args: Readonly<Record<string, unknown>>, scope: EffectArgScope): ArgResult {
  return walkArgs(args, argVariables(scope));
}

function walkArgs(node: unknown, vars: ReadonlyMap<string, InterpolatedValue>): ArgResult {
  if (typeof node === 'string') {
    if (!node.includes('{{')) return { ok: true, value: node };
    return substitute(node, vars);
  }
  if (Array.isArray(node)) {
    const out: Scalar[] = [];
    for (const item of node) {
      const v = walkArgs(item, vars);
      if (!v.ok) return v;
      if (Array.isArray(v.value)) {
        // `01` rejects nested arrays as `nested_arg_array`; refuse here too so a
        // hand-built spec cannot smuggle one past the write-time gate.
        return { ok: false, error: 'a nested array argument is not allowed.' };
      }
      out.push(v.value as Scalar);
    }
    return { ok: true, value: out };
  }
  if (node !== null && typeof node === 'object') {
    const out: { [key: string]: ResolvedArg } = {};
    for (const [k, v] of Object.entries(node)) {
      const w = walkArgs(v, vars);
      if (!w.ok) return w;
      out[k] = w.value;
    }
    return { ok: true, value: out };
  }
  return { ok: true, value: normalizeScalar(node) };
}
/** Flatten the typed scope into the flat map `{{ }}` substitution reads. */
function argVariables(scope: EffectArgScope): ReadonlyMap<string, InterpolatedValue> {
  const vars = new Map<string, InterpolatedValue>();
  // `trigger` first: it holds §2.5's full names (`trigger.path`, `roll.result`,
  // `actor`), which the author writes literally (see the field's doc comment).
  for (const [k, v] of Object.entries(scope.trigger)) vars.set(k, v);
  for (const [k, v] of Object.entries(scope.status ?? {})) vars.set(`status.${k}`, v);
  for (const [k, v] of Object.entries(scope.params)) {
    vars.set(`params.${k}`, v);
    // `{{ grade }}` is the documented shorthand for `{{ params.grade }}`
    // (`01` §2.8: "两种写法等价"), and the write-time checker accepts both — so
    // the evaluator must resolve both too. Registering only the prefixed form
    // made every shorthand fail at RUN time with `"grade" is not a readable
    // reference here`, the worst split: accepted on write, broken on trigger.
    //
    // Safe against collisions because `01` rejects a parameter whose name equals
    // a reserved root (`reserved_param_name`), and a name already claimed by
    // `trigger`/`status` is left alone rather than shadowed.
    if (!vars.has(k)) vars.set(k, v);
  }
  return vars;
}

/**
 * Substitute `{{ path }}` occurrences in one string.
 *
 * A whole-string template returns the referenced VALUE (so arrays survive into
 * `list-args`/`fold-args`); a template embedded in surrounding text returns the
 * scalar's string form. Order is preserved: arrays are never converted to a Set
 * or an object, which would lose ordering and change `fold-args` key order
 * (03 §14.2 contract 3).
 */
function substitute(raw: string, vars: ReadonlyMap<string, InterpolatedValue>): ArgResult {
  const whole = /^\s*\{\{\s*([^}]*?)\s*\}\}\s*$/.exec(raw);
  if (whole !== null) {
    const key = whole[1]!;
    if (!vars.has(key)) return { ok: false, error: `"${key}" is not a readable reference here.` };
    return { ok: true, value: vars.get(key)! };
  }
  const value = raw.replace(/\{\{\s*([^}]*?)\s*\}\}/g, (_m, key: string) => {
    if (!vars.has(key)) return '';
    const v = vars.get(key)!;
    return Array.isArray(v) ? v.join(', ') : v === null ? '' : String(v);
  });
  return { ok: true, value };
}

/** Collect every array nested in a resolved argument tree, order preserved. */
function findArrayArgs(node: ResolvedArg): Scalar[][] {
  const out: Scalar[][] = [];
  walkArrays(node, out);
  return out;
}

function walkArrays(node: ResolvedArg, out: Scalar[][]): void {
  if (Array.isArray(node)) {
    out.push(node as Scalar[]);
    for (const item of node) walkArrays(item as ResolvedArg, out);
    return;
  }
  if (node !== null && typeof node === 'object') {
    for (const v of Object.values(node)) walkArrays(v as ResolvedArg, out);
  }
}

/** Project a resolved effect into `04`'s input shape. Returns an error string if malformed. */
function toEffectInput(item: ExpandedEffect): EffectInput | string {
  const args = item.resolved;
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    return `effect "${item.action}" needs an argument mapping`;
  }
  return { action: item.action, ...(args as Record<string, unknown>) } as EffectInput;
}
