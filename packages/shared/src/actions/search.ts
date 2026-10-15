/**
 * `searchPlace` — the player declares a search ("I search this room"), and the
 * world answers with a DICE CHALK, not with the item.
 *
 * The loop:
 *
 *   role-play declaration → searchPlace → a chalk carrying `roll_dice` lands in
 *   the layer (the dice event) → the player rolls → the rolled band decides
 *   which item files are created (server `runDeclaredRoll`'s `rewards`, or a
 *   world command's `give` bound to `on.roll_resolved`) → the writer narrates.
 *
 * Nothing the search can find exists before the roll. The possible finds are
 * declared up front — on the layer README's `search:` list for authored, key
 * loot, or improvised by the writer for a minor, non-key find — but the files
 * are only materialized once the roll resolves.
 *
 * This action therefore creates exactly ONE file (the dice chalk) and appends
 * exactly one event (`entity_created`, through `createEntity`). It never rolls
 * and never creates an item.
 */
import { parseFrontmatter } from '../schemas/frontmatter.js';
import { fail } from './errors.js';
import { eventsThisLoop } from './loop-history.js';
import { effectAllowed, outcomeOfGrade, parseEffect } from '../rules/outcome-tiers.js';
import { registerAction } from './service.js';
import { createEntity } from './create.js';
import type { ActionContext, ActionResult } from './types.js';
import { diceConventionForTheme, type DiceConvention } from '../rules/themes.js';
import { checkSpec, SKILL_ID_RE } from '../rules/skills.js';
import { resolveSkill, rulesOfWorld } from './skill-cards.js';

/** A spot id / improvised slug: stable, ASCII kebab-case (it becomes a filename). */
const SPOT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** At most this many searchable spots per place. */
export const MAX_SEARCH_SPOTS = 12;
/**
 * Improvised searches in a world with no theme: the standard 2d10 table. A
 * themed world uses its own dice convention (`rules/themes.ts`) with the same
 * four grades — `runDeclaredRoll` accepts every convention in that registry.
 */
export const IMPROVISED_SEARCH_BANDS = [
  ['failure', 2, 4],
  ['setback', 5, 10],
  ['success', 11, 17],
  ['great', 18, 20],
] as const;

export type SearchGrade = (typeof IMPROVISED_SEARCH_BANDS)[number][0];

/** One authored searchable spot, as declared on a layer README's `search:` list. */
export interface SearchSpot {
  /** Stable id; the dice chalk lands at `<layer dir>/search-<id>.md`. */
  id: string;
  /** Button text for the declaration ("Search the morgue (roll)"). */
  label: string;
  /** Title of the dice chalk that the search spawns. */
  title: string;
  /** Body of the dice chalk (what the player sees before rolling). */
  body: string;
  /** The check itself: `type / desc / expect`, never a result. */
  roll_dice: { type: string; desc: string; expect: string };
  /** Per-band results with `rewards` (materialized on resolution by the server). */
  dice_outcomes?: unknown[];
  /** Or world commands bound to the roll (`give` etc. run on resolution). */
  on?: Record<string, unknown>;
  /** Optional pre-roll buttons on the dice chalk (e.g. "not now, go back"). */
  choice?: Record<string, unknown>;
  choice_actions?: Record<string, unknown>;
  /**
   * The protagonist's skill this search tests.
   * In a world with `rules`, the dice chalk becomes a skill check against the
   * sheet; `roll_dice` stays as the authored base its bands are read against.
   */
  skill?: string;
  /**
   * Optional: other sheet skills that also count as an attempt at this spot
   *. A protagonist `skill_check` with
   * `skill` or one of these, in this place, while the spot is unsearched, IS
   * this search: the engine binds it and pays the spot's own bands.
   */
  alt_skills?: string[];
  /** coc: regular / hard / extreme; dnd: a DC. Default regular / 12. */
  difficulty?: string | number;
}

/** Everything an improvised search may declare. Finds are optional per band. */
export interface ImprovisedSearch {
  /** Short title of the search ("Rummage through the drawer"). */
  title: string;
  /** One line shown on the dice chalk before the roll. */
  body?: string;
  /** Button text that hands the resolved search back to the writer. */
  continue_label?: string;
  outcomes: Record<SearchGrade, {
    text: string;
    find?: { title: string; body: string };
    /**
     * Hidden hp: this band hurts the player. The
     * engine lowers `player.hp` by the severity — only in a world with endings
     * whose player declares `hp`; elsewhere it is inert. Never a number.
     */
    harm?: 'light' | 'serious' | 'grave';
    /** The tier's cost / bonus effect, applied by the engine on resolution. */
    cost?: unknown;
    bonus?: unknown;
  }>;
}

