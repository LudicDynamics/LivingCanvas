import type { WorldEvent } from '../schemas/events.js';
import { entityName, parseFrontmatter } from '../schemas/frontmatter.js';
import {
  diceRange,
  evaluateExpect,
  parseDiceType,
  parseExpect,
  patchRollDiceResult,
  rollOnce,
} from '../rules/dice.js';
import { ActionError, fail } from './errors.js';
import { registerAction } from './service.js';
import type { ActionContext, ActionResult } from './types.js';
import { runTriggeredCommands } from '../commands/trigger.js';
import { naturalOfTotal, resolveCheck, rollCheck, tierLabel, type CheckGrade, type CheckOutcome } from '../rules/skills.js';
import { diceConventionOf, diceGradeOf } from '../rules/themes.js';
import { stringifyFrontmatter } from '../schemas/frontmatter.js';
import { applySkillAftermath, currentSpecOf, skillCheckOf } from './skill-cards.js';
import { commandReceiptText, commandReceipts } from '../commands/receipt.js';
import { outcomeOfRoll, outcomeRank, type OutcomeTier } from '../rules/outcome-tiers.js';

export interface RollDiceInput {
  /** World-root relative path, POSIX, no leading './' (00 §2.1). An existing single .md file. */
  path: string;
  /**
   * **god only** (doc-21 §4.3). A non-god passing this is `dice_forced_not_allowed`
   * (403) — never silently ignored (01 §2.4). Must be an integer inside `diceRange`.
   */
  forcedResult?: number;
}

export interface RollDiceDetails {
  /** == input.path (stable id). */
  path: string;
  /** The entity's name at this moment (`entityName`, 06 §2.3). */
  name: string;
  /** The declared expression, verbatim, e.g. "1d100". */
  dice: string;
  /** The declared check name, e.g. "Pick the rusted lock". */
  desc: string;
  /** The declared pass condition, verbatim, e.g. ">50". */
  expect: string;
  /** Final score (sum of the dice + modifier). */
  result: number;
  /** Verdict against `expect`. */
  passed: boolean;
  /** Individual faces (`1d100` → [62], `2d6` → [3,4]) for the dice animation. */
  rolls: number[];
  /** Every die shows its max face — the animation enlarges the success. */
  crit: boolean;
  /** Every die shows 1 — the animation plays a big failure. */
  fumble: boolean;
  /** True when god forged this score via `forcedResult` (show the total only, no faces). */
  forged: boolean;
  /** `resolveLayer(path)` (01 §3.9); null for bag / character-nook entities. */
  layer: string | null;
  /**
   * A skill check's verdict: which skill, the
   * number the player saw, the tier and the four-band grade. Absent on a plain roll.
   */
  skill?: RollSkillDetails;
  /**
   * The ONE outcome tier every roll resolves to:
   * crit_success / success / fail / crit_fail.
   */
  outcome: OutcomeTier;
}

export interface RollSkillDetails {
  id: string;
  label: string;
  system: 'coc' | 'dnd';
  actor: string;
  difficulty: string;
  advantage?: 'advantage' | 'disadvantage';
  /** coc: the number to roll under; dnd: the DC. */
  target: number;
  /** coc: the skill %; dnd: the modifier. */
  value: number;
  tier: string;
  /** The tier in the world's language, for the ceremony line. */
  tierLabel: string;
  grade: CheckGrade;
  rank: number;
  /** coc: the skill was marked for improvement by this success. */
  marked?: boolean;
  /** Sanity lost by a sanity check. */
  sanityLoss?: number;
  /** A companion lent its number: who it was. */
  assist?: { actor: string; name: string };
}

function diceBreakdown(rolls: number[], modifier: number, result: number): string {
  if (rolls.length === 1 && modifier === 0) return String(result);
  const sign = modifier > 0 ? `+${modifier}` : modifier < 0 ? `-${-modifier}` : '';
  return `${rolls.join('+')}${sign} = ${result}`;
}

function verdict(passed: boolean): string {
  return passed ? 'passed' : 'failed';
}

/** "Rolled 1d100 for "…" (world/x.md): 62 — passed (>50)." (§2.3) */
function rolledText(d: RollDiceDetails, breakdown: string): string {
  return `Rolled ${d.dice} for "${d.desc}" (${d.path}): ${breakdown} — ${verdict(d.passed)} (${d.expect}).`;
}

function alreadyRolledMessage(path: string, result: number, passed: boolean | undefined): string {
  const old = passed === undefined ? `${result}` : `${result}, ${verdict(passed)}`;
  return `"${path}" already has a rolled result (${old}); edit the file to remove it, then roll again`;
}

