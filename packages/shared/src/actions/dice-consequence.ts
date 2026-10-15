/**
 * Dice consequences: what each of the four
 * outcome tiers DOES to the world, enforced by the engine.
 *
 *   - At roll time (`recordRollConsequence`, from the trigger hook after
 *     `rollDice`): the card's declared band `cost` / `bonus`, its `harm`, a
 *     sanity loss and the world commands the roll ran are collected, the
 *     declared effects applied, and the card keeps a `dice_consequence` record —
 *     the source of the ceremony chip, the card badge and the debrief tally.
 *   - After the roll (`applyDiceConsequence`, the writer's `dice_consequence`
 *     tool): the writer pays the tier — the ONE way an agent moves a declared
 *     state, because it is the dice that move it, bounded by the tier.
 *   - When the writer's turn ends (`settleDiceConsequences`, called by the
 *     server on `agent_settled`): a 大失败 still owing a cost, or a 大成功 still
 *     owing a bonus, gets the world's default (`dice.consequences`, by category)
 *     and the record says `by: default`.
 */
import { parseFrontmatter } from '../schemas/frontmatter.js';
import type { WorldEvent } from '../schemas/events.js';
import { harmAmount, type HarmSeverity } from '../rules/states.js';
import {
  consequenceLine,
  diceConsequencesOf,
  diceEnforced,
  dueOf,
  effectAllowed,
  effectDirection,
  effectKind,
  effectWords,
  gradeOfOutcome,
  isOutcomeTier,
  outcomeLabel,
  parseEffect,
  type ConsequenceEffect,
  type EffectKind,
  type OutcomeTier,
} from '../rules/outcome-tiers.js';
import { fail } from './errors.js';
import { eventsThisLoop } from './loop-history.js';
import { registerAction } from './service.js';
import type { ActionContext, ActionResult } from './types.js';
import { editEntity, removeEntity } from './delete.js';
import { createEntity } from './create.js';
import { readStateFile, stateFileOf, writeState } from './states.js';
import { tickClock } from './closed-world.js';
import { clockLeft } from './closed-world-state.js';
import { recordStoryEvent } from './story-event.js';
import { bandIndexOfGrade } from './skill-cards.js';

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);

export type ConsequenceSource = 'authored' | 'writer' | 'default';

export interface AppliedConsequence {
  kind: EffectKind | 'command' | 'reward';
  direction: 'cost' | 'bonus';
  /** "潮水 −1" — the words, already in the world's language. */
  what: string;
  by: ConsequenceSource;
}

/** The record a resolved card keeps (`dice_consequence:` frontmatter). */
export interface ConsequenceRecord {
  outcome: OutcomeTier;
  due: 'cost' | 'bonus' | null;
  applied: AppliedConsequence[];
}

/** What the ceremony / card / debrief show for one roll. */
export interface ConsequenceSummary {
  outcome: OutcomeTier;
  label: string;
  due: 'cost' | 'bonus' | null;
  /** applied: the tier was paid; pending: owed, the writer has until its turn ends; none: nothing owed. */
  status: 'applied' | 'pending' | 'none';
  /** One chip line ("代价：潮水 −1"), or null when nothing to say. */
  line: string | null;
  applied: AppliedConsequence[];
}

const MAX_WRITER_APPLICATIONS = 2;
const REL_IDS = ['trust', 'bond', 'affection', 'favor', 'favour', 'relationship', 'affinity'];
const RES_IDS = ['resource', 'resources', 'money', 'coins', 'gold', 'supplies', 'energy', 'stamina', 'points'];

async function localeOf(ctx: ActionContext): Promise<string> {
  return String(((await ctx.store.getManifest()) as { locale?: unknown }).locale ?? 'en');
}

async function rawManifest(ctx: ActionContext): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await ctx.store.readFile('world.json')) as Record<string, unknown>;
  } catch {
    return (await ctx.store.getManifest()) as unknown as Record<string, unknown>;
  }
}

function engine(ctx: ActionContext): ActionContext {
  return { ...ctx, actor: { type: 'engine' } };
}

export function parseConsequenceRecord(raw: unknown): ConsequenceRecord | null {
  if (!isObj(raw) || !isOutcomeTier(raw.outcome)) return null;
  const applied = Array.isArray(raw.applied)
    ? raw.applied.filter((a: unknown): a is AppliedConsequence => isObj(a) && typeof a.what === 'string' && (a.direction === 'cost' || a.direction === 'bonus'))
    : [];
  return { outcome: raw.outcome, due: raw.due === 'cost' || raw.due === 'bonus' ? raw.due : null, applied };
}

