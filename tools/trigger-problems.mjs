/**
 * Authoring checks for world triggers + declared states.
 * Used by `check:worlds` for every template that declares `triggers` (including
 * experimental ones, which the edition gate otherwise skips).
 *
 * The runtime is fail-soft (a bad trigger is dropped, an undeclared state reads
 * as "not yet"); this gate is where those mistakes become visible.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  parseFrontmatter,
  parseStateDecls,
  parseWorldTriggers,
  parseTriggerCondition,
  characterRefRoot,
  parseWorldCommand,
  collectRefPaths,
  sceneMediaPathProblem,
  layerReadmeOf,
  livingRefProblem,
} from '../packages/shared/dist/index.js';

const exists = (p) => fs.access(p).then(() => true, () => false);

async function statesOf(root, rel) {
  const file = path.join(root, rel);
  if (!(await exists(file))) return { states: [], errors: [] };
  return parseStateDecls(parseFrontmatter(await fs.readFile(file, 'utf8')).frontmatter);
}

const MEDIA_EFFECTS = new Set(['show_cg', 'swap_background']);
const isLiteral = (v) => typeof v === 'string' && !v.includes('{{');

/**
 * `show_cg` / `swap_background` steps in every `command/*.yaml`:
 * a literal picture path must be a scene picture that exists, and a literal
 * layer must have a README. Templated values (`{{ … }}`) are checked at play time.
 * Returns `{ problems, shown }` — `shown` maps a command id to the literal
 * picture paths it can show (for the trigger-asset rule below).
 */
export async function commandMediaProblems(root) {
  const problems = [];
  const shown = new Map();
  const dir = path.join(root, 'command');
  const files = await fs.readdir(dir).catch(() => []);
  for (const f of files.filter((x) => x.endsWith('.yaml')).sort()) {
    const id = f.slice(0, -'.yaml'.length);
    const parsed = parseWorldCommand(id, await fs.readFile(path.join(dir, f), 'utf8'));
    if (!parsed.ok) continue; // reported by the trigger / command checks that own parsing
    const paths = new Set();
    parsed.command.steps.forEach((step, i) => {
      if (!MEDIA_EFFECTS.has(step.action)) return;
      const where = `command/${f} do[${i}] ${step.action}`;
      const pic = step.args.path;
      if (isLiteral(pic)) {
        paths.add(pic.trim());
        const problem = sceneMediaPathProblem(pic, step.action === 'show_cg' ? 'cg' : 'background');
        if (problem) problems.push(`${where}: ${problem}`);
        else problems.push({ pending: path.join(root, pic.trim()), message: `${where}: picture ${pic.trim()} is missing (generate or upload it before publishing)` });
      }
      if (step.action === 'swap_background' && isLiteral(step.args.layer)) {
        const target = layerReadmeOf(step.args.layer);
        if (!target) problems.push(`${where}: layer "${step.args.layer}" must be map or a world/... layer`);
        else problems.push({ pending: path.join(root, target.readme), message: `${where}: layer ${target.layer} does not exist` });
      }
    });
    shown.set(id, paths);
  }
  const out = [];
  for (const p of problems) {
    if (typeof p === 'string') out.push(p);
    else if (!(await exists(p.pending))) out.push(p.message);
  }
  return { problems: out, shown };
}

