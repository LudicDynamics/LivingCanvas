/**
 * doc-16 — the two world-level governance actions.
 *
 *   snapshotWorld  (E entry: a plot beat / session end / before a god-scale edit)
 *   rollbackWorld  (E entry: restore the files a snapshot captured)
 *
 * Scope boundary, stated once so nobody re-derives it: **a snapshot captures and
 * restores WORLD FILES ONLY.** `canvas.db` current values (card layout, presence,
 * backpack, dice results) are deliberately OUT — doc-16 §1 still lists "背包、骰子
 * 结果、跟随状态这些 canvas.db 当前值怎么跟着回" as 待定, and inventing that
 * semantics here would make a rollback silently disagree with the files it just
 * restored. The event table is append-only and is likewise never rolled back
 * (doc-21 §6): a rollback APPENDS `world_rolled_back`, it does not delete rows.
 *
 * The archive lives at `.airpworld/snapshots/<id>.zip` and is excluded from its
 * own contents (otherwise every snapshot would nest the previous ones).
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import type { AppendEventArgs, WorldEvent } from '../schemas/events.js';
import { ActionError } from './errors.js';
import { registerAction } from './service.js';
import { actorLabel } from './actor.js';
import type { ActionContext, ActionResult } from './types.js';
import { isPlayerNotePath, PLAYER_BOARD_PATH } from '../rules/player-notes.js';
import { parseLoopConfig } from '../schemas/loop.js';

const runFile = promisify(execFile);

/** Where snapshots are kept, world-relative (the only reserved hidden root). */
export const SNAPSHOT_DIR = '.airpworld/snapshots';

/**
 * The world files a snapshot owns and a rollback replaces. `.airpworld/assets`
 * holds generated images — world CONTENT the narrative points at, so it travels
 * with the snapshot. `canvas.db` / `history.db` / `sessions` are state, not
 * content, and are never restored (see the module header).
 */
const RESTORE_ROOTS = ['world', 'characters', 'player', 'world.json', '.airpworld/assets'];

export interface SnapshotWorldInput {
  reason: string;
}

export interface SnapshotWorldDetails {
  snapshot: string;
  path: string;
  files: number;
  reason: string;
  event?: WorldEvent;
}

/**
 * What a rollback leaves alone. The player's
 * sticky notes (`world/**\/player-note-<n>.md`) and clue board
 * (`player-board.json`) are the player's annotations, not world content: in a
 * world that declares `loop`, a rollback rewinds the world and keeps them.
 */
export type RollbackKeep = 'player-annotations';

export interface RollbackWorldInput {
  snapshot: string;
  /**
   * `'player-annotations'`: keep notes and board as they are now. Absent: a
   * world with `loop` keeps them (per its `loop.persist.notes/board`), every
   * other world restores them with the snapshot, as always.
   */
  keep?: RollbackKeep;
}

export interface RollbackWorldDetails {
  snapshot: string;
  to: string;
  restored: number;
  removed: number;
  /** World-relative paths the rollback left as they were (`keep`). */
  kept: string[];
  event?: WorldEvent;
}

/** `snap-20260914T101500Z-ab12` — sortable, collision-resistant, no shell chars. */
function snapshotIdOf(iso: string): string {
  const compact = iso.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return `snap-${compact}-${randomUUID().slice(0, 4)}`;
}

