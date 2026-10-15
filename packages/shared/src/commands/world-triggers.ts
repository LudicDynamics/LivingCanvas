/**
 * World triggers — the engine. Schema:
 * `schemas/triggers.ts`; declared states: `rules/states.ts` + `actions/states.ts`.
 *
 * After every state-changing action (the ActionService's `after` hook — which
 * covers the player's and the writer's actions, `enterLayer`, a resolved roll
 * and every clock tick a roll's commands make) the engine:
 *
 *   1. applies a resolved roll's declared harm to hidden hp (`applyRollHarm`);
 *   2. snapshots the world (declared states, clock, `has()` answers, clue counts);
 *   3. picks the non-keyword triggers whose `when` holds and that may fire
 *      (`planTriggers`, pure);
 *   4. for each: claims it in `world/README.md`'s `trigger_log` FIRST, then runs
 *      its consequence — the `do` command through the ordinary command
 *      executor, the `ending` shorthand through `endWorld` — and lands its
 *      `fallback` as a story event when nothing else narrated;
 *   5. repeats (bounded) so a consequence that changes a state can fire the
 *      trigger waiting on it.
 *
 * Keyword triggers never fire here: the writer judges meaning and calls
 * `fireKeywordTrigger` through its `trigger_keyword` tool.
 *
 * Idempotency: the log entry is written before the consequence runs, and the
 * log is read under a per-world lock, so a retried request, a double click or
 * a replayed turn finds the claim and fires nothing. At most once, never twice.
 *
 * Contract: `runWorldTriggers` / `applyRollHarm` NEVER throw — the action that
 * caused them has already committed.
 */
import type { ActionContext, ActionResult } from '../actions/types.js';
import { registerActionHook, type ActionInput, type ActionMethodName } from '../actions/service.js';
import { ActionError } from '../actions/errors.js';
import { clockLeft, ENDING_RECORD_PATH, modeHasEndings, reachedEnding } from '../actions/closed-world-state.js';
import { endWorld } from '../actions/closed-world.js';
import { recordStoryEvent } from '../actions/story-event.js';
import { showCg, swapBackground } from '../actions/scene-media.js';
import { assertStateWriteAllowed, readStateFile, writeState } from '../actions/states.js';
import { parseFrontmatter, stringifyFrontmatter } from '../schemas/frontmatter.js';
import { clockEndingHolds } from '../schemas/world.js';
import type { WorldManifest } from '../schemas/world.js';
import { parseWorldTriggers, type KeywordTrigger, type TriggerDiceBand, type WorldTrigger } from '../schemas/triggers.js';
import type { WorldStore } from '../store/world-store.js';
import { recordRollConsequence } from '../actions/dice-consequence.js';
import { isOutcomeTier } from '../rules/outcome-tiers.js';
import { currentStateValue, harmAmount, HARM_SEVERITIES, type HarmSeverity } from '../rules/states.js';
import { diceConventionOf, diceGradeOf } from '../rules/themes.js';
import type { CheckGrade } from '../rules/skills.js';
import { bandIndexOfGrade, skillCheckOf } from '../actions/skill-cards.js';
import type { CommandTriggerHook } from './bindings.js';
import { COMMAND_PROFILE, collectHasPaths, evaluateCondition, parseCondition } from './condition.js';
import type { ConditionAst, ConditionProfile, Scalar } from './condition.js';
import { runWorldCommand } from './execute.js';
import { withSourceLock } from './serial.js';
import { parseWorldCommand } from './world-command.js';
import { parseLivingWorld, type LivingWorld } from '../schemas/living.js';
import { livingConditionValues, livingNow } from '../rules/living.js';
import { parseLivingState, LIVING_KEY } from '../actions/living-state.js';
import { loopEpoch } from '../actions/loop.js';

/* ────────────────────────────────────────────────────────────────────────────
 * 1. Causes and the fired-trigger record
 * ──────────────────────────────────────────────────────────────────────────── */

/** What just happened. Only `roll` / `enter` / `keyword` can satisfy event kinds. */
export type TriggerCause =
  | { kind: 'action'; action: string }
  | { kind: 'enter'; layer: string }
  | {
      kind: 'roll';
      path: string;
      layer: string | null;
      result: number;
      passed: boolean;
      crit: boolean;
      fumble: boolean;
      band: TriggerDiceBand | null;
    }
  | { kind: 'keyword'; id: string };

/** `world/README.md` frontmatter key. Engine-owned; reserved from command edits. */
export const TRIGGER_LOG_KEY = 'trigger_log';
export const TRIGGER_LOG_PATH = ENDING_RECORD_PATH;
/** A consequence may enable another trigger; this bounds the cascade. */
export const MAX_TRIGGER_PASSES = 4;

