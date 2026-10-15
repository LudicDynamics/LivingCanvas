/**
 * The trigger shell — `the design notes` §3, steps 1 … 12.
 *
 * One entity, one hook, ALL its bindings. This is the orchestrator; `run.ts`
 * settles exactly ONE binding (contract §11.3 C10). Call direction: `trigger →
 * run`, once per binding.
 *
 * Function-level contract: **NEVER THROWS** (§3 step 12). The trigger point sits
 * AFTER `appendEvent`: the dice are already rolled, the result is already in the
 * file and the event is already recorded. A thrown error would turn a successful
 * action into an HTTP failure the player cannot retry — the re-roll gate refuses
 * a second click, so the player would get neither the result nor a retry (hard
 * gate 7). Every escaping exception therefore degrades to `status: 'error',
 * code: 'internal'` on the receipt, and the action stays successful.
 *
 * Dependency direction (contract §2): this module may import `bindings` /
 * `condition` / `limits` / `idempotency` / `execute` / `run` / `world-command`
 * and the schema helpers. It MUST NOT own any of those mechanisms.
 */

import type { ActionContext } from '../actions/types.js';
import { parseFrontmatter } from '../schemas/frontmatter.js';
import type { ParsedFrontmatter } from '../schemas/frontmatter.js';
import { parseOnBindings, triggerVariables } from './bindings.js';
import type {
  CommandOutcome,
  CommandOutcomeCode,
  CommandTriggerHook,
  CommandTriggerMode,
  OnBinding,
} from './bindings.js';
import { collectHasPaths, evaluateCondition, parseCommandWhen } from './condition.js';
import type { ConditionAst, ConditionScope, Scalar } from './condition.js';
import { readCommandLog, writeCommandLog } from './idempotency.js';
import type { CommandError } from './idempotency.js';
import { evaluateInterpolation, TEMPLATE_RE } from './limits.js';
import type { InterpolatedValue } from './limits.js';
import type { CommandEffectOutcome } from './execute.js';
import { previewWorldCommand, settleWorldCommands } from './run.js';
import { parseWorldCommand } from './world-command.js';
import type { WorldCommandSpec } from './world-command.js';

/* ────────────────────────────────────────────────────────────────────────────
 * `fact` — the trigger-level world fact (`02` §3 step 7b, `05` §3.3)
 * ──────────────────────────────────────────────────────────────────────────── */

export interface RunTriggeredCommandsArgs {
  /** The entity carrying `on` == the subject of the event that triggered it. */
  source: string;
  hook: CommandTriggerHook;
  mode: CommandTriggerMode;
  /** `fresh` facts, computed by the action (`02` §2.5 / §11.3). */
  facts: Readonly<Record<string, string | number | boolean | null>>;
  /** The caller's already-parsed frontmatter (step 3 — never re-read here). */
  parsed: ParsedFrontmatter;
  /**
   * Dry run: every binding is judged
   * exactly as a real trigger would judge it, but step 7b asks
   * `previewWorldCommand` instead of settling, and no refusal is written back.
   * The world is untouched; the outcomes say what a real press would do now.
   */
  dryRun?: boolean;
}

/**
 * The keys that make up the idempotency `fact`, per hook (`02:517`). The trigger
 * layer owns this because it is the only layer that knows what just happened.
 *
 * `item.sha256` is deliberately NOT part of `02` §2.5's variable table: it is a
 * fact component, not a variable an author may read, so the caller supplies it
 * in `facts` while `trigger` (`run.ts`'s key set) stays exactly §2.5.
 *
 * Static literal table → `Record`, per the repo's `ts-set-map` rule.
 */
const FACT_KEYS: Record<CommandTriggerHook, readonly string[]> = {
  roll_resolved: ['roll.result'],
  choice_selected: ['choice.index', 'choice.option'],
  use_item_on: ['item.path', 'item.sha256'],
};

/* ────────────────────────────────────────────────────────────────────────────
 * The shell
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Run every world command bound to `source` under `hook`.
 *
 * Returns `undefined` when this entity declares no `on` / no `on[hook]`, or when
 * the call is re-entrant (§3 step 2). `undefined` — never `[]` — so a skipped
 * re-entry cannot masquerade as "had bindings, ran none": re-entry visibility is
 * the inner layer's job (`03` marks the effect).
 */
