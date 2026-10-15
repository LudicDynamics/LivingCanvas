/**
 * World-command settlement orchestration — `the design notes` §5.
 *
 * This module owns the idempotency gate AROUND execution: steps S0–S6. Execution
 * order itself belongs to `03` (`execute.ts`); this file decides WHETHER a
 * binding runs, resumes or is reused, and keeps the `command_log` receipt in
 * step with the world.
 *
 * NAMING (contract §11.3 C10, 2026-09-15). There are exactly two entry points
 * and this is the inner one:
 *
 *   - `settleWorldCommands` (here) settles ONE binding and returns `SettleReport`.
 *   - `runTriggeredCommands` (`./trigger.ts`, owned by `02`) drives EVERY binding
 *     of one source and calls this one per binding in its step 7b.
 *
 * The call direction is `trigger.ts → run.ts`. No third name exists.
 *
 * DRY RUN. `dry-run` MUST NOT write `command_log` (`05` §5.1, contract R.5): a
 * leftover receipt would make the real trigger match the key, verdict `reused`,
 * and the reward would never land — the REVERSE of hard gate 2 and harder to
 * notice, because the world stays self-consistent. Hence `05:454`: "dry-run
 * branches off BEFORE S0 and never enters any S4/S5 write path."
 *
 * That branch lives in the CALLER, deliberately, and there is no runtime switch
 * inside `settleWorldCommands`. What this file DOES guarantee is that a caller
 * who simply does not call `settleWorldCommands` writes nothing: every write
 * below is reachable only through S4/S5.
 *
 * The dry run itself is `previewWorldCommand` (the design notes
 * item 9): a SEPARATE entry that reads the log and the `has()` answers exactly
 * as S1/S2 do, then calls the executor with `dryRun: true`. It never takes the
 * lock, never writes `command_log`, never calls `onEffectSettled`.
 */
import type { ActionContext } from '../actions/types.js';
import type { ActionErrorCode } from '../actions/errors.js';
import { fail } from '../actions/errors.js';
import type { ParsedFrontmatter } from '../schemas/frontmatter.js';
import { parseFrontmatter } from '../schemas/frontmatter.js';
import type { Scalar } from './condition.js';
import { collectHasPaths } from './condition.js';
import type { CommandTriggerHook } from './bindings.js';
import type { WorldCommandSpec } from './world-command.js';
import { canonicalCommandStepText } from './world-command.js';
import type { CommandEffectOutcome, EffectArgScope } from './execute.js';
import type { InterpolatedValue } from './limits.js';
import type { WorldEvent } from '../schemas/events.js';
import { runWorldCommand } from './execute.js';
import type { CommandError, CommandLogEntry } from './idempotency.js';
import {
  CommandLogEntrySchema,
  commandKey,
  planDigest,
  readCommandLog,
  upsertLogEntry,
  writeCommandLog,
} from './idempotency.js';
import { withSourceLock } from './serial.js';
import { evaluateInterpolation } from './limits.js';

/* ────────────────────────────────────────────────────────────────────────────
 * 1. The public shape (`05` §5, as frozen 2026-09-15)
 * ──────────────────────────────────────────────────────────────────────────── */

/** `fresh` starts new work; `resume` may only FINISH work already begun. */
export type SettleMode = 'fresh' | 'resume';

