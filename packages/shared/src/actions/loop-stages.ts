/**
 * Loop stages: what a NEW loop brings.
 *
 * A reset puts the world back to its `loop-start` snapshot. `world.json`
 * `loop.stages` then lays overlay directories over it, so loop 2 can have a
 * guest who arrives earlier, a room that was not there, a sign someone left:
 *
 *   "stages": [
 *     { "from": 2, "overlay": "loops/second" },
 *     { "from": 3, "until": 5, "when": "player.known_oil == true", "overlay": "loops/oil" }
 *   ]
 *
 * An overlay is a directory in the template, `loops/<name>/`, mirroring the
 * world root like a run variant's: `world/…`,
 * `characters/…`, `player/…` files replace or add; `command/…` and
 * `assets/…` may only ADD (a reset does not rewind those roots, so the engine
 * tracks what it added and takes it away again before the next loop's
 * stages); a `stage.json` adds or replaces `triggers` / `characters` in
 * `world.json` by id.
 *
 * Every reset applies, in declaration order, every stage with
 * `from <= N <= until` whose `when` holds over the player's states AFTER the
 * kept ones were written back — so stages are cumulative by default and can
 * unlock by what the player has learned, not only by the count. Applying is
 * idempotent: the world was just restored, and a stage applied twice writes
 * the same bytes.
 *
 * When a run starts (`prepareLoop`) the template's `loops/` moves to
 * `.airpworld/loops/` — out of the store's reach, so neither the writer nor a
 * character agent can read what a later loop brings.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { evaluateCondition, parseCondition, type Scalar } from '../commands/condition.js';
import { LOOPS_DIR, LOOP_STAGE_PROFILE, type LoopConfig, type LoopStage } from '../schemas/loop.js';
import { currentStateValue } from '../rules/states.js';
import { isPlayerNotePath } from '../rules/player-notes.js';
import type { WorldStore } from '../store/world-store.js';
import { overlayFiles } from '../store/run-variants.js';
import { readStateFile } from './states.js';

/** Where the overlays live in a save once its run started. */
export const LOOP_STASH = '.airpworld/loops';
/** What the last stages added outside the rewound roots (command/, assets/). */
const APPLIED_FILE = '.airpworld/loop-applied.json';
/** The overlay file that patches `world.json`. */
export const STAGE_MANIFEST = 'stage.json';

/** Roots a reset rewinds: an overlay may replace files here. */
const REWOUND = new Set(['world', 'characters', 'player']);
/** Roots a reset leaves alone: an overlay may only add here. */
const ADD_ONLY = new Set(['command', 'assets']);

const ID_ENTRY = z.object({ id: z.string().min(1) }).passthrough();
export const StageManifestSchema = z
  .object({
    /** Added to `world.json` `triggers`; one with an existing id replaces it. */
    triggers: z.array(ID_ENTRY).max(32).optional(),
    /** Added to `world.json` `characters`; one with an existing id replaces it. */
    characters: z.array(ID_ENTRY).max(12).optional(),
  })
  .strict();
export type StageManifest = z.infer<typeof StageManifestSchema>;

/**
 * Why an overlay may not carry `rel` (null = it may). Shared by the engine
 * (which skips such a file) and `check:worlds` (which reports it).
 */
export function loopOverlayPathProblem(rel: string, loop: Pick<LoopConfig, 'files'>): string | null {
  if (rel === STAGE_MANIFEST) return null;
  const segs = rel.split('/');
  if (segs.some((s) => s === '' || s === '..' || s.startsWith('.'))) return 'hidden or relative paths are not overlay content';
  const top = segs[0];
  if (!REWOUND.has(top) && !ADD_ONLY.has(top)) {
    return 'an overlay carries world/, characters/, player/, command/, assets/ files and stage.json only (never world.json, variants/ or loops/)';
  }
  if (rel === 'world/README.md') return 'the root README is the world\'s own (its states, trigger_log, the run record): a stage may not replace it';
  if (rel === 'player/README.md') return 'the player README holds the kept states: a stage may not replace it';
  if (isPlayerNotePath(rel)) return 'player notes are the player\'s: a stage may not write them';
  if (loop.files.includes(rel)) return 'this file is one the player keeps across loops (loop.persist.files / loop.keep)';
  if (top === 'command' && !/^command\/[a-z0-9][a-z0-9-]{0,47}\.yaml$/.test(rel)) return 'a world command is command/<id>.yaml';
  return null;
}

/** Merge a stage's `stage.json` into a manifest object: by id, replace or append. Pure. */
export function mergeStageManifest(manifest: Record<string, unknown>, patch: StageManifest): Record<string, unknown> {
  const out = { ...manifest };
  for (const key of ['triggers', 'characters'] as const) {
    const add = patch[key];
    if (!add?.length) continue;
    const list = Array.isArray(out[key]) ? [...(out[key] as Array<Record<string, unknown>>)] : [];
    for (const entry of add) {
      const at = list.findIndex((x) => x && typeof x === 'object' && x.id === entry.id);
      if (at >= 0) list[at] = entry;
      else list.push(entry);
    }
    out[key] = list;
  }
  return out;
}

async function exists(file: string): Promise<boolean> {
  return fs.stat(file).then(() => true, () => false);
}

/**
 * Move the template's `loops/` out of agents' reach (`.airpworld/loops/`).
 * Called by `prepareLoop`; a no-op when there is nothing to move. A fresh
 * `loops/` (a save that somehow got one again) replaces the stash.
 */