export interface TriggerLogEntry {
  /** Times fired in this save. */
  count: number;
  /** The request / agent turn of the last firing. */
  turn: string | null;
  at: string;
  /** `running` is written BEFORE the consequence; a crash leaves it claimed, not re-fired. */
  status: 'running' | 'done' | 'failed';
  /** Level triggers with `once: false`: true while the condition still holds (re-arms when false). */
  holding?: boolean;
  /** Event triggers with `once: false`: what the last firing was about (turn / card path). */
  fact?: string;
  error?: string;
}
export type TriggerLog = Record<string, TriggerLogEntry>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parse a raw `trigger_log`; malformed entries are dropped (read as never fired only if absent). */
export function parseTriggerLog(raw: unknown): TriggerLog {
  const out: TriggerLog = {};
  if (!isPlainObject(raw)) return out;
  for (const [id, v] of Object.entries(raw)) {
    if (!isPlainObject(v)) continue;
    const status = v.status === 'done' || v.status === 'failed' || v.status === 'running' ? v.status : 'done';
    out[id] = {
      count: typeof v.count === 'number' && v.count > 0 ? v.count : 1,
      turn: typeof v.turn === 'string' ? v.turn : null,
      at: typeof v.at === 'string' ? v.at : '',
      status,
      ...(typeof v.holding === 'boolean' ? { holding: v.holding } : {}),
      ...(typeof v.fact === 'string' ? { fact: v.fact } : {}),
      ...(typeof v.error === 'string' ? { error: v.error } : {}),
    };
  }
  return out;
}

export async function readTriggerLog(store: WorldStore): Promise<TriggerLog> {
  if ((await store.statKind(TRIGGER_LOG_PATH)) !== 'file') return {};
  return parseTriggerLog(parseFrontmatter(await store.readFile(TRIGGER_LOG_PATH)).frontmatter?.[TRIGGER_LOG_KEY]);
}

/** Bookkeeping write, like `command_log`: no event (it is not a story fact). */
async function writeTriggerLog(store: WorldStore, log: TriggerLog): Promise<void> {
  const exists = (await store.statKind(TRIGGER_LOG_PATH)) === 'file';
  const parsed = exists ? parseFrontmatter(await store.readFile(TRIGGER_LOG_PATH)) : { frontmatter: {}, body: '' };
  const fm: Record<string, unknown> = { ...(parsed.frontmatter ?? {}), [TRIGGER_LOG_KEY]: log };
  await store.writeFileAtomic(TRIGGER_LOG_PATH, stringifyFrontmatter(fm, parsed.body));
}

/* ────────────────────────────────────────────────────────────────────────────
 * 2. Condition references (pure)
 * ──────────────────────────────────────────────────────────────────────────── */

/** A character id as a condition root: hyphens read as underscores (`xia-cheng` → `xia_cheng`). */
export function characterRefRoot(id: string): string {
  return id.replace(/-/g, '_');
}

/**
 * The profile for `state` triggers: the command algebra over the world's own
 * names. `time` / `events` are a living world's clock and calendar
 *; elsewhere they simply never resolve.
 */
export function triggerConditionProfile(characterIds: readonly string[]): ConditionProfile {
  return {
    ...COMMAND_PROFILE,
    roots: ['player', 'world', 'clock', 'clues', 'time', 'events', ...characterIds.map(characterRefRoot)],
  };
}

export function parseTriggerCondition(when: string, characterIds: readonly string[]) {
  return parseCondition(when, triggerConditionProfile(characterIds));
}

/** What every trigger reads: one pass over the world, then pure evaluation. */
export interface TriggerSnapshot {
  /** `player.<id>`, `world.<id>`, `<character>.<id>`, `clock.left` (and `clock.turns` when the clock moves by turns). */
  values: Map<string, Scalar>;
  /** Pre-resolved `has()` answers for every state trigger. */
  paths: Map<string, 'file' | 'dir' | 'missing'>;
  /** Per trigger with `clues:` — how many of its clue paths the save holds. */
  clues: Map<string, { held: number; total: number }>;
  /** The world has reached an ending: nothing fires any more. */
  ended: boolean;
}

export interface TriggerPlan {
  fire: WorldTrigger[];
  /** `once: false` level triggers whose condition stopped holding: re-arm them. */
  release: string[];
}

const LEVEL_KINDS = new Set(['clock', 'state']);

function stateHolds(trigger: Extract<WorldTrigger, { kind: 'state' }>, snap: TriggerSnapshot, characterIds: readonly string[]): boolean {
  const parsed = parseTriggerCondition(trigger.when, characterIds);
  if (!parsed.ok) return false;
  const values = new Map(snap.values);
  const clues = snap.clues.get(trigger.id);
  values.set('clues.held', clues?.held ?? 0);
  values.set('clues.total', clues?.total ?? 0);
  const r = evaluateCondition(parsed.value, { values, paths: snap.paths });
  // An unresolved reference (an undeclared state) is "not yet", never an error here:
  // check:worlds reports it at authoring time.
  return r.ok && r.value;
}

