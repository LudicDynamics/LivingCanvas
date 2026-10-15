/**
 * The inspiration roll — the action.
 *
 * `POST /api/inspiration` (the player, from the character sheet): check the
 * world has skill rules and the roll is allowed now (rules/inspiration.ts
 * `inspirationGate`), roll the inspiration number (or the world's chosen sheet
 * skill) with the world's rules, and turn the tier into a hint:
 *
 *   great / success → a written hints.json line that holds now (+ its slips); nothing written → a
 *                     place the player has not been yet, or "go over what you hold"
 *   setback         → a vague line; the written hint is not used up
 *   failure         → no hint; the world's small cost (or, in a story / free world, a longer wait)
 *
 * The line is recorded as a story event on the player's page (`inspiration:`), so
 * the writer and whoever stands there read it next turn; the success's hint is
 * marked used in `hint_log` so the companion does not repeat it. No model call.
 */
import { parseFrontmatter, stringifyFrontmatter } from '../schemas/frontmatter.js';
import { checkSpec, naturalOfTotal, resolveCheck, rollCheck, type CheckGrade } from '../rules/skills.js';
import { outcomeOfRoll, diceConsequencesOf, diceCategoryOf, type OutcomeTier } from '../rules/outcome-tiers.js';
import { HINTS_FILE, HINT_LOG_KEY, hintPathsOf, parseHintLog, parseHintTable, spentHintIds, type HintSuggest, type HintTable } from '../rules/hints.js';
import {
  INSPIRATION_LOG_KEY,
  INSPIRATION_DEFAULT_VALUE,
  inspirationConfigOf,
  inspirationGate,
  inspirationLabel,
  inspirationWords,
  parseInspirationLog,
  pickInspiration,
  type InspirationGate,
  type InspirationLog,
} from '../rules/inspiration.js';
import { loadTriggerWorld, snapshotTriggerWorld } from '../commands/world-triggers.js';
import { optionStatesOf } from './option-state.js';
import { clockLeft, reachedEnding } from './closed-world-state.js';
import { recordStoryEvent } from './story-event.js';
import { readSheet, resolveSkill, rulesOfWorld } from './skill-cards.js';
import { applyFirstEffect, type AppliedConsequence } from './dice-consequence.js';
import { eventsThisLoop } from './loop-history.js';
import { fail } from './errors.js';
import type { TutorialCueId } from '../rules/tutorial-cues.js';
import type { ActionContext, ActionResult } from './types.js';

const README = 'world/README.md';
const PAGE_RE = /^(map|world\/[A-Za-z0-9_/-]+)$/;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export interface InspirationInput {
  /** The page the player is looking at (the page's own report). */
  page?: string | null;
  /** god only: force the d100 / total (tests, god mode). */
  forcedResult?: number;
}

export type InspirationDetails = {
  label: string;
  system: 'coc' | 'dnd';
  /** The sheet skill used, when the world chose one. */
  skill?: string;
  target: number;
  value: number;
  result: number;
  rolls: number[];
  grade: CheckGrade;
  outcome: OutcomeTier;
  /** What the player reads. */
  say: string;
  /** The written hint it reached (great / success / setback), if any. */
  hint?: string;
  suggest: HintSuggest[];
  /** A fumble's cost, when one landed. */
  cost?: AppliedConsequence;
  /** Rolls left this loop, and when the next one is allowed. */
  status: InspirationStatus;
  cue?: TutorialCueId;
};

export interface InspirationStatus {
  enabled: boolean;
  label: string;
  /** coc %, dnd modifier. */
  value: number;
  system: 'coc' | 'dnd';
  gate: InspirationGate;
}

function viewpointLayer(ctx: ActionContext): string | null {
  try {
    return ctx.store.readViewpoint()?.layer ?? null;
  } catch {
    return null;
  }
}

async function readFm(ctx: ActionContext): Promise<{ fm: Record<string, unknown>; body: string } | null> {
  if ((await ctx.store.statKind(README)) !== 'file') return null;
  const parsed = parseFrontmatter(await ctx.store.readFile(README));
  return { fm: (parsed.frontmatter ?? {}) as Record<string, unknown>, body: parsed.body };
}

async function rawManifest(ctx: ActionContext): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await ctx.store.readFile('world.json')) as Record<string, unknown>;
  } catch {
    return (await ctx.store.getManifest()) as unknown as Record<string, unknown>;
  }
}

/** Player actions since an event seq (what the `actions` wait counts). */
async function actionsSince(ctx: ActionContext, seq: number | undefined): Promise<number> {
  const events = await eventsThisLoop(ctx.store);
  return events.filter((e) => e.actor?.type === 'player' && e.type !== 'story_event' && (seq === undefined || (typeof e.seq === 'number' && e.seq > seq))).length;
}

