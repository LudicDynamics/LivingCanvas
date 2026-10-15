/**
 * A living world — the engine. Data: world.json
 * `living` (`schemas/living.ts`); pure clock / calendar / schedule math:
 * `rules/living.ts`; the running clock: `world/README.md` `living`
 * (`living-state.ts`).
 *
 * Time moves three ways, and nothing else moves it:
 *   1. each of the player's own actions takes `pace.perAction` world minutes
 *      (the ActionService `after` hook below);
 *   2. a world command's `pass_time` effect (an activity that takes an
 *      afternoon, sleeping until morning) — `passTime`;
 *   3. real time between sessions, capped (`catchUpLivingWorld`, called by the
 *      server when a save is opened).
 *
 * Whenever the clock has moved past `settled`, `settleLivingWorld` brings the
 * world up to date, in one cheap, deterministic, model-free pass:
 *   a. every new day's overnight rules (`daily`) for each resident, seeded —
 *      the result lands as ordinary declared-state writes (one per state);
 *   b. `settled` is recorded (before anything with side effects, so a crash
 *      never applies a day twice);
 *   c. residents walk to where their schedule (or a gathering event) puts
 *      them — through `moveCharacter`, the one presence write path; a resident
 *      following the player stays with the player;
 *   d. scene pictures with variants switch through `swapBackground` — unless
 *      the story already swapped that layer to a picture of its own;
 *   e. the world's triggers are evaluated (`time.*` / `events.*` conditions),
 *      so festivals and arrivals are ordinary triggers running ordinary commands.
 *
 * Contract: the hook and `settleLivingWorld` never throw — the action that
 * caused them has already committed. Story and free worlds get no forced
 * costs from any of this: overnight rules are the author's, and nothing here
 * spends, decays or takes away by itself.
 */
import type { ActionContext, ActionResult } from './types.js';
import type { Actor } from './actor.js';
import { ActionError } from './errors.js';
import { registerActionHook, type ActionInput, type ActionMethodName } from './service.js';
import { moveCharacter } from './move-to.js';
import { swapBackground } from './scene-media.js';
import { recordStoryEvent } from './story-event.js';
import { readStateFile, writeState } from './states.js';
import { mappedStates, clampState, currentStateValue, type MappedState, type StateValue } from '../rules/states.js';
import { parseFrontmatter } from '../schemas/frontmatter.js';
import type { LivingWorld } from '../schemas/living.js';
import type { WorldStore } from '../store/world-store.js';
import {
  awayLine,
  catchUpMinutes,
  dailyOutcome,
  dayOfMinute,
  eventLabel,
  eventsOnDay,
  formatLivingNow,
  hashKey,
  rollOf,
  livingNow,
  minutesUntilPhase,
  phaseLabel,
  residentPlace,
  startMinute,
  variantBackground,
  weatherLabel,
  weatherOf,
  dateOf,
  seasonLabel,
  weekdayLabel,
  MINUTES_PER_DAY,
  type LivingCondition,
  type LivingNow,
} from '../rules/living.js';
import { loadLivingWorld, readLivingState, writeLivingState, type LivingAway, type LivingState, type LivingWorldFile } from './living-state.js';
import { collectHasPaths, evaluateCondition, type ConditionAst } from '../commands/condition.js';
import { withSourceLock } from '../commands/serial.js';
import { loadTriggerWorld, parseTriggerCondition, rearmTimeTriggers, runWorldTriggers, snapshotTriggerWorld, type FiredTrigger } from '../commands/world-triggers.js';

export * from './living-state.js';

const LOCK_KEY = 'living';
/** A real-time stamp older than this is refreshed after an action (between-session catch-up reads it). */
const STAMP_EVERY_MS = 5 * 60 * 1000;
/** The digest remembers at most this many days (the most recent ones). */
const DIGEST_DAYS = 7;
/** Settling can let a trigger's command pass time again; this bounds the loop. */
const MAX_SETTLE_PASSES = 3;

const nowIso = (ctx: Pick<ActionContext, 'now'>): string => (ctx.now ?? (() => new Date().toISOString()))();
const engineCtx = (ctx: ActionContext): ActionContext => ({ ...ctx, actor: { type: 'engine' } as Actor });