/** `<id>` or a world-relative/absolute zip path → the absolute archive path. */
function archivePathOf(worldRoot: string, snapshot: string): string {
  if (snapshot === '' || snapshot.includes('\0')) {
    throw new ActionError({ code: 'invalid_argument', message: 'snapshot must be a non-empty id' });
  }
  if (snapshot.startsWith('.airpworld/') || path.isAbsolute(snapshot)) {
    return path.isAbsolute(snapshot) ? snapshot : path.join(worldRoot, snapshot);
  }
  return path.join(worldRoot, SNAPSHOT_DIR, `${snapshot}.zip`);
}
async function runTool(tool: string, args: string[], cwd: string): Promise<string> {
  try {
    const { stdout } = await runFile(tool, args, { cwd, maxBuffer: 64 * 1024 * 1024 });
    return stdout;
  } catch (err) {
    // `execFile` reports a missing binary as an Error carrying `code: 'ENOENT'`.
    const missing = err instanceof Error && 'code' in err && err.code === 'ENOENT';
    if (missing) {
      throw new ActionError({
        code: 'unsupported',
        message: `The '${tool}' executable is required for world snapshots and was not found on PATH.`,
      });
    }
    throw new ActionError({
      code: 'internal',
      message: `${tool} failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

/** Every file under `root`, skipping `node_modules`; missing root → `[]`. */
async function walkFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(current: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules') continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out.push(full);
    }
  }
  await walk(root);
  return out;
}

/** Drop now-empty directories under `root` (best effort — a rollback never fails on cleanup). */
async function pruneEmptyDirs(root: string): Promise<void> {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const full = path.join(root, entry.name);
    await pruneEmptyDirs(full);
    await fs.rmdir(full).catch(() => {});
  }
}

/**
 * Zip the world's CONTENT roots (`RESTORE_ROOTS`) into `archive` — the same
 * format `snapshotWorld` writes, minus the state files a rollback never
 * extracts anyway, and minus nested `.pi/` agent stores (a character's memory
 * is runtime, not content). Used for the fixed `loop-start` snapshot.
 */
export async function zipWorldContent(worldRoot: string, archive: string): Promise<void> {
  const roots: string[] = [];
  for (const root of RESTORE_ROOTS) {
    if (await fs.stat(path.join(worldRoot, root)).catch(() => null)) roots.push(root);
  }
  await fs.mkdir(path.dirname(archive), { recursive: true });
  // `.partial.zip`, not `.zip.partial`: zip (and browser mode's shim) append
  // `.zip` to a name without that extension.
  const partial = archive.replace(/\.zip$/, '') + '.partial.zip';
  await fs.rm(partial, { force: true });
  try {
    await runTool('zip', ['-r', '-q', partial, ...roots, '-x', '*/.pi/*'], worldRoot);
    await fs.rename(partial, archive);
  } catch (err) {
    await fs.rm(partial, { force: true }).catch(() => {});
    throw err;
  }
}

/** The annotation paths a `keep` protects, given what is on disk now. */
function keptPathOf(rel: string, keep: { notes: boolean; board: boolean }): boolean {
  return (keep.notes && isPlayerNotePath(rel)) || (keep.board && rel === PLAYER_BOARD_PATH);
}

/** Resolve `keep` against the world: explicit wins; else a loop world's `persist`; else nothing. */
async function keepOf(ctx: ActionContext, keep: RollbackKeep | undefined): Promise<{ notes: boolean; board: boolean }> {
  if (keep === 'player-annotations') return { notes: true, board: true };
  const loop = parseLoopConfig(await ctx.store.getManifest().catch(() => null));
  return loop ? { notes: loop.notes, board: loop.board } : { notes: false, board: false };
}

function assertActorMayGovern(actor: ActionContext['actor'], operation: string): void {
  if (actor.type !== 'engine' && actor.type !== 'god' && actor.type !== 'writer') {
    throw new ActionError({
      code: 'unsupported',
      message: `${actorLabel(actor)} may not ${operation} the world.`,
    });
  }
}

export async function snapshotWorld(
  ctx: ActionContext,
  input: SnapshotWorldInput
): Promise<ActionResult<SnapshotWorldDetails>> {
  const { store } = ctx;
  assertActorMayGovern(ctx.actor, 'snapshot');
  const reason = typeof input?.reason === 'string' ? input.reason.trim() : '';
  if (reason === '') {
    throw new ActionError({ code: 'invalid_argument', message: 'reason must be a non-empty string' });
  }

  const iso = ctx.now ? ctx.now() : new Date().toISOString();
  const snapshot = snapshotIdOf(iso);
  const dir = path.join(store.worldRoot, SNAPSHOT_DIR);
  await fs.mkdir(dir, { recursive: true });
  const archive = path.join(dir, `${snapshot}.zip`);

  // Zip the world root, excluding the snapshot store itself (recursion guard).
  // `zip` writes in place; a partially written archive is removed on failure so
  // a broken snapshot cannot later restore into a half-written world.
  try {
    await runTool('zip', ['-r', '-q', archive, '.', '-x', `${SNAPSHOT_DIR}/*`], store.worldRoot);
  } catch (err) {
    await fs.rm(archive, { force: true }).catch(() => {});
    throw err;
  }

  const contents = await runTool('unzip', ['-Z1', archive], store.worldRoot);
  const files = contents.split('\n').filter((line) => line !== '' && !line.endsWith('/')).length;

  const event = await store.appendEvent({
    type: 'world_snapshot',
    actor: ctx.actor,
    detail: { snapshot, reason },
    subject: snapshot,
    turn: ctx.turn,
  });

  return {
    text: `${actorLabel(ctx.actor)} snapshotted the world as "${snapshot}" (${reason}).`,
    details: { snapshot, path: `${SNAPSHOT_DIR}/${snapshot}.zip`, files, reason, event },
  };
}

export interface RestoredContent {
  restored: number;
  removed: number;
  kept: string[];
}

/**
 * The file half of a rollback, with no event: put the content roots back to
 * `snapshot`, leaving `keep`'s annotations alone. `rollbackWorld` and
 * `loopReset` (actions/loop.ts) both land on this, each with its own event.
 */
export async function restoreSnapshotContent(
  ctx: ActionContext,
  snapshot: string,
  keepInput?: RollbackKeep,
): Promise<RestoredContent> {
  const { store } = ctx;
  const archive = archivePathOf(store.worldRoot, snapshot);
  if ((await fs.stat(archive).catch(() => null))?.isFile() !== true) {
    throw new ActionError({ code: 'not_found', message: `Snapshot archive not found: "${snapshot}"` });
  }

  // The archive's own file set, world-relative — the authority for both "what to
  // restore" and "what must disappear".
  const listing = await runTool('unzip', ['-Z1', archive], store.worldRoot);
  const inArchive = new Set(listing.split('\n').filter((line) => line !== '' && !line.endsWith('/')));
  const keep = await keepOf(ctx, keepInput);
  const kept = new Set<string>();

  // Step 1: remove every RESTORE_ROOTS file the snapshot does not contain, so a
  // rollback actually returns the files to the captured state instead of layering
  // the archive over whatever was written since.
  let removed = 0;
  for (const root of RESTORE_ROOTS) {
    const abs = path.join(store.worldRoot, root);
    for (const file of await walkFiles(abs)) {
      const rel = path.relative(store.worldRoot, file).split(path.sep).join('/');
      if (keptPathOf(rel, keep)) {
        kept.add(rel);
        continue;
      }
      if (inArchive.has(rel)) continue;
      await fs.rm(file, { force: true });
      removed += 1;
    }
  }

  // Step 2: extract only the content roots. `-o` overwrites; the extraction list
  // is explicit so state files (history.db / canvas.db / sessions) in the archive
  // can never land on the live world.
  const restoreEntries = [...inArchive].filter((rel) =>
    RESTORE_ROOTS.some((root) => rel === root || rel.startsWith(`${root}/`)) && !keptPathOf(rel, keep)
  );
  if (restoreEntries.length > 0) {
    await runTool('unzip', ['-o', '-q', archive, ...restoreEntries, '-d', store.worldRoot], store.worldRoot);
  }
  for (const root of RESTORE_ROOTS) {
    await pruneEmptyDirs(path.join(store.worldRoot, root));
  }
  // The board sits at the world root, outside RESTORE_ROOTS: a rollback never
  // touched it. Reported so the caller sees what the player keeps.
  if (keep.board && (await store.statKind(PLAYER_BOARD_PATH)) === 'file') kept.add(PLAYER_BOARD_PATH);
  return { restored: restoreEntries.length, removed, kept: [...kept].sort() };
}

export async function rollbackWorld(
  ctx: ActionContext,
  input: RollbackWorldInput
): Promise<ActionResult<RollbackWorldDetails>> {
  const { store } = ctx;
  assertActorMayGovern(ctx.actor, 'roll back');
  const snapshot = typeof input?.snapshot === 'string' ? input.snapshot.trim() : '';
  const { restored, removed, kept } = await restoreSnapshotContent(ctx, snapshot, input?.keep);

  // Step 3: the append + cursor flush are ONE transaction (doc-21 §6). The
  // writer must still be able to read this sentence, so the flush targets this
  // event's own seq rather than a later max.
  const event = await store.appendEventAndPushCursors({
    type: 'world_rolled_back',
    actor: { type: 'engine' },
    detail: { snapshot, to: `${SNAPSHOT_DIR}/${snapshot}.zip` },
    subject: snapshot,
    turn: ctx.turn,
  } satisfies AppendEventArgs);

  return {
    text: `The world was rolled back to the "${snapshot}" snapshot (${restored} files restored, ${removed} removed${kept.length ? `, ${kept.length} player annotations kept` : ''}).`,
    details: { snapshot, to: `${SNAPSHOT_DIR}/${snapshot}.zip`, restored, removed, kept, event },
  };
}

registerAction('snapshotWorld', (ctx, input) => snapshotWorld(ctx, input as unknown as SnapshotWorldInput));
registerAction('rollbackWorld', (ctx, input) => rollbackWorld(ctx, input as unknown as RollbackWorldInput));
