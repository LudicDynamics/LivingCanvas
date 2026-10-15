/**
 * `skillCheck` — one use of a skill is one check.
 *
 * The action lands ONE dice chalk carrying a `skill_check:` block in a place:
 *
 *   - for the PROTAGONIST (`actor: player`, the default) the card waits for the
 *     player to roll it, exactly like a search: the writer (or the player's own
 *     "use this skill" from the character sheet) only frames the check;
 *   - for a CHARACTER with a sheet (`actor: self` from a character process, or
 *     `actor: <id>` from the writer) the engine rolls it on the spot — a
 *     character does not wait for the player to act for it.
 *
 * The dice come from the sheet (`rules/skills.ts`), and are recomputed at roll
 * time by `rollDice` (the sheet is the truth). The result's GRADE picks the
 * outcome band, so declared outcomes, hidden hp and world commands read it the
 * same way they read a search.
 */
import { checkSpec, type CheckGrade } from '../rules/skills.js';
import { fail } from './errors.js';
import { eventsThisLoop } from './loop-history.js';
import { effectAllowed, outcomeOfGrade, parseEffect } from '../rules/outcome-tiers.js';
import { registerAction } from './service.js';
import { createEntity } from './create.js';
import { rollDice } from './roll-dice.js';
import { resolveSkill, rulesOfWorld, type SkillCheckBlock } from './skill-cards.js';
import { rollerFor } from './assist.js';
import { declaredSpotsOf, layerDirOf, searchChalkPath, searchFinds, spotForSkill, type SearchSpot } from './search.js';
import type { ActionContext, ActionResult } from './types.js';

const GRADES: readonly CheckGrade[] = ['failure', 'setback', 'success', 'great'];
const CHARACTER_ID = /^[a-z0-9][a-z0-9-]*$/;

