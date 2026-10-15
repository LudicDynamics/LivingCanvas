/**
 * Loop reset: the world goes back to the first
 * morning; only the player remembers.
 *
 * The engine part is deliberately small. Everything about HOW a loop feels —
 * NPCs meeting the player for the first time, small details changing, the
 * player cutting a confession short with what they know — lives in the
 * world's writer skill and character cards. What prompts cannot do reliably
 * is done here, in one step:
 *
 *   1. put the content roots back to the run's `loop-start` snapshot — the same
 *      file restore a rollback does (`restoreSnapshotContent`), keeping the
 *      player's notes and clue board;
 *   2. write back what the world declares the player keeps (`loop.persist`):
 *      player states (`known_*`), `player/*.md` files (a `*` pattern keeps the
 *      whole bag, or a family of it); bump the counter; a clock that moves by
 *      turns (`clock.perTurns`) starts its first step from 0;
 *   3. forget every character's conversation (`char-<id>.jsonl`) and put them
 *      back at their `home`;
 *   4. lay the world's `loop.stages` overlays for loop N over the restored
 *      start (actions/loop-stages.ts) — what a new loop brings;
 *   5. append ONE `loop_reset` event and push every read cursor to it, so the
 *      writer's next turn starts from "loop N begins", not from the old loop.
 *
 * The writer's own conversation is rotated by the server when it sees the
 * event (apps/server: `lifecycle.retireWriterForLoop`): agent processes are
 * the server's, not the action layer's.
 *
 * No model call is needed anywhere in here.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseFrontmatter, stringifyFrontmatter } from '../schemas/frontmatter.js';
import { LOOP_START_SNAPSHOT, loopFileMatches, loopStateMatches, parseLoopConfig, type LoopConfig } from '../schemas/loop.js';
import { resetTurnClock } from './turn-clock.js';
import type { WorldEvent } from '../schemas/events.js';
import type { WorldStore } from '../store/world-store.js';
import { clampState, currentStateValue, normalizeStateWrite, type StateValue } from '../rules/states.js';
import { isPlayerNotePath, PLAYER_NOTE_PREFIX } from '../rules/player-notes.js';
import { ActionError } from './errors.js';
import type { ActionContext } from './types.js';
import { readStateFile } from './states.js';
import { reachedEnding } from './closed-world-state.js';
import { restoreSnapshotContent, SNAPSHOT_DIR, zipWorldContent } from './world.js';
import { initializeMissingCharacterPresence } from './initial-presence.js';
import { applyLoopStages, stashLoopOverlays } from './loop-stages.js';

const PLAYER_README = 'player/README.md';
const SESSIONS_DIR = '.airpworld/sessions';
const CHARACTER_SESSION = /^char-[a-z0-9][a-z0-9-]*\.jsonl$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function loopStartArchive(root: string): string {
  return path.join(root, SNAPSHOT_DIR, `${LOOP_START_SNAPSHOT}.zip`);
}

/**
 * Take the run's `loop-start` snapshot, once. Called next to `prepareRun`
 * (after the variant draw, so every loop plays the same truth) and when a save
 * is opened (an older save gets its snapshot the first time it is played
 * after this existed). A no-op for a world without `loop`, or a save that
 * already has one. Returns true when it took the snapshot now.
 */
export async function prepareLoop(root: string): Promise<boolean> {
  let manifest: unknown;
  try {
    manifest = JSON.parse(await fs.readFile(path.join(root, 'world.json'), 'utf8'));
  } catch {
    return false;
  }
  if (!parseLoopConfig(manifest)) return false;
  // What later loops bring moves out of agents' reach first (loop-stages.ts).
  await stashLoopOverlays(root);
  const archive = loopStartArchive(root);
  if (await fs.stat(archive).then(() => true, () => false)) return false;
  await zipWorldContent(root, archive);
  return true;
}

/* ── which loop is this process on (for the trigger engine) ─────────────── */

const EPOCHS = new Map<string, number>();

/**
 * Bumped by every reset this process makes in a world. The trigger engine reads
 * it around a consequence: a trigger whose command reset the loop must not
 * write its (pre-reset) `trigger_log` back over the restored one.
 */
export function loopEpoch(store: WorldStore): number {
  return EPOCHS.get(store.worldRoot) ?? 0;
}

/* ── the reset ───────────────────────────────────────────────────────────── */

export interface LoopResetResult {
  loop: number;
  /** True when this turn had already reset the loop (nothing changed). */
  reused: boolean;
  kept: { notes: number; links: number; states: string[]; files: string[] };
  /** Kept things that had to change on the way: a note whose layer is gone moved to the root layer. */
  dropped: string[];
  /** The `loop.stages` overlays this loop got, in order. */
  stages: string[];
  event?: WorldEvent;
}