export interface SettleInput {
  /** World-relative path of the triggered entity. */
  source: string;
  hook: CommandTriggerHook;
  /** The settled fact for this run (`05` §3.3, computed by the trigger). */
  fact: string;
  /** Already-parsed source frontmatter — avoids a second read. */
  parsed: ParsedFrontmatter;
  mode: SettleMode;
  /**
   * 0-based index inside `on.<hook>`. Written as `command_log[].index` and read
   * back by S5's drift check. It is NOT carried on `trigger`: contract R.19
   * removed `trigger.entry.index` from the author namespace, and the two
   * channels must stay separate — one is a variable an author may read, this is
   * an internal accounting cursor.
   */
  index: number;
  /**
   * The already-evaluated `with:` values. Re-evaluating `with:` here would copy
   * `02`'s variable table and its `param_invalid` semantics into a second place
   * — the drift source contract R.11 exists to prevent.
   *
   * `Scalar | Scalar[]` because `02` §2.4 class 3 (`list-args` / `fold-args`)
   * legitimately yields an array: `give`'s `rewards` and `consume`'s `from` are
   * whole-array arguments. Narrowing this to `Scalar` forced every call site to
   * cast and would have hidden a real shape at the type level.
   */
  args: Readonly<Record<string, Scalar | Scalar[]>>;
  /**
   * Parsed `command/<id>.yaml` (`01`). Two uses: it is what the executor runs,
   * and its declared steps are the only source of the `plan` provenance digest.
   * This module MUST NOT read `command/<id>.yaml` itself (`05` §5).
   */
  spec: WorldCommandSpec;
  /**
   * Flat trigger context for THIS binding; key set == `02` §2.5's table for the
   * hook, verbatim. REQUIRED, not optional: those variables exist for every
   * hook and every caller can compute them, so "no trigger" is a caller
   * contract violation rather than an honest outcome — and an optional field
   * would hide that violation until runtime instead of failing to compile.
   */
  trigger: Readonly<Record<string, Scalar | Scalar[]>>;
}

/**
 * One settled run — the body of the `ran` / `reused` / `resumed` verbs.
 *
 * `effects` travels with every one of them, including `reused`: `02`'s
 * `CommandOutcome.effects` consumes it directly, and without it "this was a
 * reuse, not a new settlement" would collapse to a bare verb in the model's
 * view with no way to see WHICH effects were reused.
 */
export interface SettleRunSummary {
  key: string;
  /** Command id, also the event's `detail.command`. */
  command: string;
  /** Settled FLAT effect count (= `effects.length`, `05` §5.7). */
  steps: number;
  effects: ReadonlyArray<CommandEffectOutcome>;
}

export interface SettleReport {
  /** Runs that actually executed effects this time (`settle: 'ran'`). */
  ran: ReadonlyArray<SettleRunSummary>;
  /** Runs that hit their key and were reused verbatim (`settle: 'reused'`). */
  reused: ReadonlyArray<SettleRunSummary>;
  /** Runs whose missing tail was completed (`settle: 'resumed'`). */
  resumed: ReadonlyArray<SettleRunSummary & { from: number; to: number }>;
  /** The one run that failed and was written to `command_error`, if any. */
  failed?: { key: string; command: string; step: number; code: ActionErrorCode; message: string };
}

/* ────────────────────────────────────────────────────────────────────────────
 * 2. Entry point — S0 … S6 (`05` §5.1)
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Settle ONE binding against the world.
 *
 * S0 takes the per-source lock, so a double click cannot put two requests into
 * S1 concurrently; both would read "no such key", both would run, and the
 * reward would land twice — hard gate 2 broken outright (`05` §6.1). The lock
 * is the only concurrency gate; nothing below reasons about it again.
 */
export async function settleWorldCommands(
  ctx: ActionContext,
  input: SettleInput
): Promise<SettleReport> {
  return withSourceLock(ctx.store, input.source, () => settleLocked(ctx, input));
}

