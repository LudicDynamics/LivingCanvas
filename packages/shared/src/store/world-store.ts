import type { WorldManifest } from '../schemas/world.js';
import type { LinkRecord } from '../schemas/canvas.js';
import type {
  ActorValue,
  AppendEventArgs,
  DanglingRef,
  MoveResult,
  WorldEvent,
} from '../schemas/events.js';
export type { LinkRecord };

/** Canvas card state row (id == repository-relative path of the card file). */
export interface CardRecord {
  id: string;
  layer: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  /**
   * NEW. Parsed from `cards.metadata.formVersion`; null/absent = no marker.
   * Compared against `cardFormVersionOf(kind, declared w, h)` to detect that a
   * KIND was resized in code (contract §5.1 第 4 条).
   */
  formVersion?: string | null;
  /**
   * NEW. Parsed from `cards.metadata.measuredAt`; non-null = this row's w/h is
   * a MEASURED value written by `writeFootprints` (the race guard that keeps
   * that method free of kind knowledge, contract §5.1 第 3 条).
   */
  measuredAt?: string | null;
  /**
   * NEW. Parsed from `cards.metadata.seatW`; the `w` actually used at this
   * row's LAST seat (contract §5.2). Absent on rows written before this batch.
   */
  seatW?: number | null;
  /**
   * NEW. Parsed from `cards.metadata.seatH`; compared against `h` to detect
   * that the MEASURED footprint moved since the last seat — the ONLY path that
   * makes "card grew taller -> its seat moves aside" happen (contract §5.1 第 3 条).
   */
  seatH?: number | null;
}

/** A card file pending seating; w/h defaults applied at seat time when absent. */
export interface SeatFile {
  path: string;
  w?: number;
  h?: number;
  /**
   * NEW. Declared kind of `path` at seat time. Needed to compute the DECLARED
   * version `cardFormVersionOf(kind, w, h)`; supplied by the caller
   * (`declaredSizeOf`/`storedSizeOf`, 02). Absent on the legacy callers
   * (`seatFileOf`) — `reseatLayer` then skips the path rather than guessing.
   */
  kind?: string;
  /**
   * NEW. Pre-computed declared version accelerator. When present it WINS over
   * computing from (kind,w,h); when absent the version comes from `kind`.
   */
  formVersion?: string;
  /**
   * NEW. Stable within-batch seating hint; never persisted in card metadata.
   * Canonical `/api/layer` callers derive it from explicit order, kind stage,
   * numeric filename prefix, and ASCII path.
   */
  order?: number;
}

/**
 * A character's standing on the canvas (05 §2.1). Presence is a POINT: `x`/`y`
 * are the avatar's CENTRE, not a card's top-left corner.
 */
export interface PresenceRecord {
  characterId: string;
  layer: string;
  x: number;
  y: number;
  following: boolean;
  updatedAt: string;
}

/** The player's viewpoint row, decoded (00 §5.1 / 05 §2.3). `focus` is the view CENTRE. */
export interface ViewpointRecord {
  /** Layer id verbatim from the browser: 'map' or 'world/<dir>'. */
  layer: string;
  /** Viewport centre in world coords, or null when the browser reported no camera. */
  focus: { x: number; y: number } | null;
  /** Selected card paths (world-root relative). */
  selected: string[];
  /** Player's backpack size at report time; the LIST is section 02's `bag`. */
  bagCount: number;
  /** ISO report time, server clock. */
  at: string;
}

/** Outcome of presence seating (05 §3.9.3); `exhausted` surfaces the fallback. */
export interface SeatPresenceResult {
  x: number;
  y: number;
  seat: { gx: number; gy: number; tries: number; exhausted: boolean };
}

export interface CharacterCreationTransaction {
  stageBundle(files: ReadonlyMap<string, string>): Promise<void>;
  commitBundleAndManifest(updates: Partial<WorldManifest>): Promise<void>;
  appendSuccessEventOnce(args: AppendEventArgs, key: string): Promise<WorldEvent>;
}


export interface ArrangeCanvasLayerInput {
  operationId: string;
  layer: string;
  mode: 'grid' | 'circle' | 'row';
  expectedRevision: number;
  expectedCanvasVersion: number;
  snapshotId: string;
  policy: 'deoverlap';
  allowMoveStableCards: true;
  preserveLinks: true;
}

export interface ArrangeCanvasLayerResult {
  kind: 'cards';
  action: 'arrangeCanvasLayer';
  operationId: string;
  layer: string;
  mode: 'grid' | 'circle' | 'row';
  canvasVersion: number;
  canvasRevision: string;
  snapshotIdBefore: string;
  snapshotIdAfter: string;
  cards: Array<{ path: string; x: number; y: number; z: number; w: number; h: number }>;
  movedCount: number;
  overlapCount: number;
  committed: boolean;
}

export interface CanvasPositionInput {
  path: string;
  x?: number;
  y?: number;
  z?: number;
}

