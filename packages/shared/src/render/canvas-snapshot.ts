import { createHash } from 'node:crypto';
import type { ActionDetails } from '../actions/types.js';
import { ActionError, fail } from '../actions/errors.js';
import { cardFormOf } from '../schemas/forms.js';
import { resolveComponentKind } from '../components/registry.js';
import { parseFrontmatter } from '../schemas/frontmatter.js';
import type { CardRecord, WorldStore } from '../store/world-store.js';
import { dirOfLayer, layerOfDir, MAP_LAYER } from '../store/layers.js';
import { boxesOverlap } from './spatial.js';

export const CANVAS_SNAPSHOT_VERSION = 'canvas-snapshot-v1' as const;

export interface CanvasWorldRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CanvasSnapshotIdentity {
  version: typeof CANVAS_SNAPSHOT_VERSION;
  snapshotId: string;
  canvasRevision: string;
  canvasVersion: number;
  capturedAt: string;
}

export interface CanvasSnapshotRow {
  path: string;
  layer: string;
  kind: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  footprintSource: 'measured' | 'stored';
}

export interface CanvasUnplacedRow {
  path: string;
  kind: string;
  sizeSource: 'declared' | 'unknown';
  declared?: { w: number; h: number };
}

export interface CanvasSnapshotLink {
  id: string;
  layer: string;
  from: string;
  to: string;
  style: string;
  color: string | null;
  directed: boolean;
  z: number;
  label: string | null;
}

export interface CanvasSnapshotPresence {
  characterId: string;
  layer: string;
  x: number;
  y: number;
  following: boolean;
  updatedAt: string;
}

export interface CanvasSnapshotViewpoint {
  layer: string;
  focus: { x: number; y: number } | null;
  selected: string[];
  bagCount: number;
  at: string;
}

export interface CanvasSnapshot {
  identity: CanvasSnapshotIdentity;
  layer: { id: string; dir: string; name: string; stub: boolean };
  rows: CanvasSnapshotRow[];
  overlaps: Array<[string, string]>;
  unplaced: CanvasUnplacedRow[];
  links: CanvasSnapshotLink[];
  presence: CanvasSnapshotPresence[];
  viewpoint: CanvasSnapshotViewpoint | null;
}

export interface CanvasSnapshotReadOptions {
  now?: number;
  includeSourceDigests?: boolean;
}

type PageMaterial = {
  path: string;
  raw: string | null;
  frontmatter: Record<string, any> | null;
  kind: string;
  stub: boolean;
};

type DbCanvasState = {
  canvasVersion: number;
  cards: CardRecord[];
  links: CanvasSnapshotLink[];
  presence: CanvasSnapshotPresence[];
  viewpoint: CanvasSnapshotViewpoint | null;
};

function compareAscii(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function metadataMeasuredAt(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return typeof parsed.measuredAt === 'string' && parsed.measuredAt !== '' ? parsed.measuredAt : null;
  } catch {
    return null;
  }
}

function canvasVersionOf(store: WorldStore, layer: string): number {
  const row = store.queryCanvas('SELECT position_version FROM canvas_meta WHERE layer = ?', [layer])[0] as
    | { position_version?: unknown }
    | undefined;
  return Number(row?.position_version ?? 0) || 0;
}

function decodeFocus(raw: unknown): { x: number; y: number } | null {
  if (typeof raw !== 'string' || raw === '') return null;
  const fields = raw.split(':');
  if (fields.length !== 2) return null;
  const x = Number(fields[0]);
  const y = Number(fields[1]);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function parseSelected(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
  } catch {
    return [];
  }
}