async function settleLocked(ctx: ActionContext, input: SettleInput): Promise<SettleReport> {
  const at = (ctx.now ?? (() => new Date().toISOString()))();

  // ── S1: read the log. Fail-closed on shape (`05` §5.1): a corrupted entry
  // silently skipped by a `find` would read as "never ran" and be paid twice.
  //
  // `input.parsed` is a HINT, not the source of truth: `05` §5.4 says every
  // write must be preceded by a fresh read, so the run parses the file itself.
  // S5's drift check then reads the same snapshot every read below is checked
  // against. Carrying the caller's copy would be a second in-memory truth that
  // can be one effect out of date — the exact failure the re-read exists for.
  const parsed = parseFrontmatter(await ctx.store.readFile(input.source));
  const entries = readCommandLog(parsed.frontmatter, input.source);

  // ── S2: the key comes from the four frozen components. `with:` is NOT read
  // here — a key that needed it would mean the formula had been broken.
  //
  // One widening: when the command's steps ask `has()`, those answers are part
  // of the fact. "Accuse without the ledger" and "accuse with it" are two
  // different situations, and the second must run rather than replay the first
  // run's skip. Nothing changed → same key → still
  // idempotent. A command without `has()` keeps exactly its old key, so the
  // command logs already inside saves stay valid.
  const hasPaths = await hasPathsOf(ctx, input.spec);
  const key = commandKey({
    source: input.source,
    hook: input.hook,
    command: input.spec.id,
    fact: hasPaths.size === 0 ? input.fact : `${input.fact}|${hasFactOf(hasPaths)}`,
  });

  // ── S3: the three-way split.
  //
  //   | log entry for this key | fresh       | resume      |
  //   |------------------------|-------------|-------------|
  //   | absent                 | run (S4)    | inactive    |
  //   | `done`                 | reuse       | reuse       |
  //   | `partial`              | resume (S5) | resume (S5) |
  //
  // The `absent × resume` cell is the load-bearing one: a `resume` may only
  // FINISH work already begun. An author editing `with:` or an `on` branch
  // changes `fact`, hence `key`, so the entry looks absent — and starting it
  // would settle a run the player never asked for (`05` §5.1).
  const found = entries.find((e) => e.key === key);
  if (found !== undefined && found.status === 'done') {
    return { ran: [], reused: [summaryOf(found, 'reused')], resumed: [] };
  }
  const resuming = found !== undefined; // `partial` ⇒ S5; absent ⇒ S4 below.
  if (!resuming && input.mode === 'resume') {
    // resume mode, no record: do nothing at all.
    return { ran: [], reused: [], resumed: [] };
  }

  const entry = found ?? {
    key,
    command: input.spec.id,
    hook: input.hook,
    index: input.index,
    status: 'partial' as const,
    at,
    turn: ctx.turn,
    // Provenance only, NEVER a verdict: a run is not re-executed because the
    // rule changed (`05` §3.5). The digest covers the DECLARED steps, before
    // any `{{ }}` substitution, which is why it stays stable across triggers.
    plan: planDigest(input.spec.steps.map(canonicalCommandStepText).join('\n')),
    steps: [],
  };
  const done = resuming ? entry.steps.length : 0;

  if (resuming) {
    // S5's drift check runs BEFORE anything is written or executed: the plan we
    // are about to finish must still be the plan this entity declares.
    const on = parsed.frontmatter?.['on'];
    const list = on !== null && typeof on === 'object'
      ? (on as Record<string, unknown>)[input.hook]
      : undefined;
    const binding = Array.isArray(list) ? list[entry.index] : undefined;
    const run = binding !== null && typeof binding === 'object'
      ? (binding as Record<string, unknown>)['run']
      : undefined;
    if (typeof run === 'string' && run !== entry.command) {
      fail(
        'command_resume_drifted',
        `Cannot resume "${entry.command}" on "${input.source}": ` +
          `on.${input.hook}[${entry.index}] now declares "${run}". The binding moved after the ` +
          `run started; the engine will not finish one command's steps with another command's plan.`,
        { source: input.source, hook: input.hook, index: entry.index, key }
      );
    }
  }

  /**
   * Merge one entry into the log and persist it.
   *
   * Every write re-reads and re-parses the source first (`05` §5.4) — mandatory,
   * not defensive: an effect may have just written this very file (`edit`
   * writing `choice_actions` back to the source is a core use), and writing a
   * stale snapshot back would erase that effect's own result. There is no
   * concurrency inside the lock — only the run stepping on itself.
   *
   * `command_error` is a SINGLE record for the whole entity, so its lifecycle is
   * keyed, not blanket (§2.2): the delete point is "the write in which the run
   * with the SAME key reaches `done`". Clearing unconditionally would let command
   * B finishing erase command A's failure — and that record is A's only
   * player-visible pointer, the "N effects still outstanding" entry §6.3 tells
   * the player to come back and finish. A record for another key is carried
   * through untouched instead.
   */
  const persist = async (
    record: CommandLogEntry,
    outcome: { kind: 'keep' } | { kind: 'set'; error: CommandError } | { kind: 'clear' }
  ): Promise<void> => {
    const reread = parseFrontmatter(await ctx.store.readFile(input.source));
    const fresh = readCommandLog(reread.frontmatter, input.source);
    const existing = reread.frontmatter?.['command_error'] as CommandError | undefined;
    const ours = existing === undefined || existing.key === key;
    const error =
      outcome.kind === 'set'
        ? outcome.error
        : outcome.kind === 'clear' && ours
          ? null
          : existing ?? null;
    await writeCommandLog(ctx, input.source, upsertLogEntry(fresh, record), error);
  };

  // ── S4's first half: the `partial` intent, written BEFORE the first effect
  // runs. That ordering is what makes a crash mid-run visible as `partial`
  // instead of replaying effects that already landed (`05` §5.4, P3).
  if (!resuming) await persist(entry, { kind: 'keep' });

  const effects: CommandEffectOutcome[] = [];
  const execution = await runWorldCommand(ctx, input.spec, {
    hook: input.hook,
    entry: input.index,
    key,
    argScope: argScopeOf(input, parsed),
    conditionValues: conditionValuesOf(input, parsed),
    conditionPaths: hasPaths,
    fromStep: done,
    // Awaited after EVERY effect lands, before the next starts. Granularity is
    // the flat effect, not the `do[]` step: a `list-args` entry expands to N
    // effects and `entry.steps.length` counts those, so a coarser hook would
    // replay the ones already settled (`05` §5.1).
    //
    // Only EFFECTS THAT LANDED get a receipt. The executor also calls this for
    // the failed outcome, and receipting that one would push a step number into
    // `steps[]` that the world never saw: the resume cursor is `steps.length`,
    // so the next run would skip an effect that never happened (`05` §5.7). The
    // failure is recorded by S6 instead, via `command_error`.
    onEffectSettled: async (outcome) => {
      // A failed effect gets NO receipt: `steps.length` is the resume cursor, so
      // recording a step the world never saw would make the next run skip it.
      if (outcome.settle === 'failed') return;
      effects.push(outcome);
      await persist({ ...entry, steps: [...entry.steps, ...effects.map(receiptOf)] }, { kind: 'keep' });
    },
  });

  // ── A stage-A refusal: nothing ran and the world is byte-identical (`03`
  // §5.3). There is no settled prefix, so there is nothing to receipt and
  // nothing to resume; surface it rather than inventing a record.
  if (!execution.ok) {
    return {
      ran: [],
      reused: [],
      resumed: [],
      failed: {
        key,
        command: input.spec.id,
        step: 0,
        // `03`'s runtime codes are a DIFFERENT set from `ActionErrorCode` by
        // design (03 §3.2 vs contract §7.4); this projection is lossy and `02`
        // owns the mapping into `CommandOutcomeCode`. Reported as a gap.
        code: execution.error.code as unknown as ActionErrorCode,
        message: execution.error.message,
      },
    };
  }

  // ── An effect failed and execution stopped there. Keep the settled prefix
  // (the honest half-state, `03` §5.4) and make the failure visible on the
  // second channel the player reads (`05` §2.2), then report.
  const failure = execution.result.effects.find((e) => e.settle === 'failed');
  if (failure !== undefined) {
    await persist({ ...entry, status: 'partial', steps: [...entry.steps, ...effects.map(receiptOf)] }, {
      kind: 'set',
      error: {
        key,
        command: input.spec.id,
        hook: input.hook,
        step: failure.step,
        action: failure.action,
        code: (failure.error?.code ?? 'io_failed') as ActionErrorCode,
        message: failure.error?.message ?? 'the effect failed',
        // Remaining effects on the FLATTENED basis (§2.2): `declared - landed`.
        // `effects` holds only the ones that landed, so the failed effect is
        // still outstanding. The declared count is a LOWER BOUND there — a
        // `list-args` entry expands to more effects than `do[]` has entries and
        // a stopped run does not report the expansion total — so it is clamped
        // at 0 and reported as a known approximation.
        pending: Math.max(0, input.spec.steps.length - effects.length),
        at,
      },
    });
    return {
      ran: [],
      reused: [],
      resumed: [],
      failed: {
        key,
        command: input.spec.id,
        step: failure.step,
        code: (failure.error?.code ?? 'io_failed') as ActionErrorCode,
        message: failure.error?.message ?? 'the effect failed',
      },
    };
  }

  // ── S4's second half: flip to `done` and clear any earlier failure. That
  // single write is the documented delete point (`05` §2.2), and it also makes
  // a "failed, then resumed to success" run look exactly like a plain success.
  const finished = { ...entry, status: 'done' as const, steps: [...entry.steps, ...effects.map(receiptOf)] };
  await persist(finished, { kind: 'clear' });

  // A resumed run's effects were executed JUST NOW, so they carry `'ran'`; the
  // `resumed` verb plus `from`/`to` already says a prefix was carried over
  // (`05` §5.6 — and `resumed` MUST NOT be folded into `reused`, because
  // "finished what was left" and "did nothing new" are different sentences).
  const summary = summaryOf(finished, 'ran', done, effects);
  return resuming
    ? { ran: [], reused: [], resumed: [{ ...summary, from: done, to: effects.length }] }
    : { ran: [summary], reused: [], resumed: [] };
}