function paid(rec: ConsequenceRecord): boolean {
  return rec.due === null || rec.applied.some((a) => a.direction === rec.due);
}

export function summarize(rec: ConsequenceRecord, locale: unknown): ConsequenceSummary {
  const label = outcomeLabel(rec.outcome, locale);
  const relevant = rec.applied.filter((a) => rec.due === null || a.direction === rec.due);
  const shown = relevant.length ? relevant : rec.applied;
  const status = rec.due !== null && !paid(rec) ? 'pending' : shown.length ? 'applied' : 'none';
  const line = shown.length
    ? consequenceLine(shown[0].direction, shown.map((a) => a.what).join(locale === 'en' || locale === 'ko' ? ', ' : '、'), locale)
    : null;
  return { outcome: rec.outcome, label, due: rec.due, status, line, applied: rec.applied };
}

// ---------------------------------------------------------------------------
// Resolving an effect against this world
// ---------------------------------------------------------------------------

type Concrete =
  | { kind: 'clock'; by: number; what: string }
  | { kind: 'state'; target: string; id: string; by: number; what: string }
  | { kind: 'harm'; severity: HarmSeverity; amount: number; what: string }
  | { kind: 'item'; path: string; fate: 'lost' | 'broken'; what: string }
  | { kind: 'reveal'; title: string; body: string; what: string }
  | { kind: 'complication' | 'boon'; text: string; what: string };

async function numberState(ctx: ActionContext, target: string, ids: readonly string[]): Promise<{ id: string; label: string } | null> {
  let file;
  try {
    file = await readStateFile(ctx.store, stateFileOf(target));
  } catch {
    return null;
  }
  const decl = file?.states.find((s) => s.type === 'number' && ids.includes(s.id));
  return decl ? { id: decl.id, label: decl.label } : null;
}

/** The character a relationship cost lands on: the check's own actor, then whoever is here, then anyone. */
async function relationshipTarget(ctx: ActionContext, actor: string | null, layer: string | null): Promise<{ target: string; id: string; label: string } | null> {
  const manifest = await ctx.store.getManifest();
  const ids = manifest.characters.map((c) => c.id);
  const here = layer ? ids.filter((id) => (ctx.store.getPresenceOf?.(id)?.layer ?? manifest.characters.find((c) => c.id === id)?.home) === layer) : [];
  const order = [...new Set([...(actor && actor !== 'player' ? [actor] : []), ...here, ...ids])];
  for (const id of order) {
    const s = await numberState(ctx, `characters/${id}`, REL_IDS);
    if (s) {
      const name = manifest.characters.find((c) => c.id === id)?.name ?? id;
      return { target: `characters/${id}`, id: s.id, label: `${name} · ${s.label}` };
    }
  }
  return null;
}

/** A concrete effect this world can carry, or null when it has nowhere to land. */
export async function resolveEffect(
  ctx: ActionContext,
  effect: ConsequenceEffect,
  involved: { actor?: string | null; layer?: string | null } = {},
): Promise<Concrete | null> {
  const locale = await localeOf(ctx);
  const k = effectKind(effect);
  const v = (effect as Record<string, any>)[k];
  switch (k) {
    case 'clock': {
      const manifest = await ctx.store.getManifest();
      if (!manifest.clock) return null;
      let by = v as number;
      if (by > 0) {
        const left = (await clockLeft(ctx.store, manifest)) ?? manifest.clock.start;
        by = Math.min(by, manifest.clock.start - left);
        if (by <= 0) return null;
      }
      return { kind: 'clock', by, what: effectWords({ clock: by }, locale, { label: manifest.clock.label }) };
    }
    case 'state': {
      const s = await numberState(ctx, v.target, [v.id]);
      if (!s) return null;
      return { kind: 'state', target: v.target, id: v.id, by: v.by, what: effectWords(effect, locale, { label: s.label }) };
    }
    case 'sanity':
    case 'resource': {
      const s = await numberState(ctx, 'player', k === 'sanity' ? ['sanity'] : RES_IDS);
      if (!s) return null;
      return { kind: 'state', target: 'player', id: s.id, by: v, what: effectWords({ state: { target: 'player', id: s.id, by: v } }, locale, { label: s.label }) };
    }
    case 'relationship': {
      const r = await relationshipTarget(ctx, involved.actor ?? null, involved.layer ?? null);
      if (!r) return null;
      return { kind: 'state', target: r.target, id: r.id, by: v, what: effectWords({ state: { target: r.target, id: r.id, by: v } }, locale, { label: r.label }) };
    }
    case 'harm': {
      const player = await readStateFile(ctx.store, 'player/README.md');
      const hp = player?.states.find((s) => s.id === 'hp' && s.type === 'number');
      if (!hp) return null;
      return { kind: 'harm', severity: v, amount: harmAmount(hp, v), what: effectWords(effect, locale) };
    }
    case 'item': {
      if ((await ctx.store.statKind(v.path)) !== 'file' || /(^|\/)README\.md$/.test(v.path)) return null;
      const fm = parseFrontmatter(await ctx.store.readFile(v.path)).frontmatter ?? {};
      const name = typeof fm.title === 'string' ? fm.title : typeof fm.name === 'string' ? fm.name : undefined;
      return { kind: 'item', path: v.path, fate: v.fate, what: effectWords(effect, locale, { label: name }) };
    }
    case 'reveal':
      return { kind: 'reveal', title: v.title, body: v.body, what: v.title };
    case 'complication':
    case 'boon':
      return { kind: k, text: effectWords(effect, locale), what: effectWords(effect, locale) };
  }
  return null;
}