export async function stashLoopOverlays(root: string): Promise<boolean> {
  const src = path.join(root, LOOPS_DIR);
  if (!(await fs.stat(src).then((s) => s.isDirectory(), () => false))) return false;
  const dest = path.join(root, LOOP_STASH);
  await fs.rm(dest, { recursive: true, force: true });
  for (const rel of await overlayFiles(src)) {
    const target = path.join(dest, ...rel.split('/'));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(path.join(src, ...rel.split('/')), target);
  }
  await fs.rm(src, { recursive: true, force: true });
  return true;
}

/** The overlay directory of a stage in a save (stashed) or in a template (not yet). */
export async function loopOverlayDir(root: string, overlay: string): Promise<string> {
  const name = overlay.slice(LOOPS_DIR.length + 1);
  const stashed = path.join(root, LOOP_STASH, name);
  if (await exists(stashed)) return stashed;
  return path.join(root, LOOPS_DIR, name);
}

export interface OverlayResult {
  /** Files written over the world (rewound roots, and add-only roots). */
  written: string[];
  /** Of those, files added under command/ or assets/ (to take away before the next loop). */
  added: string[];
  /** Files the overlay carried but may not apply (see `loopOverlayPathProblem`, or an existing command/asset). */
  skipped: string[];
  /** True when `stage.json` patched world.json. */
  manifest: boolean;
}

/** Lay one overlay directory over `root`. */
export async function applyLoopOverlay(root: string, dir: string, loop: Pick<LoopConfig, 'files'>): Promise<OverlayResult> {
  const result: OverlayResult = { written: [], added: [], skipped: [], manifest: false };
  for (const rel of await overlayFiles(dir)) {
    if (loopOverlayPathProblem(rel, loop)) {
      result.skipped.push(rel);
      continue;
    }
    const from = path.join(dir, ...rel.split('/'));
    if (rel === STAGE_MANIFEST) {
      let patch: StageManifest;
      try {
        patch = StageManifestSchema.parse(JSON.parse(await fs.readFile(from, 'utf8')));
      } catch {
        result.skipped.push(rel);
        continue;
      }
      const file = path.join(root, 'world.json');
      const manifest = JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, unknown>;
      await fs.writeFile(file, `${JSON.stringify(mergeStageManifest(manifest, patch), null, 2)}\n`);
      result.manifest = true;
      continue;
    }
    const target = path.join(root, ...rel.split('/'));
    const addOnly = ADD_ONLY.has(rel.split('/')[0]);
    if (addOnly && (await exists(target))) {
      result.skipped.push(rel);
      continue;
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(from, target);
    result.written.push(rel);
    if (addOnly) result.added.push(rel);
  }
  return result;
}

/** Which stages a loop gets, given `player.<id>` values. Pure; declaration order. */
export function activeLoopStages(loop: Pick<LoopConfig, 'stages'>, n: number, values: ReadonlyMap<string, Scalar>): LoopStage[] {
  return loop.stages.filter((s) => {
    if (n < s.from || (s.until !== undefined && n > s.until)) return false;
    if (s.when === undefined) return true;
    const parsed = parseCondition(s.when, LOOP_STAGE_PROFILE);
    if (!parsed.ok) return false;
    const r = evaluateCondition(parsed.value, { values, paths: new Map() });
    // An unresolved reference (an undeclared state) is "not this loop", never an error here.
    return r.ok && r.value;
  });
}

/** The add-only files the previous stages added: gone before this loop's stages land. */
async function takeBackAdded(root: string): Promise<void> {
  let added: unknown;
  try {
    added = (JSON.parse(await fs.readFile(path.join(root, APPLIED_FILE), 'utf8')) as { added?: unknown }).added;
  } catch {
    return;
  }
  if (!Array.isArray(added)) return;
  for (const rel of added) {
    if (typeof rel !== 'string' || !ADD_ONLY.has(rel.split('/')[0]) || rel.split('/').some((s) => s === '..' || s.startsWith('.'))) continue;
    await fs.rm(path.join(root, ...rel.split('/')), { force: true });
  }
}

export interface LoopStagesResult {
  /** The overlays applied this loop, in order (`loops/<name>`). */
  stages: string[];
  skipped: string[];
}

/**
 * Apply the stages loop `n` gets. Run by `loopReset` after the restore and
 * after the kept states were written back (so `when` reads them).
 */
export async function applyLoopStages(store: WorldStore, loop: LoopConfig, n: number): Promise<LoopStagesResult> {
  const root = store.worldRoot;
  await takeBackAdded(root);
  const values = new Map<string, Scalar>();
  const player = await readStateFile(store, 'player/README.md');
  for (const decl of player?.states ?? []) values.set(`player.${decl.id}`, currentStateValue(decl, player?.data));
  const applied: string[] = [];
  const added: string[] = [];
  const skipped: string[] = [];
  for (const stage of activeLoopStages(loop, n, values)) {
    const dir = await loopOverlayDir(root, stage.overlay);
    if (!(await exists(dir))) continue;
    const r = await applyLoopOverlay(root, dir, loop);
    applied.push(stage.overlay);
    added.push(...r.added);
    skipped.push(...r.skipped.map((f) => `${stage.overlay}/${f}`));
  }
  if (added.length || (await exists(path.join(root, APPLIED_FILE)))) {
    await fs.mkdir(path.dirname(path.join(root, APPLIED_FILE)), { recursive: true });
    await fs.writeFile(path.join(root, APPLIED_FILE), `${JSON.stringify({ loop: n, stages: applied, added }, null, 2)}\n`);
  }
  return { stages: applied, skipped };
}
