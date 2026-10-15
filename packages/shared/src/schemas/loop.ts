/**
 * A looping world: world.json `loop`.
 *
 * ```json
 * "loop": {
 *   "persist": { "notes": true, "board": true, "states": ["loop", "known_*"], "files": ["player/kuri-message.md"] },
 *   "keep": ["player/kuri-message.md"],
 *   "counter": "loop",
 *   "stages": [
 *     { "from": 2, "overlay": "loops/second" },
 *     { "from": 2, "when": "player.known_secret == true", "overlay": "loops/secret-room" }
 *   ]
 * }
 * ```
 *
 * `stages` is what a NEW loop brings: overlay directories (`loops/<name>/`,
 * mirroring the world root like a run variant's) laid over the restored
 * loop start when a reset lands in loop N — every stage with `from <= N`
 * (and `N <= until`, and `when` true over the player's kept states), in
 * declaration order, so stages are cumulative unless `until` ends one.
 *
 * The block only says what the PLAYER carries from one loop into the next;
 * everything else goes back to the loop's starting snapshot. `keep` is a
 * shorthand for `persist.files`. Other keys (`version`, `days`, notes for
 * authors) are ignored — the manifest is passthrough.
 *
 * Runtime is lenient (`parseLoopConfig`: a malformed block reads as "no loop",
 * so `loop_reset` refuses with `unsupported` and the world is otherwise
 * playable); `loopConfigProblems` is the strict half `check:worlds` runs.
 */

import { COMMAND_PROFILE, parseCondition, type ConditionProfile } from '../commands/condition.js';

/** Player state ids, or a prefix wildcard (`known_*`). */
const STATE_PATTERN = /^[a-z][a-z0-9_]{0,31}\*?$/;
/**
 * Files the player keeps: `player/<name>.md`, one level, never README. A `*`
 * stands for any run of name characters (`player/*.md` = everything in the bag,
 * `player/shrine-*.md` = a family), matched when the loop resets.
 */
const KEEP_FILE = /^player\/[A-Za-z0-9_.*-]+\.md$/;

/** True when `file` (a world-relative path) is named by one of `patterns` (exact, or with `*`). Never README. */
export function loopFileMatches(patterns: readonly string[], file: string): boolean {
  if (file === 'player/README.md' || !KEEP_FILE.test(file) || file.includes('*')) return false;
  return patterns.some((p) => {
    if (!p.includes('*')) return p === file;
    const re = new RegExp(`^${p.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[A-Za-z0-9_.-]*')}$`);
    return re.test(file);
  });
}

export interface LoopConfig {
  /** Keep `world/**\/player-note-<n>.md`. Default true. */
  notes: boolean;
  /** Keep `player-board.json`. Default true. */
  board: boolean;
  /** Player state ids (or `prefix*`) whose values survive a reset. */
  states: string[];
  /** `player/*.md` files (or `*` patterns) that survive a reset, byte for byte. */
  files: string[];
  /** The number player state the engine bumps by one per reset. Default `loop`. */
  counter: string;
  /** What a new loop brings on top of the loop start (actions/loop-stages.ts). */
  stages: LoopStage[];
}

export interface LoopStage {
  /** First loop it applies to (2 = the first reset). */
  from: number;
  /** Last loop it applies to; absent = every later loop (cumulative). */
  until?: number;
  /** A condition over `player.<id>` (the kept states and the counter), e.g. `player.known_oil == true`. */
  when?: string;
  /** `loops/<name>`: the overlay directory in the template. */
  overlay: string;
}

/** Template directory holding the stage overlays; moved out of agents' reach when a run starts. */
export const LOOPS_DIR = 'loops';
/** `loops/<name>` — one level, ASCII kebab-case. */
export const LOOP_OVERLAY_RE = /^loops\/[a-z0-9][a-z0-9-]{0,39}$/;
const MAX_STAGES = 16;

/** `when` of a stage: the command algebra, but only `player.<id>` may be read (the world is at its start). */
export const LOOP_STAGE_PROFILE: ConditionProfile = Object.freeze({ ...COMMAND_PROFILE, roots: ['player'] });