/* ────────────────────────────────────────────────────────────────────────────
 * 3. Receipts and summaries
 * ──────────────────────────────────────────────────────────────────────────── */

/** One step receipt. `event` is `null` when the effect recorded no event. */
function receiptOf(outcome: CommandEffectOutcome): {
  step: number;
  at: string;
  action: CommandLogEntry['steps'][number]['action'];
  event: string | null;
} {
  return {
    step: outcome.step,
    at: outcome.at,
    action: outcome.action,
    event: outcome.seq === null ? null : `evt-${outcome.seq}`,
  };
}

/**
 * The report entry built from a written log entry's receipts.
 *
 * `settle` is a PARAMETER, not a constant: the same receipts mean different
 * things depending on why we are reading them. On a `reused` hit the steps were
 * written by an EARLIER run, so they are `'reused'`; on a successful first run
 * they are what JUST happened, so they are `'ran'` — the two are the whole point
 * of the report, and labelling a fresh run `reused` tells the model its own
 * effect was skipped. (`resumed` is reported separately by the caller, which
 * knows it just completed a prefix.)
 *
 * `live` carries this run's in-memory outcomes. It matters because the log
 * persists ONLY the `evt-<seq>` string, and `10`'s receipt renders each line
 * through `renderEvent` — which needs the event OBJECT. Without this the
 * receipt silently dropped every effect line (measured: `effect "edit" has no
 * event; its receipt line is omitted`) and degraded to a bare verb sentence.
 * Each live event is matched by its `seq`, so a reused/replayed step — which
 * has no live event — keeps none, exactly as before.
 *
 * `path` is always `null` here: it is not persisted in the receipt (only
 * `event` is), and `settle` carries the verdict. An entry whose shape no longer
 * validates yields an EMPTY list rather than a repaired one — inventing details
 * would be worse than reporting none.
 */