function readViewpointInTransaction(store: WorldStore, now: number): CanvasSnapshotViewpoint | null {
  let row: Record<string, unknown> | undefined;
  try {
    row = store.queryCanvas('SELECT layer, focus, selected, bag_count, at FROM viewpoint LIMIT 1')[0] as
      | Record<string, unknown>
      | undefined;
  } catch {
    return null;
  }
  if (!row) return null;
  const at = String(row.at ?? '');
  const atMs = Date.parse(at);
  if (!Number.isFinite(atMs) || now - atMs > 10 * 60 * 1000) return null;
  return {
    layer: typeof row.layer === 'string' ? row.layer : '',
    focus: decodeFocus(row.focus),
    selected: parseSelected(row.selected),
    bagCount: Number(row.bag_count ?? 0) || 0,
    at,
  };
}

function readLinksInTransaction(store: WorldStore, layer: string): CanvasSnapshotLink[] {
  let rows: Array<Record<string, unknown>>;
  try {
    rows = store.queryCanvas(
      'SELECT id, layer, from_id, to_id, style, color, directed, z_index, label FROM links WHERE layer = ?',
      [layer],
    ) as Array<Record<string, unknown>>;
  } catch {
    return [];
  }
  return rows
    .map((row) => ({
      id: String(row.id),
      layer: String(row.layer),
      from: String(row.from_id),
      to: String(row.to_id),
      style: String(row.style),
      color: row.color == null ? null : String(row.color),
      directed: Number(row.directed) === 1 || row.directed === true,
      z: Number(row.z_index),
      label: row.label == null ? null : String(row.label),
    }))
    .sort((a, b) => a.z - b.z || compareAscii(a.id, b.id));
}

function readPresenceInTransaction(store: WorldStore, layer: string): CanvasSnapshotPresence[] {
  let rows: Array<Record<string, unknown>>;
  try {
    rows = store.queryCanvas(
      'SELECT character_id, layer, x, y, following, updated_at FROM presence WHERE layer = ?',
      [layer],
    ) as Array<Record<string, unknown>>;
  } catch {
    return [];
  }
  return rows
    .map((row) => ({
      characterId: String(row.character_id),
      layer: String(row.layer),
      x: Number(row.x),
      y: Number(row.y),
      following: Number(row.following) === 1 || row.following === true,
      updatedAt: String(row.updated_at ?? ''),
    }))
    .sort((a, b) => compareAscii(a.characterId, b.characterId));
}

function readCardRowsInTransaction(store: WorldStore, paths: string[]): CardRecord[] {
  if (paths.length === 0) return [];
  const placeholders = paths.map(() => '?').join(',');
  const rows = store.queryCanvas(
    `SELECT id, layer, x, y, width, height, z_index, metadata FROM cards WHERE id IN (${placeholders})`,
    paths,
  ) as Array<Record<string, unknown>>;
  return rows
    .map((row) => ({
      id: String(row.id),
      layer: String(row.layer),
      x: Number(row.x),
      y: Number(row.y),
      w: Number(row.width),
      h: Number(row.height),
      z: Number(row.z_index),
      measuredAt: metadataMeasuredAt(row.metadata),
    }))
    .sort((a, b) => compareAscii(a.id, b.id));
}

function readDbStateInTransaction(store: WorldStore, layer: string, paths: string[], now: number): DbCanvasState {
  return {
    canvasVersion: canvasVersionOf(store, layer),
    cards: readCardRowsInTransaction(store, paths),
    links: readLinksInTransaction(store, layer),
    presence: readPresenceInTransaction(store, layer),
    viewpoint: readViewpointInTransaction(store, now),
  };
}

function canvasRevisionOfState(state: DbCanvasState, rows: CanvasSnapshotRow[]): string {
  const revisionInput = {
    rows: [...rows]
      .sort((a, b) => compareAscii(a.path, b.path))
      .map((row) => ({
        id: row.path,
        layer: row.layer,
        x: row.x,
        y: row.y,
        w: row.w,
        h: row.h,
        z: row.z,
        footprintSource: row.footprintSource,
      })),
    links: [...state.links]
      .sort((a, b) => a.z - b.z || compareAscii(a.id, b.id))
      .map((link) => ({
        id: link.id,
        layer: link.layer,
        from: link.from,
        to: link.to,
        style: link.style,
        color: link.color,
        directed: link.directed,
        z: link.z,
        label: link.label,
      })),
    presence: [...state.presence]
      .sort((a, b) => compareAscii(a.characterId, b.characterId))
      .map((person) => ({
        characterId: person.characterId,
        layer: person.layer,
        x: person.x,
        y: person.y,
        following: person.following,
      })),
    viewpoint: state.viewpoint,
  };
  return sha256(canonicalJson(revisionInput));
}