function isObject(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

// ---------------------------------------------------------------------------
// The action
// ---------------------------------------------------------------------------

export interface SkillCheckBand {
  text: string;
  find?: { title: string; body: string };
  harm?: 'light' | 'serious' | 'grave';
  /** The tier's cost (failure / setback) or bonus (great), applied by the engine on resolution. */
  cost?: unknown;
  bonus?: unknown;
}

export interface SkillCheckInput {
  skill: string;
  /** `player` (default), `self` (a character process: itself), or a character id (writer only). */
  actor?: string;
  /** coc: regular / hard / extreme; dnd: a DC (number) or easy / moderate / hard / very_hard. */
  difficulty?: string | number;
  advantage?: 'advantage' | 'disadvantage';
  /** What is being attempted, in the world language. */
  title?: string;
  body?: string;
  /** Where the card lands (layer id or a path in it); default the player's place. */
  layer?: string;
  outcomes?: Partial<Record<CheckGrade, SkillCheckBand>>;
  /** coc sanity check only: sanity lost on a pass / on a fail. */
  sanity?: { pass: number; fail: number };
  continue_label?: string;
  /**
   * A search spot the place's README declares: this check IS the attempt at it
   *. The card lands as that spot's dice
   * chalk with the spot's own bands, and the roll pays the declared finds — the
   * engine's call, never the narrator's. Omitted: the engine still binds the
   * first unsearched spot whose `skill` / `alt_skills` names this skill.
   */
  spot?: string;
}

export interface SkillCheckDetails {
  path: string;
  layer: string;
  actor: string;
  skill: string;
  label: string;
  system: 'coc' | 'dnd';
  type: string;
  expect: string;
  target: number;
  /** coc: the skill %; dnd: the modifier. */
  value: number;
  difficulty: string;
  /** A companion lent its number. */
  assist?: { actor: string; name: string };
  /** Present when the engine rolled at once (a character's own check). */
  roll?: Record<string, unknown>;
  /** The declared search spot this check stands for; its bands pay the finds. */
  spot?: string;
  /** Paths the roll may create (the bound spot's declared finds). */
  finds?: string[];
}

async function wasCreated(ctx: ActionContext, path: string): Promise<boolean> {
  return (await eventsThisLoop(ctx.store)).some((event) => event.type === 'entity_created' && event.detail?.path === path);
}

async function placeOf(ctx: ActionContext, raw: unknown): Promise<string> {
  const manifest = await ctx.store.getManifest();
  const layers = manifest.layers;
  if (nonEmpty(raw)) {
    if (layers[raw]) return raw;
    const resolved = await ctx.store.resolveLayer(raw);
    if (resolved && layers[resolved]) return resolved;
    fail('not_found', `"${raw}" is not a place in this world`);
  }
  try {
    const vp = ctx.store.readViewpoint();
    if (vp?.layer && layers[vp.layer]) return vp.layer;
  } catch {
    // no viewpoint yet
  }
  const entry = (manifest as { entry?: unknown }).entry;
  return typeof entry === 'string' && layers[entry] ? entry : 'map';
}

function whoChecks(ctx: ActionContext, raw: unknown): string {
  const a = ctx.actor;
  const asked = nonEmpty(raw) ? raw.trim() : 'player';
  if (a.type === 'character') {
    if (asked === 'self' || asked === a.id) {
      if (!a.id) fail('invalid_argument', 'A character check needs the character id');
      return a.id;
    }
    fail('invalid_argument', 'A character makes checks only for itself (actor "self"); the protagonist’s checks are framed by the writer or the player');
  }
  if (a.type === 'player') {
    if (asked !== 'player') fail('invalid_argument', 'The player checks the protagonist’s own skills');
    return 'player';
  }
  // writer / god / engine
  if (asked === 'self') fail('invalid_argument', 'actor "self" is for a character process; use "player" or a character id');
  if (asked !== 'player' && !CHARACTER_ID.test(asked)) fail('invalid_argument', `actor "${asked}" must be player or a character id`);
  return asked;
}

function outcomeBands(input: SkillCheckInput, path: string): { bands: unknown[]; finds: string[] } | null {
  if (input.outcomes === undefined) return null;
  if (!isObject(input.outcomes)) fail('invalid_argument', 'outcomes must map failure / setback / success / great to { text }');
  const stem = path.replace(/\.md$/, '');
  const label = nonEmpty(input.continue_label) ? input.continue_label.slice(0, 80) : '→';
  const finds: string[] = [];
  const bands = GRADES.map((grade, i) => {
    const band = input.outcomes![grade];
    if (!isObject(band) || !nonEmpty(band.text) || band.text.length > 2000) {
      fail('invalid_argument', `outcomes.${grade}.text is required (at most 2000 characters)`);
    }
    const find = band.find;
    if (find !== undefined && (!isObject(find) || !nonEmpty(find.title) || typeof find.body !== 'string' || find.body.length > 4000)) {
      fail('invalid_argument', `outcomes.${grade}.find needs a title and a body`);
    }
    if (band.harm !== undefined && !['light', 'serious', 'grave'].includes(band.harm as string)) {
      fail('invalid_argument', `outcomes.${grade}.harm must be light, serious or grave`);
    }
    for (const key of ['cost', 'bonus'] as const) {
      if (band[key] === undefined) continue;
      const parsed = parseEffect(band[key]);
      if (!parsed.ok) fail('invalid_argument', `outcomes.${grade}.${key}: ${parsed.error}`);
      const refused = effectAllowed(outcomeOfGrade(grade)!, parsed.value);
      if (refused) fail('invalid_argument', `outcomes.${grade}.${key}: ${refused}`);
    }
    const rewardPath = `${stem}-${grade}.md`;
    if (find) finds.push(rewardPath);
    return {
      grade,
      min: i + 1,
      max: i + 1,
      text: band.text,
      options: [{ id: 'narrate', label, action: { kind: 'writer', prompt: `Narrate the resolved skill check ${path}: read its actual roll, tier and what it found. Do not create or move the found item; it already exists.` } }],
      ...(find ? { rewards: [{ path: rewardPath, title: find.title, body: find.body }] } : {}),
      ...(band.harm ? { harm: band.harm } : {}),
      ...(band.cost !== undefined ? { cost: band.cost } : {}),
      ...(band.bonus !== undefined ? { bonus: band.bonus } : {}),
    };
  });
  return { bands, finds };
}

export async function skillCheck(ctx: ActionContext, input: SkillCheckInput): Promise<ActionResult<SkillCheckDetails>> {
  if (!isObject(input) || !nonEmpty(input.skill)) fail('invalid_argument', 'skill_check needs a skill id');
  const w = await rulesOfWorld(ctx.store);
  if (!w) fail('unsupported', 'This world has no skill rules (world.json rules); decide the outcome in prose or use roll_dice on a declared check');
  const actor = whoChecks(ctx, input.actor);
  if (actor !== 'player' && !w.rules.characterChecks) fail('unsupported', 'Characters do not roll for themselves in this world (rules.characterChecks is off)');
  if (input.sanity !== undefined && input.skill !== 'sanity') fail('invalid_argument', 'sanity losses belong to a sanity check (skill "sanity")');
  if (input.skill === 'sanity' && (!isObject(input.sanity) || !Number.isFinite(Number(input.sanity.pass)) || !Number.isFinite(Number(input.sanity.fail)))) {
    fail('invalid_argument', 'A sanity check declares sanity { pass, fail }: the sanity lost on a pass and on a fail');
  }
  if (input.title !== undefined && (typeof input.title !== 'string' || input.title.length > 200)) fail('invalid_argument', 'title is at most 200 characters');
  if (input.body !== undefined && (typeof input.body !== 'string' || input.body.length > 2000)) fail('invalid_argument', 'body is at most 2000 characters');

  const layer = await placeOf(ctx, input.layer);
  // A companion with the player who is better at it lends its number;
  // the player still rolls the card. Nobody has the skill → resolveSkill's not_found.
  const helper = actor === 'player' && input.skill !== 'sanity' ? await rollerFor(ctx.store, w, input.skill, layer) : null;
  const { label, value } = helper && helper.actor !== 'player'
    ? { label: helper.label, value: helper.value }
    : await resolveSkill(ctx.store, w, actor, input.skill);
  const assist = helper && helper.actor !== 'player' ? helper : null;
  const spot = await boundSpot(ctx, layer, actor, input);
  if (spot) return spotCheck(ctx, { input, layer, spot, w, label, value, assist });
  const spec = checkSpec({ system: w.rules.system, value, difficulty: input.difficulty, advantage: input.advantage });
  const dir = layerDirOf(layer);
  let n = 1;
  let path = `${dir}/check-${n}.md`;
  while ((await ctx.store.statKind(path)) !== 'missing' || (await wasCreated(ctx, path))) {
    n += 1;
    if (n > 199) fail('invalid_argument', 'Too many skill checks in this place');
    path = `${dir}/check-${n}.md`;
  }
  const title = nonEmpty(input.title) ? input.title.trim() : label;
  const block: SkillCheckBlock = {
    skill: input.skill,
    label,
    system: w.rules.system,
    actor,
    difficulty: spec.difficulty,
    ...(spec.advantage !== 'none' ? { advantage: spec.advantage } : {}),
    target: spec.target,
    value: spec.value,
    ...(input.sanity ? { sanity: { pass: Math.max(0, Math.round(Number(input.sanity.pass))), fail: Math.max(0, Math.round(Number(input.sanity.fail))) } } : {}),
    ...(assist ? { assist: assist.actor } : {}),
  };
  const outcomes = outcomeBands(input, path);
  const created = await createEntity(ctx, {
    path,
    frontmatter: {
      type: 'chalk',
      title,
      roll_dice: { type: spec.type, desc: `${label}: ${title}`, expect: spec.expect },
      skill_check: block,
      ...(outcomes ? { dice_outcomes: outcomes.bands } : {}),
    },
    body: input.body ?? '',
  });
  const details: SkillCheckDetails = {
    path, layer, actor, skill: input.skill, label, system: w.rules.system, type: spec.type, expect: spec.expect, target: spec.target, value: spec.value, difficulty: spec.difficulty,
    ...(assist ? { assist: { actor: assist.actor, name: assist.name } } : {}),
  };
  if (actor === 'player') {
    return {
      text: `Skill check ready: ${label} (${spec.expect}) — "${title}" (${path})${assist ? ` — ${assist.name} (${assist.actor}) lends their ${label}` : ''}. The player rolls; narrate after the roll resolves.`,
      details: { ...details, event: created.details.event } as SkillCheckDetails,
    };
  }
  // A character's own check: the engine rolls it now, as that character.
  const rolled = await rollDice(ctx, { path });
  return {
    text: `${rolled.text}`,
    details: { ...details, roll: rolled.details as unknown as Record<string, unknown> },
  };
}

/**
 * Which declared spot this check stands for, if any: an explicit `spot`, else
 * the engine's own binding (`spotForSkill`). Only the protagonist's checks bind —
 * a character rolling for itself finds nothing in the place's declared loot.
 */
async function boundSpot(ctx: ActionContext, layer: string, actor: string, input: SkillCheckInput): Promise<SearchSpot | null> {
  if (input.spot !== undefined && input.spot !== '') {
    if (typeof input.spot !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.spot)) fail('invalid_argument', 'spot must be a search spot id (kebab-case)');
    if (actor !== 'player') fail('invalid_argument', 'Only the protagonist’s check can be an attempt at a declared search spot');
    if (input.skill === 'sanity') fail('invalid_argument', 'A sanity check is never a search');
    const { readme, spots } = await declaredSpotsOf(ctx, layer);
    const spot = spots.find((s) => s.id === input.spot);
    if (!spot) fail('not_found', `${readme} declares no searchable spot "${input.spot}" (has: ${spots.map((s) => s.id).join(', ') || 'none'})`);
    return spot;
  }
  if (actor !== 'player' || input.skill === 'sanity') return null;
  return spotForSkill(ctx, layer, input.skill);
}