function summaryOf(
  entry: CommandLogEntry,
  settle: 'ran' | 'reused',
  fromBase = 0,
  live: readonly CommandEffectOutcome[] = []
): SettleRunSummary {
  const parsed = CommandLogEntrySchema.safeParse(entry);
  // The cursor is `steps.length` and `execute.ts` skips any effect below
  // `fromStep` without re-numbering, so the tail is `[fromBase..total)` and the
  // re-based index is `step - fromBase`. On a fresh run `fromBase` is 0 and the
  // whole entry is the answer.
  const tail = parsed.success ? parsed.data.steps.filter((s) => s.step >= fromBase) : [];
  const base = parsed.success ? parsed.data.steps.length - tail.length : 0;
  const eventsBySeq = new Map<number, WorldEvent>();
  for (const o of live) if (o.seq !== null && o.event !== undefined) eventsBySeq.set(o.seq, o.event);
  const effects: CommandEffectOutcome[] = tail.map((s) => {
    const seq = s.event === null ? null : Number(s.event.slice(4));
    const event = seq === null ? undefined : eventsBySeq.get(seq);
    return {
      action: s.action,
      step: s.step - base,
      at: s.at,
      settle,
      path: null,
      seq,
      ...(event === undefined ? {} : { event }),
    };
  });
  return { key: entry.key, command: entry.command, steps: effects.length, effects };
}