/** Stable digest helper for callers that already hold a canonical snapshot. */
export function canvasRevisionOf(snapshot: Pick<CanvasSnapshot, 'rows' | 'links' | 'presence' | 'viewpoint'>): string {
  return canvasRevisionOfState(
    {
      canvasVersion: 0,
      cards: [],
      links: snapshot.links,
      presence: snapshot.presence,
      viewpoint: snapshot.viewpoint,
    },
    snapshot.rows,
  );
}

function overlapsOf(rows: CanvasSnapshotRow[]): Array<[string, string]> {
  const ordered = [...rows].sort((a, b) => compareAscii(a.path, b.path));
  const overlaps: Array<[string, string]> = [];
  for (let i = 0; i < ordered.length; i++) {
    for (let j = i + 1; j < ordered.length; j++) {
      if (boxesOverlap(ordered[i], ordered[j])) overlaps.push([ordered[i].path, ordered[j].path]);
    }
  }
  return overlaps;
}

function sourceDigestEntries(materials: PageMaterial[]): Array<{ path: string; kind: string; stub: boolean; digest: string }> {
  return [...materials]
    .sort((a, b) => compareAscii(a.path, b.path))
    .map((material) => ({
      path: material.path,
      kind: material.kind,
      stub: material.stub,
      digest: material.raw === null ? 'stub' : sha256(material.raw),
    }));
}

function pageSignature(materials: PageMaterial[]): Array<{ path: string; kind: string; stub: boolean }> {
  return sourceDigestEntries(materials).map(({ path, kind, stub }) => ({ path, kind, stub }));
}

function snapshotIdOf(input: {
  worldId: string;
  layer: string;
  canvasVersion: number;
  canvasRevision: string;
  materials: PageMaterial[];
}): string {
  return sha256(
    canonicalJson({
      version: CANVAS_SNAPSHOT_VERSION,
      worldId: input.worldId,
      layer: input.layer,
      canvasVersion: input.canvasVersion,
      pageMembership: pageSignature(input.materials),
      canvasRevision: input.canvasRevision,
      sourceDigests: sourceDigestEntries(input.materials),
    }),
  );
}