function diceHolds(trigger: Extract<WorldTrigger, { kind: 'dice' }>, cause: TriggerCause): boolean {
  if (cause.kind !== 'roll') return false;
  const w = trigger.when;
  if (w.card !== undefined && !(w.card.endsWith('/') ? cause.path.startsWith(w.card) : cause.path === w.card)) return false;
  if (w.layer !== undefined && cause.layer !== w.layer) return false;
  if (w.band !== undefined && cause.band !== w.band) return false;
  if (w.passed !== undefined && cause.passed !== w.passed) return false;
  if (w.fumble !== undefined && cause.fumble !== w.fumble) return false;
  if (w.crit !== undefined && cause.crit !== w.crit) return false;
  return true;
}

/** Whether `trigger`'s condition holds right now. Pure. */
export function triggerHolds(
  trigger: WorldTrigger,
  snap: TriggerSnapshot,
  cause: TriggerCause,
  characterIds: readonly string[] = [],
): boolean {
  switch (trigger.kind) {
    case 'clock': {
      const left = snap.values.get('clock.left');
      return typeof left === 'number' && clockEndingHolds(trigger.when, left);
    }
    case 'state':
      return stateHolds(trigger, snap, characterIds);
    case 'keyword':
      return cause.kind === 'keyword' && cause.id === trigger.id;
    case 'place':
      return cause.kind === 'enter' && cause.layer === trigger.when.layer;
    case 'dice':
      return diceHolds(trigger, cause);
  }
}

/** What a `once: false` event trigger's single firing is about. */
export function triggerFact(trigger: WorldTrigger, cause: TriggerCause, turn: string): string | undefined {
  if (LEVEL_KINDS.has(trigger.kind)) return undefined;
  if (cause.kind === 'roll') return cause.path;
  return turn;
}

/**
 * Which triggers fire now, in declaration order. Pure: same inputs, same plan.
 *
 *   - `once: true` (default): fires when its condition holds and it has never fired.
 *   - `once: false`, clock/state: fires on the rising edge (holds now, did not
 *     at its last firing), re-arms when the condition stops holding.
 *   - `once: false`, keyword/place/dice: fires once per fact (turn, or rolled card).
 */
export function planTriggers(
  triggers: readonly WorldTrigger[],
  snap: TriggerSnapshot,
  cause: TriggerCause,
  log: TriggerLog,
  turn: string,
  characterIds: readonly string[] = [],
): TriggerPlan {
  const fire: WorldTrigger[] = [];
  const release: string[] = [];
  if (snap.ended) return { fire, release };
  for (const t of triggers) {
    const entry = log[t.id];
    const holds = triggerHolds(t, snap, cause, characterIds);
    if (t.once !== false) {
      if (holds && !entry) fire.push(t);
      continue;
    }
    if (LEVEL_KINDS.has(t.kind)) {
      if (holds && !entry?.holding) fire.push(t);
      else if (!holds && entry?.holding) release.push(t.id);
      continue;
    }
    if (holds && entry?.fact !== triggerFact(t, cause, turn)) fire.push(t);
  }
  return { fire, release };
}

/* ────────────────────────────────────────────────────────────────────────────
 * 3. Reading the world
 * ──────────────────────────────────────────────────────────────────────────── */

/** The parts of `world.json` the trigger layer reads, without a layer rescan. */
export interface TriggerWorld {
  manifest: WorldManifest;
  triggers: WorldTrigger[];
  errors: string[];
  characterIds: string[];
  /** A living world's calendar (world.json `living`), when it has a valid one. */
  living?: LivingWorld | null;
}

/** Read `world.json` directly (this runs after every action). Null when there is none. */
export async function loadTriggerWorld(store: WorldStore): Promise<TriggerWorld | null> {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(await store.readFile('world.json'));
  } catch {
    return null;
  }
  if (!isPlainObject(raw)) return null;
  const { triggers, errors } = parseWorldTriggers(raw.triggers);
  const characters = Array.isArray(raw.characters) ? raw.characters : [];
  const characterIds = characters
    .map((c) => (isPlainObject(c) && typeof c.id === 'string' ? c.id : null))
    .filter((id): id is string => id !== null);
  const living = raw.living === undefined ? null : parseLivingWorld(raw.living).living;
  return { manifest: raw as unknown as WorldManifest, triggers, errors, characterIds, living };
}

/**
 * A clue counts once it exists in the save — where the roll created it, or
 * carried into the bag under the same file name (the debrief's rule,
 * the design notes).
 */
async function heldClue(store: WorldStore, path: string): Promise<boolean> {
  if ((await store.statKind(path)) === 'file') return true;
  const name = path.split('/').pop()!;
  return (await store.statKind(`player/${name}`)) === 'file';
}