/* ────────────────────────────── the record ────────────────────────────── */

/** The save's clock, started on first read (start minute, a seed fixed for this save, now). */
async function ensureState(store: WorldStore, world: LivingWorldFile, at: string): Promise<LivingState> {
  const existing = await readLivingState(store);
  if (existing) return existing;
  const minute = startMinute(world.living);
  const root = String((store as { worldRoot?: unknown }).worldRoot ?? world.id);
  const state: LivingState = {
    minute,
    settled: minute,
    seed: world.living.seed ?? hashKey(root.split(/[\\/]/).pop() || world.id),
    real_at: at,
  };
  await writeLivingState(store, state);
  return state;
}

/** The living world's "now", or null when the world is not a living one. */
export async function readLivingNow(store: WorldStore): Promise<{ world: LivingWorldFile; state: LivingState; now: LivingNow } | null> {
  const world = await loadLivingWorld(store);
  if (!world) return null;
  const state = await readLivingState(store);
  const minute = state?.minute ?? startMinute(world.living);
  const seed = state?.seed ?? world.living.seed ?? 0;
  return { world, state: state ?? { minute, settled: minute, seed, real_at: '' }, now: livingNow(world.living, seed, minute) };
}

/* ─────────────────────────── conditions (`if:`) ─────────────────────────── */

/** Every `if:` the living block declares — their `has()` paths are resolved once per settle. */
function livingConditions(living: LivingWorld): string[] {
  const out: string[] = [];
  for (const r of Object.values(living.residents ?? {})) for (const e of r.schedule) if (e.if) out.push(e.if);
  for (const v of Object.values(living.variants ?? {})) for (const w of v.when) if (w.if) out.push(w.if);
  return out;
}

/** A condition callback over the world as it is now (states, `time.*`, `events.*`). */
async function conditionFor(store: WorldStore, living: LivingWorld): Promise<LivingCondition> {
  const exprs = livingConditions(living);
  if (exprs.length === 0) return () => false;
  const world = await loadTriggerWorld(store);
  if (!world) return () => false;
  const snap = await snapshotTriggerWorld(store, world);
  const paths = new Map(snap.paths);
  const cache = new Map<string, boolean>();
  for (const expr of exprs) {
    const parsed = parseTriggerCondition(expr, world.characterIds);
    if (!parsed.ok) continue;
    for (const p of collectHasPaths(parsed.value as ConditionAst)) if (!paths.has(p)) paths.set(p, await store.statKind(p));
  }
  return (expr: string) => {
    const hit = cache.get(expr);
    if (hit !== undefined) return hit;
    const parsed = parseTriggerCondition(expr, world.characterIds);
    const r = parsed.ok ? evaluateCondition(parsed.value, { values: snap.values, paths }) : null;
    const holds = Boolean(r && r.ok && r.value);
    cache.set(expr, holds);
    return holds;
  };
}

/* ───────────────────────────── settling ───────────────────────────── */

export interface LivingSettleResult {
  from: number;
  to: number;
  /** New days begun (their overnight rules applied). */
  days: number[];
  /** Residents who walked somewhere. */
  moved: Array<{ character: string; from: string | null; to: string }>;
  /** Layers whose picture changed. */
  swapped: Array<{ layer: string; path: string }>;
  /** Declared states the overnight rules changed (final values only). */
  drift: Array<{ character: string; state: string; value: StateValue }>;
  fired: FiredTrigger[];
}

/**
 * Overnight rules over `days`, folded in memory so each state is written once
 * with its final value (a three-day absence is three nights, one write).
 */