function stageProblems(raw: unknown): string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return ['loop.stages must be a list'];
  const problems: string[] = [];
  if (raw.length > MAX_STAGES) problems.push(`loop.stages: at most ${MAX_STAGES} stages`);
  raw.forEach((stage, i) => {
    const where = `loop.stages[${i}]`;
    if (!isPlainObject(stage)) {
      problems.push(`${where} must be an object`);
      return;
    }
    for (const key of Object.keys(stage)) {
      if (!['from', 'until', 'when', 'overlay'].includes(key)) problems.push(`${where}: unknown key "${key}"`);
    }
    const from = stage.from;
    if (!Number.isInteger(from) || (from as number) < 2) problems.push(`${where}.from must be a whole number >= 2 (loop 1 is the template itself)`);
    if (stage.until !== undefined && (!Number.isInteger(stage.until) || (Number.isInteger(from) && (stage.until as number) < (from as number)))) {
      problems.push(`${where}.until must be a whole number >= from`);
    }
    if (typeof stage.overlay !== 'string' || !LOOP_OVERLAY_RE.test(stage.overlay)) problems.push(`${where}.overlay must be loops/<name> (lowercase kebab-case)`);
    if (stage.when !== undefined) {
      if (typeof stage.when !== 'string') problems.push(`${where}.when must be a condition string`);
      else {
        const parsed = parseCondition(stage.when, LOOP_STAGE_PROFILE);
        if (!parsed.ok) problems.push(`${where}.when: ${parsed.error}`);
      }
    }
  });
  return problems;
}

export const LOOP_START_SNAPSHOT = 'loop-start';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringList(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) return null;
  return value as string[];
}

/** Every problem with a `loop` block; `[]` when it is absent or well formed. */
export function loopConfigProblems(manifest: unknown): string[] {
  if (!isPlainObject(manifest) || manifest.loop === undefined) return [];
  const loop = manifest.loop;
  if (!isPlainObject(loop)) return ['loop must be an object'];
  const problems: string[] = [];
  const persist = loop.persist === undefined ? {} : loop.persist;
  if (!isPlainObject(persist)) return ['loop.persist must be an object'];
  for (const key of ['notes', 'board'] as const) {
    if (persist[key] !== undefined && typeof persist[key] !== 'boolean') problems.push(`loop.persist.${key} must be true or false`);
  }
  const states = stringList(persist.states);
  if (states === null) problems.push('loop.persist.states must be a list of player state ids');
  else for (const s of states) if (!STATE_PATTERN.test(s)) problems.push(`loop.persist.states: "${s}" is not a state id (a trailing * matches a prefix)`);
  for (const key of ['files', 'keep'] as const) {
    const list = stringList(key === 'files' ? persist.files : loop.keep);
    const where = key === 'files' ? 'loop.persist.files' : 'loop.keep';
    if (list === null) problems.push(`${where} must be a list of player/*.md paths`);
    else for (const f of list) if (!KEEP_FILE.test(f) || f === 'player/README.md') problems.push(`${where}: "${f}" must be a player/<name>.md file (not README.md)`);
  }
  if (loop.counter !== undefined && (typeof loop.counter !== 'string' || !/^[a-z][a-z0-9_]{0,31}$/.test(loop.counter))) {
    problems.push('loop.counter must be a player state id');
  }
  problems.push(...stageProblems(loop.stages));
  return problems;
}

/** The world's loop rules, or null when it declares none (or a malformed one). */
export function parseLoopConfig(manifest: unknown): LoopConfig | null {
  if (!isPlainObject(manifest) || !isPlainObject(manifest.loop)) return null;
  if (loopConfigProblems(manifest).length > 0) return null;
  const loop = manifest.loop;
  const persist = isPlainObject(loop.persist) ? loop.persist : {};
  const files = [...(stringList(persist.files) ?? []), ...(stringList(loop.keep) ?? [])];
  return {
    notes: persist.notes !== false,
    board: persist.board !== false,
    states: stringList(persist.states) ?? [],
    files: [...new Set(files)],
    counter: typeof loop.counter === 'string' ? loop.counter : 'loop',
    stages: Array.isArray(loop.stages)
      ? (loop.stages as Array<Record<string, unknown>>).map((s) => ({
          from: s.from as number,
          ...(s.until !== undefined ? { until: s.until as number } : {}),
          ...(s.when !== undefined ? { when: s.when as string } : {}),
          overlay: s.overlay as string,
        }))
      : [],
  };
}

/** True when `id` is named by one of `patterns` (exact, or `prefix*`). */
export function loopStateMatches(patterns: readonly string[], id: string): boolean {
  return patterns.some((p) => (p.endsWith('*') ? id.startsWith(p.slice(0, -1)) : id === p));
}