/** One pass over the files every trigger may read. */
export async function snapshotTriggerWorld(store: WorldStore, world: TriggerWorld): Promise<TriggerSnapshot> {
  const values = new Map<string, Scalar>();
  const add = async (prefix: string, path: string) => {
    const file = await readStateFile(store, path);
    if (!file) return null;
    for (const decl of file.states) values.set(`${prefix}.${decl.id}`, currentStateValue(decl, file.data));
    return file;
  };
  await add('player', 'player/README.md');
  const worldFile = await add('world', 'world/README.md');
  // A living world's clock: `time.*` and `events.*`.
  const clock = world.living && worldFile ? parseLivingState(worldFile.frontmatter[LIVING_KEY]) : null;
  if (world.living && clock) {
    for (const [k, v] of livingConditionValues(world.living, livingNow(world.living, clock.seed, clock.minute))) values.set(k, v);
  }
  for (const id of world.characterIds) await add(characterRefRoot(id), `characters/${id}/README.md`);
  const left = await clockLeft(store, world.manifest);
  if (left !== null) values.set('clock.left', left);
  // A clock that moves by turns (actions/turn-clock.ts): turns spent in the current step.
  const perTurns = (world.manifest.clock as { perTurns?: unknown } | undefined)?.perTurns;
  if (left !== null && typeof perTurns === 'number' && world.manifest.clock) {
    const card = await store.readFile(world.manifest.clock.path).then((t) => parseFrontmatter(t).frontmatter, () => null);
    const status = card?.status as { data?: Record<string, unknown> } | undefined;
    const raw = Number(status?.data?.turns ?? 0);
    values.set('clock.turns', Number.isInteger(raw) && raw >= 0 ? raw : 0);
  }

  const paths = new Map<string, 'file' | 'dir' | 'missing'>();
  const clues = new Map<string, { held: number; total: number }>();
  for (const t of world.triggers) {
    if (t.kind !== 'state') continue;
    const parsed = parseTriggerCondition(t.when, world.characterIds);
    if (parsed.ok) {
      for (const p of collectHasPaths(parsed.value)) if (!paths.has(p)) paths.set(p, await store.statKind(p));
    }
    if (t.clues) {
      let held = 0;
      for (const c of t.clues) if (await heldClue(store, c)) held += 1;
      clues.set(t.id, { held, total: t.clues.length });
    }
  }
  const ended = (await reachedEnding(store, world.manifest)) !== null;
  return { values, paths, clues, ended };
}

/* ────────────────────────────────────────────────────────────────────────────
 * 4. Firing
 * ──────────────────────────────────────────────────────────────────────────── */

export interface FiredTrigger {
  id: string;
  kind: WorldTrigger['kind'];
  label?: string;
  settle: 'ran' | 'failed';
  /** Effects the `do` command landed. */
  effects: number;
  /** The ending reached by this firing, if any. */
  ending?: string;
  /** True when the fallback text was landed as a story event. */
  fallback: boolean;
  /** Pre-generated assets the page may show with this moment (never generated at play time). */
  assets?: WorldTrigger['assets'];
  /**
   * What the ENGINE showed from `assets` — only for a trigger without `do`
   *. With a `do`, the command's own `show_cg` /
   * `swap_background` effects do the showing and this stays absent.
   */
  shown?: Array<{ kind: 'cg' | 'background'; path: string; layer?: string }>;
  error?: string;
  /** Triggers this firing's consequence set off in turn (keyword firings only). */
  cascade?: FiredTrigger[];
}

function causeValues(t: WorldTrigger, cause: TriggerCause): Record<string, Scalar> {
  const v: Record<string, Scalar> = { 'trigger.id': t.id, 'trigger.kind': t.kind, 'trigger.path': null };
  if (cause.kind === 'roll') {
    Object.assign(v, {
      'trigger.path': cause.path,
      'roll.result': cause.result,
      'roll.passed': cause.passed,
      'roll.crit': cause.crit,
      'roll.fumble': cause.fumble,
      'roll.layer': cause.layer,
    });
  }
  if (cause.kind === 'enter') v['entry.layer'] = cause.layer;
  return v;
}