async function exists(file: string): Promise<boolean> {
  return fs.stat(file).then(() => true, () => false);
}

/** The values the player keeps, read before the restore. */
async function collectStates(store: WorldStore, loop: LoopConfig): Promise<Map<string, StateValue>> {
  const out = new Map<string, StateValue>();
  const file = await readStateFile(store, PLAYER_README);
  if (!file) return out;
  for (const decl of file.states) {
    if (decl.id === loop.counter || loopStateMatches(loop.states, decl.id)) out.set(decl.id, currentStateValue(decl, file.data));
  }
  return out;
}

/** Write the kept values (and the bumped counter) onto the restored player README in one write. */
async function writeStates(store: WorldStore, loop: LoopConfig, kept: Map<string, StateValue>): Promise<{ loop: number; states: string[] }> {
  const raw = await store.readFile(PLAYER_README);
  const parsed = parseFrontmatter(raw);
  const fm: Record<string, unknown> = { ...(parsed.frontmatter ?? {}) };
  const file = await readStateFile(store, PLAYER_README);
  const status = isPlainObject(fm.status) ? { ...fm.status } : {};
  const data = isPlainObject(status.data) ? { ...status.data } : {};
  const written: string[] = [];
  let next = 1;
  for (const decl of file?.states ?? []) {
    if (decl.id === loop.counter) {
      const before = kept.get(decl.id);
      next = decl.type === 'number' ? (clampState(decl, (typeof before === 'number' ? before : Number(decl.initial)) + 1) as number) : 1;
      data[decl.id] = next;
      continue;
    }
    if (!kept.has(decl.id)) continue;
    try {
      data[decl.id] = normalizeStateWrite(decl, kept.get(decl.id));
      written.push(decl.id);
    } catch {
      // A value that no longer fits its declaration stays at the loop start's.
    }
  }
  status.data = data;
  fm.status = status;
  await store.writeFileAtomic(PLAYER_README, stringifyFrontmatter(fm, parsed.body));
  return { loop: next, states: written };
}

/**
 * A kept note whose layer did not survive the reset (a layer the writer made up
 * mid-loop) moves to the root layer under a free number — never dropped.
 */
async function rehomeNotes(store: WorldStore, notes: readonly string[]): Promise<string[]> {
  const moved: string[] = [];
  for (const note of notes) {
    const dir = note.slice(0, note.lastIndexOf('/'));
    if (dir === 'world' || (await store.statKind(`${dir}/README.md`)) === 'file') continue;
    const taken = new Set((await store.listFiles('world')).filter(isPlayerNotePath));
    let n = 1;
    while (taken.has(`world/${PLAYER_NOTE_PREFIX}${n}.md`)) n += 1;
    const to = `world/${PLAYER_NOTE_PREFIX}${n}.md`;
    await store.writeFileAtomic(to, await store.readFile(note));
    await store.deleteFile(note);
    await fs.rmdir(path.join(store.worldRoot, dir)).catch(() => {});
    moved.push(`${note} → ${to}`);
  }
  return moved;
}

/** Every character's conversation file goes; the next talk starts a new one. */
async function forgetCharacterSessions(root: string): Promise<void> {
  const dir = path.join(root, SESSIONS_DIR);
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  for (const name of names) if (CHARACTER_SESSION.test(name)) await fs.rm(path.join(dir, name), { force: true });
}

/**
 * Reset the loop. Reached only through the `loop_reset` command effect (a
 * trigger's `do`, an option's command): there is no action method and no agent
 * tool for it, so the writer and characters cannot decide to start over.
 */