async function applyConcrete(ctx: ActionContext, c: Concrete, card: { path: string; layer: string | null; outcome: OutcomeTier }): Promise<void> {
  const ec = engine(ctx);
  switch (c.kind) {
    case 'clock':
      await tickClock(ec, c.by);
      return;
    case 'state':
      await writeState(ec, { target: c.target, state: c.id, by: c.by });
      return;
    case 'harm':
      await writeState(ec, { target: 'player', state: 'hp', by: -c.amount });
      return;
    case 'item':
      if (c.fate === 'lost') await removeEntity(ec, { path: c.path });
      else await editEntity(ec, { path: c.path, frontmatter: { broken: true } });
      return;
    case 'reveal': {
      const stem = card.path.replace(/\.md$/, '');
      let n = 1;
      let path = `${stem}-bonus.md`;
      while ((await ctx.store.statKind(path)) !== 'missing') path = `${stem}-bonus-${++n}.md`;
      await createEntity(ec, { path, frontmatter: { type: 'note', title: c.title, portable: true, dice_reward: { source: card.path, outcome: card.outcome } }, body: c.body });
      return;
    }
    case 'complication':
    case 'boon': {
      const locale = await localeOf(ctx);
      const target = card.layer && card.layer !== 'map' ? card.layer : 'map';
      await recordStoryEvent(ec, { target, title: outcomeLabel(card.outcome, locale), text: c.text });
      return;
    }
  }
}

/**
 * Apply the FIRST effect of a chain that can land in this world, as the engine (the inspiration
 * roll's fumble, the design notes). `card` is the source the effect is told about.
 */
export async function applyFirstEffect(
  ctx: ActionContext,
  effects: readonly ConsequenceEffect[],
  card: { path: string; layer: string | null; outcome: OutcomeTier },
): Promise<AppliedConsequence | null> {
  for (const effect of effects) {
    try {
      const c = await resolveEffect(ctx, effect, { layer: card.layer });
      if (!c) continue;
      await applyConcrete(ctx, c, card);
      return { kind: c.kind, direction: effectDirection(effect), what: c.what, by: 'default' };
    } catch {
      // try the next candidate
    }
  }
  return null;
}

async function writeRecord(ctx: ActionContext, path: string, rec: ConsequenceRecord): Promise<void> {
  if ((await ctx.store.statKind(path)) !== 'file') return;
  await editEntity(engine(ctx), { path, frontmatter: { dice_consequence: rec } });
}

async function readRecord(ctx: ActionContext, path: string): Promise<{ fm: Record<string, any>; rec: ConsequenceRecord | null } | null> {
  if ((await ctx.store.statKind(path)) !== 'file') return null;
  const fm = parseFrontmatter(await ctx.store.readFile(path)).frontmatter;
  if (!fm) return null;
  return { fm, rec: parseConsequenceRecord(fm.dice_consequence) };
}

function effectsOf(raw: unknown): ConsequenceEffect[] {
  const list = Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw];
  const out: ConsequenceEffect[] = [];
  for (const item of list) {
    const p = parseEffect(item);
    if (p.ok) out.push(p.value);
  }
  return out;
}