async function runTriggerCommand(
  ctx: ActionContext,
  t: WorldTrigger,
  cause: TriggerCause,
): Promise<{ effects: number; narrated: boolean; error?: string }> {
  const id = t.do!;
  const file = `command/${id}.yaml`;
  if ((await ctx.store.statKind(file)) !== 'file') return { effects: 0, narrated: false, error: `trigger "${t.id}": ${file} does not exist` };
  const parsed = parseWorldCommand(id, await ctx.store.readFile(file));
  if (!parsed.ok) {
    return { effects: 0, narrated: false, error: `trigger "${t.id}": ${file} is malformed: ${parsed.errors.map((e) => e.message).join('; ')}` };
  }
  const spec = parsed.command;
  const paths = new Map<string, 'file' | 'dir' | 'missing'>();
  for (const step of spec.steps) {
    if (!step.whenAst) continue;
    for (const p of collectHasPaths(step.whenAst as ConditionAst)) if (!paths.has(p)) paths.set(p, await ctx.store.statKind(p));
  }
  const values = causeValues(t, cause);
  const run = await runWorldCommand(ctx, spec, {
    // `hook` only labels the run's result; a trigger is not one of the three
    // `on.<hook>` bindings, and nothing in the executor branches on it.
    hook: (cause.kind === 'roll' ? 'roll_resolved' : 'trigger') as CommandTriggerHook,
    entry: 0,
    key: `trigger:${t.id}:${ctx.turn}`,
    argScope: { params: {}, trigger: values },
    conditionValues: values,
    conditionPaths: paths,
  });
  if (!run.ok) return { effects: 0, narrated: false, error: `trigger "${t.id}": ${run.error.message}` };
  const effects = run.result.effects;
  const failed = effects.find((e) => e.settle === 'failed');
  return {
    effects: effects.filter((e) => e.settle !== 'failed').length,
    narrated: effects.some((e) => e.action === 'event' && e.settle !== 'failed'),
    ...(failed ? { error: `trigger "${t.id}": ${failed.at} ${failed.error?.message ?? 'failed'}` } : {}),
  };
}

async function playerLayer(ctx: ActionContext, world: TriggerWorld, cause: TriggerCause): Promise<string> {
  if (cause.kind === 'enter') return cause.layer;
  if (cause.kind === 'roll' && cause.layer) return cause.layer;
  try {
    const vp = ctx.store.readViewpoint();
    if (vp?.layer) return vp.layer;
  } catch {
    // no viewpoint yet
  }
  const entry = (world.manifest as { entry?: unknown }).entry;
  return typeof entry === 'string' && entry ? entry : 'map';
}

async function fireOne(
  ctx: ActionContext,
  world: TriggerWorld,
  t: WorldTrigger,
  cause: TriggerCause,
  log: TriggerLog,
): Promise<FiredTrigger> {
  const at = (ctx.now ?? (() => new Date().toISOString()))();
  const prev = log[t.id];
  // Claim first: whatever happens next, this firing is recorded and never repeated.
  log[t.id] = {
    count: (prev?.count ?? 0) + 1,
    turn: ctx.turn ?? null,
    at,
    status: 'running',
    ...(t.once === false && LEVEL_KINDS.has(t.kind) ? { holding: true } : {}),
    ...(t.once === false && !LEVEL_KINDS.has(t.kind) ? { fact: triggerFact(t, cause, ctx.turn) } : {}),
  };
  await writeTriggerLog(ctx.store, log);

  let effects = 0;
  let narrated = false;
  let error: string | undefined;
  const epoch = loopEpoch(ctx.store);
  if (t.do) {
    try {
      const r = await runTriggerCommand(ctx, t, cause);
      effects = r.effects;
      narrated = r.narrated;
      error = r.error;
    } catch (err) {
      error = `trigger "${t.id}": ${(err as Error).message}`;
    }
  }
  // No `do`: the trigger's own cg / background assets are the consequence's
  // picture (§8.1). CGs show in declaration order (once per save); a background
  // lands on the layer this firing is about. Before `ending`, so a CG leads into it.
  const shown: NonNullable<FiredTrigger['shown']> = [];
  if (!t.do && t.assets?.length) {
    for (const a of t.assets) {
      try {
        if (a.kind === 'cg') {
          const r = await showCg(ctx, { path: a.path, ...(t.label ? { caption: t.label } : {}) });
          if (!r.reused) shown.push({ kind: 'cg', path: r.path });
        } else if (a.kind === 'background') {
          const r = await swapBackground(ctx, { layer: await playerLayer(ctx, world, cause), path: a.path });
          if (!r.reused) shown.push({ kind: 'background', path: r.path, layer: r.layer });
        }
      } catch (err) {
        error ??= `trigger "${t.id}": ${(err as Error).message}`;
      }
    }
  }
  if (t.ending) {
    try {
      await endWorld(ctx, t.ending);
    } catch (err) {
      error ??= `trigger "${t.id}": ${(err as Error).message}`;
    }
  }
  const ending = await reachedEnding(ctx.store, world.manifest);
  let fallback = false;
  if (t.fallback && !narrated && !ending) {
    try {
      await recordStoryEvent(ctx, {
        target: await playerLayer(ctx, world, cause),
        title: t.label ?? t.id,
        text: t.fallback,
      });
      fallback = true;
    } catch {
      // The log still says it fired; the writer reads the trigger in its receipt.
    }
  }
  if (loopEpoch(ctx.store) !== epoch) {
    // The consequence reset the loop: `world/README.md`
    // — and the trigger_log in it — is the loop start's again. Writing this
    // pre-reset log back would mark every trigger of the old loop as fired in
    // the new one. The new loop's log is the restored one; the caller re-reads.
    for (const id of Object.keys(log)) delete log[id];
    Object.assign(log, await readTriggerLog(ctx.store));
  } else {
    log[t.id] = { ...log[t.id]!, status: error ? 'failed' : 'done', ...(error ? { error: error.slice(0, 500) } : {}) };
    await writeTriggerLog(ctx.store, log);
  }
  return {
    id: t.id,
    kind: t.kind,
    ...(t.label ? { label: t.label } : {}),
    settle: error ? 'failed' : 'ran',
    effects,
    ...(ending ? { ending: ending.id } : {}),
    fallback,
    ...(t.assets ? { assets: t.assets } : {}),
    ...(shown.length ? { shown } : {}),
    ...(error ? { error } : {}),
  };
}