/** Every problem with `manifest.triggers` and the `states:` it reads. `[]` = clean. */
export async function triggerProblems(root, manifest) {
  const problems = [];
  const characterIds = (manifest.characters ?? []).map((c) => c.id);
  const declared = new Set();
  const scopes = [['player', 'player/README.md'], ['world', 'world/README.md'], ...characterIds.map((id) => [characterRefRoot(id), `characters/${id}/README.md`])];
  for (const [prefix, rel] of scopes) {
    const { states, errors } = await statesOf(root, rel);
    for (const e of errors) problems.push(`${rel}: ${e}`);
    for (const s of states) {
      declared.add(`${prefix}.${s.id}`);
      if (s.id === 'hp' && !s.hidden && !Array.isArray(s.shown_as)) problems.push(`${rel}: hp is shown only as prose; give it shown_as bands (or hidden: true)`);
    }
  }
  const media = await commandMediaProblems(root);
  problems.push(...media.problems);
  if (manifest.triggers === undefined) return problems;
  const { triggers, errors } = parseWorldTriggers(manifest.triggers);
  problems.push(...errors);
  const endings = new Set((manifest.endings ?? []).map((e) => e.id));
  const layerDir = (layer) => path.join(root, layer === 'map' ? 'world' : layer);
  for (const t of triggers) {
    const where = `trigger ${t.id}`;
    if (t.do !== undefined) {
      const file = path.join(root, 'command', `${t.do}.yaml`);
      if (!(await exists(file))) problems.push(`${where}: do "${t.do}" — command/${t.do}.yaml does not exist`);
      else {
        const parsed = parseWorldCommand(t.do, await fs.readFile(file, 'utf8'));
        if (!parsed.ok) problems.push(`${where}: command/${t.do}.yaml: ${parsed.errors.map((e) => e.message).join('; ')}`);
      }
    }
    if (t.ending !== undefined) {
      if (manifest.mode !== 'closed' && manifest.mode !== 'semi') problems.push(`${where}: ending needs mode closed or semi`);
      if (!endings.has(t.ending)) problems.push(`${where}: ending "${t.ending}" is not in world.json endings`);
    }
    if (t.kind === 'clock' && !manifest.clock) problems.push(`${where}: a clock trigger needs world.json clock`);
    if (t.kind === 'state') {
      const parsed = parseTriggerCondition(t.when, characterIds);
      if (!parsed.ok) problems.push(`${where}: when: ${parsed.error}`);
      else {
        for (const ref of collectRefPaths(parsed.value)) {
          if (ref === 'clock.left') { if (!manifest.clock) problems.push(`${where}: clock.left needs world.json clock`); continue; }
          if (ref === 'clock.turns') { if (!manifest.clock?.perTurns) problems.push(`${where}: clock.turns needs world.json clock.perTurns`); continue; }
          if (ref === 'clues.held' || ref === 'clues.total') { if (!t.clues?.length) problems.push(`${where}: ${ref} needs a clues: list`); continue; }
          // A living world's clock and calendar.
          if (ref.startsWith('time.') || ref.startsWith('events.')) { const p = livingRefProblem(manifest.living, ref); if (p) problems.push(`${where}: ${p}`); continue; }
          if (!declared.has(ref)) problems.push(`${where}: "${ref}" is not a declared state`);
        }
      }
    }
    if (t.kind === 'keyword') for (const l of t.when.layers ?? []) if (!(await exists(path.join(layerDir(l), 'README.md')))) problems.push(`${where}: layer ${l} does not exist`);
    if (t.kind === 'place' && !(await exists(path.join(layerDir(t.when.layer), 'README.md')))) problems.push(`${where}: layer ${t.when.layer} does not exist`);
    if (t.kind === 'dice') {
      if (t.when.layer && !(await exists(path.join(layerDir(t.when.layer), 'README.md')))) problems.push(`${where}: layer ${t.when.layer} does not exist`);
      if (t.when.card && !t.when.card.endsWith('/') && !(await exists(path.join(root, t.when.card)))) {
        // A search chalk appears only when the player searches; accept a card under a declared place.
        if (!(await exists(path.join(root, path.dirname(t.when.card), 'README.md')))) problems.push(`${where}: card ${t.when.card} is in no place`);
      }
    }
    for (const a of t.assets ?? []) if (!(await exists(path.join(root, a.path)))) problems.push(`${where}: asset ${a.path} is missing (generate or upload it before publishing)`);
    // §8.1: with a `do`, the command does the showing and assets are the authoring record —
    // a cg / background asset the command never names would never reach the player.
    if (t.do !== undefined && media.shown.has(t.do)) {
      for (const a of t.assets ?? []) {
        if ((a.kind === 'cg' || a.kind === 'background') && !media.shown.get(t.do).has(a.path)) {
          problems.push(`${where}: ${a.kind} asset ${a.path} is never shown — command/${t.do}.yaml has no ${a.kind === 'cg' ? 'show_cg' : 'swap_background'} for it (or drop "do" and the engine shows it)`);
        }
      }
    }
  }
  return problems;
}