/** The roll's number: the world's chosen sheet skill, else coc 50 / dnd the sheet's INT. */
async function inspirationNumber(ctx: ActionContext): Promise<{ label: string; value: number; system: 'coc' | 'dnd'; skill?: string; enabled: boolean } | null> {
  const w = await rulesOfWorld(ctx.store);
  if (!w) return null;
  const cfg = inspirationConfigOf(await rawManifest(ctx));
  const label = cfg.label ?? inspirationLabel(w.locale);
  if (cfg.skill) {
    try {
      const r = await resolveSkill(ctx.store, w, 'player', cfg.skill);
      return { label: r.label, value: r.value, system: w.rules.system, skill: cfg.skill, enabled: cfg.enabled };
    } catch {
      // the skill is gone from the sheet: the plain number
    }
  }
  if (cfg.value !== undefined) return { label, value: cfg.value, system: w.rules.system, enabled: cfg.enabled };
  if (w.rules.system === 'coc') return { label, value: INSPIRATION_DEFAULT_VALUE, system: 'coc', enabled: cfg.enabled };
  const sheet = await readSheet(ctx.store, 'player', w.rules, w.locale).catch(() => null);
  return { label, value: sheet?.sheet.abilities?.int ?? 0, system: 'dnd', enabled: cfg.enabled };
}

/** Is a roll allowed now, and with what number? Read-only (the sheet shows it). Null: the world has no rules. */
export async function inspirationStatus(ctx: ActionContext): Promise<InspirationStatus | null> {
  const n = await inspirationNumber(ctx);
  if (!n) return null;
  const manifest = await rawManifest(ctx);
  const cfg = inspirationConfigOf(manifest);
  const log = parseInspirationLog((await readFm(ctx))?.fm[INSPIRATION_LOG_KEY]);
  const left = await clockLeft(ctx.store).catch(() => null);
  const gate = inspirationGate(cfg, log, { clockLeft: left, actionsSince: await actionsSince(ctx, log.last_seq) });
  return { enabled: n.enabled, label: n.label, value: n.value, system: n.system, gate };
}

async function spentHints(ctx: ActionContext, table: HintTable): Promise<Set<string>> {
  const cardPaths = new Set<string>();
  for (const h of table.hints) for (const s of h.suggest ?? []) if ('card' in s) cardPaths.add(s.card);
  const cards: { path: string; frontmatter: Record<string, unknown> | null }[] = [];
  for (const path of cardPaths) {
    if ((await ctx.store.statKind(path)) !== 'file') continue;
    try {
      cards.push({ path, frontmatter: (parseFrontmatter(await ctx.store.readFile(path)).frontmatter ?? null) as Record<string, unknown> | null });
    } catch { /* not done */ }
  }
  if (cards.length === 0) return new Set();
  const states = await optionStatesOf(ctx.store, cards).catch(() => ({} as Awaited<ReturnType<typeof optionStatesOf>>));
  return spentHintIds(table, (card, option) => states[card]?.done.includes(option) ?? false);
}

/** A place on the map the player has not entered this loop, with no lock on its door. */
async function unvisitedPlace(ctx: ActionContext, seen: ReadonlySet<string>): Promise<{ layer: string; name: string } | null> {
  const manifest = await ctx.store.getManifest();
  for (const [id, layer] of Object.entries(manifest.layers ?? {})) {
    if (id === 'map' || layer.parent !== 'map' || layer.stub || seen.has(id)) continue;
    const readme = `${id}/README.md`;
    if ((await ctx.store.statKind(readme)) !== 'file') continue;
    const fm = parseFrontmatter(await ctx.store.readFile(readme)).frontmatter ?? {};
    const requires = isObj(fm.requires) && Array.isArray(fm.requires.items) ? fm.requires.items : [];
    let locked = false;
    for (const item of requires) if (typeof item === 'string' && (await ctx.store.statKind(item)) !== 'file') locked = true;
    if (locked) continue;
    return { layer: id, name: layer.name ?? (typeof fm.name === 'string' ? fm.name : id) };
  }
  return null;
}