async function evaluateLocked(ctx: ActionContext, world: TriggerWorld, cause: TriggerCause): Promise<FiredTrigger[]> {
  const fired: FiredTrigger[] = [];
  let now: TriggerCause = cause;
  for (let pass = 0; pass < MAX_TRIGGER_PASSES; pass += 1) {
    const snap = await snapshotTriggerWorld(ctx.store, world);
    if (snap.ended) break;
    const log = await readTriggerLog(ctx.store);
    const plan = planTriggers(world.triggers, snap, now, log, ctx.turn, world.characterIds);
    if (plan.release.length > 0) {
      for (const id of plan.release) log[id] = { ...log[id]!, holding: false };
      await writeTriggerLog(ctx.store, log);
    }
    if (plan.fire.length === 0) break;
    const epoch = loopEpoch(ctx.store);
    for (const t of plan.fire) {
      if (await reachedEnding(ctx.store, world.manifest)) break;
      fired.push(await fireOne(ctx, world, t, now, log));
      // A loop reset made this pass's plan stale: re-plan on the restored world.
      if (loopEpoch(ctx.store) !== epoch) break;
    }
    // Later passes only see what the consequences changed, not the original event.
    now = { kind: 'action', action: 'trigger' };
  }
  return fired;
}

const LOCK_KEY = 'trigger_log';

/**
 * Evaluate the world's non-keyword triggers after `cause`. Never throws; an
 * internal failure means "nothing fired".
 */
export async function runWorldTriggers(ctx: ActionContext, cause: TriggerCause): Promise<FiredTrigger[]> {
  try {
    if (cause.kind === 'keyword') return [];
    const world = await loadTriggerWorld(ctx.store);
    if (!world || world.triggers.every((t) => t.kind === 'keyword')) return [];
    return await withSourceLock(ctx.store, LOCK_KEY, () => evaluateLocked(ctx, world, cause));
  } catch {
    return [];
  }
}

/**
 * A new day in a living world re-arms its time-bound level triggers
 *: a `once: false` state trigger that reads
 * `time.*` or `events.*` fires once per day it holds, even when the clock
 * jumps from one occurrence straight to the next (a week's sleep from ferry
 * day to ferry day). Returns the ids re-armed. Never throws.
 */