/**
 * What settling this binding WOULD do now, writing nothing (the dry run).
 *
 * Same key, same `has()` answers, same scopes as `settleLocked`, then the
 * executor in `dryRun` mode: a `done` entry for the key reports `reused` (the
 * real press would run nothing new), a `partial` one reports the tail that
 * would resume, otherwise the effects whose `when` holds report `ran` with
 * `seq: null` and their resolved `args`. A stage-A refusal reports `failed`.
 */
export async function previewWorldCommand(ctx: ActionContext, input: SettleInput): Promise<SettleReport> {
  const parsed = parseFrontmatter(await ctx.store.readFile(input.source));
  const entries = readCommandLog(parsed.frontmatter, input.source);
  const hasPaths = await hasPathsOf(ctx, input.spec);
  const key = commandKey({
    source: input.source,
    hook: input.hook,
    command: input.spec.id,
    fact: hasPaths.size === 0 ? input.fact : `${input.fact}|${hasFactOf(hasPaths)}`,
  });
  const found = entries.find((e) => e.key === key);
  if (found !== undefined && found.status === 'done') {
    return { ran: [], reused: [summaryOf(found, 'reused')], resumed: [] };
  }
  if (found === undefined && input.mode === 'resume') return { ran: [], reused: [], resumed: [] };
  const done = found?.steps.length ?? 0;
  const execution = await runWorldCommand(ctx, input.spec, {
    hook: input.hook,
    entry: input.index,
    key,
    argScope: argScopeOf(input, parsed),
    conditionValues: conditionValuesOf(input, parsed),
    conditionPaths: hasPaths,
    fromStep: done,
    dryRun: true,
  });
  if (!execution.ok) {
    return {
      ran: [], reused: [], resumed: [],
      failed: { key, command: input.spec.id, step: 0, code: execution.error.code as unknown as ActionErrorCode, message: execution.error.message },
    };
  }
  const effects = execution.result.effects;
  const summary = { key, command: input.spec.id, steps: effects.length, effects };
  return found !== undefined
    ? { ran: [], reused: [], resumed: [{ ...summary, from: done, to: done + effects.length }] }
    : { ran: [summary], reused: [], resumed: [] };
}

/* ────────────────────────────────────────────────────────────────────────────
 * 4. Scope construction (`03` §3.1 / `02` §2.5)
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Split the flat trigger context into the executor's two scopes.
 *
 * Array values reach `argScope.trigger` only — a condition compares scalars, and
 * `evaluateInterpolation` already rejects an over-long or nested array where it
 * matters (`list-args` reads the array whole, per `03` §14.2).
 */