export async function runTriggeredCommands(
  ctx: ActionContext,
  args: RunTriggeredCommandsArgs
): Promise<CommandOutcome[] | undefined> {
  const { source, hook, mode, facts, parsed } = args;
  // `parseFrontmatter` yields `null` for a missing/broken block; there is no
  // `on` to read then, so the shell short-circuits at step 3 below.
  const frontmatter: Record<string, any> = parsed.frontmatter ?? {};

  // Tracked outside the try so the catch-all can report where it broke.
  const outcomes: CommandOutcome[] = [];
  let current: { command: string; index: number } = { command: '', index: 0 };

  try {
    // ── Step 2 — re-entry gate, BEFORE any frontmatter work.
    // Depth 1 (not N) is the whole mechanism; the single +1 is written by `03`'s
    // executor. A command's effects MUST NOT trigger further commands.
    if ((ctx.commandDepth ?? 0) > 0) return undefined;

    // ── Step 3 — take `on` from the caller's snapshot, never re-read the file.
    // This is also why a command that rewrites its own entity cannot change the
    // bindings of the run that rewrote it (§4.3).
    const rawOn = frontmatter['on'];
    if (rawOn === undefined || rawOn === null) return undefined;
    if (typeof rawOn !== 'object' || Array.isArray(rawOn)) return undefined;
    if ((rawOn as Record<string, unknown>)[hook] == null) return undefined;

    // ── Step 4 — parse the bindings (pure, no I/O). Fail-closed: one receipt,
    // and no binding of this hook runs. The write gate should have stopped this
    // already; this is the second line of defence against silent `on` damage.
    const parsedOn = parseOnBindings(frontmatter, hook);
    if (parsedOn.errors.length > 0) {
      const first = parsedOn.errors[0]!;
      const code: CommandOutcomeCode =
        first.code === 'choice_actions_conflict' ? 'choice_actions_conflict' : 'on_malformed';
      return [
        {
          command: '',
          hook,
          source,
          binding: first.bindingIndex ?? 0,
          status: 'error',
          code,
          message: parsedOn.errors.map((e) => e.message).join(' '),
        },
      ];
    }
    const bindings = parsedOn.bindings ?? [];

    // §3 step 7b MUST 1: the fact is trigger-level and computed ONCE, outside the
    // binding loop; the key derived from it MUST NOT depend on `with`.
    //
    // A living world adds WHEN to the fact:
    // fishing today and fishing tomorrow are two facts, a double click in the
    // same minute is still one. Appended only when the action supplies it, so
    // every other world's keys — and every command_log already written — are
    // byte-identical to before.
    const at = facts['living.minute'];
    const fact = [
      ...FACT_KEYS[hook].map((key) => `${key}=${String(facts[key] ?? '')}`),
      ...(at !== undefined && at !== null ? [`living.minute=${String(at)}`] : []),
    ].join('|');

    // ── Steps 5 … 9 — declaration order IS execution order (`02` §2.3).
    let shortCircuited = false;
    for (let index = 0; index < bindings.length; index += 1) {
      const binding = bindings[index]!;
      current = { command: binding.run, index };

      // Step 9 — an earlier `on_error: stop` failure short-circuits the rest.
      // Short-circuited entries still appear in `commands[]` (§3 step 9): a
      // silent skip would be the same lie in a different place.
      if (shortCircuited) {
        outcomes.push({
          command: binding.run,
          hook,
          source,
          binding: index,
          status: 'skipped',
          skipped: 'short_circuit',
          message: `Binding ${index}: not run because an earlier binding failed and its on_error is "stop".`,
        });
        continue;
      }

      // ── Step 5 — `when`: grammar first (fail-closed, its own code), then value.
      // This is the ONLY grammar check an entity-side `when` gets at trigger time:
      // `bindings.ts` may not import `condition.js` (dependency direction), and
      // nothing validates it when the entity is written.
      let conditionAst: ConditionAst | null = null;
      if (binding.when !== undefined) {
        const syntax = parseCommandWhen(binding.when);
        if (!syntax.ok) {
          outcomes.push(
            bindingError(binding, hook, source, index, 'when_malformed',
              `Binding ${index}: malformed when "${binding.when}"; skipped fail-closed. ${syntax.error}`)
          );
          if (binding.onError === 'stop') shortCircuited = true;
          continue;
        }
        conditionAst = syntax.value;
      }

      // The flat variable table (§2.5) — facts verbatim, plus the open families
      // this binding resolves against its own entity.
      const vars = new Map<string, InterpolatedValue>();
      for (const [key, value] of Object.entries(facts)) vars.set(key, value);
      vars.set('trigger.hook', hook);
      for (const ref of openRefsIn(binding)) {
        const resolved = resolveOpenRef(ref, frontmatter, binding, index);
        if (resolved !== undefined) vars.set(ref, resolved);
      }

      // Step 5b — any variable this `when` reads that is NOT on this path (the
      // `resume` arm: `roll.crit` / `fumble` / `forged` cannot be rebuilt) MUST
      // NOT be quietly treated as false. Reporting it as `facts_unavailable` is
      // the difference between "the reward was never granted" and a lie.
      const unavailable = unavailableRefs(conditionAst, vars);
      if (unavailable.length > 0) {
        outcomes.push(
          bindingError(binding, hook, source, index, 'facts_unavailable',
            `Binding ${index}: "${unavailable[0]}" was not captured when this action first ran, ` +
            `so it cannot be re-evaluated now. This binding did not resume.`)
        );
        if (binding.onError === 'stop') shortCircuited = true;
        continue;
      }

      if (conditionAst !== null) {
        const verdict = evaluateCondition(conditionAst, await buildScope(conditionAst, vars, ctx));
        if (!verdict.ok) {
          outcomes.push(
            bindingError(binding, hook, source, index, 'when_malformed',
              `Binding ${index}: "when" could not be evaluated: ${verdict.error.message}`)
          );
          if (binding.onError === 'stop') shortCircuited = true;
          continue;
        }
        if (!verdict.value) {
          // `when_false` is a NORMAL branch, not a failure — never trips on_error.
          outcomes.push({
            command: binding.run,
            hook,
            source,
            binding: index,
            status: 'skipped',
            skipped: 'when_false',
            message: `Binding ${index}: "when" evaluated false; not run.`,
          });
          continue;
        }
      }

      // ── Step 6 — read `command/<id>.yaml` and parse it (strict schema).
      const commandPath = `command/${binding.run}.yaml`;
      let rawCommand: string;
      try {
        rawCommand = await ctx.store.readFile(commandPath);
      } catch {
        outcomes.push(
          bindingError(binding, hook, source, index, 'command_not_found',
            `Binding ${index} of "on.${hook}" on "${source}" runs "${binding.run}", but ${commandPath} ` +
            `does not exist. The action itself succeeded.`)
        );
        if (binding.onError === 'stop') shortCircuited = true;
        continue;
      }
      const specResult = parseWorldCommand(binding.run, rawCommand);
      if (!specResult.ok) {
        outcomes.push(
          bindingError(binding, hook, source, index, 'command_malformed',
            `${commandPath} failed to parse: ${specResult.errors.map((e) => e.message).join(' ')}`)
        );
        if (binding.onError === 'stop') shortCircuited = true;
        continue;
      }
      const spec: WorldCommandSpec = specResult.command;

      // ── Step 7 — bind `with`. A failure echoes the ORIGINAL reference: a typo
      // silently resolving to "" would write an empty path — the world changed,
      // and wrongly, with the error surfacing far from its cause.
      const bound = bindWith(binding, spec, vars);
      if (!bound.ok) {
        outcomes.push(
          bindingError(binding, hook, source, index, 'param_invalid', `Binding ${index}: ${bound.message}`)
        );
        if (binding.onError === 'stop') shortCircuited = true;
        continue;
      }

      // ── Step 7b — settle THIS binding. `05` owns the mechanism (lock, log,
      // key, execution, resume, `command_error` on failure); this module owns its
      // position and the values it hands over.
      // `trigger`'s key set MUST equal `02` §2.5's table for this hook,
      // verbatim. `facts` may carry extras that are fact components rather than
      // author-readable variables (`item.sha256`), so the §2.5 name list is the
      // filter — using `vars` directly would let them leak into the evaluator's
      // namespace and break that checkable equality.
      const trigger: Record<string, Scalar | Scalar[]> = {};
      for (const name of triggerVariables(hook)) {
        if (name.endsWith('.*')) continue; // open families resolved per reference, below
        const value = vars.get(name);
        if (isScalar(value) || isScalarArray(value)) trigger[name] = value;
      }
      for (const [key, value] of vars) {
        if (key.startsWith('trigger.fm.') || key.startsWith('trigger.entry.')) {
          if (isScalar(value) || isScalarArray(value)) trigger[key] = value;
        }
      }
      const report = await (args.dryRun === true ? previewWorldCommand : settleWorldCommands)(ctx, {
        source,
        hook,
        fact,
        parsed,
        mode,
        index,
        // `with` may legitimately resolve to a scalar ARRAY (`02` §2.4 class 3:
        // `list-args` / `fold-args`). `SettleInput.args` types the values as
        // `Scalar`, one notch too narrow; `run.ts` spreads them straight into
        // `argScope.params`, so the array survives at runtime. Narrowed here
        // rather than silently dropping the array — reported as a typing gap.
        args: bound.args as Readonly<Record<string, Scalar>>,
        spec,
        trigger,
      });

      const outcome = outcomeFrom(report, binding, hook, source, index);
      outcomes.push(outcome);
      if (outcome.status === 'error' && binding.onError === 'stop') shortCircuited = true;
    }

    // ── Step 10 channel 2 — the player-visible trace. Only pre-settle refusals
    // are written here: a settle failure already has `05`'s precise record
    // (real step / action / pending), and re-writing it with a projection would
    // overwrite better data with worse.
    const refused = outcomes.find((o) => o.status === 'error' && o.settleReport === undefined);
    if (refused !== undefined && args.dryRun !== true) {
      // Best effort only: channel 1 (the returned `commands[]`, which the caller
      // puts in `details`) is already complete, so a failed write must not
      // destroy the report — and MUST NOT throw (§3 step 12).
      await writeTriggerError(ctx, source, hook, refused).catch(() => undefined);
    }

    return outcomes;
  } catch (err) {
    // ── Step 12 — NEVER THROWS. Any escape degrades to an `internal` receipt.
    outcomes.push({
      command: current.command,
      hook,
      source,
      binding: current.index,
      status: 'error',
      code: 'internal',
      message: `The world command "${current.command}" failed unexpectedly: ${(err as Error).message}. The action itself succeeded.`,
    });
    return outcomes;
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Receipts
 * ──────────────────────────────────────────────────────────────────────────── */

/** A receipt for a binding-level refusal — all three shapes are identical. */
function bindingError(
  binding: OnBinding,
  hook: CommandTriggerHook,
  source: string,
  index: number,
  code: CommandOutcomeCode,
  message: string
): CommandOutcome {
  return { command: binding.run, hook, source, binding: index, status: 'error', code, message };
}

/**
 * Project `05`'s verdict onto the trigger layer's receipt (§3 step 7b's table,
 * §5.6's `resumed` ≠ `reused` split).
 *
 * `resumed` is reported `status: 'ok'`: the world IS complete afterwards, and
 * §5.6 forbids giving it the "this time nothing was given" tone. `reused` is
 * `skipped: already_done` — correct, and explicitly NOT a failure.
 */
function outcomeFrom(
  report: Awaited<ReturnType<typeof settleWorldCommands>>,
  binding: OnBinding,
  hook: CommandTriggerHook,
  source: string,
  index: number
): CommandOutcome {
  const base = { command: binding.run, hook, source, binding: index, settleReport: report };
  const ran = report.ran[0] ?? report.resumed[0];
  if (ran !== undefined) {
    return { ...base, status: 'ok', effects: [...ran.effects] as CommandEffectOutcome[] };
  }
  const reused = report.reused[0];
  if (reused !== undefined) {
    return {
      ...base,
      status: 'skipped',
      skipped: 'already_done',
      message: `Binding ${index} ('${binding.run}') already settled for this result; reused the recorded outcome.`,
    };
  }
  if (report.failed !== undefined) {
    return { ...base, status: 'error', code: 'effect_failed', message: report.failed.message };
  }
  // An all-empty report on the `resume` arm: nothing was outstanding, so there
  // is nothing to finish. `already_done` is the only honest reason available.
  return {
    ...base,
    status: 'skipped',
    skipped: 'already_done',
    message: `Binding ${index} ('${binding.run}'): nothing outstanding to resume.`,
  };
}

/**
 * `02` §3 step 10 channel 2: record a pre-settle refusal in the triggered
 * entity's `command_error`, so the player (through `06`) can see that this card
 * has automatic consequences that are not firing.
 *
 * `05` §2.2's record is effect-shaped (`step` / `action` / `pending`); a refusal
 * that never reached an effect has no honest values for those. The closest
 * truthful projection is written and the lossiness is reported, rather than
 * inventing a second record shape that `06` does not know.
 */
async function writeTriggerError(
  ctx: ActionContext,
  source: string,
  hook: CommandTriggerHook,
  refusal: CommandOutcome
): Promise<void> {
  const parsed = parseFrontmatter(await ctx.store.readFile(source));
  const entries = readCommandLog(parsed.frontmatter, source);
  const record: CommandError = {
    key: '',
    command: refusal.command,
    hook,
    // The refusal happened before any effect, so the cursor is step 0.
    step: 0,
    action: refusal.code ?? 'internal',
    code: 'internal',
    message: refusal.message ?? 'the world command could not run',
    // One outstanding unit: the binding itself never settled.
    pending: 1,
    at: (ctx.now ?? (() => new Date().toISOString()))(),
  };
  await writeCommandLog(ctx, source, entries, record);
}

/* ────────────────────────────────────────────────────────────────────────────
 * Variable resolution (`02` §2.5)
 * ──────────────────────────────────────────────────────────────────────────── */

function isScalar(value: unknown): value is Scalar {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function isScalarArray(value: unknown): value is Scalar[] {
  return Array.isArray(value) && value.every(isScalar);
}

/**
 * Every OPEN path this binding must resolve itself: `trigger.fm.*` (the entity's
 * own frontmatter) and `trigger.entry.*` (the array entry named by `from`).
 * Everything else in §2.5 comes from the caller's flat `facts`.
 */
function openRefsIn(binding: OnBinding): string[] {
  const refs = new Set<string>();
  for (const value of Object.values(binding.with)) {
    if (typeof value !== 'string' || !value.includes('{{')) continue;
    for (const match of value.matchAll(new RegExp(TEMPLATE_RE.source, 'g'))) {
      const ref = match[1]!;
      if (ref === 'trigger.fm' || ref.startsWith('trigger.fm.') ||
          ref === 'trigger.entry' || ref.startsWith('trigger.entry.')) {
        refs.add(ref);
      }
    }
  }
  return [...refs];
}

/**
 * Resolve `trigger.fm.<path>` against the entity's frontmatter, and
 * `trigger.entry.<path>` against `on.<hook>[index]`'s bound array entry
 * (`02` §R.19: one-to-one by index). `undefined` = not resolvable.
 */
function resolveOpenRef(
  ref: string,
  frontmatter: Record<string, any>,
  binding: OnBinding,
  index: number
): InterpolatedValue | undefined {
  if (ref === 'trigger.fm' || ref.startsWith('trigger.fm.')) {
    return readPath(frontmatter, ref === 'trigger.fm' ? '' : ref.slice('trigger.fm.'.length));
  }
  if (binding.from === undefined) return undefined;
  const list = frontmatter[binding.from];
  if (!Array.isArray(list)) return undefined;
  const entry: unknown = list[index];
  if (entry === undefined) return undefined;
  if (ref === 'trigger.entry') {
    return isScalar(entry) || isScalarArray(entry) ? entry : undefined;
  }
  return readPath(entry, ref.slice('trigger.entry.'.length));
}

/** Dotted / `[n]` walk over already-parsed values. `undefined` = missing segment. */
function readPath(root: unknown, path: string): InterpolatedValue | undefined {
  if (path === '') return isScalar(root) || isScalarArray(root) ? root : undefined;
  let cursor: unknown = root;
  for (const segment of path.match(/[A-Za-z_][A-Za-z0-9_]*|\[\d+\]/g) ?? []) {
    if (cursor === null || typeof cursor !== 'object') return undefined;
    cursor = segment.startsWith('[')
      ? (Array.isArray(cursor) ? cursor[Number(segment.slice(1, -1))] : undefined)
      : (cursor as Record<string, unknown>)[segment];
    if (cursor === undefined) return undefined;
  }
  return isScalar(cursor) || isScalarArray(cursor) ? cursor : undefined;
}

/**
 * The `when` references this binding cannot resolve on this path (§3 step 5b).
 *
 * Only paths that §2.5 DECLARES for this hook count: an unknown name is a
 * grammar/membership problem the write gate owns, not a `resume` fact gap.
 * `status.*` and `params.*` are absent by design — the trigger layer carries no
 * status map, and `when` on an `on` binding reads trigger context only.
 */
function unavailableRefs(
  ast: ConditionAst | null,
  vars: Map<string, InterpolatedValue>
): string[] {
  if (ast === null) return [];
  const missing: string[] = [];
  for (const path of referencedPaths(ast)) {
    if (vars.has(path)) continue;
    if ([...vars.keys()].some((key) => path.startsWith(`${key}.`) || path.startsWith(`${key}[`))) continue;
    missing.push(path);
  }
  return missing;
}

/**
 * Every dotted reference an AST reads.
 *
 * Two orthogonal walks are needed: `do`-style atoms carry references, and
 * `has()` predicates carry PATHS. Job order matches the two consumers — same
 * tree, two questions.
 */
function referencedPaths(ast: ConditionAst): string[] {
  const paths = new Set<string>();
  for (const group of ast.anyOf) {
    for (const atom of group) {
      if (atom.kind === 'compare') {
        for (const operand of [atom.left, atom.right]) {
          if ('kind' in operand && operand.kind === 'ref') paths.add(operand.path);
        }
      } else if (atom.kind === 'range' && atom.subject.kind === 'ref') {
        paths.add(atom.subject.path);
      } else if (atom.kind === 'predicate' && atom.fn !== 'has') {
        paths.add(atom.ref);
      }
    }
  }
  return [...paths];
}

/**
 * Build the evaluator's scope. Scalar values enter `values`; `has()` paths are
 * pre-resolved HERE with one `statKind` per path — the only place I/O enters the
 * evaluator (`condition.ts`), and a missing path is a normal answer, not an error.
 */
async function buildScope(
  ast: ConditionAst,
  vars: Map<string, InterpolatedValue>,
  ctx: ActionContext
): Promise<ConditionScope> {
  const values = new Map<string, Scalar>();
  for (const [key, value] of vars) if (isScalar(value)) values.set(key, value);
  const paths = new Map<string, 'file' | 'dir' | 'missing'>();
  for (const path of collectHasPaths(ast)) {
    const kind = await ctx.store.statKind(path);
    paths.set(path, kind === 'missing' ? 'missing' : kind);
  }
  return { values, paths };
}

/* ────────────────────────────────────────────────────────────────────────────
 * `with` binding (`02` §3 step 7)
 * ──────────────────────────────────────────────────────────────────────────── */

/** Bind a binding's `with` against the command's declared parameters. */
function bindWith(
  binding: OnBinding,
  spec: WorldCommandSpec,
  vars: Map<string, InterpolatedValue>
): { ok: true; args: Record<string, Scalar | Scalar[]> } | { ok: false; message: string } {
  const args: Record<string, Scalar | Scalar[]> = {};
  // Declared parameters first: absent ones take their default, and a required
  // one that is still missing is a `param_invalid`, never a silent null.
  for (const [name, param] of Object.entries(spec.params)) {
    if (name in binding.with) continue;
    if (param.default !== undefined) {
      args[name] = param.default;
      continue;
    }
    return { ok: false, message: `command "${spec.id}" requires parameter "${name}".` };
  }
  for (const [name, rawValue] of Object.entries(binding.with)) {
    const param = spec.params[name];
    if (param === undefined) {
      const known = Object.keys(spec.params);
      return {
        ok: false,
        message: `command "${spec.id}" has no parameter "${name}". Its parameters are: ${known.length === 0 ? '(none)' : known.join(', ')}.`,
      };
    }
    let value: InterpolatedValue | undefined = isScalar(rawValue) ? rawValue : undefined;
    if (typeof rawValue === 'string' && rawValue.includes('{{')) {
      const resolved = evaluateInterpolation(rawValue, vars);
      if (!resolved.ok) {
        // Echo the ORIGINAL reference — its path is the only repair clue (§3 step 7).
        return {
          ok: false,
          message: `"${name}" = ${JSON.stringify(rawValue)} is not valid for command "${spec.id}": ${resolved.error.message}`,
        };
      }
      value = resolved.value;
    }
    if (value === undefined) {
      return { ok: false, message: `"${name}" is not a scalar or a "{{ … }}" template.` };
    }
    if (Array.isArray(value)) {
      if (!isScalarArray(value)) {
        return { ok: false, message: `"${name}" must resolve to a list of scalars.` };
      }
      args[name] = value;
      continue;
    }
    if (!matchesParam(param, value)) {
      const expected = param.type === 'enum'
        ? `one of ${(param.values ?? []).join(', ')}`
        : `a ${param.type}`;
      return {
        ok: false,
        message: `"${name}" = ${JSON.stringify(value)} is not valid for command "${spec.id}": expected ${expected}.`,
      };
    }
    args[name] = value;
  }
  return { ok: true, args };
}

function matchesParam(
  param: WorldCommandSpec['params'][string],
  value: Scalar
): boolean {
  if (value === null) return false;
  if (param.type === 'string') return typeof value === 'string';
  if (param.type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (param.type === 'boolean') return typeof value === 'boolean';
  return typeof value === 'string' && (param.values ?? []).includes(value);
}