function normalizeLayer(input: string | undefined): string {
  const raw = input === undefined ? MAP_LAYER : String(input).replace(/^\.\//, '').replace(/\/+$/, '');
  if (!raw || raw.startsWith('/') || raw.includes('\\') || raw.split('/').some((part) => part === '..')) {
    fail('invalid_path', `Invalid layer path "${String(input ?? '')}".`);
  }
  return layerOfDir(raw);
}

async function materialOf(store: WorldStore, path: string, stubAllowed: boolean): Promise<PageMaterial> {
  try {
    const raw = await store.readFile(path);
    const parsed = parseFrontmatter(raw);
    return {
      path,
      raw,
      frontmatter: parsed.frontmatter,
      kind: resolveComponentKind(parsed.frontmatter, path.split('/').pop() ?? path),
      stub: false,
    };
  } catch (error) {
    if (!stubAllowed) {
      throw new ActionError({
        code: 'conflict',
        message: 'Canvas source changed while the snapshot was being read.',
        details: { path },
      });
    }
    return {
      path,
      raw: null,
      frontmatter: { type: 'readme', stub: true },
      kind: resolveComponentKind({ type: 'readme', stub: true }, 'README.md'),
      stub: true,
    };
  }
}

async function pageMaterials(store: WorldStore, layer: string): Promise<{
  all: PageMaterial[];
  visible: PageMaterial[];
}> {
  const page = await store.pageOfLayer(layer);
  const ownReadme = `${dirOfLayer(layer)}/README.md`;
  const all = [
    await materialOf(store, ownReadme, true),
    ...(await Promise.all(page.cards.map((path) => materialOf(store, path, false)))),
    ...(await Promise.all(page.doorIds.map((id) => materialOf(store, `${id}/README.md`, true)))),
  ];
  const pageCards = all.filter((material) => material.path !== ownReadme);
  const nonCharacter = pageCards.filter(
    (material) => !['character', 'spirit'].includes(String(material.frontmatter?.type ?? '')),
  );
  const targets = new Set(
    nonCharacter
      .filter((material) => material.frontmatter?.type === 'gate')
      .map((material) => material.frontmatter?.target)
      .filter((target): target is string => typeof target === 'string'),
  );
  const visible = nonCharacter.filter(
    (material) => !(material.path.endsWith('/README.md') && targets.has(material.path.replace(/\/README\.md$/, ''))),
  );
  return { all, visible };
}

function rowsOf(materials: PageMaterial[], state: DbCanvasState): {
  rows: CanvasSnapshotRow[];
  unplaced: CanvasUnplacedRow[];
} {
  const byPath = new Map(state.cards.map((row) => [row.id, row]));
  const rows: CanvasSnapshotRow[] = [];
  const unplaced: CanvasUnplacedRow[] = [];
  for (const material of materials) {
    const row = byPath.get(material.path);
    if (row) {
      rows.push({
        path: row.id,
        layer: row.layer,
        kind: material.kind,
        x: row.x,
        y: row.y,
        w: row.w,
        h: row.h,
        z: row.z,
        footprintSource: row.measuredAt ? 'measured' : 'stored',
      });
      continue;
    }
    const form = cardFormOf(material.frontmatter, material.path.split('/').pop() ?? material.path);
    const declared =
      Number.isFinite(form.w) && Number.isFinite(form.h) && form.w > 0 && form.h > 0
        ? { w: form.w, h: form.h }
        : undefined;
    unplaced.push({
      path: material.path,
      kind: material.kind,
      sizeSource: declared ? 'declared' : 'unknown',
      ...(declared ? { declared } : {}),
    });
  }
  rows.sort((a, b) => compareAscii(a.path, b.path));
  unplaced.sort((a, b) => compareAscii(a.path, b.path));
  return { rows, unplaced };
}

function conflictForFence(
  layer: string,
  expected: { canvasVersion: number; canvasRevision: string; sourceDigest: string },
  observed: { canvasVersion: number; canvasRevision: string; sourceDigest: string },
): never {
  fail('conflict', 'Canvas snapshot conflicted: the canvas changed while it was being read.', {
    layer,
    expectedCanvasVersion: expected.canvasVersion,
    currentCanvasVersion: observed.canvasVersion,
    expectedCanvasRevision: expected.canvasRevision,
    currentCanvasRevision: observed.canvasRevision,
  } as ActionDetails);
}

/**
 * Read a complete, fenced CanvasSnapshotV1. DB rows are acquired in one SQLite
 * read transaction; Markdown/source material is fenced before and after the
 * transaction so a cross-store torn read becomes an explicit conflict.
 */
async function readCanvasSnapshotInternal(
  store: WorldStore,
  input: { layer?: string },
  opts: CanvasSnapshotReadOptions,
  transactionAlreadyOpen: boolean,
): Promise<CanvasSnapshot> {
  const now = Number.isFinite(opts.now) ? Number(opts.now) : Date.now();
  const viewpointForDefault = input?.layer === undefined ? store.readViewpoint(now) : null;
  const layerId = normalizeLayer(input?.layer ?? viewpointForDefault?.layer);
  const manifest = await store.getManifest();
  const layerConfig = manifest.layers[layerId];
  if (!layerConfig) fail('not_found', `No layer "${input?.layer ?? layerId}" in this world`);

  const beforeMaterials = await pageMaterials(store, layerId);
  const beforeSourceDigest = sha256(canonicalJson(sourceDigestEntries(beforeMaterials.all)));
  const transactionPaths = beforeMaterials.visible.map((material) => material.path);

  let state: DbCanvasState;
  let startedTransaction = false;
  try {
    if (!transactionAlreadyOpen) {
      store.execCanvas('BEGIN');
      startedTransaction = true;
    }
    state = readDbStateInTransaction(store, layerId, transactionPaths, now);
    if (startedTransaction) {
      store.execCanvas('COMMIT');
      startedTransaction = false;
    }
  } catch (error) {
    if (startedTransaction) {
      try {
        store.execCanvas('ROLLBACK');
      } catch {
        // Preserve the original read/transaction failure.
      }
    }
    throw error;
  }

  const afterMaterials = await pageMaterials(store, layerId);
  const afterSourceDigest = sha256(canonicalJson(sourceDigestEntries(afterMaterials.all)));
  const rowsAndUnplaced = rowsOf(beforeMaterials.visible, state);
  const canvasRevision = canvasRevisionOfState(state, rowsAndUnplaced.rows);
  const currentState = readDbStateInTransaction(store, layerId, transactionPaths, now);
  const currentRevision = canvasRevisionOfState(currentState, rowsOf(beforeMaterials.visible, currentState).rows);
  if (
    beforeSourceDigest !== afterSourceDigest ||
    state.canvasVersion !== currentState.canvasVersion ||
    canvasRevision !== currentRevision
  ) {
    conflictForFence(
      layerId,
      { canvasVersion: state.canvasVersion, canvasRevision, sourceDigest: beforeSourceDigest },
      { canvasVersion: currentState.canvasVersion, canvasRevision: currentRevision, sourceDigest: afterSourceDigest },
    );
  }

  const capturedAt = new Date(now).toISOString();
  const snapshot: CanvasSnapshot = {
    identity: {
      version: CANVAS_SNAPSHOT_VERSION,
      snapshotId: snapshotIdOf({
        worldId: manifest.id,
        layer: layerId,
        canvasVersion: state.canvasVersion,
        canvasRevision,
        materials: beforeMaterials.all,
      }),
      canvasRevision,
      canvasVersion: state.canvasVersion,
      capturedAt,
    },
    layer: {
      id: layerId,
      dir: dirOfLayer(layerId),
      name: layerConfig.name ?? dirOfLayer(layerId).split('/').pop() ?? layerId,
      stub: layerConfig.stub === true,
    },
    rows: rowsAndUnplaced.rows,
    overlaps: overlapsOf(rowsAndUnplaced.rows),
    unplaced: rowsAndUnplaced.unplaced,
    links: state.links,
    presence: state.presence,
    viewpoint: state.viewpoint,
  };
  // `includeSourceDigests` is intentionally not surfaced: source digests are
  // always part of snapshotId, while the frozen response has no raw-content field.
  void opts.includeSourceDigests;
  return snapshot;
}

export async function readCanvasSnapshot(
  store: WorldStore,
  input: { layer?: string },
  opts: CanvasSnapshotReadOptions = {},
): Promise<CanvasSnapshot> {
  return readCanvasSnapshotInternal(store, input, opts, false);
}

/**
 * Read while the caller owns an open SQLite transaction. This is the writer
 * seam: it never starts, commits, or rolls back a nested transaction.
 */
export async function readCanvasSnapshotInTransaction(
  store: WorldStore,
  input: { layer?: string },
  opts: CanvasSnapshotReadOptions = {},
): Promise<CanvasSnapshot> {
  return readCanvasSnapshotInternal(store, input, opts, true);
}

export function snapshotSummary(snapshot: CanvasSnapshot): string {
  return `Canvas snapshot ${snapshot.identity.version} ${snapshot.identity.snapshotId} on layer ${snapshot.layer.id}. Rows: ${snapshot.rows.length}; overlaps: ${snapshot.overlaps.length}; unplaced: ${snapshot.unplaced.length}; links: ${snapshot.links.length}; presence: ${snapshot.presence.length}.`;
}
