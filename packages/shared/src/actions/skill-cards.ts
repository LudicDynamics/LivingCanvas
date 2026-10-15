/**
 * Character sheets and skill-check cards: the shared reading side of
 * the design notes `rollDice` (resolving a card), the
 * `skillCheck` action (framing one), hidden-hp harm and the server's declared
 * roll all read cards through here, so a card means the same thing everywhere.
 */
import { parseFrontmatter, stringifyFrontmatter } from '../schemas/frontmatter.js';
import {
  catalogSkill,
  checkSpec,
  dndSkillModifier,
  parseSheet,
  skillLocaleOf,
  worldRulesOf,
  BAND_GRADES_ASCENDING,
  type CharacterSheet,
  type CheckGrade,
  type CheckOutcome,
  type CheckSpec,
  type SheetSkill,
  type WorldRules,
} from '../rules/skills.js';
import { currentStateValue } from '../rules/states.js';
import { diceConventionOf } from '../rules/themes.js';
import type { WorldStore } from '../store/world-store.js';
import { fail } from './errors.js';
import { readStateFile, writeState } from './states.js';
import type { ActionContext } from './types.js';
import { rollerFor } from './assist.js';

export const SKILL_GRADES: readonly CheckGrade[] = ['failure', 'setback', 'success', 'great'];

