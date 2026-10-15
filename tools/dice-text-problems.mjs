/**
 * Dice card prose vs the roll the player actually makes.
 *
 * A dice card's words (search spot body / label / title / band texts, or a
 * card's body and `dice_outcomes` texts) must not name a die the player does
 * not roll. The roll is NOT always `roll_dice.type`: in a world with `rules`,
 * a search spot with `skill:` or a card with a `skill_check:` block whose skill
 * is on the protagonist's sheet rolls the sheet's check instead — 1d100 at or
 * under the skill (coc), d20 + modifier (dnd) — and the authored `roll_dice`
 * (e.g. 2d10 >= 11) stays only as the base its four bands are read against
 * (packages/shared/src/actions/search.ts `skillSearch`, roll-dice.ts step 4b).
 *
 * For a coc skill card the prose's numbers must fit that roll too: a
 * "1d100 (Skill NN)" line names the sheet's value, and a written band table
 * (one that has 96–100) lists 1–⌊v/5⌋ / ⌊v/5⌋+1–v / v+1–95 / 96–100.
 *
 * Used by `check:worlds` for every template, experimental ones included.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseFrontmatter, parseSearchDeclarations, parseSheet, worldRulesOf } from '../packages/shared/dist/index.js';
import { filesUnder } from './localize-world-editions.mjs';

/** A die named in prose: `d100`, `1d100`, `2d10`, `D20`… (not part of a longer word). */
const DIE = /(?<![\p{L}\p{N}_])(\d*)[dD](\d+)(?![\p{L}\p{N}_])/gu;
/** `1d100 (Mechanical Repair 60)` / `1d100（机械维修 60）`: the number before the closing bracket. */
const D100_VALUE = /(?<![\p{L}\p{N}_])1?[dD]100\s*[（(][^)）\n]*?(\d+)\s*[)）]/gu;
const RANGE = /(?<!\d)(\d{1,3})\s*[–\-~〜～]\s*(\d{1,3})(?!\d)/g;

const dieOf = (count, faces) => ({ count: Number(count || 1), faces: Number(faces) });
/** The die a `roll_dice.type` throws: `2d10`, `1d100`, `d20`, `2d20kh1` (advantage: still a d20). */
function rolledDie(type) {
  const m = /^(\d*)d(\d+)(kh1|kl1)?/i.exec(String(type ?? '').trim());
  if (!m) return null;
  return m[3] ? { count: 1, faces: Number(m[2]), any: true } : dieOf(m[1], m[2]);
}
const sameDie = (rolled, named) => rolled.faces === named.faces && (rolled.any || rolled.count === named.count);
const show = (d) => `${d.any ? '' : d.count}d${d.faces}`;

const textsOf = (...values) => values.flat(Infinity).filter((v) => typeof v === 'string');

/** Problems for one card: `where` names it, `rolled` is the die thrown, `coc` the sheet value of a coc skill check. */
export function diceTextCardProblems(where, prose, rolledType, cocValue = null) {
  const problems = [];
  const rolled = rolledDie(rolledType);
  if (!rolled) return problems;
  const text = prose.join('\n');
  const named = new Map();
  for (const m of text.matchAll(DIE)) {
    const d = dieOf(m[1], m[2]);
    if (!sameDie(rolled, d)) named.set(show(d), m[0]);
  }
  for (const [die] of named) problems.push(`${where}: the text names ${die}, but the player rolls ${show(rolled)}`);
  if (cocValue != null && rolled.faces === 100) {
    for (const m of text.matchAll(D100_VALUE)) {
      if (Number(m[1]) !== cocValue) problems.push(`${where}: the text says the skill is ${m[1]}, but the sheet says ${cocValue}`);
    }
    const ranges = new Set([...text.matchAll(RANGE)].map((m) => `${Number(m[1])}-${Number(m[2])}`));
    if (ranges.has('96-100')) {
      const fifth = Math.max(1, Math.floor(cocValue / 5));
      const want = [`1-${fifth}`, `${fifth + 1}-${cocValue}`, `${cocValue + 1}-95`, '96-100'];
      const missing = want.filter((r) => !ranges.has(r));
      if (missing.length) problems.push(`${where}: the written bands miss ${missing.join(', ')} (1d100 at or under ${cocValue}: 1–${fifth} / ${fifth + 1}–${cocValue} / ${cocValue + 1}–95 / 96–100)`);
    }
  }
  return problems;
}

/** Every dice card in a world whose prose names a die (or a coc value / band) the player does not roll. */
export async function diceTextProblems(root, manifest) {
  const rules = worldRulesOf(manifest);
  const files = (await filesUnder(root)).filter((f) => f.endsWith('.md') && !f.startsWith('skills/'));
  let sheet = null;
  if (rules && files.includes('player/README.md')) {
    const fm = parseFrontmatter(await fs.readFile(path.join(root, 'player/README.md'), 'utf8')).frontmatter ?? {};
    sheet = parseSheet(fm, rules.system, manifest.locale).sheet;
  }
  /** The roll a skill makes on this world's sheet, or null when it rolls the authored dice. */
  const skillRoll = (skill) => {
    if (!rules || !skill) return null;
    const entry = sheet?.skills.find((s) => s.id === skill);
    if (!entry && !(skill === 'sanity' && rules.sanity) && skill !== 'luck') return null;
    return rules.system === 'coc' ? { type: '1d100', value: entry?.value ?? null } : { type: 'd20', value: null };
  };
  const problems = [];
  for (const f of files) {
    const parsed = parseFrontmatter(await fs.readFile(path.join(root, f), 'utf8'));
    const fm = parsed.frontmatter;
    if (!fm) continue;
    for (const spot of parseSearchDeclarations(fm).spots) {
      const raw = (Array.isArray(fm.search) ? fm.search : []).find((s) => s?.id === spot.id) ?? {};
      const roll = skillRoll(spot.skill);
      const prose = textsOf(raw.label, raw.title, raw.body, (raw.dice_outcomes ?? []).map((o) => o?.text));
      problems.push(...diceTextCardProblems(`${f}#${spot.id}`, prose, roll?.type ?? spot.roll_dice.type, roll?.value ?? null));
    }
    if (fm.roll_dice && typeof fm.roll_dice === 'object') {
      const roll = skillRoll(fm.skill_check?.skill);
      const prose = textsOf(parsed.body, fm.roll_dice.desc, (Array.isArray(fm.dice_outcomes) ? fm.dice_outcomes : []).map((o) => o?.text));
      problems.push(...diceTextCardProblems(f, prose, roll?.type ?? fm.roll_dice.type, roll?.value ?? null));
    }
  }
  return problems;
}