function assertForcedResultUsable(
  forcedResult: number,
  dice: string,
  min: number,
  max: number
): void {
  if (typeof forcedResult !== 'number' || !Number.isInteger(forcedResult)) {
    fail('invalid_argument', `forcedResult must be an integer, got ${forcedResult}`);
  }
  if (forcedResult < min || forcedResult > max) {
    fail('invalid_argument', `forcedResult ${forcedResult} is outside the range of ${dice} (${min}..${max})`);
  }
}

/**
 * Resolve an entity's declared dice check (doc-tools/07). The engine reads
 * `type / desc / expect` from the file, rolls true random, judges the result,
 * writes `result / passed` back into the file and records `roll_resolved`.
 *
 * The caller can never supply the outcome: `forcedResult` is god-only and is the
 * single, event-recording exception (doc-21 §4.3).
 */
export async function rollDice(
  ctx: ActionContext,
  input: RollDiceInput
): Promise<ActionResult<RollDiceDetails>> {
  const path = input.path;
  if (typeof path !== 'string' || path === '') {
    fail('invalid_argument', 'Path must not be empty');
  }

  // Step 2 — the forgery gate runs on the CALLER, before the file is even read.
  const forged = input.forcedResult !== undefined;
  if (forged && ctx.actor.type !== 'god') {
    fail(
      'dice_forced_not_allowed',
      `A forged dice result requires actor 'god', got '${ctx.actor.type}'`
    );
  }

  // Step 3 — read the source of truth. `readFile` runs `resolvePath` first, so an
  // unsafe path fails as `invalid_path` (400) rather than being misreported as
  // `not_found`; only a genuine ENOENT / EISDIR becomes `not_found` (§7.1 rows 2-4).
  let raw: string;
  try {
    raw = await ctx.store.readFile(path);
  } catch (err) {
    if (err instanceof ActionError) throw err;
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'EISDIR') fail('not_found', `File "${path}" not found`);
    fail('internal', `Could not read "${path}": ${(err as Error).message}`);
  }
  const parsed = parseFrontmatter(raw);
  if (parsed.frontmatter === null) {
    fail('malformed_entity', `"${path}" has no YAML frontmatter block`);
  }

  // Step 3b — a search's dice belong to the player:
  // the writer spawns the dice chalk, the player rolls it, and only the
  // player's roll path materializes the finds. An agent rolling it would
  // adjudicate the search without creating what it found.
  if (
    parsed.frontmatter.search_source != null &&
    ctx.actor.type !== 'player' &&
    ctx.actor.type !== 'god'
  ) {
    fail('not_interactive', `"${path}" is a search the player rolls; leave the dice to them and narrate after it resolves`);
  }

  // Step 3c — a skill check belongs to whoever's sheet it reads: the
  // protagonist's card waits for the player (like a search); a character's is
  // rolled by that character, the writer or god.
  const skill = skillCheckOf(parsed.frontmatter);
  if (skill && ctx.actor.type !== 'god' && ctx.actor.type !== 'engine') {
    const mine = skill.actor === 'player'
      ? ctx.actor.type === 'player'
      : ctx.actor.type === 'writer' || (ctx.actor.type === 'character' && ctx.actor.id === skill.actor);
    if (!mine) {
      fail('not_interactive', skill.actor === 'player'
        ? `"${path}" is the protagonist's skill check; the player rolls it. Narrate after it resolves`
        : `"${path}" is ${skill.actor}'s own skill check`);
    }
  }

  // Step 4 — the declaration. Normalized-missing is `not_interactive`, never
  // `malformed_entity` (that one is for a broken frontmatter block; REVIEW m-4).
  const declared = parsed.interactive.roll_dice;
  if (declared === null) {
    const hasBlock = parsed.frontmatter.roll_dice != null;
    const reason = parsed.errors[0] ? `: ${parsed.errors[0]}` : '';
    fail(
      'not_interactive',
      hasBlock
        ? `"${path}" declares roll_dice but is missing "expect"${reason}`
        : `"${path}" declares no roll_dice check${reason}`
    );
  }

  // Step 4b — a skill check reads the CURRENT sheet: the dice it rolls are the
  // skill's, whatever the card froze when it was framed.
  const check = skill ? await currentSpecOf(ctx.store, skill, await ctx.store.resolveLayer(path)) : null;
  if (check) {
    declared.type = check.spec.type;
    declared.expect = check.spec.expect;
  }

  // Step 5 — parse the declared expression and condition.
  const spec = parseDiceType(declared.type);
  if (!spec.ok) fail('invalid_field_value', spec.error);
  const ast = parseExpect(declared.expect);
  if (!ast.ok) fail('invalid_field_value', ast.error);

  // Step 6 — re-roll gate. Existing `result` is the only reliable signal that
  // this check was already adjudicated; god + forcedResult may overwrite (§3.3).
  const previousResult = declared.result;
  const overwrite = forged && previousResult !== undefined;
  if (previousResult !== undefined && !overwrite) {
    fail('dice_already_rolled', alreadyRolledMessage(path, previousResult, declared.passed));
  }

  // Step 7 — produce the score.
  const { min, max } = diceRange(spec.value);
  let rolls: number[];
  let result: number;
  let crit: boolean;
  let fumble: boolean;
  let outcome: CheckOutcome | null = null;
  if (check) {
    // A skill check: tier and grade come from the rule system, not the faces.
    let thrown: number[];
    if (forged) {
      const forcedResult = input.forcedResult as number;
      assertForcedResultUsable(forcedResult, declared.type, min, max);
      outcome = resolveCheck(check.spec, naturalOfTotal(check.spec, forcedResult));
      thrown = [outcome.natural];
    } else {
      const r = rollCheck(check.spec, ctx.rng ?? Math.random);
      outcome = r;
      thrown = r.rolls;
    }
    rolls = thrown;
    result = outcome.total;
    crit = outcome.crit;
    fumble = outcome.fumble;
  } else if (forged) {
    const forcedResult = input.forcedResult as number;
    assertForcedResultUsable(forcedResult, declared.type, min, max);
    rolls = [forcedResult];
    result = forcedResult;
    crit = rolls.every((r) => r === spec.value.faces);
    fumble = rolls.every((r) => r === 1);
  } else {
    const rng = ctx.rng ?? Math.random;
    ({ rolls, result, crit, fumble } = rollOnce(spec.value, rng));
  }

  // Step 8 — judge. A skill check's tier decides (a natural 20 passes, 96+ fumbles).
  const passed = outcome ? outcome.passed : evaluateExpect(ast.value, result);
  const name = entityName(parsed.frontmatter, path);
  const layer = await ctx.store.resolveLayer(path);

  const details: RollDiceDetails = {
    path,
    name,
    dice: declared.type,
    desc: declared.desc,
    expect: declared.expect,
    result,
    passed,
    rolls,
    crit,
    fumble,
    forged,
    layer,
    outcome: 'fail',
  };
  const locale = skill ? String(((await ctx.store.getManifest()) as { locale?: unknown }).locale ?? 'en') : 'en';
  if (skill && check && outcome) {
    details.skill = {
      id: skill.skill,
      label: check.label,
      system: skill.system,
      actor: skill.actor,
      difficulty: check.spec.difficulty,
      ...(check.spec.advantage !== 'none' ? { advantage: check.spec.advantage } : {}),
      target: check.spec.target,
      value: check.spec.value,
      tier: outcome.tier,
      tierLabel: tierLabel(skill.system, outcome.tier, locale),
      grade: outcome.grade,
      rank: outcome.rank,
      ...(check.assist ? { assist: check.assist } : {}),
    };
  }
  const convention = diceConventionOf(declared.type, declared.expect);
  const grade: CheckGrade | null = details.skill?.grade ?? (convention ? diceGradeOf(convention, result) : null);
  details.outcome = outcomeOfRoll({ grade, passed, crit, fumble });

  // §3.3 quotes the overwrite line verbatim; the plain-forgery line mirrors the roll line.
  const text = forged
    ? overwrite
      ? `Overwrote the previous result (${previousResult}) with a forged ${result} for "${declared.desc}" (${path}).`
      : `Forged ${result} for "${declared.desc}" (${path}) — ${verdict(passed)} (${declared.expect}).`
    : rolledText(details, diceBreakdown(rolls.length > 1 && outcome ? [outcome.natural] : rolls, spec.value.modifier, result));
  const skillText = details.skill ? ` ${details.skill.label} (${details.skill.system === 'coc' ? `${details.skill.target}%` : `DC ${details.skill.target}`}): ${details.skill.tierLabel} [grade ${details.skill.grade}].` : '';

  // Step 9 — surgical rewrite of the two lines inside the roll_dice block.
  let next: string;
  try {
    if (skill && check) {
      // A skill card is the engine's own file: rewrite the block whole, with
      // the dice the sheet decided. A declared outcome table keeps its authored
      // base so its bands still read as the four grades (skill-cards.ts).
      const fm = parsed.frontmatter as Record<string, unknown>;
      const rd = fm.roll_dice as Record<string, unknown>;
      const keepBase = Array.isArray(fm.dice_outcomes) && fm.dice_base === undefined && (rd.type !== check.spec.type || rd.expect !== check.spec.expect);
      next = stringifyFrontmatter({
        ...fm,
        roll_dice: { ...rd, type: check.spec.type, expect: check.spec.expect, result, passed },
        ...(keepBase ? { dice_base: { type: rd.type, expect: rd.expect } } : {}),
        skill_check: {
          ...Object.fromEntries(Object.entries(fm.skill_check as Record<string, unknown>).filter(([k]) => k !== 'assist')),
          label: check.label, target: check.spec.target, value: check.spec.value, difficulty: check.spec.difficulty,
          ...(check.assist ? { assist: check.assist.actor } : {}),
        },
      }, parsed.body);
    } else {
      next = patchRollDiceResult(raw, result, passed);
    }
  } catch (err) {
    // Inline YAML / no block: never guess, never rewrite the author's frontmatter.
    fail('malformed_entity', `"${path}" cannot be updated: ${(err as Error).message}`);
  }

  // Step 10 — atomic write. On failure the original file is untouched.
  try {
    await ctx.store.writeFileAtomic(path, next);
  } catch (err) {
    fail('write_failed', `Failed to write "${path}": ${(err as Error).message}`);
  }

  // Step 11 — record the event, once. The file is the truth (00 constraint 1), so
  // the event must describe a change that already happened; a failure here is
  // reported without rolling the file back (01 §3.6).
  let event: WorldEvent;
  try {
    event = await ctx.store.appendEvent({
      type: 'roll_resolved',
      actor: ctx.actor,
      detail: {
        path,
        name,
        dice: declared.type,
        desc: declared.desc,
        expect: declared.expect,
        result,
        passed,
        outcome: details.outcome,
        ...(details.skill ? { skill: { id: details.skill.id, actor: details.skill.actor, target: details.skill.target, tier: details.skill.tier, grade: details.skill.grade } } : {}),
      },
      subject: path,
      turn: ctx.turn,
      ...(layer === null ? {} : { layer }),
    });
  } catch (err) {
    fail(
      'event_failed',
      `File "${path}" was updated with result ${result} but the world event could not be recorded: ${(err as Error).message}`
    );
  }

  // Step 11a — a skill check's aftermath: improvement mark, sanity loss.
  if (skill && details.skill && outcome) {
    const after = await applySkillAftermath(ctx, skill, outcome, { assisted: !!check?.assist });
    if (after.marked) details.skill.marked = true;
    if (after.sanityLoss) details.skill.sanityLoss = after.sanityLoss;
  }
  const RANK: Record<CheckGrade, number> = { failure: 1, setback: 2, success: 3, great: 4 };

  // Steps 11b/12 — world commands bound to this entity.
  // Runs AFTER the event landed: a command may only react to a fact that is
  // already true. NEVER throws — the roll is already adjudicated, and the
  // re-roll gate would turn a thrown error into a dead end.
  const commands = await runTriggeredCommands(ctx, {
    source: path,
    hook: 'roll_resolved',
    mode: 'fresh',
    parsed,
    facts: {
      'roll.result': result,
      'roll.passed': passed,
      'roll.crit': crit,
      'roll.fumble': fumble,
      'roll.forged': forged,
      'roll.dice': declared.type,
      'roll.expect': declared.expect,
      'roll.desc': declared.desc,
      'roll.name': name,
      'roll.layer': layer,
      'roll.grade': grade,
      'roll.rank': grade ? RANK[grade] : null,
      'roll.tier': details.skill?.tier ?? null,
      'roll.outcome': details.outcome,
      'roll.outcome_rank': outcomeRank(details.outcome),
      'roll.skill': details.skill?.id ?? null,
      'roll.target': details.skill?.target ?? null,
      'trigger.path': path,
      'trigger.name': name,
      'trigger.id': null,
      actor: ctx.actor.type,
      actor_id: ctx.actor.id ?? null,
      layer,
    },
  });

  // Step 12 — return the stable details payload the router / toolkit wrap.
  // `...(commands ? { commands } : {})` is NOT style: no `on` ⇒ no `commands`
  // key; a declared `on` ⇒ always a `commands` key, even all-skipped. That is
  // what makes "wrote `on`, nothing ran" impossible to miss in the response.
  //
  // The receipt rides `text`: for a WRITER-triggered
  // command the events are excluded from its own next injection (`excludeActor`)
  // and the cursor has already passed them, so this is the only channel that
  // reaches the model in the SAME turn. Original text FIRST, receipt after
  // (10 §8.2 item 3); '' when nothing matched keeps the text byte-identical.
  return {
    text: text + skillText + commandReceiptText(commandReceipts(commands)),
    details: { ...details, event, ...(commands ? { commands } : {}) },
  };
}

registerAction('rollDice', (ctx, input) => rollDice(ctx, input as unknown as RollDiceInput));