async function applyDailyRules(ctx: ActionContext, world: LivingWorldFile, seed: number, days: number[]): Promise<LivingSettleResult['drift']> {
  const drift: LivingSettleResult['drift'] = [];
  if (days.length === 0) return drift;
  for (const [id, resident] of Object.entries(world.living.residents ?? {})) {
    if (!resident.daily?.length) continue;
    const file = await readStateFile(ctx.store, `characters/${id}/README.md`);
    if (!file) continue;
    const values = new Map<string, StateValue>();
    for (const decl of file.states) values.set(decl.id, currentStateValue(decl, file.data));
    const touched = new Set<string>();
    for (const day of days) {
      resident.daily.forEach((rule, index) => {
        const decl = file.states.find((s) => s.id === rule.state);
        if (!decl) return;
        const outcome = dailyOutcome(rule, seed, day, id, index);
        if (!outcome) return;
        const before = values.get(decl.id)!;
        let next: StateValue;
        if ('by' in outcome) {
          if (decl.type !== 'number' || typeof before !== 'number') return;
          next = clampState(decl, before + outcome.by);
        } else {
          if (decl.type === 'enum' && !(decl.values ?? []).includes(String(outcome.value))) return;
          if (decl.type === 'flag' && typeof outcome.value !== 'boolean') return;
          if (decl.type === 'number' && typeof outcome.value !== 'number') return;
          next = decl.type === 'number' ? clampState(decl, outcome.value as number) : outcome.value;
        }
        values.set(decl.id, next);
        touched.add(decl.id);
      });
    }
    for (const stateId of touched) {
      try {
        const r = await writeState(engineCtx(ctx), { target: `characters/${id}`, state: stateId, value: values.get(stateId) });
        if (!r.unchanged) drift.push({ character: id, state: stateId, value: r.value });
      } catch {
        // A malformed declaration only drops this rule's change.
      }
    }
  }
  return drift;
}

/** Residents to where they belong now. A follower stays with the player. */
async function placeResidents(ctx: ActionContext, world: LivingWorldFile, now: LivingNow, cond: LivingCondition): Promise<LivingSettleResult['moved']> {
  const moved: LivingSettleResult['moved'] = [];
  for (const c of world.characters) {
    if (!world.living.residents?.[c.id]) continue;
    const row = ctx.store.getPresenceOf(c.id);
    if (row?.following) continue;
    const place = residentPlace(world.living, c.id, now, c.home, cond);
    if (row && row.layer === place.layer) continue;
    try {
      const r = await moveCharacter(engineCtx(ctx), { character: c.id, destination: place.layer });
      if (r.details.moved) moved.push({ character: c.id, from: row?.layer ?? null, to: place.layer });
    } catch {
      // A missing place only keeps this resident where they were.
    }
  }
  return moved;
}

/** Scene pictures to the variant that holds now — never over a picture the story chose. */
async function swapVariants(ctx: ActionContext, world: LivingWorldFile, now: LivingNow, cond: LivingCondition): Promise<LivingSettleResult['swapped']> {
  const swapped: LivingSettleResult['swapped'] = [];
  for (const [layer, variant] of Object.entries(world.living.variants ?? {})) {
    const readme = layer === 'map' ? 'world/README.md' : `${layer}/README.md`;
    try {
      if ((await ctx.store.statKind(readme)) !== 'file') continue;
      const bg = parseFrontmatter(await ctx.store.readFile(readme)).frontmatter?.bg;
      const known = new Set([variant.base, ...variant.when.map((w) => w.bg)]);
      if (typeof bg === 'string' && bg && !known.has(bg)) continue;
      const want = variantBackground(variant, now, cond);
      if (bg === want) continue;
      const r = await swapBackground(engineCtx(ctx), { layer, path: want });
      if (!r.reused) swapped.push({ layer, path: want });
    } catch {
      // A picture not painted yet keeps the current one.
    }
  }
  return swapped;
}