export async function inspire(ctx: ActionContext, input: InspirationInput = {}): Promise<ActionResult<InspirationDetails>> {
  const { store } = ctx;
  if (ctx.actor.type !== 'player' && ctx.actor.type !== 'god') fail('invalid_argument', 'The inspiration roll is the player’s');
  if (input.forcedResult !== undefined && ctx.actor.type !== 'god') fail('dice_forced_not_allowed', 'Only god mode may force a roll');
  const n = await inspirationNumber(ctx);
  if (!n) fail('unsupported', 'This world has no skill rules, so there is no inspiration roll');
  if (!n.enabled) fail('unsupported', 'This world turned the inspiration roll off');
  const manifestRaw = await rawManifest(ctx);
  const manifest = await store.getManifest();
  if (await reachedEnding(store, manifest)) fail('game_ended', 'The story has ended');
  const cfg = inspirationConfigOf(manifestRaw);
  const readme = await readFm(ctx);
  const ilog = parseInspirationLog(readme?.fm[INSPIRATION_LOG_KEY]);
  const left = await clockLeft(store, manifest).catch(() => null);
  const gate = inspirationGate(cfg, ilog, { clockLeft: left, actionsSince: await actionsSince(ctx, ilog.last_seq) });
  if (!gate.ok) {
    fail('conflict', gate.reason === 'max'
      ? 'No inspiration left this time round'
      : `Not yet: wait ${gate.wait} more ${gate.unit === 'clock' ? (manifest.clock?.label ?? 'clock step') : 'action'}${gate.wait > 1 ? 's' : ''}`,
    { gate });
  }

  // Roll.
  const spec = checkSpec({ system: n.system, value: n.value });
  const forced = typeof input.forcedResult === 'number';
  const r = forced ? { ...resolveCheck(spec, naturalOfTotal(spec, input.forcedResult!)), rolls: [naturalOfTotal(spec, input.forcedResult!)] } : rollCheck(spec, ctx.rng ?? Math.random);
  const grade = r.grade;
  const outcome = outcomeOfRoll({ grade, passed: r.passed, crit: r.crit, fumble: r.fumble });
  const locale = String((manifest as { locale?: unknown }).locale ?? 'en');
  const page = typeof input.page === 'string' && PAGE_RE.test(input.page) && manifest.layers[input.page] ? input.page : null;
  const here = page ?? viewpointLayer(ctx) ?? 'map';

  // Which line.
  let table: HintTable | null = null;
  if ((await store.statKind(HINTS_FILE)) === 'file') table = parseHintTable(await store.readFile(HINTS_FILE)).table;
  const hlog = parseHintLog(readme?.fm[HINT_LOG_KEY]);
  const visited = new Set<string>([...hlog.seen, here]);
  for (const e of await eventsThisLoop(store)) if (e.type === 'layer_entered' && typeof e.detail?.layer === 'string') visited.add(e.detail.layer);
  let say: string;
  let hintId: string | undefined;
  let suggest: HintSuggest[] = [];
  let cost: AppliedConsequence | undefined;
  let penalty = false;
  if (grade === 'failure') {
    const chain = cfg.fumble ?? (diceCategoryOf(manifestRaw as never) === 'trpg' ? diceConsequencesOf(manifestRaw).crit_fail.filter((e) => !('complication' in e)) : []);
    const applied = chain.length ? await applyFirstEffect(ctx, chain, { path: README, layer: here, outcome }) : null;
    if (applied) {
      cost = applied;
      say = inspirationWords('fumble', locale);
    } else {
      penalty = true;
      say = inspirationWords('fumbleWait', locale);
    }
  } else {
    const world = await loadTriggerWorld(store);
    let pick = null as ReturnType<typeof pickInspiration> | null;
    if (table && world) {
      const snap = await snapshotTriggerWorld(store, world);
      const paths = new Map(snap.paths);
      for (const p of hintPathsOf(table, world.characterIds)) if (!paths.has(p)) paths.set(p, await store.statKind(p));
      pick = pickInspiration(table, { page: here, values: snap.values, paths, seen: [...visited], characterIds: world.characterIds }, hlog, grade, await spentHints(ctx, table));
    }
    if (pick?.hint && pick.text) {
      say = pick.text;
      hintId = pick.hint.id;
      suggest = pick.suggest;
    } else if (grade === 'setback') {
      say = inspirationWords('vague', locale);
      if (pick?.hint) hintId = pick.hint.id;
    } else {
      const place = await unvisitedPlace(ctx, visited);
      if (place) {
        say = inspirationWords('elsewhere', locale, { place: place.name });
        suggest = [{ enter: place.layer, label: place.name }];
      } else {
        say = inspirationWords('review', locale);
      }
    }
  }

  // Record: the line on the player's page; the hint used up (success / critical only); the wait.
  const event = await recordStoryEvent(ctx, {
    target: here,
    title: n.label,
    text: say,
    inspiration: { grade, outcome, result: r.total, target: spec.target, ...(hintId ? { hint: hintId } : {}) },
  });
  const after = await readFm(ctx);
  if (after) {
    const fm = { ...after.fm };
    const nextLog: InspirationLog = {
      uses: ilog.uses + 1,
      ...(typeof event.seq === 'number' ? { last_seq: event.seq } : {}),
      ...(left !== null ? { last_clock: left } : {}),
      ...(penalty ? { penalty: true } : {}),
    };
    fm[INSPIRATION_LOG_KEY] = nextLog;
    if (hintId && (grade === 'great' || grade === 'success') && table) {
      const h = parseHintLog(fm[HINT_LOG_KEY]);
      fm[HINT_LOG_KEY] = { ...h, used: { ...h.used, [hintId]: h.beat } };
    }
    await store.writeFileAtomic(README, stringifyFrontmatter(fm, after.body));
  }
  const status = await inspirationStatus(ctx);
  const details: InspirationDetails = {
    label: n.label,
    system: n.system,
    ...(n.skill ? { skill: n.skill } : {}),
    target: spec.target,
    value: spec.value,
    result: r.total,
    rolls: r.rolls,
    grade,
    outcome,
    say,
    ...(hintId ? { hint: hintId } : {}),
    suggest,
    ...(cost ? { cost } : {}),
    status: status!,
    cue: 'first-inspiration',
  };
  return { text: `Inspiration ${r.total} (${n.label} ${spec.expect}) — ${grade}: ${say}`, details };
}