export interface SearchPlaceInput {
  /** Layer id (`map` or `world/...`) or any world path inside that layer. */
  layer: string;
  /** A spot declared in that layer's README `search:` list. */
  spot?: string;
  /** Writer-only: a minor, non-key find the place does not declare. */
  improvise?: ImprovisedSearch;
}

export interface SearchPlaceDetails {
  /** The dice chalk (existing or new). */
  path: string;
  layer: string;
  spot: string;
  /** False when this spot was already searched and its chalk still stands. */
  created: boolean;
  /** Paths the roll may materialize — none of them exists yet. */
  finds: string[];
}

function isObject(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/** Layer id → the directory its README lives in. */
export function layerDirOf(layer: string): string {
  return layer === 'map' ? 'world' : layer;
}

/** Where a spot's dice chalk lands. */
export function searchChalkPath(layer: string, spot: string): string {
  return `${layerDirOf(layer)}/search-${spot}.md`;
}

/** Every item path a spot's bands can create through `rewards`. */
export function searchFinds(spot: Pick<SearchSpot, 'dice_outcomes'>): string[] {
  const out = new Set<string>();
  for (const band of spot.dice_outcomes ?? []) {
    if (!isObject(band) || !Array.isArray(band.rewards)) continue;
    for (const reward of band.rewards) if (isObject(reward) && typeof reward.path === 'string') out.add(reward.path);
  }
  return [...out];
}

/**
 * Validate a README frontmatter's `search:` list. Pure: returns the spots it
 * could read and one message per problem, so the world gate and the action
 * report the same thing.
 */
export function parseSearchDeclarations(frontmatter: Record<string, unknown> | null | undefined): {
  spots: SearchSpot[];
  errors: string[];
} {
  const raw = frontmatter?.search;
  if (raw === undefined || raw === null) return { spots: [], errors: [] };
  if (!Array.isArray(raw)) return { spots: [], errors: ['search must be a list of spots'] };
  const errors: string[] = [];
  const spots: SearchSpot[] = [];
  const ids = new Set<string>();
  if (raw.length > MAX_SEARCH_SPOTS) errors.push(`search declares ${raw.length} spots; at most ${MAX_SEARCH_SPOTS}`);
  raw.forEach((value, index) => {
    const where = `search[${index}]`;
    if (!isObject(value)) return void errors.push(`${where} must be a mapping`);
    const { id, label, title, body, roll_dice: dice, dice_outcomes: outcomes, on, choice, choice_actions: actions, skill, difficulty, alt_skills: altSkills } = value;
    if (typeof id !== 'string' || !SPOT_ID.test(id)) return void errors.push(`${where}.id must be kebab-case ASCII`);
    if (ids.has(id)) return void errors.push(`${where}.id "${id}" is declared twice`);
    ids.add(id);
    if (!nonEmpty(label)) errors.push(`${where}.label is required`);
    if (!nonEmpty(title)) errors.push(`${where}.title is required`);
    if (body !== undefined && typeof body !== 'string') errors.push(`${where}.body must be text`);
    if (!isObject(dice) || !nonEmpty(dice.type) || !nonEmpty(dice.desc) || !nonEmpty(dice.expect)) {
      errors.push(`${where}.roll_dice needs type, desc and expect`);
    } else if (dice.result !== undefined || dice.passed !== undefined) {
      errors.push(`${where}.roll_dice must not carry a result: the roll happens after the search`);
    }
    if (outcomes === undefined && on === undefined) errors.push(`${where} declares neither dice_outcomes nor on: a search must say what the roll can find`);
    if (outcomes !== undefined && !Array.isArray(outcomes)) errors.push(`${where}.dice_outcomes must be a list`);
    if (on !== undefined && !isObject(on)) errors.push(`${where}.on must be a mapping`);
    if (choice !== undefined && !isObject(choice)) errors.push(`${where}.choice must be a mapping`);
    if (actions !== undefined && !isObject(actions)) errors.push(`${where}.choice_actions must be a mapping`);
    if (skill !== undefined && (typeof skill !== 'string' || !SKILL_ID_RE.test(skill))) errors.push(`${where}.skill must be a skill id (lowercase ASCII and "_")`);
    if (difficulty !== undefined && typeof difficulty !== 'string' && typeof difficulty !== 'number') errors.push(`${where}.difficulty must be regular / hard / extreme or a DC`);
    const alt = Array.isArray(altSkills) ? altSkills : [];
    if (altSkills !== undefined && (!Array.isArray(altSkills) || altSkills.length === 0 || altSkills.length > 8 || altSkills.some((s) => typeof s !== 'string' || !SKILL_ID_RE.test(s)))) {
      errors.push(`${where}.alt_skills must be a list of 1–8 skill ids (lowercase ASCII and "_")`);
    } else if (altSkills !== undefined && (alt.includes(skill) || new Set(alt).size !== alt.length)) {
      errors.push(`${where}.alt_skills repeats a skill (the spot's own skill or another entry)`);
    }
    spots.push({
      id,
      label: String(label ?? ''),
      title: String(title ?? ''),
      body: typeof body === 'string' ? body : '',
      roll_dice: isObject(dice)
        ? { type: String(dice.type ?? ''), desc: String(dice.desc ?? ''), expect: String(dice.expect ?? '') }
        : { type: '', desc: '', expect: '' },
      ...(Array.isArray(outcomes) ? { dice_outcomes: outcomes } : {}),
      ...(isObject(on) ? { on } : {}),
      ...(isObject(choice) ? { choice } : {}),
      ...(isObject(actions) ? { choice_actions: actions } : {}),
      ...(typeof skill === 'string' ? { skill } : {}),
      ...(typeof difficulty === 'string' || typeof difficulty === 'number' ? { difficulty } : {}),
      ...(alt.length > 0 && alt.every((s) => typeof s === 'string' && SKILL_ID_RE.test(s)) ? { alt_skills: alt as string[] } : {}),
    });
  });
  for (const spot of spots) {
    for (const find of searchFinds(spot)) {
      if (!/^world\/[a-zA-Z0-9_/-]+\.md$/.test(find) || find.endsWith('/README.md')) {
        errors.push(`search "${spot.id}": find "${find}" must be a world/ entity path`);
      }
    }
  }
  return { spots, errors };
}

async function resolveSearchLayer(ctx: ActionContext, raw: string): Promise<{ layer: string; dice: DiceConvention }> {
  if (!nonEmpty(raw)) fail('invalid_argument', 'layer must name the place being searched');
  const manifest = await ctx.store.getManifest();
  // The world's theme picks the dice of an improvised search.
  const dice = diceConventionForTheme((manifest as { theme?: unknown }).theme);
  const layers = manifest.layers;
  if (layers[raw]) return { layer: raw, dice };
  const resolved = await ctx.store.resolveLayer(raw);
  if (resolved && layers[resolved]) return { layer: resolved, dice };
  return fail('not_found', `"${raw}" is not a place in this world`);
}

async function wasCreated(ctx: ActionContext, path: string): Promise<boolean> {
  return (await eventsThisLoop(ctx.store)).some((event) => event.type === 'entity_created' && event.detail?.path === path);
}

/** The spots a place's README declares (unreadable / malformed → none, with the errors). */
export async function declaredSpotsOf(ctx: ActionContext, layer: string): Promise<{ readme: string; spots: SearchSpot[]; errors: string[] }> {
  const readme = `${layerDirOf(layer)}/README.md`;
  const text = (await ctx.store.statKind(readme)) === 'file' ? await ctx.store.readFile(readme) : '';
  return { readme, ...parseSearchDeclarations(parseFrontmatter(text).frontmatter) };
}

/** True once this spot has been searched in this loop (its dice chalk stands, or stood). */
export async function spotSearched(ctx: ActionContext, layer: string, spot: string): Promise<boolean> {
  const path = searchChalkPath(layer, spot);
  return (await ctx.store.statKind(path)) === 'file' || (await wasCreated(ctx, path));
}

/**
 * The declared spot a protagonist skill check in this place stands for
 *: the first UNSEARCHED spot whose `skill`
 * or `alt_skills` names this skill. Null when none — the check stays a free one.
 * Engine rule, not a model's call: the key finds of a place come only from its
 * declared bands, whoever framed the check.
 */
export async function spotForSkill(ctx: ActionContext, layer: string, skill: string): Promise<SearchSpot | null> {
  const { spots } = await declaredSpotsOf(ctx, layer);
  for (const spot of spots) {
    if (spot.skill !== skill && !(spot.alt_skills ?? []).includes(skill)) continue;
    if (!(await spotSearched(ctx, layer, spot.id))) return spot;
  }
  return null;
}

function improvisedChalk(input: ImprovisedSearch, chalkPath: string, dice: DiceConvention): {
  frontmatter: Record<string, unknown>;
  body: string;
  finds: string[];
} {
  if (!isObject(input) || !nonEmpty(input.title) || input.title.length > 200) {
    fail('invalid_argument', 'improvise.title is required (at most 200 characters)');
  }
  if (input.body !== undefined && (typeof input.body !== 'string' || input.body.length > 2000)) {
    fail('invalid_argument', 'improvise.body must be text (at most 2000 characters)');
  }
  if (!isObject(input.outcomes)) fail('invalid_argument', 'improvise.outcomes needs failure, setback, success and great');
  const stem = chalkPath.replace(/\.md$/, '');
  const label = nonEmpty(input.continue_label) ? input.continue_label.slice(0, 80) : '→';
  const finds: string[] = [];
  // Bands in ascending roll order, as `runDeclaredRoll` checks them; each keeps its grade's text.
  const bands = dice.bands.map(({ grade, min, max }) => {
    const band = input.outcomes[grade];
    if (!isObject(band) || !nonEmpty(band.text) || band.text.length > 2000) {
      fail('invalid_argument', `improvise.outcomes.${grade}.text is required (at most 2000 characters)`);
    }
    const find = band.find;
    if (find !== undefined && (!isObject(find) || !nonEmpty(find.title) || typeof find.body !== 'string' || find.body.length > 4000)) {
      fail('invalid_argument', `improvise.outcomes.${grade}.find needs a title and a body`);
    }
    if (band.harm !== undefined && !['light', 'serious', 'grave'].includes(band.harm as string)) {
      fail('invalid_argument', `improvise.outcomes.${grade}.harm must be light, serious or grave`);
    }
    for (const key of ['cost', 'bonus'] as const) {
      if (band[key] === undefined) continue;
      const parsed = parseEffect(band[key]);
      if (!parsed.ok) fail('invalid_argument', `improvise.outcomes.${grade}.${key}: ${parsed.error}`);
      const refused = effectAllowed(outcomeOfGrade(grade)!, parsed.value);
      if (refused) fail('invalid_argument', `improvise.outcomes.${grade}.${key}: ${refused}`);
    }
    const rewardPath = `${stem}-${grade}.md`;
    if (find) finds.push(rewardPath);
    return {
      min,
      max,
      text: band.text,
      options: [{ id: 'narrate', label, action: { kind: 'writer', prompt: `Narrate the resolved search ${chalkPath}: read its actual roll and what it found. Do not create or move the found item; it already exists.` } }],
      ...(find ? { rewards: [{ path: rewardPath, title: find.title, body: find.body }] } : {}),
      ...(band.harm ? { harm: band.harm } : {}),
      ...(band.cost !== undefined ? { cost: band.cost } : {}),
      ...(band.bonus !== undefined ? { bonus: band.bonus } : {}),
    };
  });
  return {
    frontmatter: {
      type: 'chalk',
      title: input.title,
      roll_dice: { type: dice.type, desc: input.title, expect: dice.expect },
      dice_outcomes: bands,
    },
    body: input.body ?? '',
    finds,
  };
}

/** The skill check a declared search makes; null (the authored dice) when the world has no rules or the sheet lacks the skill. */
async function skillSearch(ctx: ActionContext, spot: SearchSpot): Promise<{ roll_dice: Record<string, unknown>; skill_check: Record<string, unknown> } | null> {
  try {
    const w = await rulesOfWorld(ctx.store);
    if (!w || !spot.skill) return null;
    const { label, value } = await resolveSkill(ctx.store, w, 'player', spot.skill);
    const spec = checkSpec({ system: w.rules.system, value, difficulty: spot.difficulty });
    return {
      roll_dice: { type: spec.type, desc: spot.roll_dice.desc, expect: spec.expect },
      skill_check: { skill: spot.skill, label, system: w.rules.system, actor: 'player', difficulty: spec.difficulty, target: spec.target, value: spec.value },
    };
  } catch {
    return null;
  }
}

export async function searchPlace(
  ctx: ActionContext,
  input: SearchPlaceInput
): Promise<ActionResult<SearchPlaceDetails>> {
  if (!isObject(input)) fail('invalid_argument', 'search needs a layer and a spot');
  const { layer, dice } = await resolveSearchLayer(ctx, input.layer);
  const readme = `${layerDirOf(layer)}/README.md`;
  const hasSpot = input.spot !== undefined && input.spot !== '';
  if (hasSpot === (input.improvise !== undefined)) {
    fail('invalid_argument', 'Pass exactly one of spot (a declared search) or improvise (a minor find)');
  }

  if (hasSpot) {
    const spotId = input.spot as string;
    if (!SPOT_ID.test(spotId)) fail('invalid_argument', `spot "${spotId}" must be kebab-case ASCII`);
    const text = (await ctx.store.statKind(readme)) === 'file' ? await ctx.store.readFile(readme) : '';
    const { spots, errors } = parseSearchDeclarations(parseFrontmatter(text).frontmatter);
    const spot = spots.find((candidate) => candidate.id === spotId);
    if (!spot) fail('not_found', `${readme} declares no searchable spot "${spotId}"`);
    const own = errors.filter((message) => message.includes(`"${spotId}"`) || !message.startsWith('search "'));
    if (own.length > 0) fail('invalid_field_value', `${readme}: ${own[0]}`);
    const path = searchChalkPath(layer, spotId);
    const finds = searchFinds(spot);
    const details = { path, layer, spot: spotId, finds };
    // Idempotent: a spot is searched once. Its chalk (rolled or not) is the answer.
    if ((await ctx.store.statKind(path)) === 'file') {
      return { text: `"${spot.title}" is already being searched (${path}).`, details: { ...details, created: false } };
    }
    if (await wasCreated(ctx, path)) fail('already_exists', `"${spot.title}" has already been searched.`);
    // "No item before the roll": a find that is already on disk means the place
    // was authored with the loot pre-placed; refuse rather than hand it over twice.
    for (const find of finds) {
      if ((await ctx.store.statKind(find)) === 'file') {
        fail('invalid_field_value', `search "${spotId}": "${find}" already exists; declared finds are created by the roll, never placed beforehand`);
      }
    }
    // A skill search: the dice are the protagonist's skill check; the authored
    // roll_dice stays as the base the declared bands are read against.
    const asCheck = spot.skill ? await skillSearch(ctx, spot) : null;
    const created = await createEntity(ctx, {
      path,
      frontmatter: {
        type: 'chalk',
        title: spot.title,
        roll_dice: asCheck ? asCheck.roll_dice : spot.roll_dice,
        ...(asCheck ? { dice_base: { type: spot.roll_dice.type, expect: spot.roll_dice.expect }, skill_check: asCheck.skill_check } : {}),
        ...(spot.choice ? { choice: spot.choice } : {}),
        ...(spot.choice_actions ? { choice_actions: spot.choice_actions } : {}),
        ...(spot.dice_outcomes ? { dice_outcomes: spot.dice_outcomes } : {}),
        ...(spot.on ? { on: spot.on } : {}),
        search_source: { layer, spot: spotId },
      },
      body: spot.body,
    });
    return {
      text: `Search started: "${spot.title}" (${path}). The player rolls; nothing is found until the roll resolves.`,
      details: { ...details, created: true, event: created.details.event } as SearchPlaceDetails,
    };
  }

  // Improvised minor find: only the writer may improvise, and never over a declared spot.
  if (ctx.actor.type !== 'writer' && ctx.actor.type !== 'god') {
    fail('invalid_argument', 'Only the writer may improvise a search; players search declared spots');
  }
  let n = 1;
  let path = `${layerDirOf(layer)}/search-${n}.md`;
  while ((await ctx.store.statKind(path)) !== 'missing' || (await wasCreated(ctx, path))) {
    n += 1;
    if (n > 99) fail('invalid_argument', 'Too many improvised searches in this place');
    path = `${layerDirOf(layer)}/search-${n}.md`;
  }
  const chalk = improvisedChalk(input.improvise as ImprovisedSearch, path, dice);
  const created = await createEntity(ctx, {
    path,
    frontmatter: { ...chalk.frontmatter, search_source: { layer, spot: `improvised-${n}` } },
    body: chalk.body,
  });
  return {
    text: `Search started: "${input.improvise!.title}" (${path}). The player rolls; nothing is found until the roll resolves.`,
    details: { path, layer, spot: `improvised-${n}`, created: true, finds: chalk.finds, event: created.details.event } as SearchPlaceDetails,
  };
}

registerAction('searchPlace', (ctx, input) => searchPlace(ctx, input as unknown as SearchPlaceInput));