async function settleLocked(ctx: ActionContext, world: LivingWorldFile, opts: { force?: boolean }): Promise<LivingSettleResult | null> {
  const result: LivingSettleResult = { from: 0, to: 0, days: [], moved: [], swapped: [], drift: [], fired: [] };
  for (let pass = 0; pass < MAX_SETTLE_PASSES; pass += 1) {
    const state = await ensureState(ctx.store, world, nowIso(ctx));
    if (state.minute === state.settled && !(opts.force && pass === 0)) break;
    if (pass === 0) result.from = state.settled;
    result.to = state.minute;
    // a. new days (a rollback can move the clock back: no day is then re-applied)
    const days: number[] = [];
    for (let d = dayOfMinute(state.settled) + 1; d <= dayOfMinute(state.minute); d += 1) days.push(d);
    result.days.push(...days);
    result.drift.push(...await applyDailyRules(ctx, world, state.seed, days));
    // b. settled first: nothing below is applied twice after a crash
    await writeLivingState(ctx.store, { ...state, settled: state.minute });
    // c–d. residents and pictures, against the world as it is now
    const now = livingNow(world.living, state.seed, state.minute);
    const cond = await conditionFor(ctx.store, world.living);
    result.moved.push(...await placeResidents(ctx, world, now, cond));
    result.swapped.push(...await swapVariants(ctx, world, now, cond));
    // e. time-dependent triggers (festivals, arrivals): ordinary triggers; a
    // new day re-arms the ones bound to the calendar
    if (days.length > 0) await rearmTimeTriggers(ctx.store);
    const fired = await runWorldTriggers(engineCtx(ctx), { kind: 'action', action: 'pass_time' });
    result.fired.push(...fired);
    // A consequence may change what a schedule's `if:` reads (the newcomer came
    // ashore): place residents and pictures once more against the new states.
    if (fired.length > 0) {
      const after = await conditionFor(ctx.store, world.living);
      result.moved.push(...await placeResidents(ctx, world, now, after));
      result.swapped.push(...await swapVariants(ctx, world, now, after));
    }
  }
  return result;
}

/**
 * Bring a living world up to date with its clock. `force` re-checks residents
 * and pictures even when the clock has not moved (a save just opened).
 * Never throws; null when the world is not a living one or settling failed.
 */
export async function settleLivingWorld(ctx: ActionContext, opts: { force?: boolean } = {}): Promise<LivingSettleResult | null> {
  try {
    const world = await loadLivingWorld(ctx.store);
    if (!world) return null;
    return await withSourceLock(ctx.store, LOCK_KEY, () => settleLocked(ctx, world, opts));
  } catch {
    return null;
  }
}

/* ───────────────────────────── passing time ───────────────────────────── */

export interface PassTimeInput {
  /** World minutes to pass. */
  minutes?: number;
  /** Or: until the next start of this phase (`morning` after a night's sleep). */
  until?: string;
}

/**
 * Move the clock forward (the `pass_time` effect). Only the clock: the world
 * catches up when the action that caused it settles (the hook below).
 * Throws `invalid_argument` in a world without `living`, or for a bad amount.
 */
export async function passTime(ctx: ActionContext, input: PassTimeInput): Promise<{ from: number; to: number }> {
  const world = await loadLivingWorld(ctx.store);
  if (!world) throw new ActionError({ code: 'invalid_argument', message: 'pass_time: this world has no living clock (world.json living).' });
  return withSourceLock(ctx.store, LOCK_KEY, async () => {
    const state = await ensureState(ctx.store, world, nowIso(ctx));
    let minutes: number | null;
    if (input.until !== undefined) {
      minutes = minutesUntilPhase(world.living, state.minute, String(input.until));
      if (minutes === null) throw new ActionError({ code: 'invalid_argument', message: `pass_time: no phase "${String(input.until)}" (phases: ${world.living.phases.map((p) => p.id).join(', ')})` });
    } else {
      minutes = Number(input.minutes);
      if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 30 * MINUTES_PER_DAY) {
        throw new ActionError({ code: 'invalid_argument', message: `pass_time: minutes must be between 1 and ${30 * MINUTES_PER_DAY}, got ${JSON.stringify(input.minutes)}` });
      }
      minutes = Math.round(minutes);
    }
    const to = state.minute + minutes;
    await writeLivingState(ctx.store, { ...state, minute: to, real_at: nowIso(ctx) });
    return { from: state.minute, to };
  });
}

/* ──────────────────────── between sessions ──────────────────────── */

/** The off-screen days' facts, in the edition's words (no model). */
function awayFacts(world: LivingWorldFile, seed: number, from: number, to: number): string[] {
  const living = world.living;
  const first = dayOfMinute(from);
  const last = dayOfMinute(to);
  const facts: string[] = [];
  const startDay = Math.max(first, last - DIGEST_DAYS + 1);
  for (let day = startDay; day <= last; day += 1) {
    const d = dateOf(living, day);
    const parts: string[] = [];
    const weather = weatherLabel(living, weatherOf(living, seed, day));
    const events = eventsOnDay(living, seed, day).map((e) => eventLabel(living, e.id));
    const head = [seasonLabel(living, d.season), `${d.day}`, weekdayLabel(living, d.weekday), weather].filter(Boolean).join(' · ');
    if (events.length) parts.push(events.join(' / '));
    const ids = Object.keys(living.residents ?? {});
    const who = ids.length ? ids[Math.floor(rollOf(seed, 'who', day) * ids.length)]! : null;
    const line = who ? awayLine(living.residents?.[who], seed, day, who) : null;
    if (line) parts.push(line);
    if (parts.length) facts.push(`[${head}] ${parts.join(' — ')}`);
  }
  return facts;
}

