import fs from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type {
  ArrangeCanvasLayerInput,
  ArrangeCanvasLayerResult,
  CanvasCommit,
  CanvasPositionInput,
  CardRecord,
  CharacterCreationTransaction,
  LinkRecord,
  SeatFile,
  WorldStore,
} from './world-store.js';
import { deriveLayers, layerOfPath, layerOfDir, cardsOfLayer, childLayers, WORLD_DIR } from './layers.js';
import { linkIdOf } from '../schemas/canvas.js';
import { type WorldManifest, type LayerConfig, validateWorldManifest } from '../schemas/world.js';
import { isValidCharacterId } from '../rules/characters.js';
import { entityName, parseFrontmatter } from '../schemas/frontmatter.js';
import type { ActorValue, AppendEventArgs, DanglingRef, MoveResult, WorldEvent } from '../schemas/events.js';
import { EventDetailSchemas } from '../schemas/events.js';
import { ActionError } from '../actions/errors.js';
import { dirname as posixDirname, relFrom, rewriteOwnRefs, scanOwnRefs, scanRefs, rewriteRefs } from '../actions/refs.js';
import { initCanvasDatabase, initHistoryDatabase } from '../db/schema.js';
import { CARD_FORMS, cardFormOf, cardFormVersionOf, cardKindOf } from '../schemas/forms.js';
import { flowColumns } from '../layout/flow-columns.js';
import type { PresenceRecord, SeatPresenceResult, ViewpointRecord } from './world-store.js';
import type { AutoLayoutRect } from '../layout/flow-columns.js';
import { readCanvasSnapshot, readCanvasSnapshotInTransaction } from '../render/canvas-snapshot.js';

/** Seating anchor (world coords, viewport agnostic). Cards spiral outward from here. */
export const SEAT_ANCHOR = { x: 960, y: 540 };
/** Spiral step between candidate cells, in world px. */
export const SEAT_STEP = 96;
type CharacterCreationJournal = {
  characterId: string;
  stageDir: string;
  targets: string[];
  status: 'staged' | 'manifest_committed' | 'event_committed';
  manifestBefore?: string;
  manifestAfter?: string;
  eventKey?: string;
  eventArgs?: AppendEventArgs;
};
/** Collision padding around card bounds when judging seat overlap. */
export const SEAT_PAD = 22;
/** Max candidate cells tried before falling back to the anchor itself. */
const SEAT_MAX_CANDIDATES = 600;

/** The viewpoint row is dead after this long with no report (00 §5.1 / 05 §2.3). */
export const VIEWPOINT_TTL_MS = 10 * 60 * 1000;

/**
 * Wire-encode a view CENTRE as `'x:y'` (05 §2.5). NOT `encodeViewRect`: that is
 * a quantised w/h rect for the DISPLACEMENT path (05 §3); a centre is a point,
 * so quantising it would only desync it from the `focus_x/y` mirror columns.
 */
function encodeCentre(focus: { x: number; y: number } | null): string {
  return focus ? `${Math.round(focus.x)}:${Math.round(focus.y)}` : '';
}

