/**
 * Authoring checks for a looping world, run by
 * `check:worlds` for every template. The runtime is fail-soft (a malformed
 * `loop` block reads as "no loop", so `loop_reset` refuses with
 * `unsupported`); this gate is where that becomes visible.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  LOOP_STAGE_PROFILE,
  StageManifestSchema,
  applyLoopOverlay,
  collectRefPaths,
  loopConfigProblems,
  loopOverlayPathProblem,
  loopStateMatches,
  overlayFiles,
  parseCondition,
  parseFrontmatter,
  parseLoopConfig,
  parseStateDecls,
  parseWorldCommand,
} from '../packages/shared/dist/index.js';
import { npcProblems } from './npc-problems.mjs';
import { triggerProblems } from './trigger-problems.mjs';

/** Frontmatter keys only the engine writes: an overlay card must not arrive with them. */
const ENGINE_KEYS = ['command_log', 'command_error', 'trigger_log', 'cg_log', 'living', 'run', 'tick'];
const exists = (f) => fs.stat(f).then(() => true, () => false);

/** `[file, stepIndex, stepCount]` for every command step that is `loop_reset`. */
async function loopResetSteps(root) {
  const dir = path.join(root, 'command');
  const out = [];
  for (const f of (await fs.readdir(dir).catch(() => [])).filter((x) => x.endsWith('.yaml')).sort()) {
    const parsed = parseWorldCommand(f.slice(0, -5), await fs.readFile(path.join(dir, f), 'utf8'));
    if (!parsed.ok) continue;
    parsed.command.steps.forEach((s, i) => { if (s.action === 'loop_reset') out.push([f, i, parsed.command.steps.length]); });
  }
  return out;
}

/** Every problem with world.json `loop`. `[]` = clean (and for a world without one that uses no loop_reset). */
export async function loopProblems(root, manifest) {
  const resets = await loopResetSteps(root);
  if (manifest.loop === undefined) return resets.map(([f]) => `command/${f}: loop_reset needs world.json loop`);
  const problems = loopConfigProblems(manifest).map((p) => `world.json: ${p}`);
  const loop = parseLoopConfig(manifest);
  if (!loop) return problems;
  if (manifest.living !== undefined) problems.push('world.json: loop and living do not go together (one rewinds, the other keeps time)');
  if (resets.length === 0) problems.push('world.json: loop is declared but no command uses loop_reset');
  for (const [f, i, n] of resets) if (i !== n - 1) problems.push(`command/${f}: loop_reset must be the last step (what follows it would land in the new loop)`);

  let states = [];
  try {
    states = parseStateDecls(parseFrontmatter(await fs.readFile(path.join(root, 'player/README.md'), 'utf8')).frontmatter ?? {}).states;
  } catch {
    states = [];
  }
  const counter = states.find((s) => s.id === loop.counter);
  if (!counter || counter.type !== 'number') problems.push(`player/README.md: loop.counter "${loop.counter}" must be a declared number state`);
  for (const pattern of loop.states) {
    if (!states.some((s) => loopStateMatches([pattern], s.id))) problems.push(`world.json: loop.persist.states "${pattern}" matches no state declared in player/README.md`);
  }
  problems.push(...(await stageProblems(root, manifest, loop, states)));
  return problems;
}

/**
 * `loop.stages`: every overlay exists and is
 * used, carries only what a stage may carry, adds (never replaces) commands
 * and assets, arrives without engine-only keys, gates on states the player
 * keeps — and the world as loop N sees it (stages applied, every `when` true)
 * passes the same trigger and NPC checks as the template.
 */