export interface LivingCatchUp {
  /** World minutes that passed for the absence (0 for a reload or a first visit). */
  minutes: number;
  realMs: number;
  settle: LivingSettleResult | null;
  /** Present when the absence earned a digest that has not been delivered yet. */
  away: LivingAway | null;
}

/**
 * A save was opened: let the time the player was away pass (capped), settle
 * the world, and keep the absence's facts for one digest. Never throws.
 */
export async function catchUpLivingWorld(ctx: ActionContext): Promise<LivingCatchUp | null> {
  try {
    const world = await loadLivingWorld(ctx.store);
    if (!world) return null;
    const at = nowIso(ctx);
    const begun = await withSourceLock(ctx.store, LOCK_KEY, async () => {
      const fresh = (await readLivingState(ctx.store)) === null;
      const state = await ensureState(ctx.store, world, at);
      const realMs = fresh || !state.real_at ? 0 : Date.parse(at) - Date.parse(state.real_at);
      const minutes = catchUpMinutes(world.living, realMs);
      const next: LivingState = { ...state, minute: state.minute + minutes, real_at: at };
      const digest = world.living.digest;
      if (minutes > 0 && digest && minutes >= (digest.minHours ?? 6) * 60) {
        next.away = { from: state.minute, to: next.minute, realMs: Math.max(0, realMs), facts: awayFacts(world, state.seed, state.minute, next.minute), delivered: null };
      }
      await writeLivingState(ctx.store, next);
      return { minutes, realMs: Math.max(0, realMs), away: next.away && next.away.delivered === null && minutes > 0 ? next.away : null };
    });
    const settle = await settleLivingWorld(ctx, { force: true });
    return { ...begun, settle };
  } catch {
    return null;
  }
}

/**
 * Claim the pending digest for one delivery (`writer` or `template`). At most
 * once per absence: a second caller, a reload or a retry gets null.
 */
export async function claimAwayDigest(store: WorldStore, mode: 'writer' | 'template'): Promise<LivingAway | null> {
  try {
    return await withSourceLock(store, LOCK_KEY, async () => {
      const state = await readLivingState(store);
      if (!state?.away || state.away.delivered !== null) return null;
      const away = { ...state.away, delivered: mode };
      await writeLivingState(store, { ...state, away });
      return away;
    });
  } catch {
    return null;
  }
}

/** The span of an absence in the edition's own words: `{from} → {to}`. */
function spanText(world: LivingWorldFile, seed: number, away: LivingAway): { from: string; to: string; days: number } {
  return {
    from: formatLivingNow(world.living, livingNow(world.living, seed, away.from)),
    to: formatLivingNow(world.living, livingNow(world.living, seed, away.to)),
    days: dayOfMinute(away.to) - dayOfMinute(away.from),
  };
}

/** The ONE writer turn of a return: facts in, one short chalk out. */
export function awayDigestPrompt(world: LivingWorldFile, seed: number, away: LivingAway): string {
  const span = spanText(world, seed, away);
  const title = world.living.digest?.title ?? 'While you were away';
  return [
    `[World Event] The player has come back. While they were away the world went on without them: ${span.from} → ${span.to} (${span.days} day${span.days === 1 ? '' : 's'}).`,
    'What happened off-screen, as facts (use only these; invent no new consequences, items or relationships):',
    ...(away.facts.length ? away.facts.map((f) => `- ${f}`) : ['- (an ordinary stretch of days; nothing remarkable)']),
    `Write ONE short chalk titled ${JSON.stringify(title)} where the player is now: 3–5 sentences in the world's language, a warm "while you were away" recap that ends on what is happening right now. The engine has already moved the residents and changed the day; do not move anyone, change any state or pass time.`,
  ].join('\n');
}