export async function loopReset(ctx: ActionContext, input: { reason?: string } = {}): Promise<LoopResetResult> {
  const { store } = ctx;
  const manifest = await store.getManifest();
  const loop = parseLoopConfig(manifest);
  if (!loop) {
    throw new ActionError({ code: 'unsupported', message: 'This world declares no loop (world.json "loop"), or its loop block is malformed.' });
  }
  if (await reachedEnding(store, manifest)) {
    throw new ActionError({ code: 'game_ended', message: 'This story has already ended.' });
  }
  // One reset per turn: a replayed trigger, a retried request. The world files
  // that would remember it were just restored, so the record is the event log.
  if (ctx.turn) {
    const recent = await store.getEvents(50);
    const done = recent.find((e) => e.type === 'loop_reset' && e.turn === ctx.turn);
    if (done) {
      const d = done.detail as Partial<LoopResetResult>;
      return {
        loop: typeof d.loop === 'number' ? d.loop : 0,
        reused: true,
        kept: d.kept ?? { notes: 0, links: 0, states: [], files: [] },
        dropped: Array.isArray(d.dropped) ? d.dropped : [],
        stages: Array.isArray(d.stages) ? d.stages : [],
        event: done,
      };
    }
  }
  if (!(await exists(loopStartArchive(store.worldRoot)))) {
    throw new ActionError({
      code: 'not_found',
      message: 'This save has no loop-start snapshot (it is taken when a run starts or a save is opened); reopen the save, or start a new run.',
    });
  }

  // 1. What the player keeps, read before anything moves.
  const states = await collectStates(store, loop);
  // `persist.files` may name a pattern (`player/*.md`: the whole bag), matched against the bag now.
  const files = new Map<string, Buffer>();
  const bag = (await fs.readdir(path.join(store.worldRoot, 'player'), { withFileTypes: true }).catch(() => []))
    .filter((d) => d.isFile())
    .map((d) => `player/${d.name}`);
  for (const rel of [...new Set([...loop.files.filter((f) => !f.includes('*')), ...bag])]) {
    if (!loopFileMatches(loop.files, rel)) continue;
    if ((await store.statKind(rel)) === 'file') files.set(rel, await fs.readFile(path.join(store.worldRoot, rel)));
  }

  // 2. The world goes back; notes and board stay (by the world's own `persist`).
  const restored = await restoreSnapshotContent(ctx, LOOP_START_SNAPSHOT);
  const notes = restored.kept.filter(isPlayerNotePath);

  // 3. Write back what the player carries.
  for (const [rel, bytes] of files) {
    await fs.mkdir(path.dirname(path.join(store.worldRoot, rel)), { recursive: true });
    await store.writeFileAtomic(rel, bytes);
  }
  const written = (await store.statKind(PLAYER_README)) === 'file' ? await writeStates(store, loop, states) : { loop: 1, states: [] };
  // A clock that moves by turns starts the new loop's first step from 0 (actions/turn-clock.ts).
  await resetTurnClock(ctx, manifest);

  // 4. What this loop brings (its `when` reads the states just written back).
  const staged = await applyLoopStages(store, loop, written.loop);
  const dropped = await rehomeNotes(store, notes);

  // 5. Characters meet the player for the first time: no conversation, at home
  // (a stage may have added someone: read the cast again).
  await forgetCharacterSessions(store.worldRoot);
  const cast = staged.stages.length ? await store.getManifest().catch(() => manifest) : manifest;
  const ids = new Set([...(manifest.characters ?? []), ...(cast.characters ?? [])].map((c) => c.id));
  for (const id of ids) await store.deletePresence(id).catch(() => false);
  await initializeMissingCharacterPresence(store, { turn: ctx.turn ?? `loop:${written.loop}` }).catch(() => null);

  EPOCHS.set(store.worldRoot, loopEpoch(store) + 1);

  // 6. One event, and every reader starts from it.
  let links = 0;
  try {
    const board = JSON.parse(await store.readFile('player-board.json')) as { links?: unknown[] };
    links = Array.isArray(board.links) ? board.links.length : 0;
  } catch {
    links = 0;
  }
  const kept = { notes: notes.length, links, states: written.states, files: [...files.keys()] };
  const event = await store.appendEventAndPushCursors({
    type: 'loop_reset',
    actor: { type: 'engine' },
    detail: {
      loop: written.loop,
      kept,
      dropped,
      ...(staged.stages.length ? { stages: staged.stages } : {}),
      ...(input.reason ? { reason: input.reason } : {}),
    },
    turn: ctx.turn,
  });
  return { loop: written.loop, reused: false, kept, dropped, stages: staged.stages, event };
}

/* ── the writer's recap (render/sections.ts `loop`) ──────────────────────── */

export interface LoopStatus {
  loop: number;
  /** Kept player states that are set: flags that are true, other values as they are. */
  known: Array<{ id: string; label: string; value: StateValue }>;
}

/** Where the loop stands, for the writer; null for a world without `loop`. */
export async function readLoopStatus(store: WorldStore): Promise<LoopStatus | null> {
  const loop = parseLoopConfig(await store.getManifest());
  if (!loop) return null;
  const file = await readStateFile(store, PLAYER_README);
  let count = 1;
  const known: LoopStatus['known'] = [];
  for (const decl of file?.states ?? []) {
    const value = currentStateValue(decl, file?.data);
    if (decl.id === loop.counter) {
      if (typeof value === 'number') count = value;
      continue;
    }
    if (!loopStateMatches(loop.states, decl.id)) continue;
    if (decl.type === 'flag' ? value === true : value !== decl.initial) known.push({ id: decl.id, label: decl.label, value });
  }
  return { loop: count, known };
}
