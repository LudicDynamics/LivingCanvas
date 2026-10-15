/**
 * Authoring checks for a clock that moves with the player's turns (world.json
 * `clock.perTurns`, packages/shared/src/actions/turn-clock.ts), run by
 * `check:worlds` for every template. The runtime is fail-soft (a counter it
 * cannot read counts from 0); this gate is where a slip becomes visible.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { TURN_CLOCK_KEY, parseFrontmatter, parseStateDecls, parseWorldCommand } from '../packages/shared/dist/index.js';

const exists = (f) => fs.stat(f).then(() => true, () => false);

/** Every problem with `clock.perTurns`. `[]` = clean (and for a world whose clock does not move by turns). */
export async function turnClockProblems(root, manifest) {
  const clock = manifest?.clock;
  if (!clock || clock.perTurns === undefined) return [];
  const problems = [];
  const n = clock.perTurns;
  if (!Number.isInteger(n) || n < 1 || n > 50) {
    problems.push('world.json: clock.perTurns must be a whole number from 1 to 50 (player turns per clock step)');
    return problems;
  }
  const file = path.join(root, clock.path ?? '');
  if (typeof clock.path !== 'string' || !(await exists(file))) {
    problems.push(`world.json: clock.path ${JSON.stringify(clock.path)} does not exist (the turn count lives on that card)`);
    return problems;
  }
  const parsed = parseFrontmatter(await fs.readFile(file, 'utf8')).frontmatter;
  // A card whose YAML does not parse reads as having no counter at all (found 2026-10-13: a `: ` in a plain intent).
  if (!parsed) {
    problems.push(`${clock.path}: the frontmatter does not parse as YAML (quote a value that contains ": ")`);
    return problems;
  }
  const fm = parsed;
  const raw = fm.status?.data?.[TURN_CLOCK_KEY];
  if (raw !== undefined && !(Number.isInteger(Number(raw)) && Number(raw) >= 0 && Number(raw) < n)) {
    problems.push(`${clock.path}: status.data.${TURN_CLOCK_KEY} must start as a whole number from 0 to ${n - 1} (turns spent in this step)`);
  }
  const decl = parseStateDecls(fm).states.find((s) => s.id === TURN_CLOCK_KEY);
  if (decl) {
    if (decl.type !== 'number') problems.push(`${clock.path}: the "${TURN_CLOCK_KEY}" state must be a number`);
    else {
      if (decl.initial !== 0) problems.push(`${clock.path}: the "${TURN_CLOCK_KEY}" state starts at 0`);
      if (decl.range && (decl.range[0] !== 0 || decl.range[1] !== n - 1)) problems.push(`${clock.path}: the "${TURN_CLOCK_KEY}" state's range is [0, ${n - 1}] (clock.perTurns ${n})`);
    }
  }
  if (clock.key === TURN_CLOCK_KEY) problems.push(`world.json: clock.key cannot be "${TURN_CLOCK_KEY}" when the clock moves by turns (that key is the turn count)`);
  // The clock card is read, not pressed: a `tick` behind one of its own options is the old 「撕日历」 way back in.
  const runs = Array.isArray(fm.on?.choice_selected) ? fm.on.choice_selected.map((b) => b?.run).filter((r) => typeof r === 'string') : [];
  for (const id of runs) {
    const cmd = path.join(root, 'command', `${id}.yaml`);
    if (!(await exists(cmd))) continue;
    const parsed = parseWorldCommand(id, await fs.readFile(cmd, 'utf8'));
    if (parsed.ok && parsed.command.steps.some((s) => s.action === 'tick')) {
      problems.push(`${clock.path}: an option runs command/${id}.yaml, which ticks — with clock.perTurns the player's turns move the clock, not a button`);
    }
  }
  return problems;
}