/** The band a resolved card selected (by grade), or null. */
export function bandOfOutcome(fm: Record<string, unknown>, outcome: OutcomeTier): Record<string, any> | null {
  if (!Array.isArray(fm.dice_outcomes)) return null;
  const i = bandIndexOfGrade(fm, gradeOfOutcome(outcome));
  const band = i >= 0 ? (fm.dice_outcomes as unknown[])[i] : null;
  return isObj(band) ? band : null;
}

const STATEFUL_COMMAND_EFFECTS = new Set(['tick', 'add_state', 'set_state', 'consume', 'give', 'end', 'move', 'edit', 'set_status', 'event', 'enter']);

/**
 * Collect and apply what a fresh roll's own data declares; write the record.
 * Never throws (the roll is already adjudicated).
 */
export async function recordRollConsequence(
  ctx: ActionContext,
  roll: { path: string; layer: string | null; outcome: OutcomeTier; harm?: boolean; sanityLoss?: number; commands?: unknown; skillActor?: string | null },
): Promise<ConsequenceSummary | null> {
  try {
    const read = await readRecord(ctx, roll.path);
    if (!read) return null;
    const locale = await localeOf(ctx);
    const enforced = diceEnforced(await rawManifest(ctx));
    // Story / free worlds show and narrate the tier; nothing is owed there.
    const due = enforced ? dueOf(roll.outcome) : null;
    const rec: ConsequenceRecord = { outcome: roll.outcome, due, applied: [] };
    const band = bandOfOutcome(read.fm, roll.outcome);
    const card = { path: roll.path, layer: roll.layer, outcome: roll.outcome };
    // 1. The band's declared cost / bonus (`inherit` = the world's default chain).
    for (const key of ['cost', 'bonus'] as const) {
      const raw = band?.[key];
      if (raw === undefined) continue;
      const effects = raw === 'inherit'
        ? (roll.outcome === 'crit_fail' || roll.outcome === 'crit_success' ? diceConsequencesOf(await rawManifest(ctx))[roll.outcome] : [])
        : effectsOf(raw);
      const inherit = raw === 'inherit';
      for (const effect of effects) {
        const c = await resolveEffect(ctx, effect, { actor: roll.skillActor, layer: roll.layer });
        if (!c) continue;
        await applyConcrete(ctx, c, card);
        rec.applied.push({ kind: c.kind, direction: effectDirection(effect), what: c.what, by: 'authored' });
        if (inherit) break;
      }
    }
    // 2. Harm the band declared (already applied by the trigger hook).
    if (roll.harm) rec.applied.push({ kind: 'harm', direction: 'cost', what: effectWords({ harm: 'light' }, locale), by: 'authored' });
    // 3. A sanity check's loss.
    if (roll.sanityLoss) rec.applied.push({ kind: 'sanity', direction: 'cost', what: effectWords({ sanity: -Math.min(3, roll.sanityLoss) }, locale, { label: locale === 'zh-CN' ? '理智' : locale === 'ja' ? '正気度' : locale === 'ko' ? '이성' : 'Sanity' }).replace(/[−-]\d+$/, `−${roll.sanityLoss}`), by: 'authored' });
    // 4. World commands the roll ran: the author's own design of this tier.
    if (Array.isArray(roll.commands)) {
      const names = (roll.commands as Array<Record<string, any>>)
        .filter((r) => (r.settle === 'ran' || r.settle === 'resumed') && Array.isArray(r.effects) && r.effects.some((e: any) => e?.ok && STATEFUL_COMMAND_EFFECTS.has(e.action)))
        .map((r) => String(r.name ?? r.id));
      if (names.length && due) rec.applied.push({ kind: 'command', direction: due, what: names.slice(0, 2).join(locale === 'en' || locale === 'ko' ? ', ' : '、'), by: 'authored' });
    }
    // 5. Rewards a 大成功 band hands over beyond the 成功 band's.
    if (roll.outcome === 'crit_success' && band && Array.isArray(band.rewards)) {
      const success = bandOfOutcome(read.fm, 'success');
      const base = new Set((Array.isArray(success?.rewards) ? success!.rewards : []).map((r: any) => r?.path));
      const extra = band.rewards.filter((r: any) => isObj(r) && !base.has(r.path));
      if (extra.length) rec.applied.push({ kind: 'reward', direction: 'bonus', what: extra.map((r: any) => String(r.title)).join(' / '), by: 'authored' });
    }
    // An improvised / skill check whose great band carries a find.
    if (roll.outcome === 'crit_success' && band && isObj(band.find) && typeof band.find.title === 'string') {
      rec.applied.push({ kind: 'reward', direction: 'bonus', what: band.find.title, by: 'authored' });
    }
    // Nothing owed and nothing applied: leave the author's file byte-for-byte
    // (the roll's own surgical write is the only change). The tier is still on
    // the roll event, the receipt and the response.
    if (rec.due !== null || rec.applied.length > 0) await writeRecord(ctx, roll.path, rec);
    return summarize(rec, locale);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The writer's tool: dice_consequence
// ---------------------------------------------------------------------------

export interface DiceConsequenceInput {
  /** The resolved dice card. */
  path: string;
  /** One effect: clock / state / harm / relationship / resource / sanity / item / reveal / complication / boon. */
  effect: unknown;
}

export async function applyDiceConsequence(ctx: ActionContext, input: DiceConsequenceInput): Promise<ActionResult<ConsequenceSummary & { path: string }>> {
  const t = ctx.actor.type;
  if (t !== 'writer' && t !== 'god' && t !== 'engine' && t !== 'character') fail('invalid_argument', 'Only the writer pays a roll’s consequence');
  if (!isObj(input) || typeof input.path !== 'string' || input.path === '') fail('invalid_argument', 'path must name the resolved dice card');
  if (!diceEnforced(await rawManifest(ctx))) fail('unsupported', 'This world does not keep dice consequences as state (a story / free world): narrate the tier’s difference in words instead');
  const read = await readRecord(ctx, input.path);
  if (!read) fail('not_found', `"${input.path}" is not a dice card`);
  const rd = read.fm.roll_dice;
  if (!isObj(rd) || rd.result === undefined) fail('invalid_argument', `"${input.path}" has not been rolled yet; consequences follow a resolved roll`);
  const rec = read.rec ?? await recordFromEvents(ctx, input.path);
  if (!rec) fail('invalid_argument', `"${input.path}" has no resolved outcome tier`);
  const parsed = parseEffect(input.effect);
  if (!parsed.ok) fail('invalid_argument', parsed.error);
  const refused = effectAllowed(rec.outcome, parsed.value);
  if (refused) fail('invalid_argument', `${outcomeLabel(rec.outcome, 'en')}: ${refused}`);
  if (rec.applied.filter((a) => a.by === 'writer').length >= MAX_WRITER_APPLICATIONS) fail('invalid_argument', `"${input.path}" already carries ${MAX_WRITER_APPLICATIONS} consequences from you`);
  const layer = await ctx.store.resolveLayer(input.path);
  const actor = isObj(read.fm.skill_check) && typeof read.fm.skill_check.actor === 'string' ? read.fm.skill_check.actor : null;
  const c = await resolveEffect(ctx, parsed.value, { actor, layer });
  if (!c) fail('invalid_argument', 'This world has nothing that effect can land on (no clock / no such declared state / no such item). Use another effect, e.g. complication or boon');
  await applyConcrete(ctx, c, { path: input.path, layer, outcome: rec.outcome });
  rec.applied.push({ kind: c.kind, direction: effectDirection(parsed.value), what: c.what, by: 'writer' });
  await writeRecord(ctx, input.path, rec);
  const locale = await localeOf(ctx);
  const summary = summarize(rec, locale);
  return {
    text: `Consequence applied to ${input.path} (${rec.outcome}): ${c.what}.` + (summary.status === 'pending' ? ` Still owed: a ${rec.due}.` : ''),
    details: { ...summary, path: input.path },
  };
}

/** A card rolled before the record existed (or by a path without the hook): rebuild from its roll event. */
async function recordFromEvents(ctx: ActionContext, path: string): Promise<ConsequenceRecord | null> {
  const events = await eventsThisLoop(ctx.store);
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === 'roll_resolved' && e.detail?.path === path && isOutcomeTier(e.detail?.outcome)) {
      return { outcome: e.detail.outcome, due: dueOf(e.detail.outcome), applied: [] };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Settling: the engine pays what the writer skipped
// ---------------------------------------------------------------------------

export interface SettledConsequence {
  path: string;
  outcome: OutcomeTier;
  applied: AppliedConsequence | null;
  summary: ConsequenceSummary;
}

/**
 * Every 大失败 still owing a cost and every 大成功 still owing a bonus gets the
 * world's default (the first candidate that can land). `rollsBeforeSeq`: a
 * PLAYER roll at or after it happened during the writer's turn and waits for
 * the next one (the writer never saw it); agent rolls settle now.
 */
export async function settleDiceConsequences(
  ctx: ActionContext,
  opts: { rollsBeforeSeq?: number } = {},
): Promise<ActionResult<{ settled: SettledConsequence[] }>> {
  const events = await eventsThisLoop(ctx.store);
  const latest = new Map<string, WorldEvent>();
  for (const e of events) if (e.type === 'roll_resolved' && typeof e.detail?.path === 'string') latest.set(e.detail.path, e);
  const settled: SettledConsequence[] = [];
  const manifest = await rawManifest(ctx);
  if (!diceEnforced(manifest)) return { text: 'This world does not enforce dice consequences.', details: { settled } };
  const defaults = diceConsequencesOf(manifest);
  const locale = await localeOf(ctx);
  for (const [path, e] of latest) {
    const outcome = e.detail?.outcome as OutcomeTier | undefined;
    if (outcome !== 'crit_fail' && outcome !== 'crit_success') continue;
    if (e.actor?.type === 'player' && opts.rollsBeforeSeq !== undefined && typeof e.seq === 'number' && e.seq >= opts.rollsBeforeSeq) continue;
    const read = await readRecord(ctx, path);
    if (!read) continue;
    const rd = read.fm.roll_dice;
    // Re-rolled or reset since: the event no longer describes this card.
    if (!isObj(rd) || rd.result !== e.detail.result) continue;
    const rec: ConsequenceRecord = read.rec ?? { outcome, due: dueOf(outcome), applied: [] };
    if (paid(rec)) continue;
    const actor = isObj(read.fm.skill_check) && typeof read.fm.skill_check.actor === 'string' ? read.fm.skill_check.actor : null;
    let applied: AppliedConsequence | null = null;
    for (const effect of defaults[outcome]) {
      try {
        const c = await resolveEffect(ctx, effect, { actor, layer: e.layer ?? null });
        if (!c) continue;
        await applyConcrete(ctx, c, { path, layer: e.layer ?? null, outcome });
        applied = { kind: c.kind, direction: effectDirection(effect), what: c.what, by: 'default' };
        break;
      } catch {
        // try the next candidate
      }
    }
    if (applied) rec.applied.push(applied);
    else rec.due = null; // nothing could land at all; do not retry every turn
    await writeRecord(ctx, path, rec);
    settled.push({ path, outcome, applied, summary: summarize(rec, locale) });
  }
  const text = settled.length
    ? settled.map((s) => `${s.path}: ${s.outcome} — engine default ${s.applied ? s.applied.what : '(nothing could land)'}`).join('\n')
    : 'No dice consequence was owed.';
  return { text, details: { settled } };
}

/** The writer's view of what is still owed (`[Dice owed]`); '' when nothing. */
export async function owedConsequencesBlock(ctx: ActionContext): Promise<string> {
  const events = await eventsThisLoop(ctx.store);
  const latest = new Map<string, WorldEvent>();
  for (const e of events) if (e.type === 'roll_resolved' && typeof e.detail?.path === 'string') latest.set(e.detail.path, e);
  const manifest = await rawManifest(ctx);
  if (!diceEnforced(manifest)) return '';
  const defaults = diceConsequencesOf(manifest);
  const lines: string[] = [];
  for (const [path, e] of latest) {
    const outcome = e.detail?.outcome as OutcomeTier | undefined;
    if (outcome !== 'crit_fail' && outcome !== 'crit_success') continue;
    const read = await readRecord(ctx, path);
    if (!read || !isObj(read.fm.roll_dice) || read.fm.roll_dice.result !== e.detail.result) continue;
    const rec: ConsequenceRecord = read.rec ?? { outcome, due: dueOf(outcome), applied: [] };
    if (paid(rec)) continue;
    let fallback = 'a story complication';
    for (const effect of defaults[outcome]) {
      const c = await resolveEffect(ctx, effect, { layer: e.layer ?? null }).catch(() => null);
      if (c) { fallback = c.what; break; }
    }
    lines.push(`- ${path}: ${outcome === 'crit_fail' ? '大失败 crit_fail owes a COST' : '大成功 crit_success owes a BONUS'} — call dice_consequence before ending your turn, or the engine applies: ${fallback}`);
  }
  return lines.length ? ['[Dice owed]', ...lines].join('\n') : '';
}

registerAction('diceConsequence', (ctx, input) => applyDiceConsequence(ctx, input as unknown as DiceConsequenceInput));
registerAction('settleDiceConsequences', (ctx, input) => settleDiceConsequences(ctx, input as { rollsBeforeSeq?: number }));