/**
 * The check lands as the spot's dice chalk (`search-<spot>.md`, searched once,
 * like `searchPlace`): the sheet's dice over the spot's authored base, the
 * spot's own bands, bindings and buttons. `runDeclaredRoll` then creates the
 * band's declared finds when the player rolls — so a failure pays the half clue
 * and a great success the extra find, every time.
 */
async function spotCheck(
  ctx: ActionContext,
  a: { input: SkillCheckInput; layer: string; spot: SearchSpot; w: NonNullable<Awaited<ReturnType<typeof rulesOfWorld>>>; label: string; value: number; assist: { actor: string; name: string } | null },
): Promise<ActionResult<SkillCheckDetails>> {
  const { input, layer, spot, w, label, value, assist } = a;
  const spec = checkSpec({ system: w.rules.system, value, difficulty: input.difficulty ?? spot.difficulty, advantage: input.advantage });
  const path = searchChalkPath(layer, spot.id);
  const finds = searchFinds(spot);
  const details: SkillCheckDetails = {
    path, layer, actor: 'player', skill: input.skill, label, system: w.rules.system, type: spec.type, expect: spec.expect, target: spec.target, value: spec.value, difficulty: spec.difficulty,
    ...(assist ? { assist: { actor: assist.actor, name: assist.name } } : {}),
    spot: spot.id,
    finds,
  };
  if ((await ctx.store.statKind(path)) === 'file') {
    return { text: `"${spot.title}" is already being searched (${path}); that card is the check.`, details };
  }
  if (await wasCreated(ctx, path)) fail('already_exists', `"${spot.title}" has already been searched.`);
  for (const find of finds) {
    if ((await ctx.store.statKind(find)) === 'file') {
      fail('invalid_field_value', `search "${spot.id}": "${find}" already exists; declared finds are created by the roll, never placed beforehand`);
    }
  }
  const block: SkillCheckBlock = {
    skill: input.skill,
    label,
    system: w.rules.system,
    actor: 'player',
    difficulty: spec.difficulty,
    ...(spec.advantage !== 'none' ? { advantage: spec.advantage } : {}),
    target: spec.target,
    value: spec.value,
    ...(assist ? { assist: assist.actor } : {}),
  };
  const created = await createEntity(ctx, {
    path,
    frontmatter: {
      type: 'chalk',
      title: spot.title,
      roll_dice: { type: spec.type, desc: `${label}: ${spot.title}`, expect: spec.expect },
      dice_base: { type: spot.roll_dice.type, expect: spot.roll_dice.expect },
      skill_check: block,
      ...(spot.choice ? { choice: spot.choice } : {}),
      ...(spot.choice_actions ? { choice_actions: spot.choice_actions } : {}),
      ...(spot.dice_outcomes ? { dice_outcomes: spot.dice_outcomes } : {}),
      ...(spot.on ? { on: spot.on } : {}),
      search_source: { layer, spot: spot.id },
    },
    body: typeof input.body === 'string' && input.body.trim() ? input.body : spot.body,
  });
  const ignored = input.outcomes !== undefined ? ' The spot’s own bands decide the result; the outcomes you wrote were not used.' : '';
  return {
    text: `Skill check ready: ${label} (${spec.expect}) — this is the declared search "${spot.title}" (${path})${assist ? ` — ${assist.name} (${assist.actor}) lends their ${label}` : ''}. The player rolls; the roll creates the declared finds for its grade.${ignored} Narrate after the roll resolves.`,
    details: { ...details, event: created.details.event } as SkillCheckDetails,
  };
}

registerAction('skillCheck', (ctx, input) => skillCheck(ctx, input as unknown as SkillCheckInput));