function argScopeOf(input: SettleInput, parsed: ParsedFrontmatter): EffectArgScope {
  // Passed through verbatim: `SettleInput.trigger` and `EffectArgScope.trigger`
  // both carry `02` §2.5's FULL names, which the author writes literally in the
  // command file. No re-prefixing and no stripping — the earlier mismatch
  // (`trigger.trigger.path`, and `roll.result` resolving to "") came from
  // treating one side as bare keys.
  return {
    params: { ...input.args },
    trigger: input.trigger as Readonly<Record<string, InterpolatedValue>>,
    status: statusValuesOf(parsed),
  };
}

/**
 * Pre-resolve every `has()` a `do[].when` names — one `statKind` per path, the
 * same way the binding-level `when` is resolved in `trigger.ts`. Without this a
 * step such as `when: 'has("player/ledger.md")'` could never be evaluated
 * (`io_failed`: "was not pre-resolved"), so no command could ask what the
 * player carries.
 *
 * Resolved ONCE, before the first effect: a file an earlier step of the same
 * command creates is not seen by a later step's `has()`. Branch on what was
 * true when the trigger fired, not on the command's own writes.
 */
async function hasPathsOf(
  ctx: ActionContext,
  spec: WorldCommandSpec
): Promise<Map<string, 'file' | 'dir' | 'missing'>> {
  const paths = new Map<string, 'file' | 'dir' | 'missing'>();
  for (const step of spec.steps) {
    if (!step.whenAst) continue;
    for (const path of collectHasPaths(step.whenAst)) {
      if (!paths.has(path)) paths.set(path, await ctx.store.statKind(path));
    }
  }
  return paths;
}

/** `has()` answers as a stable fact component: sorted, present = 1, missing = 0. */
function hasFactOf(paths: ReadonlyMap<string, 'file' | 'dir' | 'missing'>): string {
  const parts = [...paths.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `has(${parts.map(([path, kind]) => `${path}=${kind === 'missing' ? 0 : 1}`).join(',')})`;
}

/**
 * Flat `conditionValues` for `do[].when`: the COMMAND_PROFILE roots with scalars
 * only (`03` §3.1). Scalars are resolved through the SAME interpolation the
 * executor uses, so there is one evaluation semantics rather than two.
 */
function conditionValuesOf(input: SettleInput, parsed: ParsedFrontmatter): Record<string, Scalar> {
  const vars = new Map<string, Scalar | Scalar[]>(Object.entries(input.trigger));
  const values: Record<string, Scalar> = {};
  for (const [key, value] of vars) {
    if (Array.isArray(value)) continue;
    const resolved = evaluateInterpolation(`{{ ${key} }}`, vars);
    values[key] = resolved.ok ? (resolved.value as Scalar) : value;
  }
  // Arrays are skipped for the same reason as `trigger`'s above: a condition
  // compares scalars, and the array is consumed whole by the effect instead.
  for (const [name, value] of Object.entries(input.args)) {
    if (!Array.isArray(value)) values[`params.${name}`] = value;
  }
  for (const [name, value] of Object.entries(statusValuesOf(parsed))) values[`status.${name}`] = value;
  return values;
}

/**
 * The triggered entity's own `status.data` (`03` §3.1: `status.*` is the SOURCE
 * entity's, not the written one). Scalars only — an effect's `argScope.status`
 * is the same map.
 */
function statusValuesOf(parsed: ParsedFrontmatter): Record<string, Scalar> {
  const status = parsed.frontmatter?.['status'];
  const data = status !== null && typeof status === 'object'
    ? (status as Record<string, unknown>)['data']
    : undefined;
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return {};
  const out: Record<string, Scalar> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
      out[key] = value as Scalar;
    }
  }
  return out;
}