function isObject(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

/** The `skill_check:` block a check card carries. */
export interface SkillCheckBlock {
  skill: string;
  label: string;
  system: 'coc' | 'dnd';
  /** `player` or a character id. */
  actor: string;
  difficulty: string;
  advantage?: 'advantage' | 'disadvantage';
  target: number;
  value: number;
  /** coc sanity check: losses on a pass / a fail. */
  sanity?: { pass: number; fail: number };
  /** The companion who lent its skill when the card was framed; re-decided at roll time. */
  assist?: string;
}

export function skillCheckOf(fm: Record<string, unknown> | null | undefined): SkillCheckBlock | null {
  const b = fm?.skill_check;
  if (!isObject(b) || !nonEmpty(b.skill) || (b.system !== 'coc' && b.system !== 'dnd')) return null;
  const sanity = isObject(b.sanity) && Number.isFinite(Number(b.sanity.pass)) && Number.isFinite(Number(b.sanity.fail))
    ? { pass: Math.max(0, Math.round(Number(b.sanity.pass))), fail: Math.max(0, Math.round(Number(b.sanity.fail))) }
    : undefined;
  return {
    skill: b.skill,
    label: nonEmpty(b.label) ? b.label : b.skill,
    system: b.system,
    actor: nonEmpty(b.actor) ? b.actor : 'player',
    difficulty: b.difficulty === undefined ? (b.system === 'coc' ? 'regular' : '12') : String(b.difficulty),
    ...(b.advantage === 'advantage' || b.advantage === 'disadvantage' ? { advantage: b.advantage } : {}),
    target: Number(b.target) || 0,
    value: Number(b.value) || 0,
    ...(sanity ? { sanity } : {}),
    ...(nonEmpty(b.assist) ? { assist: b.assist } : {}),
  };
}

/** `player/README.md` or `characters/<id>/README.md`. */
export function sheetPathOf(actor: string): string {
  return actor === 'player' ? 'player/README.md' : `characters/${actor}/README.md`;
}

export interface LoadedSheet {
  path: string;
  sheet: CharacterSheet;
  errors: string[];
  frontmatter: Record<string, unknown>;
}

/** Read whoever's sheet; null when the README or its `sheet:` is missing. */
export async function readSheet(store: WorldStore, actor: string, rules: WorldRules, locale?: unknown): Promise<LoadedSheet | null> {
  const path = sheetPathOf(actor);
  if ((await store.statKind(path)) !== 'file') return null;
  const fm = parseFrontmatter(await store.readFile(path)).frontmatter ?? {};
  const { sheet, errors } = parseSheet(fm, rules.system, locale);
  return sheet ? { path, sheet, errors, frontmatter: fm } : null;
}

export interface WorldRulesContext {
  rules: WorldRules;
  locale: string;
}

export async function rulesOfWorld(store: WorldStore): Promise<WorldRulesContext | null> {
  const manifest = await store.getManifest();
  const rules = worldRulesOf(manifest);
  return rules ? { rules, locale: String((manifest as { locale?: unknown }).locale ?? 'en') } : null;
}

/** The skill as the check sees it: its label and its coc % or dnd modifier. */
export async function resolveSkill(
  store: WorldStore,
  w: WorldRulesContext,
  actor: string,
  skillId: string,
): Promise<{ label: string; value: number; skill: SheetSkill | null }> {
  const lang = skillLocaleOf(w.locale);
  if (skillId === 'sanity') {
    if (w.rules.system !== 'coc' || !w.rules.sanity) fail('invalid_argument', 'This world has no sanity checks (rules.sanity is off)');
    if (actor !== 'player') fail('invalid_argument', 'Only the protagonist makes sanity checks');
    const file = await readStateFile(store, 'player/README.md');
    const decl = file?.states.find((s) => s.id === 'sanity' && s.type === 'number');
    if (!file || !decl) fail('invalid_argument', 'player/README.md declares no sanity state');
    const value = Number(currentStateValue(decl, file.data));
    return { label: decl.label || catalogSkill('coc', 'sanity')!.label[lang], value: Math.max(1, Math.min(99, value)), skill: null };
  }
  const loaded = await readSheet(store, actor, w.rules, w.locale);
  if (!loaded) fail('not_found', `${sheetPathOf(actor)} has no character sheet (sheet:)`);
  const skill = loaded.sheet.skills.find((s) => s.id === skillId);
  if (!skill) {
    fail('not_found', `${sheetPathOf(actor)} has no skill "${skillId}" (its skills: ${loaded.sheet.skills.map((s) => s.id).join(', ') || 'none'})`);
  }
  const value = w.rules.system === 'coc' ? skill.value ?? 1 : dndSkillModifier(loaded.sheet, skill, w.rules.proficiency);
  return { label: skill.label, value, skill };
}

/**
 * The card's check against the CURRENT sheet. Falls back to the values frozen
 * on the card when the sheet or the skill has gone, so a card always stays rollable.
 * With `page` (where the card is), a protagonist's check is rolled with a
 * companion's number when one with the player lends a better skill (`assist`).
 */
export async function currentSpecOf(
  store: WorldStore,
  block: SkillCheckBlock,
  page?: string | null,
): Promise<{ spec: CheckSpec; label: string; assist?: { actor: string; name: string } }> {
  const frozen = () => ({
    spec: checkSpec({ system: block.system, value: block.value, difficulty: block.difficulty, advantage: block.advantage }),
    label: block.label,
  });
  try {
    const w = await rulesOfWorld(store);
    if (!w || w.rules.system !== block.system) return frozen();
    if (block.actor === 'player' && block.skill !== 'sanity' && page) {
      const who = await rollerFor(store, w, block.skill, page);
      if (who && who.actor !== 'player') {
        return {
          spec: checkSpec({ system: block.system, value: who.value, difficulty: block.difficulty, advantage: block.advantage }),
          label: who.label,
          assist: { actor: who.actor, name: who.name },
        };
      }
    }
    const { label, value } = await resolveSkill(store, w, block.actor, block.skill);
    return { spec: checkSpec({ system: block.system, value, difficulty: block.difficulty, advantage: block.advantage }), label };
  } catch {
    return frozen();
  }
}

/**
 * Which grade each `dice_outcomes` band stands for, in declared order: an
 * explicit `grade:` wins; otherwise the band's position in the authored base
 * convention (`dice_base`, or the card's own `roll_dice` when it is not a skill
 * check). Null when the table cannot be read that way.
 */
export function bandGradesOf(fm: Record<string, unknown>): Array<CheckGrade | null> | null {
  const bands = fm.dice_outcomes;
  if (!Array.isArray(bands)) return null;
  const base = isObject(fm.dice_base) ? fm.dice_base : isObject(fm.roll_dice) ? fm.roll_dice : null;
  const convention = base ? diceConventionOf(base.type, base.expect) : null;
  const positional = convention
    ? BAND_GRADES_ASCENDING[convention.bands[0].grade === 'great' ? 'low' : 'high']
    : bands.length === 4 ? BAND_GRADES_ASCENDING.high : null;
  return bands.map((b, i) => {
    if (isObject(b) && SKILL_GRADES.includes(b.grade)) return b.grade as CheckGrade;
    return positional?.[i] ?? null;
  });
}

/** Index of the band a grade selects; -1 when none. */
export function bandIndexOfGrade(fm: Record<string, unknown>, grade: CheckGrade): number {
  const grades = bandGradesOf(fm);
  return grades ? grades.indexOf(grade) : -1;
}

/**
 * After a skill card resolves: a coc success marks the protagonist's skill for
 * improvement (once; `status.data.skill_marks`), and a sanity check costs its
 * declared sanity. Fail-soft — the roll is already adjudicated.
 */
export async function applySkillAftermath(
  ctx: ActionContext,
  block: SkillCheckBlock,
  outcome: Pick<CheckOutcome, 'passed'>,
  opts: { assisted?: boolean } = {},
): Promise<{ marked?: string; sanityLoss?: number }> {
  const out: { marked?: string; sanityLoss?: number } = {};
  try {
    if (block.actor !== 'player') return out;
    if (block.skill === 'sanity' && block.sanity) {
      const loss = outcome.passed ? block.sanity.pass : block.sanity.fail;
      if (loss > 0) {
        await writeState({ ...ctx, actor: { type: 'engine' } }, { target: 'player', state: 'sanity', by: -loss });
        out.sanityLoss = loss;
      }
      return out;
    }
    // A companion's number did the work: nothing for the protagonist to improve.
    if (block.system !== 'coc' || !outcome.passed || block.skill === 'luck' || opts.assisted) return out;
    const path = 'player/README.md';
    if ((await ctx.store.statKind(path)) !== 'file') return out;
    const parsed = parseFrontmatter(await ctx.store.readFile(path));
    const fm = parsed.frontmatter ?? {};
    const status = isObject(fm.status) ? fm.status : {};
    const data = isObject(status.data) ? status.data : {};
    const marks = Array.isArray(data.skill_marks) ? data.skill_marks.filter((m: unknown) => typeof m === 'string') : [];
    if (marks.includes(block.skill)) return out;
    await ctx.store.writeFileAtomic(
      path,
      stringifyFrontmatter({ ...fm, status: { ...status, data: { ...data, skill_marks: [...marks, block.skill] } } }, parsed.body),
    );
    out.marked = block.skill;
  } catch {
    // never undo a roll over its aftermath
  }
  return out;
}