/** Inverse of `encodeCentre`; anything not exactly two finite fields → null. */
function decodeCentre(text: string): { x: number; y: number } | null {
  if (text === '') return null;
  const parts = text.split(':');
  if (parts.length !== 2) return null;
  const x = Number(parts[0]);
  const y = Number(parts[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

/** `selected` round-trips as JSON; bad data degrades to `[]`, never throws. */
function parseSelected(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

// Ulam spiral cells: R -> D -> L -> U, step lengths [1,1,2,2,3,3,...], starting at (0,0).
function* spiralCells(): Generator<[number, number]> {
  const dirs: Array<[number, number]> = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ];
  let x = 0;
  let y = 0;
  yield [x, y];
  let step = 1;
  let dir = 0;
  while (true) {
    for (let i = 0; i < 2; i++) {
      for (let s = 0; s < step; s++) {
        x += dirs[dir][0];
        y += dirs[dir][1];
        yield [x, y];
      }
      dir = (dir + 1) % 4;
    }
    step++;
  }
}

function compareCanvasPath(a: string, b: string): number {
  return a === b ? 0 : a < b ? -1 : 1;
}

function canvasBoxesOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function canvasModePositions(
  mode: ArrangeCanvasLayerInput['mode'],
  rows: readonly CardRecord[],
): Array<{ path: string; x: number; y: number }> {
  const items = [...rows].sort((a, b) => compareCanvasPath(a.id, b.id));
  if (items.length === 0) return [];
  if (mode === 'row') {
    const pitch = Math.max(SEAT_STEP, Math.max(...items.map((row) => row.w)) + SEAT_PAD);
    return items.map((row, i) => ({
      path: row.id,
      x: SEAT_ANCHOR.x + (i - (items.length - 1) / 2) * pitch - row.w / 2,
      y: SEAT_ANCHOR.y - row.h / 2,
    }));
  }
  if (mode === 'circle') {
    const n = items.length;
    const radius = n === 1
      ? SEAT_STEP
      : Math.max(SEAT_STEP, (Math.max(...items.map((row) => Math.hypot(row.w, row.h))) + SEAT_PAD) / (2 * Math.sin(Math.PI / n)));
    return items.map((row, i) => {
      const theta = -Math.PI / 2 + (2 * Math.PI * i) / n;
      return {
        path: row.id,
        x: SEAT_ANCHOR.x + radius * Math.cos(theta) - row.w / 2,
        y: SEAT_ANCHOR.y + radius * Math.sin(theta) - row.h / 2,
      };
    });
  }
  const cols = Math.ceil(Math.sqrt(items.length));
  const rowCount = Math.ceil(items.length / cols);
  const pitchX = Math.max(SEAT_STEP, Math.max(...items.map((row) => row.w)) + SEAT_PAD);
  const pitchY = Math.max(SEAT_STEP, Math.max(...items.map((row) => row.h)) + SEAT_PAD);
  return items.map((row, i) => ({
    path: row.id,
    x: SEAT_ANCHOR.x + ((i % cols) - (cols - 1) / 2) * pitchX - row.w / 2,
    y: SEAT_ANCHOR.y + (Math.floor(i / cols) - (rowCount - 1) / 2) * pitchY - row.h / 2,
  }));
}

function canvasOverlapPairs(
  positions: readonly { path: string; x: number; y: number }[],
  targets: readonly CardRecord[],
  obstacles: readonly { id: string; x: number; y: number; w: number; h: number }[],
): Array<[string, string]> {
  const byId = new Map(targets.map((row) => [row.id, row]));
  const pairs: Array<[string, string]> = [];
  const placed = positions
    .map((position) => {
      const row = byId.get(position.path);
      return row ? { id: row.id, x: position.x, y: position.y, w: row.w, h: row.h } : null;
    })
    .filter((row): row is { id: string; x: number; y: number; w: number; h: number } => row !== null);
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      if (canvasBoxesOverlap(placed[i], placed[j])) pairs.push([placed[i].id, placed[j].id]);
    }
    for (const obstacle of obstacles) {
      if (canvasBoxesOverlap(placed[i], obstacle)) pairs.push([placed[i].id, obstacle.id]);
    }
  }
  return pairs.sort((a, b) => compareCanvasPath(a[0], b[0]) || compareCanvasPath(a[1], b[1]));
}

function canvasPositionsOverlap(
  positions: readonly { path: string; x: number; y: number }[],
  targets: readonly CardRecord[],
  obstacles: readonly { id: string; x: number; y: number; w: number; h: number }[],
): boolean {
  return canvasOverlapPairs(positions, targets, obstacles).length > 0;
}

type ArrangeCanvasCompatInput = ArrangeCanvasLayerInput & {
  paths?: readonly string[];
  seeds?: ReadonlyArray<{ path: string; w: number; h: number }>;
};

export class LocalWorldStore implements WorldStore {
  public worldRoot: string;
  private canvasDb: DatabaseSync;
  private historyDb: DatabaseSync;
  private manifestCache: WorldManifest | null = null;
  /** `manifest.id` is stable for a world; reading it re-scans every layer dir. */
  private projectIdCache: string | null = null;
  /** Serialize layout reads and writes per world/layer within this process. */
  private readonly seatLocks = new Map<string, Promise<void>>();
  constructor(worldRoot: string) {
    this.worldRoot = path.resolve(worldRoot);
    const airpDir = path.join(this.worldRoot, '.airpworld');
    mkdirSync(airpDir, { recursive: true });

    this.canvasDb = new DatabaseSync(path.join(airpDir, 'canvas.db'));
    this.historyDb = new DatabaseSync(path.join(airpDir, 'history.db'));

    initCanvasDatabase(this.canvasDb);
    initHistoryDatabase(this.historyDb);
    void this.reconcileCharacterCreationJournals();
  }

  /**
   * Validate BEFORE joining, then assert AFTER joining (two layers, 01 §7.3).
   * The old implementation only stripped LEADING `../` — `a/../../etc/passwd`
   * still escaped the world root after `path.join` normalisation, making every
   * model-supplied path an arbitrary-write channel.
   */
  private resolvePath(relPath: string): string {
    if (!relPath) {
      throw new ActionError({ code: 'invalid_argument', message: 'Path must not be empty' });
    }
    if (path.isAbsolute(relPath)) {
      throw new ActionError({
        code: 'invalid_path',
        message: `Path must be world-relative, got "${relPath}"`,
      });
    }
    if (relPath.includes('\\')) {
      throw new ActionError({
        code: 'invalid_path',
        message: `Path must use POSIX separators, got "${relPath}"`,
      });
    }
    const segs = relPath.split('/').filter((s) => s !== '' && s !== '.');
    if (segs.includes('..')) {
      throw new ActionError({
        code: 'invalid_path',
        message: `Path must not contain "..", got "${relPath}"`,
      });
    }
    // `.airpworld/assets/**` is world CONTENT (generated images) — the only
    // hidden root the store may touch (01 §7.3 / 00 §2.5, REVIEW B-2).
    const inAssetTree = segs[0] === '.airpworld' && segs[1] === 'assets';
    if (!inAssetTree && (segs.some((s) => s.startsWith('.')) || segs.includes('node_modules'))) {
      throw new ActionError({
        code: 'invalid_path',
        message: `Path is inside a reserved directory: "${relPath}"`,
      });
    }
    const abs = path.join(this.worldRoot, segs.join('/'));
    // Belt: even after normalisation, never leave the world root.
    if (abs !== this.worldRoot && !abs.startsWith(this.worldRoot + path.sep)) {
      throw new ActionError({
        code: 'invalid_path',
        message: `Path escapes the world root: "${relPath}"`,
      });
    }
    return abs;
  }

  async readFile(relPath: string): Promise<string> {
    const absPath = this.resolvePath(relPath);
    return await fs.readFile(absPath, 'utf-8');
  }

  async writeFile(relPath: string, content: string | Buffer): Promise<void> {
    const absPath = this.resolvePath(relPath);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, content);
  }

  /**
   * Same-dir temp file + rename. The original is untouched on failure, and the
   * temp name carries pid + a random segment because two processes may write
   * the same file concurrently (01 §10.3).
   */
  async writeFileAtomic(relPath: string, content: string | Buffer): Promise<void> {
    const absPath = this.resolvePath(relPath);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    const tmp = `${absPath}.tmp-${process.pid}-${randomUUID().slice(0, 8)}`;
    try {
      await fs.writeFile(tmp, content);
      await fs.rename(tmp, absPath);
    } catch (err) {
      await fs.rm(tmp, { force: true });
      throw new ActionError({
        code: 'write_failed',
        message: `Failed to write "${relPath}": ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  /** `readFile` is utf-8 only; PNG/asset tiers need base64. */
  async readFileBase64(relPath: string): Promise<string> {
    const absPath = this.resolvePath(relPath);
    return (await fs.readFile(absPath)).toString('base64');
  }

  async statKind(relPath: string): Promise<'file' | 'dir' | 'missing'> {
    try {
      const st = await fs.stat(this.resolvePath(relPath));
      return st.isDirectory() ? 'dir' : 'file';
    } catch {
      return 'missing';
    }
  }

  async deleteFile(relPath: string): Promise<void> {
    const absPath = this.resolvePath(relPath);
    await fs.rm(absPath, { force: true, recursive: true });
  }

  async listFiles(prefix = ''): Promise<string[]> {
    const rootDir = prefix ? this.resolvePath(prefix) : this.worldRoot;
    const results: string[] = [];

    async function walk(current: string) {
      try {
        const entries = await fs.readdir(current, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
          const full = path.join(current, entry.name);
          if (entry.isDirectory()) {
            await walk(full);
          } else {
            results.push(full);
          }
        }
      } catch {
        // Ignored if path does not exist
      }
    }

    await walk(rootDir);
    return results.map((abs) => path.relative(this.worldRoot, abs).split(path.sep).join('/'));
  }

  /**
   * Every directory under `prefix` (relative paths) — the layer tree when
   * called with no argument (defaults to `world/`).
   *
   * A DIRECTORY walk: EMPTY directories are included, so a door card exists for
   * a scene nobody has written yet (nook sub-scenes, the design notes).
   * `prefix` takes a subtree such as `characters/<id>` so the nook derivation
   * can reuse this instead of deriving directories from `listFiles` (a file
   * walk, where a completely empty subdirectory disappears).
   */
  async listDirs(prefix = WORLD_DIR): Promise<string[]> {
    const root = this.resolvePath(prefix);
    const out: string[] = [];
    async function walk(current: string) {
      let entries: Dirent[];
      try {
        entries = await fs.readdir(current, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        // Same skip rule as `listFiles` above: one tree, two walks, one rule.
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        if (entry.isDirectory()) {
          const full = path.join(current, entry.name);
          out.push(full);
          await walk(full);
        }
      }
    }
    await walk(root);
    return [root, ...out].map((abs) => path.relative(this.worldRoot, abs).split(path.sep).join('/'));
  }

  /**
   * Physical move + reference rewrite (01 §2.7 keeps this signature). The
   * action layer (`moveEntity`) owns validation, canvas migration and seating;
   * this wrapper keeps the historical shape for direct store callers and lands
   * the `engine` event those callers expect. `moveEntity` uses `moveFile` so it
   * can land the event itself with the REAL actor (04 §3.1 step 9).
   */
  async move(from: string, to: string): Promise<MoveResult> {
    const { name, rewrote, dangling } = await this.moveFile(from, to);
    const event = await this.appendEvent({
      type: 'entity_moved',
      actor: { type: 'engine' },
      detail: { from, to, name, rewrote: rewrote.length, dangling: dangling.length },
      subject: to,
      layer: (await this.resolveLayer(from)) ?? (await this.resolveLayer(to)) ?? undefined,
    });
    return { ok: true, from, to, name, rewrote, dangling, event };
  }

  /**
   * The three physical steps of a move: rewrite references pointing AT the file
   * (two passes, 04 §3.6.1), rename, then re-base the moved file's OWN relative
   * references (step 7, §3.6.6). No event — the caller owns actor + turn.
   */
  async moveFile(
    from: string,
    to: string
  ): Promise<{ name: string; rewrote: string[]; dangling: DanglingRef[] }> {
    const absFrom = this.resolvePath(from);
    const absTo = this.resolvePath(to);

    const rawFrom = await fs.readFile(absFrom, 'utf-8');
    const { frontmatter } = parseFrontmatter(rawFrom);
    const name = entityName(frontmatter, from);

    // Scanning happens BEFORE the rename so bare-basename references still
    // resolve unambiguously to `from`; the file contents the offsets point into
    // are unchanged by a rename.
    const sites = await scanRefs(this, from, to);

    await fs.mkdir(path.dirname(absTo), { recursive: true });
    // Move without ever clobbering: the destination is checked first, then a
    // single atomic `rename`. Docs/tools/04 §process step 3 requires
    // `already_exists` ("绝不覆盖") and warns that `fs.rename` alone silently
    // overwrites a same-named entity. A bare rename would do exactly that, so
    // the guard is explicit here — `store.move` is a public entry point and may
    // be called directly (tools/hover-actions.test.mjs), not only via
    // `moveEntity` (which validates too, non-atomically, before reaching here).
    if ((await this.statKind(to)) !== 'missing') {
      const err = new Error(`EEXIST: destination already exists: "${to}"`) as NodeJS.ErrnoException;
      err.code = 'EEXIST';
      throw err;
    }
    await fs.rename(absFrom, absTo);

    const { rewrote, dangling } = await rewriteRefs(this, from, to, sites);

    // Step 7: the file's own relative links now point into the wrong directory.
    const oldDir = posixDirname(from);
    const newDir = posixDirname(to);
    if (oldDir !== newDir) {
      const own = await scanOwnRefs(this, to, oldDir);
      await rewriteOwnRefs(this, to, oldDir, newDir, own);
    }

    return { name, rewrote, dangling };
  }

  /**
   * The manifest. `layers` is ALWAYS derived from the directory tree — never
   * read from world.json. Declaring the tree in two places let them drift, so
   * the file carries only world-level facts (name/genre/characters/…).
   */
  async getManifest(): Promise<WorldManifest> {
    const raw = await this.readFile('world.json');
    const parsed = JSON.parse(raw);
    const layers = await this.scanLayers();
    this.manifestCache = validateWorldManifest({ ...parsed, layers });
    return this.manifestCache;
  }

  /** Derive every layer from the directory tree (see store/layers.ts). */
  private async scanLayers(): Promise<Record<string, LayerConfig>> {
    const dirs = await this.listDirs();
    const fmByDir = new Map<string, Record<string, any> | null>();
    for (const d of dirs) {
      try {
        fmByDir.set(d, parseFrontmatter(await this.readFile(`${d}/README.md`)).frontmatter);
      } catch {
        fmByDir.set(d, null); // no README → stub layer
      }
    }
    return deriveLayers(dirs, (d) => fmByDir.get(d) ?? null);
  }

  async updateManifest(updates: Partial<WorldManifest>): Promise<void> {
    const current = await this.getManifest();
    const merged = {
      ...current,
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    const valid = validateWorldManifest(merged);
    // `layers` is derived, not declared — keep it out of the file so the tree
    // stays the single source (a written map would drift again).
    const { layers: _derived, ...persisted } = valid;
    await this.writeFile('world.json', JSON.stringify(persisted, null, 2));
    this.manifestCache = valid;
  }

  queryCanvas(sql: string, params: any[] = []): any[] {
    const stmt = this.canvasDb.prepare(sql);
    return stmt.all(...params);
  }

  execCanvas(sql: string, params: any[] = []): void {
    const stmt = this.canvasDb.prepare(sql);
    stmt.run(...params);
  }
  private async withSeatLock<T>(layerId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.seatLocks.get(layerId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.seatLocks.set(layerId, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.seatLocks.get(layerId) === tail) this.seatLocks.delete(layerId);
    }
  }

  private layoutOccupied(
    layerId: string,
    pageRows: readonly CardRecord[],
    excluded: ReadonlySet<string> = new Set()
  ): AutoLayoutRect[] {
    const ids = new Set(this.cardsInLayer(layerId));
    for (const row of pageRows) ids.add(row.id);
    return this.getLayerCards([...ids])
      .filter((row) => !excluded.has(row.id) && row.w > 0 && row.h > 0)
      .map((row) => ({ id: row.id, x: row.x, y: row.y, w: row.w, h: row.h }));
  }

  private characterJournalRoot(): string {
    return path.join(this.worldRoot, '.airpworld', 'create-char-journal');
  }
  private async writeCharacterJournal(file: string, journal: CharacterCreationJournal): Promise<void> {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${process.pid}-${randomUUID().slice(0, 6)}`;
    try {
      await fs.writeFile(tmp, JSON.stringify(journal, null, 2));
      await fs.rename(tmp, file);
    } catch (err) {
      await fs.rm(tmp, { force: true }).catch(() => {});
      throw new ActionError({ code: 'write_failed', message: `Character creation journal failed: ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  private async readCharacterJournal(file: string): Promise<CharacterCreationJournal> {
    return JSON.parse(await fs.readFile(file, 'utf8')) as CharacterCreationJournal;
  }

  private async appendEventLocked(args: AppendEventArgs): Promise<WorldEvent> {
    const projectId = await this.projectId();
    if (process.env.NODE_ENV !== 'production') {
      const schema = EventDetailSchemas[args.type];
      const parsed = schema.safeParse(args.detail);
      if (!parsed.success) {
        throw new ActionError({
          code: 'invalid_argument',
          message: `Event '${args.type}' detail does not match its schema: ${parsed.error.message}`,
        });
      }
    }
    const now = new Date().toISOString();
    const info = this.historyDb
      .prepare(
        `INSERT INTO events (id, project_id, type, actor_type, actor_id, layer, subject, turn, detail, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        '',
        projectId,
        args.type,
        args.actor.type,
        args.actor.id ?? null,
        args.layer ?? null,
        args.subject ?? null,
        args.turn ?? null,
        JSON.stringify(args.detail),
        now
      );
    const seq = Number(info.lastInsertRowid);
    this.historyDb.prepare('UPDATE events SET id = ? WHERE seq = ?').run(`evt-${seq}`, seq);
    return {
      seq,
      id: `evt-${seq}`,
      projectId,
      type: args.type,
      actor: args.actor,
      layer: args.layer ?? null,
      subject: args.subject ?? null,
      turn: args.turn ?? null,
      detail: args.detail,
      createdAt: now,
    };
  }

  async withCharacterCreationWriteLock<T>(
    characterId: string,
    work: (tx: CharacterCreationTransaction) => Promise<T>,
  ): Promise<T> {
    if (!isValidCharacterId(characterId)) {
      throw new ActionError({ code: 'invalid_argument', message: `Invalid character id "${characterId}"` });
    }
    const journalDir = this.characterJournalRoot();
    await fs.mkdir(journalDir, { recursive: true });
    let journalFile: string | null = null;
    let journal: CharacterCreationJournal | null = null;
    try {
      this.historyDb.exec('BEGIN IMMEDIATE');
    } catch (err) {
      throw new ActionError({ code: 'write_failed', message: `Character creation lock unavailable: ${err instanceof Error ? err.message : String(err)}` });
    }
    try {
      const tx: CharacterCreationTransaction = {
        stageBundle: async (files) => {
          if (journalFile) throw new ActionError({ code: 'write_failed', message: 'Character bundle already staged' });
          const stageDir = path.join(this.worldRoot, '.airpworld', 'create-char-staging', `${characterId}-${randomUUID()}`);
          const targets = [...files.keys()];
          if (targets.length === 0) throw new ActionError({ code: 'write_failed', message: 'Character bundle is empty' });
          try {
            for (const target of targets) {
              this.resolvePath(target);
              const staged = path.join(stageDir, target);
              await fs.mkdir(path.dirname(staged), { recursive: true });
              await fs.writeFile(staged, files.get(target)!);
            }
          } catch (err) {
            await fs.rm(stageDir, { force: true, recursive: true }).catch(() => {});
            if (err instanceof ActionError) throw err;
            throw new ActionError({ code: 'write_failed', message: `Character staging failed: ${err instanceof Error ? err.message : String(err)}` });
          }
          let current: WorldManifest;
          try {
            current = await this.getManifest();
          } catch (err) {
            await fs.rm(stageDir, { force: true, recursive: true }).catch(() => {});
            throw err;
          }
          const { layers: _beforeLayers, ...persistedBefore } = current;
          const file = path.join(journalDir, `${characterId}-${randomUUID()}.json`);
          journalFile = file;
          journal = {
            characterId,
            stageDir,
            targets,
            status: 'staged',
            manifestBefore: JSON.stringify(persistedBefore),
          };
          await this.writeCharacterJournal(file, journal);
        },
        commitBundleAndManifest: async (updates) => {
          if (!journalFile || !journal) throw new ActionError({ code: 'write_failed', message: 'Character bundle was not staged' });
          const current = await this.getManifest();
          const merged = validateWorldManifest({
            ...current,
            ...updates,
            updatedAt: new Date().toISOString(),
          });
          const { layers: _derived, ...persisted } = merged;
          journal.manifestAfter = JSON.stringify(merged);
          await this.writeCharacterJournal(journalFile, journal);
          const moved: string[] = [];
          try {
            for (const target of journal.targets) {
              const destination = this.resolvePath(target);
              if ((await this.statKind(target)) !== 'missing') {
                throw new ActionError({ code: 'already_exists', message: `Character target already exists: "${target}"` });
              }
              await fs.mkdir(path.dirname(destination), { recursive: true });
              await fs.rename(path.join(journal.stageDir, target), destination);
              moved.push(target);
            }
            await this.writeFileAtomic('world.json', JSON.stringify(persisted, null, 2));
            this.manifestCache = merged;
            journal.status = 'manifest_committed';
            await this.writeCharacterJournal(journalFile, journal);
          } catch (err) {
            for (const target of moved) await fs.rm(this.resolvePath(target), { force: true, recursive: true }).catch(() => {});
            if (journal.manifestBefore) {
              await this.writeFileAtomic('world.json', JSON.stringify(JSON.parse(journal.manifestBefore), null, 2)).catch(() => {});
            }
            if (err instanceof ActionError) throw err;
            throw new ActionError({ code: 'write_failed', message: `Character bundle commit failed: ${err instanceof Error ? err.message : String(err)}` });
          }
        },
        appendSuccessEventOnce: async (args, key) => {
          if (!journalFile || !journal || journal.status !== 'manifest_committed') {
            throw new ActionError({ code: 'event_failed', message: 'Character manifest is not committed' });
          }
          journal.eventArgs = args;
          journal.eventKey = key;
          await this.writeCharacterJournal(journalFile, journal);
          const projectId = await this.projectId();
          const detail = JSON.stringify(args.detail);
          const existing = this.historyDb.prepare(
            `SELECT * FROM events WHERE project_id = ? AND type = ? AND subject IS ? AND turn IS ? AND detail = ? ORDER BY seq LIMIT 1`
          ).get(projectId, args.type, args.subject ?? null, args.turn ?? null, detail) as Record<string, unknown> | undefined;
          const event = existing ? this.rowToEvent(existing as never) : await this.appendEventLocked(args);
          journal.status = 'event_committed';
          await this.writeCharacterJournal(journalFile, journal);
          return event;
        },
      };
      const result = await work(tx);
      this.historyDb.exec('COMMIT');
      const completedJournal = journal as CharacterCreationJournal | null;
      if (journalFile && completedJournal) {
        await fs.rm(completedJournal.stageDir, { force: true, recursive: true }).catch(() => {});
        await fs.rm(journalFile, { force: true }).catch(() => {});
      }
      return result;
    } catch (err) {
      // Release the BEGIN IMMEDIATE above: a rejected create_char (unknown voice,
      // collision …) used to leave it open, so every later create_char in this
      // store failed with "cannot start a transaction within a transaction".
      try { this.historyDb.exec('ROLLBACK'); } catch { /* already committed / none open */ }
      const failedJournal = journal as CharacterCreationJournal | null;
      if (journalFile && failedJournal?.status === 'manifest_committed') {
        // Manifest is durable but event append failed: reconciliation must finish it.
      } else if (journalFile && failedJournal) {
        await fs.rm(failedJournal.stageDir, { force: true, recursive: true }).catch(() => {});
        await fs.rm(journalFile, { force: true }).catch(() => {});
      }
      throw err;
    }
  }

  async reconcileCharacterCreationJournals(): Promise<void> {
    const root = this.characterJournalRoot();
    let names: string[] = [];
    try { names = (await fs.readdir(root)).filter((name) => name.endsWith('.json')); } catch { return; }
    for (const name of names) {
      const file = path.join(root, name);
      let journal: CharacterCreationJournal;
      try { journal = await this.readCharacterJournal(file); } catch { continue; }
      if (journal.status === 'staged') {
        await fs.rm(journal.stageDir, { force: true, recursive: true }).catch(() => {});
        await fs.rm(file, { force: true }).catch(() => {});
        continue;
      }
      if (!journal.eventArgs) continue;
      try {
        this.historyDb.exec('BEGIN IMMEDIATE');
        const projectId = await this.projectId();
        const detail = JSON.stringify(journal.eventArgs.detail);
        const existing = this.historyDb.prepare(
          `SELECT seq FROM events WHERE project_id = ? AND type = ? AND subject IS ? AND turn IS ? AND detail = ? LIMIT 1`
        ).get(projectId, journal.eventArgs.type, journal.eventArgs.subject ?? null, journal.eventArgs.turn ?? null, detail);
        if (!existing) await this.appendEventLocked(journal.eventArgs);
        this.historyDb.exec('COMMIT');
        await fs.rm(journal.stageDir, { force: true, recursive: true }).catch(() => {});
        await fs.rm(file, { force: true }).catch(() => {});
      } catch {
        try { this.historyDb.exec('ROLLBACK'); } catch {}
      }
    }
  }

  async appendHistoryEntry(sessionId: string, type: string, content: string): Promise<void> {
    const manifest = await this.getManifest();
    const id = `entry-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const stmt = this.historyDb.prepare(`
      INSERT INTO entries (id, project_id, session_id, type, content, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(id, manifest.id, sessionId, type, content, new Date().toISOString());
  }

  /**
   * Append one world event and return it ALREADY COMMITTED (01 §3.8): the
   * server's tail reader may query the moment this resolves, and a pre-commit
   * return could let it see `seq=n` without `seq=n-1`.
   */
  async appendEvent(args: AppendEventArgs): Promise<WorldEvent> {
    const projectId = await this.projectId();
    if (process.env.NODE_ENV !== 'production') {
      // Dev-only shape check: a mistyped detail field explodes here, not in a
      // renderer three layers away.
      const schema = EventDetailSchemas[args.type];
      const parsed = schema.safeParse(args.detail);
      if (!parsed.success) {
        throw new ActionError({
          code: 'invalid_argument',
          message: `Event '${args.type}' detail does not match its schema: ${parsed.error.message}`,
        });
      }
    }
    const now = new Date().toISOString();
    this.historyDb.exec('BEGIN IMMEDIATE');
    try {
      const info = this.historyDb
        .prepare(
          `INSERT INTO events (id, project_id, type, actor_type, actor_id, layer, subject, turn, detail, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          '',
          projectId,
          args.type,
          args.actor.type,
          args.actor.id ?? null,
          args.layer ?? null,
          args.subject ?? null,
          args.turn ?? null,
          JSON.stringify(args.detail),
          now
        );
      const seq = Number(info.lastInsertRowid);
      this.historyDb.prepare('UPDATE events SET id = ? WHERE seq = ?').run(`evt-${seq}`, seq);
      this.historyDb.exec('COMMIT');
      return {
        seq,
        id: `evt-${seq}`,
        projectId,
        type: args.type,
        actor: args.actor,
        layer: args.layer ?? null,
        subject: args.subject ?? null,
        turn: args.turn ?? null,
        detail: args.detail,
        createdAt: now,
      };
    } catch (err) {
      this.historyDb.exec('ROLLBACK');
      if (err instanceof ActionError) throw err;
      throw new ActionError({
        code: 'event_failed',
        message: `Failed to append event '${args.type}': ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  /**
   * Rollback's atomic core (doc-21 §6 / hooks/03 §6.2). `appendEvent` opens its
   * own transaction, so this reuses the locked insert and flushes every cursor
   * BEFORE committing: both land or neither does. Pushing to the event's OWN
   * seq (not a later `getMaxSeq()`) is what lets the writer still read the
   * rollback sentence while losing the pre-rollback backlog.
   */
  async appendEventAndPushCursors(args: AppendEventArgs): Promise<WorldEvent> {
    this.historyDb.exec('BEGIN IMMEDIATE');
    try {
      const event = await this.appendEventLocked(args);
      const now = new Date().toISOString();
      this.historyDb.prepare('UPDATE read_cursors SET seq = ?, updated_at = ?').run(event.seq, now);
      this.historyDb.exec('COMMIT');
      return event;
    } catch (err) {
      this.historyDb.exec('ROLLBACK');
      if (err instanceof ActionError) throw err;
      throw new ActionError({
        code: 'event_failed',
        message: `Failed to record the rollback event: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  /**
   * Ascending — the consumption side renders in time order; DESC is getEvents'.
   *
   * `limit` bounds the READ, not just the render (评审 A-9 / 00 §6.1): the inner
   * query takes the NEWEST `limit` rows (DESC) and the outer re-sorts them ASC.
   * Without it the injection's hot path grows with session length (the cursor
   * does not advance on steer/followUp turns, so each turn re-reads a longer
   * span). Callers MUST pass `limit` on the injection path.
   */
  async getEventsSince(
    seq: number,
    opts: { layer?: string; excludeActor?: ActorValue; limit?: number } = {}
  ): Promise<WorldEvent[]> {
    const projectId = await this.projectId();
    const where = ['project_id = ?', 'seq > ?'];
    const params: Array<string | number> = [projectId, seq];
    if (opts.layer !== undefined) {
      where.push('layer = ?');
      params.push(opts.layer);
    }
    if (opts.excludeActor) {
      // NOT (type AND id) — an OR here would also drop every character event.
      where.push(`NOT (actor_type = ? AND COALESCE(actor_id, '') = ?)`);
      params.push(opts.excludeActor.type, opts.excludeActor.id ?? '');
    }
    // node:sqlite hands back `Record<string, SQLOutputValue>`; the row shape is
    // fixed by our own CREATE TABLE, so the unchecked cast is checked by hand.
    if (opts.limit !== undefined) {
      const clipped = this.historyDb
        .prepare(`SELECT * FROM events WHERE ${where.join(' AND ')} ORDER BY seq DESC LIMIT ?`)
        .all(...params, opts.limit) as unknown as EventRow[];
      return clipped.reverse().map((r) => this.rowToEvent(r));
    }
    const rows = this.historyDb
      .prepare(`SELECT * FROM events WHERE ${where.join(' AND ')} ORDER BY seq ASC`)
      .all(...params) as unknown as EventRow[];
    return rows.map((r) => this.rowToEvent(r));
  }

  async getMaxSeq(): Promise<number> {
    const projectId = await this.projectId();
    const row = this.historyDb
      .prepare('SELECT COALESCE(MAX(seq), 0) AS maxSeq FROM events WHERE project_id = ?')
      .get(projectId) as { maxSeq?: number } | undefined;
    return Number(row?.maxSeq ?? 0);
  }

  async readCursor(reader: string): Promise<number> {
    const row = this.historyDb.prepare('SELECT seq FROM read_cursors WHERE reader = ?').get(reader) as
      | { seq?: number }
      | undefined;
    return Number(row?.seq ?? 0); // no row → 0 = "read from genesis"
  }

  /** Bare write: no implicit monotonic clamp (01 §3.4). Pushing backwards is legal. */
  async writeCursor(reader: string, seq: number): Promise<void> {
    try {
      this.historyDb
        .prepare(
          `INSERT INTO read_cursors (reader, seq, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(reader) DO UPDATE SET seq = excluded.seq, updated_at = excluded.updated_at`
        )
        .run(reader, seq, new Date().toISOString());
    } catch (err) {
      throw new ActionError({
        code: 'write_failed',
        message: `Failed to write cursor for '${reader}': ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  async getAllReadCursors(): Promise<Array<{ reader: string; seq: number }>> {
    // node:sqlite yields null-prototype rows; normalize so consumers get plain
    // objects (rollback pushes every cursor to the max seq, doc-21 §6).
    const rows = this.historyDb.prepare('SELECT reader, seq FROM read_cursors').all() as unknown as Array<{
      reader: string;
      seq: number;
    }>;
    return rows.map((r) => ({ reader: String(r.reader), seq: Number(r.seq) }));
  }

  /**
   * Newest-first, history panel only. `seq` ordering keeps same-ms rows stable.
   * `opts.layer` scopes the read through `idx_events_layer` (00 §6.1): the
   * character cold-start window MUST be layer-scoped, never "global N then
   * filter in JS" — a hot other layer would filter down to 0 (评审 A-2).
   */
  async getEvents(limit = 50, opts: { layer?: string } = {}): Promise<WorldEvent[]> {
    const projectId = await this.projectId();
    if (opts.layer !== undefined) {
      const rows = this.historyDb
        .prepare(
          'SELECT * FROM events WHERE project_id = ? AND layer = ? ORDER BY seq DESC LIMIT ?'
        )
        .all(projectId, opts.layer, limit) as unknown as EventRow[];
      return rows.map((r) => this.rowToEvent(r));
    }
    const rows = this.historyDb
      .prepare('SELECT * FROM events WHERE project_id = ? ORDER BY seq DESC LIMIT ?')
      .all(projectId, limit) as unknown as EventRow[];
    return rows.map((r) => this.rowToEvent(r));
  }

  /**
   * Layer id a world path belongs to, or null when it is NOT in the layer tree
   * (`player/**`, `characters/<id>/**`, `world.json`). Mapping a bag path to
   * 'map' would be a lie and would leak bag events into a character's layer
   * window (01 §3.9 / doc-22 §3.2).
   */
  async resolveLayer(relPath: string): Promise<string | null> {
    const normalized = relPath.replace(/^\.\//, '').replace(/\/+$/, '');
    if (normalized !== WORLD_DIR && !normalized.startsWith(`${WORLD_DIR}/`)) {
      // player/**, characters/<id>/**, world.json are not layers. Reporting them
      // as 'map' would leak bag events into a character's layer window.
      return null;
    }
    const layers = await this.scanLayers();
    // A path that IS a layer directory names that layer; anything else belongs
    // to the layer of its containing directory (world/README.md → 'map').
    if (layers[layerOfDir(normalized)]) return layerOfDir(normalized);
    const dir = normalized.slice(0, normalized.lastIndexOf('/'));
    return dir === WORLD_DIR || dir.startsWith(`${WORLD_DIR}/`) ? layerOfDir(dir) : null;
  }

  getLayerCards(paths: string[]): CardRecord[] {
    if (paths.length === 0) return [];
    const placeholders = paths.map(() => '?').join(',');
    const rows = this.queryCanvas(
      `SELECT id, layer, x, y, width, height, z_index, metadata FROM cards WHERE id IN (${placeholders})`,
      paths
    );
    const byId = new Map<string, CardRecord>();
    for (const raw of rows) {
      const row = raw as Record<string, unknown>;
      byId.set(String(row.id), this.toCardRecord(row));
    }
    return [...byId.values()];
  }

  async seatUnplaced(layerId: string, files: SeatFile[]): Promise<CardRecord[]> {
    if (files.length === 0) return [];
    return this.withSeatLock(layerId, async () => {
      this.execCanvas('BEGIN IMMEDIATE');
      try {
        const seated = await this.seatUnplacedLocked(layerId, files);
        this.execCanvas('COMMIT');
        return seated;
      } catch (err) {
        try {
          this.execCanvas('ROLLBACK');
        } catch {
          // SQLite already rolled back; the original error is the useful one.
        }
        throw err;
      }
    });
  }

  /** Seat missing cards while the caller owns the layer lock and SQLite transaction. */
  private async seatUnplacedLocked(layerId: string, files: SeatFile[]): Promise<CardRecord[]> {
    const uniqueFiles = [...new Map(files.map((file) => [file.path, file])).values()];
    const existing = this.getLayerCards(uniqueFiles.map((file) => file.path));
    const existingIds = new Set(existing.map((row) => row.id));
    const missing = uniqueFiles.filter((file) => !existingIds.has(file.path));
    if (missing.length === 0) return [];

    const occupied = this.layoutOccupied(layerId, existing);
    const layout = flowColumns(
      missing.map((file) => {
        const size = seatDimensionsOf(file);
        return { id: file.path, w: size.w, h: size.h, order: file.order };
      }),
      occupied
    );
    if (layout.exhausted) {
      console.warn(
        `[seat] flowColumns exhausted on layer "${layerId}" after ${layout.columnsUsed} columns; inserted deterministic fallback placements`
      );
    }

    const maxZRows = this.queryCanvas(
      'SELECT COALESCE(MAX(z_index), 0) AS maxZ FROM cards WHERE layer = ?',
      [layerId]
    );
    let nextZ = Number((maxZRows[0] as Record<string, unknown> | undefined)?.maxZ ?? 0) + 1;
    for (const placement of layout.placements) {
      const file = missing.find((candidate) => candidate.path === placement.id)!;
      this.execCanvas(
        `INSERT INTO cards (id, layer, x, y, width, height, z_index, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
        [
          file.path,
          layerId,
          placement.x,
          placement.y,
          placement.w,
          placement.h,
          nextZ,
          serializeCardMetadata({ seatW: placement.w, seatH: placement.h }),
        ]
      );
      nextZ++;
    }
    const seated = this.getLayerCards(missing.map((file) => file.path));
    const byId = new Map(seated.map((row) => [row.id, row]));
    return missing
      .map((file) => byId.get(file.path))
      .filter((row): row is CardRecord => row !== undefined);
  }

  /**
   * Re-flow the seated x/y of every card that has legitimately drifted. Five
   * drift sources, short-circuited in this order (contract §5.1; the numbered
   * rows below are this table's, not the contract's):
   *   2. no row            -> first seat, at DECLARED
   *   3. w/h <= 0          -> dirty-row repair, at DECLARED
   *   5. formVersion set AND !== declared -> the kind was resized in code, seat
   *                        at DECLARED and CLEAR measuredAt. Judged BEFORE row 4
   *                        (BLOCKER-C): a measured height was folded at the old
   *                        width, so a resize invalidates it — matching row 4
   *                        first would seat at a stale height and write
   *                        `formVersion: dv`, permanently hiding the resize.
   *   4. measuredAt set AND row.h !== seatH (or row.w !== seatW)
   *                        -> the MEASURED footprint moved, seat at the ROW value
   *   7/8. legacy (no formVersion, no measuredAt): row value === declared ->
   *                        mark only (protects a player's own drags); else seat
   *                        at DECLARED
   *   6/9. steady state / measured-row-without-version -> no-op
   *
   * Source 4 is the ONLY path that makes "the card grew taller -> its seat
   * moves aside" happen at all (`seatUnplaced` only seats rows that do not
   * exist yet, and `writeFootprints` never touches x/y). Source 5 keeps the
   * method's original purpose (a kind resized in code) alive even for measured
   * rows — clearing `measuredAt` there is what stops the declared value source
   * 5 writes from bouncing back through source 4 forever.
   *
   * `files[].w/h` MUST be the DECLARED size of the file's current kind, and
   * `files[].kind` (or a pre-computed `formVersion`) MUST be present: the
   * declared version is derived from them, so a file that carries neither is
   * skipped rather than re-seated at a guessed size.
   */
  async reseatLayer(layerId: string, files: SeatFile[]): Promise<CardRecord[]> {
    if (files.length === 0) return [];
    return this.withSeatLock(layerId, async () => {
      this.execCanvas('BEGIN IMMEDIATE');
      try {
        const uniqueFiles = [...new Map(files.map((file) => [file.path, file])).values()];
        const rows = this.getLayerCards(uniqueFiles.map((file) => file.path));
        const byId = new Map(rows.map((row) => [row.id, row]));

        const seatAt = (
          file: SeatFile,
          d: { w: number; h: number },
          dv: string,
          insert = false
        ) => ({
          path: file.path,
          w: d.w,
          h: d.h,
          insert,
          order: file.order,
          meta: serializeCardMetadata({ formVersion: dv, measuredAt: null, seatW: d.w, seatH: d.h }),
        });
        const seated: Array<{
          path: string;
          w: number;
          h: number;
          insert: boolean;
          order?: number;
          meta: string;
        }> = [];
        const backfill: Array<{ path: string; meta: string }> = [];

        for (const file of uniqueFiles) {
          const declared = declaredOf(file);
          if (!declared) continue;
          const declaredVersion = declaredVersionOf(file, declared);
          if (!declaredVersion) continue;
          const row = byId.get(file.path);
          if (!row) {
            seated.push(seatAt(file, declared, declaredVersion, true));
            continue;
          }
          if (!(row.w > 0) || !(row.h > 0)) {
            seated.push(seatAt(file, declared, declaredVersion));
            continue;
          }
          if (row.formVersion != null && row.formVersion !== declaredVersion) {
            seated.push(seatAt(file, declared, declaredVersion));
            continue;
          }
          const measuredMoved =
            row.measuredAt != null && (row.w !== row.seatW || row.h !== row.seatH);
          if (measuredMoved) {
            seated.push({
              path: file.path,
              w: row.w,
              h: row.h,
              insert: false,
              order: file.order,
              meta: serializeCardMetadata({
                formVersion: declaredVersion,
                measuredAt: row.measuredAt,
                seatW: row.w,
                seatH: row.h,
              }),
            });
            continue;
          }
          if (row.formVersion === declaredVersion) continue;
          if (row.measuredAt != null) continue;
          if (row.w !== declared.w || row.h !== declared.h) {
            seated.push(seatAt(file, declared, declaredVersion));
            continue;
          }
          backfill.push({
            path: file.path,
            meta: serializeCardMetadata({ formVersion: declaredVersion, seatW: row.w, seatH: row.h }),
          });
        }

        if (seated.length === 0 && backfill.length === 0) {
          this.execCanvas('COMMIT');
          return [];
        }

        const moving = new Set(seated.map((item) => item.path));
        const occupied = this.layoutOccupied(layerId, rows, moving);
        const layout = flowColumns(
          seated.map((item) => ({
            id: item.path,
            w: item.w,
            h: item.h,
            order: item.order,
          })),
          occupied
        );
        if (layout.exhausted) {
          console.warn(
            `[seat] flowColumns exhausted while reseating layer "${layerId}" after ${layout.columnsUsed} columns`
          );
        }
        const placements = new Map(layout.placements.map((placement) => [placement.id, placement]));

        const maxZRows = this.queryCanvas(
          'SELECT COALESCE(MAX(z_index), 0) AS maxZ FROM cards WHERE layer = ?',
          [layerId]
        );
        let nextZ = Number((maxZRows[0] as Record<string, unknown> | undefined)?.maxZ ?? 0) + 1;
        for (const item of seated) {
          const placement = placements.get(item.path)!;
          if (item.insert) {
            this.execCanvas(
              `INSERT INTO cards (id, layer, x, y, width, height, z_index, metadata)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO NOTHING`,
              [
                item.path,
                layerId,
                placement.x,
                placement.y,
                placement.w,
                placement.h,
                nextZ,
                item.meta,
              ]
            );
            nextZ++;
          } else {
            this.execCanvas(
              'UPDATE cards SET x = ?, y = ?, width = ?, height = ?, metadata = ? WHERE id = ?',
              [placement.x, placement.y, placement.w, placement.h, item.meta, item.path]
            );
          }
        }
        for (const item of backfill) {
          this.execCanvas('UPDATE cards SET metadata = ? WHERE id = ?', [item.meta, item.path]);
        }
        this.execCanvas('COMMIT');

        const changedIds = [...seated.map((item) => item.path), ...backfill.map((item) => item.path)];
        const changed = new Map(this.getLayerCards(changedIds).map((row) => [row.id, row]));
        return changedIds
          .map((id) => changed.get(id))
          .filter((row): row is CardRecord => row !== undefined);
      } catch (err) {
        try {
          this.execCanvas('ROLLBACK');
        } catch {
          // SQLite already rolled back; the original error is the useful one.
        }
        throw err;
      }
    });
  }

  /**
   * Persist measured footprints for one layer (contract §3.3; 03's only entry
   * point). Writes ONLY `width`/`height` and `metadata.measuredAt`:
   * `formVersion`/`seatW`/`seatH` are read-merge-written back untouched, and
   * x/y/z are never mentioned. That immobility is the point — leaving `seatH`
   * alone is what creates the `h !== seatH` signal `reseatLayer` re-seats on
   * (contract §5.2 / §8 反模式 9); writing it here would silently kill F1.
   *
   * Rows are matched by `id = path` ALONE, never by `layer` (contract §3.3
   * BLOCKER-2): a nested-layer README is shown on the `map` page while its row's
   * `layer` is the nested one. `layerId` therefore only exists for the route's
   * own `resolveLayer` check and for the warning text.
   *
   * Idempotent; unknown path / missing row / bad numbers are skipped with a
   * warning and counted as `unchanged` — the caller returns HTTP 200.
   */
  async writeFootprints(
    layerId: string,
    boxes: Array<{ path: string; w: number; h: number }>
  ): Promise<{ updated: number; unchanged: number }> {
    if (boxes.length === 0) return { updated: 0, unchanged: 0 };
    let updated = 0;
    let unchanged = 0;
    this.execCanvas('BEGIN IMMEDIATE');
    try {
      for (const box of boxes) {
        if (!Number.isFinite(box.w) || !Number.isFinite(box.h) || box.w <= 0 || box.h <= 0) {
          console.warn(
            `[footprint] invalid box for "${box.path}" on layer "${layerId}" (w=${box.w}, h=${box.h}); skipped`
          );
          unchanged += 1;
          continue;
        }
        const existing = this.queryCanvas('SELECT width, height, metadata FROM cards WHERE id = ?', [
          box.path,
        ])[0] as Record<string, unknown> | undefined;
        if (!existing) {
          console.warn(
            `[footprint] no row for "${box.path}" on layer "${layerId}"; skipped`
          );
          unchanged += 1;
          continue;
        }
        if (Number(existing.width) === box.w && Number(existing.height) === box.h) {
          unchanged += 1;
          continue;
        }
        const prior = parseCardMetadata(existing.metadata);
        const meta = serializeCardMetadata({
          formVersion: prior.formVersion,
          measuredAt: new Date().toISOString(),
          seatW: prior.seatW,
          seatH: prior.seatH,
        });
        this.execCanvas('UPDATE cards SET width = ?, height = ?, metadata = ? WHERE id = ?', [
          box.w,
          box.h,
          meta,
          box.path,
        ]);
        updated += 1;
      }
      this.execCanvas('COMMIT');
    } catch (err) {
      try {
        this.execCanvas('ROLLBACK');
      } catch {
        // SQLite already rolled back; the original error is the useful one.
      }
      throw err;
    }
    return { updated, unchanged };
  }

  // === Canvas state layer (doc-09 §4.2) =====================================

  async upsertLink(link: {
    id?: string;
    layer: string;
    from: string;
    to: string;
    style?: LinkRecord['style'];
    color?: LinkRecord['color'];
    directed?: boolean;
    z?: number;
    label?: string | null;
  }): Promise<LinkRecord> {
    const id = link.id ?? linkIdOf(link.layer, link.from, link.to);
    const cols = ['id', 'layer', 'from_id', 'to_id', 'created_at'];
    const vals: Array<string | number | null> = [id, link.layer, link.from, link.to, new Date().toISOString()];
    const updates = ['layer = excluded.layer', 'from_id = excluded.from_id', 'to_id = excluded.to_id'];

    if (link.style !== undefined) {
      cols.push('style');
      vals.push(link.style);
      updates.push('style = excluded.style');
    }
    if (link.color !== undefined) {
      cols.push('color');
      vals.push(link.color);
      updates.push('color = excluded.color');
    }
    if (link.directed !== undefined) {
      cols.push('directed');
      vals.push(link.directed ? 1 : 0);
      updates.push('directed = excluded.directed');
    }
    if (link.z !== undefined) {
      cols.push('z_index');
      vals.push(link.z);
      updates.push('z_index = excluded.z_index');
    }
    if (link.label !== undefined) {
      cols.push('label');
      vals.push(link.label);
      updates.push('label = excluded.label');
    }

    this.execCanvas(
      `INSERT INTO links (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})
       ON CONFLICT(id) DO UPDATE SET ${updates.join(', ')}`,
      vals
    );
    return this.getLayerLinkById(id);
  }

  async deleteLink(id: string): Promise<boolean> {
    const result = this.canvasDb.prepare('DELETE FROM links WHERE id = ?').run(id);
    return Number(result.changes) > 0;
  }
  getCanvasVersion(layerId: string): number {
    const row = this.queryCanvas(
      'SELECT position_version FROM canvas_meta WHERE layer = ?',
      [layerId]
    )[0] as { position_version?: unknown } | undefined;
    if (row) return Number(row.position_version) || 0;
    this.execCanvas(
      'INSERT INTO canvas_meta (layer, position_version) VALUES (?, 0) ON CONFLICT(layer) DO NOTHING',
      [layerId]
    );
    return 0;
  }

  /**
   * The sole safe layout kernel. It locks the layer in SQLite, reads every
   * stored row as an obstacle, plans selected rows deterministically, then
   * inserts seeds/writes coordinates/version in the same transaction.
   */
  async arrangeCanvasLayer(input: ArrangeCanvasLayerInput): Promise<ArrangeCanvasLayerResult> {
    const compat = input as ArrangeCanvasCompatInput;
    const paths = compat.paths ? [...new Set(compat.paths)].sort(compareCanvasPath) : undefined;
    this.execCanvas('BEGIN IMMEDIATE');
    try {
      const lockedSnapshot =
        input.snapshotId.trim() === ''
          ? null
          : await readCanvasSnapshotInTransaction(this, { layer: input.layer });
      if (lockedSnapshot && lockedSnapshot.identity.snapshotId !== input.snapshotId) {
        throw new ActionError({
          code: 'conflict',
          message: `Canvas snapshot conflict on layer "${input.layer}".`,
          details: {
            layer: input.layer,
            expectedSnapshotId: input.snapshotId,
            currentSnapshotId: lockedSnapshot.identity.snapshotId,
            expectedCanvasVersion: input.expectedCanvasVersion,
            currentCanvasVersion: lockedSnapshot.identity.canvasVersion,
            currentCanvasRevision: lockedSnapshot.identity.canvasRevision,
          },
        });
      }
      const currentVersion = lockedSnapshot?.identity.canvasVersion ?? this.getCanvasVersion(input.layer);
      if (currentVersion !== input.expectedCanvasVersion) {
        throw new ActionError({
          code: 'conflict',
          message: `Canvas version conflict on layer "${input.layer}".`,
          details: {
            layer: input.layer,
            expectedCanvasVersion: input.expectedCanvasVersion,
            currentCanvasVersion: currentVersion,
            ...(lockedSnapshot
              ? {
                  expectedSnapshotId: input.snapshotId,
                  currentSnapshotId: lockedSnapshot.identity.snapshotId,
                  currentCanvasRevision: lockedSnapshot.identity.canvasRevision,
                }
              : {}),
          },
        });
      }
      for (const seed of compat.seeds ?? []) {
        if (!Number.isFinite(seed.w) || !Number.isFinite(seed.h) || seed.w <= 0 || seed.h <= 0) {
          throw new ActionError({
            code: 'invalid_argument',
            message: `Invalid declared footprint for "${seed.path}".`,
          });
        }
        this.execCanvas(
          `INSERT INTO cards (id, layer, x, y, width, height, z_index, metadata)
           VALUES (?, ?, ?, ?, ?, ?, COALESCE((SELECT MAX(z_index) + 1 FROM cards WHERE layer = ?), 1), NULL)
           ON CONFLICT(id) DO NOTHING`,
          [
            seed.path,
            input.layer,
            SEAT_ANCHOR.x - seed.w / 2,
            SEAT_ANCHOR.y - seed.h / 2,
            seed.w,
            seed.h,
            input.layer,
          ],
        );
      }
      const allRows = this.queryCanvas(
        'SELECT id, layer, x, y, width, height, z_index, metadata FROM cards WHERE layer = ? ORDER BY id',
        [input.layer],
      ).map((row) => this.toCardRecord(row as Record<string, unknown>));
      const targetIds = paths ?? allRows.map((row) => row.id).sort(compareCanvasPath);
      const byId = new Map(allRows.map((row) => [row.id, row]));
      for (const id of targetIds) {
        if (!byId.has(id)) {
          throw new ActionError({
            code: 'not_found',
            message: `Card "${id}" is not on layer "${input.layer}".`,
          });
        }
      }
      if (allRows.some((row) => !Number.isFinite(row.w) || !Number.isFinite(row.h) || row.w <= 0 || row.h <= 0)) {
        throw new ActionError({
          code: 'invalid_argument',
          message: `Cannot arrange cards with invalid footprints on "${input.layer}".`,
        });
      }
      const targets = targetIds.map((id) => byId.get(id)!);
      const boxes = targets.map((row) => ({ id: row.id, w: row.w, h: row.h }));
      const obstacles = allRows
        .filter((row) => !targetIds.includes(row.id))
        .filter((row) => row.w > 0 && row.h > 0)
        .map((row) => ({ id: row.id, x: row.x, y: row.y, w: row.w, h: row.h }));
      const obstaclePairs: Array<[string, string]> = [];
      for (let i = 0; i < obstacles.length; i++) {
        for (let j = i + 1; j < obstacles.length; j++) {
          if (canvasBoxesOverlap(obstacles[i], obstacles[j])) {
            obstaclePairs.push([obstacles[i].id, obstacles[j].id]);
          }
        }
      }
      if (obstaclePairs.length > 0) {
        throw new ActionError({
          code: 'invalid_argument',
          message: `Cannot arrange around overlapping unselected cards on layer "${input.layer}".`,
          details: { overlaps: obstaclePairs },
        });
      }
      if (boxes.some((box) => !Number.isFinite(box.w) || !Number.isFinite(box.h) || box.w <= 0 || box.h <= 0)) {
        throw new ActionError({
          code: 'invalid_argument',
          message: `Cannot arrange cards with invalid footprints on "${input.layer}".`,
        });
      }
      const requested = canvasModePositions(input.mode, targets);
      let positions = requested;
      if (canvasPositionsOverlap(requested, targets, obstacles)) {
        const flow = flowColumns(
          boxes,
          obstacles,
          { origin: { ...SEAT_ANCHOR }, obstacleGap: SEAT_PAD, gapX: SEAT_STEP, gapY: SEAT_PAD },
        );
        if (flow.exhausted) {
          throw new ActionError({
            code: 'no_free_seat',
            message: `No collision-free layout is available on layer "${input.layer}".`,
          });
        }
        positions = flow.placements.map((placement) => ({
          path: placement.id,
          x: placement.x,
          y: placement.y,
        }));
      }
      if (canvasPositionsOverlap(positions, targets, obstacles)) {
        throw new ActionError({
          code: 'invalid_argument',
          message: `Cannot commit layout: selected card overlaps an unselected obstacle.`,
          details: { overlaps: canvasOverlapPairs(positions, targets, obstacles) },
        });
      }
      let movedCount = 0;
      for (const position of positions) {
        const row = byId.get(position.path)!;
        if (row.x !== position.x || row.y !== position.y) movedCount++;
        this.execCanvas('UPDATE cards SET x = ?, y = ? WHERE id = ?', [
          position.x,
          position.y,
          position.path,
        ]);
      }
      let version = currentVersion;
      if (movedCount > 0 || (compat.seeds?.length ?? 0) > 0) {
        version = currentVersion + 1;
        this.execCanvas('UPDATE canvas_meta SET position_version = ? WHERE layer = ?', [
          version,
          input.layer,
        ]);
      }
      this.execCanvas('COMMIT');
      const resultRows = this.getLayerCards(targetIds);
      const afterSnapshot =
        input.snapshotId.trim() === '' ? null : await readCanvasSnapshot(this, { layer: input.layer });
      return {
        kind: 'cards',
        action: 'arrangeCanvasLayer',
        operationId: input.operationId,
        layer: input.layer,
        mode: input.mode,
        canvasVersion: afterSnapshot?.identity.canvasVersion ?? version,
        canvasRevision: afterSnapshot?.identity.canvasRevision ?? '',
        snapshotIdBefore: input.snapshotId,
        snapshotIdAfter: afterSnapshot?.identity.snapshotId ?? '',
        cards: resultRows.map((row) => ({
          path: row.id,
          x: row.x,
          y: row.y,
          z: row.z,
          w: row.w,
          h: row.h,
        })),
        movedCount,
        overlapCount: afterSnapshot?.overlaps.length ?? 0,
        committed: true,
      };
    } catch (err) {
      try {
        this.execCanvas('ROLLBACK');
      } catch {
        // Preserve the original error.
      }
      throw err;
    }
  }

  async applyCanvasPositions(
    layerId: string,
    rows: readonly CanvasPositionInput[],
    expectedCanvasVersion?: number,
  ): Promise<CanvasCommit> {
    if (rows.length === 0) {
      return { layer: layerId, cards: [], canvasVersion: this.getCanvasVersion(layerId) };
    }
    this.execCanvas('BEGIN IMMEDIATE');
    try {
      const currentVersion = this.getCanvasVersion(layerId);
      if (expectedCanvasVersion !== undefined && currentVersion !== expectedCanvasVersion) {
        throw new ActionError({
          code: 'conflict',
          message: `Canvas version conflict on layer "${layerId}".`,
          details: { layer: layerId, expectedCanvasVersion, currentCanvasVersion: currentVersion },
        });
      }
      const all = this.queryCanvas(
        'SELECT id, layer, x, y, width, height, z_index, metadata FROM cards WHERE layer = ?',
        [layerId]
      ).map((row) => this.toCardRecord(row as Record<string, unknown>));
      const byId = new Map(all.map((row) => [row.id, row]));
      const next = new Map(all.map((row) => [row.id, { x: row.x, y: row.y, w: row.w, h: row.h }]));
      for (const row of rows) {
        const existing = byId.get(row.path);
        if (!existing) throw new ActionError({ code: 'not_found', message: `Card "${row.path}" is not on layer "${layerId}".` });
        const x = row.x ?? existing.x;
        const y = row.y ?? existing.y;
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          throw new ActionError({ code: 'invalid_argument', message: `Coordinates for "${row.path}" must be finite.` });
        }
        next.set(row.path, { x, y, w: existing.w, h: existing.h });
      }
      const pairs: Array<[string, string]> = [];
      const ids = [...next.keys()].sort(compareCanvasPath);
      for (let i = 0; i < ids.length; i++) {
        const a = next.get(ids[i])!;
        if (a.w <= 0 || a.h <= 0) continue;
        for (let j = i + 1; j < ids.length; j++) {
          const b = next.get(ids[j])!;
          if (b.w <= 0 || b.h <= 0) continue;
          if (canvasBoxesOverlap(a, b)) pairs.push([ids[i], ids[j]]);
        }
      }
      if (pairs.length > 0) {
        throw new ActionError({
          code: 'invalid_argument',
          message: `Cannot commit positions with overlapping cards.`,
          details: { overlaps: pairs },
        });
      }
      let changed = false;
      for (const row of rows) {
        const existing = byId.get(row.path)!;
        const value = next.get(row.path)!;
        if (existing.x !== value.x || existing.y !== value.y || (row.z !== undefined && existing.z !== row.z)) changed = true;
        if (row.z === undefined) {
          this.execCanvas('UPDATE cards SET x = ?, y = ? WHERE id = ?', [value.x, value.y, row.path]);
        } else {
          this.execCanvas('UPDATE cards SET x = ?, y = ?, z_index = ? WHERE id = ?', [value.x, value.y, row.z, row.path]);
        }
      }
      const version = changed ? currentVersion + 1 : currentVersion;
      if (changed) this.execCanvas('UPDATE canvas_meta SET position_version = ? WHERE layer = ?', [version, layerId]);
      this.execCanvas('COMMIT');
      return { layer: layerId, cards: rows.map((row) => this.cardById(row.path)), canvasVersion: version };
    } catch (err) {
      try {
        this.execCanvas('ROLLBACK');
      } catch {
        // Preserve the original error.
      }
      throw err;
    }
  }


  async placeCard(
    layer: string,
    path: string,
    box: { x?: number; y?: number; z?: number }
  ): Promise<CardRecord> {
    this.execCanvas('BEGIN IMMEDIATE');
    try {
      const before = this.getCanvasVersion(layer);
      this.applyPlaceCard(layer, path, box);
      const after = before + 1;
      this.execCanvas('UPDATE canvas_meta SET position_version = ? WHERE layer = ?', [after, layer]);
      this.execCanvas('COMMIT');
      return this.cardById(path);
    } catch (err) {
      try {
        this.execCanvas('ROLLBACK');
      } catch {
        // Preserve the original error.
      }
      throw err;
    }
  }

  async placeCards(
    rows: Array<{ layer: string; path: string; x: number; y: number; z?: number }>
  ): Promise<CardRecord[]> {
    if (rows.length === 0) return [];
    this.execCanvas('BEGIN IMMEDIATE');
    try {
      const layers = [...new Set(rows.map((row) => row.layer))];
      const before = new Map(layers.map((layer) => [layer, this.getCanvasVersion(layer)]));
      for (const row of rows) this.applyPlaceCard(row.layer, row.path, row);
      for (const layer of layers) {
        this.execCanvas(
          'UPDATE canvas_meta SET position_version = ? WHERE layer = ?',
          [before.get(layer)! + 1, layer]
        );
      }
      this.execCanvas('COMMIT');
    } catch (err) {
      try {
        this.execCanvas('ROLLBACK');
      } catch {
        // Already rolled back by SQLite; the original error is what matters.
      }
      throw err;
    }
    return rows.map((row) => this.cardById(row.path));
  }

  async getLayerLinks(layer?: string): Promise<LinkRecord[]> {
    const cols = 'id, layer, from_id, to_id, style, color, directed, z_index, label';
    const rows =
      layer === undefined
        ? this.queryCanvas(`SELECT ${cols} FROM links ORDER BY z_index, id`)
        : this.queryCanvas(`SELECT ${cols} FROM links WHERE layer = ? ORDER BY z_index, id`, [layer]);
    return rows.map((raw) => this.rowToLink(raw as Record<string, unknown>));
  }

  /** Single UPSERT statement, column-narrow: w/h are never written (doc-09 §11 冲突 1). */
  private applyPlaceCard(
    layer: string,
    path: string,
    box: { x?: number; y?: number; z?: number }
  ): void {
    const cols = ['id', 'layer'];
    const vals: Array<string | number> = [path, layer];
    const updates = ['layer = excluded.layer'];
    if (box.x !== undefined) {
      cols.push('x');
      vals.push(box.x);
      updates.push('x = excluded.x');
    }
    if (box.y !== undefined) {
      cols.push('y');
      vals.push(box.y);
      updates.push('y = excluded.y');
    }
    if (box.z !== undefined) {
      cols.push('z_index');
      vals.push(box.z);
      updates.push('z_index = excluded.z_index');
    }
    this.execCanvas(
      `INSERT INTO cards (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})
       ON CONFLICT(id) DO UPDATE SET ${updates.join(', ')}`,
      vals
    );
  }

  private cardById(path: string): CardRecord {
    const rows = this.queryCanvas(
      'SELECT id, layer, x, y, width, height, z_index, metadata FROM cards WHERE id = ?',
      [path]
    );
    return this.toCardRecord(rows[0] as Record<string, unknown>);
  }

  private getLayerLinkById(id: string): LinkRecord {
    const rows = this.queryCanvas(
      'SELECT id, layer, from_id, to_id, style, color, directed, z_index, label FROM links WHERE id = ?',
      [id]
    );
    return this.rowToLink(rows[0] as Record<string, unknown>);
  }

  /** One row → link mapping, so every read path shares the snake→camel rules. */
  private rowToLink(row: Record<string, unknown>): LinkRecord {
    return {
      id: String(row.id),
      layer: String(row.layer),
      from: String(row.from_id),
      to: String(row.to_id),
      style: String(row.style) as LinkRecord['style'],
      color: row.color == null ? null : (String(row.color) as NonNullable<LinkRecord['color']>),
      directed: Number(row.directed) === 1,
      z: Number(row.z_index),
      label: row.label == null ? null : String(row.label),
    };
  }

  async saveCardPosition(id: string, x: number, y: number): Promise<CardRecord> {
    // Keeps the historical behavior: `deriveLayer` (layerOfPath fallback to
    // 'map') still fronts the player drag route, which only ever passes cards
    // shown on a layer page (doc-09 §2.5).
    const layer = await this.deriveLayer(id);
    return this.placeCard(layer, id, { x, y });
  }

  /**
   * Migrate a card (and every line touching it) after a file move (04 §3.8.2).
   * The old version relayered by `deriveLayer` — which falls back to 'map' — so
   * a bag object was silently dragged onto the world map, and it swallowed link
   * failures. Now the canvas boundary is judged by `resolveLayer`: leaving the
   * layer tree drops the card; staying migrates `id` + `layer`, and each line
   * follows its endpoints (a line keeps the layer of whichever end stays).
   */
  async renameCardPosition(from: string, to: string): Promise<void> {
    const toLayer = await this.resolveLayer(to);

    try {
      this.execCanvas('BEGIN IMMEDIATE');
      if (toLayer === null) {
        // Out of the layer tree (player/, characters/, outside the world):
        // the card leaves the canvas. A line whose endpoint goes dangling is
        // KEPT (09 §4.4) — it revives when the file comes back.
        this.execCanvas('DELETE FROM cards WHERE id = ?', [from]);
      } else {
        this.execCanvas('UPDATE cards SET id = ?, layer = ? WHERE id = ?', [to, toLayer, from]);
        // One row per endpoint: the line's layer follows the end that STAYS in
        // a layer; when both ends are in layers they are in the same one by
        // construction (a move crosses exactly one boundary).
        this.execCanvas('UPDATE links SET from_id = ?, layer = ? WHERE from_id = ?', [to, toLayer, from]);
        this.execCanvas('UPDATE links SET to_id = ?, layer = ? WHERE to_id = ?', [to, toLayer, from]);
      }
      this.execCanvas('COMMIT');
    } catch (err) {
      try {
        this.execCanvas('ROLLBACK');
      } catch {
        // SQLite already rolled back; the original error is the useful one.
      }
      throw new ActionError({
        code: 'internal',
        message: `Entity moved to "${to}" but its canvas card could not be migrated: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  /**
   * Remove a card and every line that touches it (09 §4.4). Used when an entity
   * is deleted (04 §3.2 step 4) and when a card leaves the canvas boundary.
   * Returns how many cards / links were dropped, for the caller to report.
   */
  dropCard(path: string): { cards: number; links: number } {
    try {
      this.execCanvas('BEGIN IMMEDIATE');
      const cards = this.runCanvas('DELETE FROM cards WHERE id = ?', [path]);
      const links = this.runCanvas('DELETE FROM links WHERE from_id = ? OR to_id = ?', [path, path]);
      this.execCanvas('COMMIT');
      return { cards, links };
    } catch (err) {
      try {
        this.execCanvas('ROLLBACK');
      } catch {
        // Already rolled back.
      }
      throw new ActionError({
        code: 'internal',
        message: `Failed to drop the canvas card for "${path}": ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  /** How many rows a write actually touched — `BEGIN`/`COMMIT` friendly. */
  private runCanvas(sql: string, params: Array<string | number | null> = []): number {
    return Number(this.canvasDb.prepare(sql).run(...params).changes);
  }

  /**
   * Seat one new card NEXT TO an existing card (04 §3.9.3). Same spiral as
   * `seatUnplaced`, but the origin is the anchor card's centre and the anchor's
   * own cell is skipped — so the neighbour lands at ring 1, never on top of it.
   * Already-seated cards are never re-flowed (doc-06 §2.5). The extra
   * `exhausted` flag is how the caller surfaces "placed, but overlapping"
   * instead of silently pretending the seat is clean.
   */
  async seatNear(
    layerId: string,
    file: SeatFile,
    anchorPath: string
  ): Promise<CardRecord & { exhausted: boolean }> {
    return this.withSeatLock(layerId, async () => {
      try {
        this.execCanvas('BEGIN IMMEDIATE');
        const seated = await this.seatNearLocked(layerId, file, anchorPath);
        this.execCanvas('COMMIT');
        return seated;
      } catch (err) {
        try {
          this.execCanvas('ROLLBACK');
        } catch {
          // SQLite already rolled back; the original error is the useful one.
        }
        throw err;
      }
    });
  }

  /** Seat beside an anchor while the caller owns the layer lock and transaction. */
  private async seatNearLocked(
    layerId: string,
    file: SeatFile,
    anchorPath: string
  ): Promise<CardRecord & { exhausted: boolean }> {
    // The anchor card is seated first when it has no row; one shared helper so
    // `seatNear` and `seatPresence` can never diverge (04 §3.9.3 / 05 §11 冲突 5).
    const { cx: aCx, cy: aCy } = await this.anchorOfLocked(layerId, anchorPath);
    const anchor = this.getLayerCards([anchorPath])[0];

    const { w, h } = seatDimensionsOf(file);
    const occupied = this.layoutOccupied(layerId, [anchor]).map((row) => ({
      cx: row.x + row.w / 2,
      cy: row.y + row.h / 2,
      w: row.w,
      h: row.h,
    }));

    const maxZRows = this.queryCanvas(
      'SELECT COALESCE(MAX(z_index), 0) AS maxZ FROM cards WHERE layer = ?',
      [layerId]
    );
    const nextZ = Number((maxZRows[0] as Record<string, unknown> | undefined)?.maxZ ?? 0) + 1;

    // Fallback: one card-width to the anchor's left (never the anchor's own
    // centre — overlapping the anchor is the one outcome the spiral avoids).
    let placedX = anchor.x - w;
    let placedY = anchor.y;
    let found = false;
    let tries = 0;
    for (const [gx, gy] of spiralCells()) {
      if (tries++ >= SEAT_MAX_CANDIDATES) break;
      if (gx === 0 && gy === 0) continue; // the anchor's own cell is taken
      const cx = aCx + gx * SEAT_STEP;
      const cy = aCy + gy * SEAT_STEP;
      placedX = cx - w / 2;
      placedY = cy - h / 2;
      if (!overlapsOccupied(occupied, cx, cy, w, h)) {
        found = true;
        break;
      }
    }
    if (!found) {
      console.warn(
        `[seatNear] no free cell within ${SEAT_MAX_CANDIDATES} candidates for "${file.path}"; placing at last candidate`
      );
    }

    // Seat baseline + version marker, merged over whatever the row already
    // carried: `measuredAt` (a frontend measurement) survives, while the seat
    // baseline moves to the box we are about to write (contract §3.3).
    const priorMeta = parseCardMetadata(
      (this.queryCanvas('SELECT metadata FROM cards WHERE id = ?', [file.path])[0] as
        | Record<string, unknown>
        | undefined)?.metadata
    );
    const declared = declaredOf(file);
    const dv = declared ? declaredVersionOf(file, declared) : null;
    const meta = serializeCardMetadata({
      formVersion: dv ?? priorMeta.formVersion,
      measuredAt: priorMeta.measuredAt,
      seatW: w,
      seatH: h,
    });
    this.execCanvas(
      `INSERT INTO cards (id, layer, x, y, width, height, z_index, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET layer = excluded.layer, x = excluded.x,
         y = excluded.y, width = excluded.width, height = excluded.height,
         metadata = excluded.metadata`,
      [file.path, layerId, placedX, placedY, w, h, nextZ, meta]
    );
    return {
      id: file.path,
      layer: layerId,
      x: placedX,
      y: placedY,
      w,
      h,
      z: nextZ,
      exhausted: !found,
    };
  }

  /** Every card path seated on a layer (for the seatNear occupancy set). */
  cardsInLayer(layerId: string): string[] {
    return this.queryCanvas('SELECT id FROM cards WHERE layer = ?', [layerId]).map((r) =>
      String((r as Record<string, unknown>).id)
    );
  }

  /**
   * The card centre for an anchor path, seating it first when it has no row
   * (05 §7.3 / 04 §3.9.3). Without the pre-seat, a `near` anchor that was never
   * flushed by `/api/layer` would hand `undefined` to the spiral and produce
   * `NaN` coordinates. `anchorOf` and `anchorOfLocked` are the shared helpers
   * used by `seatPresence` and `seatNear`.
   */
  private async anchorOf(layerId: string, anchorPath: string): Promise<{ cx: number; cy: number }> {
    let anchor = this.getLayerCards([anchorPath])[0];
    if (!anchor) {
      const raw = await this.readFile(anchorPath);
      const parsed = parseFrontmatter(raw);
      const kind = cardKindOf(parsed.frontmatter, path.basename(anchorPath));
      const form = cardFormOf(parsed.frontmatter, path.basename(anchorPath));
      await this.seatUnplaced(layerId, [{ path: anchorPath, kind, w: form.w, h: form.h }]);
      anchor = this.getLayerCards([anchorPath])[0];
    }
    if (!anchor) {
      throw new ActionError({
        code: 'internal',
        message: `Could not seat the anchor card "${anchorPath}" before seating beside it`,
      });
    }
    return { cx: anchor.x + anchor.w / 2, cy: anchor.y + anchor.h / 2 };
  }

  /** Resolve an anchor while the caller owns the layer lock and SQLite transaction. */
  private async anchorOfLocked(
    layerId: string,
    anchorPath: string
  ): Promise<{ cx: number; cy: number }> {
    let anchor = this.getLayerCards([anchorPath])[0];
    if (!anchor) {
      const raw = await this.readFile(anchorPath);
      const parsed = parseFrontmatter(raw);
      const kind = cardKindOf(parsed.frontmatter, path.basename(anchorPath));
      const form = cardFormOf(parsed.frontmatter, path.basename(anchorPath));
      await this.seatUnplacedLocked(layerId, [{ path: anchorPath, kind, w: form.w, h: form.h }]);
      anchor = this.getLayerCards([anchorPath])[0];
    }
    if (!anchor) {
      throw new ActionError({
        code: 'internal',
        message: `Could not seat the anchor card "${anchorPath}" before seating beside it`,
      });
    }
    return { cx: anchor.x + anchor.w / 2, cy: anchor.y + anchor.h / 2 };
  }

  /**
   * Seat a character presence (05 §3.9.3). The third seating method, beside
   * `seatUnplaced` / `seatNear`, and deliberately in THIS module so it can use
   * the private `SEAT_MAX_CANDIDATES` / `spiralCells` / `overlapsOccupied` —
   * the seat grid and the card grid are the same sheet of paper.
   *
   * Two things make presence seating its own algorithm:
   *  - the occupancy set is cards UNION the layer's other presences (so Watson
   *    never stands on the counter card, nor inside the Constable);
   *  - the anchor is either a card centre (`near`) or the global SEAT_ANCHOR.
   *
   * The returned `x`/`y` are the presence CENTRE, not a top-left corner: the
   * front end paints `PresenceEntry{x,y}` as a circle centre, while `cards`
   * stores top-left. Mixing the two would offset every avatar by half a body.
   */
  async seatPresence(
    layerId: string,
    opts: { near?: string; excludeCharacter?: string } = {}
  ): Promise<SeatPresenceResult> {
    const { w, h } = CARD_FORMS.sprite;
    const manifest = await this.getManifest();
    const legacyCharacterCards = new Set(
      manifest.characters.map((character) => `${character.home}/${character.id}.md`),
    );
    const cards = (
      this.queryCanvas('SELECT id, x, y, width, height FROM cards WHERE layer = ?', [
        layerId,
      ]) as Array<Record<string, unknown>>
    ).filter((r) => !legacyCharacterCards.has(String(r.id))).map((r) => ({
      cx: Number(r.x) + Number(r.width) / 2,
      cy: Number(r.y) + Number(r.height) / 2,
      w: Number(r.width),
      h: Number(r.height),
    }));
    const pres = (
      this.queryCanvas(
        `SELECT x, y FROM presence WHERE layer = ?${opts.excludeCharacter ? ' AND character_id != ?' : ''}`,
        opts.excludeCharacter ? [layerId, opts.excludeCharacter] : [layerId]
      ) as Array<Record<string, unknown>>
    ).map((r) => ({ cx: Number(r.x), cy: Number(r.y), w, h }));

    const anchor = opts.near
      ? await this.anchorOf(layerId, opts.near)
      : { cx: SEAT_ANCHOR.x, cy: SEAT_ANCHOR.y };
    const occupied = [...cards, ...pres];

    let tries = 0;
    // Fallback is the LAST walked cell, never the anchor: the anchor's cell
    // belongs to the anchor card (05 §3.9.3, same rule as seatUnplaced).
    let last = { x: anchor.cx, y: anchor.cy };
    for (const [gx, gy] of spiralCells()) {
      // Cell 0 is the anchor itself — always taken. `tries` counts every cell
      // visited (cell 0 included), matching `seatUnplaced` / `seatNear`.
      tries++;
      if (tries === 1) continue;
      if (tries > SEAT_MAX_CANDIDATES) break;
      const cx = anchor.cx + gx * SEAT_STEP;
      const cy = anchor.cy + gy * SEAT_STEP;
      last = { x: cx, y: cy };
      if (!overlapsOccupied(occupied, cx, cy, w, h)) {
        return { x: cx, y: cy, seat: { gx, gy, tries, exhausted: false } };
      }
    }
    console.warn(
      `[seatPresence] no free presence cell within ${SEAT_MAX_CANDIDATES} candidates in "${layerId}"; placing at last candidate`
    );
    return { x: last.x, y: last.y, seat: { gx: 0, gy: 0, tries, exhausted: true } };
  }

  /**
   * One UPSERT keyed by `character_id` (05 §3.4). `following` omitted KEEPS the
   * row's current value — that is what lets `move_to` relocate a follower
   * without quietly un-teaming them. Single statement, therefore atomic; the
   * action layer adds no lock (后写者赢, 01 §7.3).
   */
  async upsertPresence(p: {
    characterId: string;
    layer: string;
    x: number;
    y: number;
    following?: boolean;
  }): Promise<PresenceRecord> {
    const now = new Date().toISOString();
    const keepFollowing = p.following === undefined;
    if (keepFollowing) {
      this.execCanvas(
        `INSERT INTO presence (id, character_id, layer, x, y, following, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, ?)
         ON CONFLICT(character_id) DO UPDATE SET layer = excluded.layer, x = excluded.x,
           y = excluded.y, updated_at = excluded.updated_at`,
        [`presence:${p.characterId}`, p.characterId, p.layer, p.x, p.y, now]
      );
    } else {
      this.execCanvas(
        `INSERT INTO presence (id, character_id, layer, x, y, following, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(character_id) DO UPDATE SET layer = excluded.layer, x = excluded.x,
           y = excluded.y, following = excluded.following, updated_at = excluded.updated_at`,
        [`presence:${p.characterId}`, p.characterId, p.layer, p.x, p.y, p.following ? 1 : 0, now]
      );
    }
    return (await this.getPresenceOf(p.characterId))!;
  }

  /** Presence rows, whole world or one layer, stable order (05 §3.6.2). */
  getPresence(layer?: string): PresenceRecord[] {
    const rows = (
      layer === undefined
        ? this.queryCanvas('SELECT * FROM presence ORDER BY character_id')
        : this.queryCanvas('SELECT * FROM presence WHERE layer = ? ORDER BY character_id', [layer])
    ) as Array<Record<string, unknown>>;
    return rows.map((r) => this.rowToPresence(r));
  }

  /** One character's row, or null when they have never been placed (05 §3.6.1). */
  getPresenceOf(characterId: string): PresenceRecord | null {
    const rows = this.queryCanvas('SELECT * FROM presence WHERE character_id = ?', [
      characterId,
    ]) as Array<Record<string, unknown>>;
    return rows.length > 0 ? this.rowToPresence(rows[0]) : null;
  }
  /**
   * Compensating cleanup for a failed initial-presence action. Normal movement
   * never uses this path; callers must only pass a character that had no row
   * before their initialization batch.
   */
  async deletePresence(characterId: string): Promise<boolean> {
    const before = this.getPresenceOf(characterId) !== null;
    if (!before) return false;
    this.execCanvas('DELETE FROM presence WHERE character_id = ?', [characterId]);
    return true;
  }

  private rowToPresence(row: Record<string, unknown>): PresenceRecord {
    return {
      characterId: String(row.character_id),
      layer: String(row.layer),
      x: Number(row.x),
      y: Number(row.y),
      following: Number(row.following) === 1,
      updatedAt: String(row.updated_at),
    };
  }

  /**
   * The singleton viewpoint row (00 §5.1 / 05 §2.3). The table only exists once
   * `initCanvasDatabase` has run, and a world that never saw a browser has no
   * row — both are ordinary, so the probe swallows its failure (same judgement
   * as `readPresence`: an empty answer beats a throw).
   *
   * TTL is applied HERE and never written back: expiry means "the player is
   * gone", a fact about the clock, not a state change worth persisting.
   */
  readViewpoint(now: number = Date.now()): ViewpointRecord | null {
    let row: Record<string, unknown> | undefined;
    try {
      row = this.queryCanvas('SELECT layer, focus, selected, bag_count, at FROM viewpoint LIMIT 1')[0];
    } catch {
      return null; // no table (any world that predates B2)
    }
    if (!row) return null;
    const at = String(row.at ?? '');
    const atMs = Date.parse(at);
    if (!Number.isFinite(atMs) || now - atMs > VIEWPOINT_TTL_MS) return null; // stale → absent
    return {
      layer: typeof row.layer === 'string' ? row.layer : '',
      focus: decodeCentre(typeof row.focus === 'string' ? row.focus : ''),
      selected: parseSelected(row.selected),
      bagCount: Number(row.bag_count ?? 0) || 0,
      at,
    };
  }

  /**
   * Overwrite the singleton viewpoint row (05 §2.5). The server owns `at`.
   * `focus` is the view CENTRE in world coords — the `focus` COLUMN keeps that
   * wire-encoded form for symmetry, and the explicit x/y columns keep it
   * queryable by SQL.
   */
  writeViewpoint(v: {
    layer: string;
    focus: { x: number; y: number; w: number; h: number } | null;
    selected: string[];
    bagCount: number;
  }): string {
    const at = new Date().toISOString();
    this.execCanvas(
      `INSERT INTO viewpoint (id, layer, focus, focus_x, focus_y, focus_w, focus_h, selected, bag_count, at)
       VALUES ('singleton', ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         layer = excluded.layer, focus = excluded.focus,
         focus_x = excluded.focus_x, focus_y = excluded.focus_y,
         focus_w = excluded.focus_w, focus_h = excluded.focus_h,
         selected = excluded.selected, bag_count = excluded.bag_count, at = excluded.at`,
      [
        v.layer,
        encodeCentre(v.focus),
        // The mirror columns are NOT NULL INTEGER (00 §5.1): 0 when unknown, and
        // rounded so they match `focus`'s 'x:y' exactly (same value, two forms).
        v.focus ? Math.round(v.focus.x) : 0,
        v.focus ? Math.round(v.focus.y) : 0,
        v.focus ? Math.round(v.focus.w) : 0,
        v.focus ? Math.round(v.focus.h) : 0,
        JSON.stringify(v.selected),
        v.bagCount,
        at,
      ]
    );
    return at;
  }

  /**
   * Newest-first files by mtime under `prefix`, capped at `limit` (02 §3.1).
   * The ONLY mtime read in the store: it powers `recent_chalk`'s cross-layer
   * "what was written lately". `statKind`-style missing paths are skipped, and
   * directories are ignored (only files count as writing).
   */
  async filesByMtime(prefix: string, limit: number): Promise<string[]> {
    const all = await this.listFiles(prefix);
    const withTime = await Promise.all(
      all.map(async (rel) => {
        try {
          const st = await fs.stat(this.resolvePath(rel));
          return { rel, mtime: st.mtimeMs };
        } catch {
          return null;
        }
      })
    );
    return withTime
      .filter((x): x is { rel: string; mtime: number } => x !== null)
      // Newest first; path breaks ties deterministically (mtime granularity).
      .sort((a, b) => (b.mtime - a.mtime) || (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
      .slice(0, limit)
      .map((x) => x.rel);
  }
  /**
   * A layer's page as `{ cards, doorIds }`: markdown directly in its directory,
   * plus one door id per immediate child layer (README or stub). The route
   * turns each door id into a door card. Never reaches into a child's contents.
   */
  async pageOfLayer(layerId: string): Promise<{ cards: string[]; doorIds: string[] }> {
    const [allFiles, layers] = await Promise.all([this.listFiles(), this.scanLayers()]);
    return {
      cards: cardsOfLayer(layerId, allFiles),
      doorIds: childLayers(layerId, layers),
    };
  }

  /**
   * `manifest.id` cached per process. Reading it calls `getManifest`, which
   * reads world.json AND re-scans every layer dir — far too expensive to run
   * once per appended event (01 §3.2).
   */
  private async projectId(): Promise<string> {
    if (this.projectIdCache === null) {
      this.projectIdCache = (await this.getManifest()).id;
    }
    return this.projectIdCache;
  }

  /** One row → event mapping, so every read path shares the snake→camel rules. */
  private rowToEvent(row: EventRow): WorldEvent {
    return {
      seq: Number(row.seq),
      id: String(row.id),
      projectId: String(row.project_id),
      type: row.type as WorldEvent['type'],
      actor: { type: row.actor_type as ActorValue['type'], ...(row.actor_id ? { id: row.actor_id } : {}) },
      layer: row.layer ?? null,
      subject: row.subject ?? null,
      turn: row.turn ?? null,
      detail: JSON.parse(row.detail) as Record<string, unknown>,
      createdAt: String(row.created_at),
    };
  }

  /** Layer of a card path: longest derived layer id that fronts it, else 'map'. */
  private async deriveLayer(id: string): Promise<string> {
    return layerOfPath(id, await this.scanLayers());
  }

  private toCardRecord(row: Record<string, unknown>): CardRecord {
    // The four `metadata` keys travel with every row: `reseatLayer` needs them
    // to tell "a measurement moved" from "a kind was resized in code".
    return {
      id: String(row.id),
      layer: String(row.layer),
      x: Number(row.x),
      y: Number(row.y),
      w: Number(row.width),
      h: Number(row.height),
      z: Number(row.z_index),
      ...parseCardMetadata(row.metadata),
    };
  }

  close(): void {
    this.canvasDb.close();
    this.historyDb.close();
  }
}

/** Raw `events` row as SQLite hands it over (snake_case, JSON detail). */
interface EventRow {
  seq: number;
  id: string;
  project_id: string;
  type: string;
  actor_type: string;
  actor_id: string | null;
  layer: string | null;
  subject: string | null;
  turn: string | null;
  detail: string;
  created_at: string;
}

function overlapsOccupied(
  occupied: Array<{ cx: number; cy: number; w: number; h: number }>,
  cx: number,
  cy: number,
  w: number,
  h: number
): boolean {
  for (const o of occupied) {
    const ox = (w + o.w) / 2 + SEAT_PAD - Math.abs(cx - o.cx);
    const oy = (h + o.h) / 2 + SEAT_PAD - Math.abs(cy - o.cy);
    if (ox > 0 && oy > 0) return true;
  }
  return false;
}

// === Card footprint metadata (contract §5.2) ==============================
//
// `cards.metadata` holds EXACTLY these four keys — it is not a free JSON bin:
//   formVersion  declared-version marker (kind was resized in code?)
//   measuredAt   non-null => this row's w/h came from a frontend measurement
//   seatW/seatH  the w/h actually used at this row's LAST seat
// The `seatH` comparison is what makes "card grew taller -> its seat moves
// aside" possible at all (contract §5.1 第 3 条): `writeFootprints` only moves
// width/height, so `h !== seatH` is the surviving drift signal.
type CardMetadata = {
  formVersion: string | null;
  measuredAt: string | null;
  seatW: number | null;
  seatH: number | null;
};

/**
 * Damaged/legacy JSON degrades to all-null (i.e. a legacy row, §3.1 表第 7/8
 * 行) — one bad row MUST NOT blow up an entire `/api/layer`.
 */
function parseCardMetadata(raw: unknown): CardMetadata {
  const empty: CardMetadata = { formVersion: null, measuredAt: null, seatW: null, seatH: null };
  if (typeof raw !== 'string' || raw === '') return empty;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return empty;
  }
  if (!parsed || typeof parsed !== 'object') return empty;
  const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
  // Only a finite number survives; `null`/`undefined`/`''`/garbage become null
  // so "missing seatH" stays distinguishable from the number 0.
  const num = (v: unknown): number | null => {
    if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    formVersion: str(parsed.formVersion),
    measuredAt: str(parsed.measuredAt),
    seatW: num(parsed.seatW),
    seatH: num(parsed.seatH),
  };
}

/** Inverse of `parseCardMetadata`; the four keys are always written together. */
function serializeCardMetadata(meta: Partial<CardMetadata>): string {
  const out: Record<string, string | number> = {};
  if (meta.formVersion != null) out.formVersion = meta.formVersion;
  if (meta.measuredAt != null) out.measuredAt = meta.measuredAt;
  if (meta.seatW != null) out.seatW = meta.seatW;
  if (meta.seatH != null) out.seatH = meta.seatH;
  return JSON.stringify(out);
}
function seatDimensionsOf(file: SeatFile): { w: number; h: number } {
  return {
    // Legacy callers may provide path-only SeatFiles; preserve the canvas
    // schema's first-paint fallback while canonical /layer supplies declared sizes.
    w: typeof file.w === 'number' && Number.isFinite(file.w) && file.w > 0 ? file.w : 280,
    h: typeof file.h === 'number' && Number.isFinite(file.h) && file.h > 0 ? file.h : 180,
  };
}
/**
 * DECLARED footprint carried by a SeatFile, or null when untrustworthy. Doubles
 * as the narrowing guard for `SeatFile`'s optional w/h, so call sites get
 * `{ w: number; h: number }` rather than two possibly-undefined numbers.
 */
function declaredOf(f: SeatFile): { w: number; h: number } | null {
  return f.w && f.w > 0 && f.h && f.h > 0 ? { w: f.w, h: f.h } : null;
}

/**
 * The DECLARED version for a SeatFile: the pre-computed `f.formVersion` wins,
 * else it is derived from `f.kind`. null = unknown, and the caller SKIPS the
 * path — guessing a version would re-seat with the wrong size (§7).
 */
function declaredVersionOf(f: SeatFile, d: { w: number; h: number }): string | null {
  return f.formVersion ?? (f.kind ? cardFormVersionOf(f.kind, d.w, d.h) : null);
}

/** Public kernel seam used by ActionService; LocalWorldStore owns the transaction. */
export async function arrangeCanvasLayer(
  store: WorldStore,
  input: ArrangeCanvasLayerInput,
): Promise<ArrangeCanvasLayerResult> {
  return store.arrangeCanvasLayer(input);
}