export async function rearmTimeTriggers(store: WorldStore): Promise<string[]> {
  try {
    const world = await loadTriggerWorld(store);
    if (!world) return [];
    const timed = world.triggers.filter((t) => t.kind === 'state' && t.once === false && /\b(time|events)\./.test(t.when)).map((t) => t.id);
    if (timed.length === 0) return [];
    return await withSourceLock(store, LOCK_KEY, async () => {
      const log = await readTriggerLog(store);
      const ids = timed.filter((id) => log[id]?.holding);
      if (ids.length === 0) return [];
      for (const id of ids) log[id] = { ...log[id]!, holding: false };
      await writeTriggerLog(store, log);
      return ids;
    });
  } catch {
    return [];
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * 5. Keyword triggers — judged by the writer
 * ──────────────────────────────────────────────────────────────────────────── */

/** What the writer sees each turn: the meaning to listen for, never the consequence. */
export interface KeywordIntent {
  id: string;
  intent: string;
  scope: 'player' | 'any';
}

function keywordActive(t: KeywordTrigger, log: TriggerLog, layer: string | null, turn: string | undefined): boolean {
  const entry = log[t.id];
  if (t.once !== false && entry) return false;
  if (t.once === false && turn !== undefined && entry?.fact === turn) return false;
  if (t.when.layers && (layer === null || !t.when.layers.includes(layer))) return false;
  return true;
}

/** The keyword triggers that may still fire where the player is now. */
export async function activeKeywordIntents(store: WorldStore, layer?: string | null): Promise<KeywordIntent[]> {
  try {
    const world = await loadTriggerWorld(store);
    if (!world) return [];
    const keywords = world.triggers.filter((t): t is KeywordTrigger => t.kind === 'keyword');
    if (keywords.length === 0) return [];
    if (await reachedEnding(store, world.manifest)) return [];
    const log = await readTriggerLog(store);
    let here = layer ?? null;
    if (layer === undefined) {
      try {
        here = store.readViewpoint()?.layer ?? null;
      } catch {
        here = null;
      }
    }
    return keywords
      .filter((t) => keywordActive(t, log, here, undefined))
      .map((t) => ({ id: t.id, intent: t.when.intent, scope: t.when.scope ?? 'player' }));
  } catch {
    return [];
  }
}

/** The writer-context block for active keyword intents ('' when there are none). */
export function keywordIntentsBlock(intents: readonly KeywordIntent[]): string {
  if (intents.length === 0) return '';
  const lines = intents.map((k) => `- ${k.id}: ${k.intent}${k.scope === 'any' ? ' (anyone in the scene may say or do it)' : ' (only the player)'}`);
  return [
    '[Turning points — judge by meaning]',
    'Call trigger_keyword({ id }) ONLY when the player\'s words or actions this turn actually mean one of these. Paraphrase counts; mere mention, a question about it, or a joke does not. Never announce an ending or a turning point in prose — the engine does that.',
    ...lines,
  ].join('\n');
}

export interface KeywordFireInput {
  id: string;
  /** The player's layer; defaults to the viewpoint. */
  layer?: string | null;
  /** Who said/did it. A `player`-scoped trigger refuses `character`. */
  by?: 'player' | 'character';
}

/**
 * Validate and fire one keyword trigger (the writer's `trigger_keyword` tool).
 * Throws `ActionError` when it may not fire: unknown id, not a keyword, already
 * fired, wrong layer, wrong speaker, or the world has ended.
 */
export async function fireKeywordTrigger(ctx: ActionContext, input: KeywordFireInput): Promise<FiredTrigger> {
  const world = await loadTriggerWorld(ctx.store);
  const t = world?.triggers.find((x) => x.id === input.id);
  if (!world || !t) {
    throw new ActionError({ code: 'not_found', message: `No trigger "${input.id}" in world.json triggers.` });
  }
  if (t.kind !== 'keyword') {
    throw new ActionError({ code: 'invalid_argument', message: `Trigger "${t.id}" is a ${t.kind} trigger; the engine fires it by itself.` });
  }
  if ((input.by ?? 'player') === 'character' && (t.when.scope ?? 'player') === 'player') {
    throw new ActionError({ code: 'invalid_argument', message: `Trigger "${t.id}" counts only the player's own words or actions.` });
  }
  let layer = input.layer ?? null;
  if (input.layer === undefined) {
    try {
      layer = ctx.store.readViewpoint()?.layer ?? null;
    } catch {
      layer = null;
    }
  }
  return withSourceLock(ctx.store, LOCK_KEY, async () => {
    if (await reachedEnding(ctx.store, world.manifest)) {
      throw new ActionError({ code: 'game_ended', message: 'This story has already ended.' });
    }
    const log = await readTriggerLog(ctx.store);
    if (!keywordActive(t, log, layer, ctx.turn)) {
      const why = t.when.layers && (layer === null || !t.when.layers.includes(layer))
        ? `it only counts in ${t.when.layers.join(', ')}`
        : 'it has already fired';
      throw new ActionError({ code: 'invalid_argument', message: `Trigger "${t.id}" cannot fire now: ${why}.` });
    }
    const fired = await fireOne(ctx, world, t, { kind: 'keyword', id: t.id }, log);
    return fired;
  }).then(async (fired) => {
    // A keyword consequence may satisfy a state trigger (e.g. an accusation flag).
    const more = await runWorldTriggers(ctx, { kind: 'action', action: 'trigger_keyword' });
    return more.length > 0 ? { ...fired, cascade: more } : fired;
  });
}

/* ────────────────────────────────────────────────────────────────────────────
 * 6. Hidden hp — a roll's declared harm
 * ──────────────────────────────────────────────────────────────────────────── */

export interface HarmApplied {
  severity: HarmSeverity;
  /** hp lost (never shown to the player; the prose band is). */
  amount: number;
  path: string;
}

/**
 * A resolved roll whose band declares `harm: light | serious | grave` lowers
 * `player.hp` — only in a world with endings whose player README declares `hp`.
 * Once per card: the card keeps a `harm_receipt`.
 */
export async function applyRollHarm(
  ctx: ActionContext,
  roll: { path: string; result: number; grade?: string | null },
): Promise<HarmApplied | null> {
  try {
    const raw = JSON.parse(await ctx.store.readFile('world.json')) as { mode?: unknown };
    if (!modeHasEndings(raw.mode)) return null;
    const player = await readStateFile(ctx.store, 'player/README.md');
    const hp = player?.states.find((s) => s.id === 'hp' && s.type === 'number');
    if (!hp) return null;
    const parsed = parseFrontmatter(await ctx.store.readFile(roll.path));
    const fm = parsed.frontmatter;
    if (!fm || !Array.isArray(fm.dice_outcomes) || fm.harm_receipt !== undefined) return null;
    // A skill check picks its band by grade, and
    // only the protagonist's own check can hurt the protagonist.
    const skill = skillCheckOf(fm);
    if (skill && skill.actor !== 'player') return null;
    const byGrade = skill && roll.grade ? bandIndexOfGrade(fm, roll.grade as CheckGrade) : -1;
    const band = skill ? (byGrade >= 0 ? (fm.dice_outcomes as Array<{ harm?: unknown }>)[byGrade] : undefined) : (fm.dice_outcomes as unknown[]).find(
      (b): b is { min: number; max: number; harm?: unknown } =>
        isPlainObject(b) && typeof b.min === 'number' && typeof b.max === 'number' && roll.result >= b.min && roll.result <= b.max,
    );
    const severity = band?.harm;
    if (typeof severity !== 'string' || !(HARM_SEVERITIES as readonly string[]).includes(severity)) return null;
    const amount = harmAmount(hp, severity as HarmSeverity);
    // Receipt first, so a retry never wounds twice.
    await ctx.store.writeFileAtomic(
      roll.path,
      stringifyFrontmatter({ ...fm, harm_receipt: { severity, turn: ctx.turn ?? null } }, parsed.body),
    );
    await writeState(ctx, { target: 'player', state: 'hp', by: -amount });
    return { severity: severity as HarmSeverity, amount, path: roll.path };
  } catch {
    return null;
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * 7. The ActionService hook
 * ──────────────────────────────────────────────────────────────────────────── */

/** Actions that cannot change anything a trigger reads. */
const READ_ONLY: ReadonlySet<string> = new Set([
  'lookAt',
  'viewCanvas',
  'getComponent',
  'showComponent',
  'linkCards',
  'arrangeCards',
  'arrangeCanvas',
  'generateImage',
  'noteCharacterTalked',
  'recordLayerInitialized',
  'recordLayerInitFailed',
  'snapshotWorld',
  'rollbackWorld',
]);

function bandOf(details: Record<string, unknown>): TriggerDiceBand | null {
  const convention = diceConventionOf(details.dice, details.expect);
  const result = typeof details.result === 'number' ? details.result : NaN;
  if (!convention || !Number.isFinite(result)) return null;
  return diceGradeOf(convention, result) as TriggerDiceBand | null;
}

/** The cause an action result describes. */
export function causeOfAction(name: string, input: ActionInput, result: ActionResult): TriggerCause {
  const d = (result?.details ?? {}) as Record<string, unknown>;
  if (name === 'rollDice' && typeof d.path === 'string' && typeof d.result === 'number') {
    // A d100 roll-under counts 96+ as a fumble and 1–12 as a crit (the convention's bands).
    const skillGrade = (d.skill as { grade?: unknown } | undefined)?.grade;
    const band = typeof skillGrade === 'string' ? (skillGrade as TriggerDiceBand) : bandOf(d);
    return {
      kind: 'roll',
      path: d.path,
      layer: typeof d.layer === 'string' ? d.layer : null,
      result: d.result,
      passed: d.passed === true,
      crit: d.crit === true || band === 'great',
      fumble: d.fumble === true || (band === 'failure' && d.dice === '1d100' && typeof skillGrade !== 'string'),
      band,
    };
  }
  if (name === 'enterLayer') {
    const layer = typeof d.layer === 'string' ? d.layer : typeof input.layer === 'string' ? input.layer : null;
    if (layer) return { kind: 'enter', layer };
  }
  return { kind: 'action', action: name };
}

registerActionHook({
  async before(name: ActionMethodName, ctx: ActionContext, input: ActionInput) {
    if (name === 'editEntity') await assertStateWriteAllowed(ctx, input);
  },
  async after(name: ActionMethodName, ctx: ActionContext, input: ActionInput, result: ActionResult) {
    if (READ_ONLY.has(name) || (ctx.commandDepth ?? 0) > 0) return result;
    const cause = causeOfAction(name, input, result);
    const harm = cause.kind === 'roll' ? await applyRollHarm(ctx, { path: cause.path, result: cause.result, grade: cause.band }) : null;
    // The four tiers: the card's declared cost /
    // bonus lands now, and the record feeds the ceremony chip and the card badge.
    const d = (result?.details ?? {}) as Record<string, any>;
    const consequence = cause.kind === 'roll' && isOutcomeTier(d.outcome)
      ? await recordRollConsequence(ctx, {
        path: cause.path,
        layer: cause.layer,
        outcome: d.outcome,
        harm: !!harm,
        sanityLoss: typeof d.skill?.sanityLoss === 'number' ? d.skill.sanityLoss : undefined,
        commands: d.commands,
        skillActor: typeof d.skill?.actor === 'string' ? d.skill.actor : null,
      })
      : null;
    const fired = await runWorldTriggers(ctx, cause);
    if (!harm && !consequence && fired.length === 0) return result;
    return {
      ...result,
      details: { ...result.details, ...(harm ? { harm: { severity: harm.severity } } : {}), ...(consequence ? { consequence } : {}), ...(fired.length ? { triggers: fired } : {}) },
    };
  },
});