async function stageProblems(root, manifest, loop, states) {
  const problems = [];
  const used = new Set(loop.stages.map((s) => s.overlay));
  const dirs = (await fs.readdir(path.join(root, 'loops'), { withFileTypes: true }).catch(() => [])).filter((e) => e.isDirectory()).map((e) => `loops/${e.name}`);
  for (const d of dirs) if (!used.has(d)) problems.push(`${d}/: no loop.stages entry uses this overlay`);
  loop.stages.forEach((stage, i) => {
    if (stage.when === undefined) return;
    const parsed = parseCondition(stage.when, LOOP_STAGE_PROFILE);
    if (!parsed.ok) return;
    for (const ref of collectRefPaths(parsed.value)) {
      const id = ref.slice('player.'.length);
      if (!states.some((s) => s.id === id)) problems.push(`world.json: loop.stages[${i}].when reads ${ref}, not a state declared in player/README.md`);
      else if (id !== loop.counter && !loopStateMatches(loop.states, id)) problems.push(`world.json: loop.stages[${i}].when reads ${ref}, which goes back to its start every loop (keep it in loop.persist.states)`);
    }
  });
  for (const overlay of used) {
    const dir = path.join(root, overlay);
    const files = await overlayFiles(dir);
    if (files.length === 0) {
      problems.push(`${overlay}/: the overlay directory is missing or empty`);
      continue;
    }
    for (const rel of files) {
      const where = `${overlay}/${rel}`;
      const bad = loopOverlayPathProblem(rel, loop);
      if (bad) {
        problems.push(`${where}: ${bad}`);
        continue;
      }
      const top = rel.split('/')[0];
      if ((top === 'command' || top === 'assets') && (await exists(path.join(root, rel)))) {
        problems.push(`${where}: ${top}/ is not rewound by a reset — a stage may add files there, not replace ${rel}`);
      }
      if (rel === 'stage.json') {
        let raw;
        try {
          raw = JSON.parse(await fs.readFile(path.join(dir, rel), 'utf8'));
        } catch {
          problems.push(`${where}: not valid JSON`);
          continue;
        }
        const parsed = StageManifestSchema.safeParse(raw);
        if (!parsed.success) problems.push(...parsed.error.issues.map((x) => `${where}: ${x.path.join('.') || '(root)'}: ${x.message}`));
        continue;
      }
      if (rel.endsWith('.md')) {
        const fm = parseFrontmatter(await fs.readFile(path.join(dir, rel), 'utf8')).frontmatter ?? {};
        for (const key of ENGINE_KEYS) if (Object.hasOwn(fm, key)) problems.push(`${where}: "${key}" is written by the engine, not carried by a stage`);
        if (fm.roll_dice && typeof fm.roll_dice === 'object' && ('result' in fm.roll_dice || 'passed' in fm.roll_dice)) problems.push(`${where}: a settled roll (roll_dice.result / passed) is not stage content`);
      }
      if (/^command\/[^/]+\.yaml$/.test(rel)) {
        const parsed = parseWorldCommand(rel.slice('command/'.length, -5), await fs.readFile(path.join(dir, rel), 'utf8'));
        if (!parsed.ok) problems.push(`${where}: ${parsed.errors.map((e) => e.message).join('; ')}`);
        else parsed.command.steps.forEach((st, j) => { if (st.action === 'loop_reset' && j !== parsed.command.steps.length - 1) problems.push(`${where}: loop_reset must be the last step`); });
      }
    }
  }
  if (problems.length) return problems;

  // The world each loop sees: every loop where the set of stages changes.
  const loops = new Set();
  for (const s of loop.stages) {
    loops.add(s.from);
    if (s.until !== undefined) loops.add(s.until + 1);
  }
  for (const n of [...loops].sort((a, b) => a - b)) {
    // `when` taken as true: the most a stage can bring must hold together.
    const active = loop.stages.filter((s) => n >= s.from && (s.until === undefined || n <= s.until));
    if (active.length === 0) continue;
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-loop-stage-check-'));
    try {
      await fs.cp(root, tmp, { recursive: true, filter: (f) => path.relative(root, f).split(path.sep)[0] !== 'loops' });
      await fs.writeFile(path.join(tmp, 'world.json'), JSON.stringify(manifest, null, 2));
      for (const s of active) await applyLoopOverlay(tmp, path.join(root, s.overlay), loop);
      const merged = JSON.parse(await fs.readFile(path.join(tmp, 'world.json'), 'utf8'));
      for (const p of await triggerProblems(tmp, merged)) problems.push(`loop ${n} (${active.map((s) => s.overlay).join(' + ')}): ${p}`);
      for (const p of await npcProblems(tmp)) problems.push(`loop ${n} (${active.map((s) => s.overlay).join(' + ')}): ${p}`);
      for (const c of merged.characters ?? []) {
        if (!(manifest.characters ?? []).some((x) => x.id === c.id) && !(await exists(path.join(tmp, 'characters', c.id, 'README.md')))) {
          problems.push(`loop ${n}: character "${c.id}" added by a stage has no characters/${c.id}/README.md`);
        }
      }
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  }
  return problems;
}