export interface CanvasCommit {
  layer: string;
  cards: CardRecord[];
  canvasVersion: number;
}

export interface WorldStore {
  worldRoot: string;
  readFile(relPath: string): Promise<string>;
  /** Widened to Buffer for binary assets (generate_image, 01 §10.1). */
  writeFile(relPath: string, content: string | Buffer): Promise<void>;
  deleteFile(relPath: string): Promise<void>;
  listFiles(prefix?: string): Promise<string[]>;
  /**
   * Every directory under `prefix` (relative) — a DIRECTORY walk, including
   * directories that hold no files. Defaults to `world/`; pass a
   * subtree such as `characters/<id>` for the nook scene tree
   *.
   */
  listDirs(prefix?: string): Promise<string[]>;
  move(from: string, to: string): Promise<MoveResult>;
  getManifest(): Promise<WorldManifest>;
  updateManifest(updates: Partial<WorldManifest>): Promise<void>;
  queryCanvas(sql: string, params?: any[]): any[];
  execCanvas(sql: string, params?: any[]): void;
  appendHistoryEntry(sessionId: string, type: string, content: string): Promise<void>;

  // === Event layer (replaces appendWorldEvent; getEvents is kept, seq-ordered) ===
  appendEvent(args: AppendEventArgs): Promise<WorldEvent>;
  getEventsSince(seq: number, opts?: { layer?: string; excludeActor?: ActorValue; limit?: number }): Promise<WorldEvent[]>;
  getMaxSeq(): Promise<number>;
  readCursor(reader: string): Promise<number>;
  writeCursor(reader: string, seq: number): Promise<void>;
  /**
   * Rollback's ONE atomic step (doc-21 §6, hooks/03 §6.2): append
   * `world_rolled_back` and push EVERY read cursor to the resulting max seq in
   * the SAME `historyDb` transaction. Doing them separately lets a concurrent
   * writer turn observe "cursors pushed, rollback event not yet landed" — that
   * turn would then see neither the rollback nor the pre-rollback events, a
   * silent swallow. Returns the appended event (its `seq` is the pushed value).
   */
  appendEventAndPushCursors(args: AppendEventArgs): Promise<WorldEvent>;
  /** Newest-first, history panel only (doc-21 §3.1: seq is the cursor, never created_at). */
  getEvents(limit?: number, opts?: { layer?: string }): Promise<WorldEvent[]>;
  withCharacterCreationWriteLock<T>(
    characterId: string,
    work: (tx: CharacterCreationTransaction) => Promise<T>,
  ): Promise<T>;

  // === Path / file helpers (01 §2.7) ===
  /**
   * Layer id a world path belongs to, or null when the path is NOT in the layer
   * tree (`player/**`, `characters/<id>/**`, `world.json`). `world/**` →
   * layerOfDir. Mapping a bag path to 'map' would be a lie (doc-22 §3.2 expects
   * it excluded).
   */
  resolveLayer(path: string): Promise<string | null>;
  statKind(relPath: string): Promise<'file' | 'dir' | 'missing'>;
  /** Same-dir temp file + rename; original untouched on failure; throws on error. */
  writeFileAtomic(relPath: string, content: string | Buffer): Promise<void>;
  /** Binary read — `readFile` is utf-8 only; PNG/asset tiers need base64. */
  readFileBase64(relPath: string): Promise<string>;

  // === Read cursors ===
  /** Every cursor row — rollback must push them ALL to the max seq (doc-21 §6). */
  getAllReadCursors(): Promise<Array<{ reader: string; seq: number }>>;

  getLayerCards(paths: string[]): CardRecord[];
  seatUnplaced(layerId: string, files: SeatFile[]): Promise<CardRecord[]>;
  reseatLayer(layerId: string, files: SeatFile[]): Promise<CardRecord[]>;
  /**
   * NEW. Persist measured footprints for one layer (03's only entry point).
   * Only `width`/`height` and `metadata.measuredAt` are written;
   * `metadata.formVersion` / `seatW` / `seatH` are PRESERVED untouched, and
   * x/y/z are NEVER touched (contract §3.3 / §5.2 / §8 反模式 9). Idempotent:
   * a box whose stored w/h already equals the input is `unchanged` and writes
   * nothing. Matches rows by `id = path` ONLY — a nested-layer README row has a
   * different `layer` than the page it is shown on (contract §3.3 BLOCKER-2).
   * Unknown path / missing row -> skip + warn + `unchanged` (HTTP 200).
   */
  writeFootprints(
    layerId: string,
    boxes: Array<{ path: string; w: number; h: number }>
  ): Promise<{ updated: number; unchanged: number }>;
  saveCardPosition(id: string, x: number, y: number): Promise<CardRecord>;