/**
 * Deliver the digest in the engine's own words — no model (the writer is off,
 * not wanted, or its turn could not start). `claimed`: a digest the caller
 * already claimed for the writer, landing here as its fallback.
 */
export async function deliverAwayDigestAsEvent(ctx: ActionContext, claimed?: LivingAway): Promise<boolean> {
  const world = await loadLivingWorld(ctx.store);
  if (!world) return false;
  const away = claimed ?? await claimAwayDigest(ctx.store, 'template');
  if (!away) return false;
  const state = await readLivingState(ctx.store);
  const span = spanText(world, state?.seed ?? 0, away);
  let target = 'map';
  try {
    target = ctx.store.readViewpoint()?.layer ?? 'map';
  } catch {
    // no viewpoint yet
  }
  try {
    await recordStoryEvent(engineCtx(ctx), {
      target,
      title: world.living.digest?.title ?? 'While you were away',
      text: [`${span.from} → ${span.to}`, ...away.facts].join('\n').slice(0, 1900),
    });
    return true;
  } catch {
    return false;
  }
}

/* ─────────────────────────── what agents and panels see ─────────────────────────── */

/** "Now" for the world panel and the writer: the display line, today's events. */
export function livingNowText(world: LivingWorldFile, now: LivingNow): { line: string; today: string[] } {
  return {
    line: formatLivingNow(world.living, now),
    today: now.today.map((id) => {
      const e = world.living.events?.find((x) => x.id === id);
      const when = e?.phases?.length ? ` (${e.phases.map((p) => phaseLabel(world.living, p)).join('–')})` : '';
      return `${eventLabel(world.living, id)}${when}`;
    }),
  };
}

/** What a resident is doing right now (schedule text), for panels and agents. */
async function residentsNow(store: WorldStore, world: LivingWorldFile, now: LivingNow): Promise<Array<{ id: string; name: string; layer: string | null; text: string | null; following: boolean }>> {
  const cond = await conditionFor(store, world.living);
  return world.characters
    .filter((c) => world.living.residents?.[c.id])
    .map((c) => {
      const row = store.getPresenceOf(c.id);
      const place = residentPlace(world.living, c.id, now, c.home, cond);
      // The schedule's words only when they are where the schedule says.
      const here = row?.layer ?? null;
      return { id: c.id, name: c.name, layer: here, text: here === place.layer ? place.text : null, following: Boolean(row?.following) };
    });
}

async function layerName(store: WorldStore, layer: string | null): Promise<string> {
  if (!layer) return '';
  const readme = layer === 'map' ? 'world/README.md' : `${layer}/README.md`;
  try {
    const fm = parseFrontmatter(await store.readFile(readme)).frontmatter ?? {};
    return typeof fm.name === 'string' ? fm.name : typeof fm.title === 'string' ? fm.title : layer;
  } catch {
    return layer;
  }
}

/** The world / character panel lines (`GET /api/world/panels`): prose only, never a number of the engine's. */
export async function livingPanelLines(store: WorldStore): Promise<{ world: MappedState[]; characters: Record<string, MappedState[]> } | null> {
  try {
    const r = await readLivingNow(store);
    if (!r) return null;
    const text = livingNowText(r.world, r.now);
    const world: MappedState[] = [{ id: 'living-now', label: r.world.living.display.label, text: text.line }];
    if (text.today.length) world.push({ id: 'living-today', label: r.world.living.display.label, text: text.today.join(' / ') });
    const characters: Record<string, MappedState[]> = {};
    for (const p of await residentsNow(store, r.world, r.now)) {
      if (p.text) characters[p.id] = [{ id: 'living-doing', label: r.world.living.display.label, text: p.text }];
    }
    return { world, characters };
  } catch {
    return null;
  }
}

/**
 * The per-turn context block (extensions/context.ts): the writer sees the
 * clock and every resident; a character sees the clock and where they are.
 * '' when the world is not a living one. Reads only; never throws.
 */
export async function livingContextBlock(store: WorldStore, reader: { type: 'writer' } | { type: 'character'; id: string }): Promise<string> {
  try {
    const r = await readLivingNow(store);
    if (!r) return '';
    const text = livingNowText(r.world, r.now);
    const people = await residentsNow(store, r.world, r.now);
    if (reader.type === 'character') {
      const me = people.find((p) => p.id === reader.id);
      return [
        '[Now — the world keeps its own time]',
        `${text.line}${text.today.length ? `. Today: ${text.today.join(' / ')}` : ''}.`,
        ...(me ? [`You are at ${await layerName(store, me.layer)}${me.text ? ` — ${me.text}` : ''}.`] : []),
        'Live in this hour: speak of what you are doing now and what the day holds. Never say that time jumps.',
      ].join('\n');
    }
    const lines: string[] = [];
    for (const p of people) {
      const moods: string[] = [];
      try {
        const fm = parseFrontmatter(await store.readFile(`characters/${p.id}/README.md`)).frontmatter ?? {};
        for (const s of mappedStates(fm)) moods.push(`${s.label}: ${s.text}`);
      } catch {
        // no README: no mood line
      }
      lines.push(`- ${p.name} (${p.id}): ${await layerName(store, p.layer)}${p.text ? ` — ${p.text}` : ''}${p.following ? ' (with the player)' : ''}${moods.length ? `; ${moods.join('; ')}` : ''}`);
    }
    // Tomorrow's weather is already decided (seeded); a weather-wise character may foretell it.
    const tomorrow = weatherLabel(r.world.living, weatherOf(r.world.living, r.state.seed, r.now.day + 1));
    return [
      '[The living world — it keeps its own time]',
      `Now: ${text.line}${text.today.length ? `. Today: ${text.today.join(' / ')}` : ''}.`,
      ...(tomorrow ? [`Tomorrow's weather: ${tomorrow} (let only a weather-wise character foretell it, in their own words — never as a forecast).`] : []),
      ...(lines.length ? ['Residents right now (the engine walks them by their schedules; never move one to suit a scene — only when the player asks someone to come along):', ...lines] : []),
      'Time passes only through the engine: each of the player\'s actions, and pass_time in world commands. Never announce that hours or days go by; let the light, the tide and the people show the hour. Nothing decays or costs the player by itself here.',
    ].join('\n');
  } catch {
    return '';
  }
}

/* ─────────────────────────── the ActionService hook ─────────────────────────── */

/** Actions that cannot move the clock (reading, layout, bookkeeping, history). */
const NO_TIME: ReadonlySet<string> = new Set([
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
  'setMusic',
]);

registerActionHook({
  async after(name: ActionMethodName, ctx: ActionContext, _input: ActionInput, result: ActionResult) {
    if (NO_TIME.has(name) || (ctx.commandDepth ?? 0) > 0) return result;
    const world = await loadLivingWorld(ctx.store).catch(() => null);
    if (!world) return result;
    const perAction = world.living.pace?.perAction ?? 0;
    try {
      await withSourceLock(ctx.store, LOCK_KEY, async () => {
        const at = nowIso(ctx);
        const state = await ensureState(ctx.store, world, at);
        // The player's own step takes a little time — unless this action
        // already passed time itself (a command's pass_time).
        const step = ctx.actor.type === 'player' && perAction > 0 && state.minute === state.settled ? perAction : 0;
        const stale = !state.real_at || Date.parse(at) - Date.parse(state.real_at) > STAMP_EVERY_MS;
        if (step > 0 || stale) await writeLivingState(ctx.store, { ...state, minute: state.minute + step, real_at: at });
      });
    } catch {
      return result;
    }
    const settled = await settleLivingWorld(ctx);
    if (!settled || settled.from === settled.to) return result;
    const r = await readLivingNow(ctx.store).catch(() => null);
    const prior = Array.isArray(result.details?.triggers) ? result.details.triggers : [];
    return {
      ...result,
      details: {
        ...result.details,
        living: {
          ...(r ? { now: livingNowText(r.world, r.now).line, day: r.now.day, phase: r.now.phase } : {}),
          days: settled.days.length,
          moved: settled.moved.map((m) => m.character),
          swapped: settled.swapped.map((s) => s.layer),
        },
        ...(settled.fired.length ? { triggers: [...prior, ...settled.fired] } : {}),
      },
    };
  },
});