  renameCardPosition(from: string, to: string): Promise<void>;
  /** Seat one new card next to an anchor card; `exhausted` when no clean cell (04 §3.9.3). */
  seatNear(layerId: string, file: SeatFile, anchorPath: string): Promise<CardRecord & { exhausted: boolean }>;
  /** Drop a card + every line touching it (04 §3.2 step 4 / 09 §4.4). */
  dropCard(path: string): { cards: number; links: number };
  /** Every card path seated on a layer (the seatNear occupancy set). */
  cardsInLayer(layerId: string): string[];

  // === Presence (05 §2.1: character standing on the canvas, `canvas.db` only) ===
  /**
   * Seat a character presence near `near` (a card path) or at the global
   * anchor; avoids the layer's cards AND its other presences. `x`/`y` are the
   * avatar centre.
   */
  seatPresence(
    layerId: string,
    opts?: { near?: string; excludeCharacter?: string }
  ): Promise<SeatPresenceResult>;
  /**
   * UPSERT one row keyed by `character_id`. `following` omitted keeps the
   * current value (05 §3.4). Returns the row as stored.
   */
  upsertPresence(p: {
    characterId: string;
    layer: string;
    x: number;
    y: number;
    following?: boolean;
  }): Promise<PresenceRecord>;
  /** Presence rows for one layer, or the whole world when `layer` is omitted. */
  getPresence(layer?: string): PresenceRecord[];
  /** One character's row, or null when they have never been placed. */
  getPresenceOf(characterId: string): PresenceRecord | null;
  /** Remove a row created by a failed world-load initialization retry. */
  deletePresence(characterId: string): Promise<boolean>;
  /**
   * The singleton viewpoint row, or null when the table is absent / empty / stale
   * (05 §2.3). SYNCHRONOUS: the only synchronous store read, matching
   * `getPresence` (it goes through `queryCanvas`).
   */
  readViewpoint(now?: number): ViewpointRecord | null;
  /**
   * Overwrite the singleton viewpoint row (05 §2.5). The SERVER owns `at`.
   * Returns the stamped ISO timestamp.
   */
  writeViewpoint(v: {
    layer: string;
    focus: { x: number; y: number; w: number; h: number } | null;
    selected: string[];
    bagCount: number;
  }): string;
  /**
   * Physical move the action layer orchestrates: reference rewrite, rename,
   * self-rebase of the moved file's own relative links (04 §3.1 steps 5–7).
   * Lands NO event — `moveEntity` does, with the real actor.
   */
  moveFile(from: string, to: string): Promise<{ name: string; rewrote: string[]; dangling: DanglingRef[] }>;
  /** Markdown + child-door ids for a layer's page (see store/layers.ts). */
  pageOfLayer(layerId: string): Promise<{ cards: string[]; doorIds: string[] }>;
  /**
   * Newest-first files by mtime under `prefix` (world-relative), capped at `limit`.
   * Powers `recent_chalk`'s cross-layer ordering (02 §3.1) — the only mtime read.
   */
  filesByMtime(prefix: string, limit: number): Promise<string[]>;

  // === Canvas state layer (doc-09 §4.2): `canvas.db` only, never an event ===
  /**
   * Create/overwrite one line. `layer`/`from`/`to` are required; omitted
   * fields keep the row's current values (create starts from the style
   * defaults). `id` omitted → `lnk-` + sha1(layer|from|to)[0:8], which is what
   * makes `create` idempotent for the same endpoint pair (doc-09 §3.1).
   */
  upsertLink(link: {
    id?: string;
    layer: string;
    from: string;
    to: string;
    style?: LinkRecord['style'];
    color?: LinkRecord['color'];
    directed?: boolean;
    z?: number;
    label?: string | null;
  }): Promise<LinkRecord>;
  /** Delete one line; `false` when there was nothing to delete. */
  deleteLink(id: string): Promise<boolean>;
  /** Current per-layer position-write version (canvas.db only). */
  getCanvasVersion(layerId: string): number;
  /** Canonical arrangement kernel; implementations must commit atomically. */
  arrangeCanvasLayer(input: ArrangeCanvasLayerInput): Promise<ArrangeCanvasLayerResult>;
  /** Atomic position batch shared by legacy arrange/position callers. */
  applyCanvasPositions(
    layerId: string,
    rows: readonly CanvasPositionInput[],
    expectedCanvasVersion?: number,
  ): Promise<CanvasCommit>;
  /**
   * Overwrite x/y/z of one card. `layer` is resolved by the CALLER via
   * `resolveLayer` (`cards.layer` is NOT NULL); w/h are never touched — they
   * are a pure function of kind (doc-09 §11 冲突 1, m-11).
   */
  placeCard(
    layer: string,
    path: string,
    box: { x?: number; y?: number; z?: number }
  ): Promise<CardRecord>;
  /** Batch seating for `layout`, in ONE transaction (no torn frames). */
  placeCards(
    rows: Array<{ layer: string; path: string; x: number; y: number; z?: number }>
  ): Promise<CardRecord[]>;
  /** Lines of one layer (or the whole canvas when `layer` is omitted). */
  getLayerLinks(layer?: string): Promise<LinkRecord[]>;
  close(): void;
}
