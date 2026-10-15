/**
 * doc-09 `link` / `arrange` — the two canvas-state tools.
 *
 * Both write ONLY `canvas.db` (`links` / `cards`) and append NO event: the
 * canvas is a current-value store, so there is nothing a history reader would
 * need to be told afterwards (doc-09 §5). The single outward signal is
 * `details`, which `event-bridge` maps into a `canvas_patched` frame.
 */
import type { ActionContext, ActionResult } from './types.js';
import { FUNCTIONAL_ARRANGER_SCOPE } from './actor.js';
import type { ArrangeInput, LayoutMode, LinkColor, LinkInput, LinkRecord, LinkStyle } from '../schemas/canvas.js';
import type {
  ArrangeCanvasLayerInput,
  ArrangeCanvasLayerResult,
  WorldStore,
} from '../store/world-store.js';
import { LAYOUT_MODES, LINK_COLORS, LINK_STYLE_TOKENS } from '../schemas/canvas.js';
import { cardFormOf, type CardForm } from '../schemas/forms.js';
import { parseFrontmatter } from '../schemas/frontmatter.js';
import { ActionError, fail } from './errors.js';
import { registerAction } from './service.js';
import type { CardRecord, SeatFile } from '../store/world-store.js';
import { SEAT_ANCHOR, SEAT_PAD, SEAT_STEP, arrangeCanvasLayer as arrangeCanvasLayerKernel } from '../store/local-store.js';
import { readCanvasSnapshot } from '../render/canvas-snapshot.js';
import { characterIdOfPath, isNookSceneId, nookIdOf } from '../rules/characters.js';
import { deriveNookLayers, nookSceneCards, nookSceneOfPath } from '../store/nook-layers.js';
import { dirOf } from '../store/layers.js';
import type { LayerConfig } from '../schemas/world.js';

const MAX_COORD = 4000;
const MAX_LABEL = 40;

export type LinkDetails = {
  kind: 'links';
  action: 'created' | 'updated' | 'deleted';
  layer: string;
  links: LinkRecord[];
  path?: string;
};

export type ArrangeDetails = {
  kind: 'cards';
  action: 'placed' | 'laid-out';
  layer: string;
  cards: Array<{ path: string; x: number; y: number; z: number }>;
  path?: string;
};
/** Evidence reference for one archived arrange screenshot. */
export type ArrangeScreenshotEvidence = {
  phase: 'before' | 'after';
  /** World-relative archive path under `.airpworld/arrange/`; never an absolute path. */
  path: string;
  width: number;
  height: number;
  /** Snapshot identity the PNG was verified against at capture time. */
  snapshotId: string;
};

export type ArrangeCanvasDetails = Omit<ArrangeCanvasLayerResult, 'action'> & {
  action: 'arrangeCanvas';
  expectedRevision: number;
  revision: number;
  expectedCanvasVersion: number;
  /** Present when the request's screenshotPolicy demanded captures and they succeeded. */
  screenshotEvidence?: ArrangeScreenshotEvidence[];
};

/**
 * Preset → stored primitives (doc-09 §2.4). `null` color means "use the
 * style's own default". An explicit `color`/`directed` overrides the preset,
 * so "red thread" is `style: 'thread', color: 'rust'`.
 */
const STYLE_PRESETS: Record<
  LinkStyle,
  { style: LinkRecord['style']; color: LinkColor | null; directed: boolean }
> = {
  solid: { style: 'ink', color: null, directed: false },
  dashed: { style: 'dashed', color: null, directed: false },
  arrow: { style: 'ink', color: null, directed: true },
  bold: { style: 'bold', color: null, directed: false },
  red: { style: 'ink', color: 'rust', directed: false },
  hand: { style: 'hand', color: null, directed: false },
  thread: { style: 'thread', color: null, directed: false },
  road: { style: 'road', color: null, directed: false },
};

/** Normalize a tool-facing triple into the three stored columns (doc-09 §2.4). */
export function normalizeLinkStyle(
  style?: LinkStyle,
  color?: LinkColor,
  directed?: boolean
): { style: LinkRecord['style']; color: LinkColor | null; directed: boolean } {
  const preset = STYLE_PRESETS[style ?? 'solid'];
  return {
    style: preset.style,
    color: color ?? preset.color,
    directed: directed ?? preset.directed,
  };
}

/** One card's box for the layout calculators (w/h from the stored row). */
export interface LayoutBox {
  path: string;
  w: number;
  h: number;
}

/**
 * The ONE row-vs-form precedence (00 §3.4). Since F1 the `cards` columns are
 * the card's REAL footprint; the form table is only the first-paint default for
 * a row that is missing or degenerate (`w/h <= 0`). Every server read path that
 * needs a "will these two cards collide?" size MUST go through this function —
 * never a second `cardFormOf` call (00 §3.2 I1).
 */
export function boxSizeOf(
  row: Pick<CardRecord, 'w' | 'h'> | undefined,
  form: Pick<CardForm, 'w' | 'h'>
): { w: number; h: number } {
  return row && row.w > 0 && row.h > 0 ? { w: row.w, h: row.h } : { w: form.w, h: form.h };
}

/** A chosen top-left position. */
export interface LayoutPos {
  path: string;
  x: number;
  y: number;
}

// -------------------------------------------------------------- validation

function assertCardPath(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    fail('invalid_path', `Invalid card path ${JSON.stringify(value)}: "${field}" must name a card.`);
  }
  if (value.startsWith('/') || value.includes('\\') || value.split('/').includes('..')) {
    fail(
      'invalid_path',
      `Invalid card path "${value}": paths are world-root relative, POSIX, no leading './'.`
    );
  }
}

/** The file must exist; a malformed path is a different failure than a miss. */
async function assertCardExists(store: WorldStore, path: string): Promise<void> {
  try {
    await store.readFile(path);
  } catch (err) {
    if (err instanceof ActionError) throw err;
    fail(
      'not_found',
      `Card not found: "${path}". Use look_at / view_canvas to list the current layer's cards.`
    );
  }
}

/** Layer of a card path; `null` (bag / character) is never a valid endpoint. */
async function layerOfCard(store: WorldStore, path: string): Promise<string> {
  const layer = await store.resolveLayer(path);
  if (layer === null) {
    fail(
      'invalid_argument',
      `"${path}" is not on a canvas layer; lines connect cards shown on a layer page.`
    );
  }
  return layer;
}

/** Both endpoints in one layer — cross-layer lines are never rendered. */
async function sharedLayer(store: WorldStore, from: string, to: string): Promise<string> {
  const a = await layerOfCard(store, from);
  const b = await layerOfCard(store, to);
  if (a !== b) {
    fail(
      'invalid_argument',
      `Both endpoints must be in the same layer ("${a}" vs "${b}"); cross-layer lines are never rendered.`
    );
  }
  return a;
}

function assertStyleToken(style: unknown): asserts style is LinkStyle {
  if (!LINK_STYLE_TOKENS.includes(style as LinkStyle)) {
    fail(
      'invalid_field_value',
      `Unknown style "${String(style)}". Valid: ${LINK_STYLE_TOKENS.join(', ')}.`
    );
  }
}

function assertColorToken(color: unknown): asserts color is LinkColor {
  if (!LINK_COLORS.includes(color as LinkColor)) {
    fail('invalid_field_value', `Unknown color "${String(color)}". Valid: ${LINK_COLORS.join(', ')}.`);
  }
}

/**
 * Locate existing lines by `id` or by endpoint pair (doc-09 §3.1 step 2c).
 * `(from, to)` matching more than one row is never guessed away — the caller
 * must name one (REVIEW m-10).
 */
async function findLink(
  store: WorldStore,
  by: { id?: string; from?: string; to?: string }
): Promise<LinkRecord> {
  const all = await store.getLayerLinks();
  if (by.id !== undefined) {
    const hit = all.filter((l) => l.id === by.id);
    if (hit.length === 0) fail('not_found', `No line with id "${by.id}".`);
    return hit[0];
  }
  const hit = all.filter((l) => l.from === by.from && l.to === by.to);
  if (hit.length === 0) fail('not_found', `No line between "${by.from}" and "${by.to}".`);
  if (hit.length > 1) {
    fail(
      'invalid_argument',
      `${hit.length} lines connect these cards. Pass an "id" to pick one: ${hit
        .map((l) => l.id)
        .join(', ')}.`
    );
  }
  return hit[0];
}

// ------------------------------------------------------------------- link

export async function linkCards(
  ctx: ActionContext,
  input: LinkInput
): Promise<ActionResult<LinkDetails>> {
  const { store } = ctx;
  const op = input?.op;
  if (op !== 'create' && op !== 'update' && op !== 'delete') {
    fail('invalid_argument', 'link: op must be one of create, update, delete.');
  }

  if (input.style !== undefined) assertStyleToken(input.style);
  if (input.color !== undefined) assertColorToken(input.color);
  if (input.label !== undefined && input.label.length > MAX_LABEL) {
    fail('invalid_argument', `Line label is ${input.label.length} chars; keep it under ${MAX_LABEL}.`);
  }

  if (op === 'create') {
    assertCardPath(input.from, 'from');
    assertCardPath(input.to, 'to');
    await assertCardExists(store, input.from);
    await assertCardExists(store, input.to);
    const layer = await sharedLayer(store, input.from, input.to);

    const norm = normalizeLinkStyle(input.style, input.color, input.directed);

    if (input.id !== undefined) {
      // A caller-chosen id may not silently steal an unrelated line's identity.
      const clash = (await store.getLayerLinks()).find((l) => l.id === input.id);
      if (clash && (clash.from !== input.from || clash.to !== input.to)) {
        fail(
          'already_exists',
          `Line "${input.id}" already connects ${clash.from} -> ${clash.to}. Pass a different id or omit it.`
        );
      }
    }

    const row = await store.upsertLink({
      id: input.id,
      layer,
      from: input.from,
      to: input.to,
      style: norm.style,
      color: norm.color,
      directed: norm.directed,
      label: input.label ?? null,
    });
    return {
      text: describeLink('Created', row),
      details: { kind: 'links', action: 'created', layer, links: [row], path: row.from },
    };
  }

  // update / delete: locate the target row first.
  if (input.id === undefined && !(input.from !== undefined && input.to !== undefined)) {
    fail('invalid_argument', `link: ${op} needs an "id" or both "from" and "to".`);
  }

  let row: LinkRecord;
  if (input.id !== undefined) {
    row = await findLink(store, { id: input.id });
  } else {
    assertCardPath(input.from, 'from');
    assertCardPath(input.to, 'to');
    await assertCardExists(store, input.from);
    await assertCardExists(store, input.to);
    await sharedLayer(store, input.from, input.to);
    row = await findLink(store, { from: input.from, to: input.to });
  }

  // Endpoints must exist for update/delete too — a dangling row is not a
  // target (doc-09 §3.1 step 2c).
  const from = input.from ?? row.from;
  const to = input.to ?? row.to;
  assertCardPath(from, 'from');
  assertCardPath(to, 'to');
  await assertCardExists(store, from);
  await assertCardExists(store, to);
  const layer = await sharedLayer(store, from, to);

  if (op === 'delete') {
    await store.deleteLink(row.id);
    return {
      text: `Deleted line ${row.id} between "${row.from}" and "${row.to}".`,
      details: { kind: 'links', action: 'deleted', layer, links: [row], path: row.from },
    };
  }

  // Only the fields the caller supplied change; naming a style preset also
  // applies that preset's color/direction (doc-09 §3.1 step 3).
  const preset = input.style === undefined ? undefined : normalizeLinkStyle(input.style);
  const updated = await store.upsertLink({
    id: row.id,
    layer,
    from,
    to,
    style: preset?.style,
    color: input.color ?? preset?.color,
    directed: input.directed ?? preset?.directed,
    label: input.label,
  });
  return {
    text: describeLink('Updated', updated),
    details: { kind: 'links', action: 'updated', layer, links: [updated], path: updated.from },
  };
}

function describeLink(verb: string, row: LinkRecord): string {
  const bits = [`style ${row.style}`];
  if (row.color) bits.push(`color ${row.color}`);
  if (row.directed) bits.push('directed');
  return `${verb} line ${row.id} between "${row.from}" and "${row.to}" (${bits.join(', ')}).`;
}

// ---------------------------------------------------------------- arrange

/** `[-4000, 4000]` clamp; `NaN` / `Infinity` are a type error, not a far card. */
export function clampCoord(value: number, axis: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail('invalid_argument', `${axis} must be a finite number.`);
  }
  return Math.min(MAX_COORD, Math.max(-MAX_COORD, value));
}

/** Deterministic order regardless of the caller's array order (doc-09 §10.1). */
function bySortedPath(boxes: LayoutBox[]): LayoutBox[] {
  return [...boxes].sort((a, b) => a.path.localeCompare(b.path));
}

/** √n columns, centered on the seating anchor. */
export function computeGrid(boxes: LayoutBox[]): LayoutPos[] {
  const items = bySortedPath(boxes);
  const n = items.length;
  if (n === 0) return [];
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const pitchX = Math.max(SEAT_STEP, Math.max(...items.map((b) => b.w)) + SEAT_PAD);
  const pitchY = Math.max(SEAT_STEP, Math.max(...items.map((b) => b.h)) + SEAT_PAD);
  return items.map((box, i) => {
    const cx = SEAT_ANCHOR.x + ((i % cols) - (cols - 1) / 2) * pitchX;
    const cy = SEAT_ANCHOR.y + (Math.floor(i / cols) - (rows - 1) / 2) * pitchY;
    return { path: box.path, x: cx - box.w / 2, y: cy - box.h / 2 };
  });
}

/** Equal angles on a circle centered on the anchor; radius fits the boxes. */
export function computeCircle(boxes: LayoutBox[]): LayoutPos[] {
  const items = bySortedPath(boxes);
  const n = items.length;
  if (n === 0) return [];
  const maxDiag = Math.max(...items.map((b) => Math.hypot(b.w, b.h)));
  const radius = Math.max(SEAT_STEP, (maxDiag + SEAT_PAD) / (2 * Math.sin(Math.PI / n)));
  return items.map((box, i) => {
    const theta = -Math.PI / 2 + (2 * Math.PI * i) / n;
    const cx = SEAT_ANCHOR.x + radius * Math.cos(theta);
    const cy = SEAT_ANCHOR.y + radius * Math.sin(theta);
    return { path: box.path, x: cx - box.w / 2, y: cy - box.h / 2 };
  });
}

/** One horizontal row centered on the anchor. */
export function computeRow(boxes: LayoutBox[]): LayoutPos[] {
  const items = bySortedPath(boxes);
  const n = items.length;
  if (n === 0) return [];
  const pitch = Math.max(SEAT_STEP, Math.max(...items.map((b) => b.w)) + SEAT_PAD);
  return items.map((box, i) => {
    const cx = SEAT_ANCHOR.x + (i - (n - 1) / 2) * pitch;
    return { path: box.path, x: cx - box.w / 2, y: SEAT_ANCHOR.y - box.h / 2 };
  });
}

const LAYOUT_COMPUTERS: Record<LayoutMode, (boxes: LayoutBox[]) => LayoutPos[]> = {
  grid: computeGrid,
  circle: computeCircle,
  row: computeRow,
};

/** Card boxes for `arrange`: the stored row is the truth, the form table the
 *  first-paint default (00 §3.1); a row with a real size short-circuits the
 *  file read. Degenerate rows (`w/h <= 0`) fall back loudly. */
async function boxesOf(store: WorldStore, paths: string[]): Promise<LayoutBox[]> {
  const byId = new Map(store.getLayerCards(paths).map((r) => [r.id, r]));
  const boxes: LayoutBox[] = [];
  for (const path of paths) {
    const row = byId.get(path);
    if (row && row.w > 0 && row.h > 0) {
      boxes.push({ path, w: row.w, h: row.h });
      continue;
    }
    const { frontmatter } = parseFrontmatter(await store.readFile(path));
    const form = cardFormOf(frontmatter, path.split('/').pop() ?? path);
    if (row) {
      console.warn(`arrange: card "${path}" has a degenerate row (w=${row.w}, h=${row.h}); using the declared form.`);
    }
    boxes.push({ path, ...boxSizeOf(row, form) });
  }
  return boxes;
}

/**
 * Every row MUST carry a real kind footprint, never the schema DEFAULT
 * (`applyPlaceCard` writes no w/h — contract §5.5 / 反模式 12). `arrange` is a
 * row-creating path, so it seats any path that has no row yet at its DECLARED
 * size through the canonical writer (`seatUnplaced`); paths that already have a
 * row are a no-op, which keeps a second `arrange` deterministic. The seats
 * themselves are discarded — `arrange` overwrites x/y moments later.
 */
async function seatDeclaredRows(store: WorldStore, layer: string, paths: string[]): Promise<void> {
  const hasRow = new Set(store.getLayerCards(paths).map((r) => r.id));
  const files: SeatFile[] = [];
  for (const path of paths) {
    if (hasRow.has(path)) continue;
    const { frontmatter } = parseFrontmatter(await store.readFile(path));
    const form = cardFormOf(frontmatter, path.split('/').pop() ?? path);
    files.push({ path, w: form.w, h: form.h });
  }
  if (files.length > 0) await store.seatUnplaced(layer, files);
}

export async function arrangeCanvas(
  ctx: ActionContext,
  input: ArrangeCanvasLayerInput,
): Promise<ActionResult<ArrangeCanvasDetails>> {
  if (ctx.actor.type !== 'functional' || ctx.actor.id !== 'canvas-arranger' || ctx.agentScope !== FUNCTIONAL_ARRANGER_SCOPE) {
    fail('unsupported', 'arrangeCanvas requires the functional canvas-arranger scope.');
  }
  if (typeof input.operationId !== 'string' || input.operationId.trim() === '') {
    fail('invalid_argument', 'operationId must be a non-empty string.');
  }
  if (typeof input.layer !== 'string' || input.layer.trim() === '') {
    fail('invalid_argument', 'layer must be a non-empty string.');
  }
  if (!LAYOUT_MODES.includes(input.mode)) fail('invalid_argument', 'mode must be grid, circle, or row.');
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) {
    fail('invalid_argument', 'expectedRevision must be a non-negative integer.');
  }
  if (!Number.isInteger(input.expectedCanvasVersion) || input.expectedCanvasVersion < 0) {
    fail('invalid_argument', 'expectedCanvasVersion must be a non-negative integer.');
  }
  if (typeof input.snapshotId !== 'string' || input.snapshotId.trim() === '') {
    fail('invalid_argument', 'snapshotId must be a non-empty string.');
  }
  if (input.policy !== 'deoverlap' || input.allowMoveStableCards !== true || input.preserveLinks !== true) {
    fail('invalid_argument', 'arrangeCanvas requires deoverlap, allowMoveStableCards, and preserveLinks.');
  }
  const snapshot = await readCanvasSnapshot(ctx.store, { layer: input.layer });
  if (
    snapshot.identity.canvasVersion !== input.expectedCanvasVersion ||
    snapshot.identity.snapshotId !== input.snapshotId
  ) {
    fail('conflict', `Canvas snapshot conflict on layer "${input.layer}".`, {
      layer: input.layer,
      expectedCanvasVersion: input.expectedCanvasVersion,
      currentCanvasVersion: snapshot.identity.canvasVersion,
      expectedSnapshotId: input.snapshotId,
      currentSnapshotId: snapshot.identity.snapshotId,
      currentCanvasRevision: snapshot.identity.canvasRevision,
    });
  }

  const result = await ctx.store.arrangeCanvasLayer(input);
  return {
    text: `Arranged ${result.movedCount} card(s) on layer "${input.layer}" in a ${input.mode}.`,
    details: {
      ...result,
      action: 'arrangeCanvas',
      expectedRevision: input.expectedRevision,
      revision: input.expectedRevision,
      expectedCanvasVersion: input.expectedCanvasVersion,
    },
  };
}

/** Same breathing room `flowColumns` keeps between seats (local-store.ts SEAT_PAD). */
const PLACEMENT_PAD = 22;

/**
 * Would placing `path` at the requested corner overlap any OTHER card on the
 * layer? Uses the card's current row footprint; a card with no row yet, or a
 * request that moves only one axis, is never judged (the seat decides).
 */
export function agentPlacementCollides(
  store: WorldStore,
  layer: string,
  path: string,
  box: { x?: number; y?: number },
): boolean {
  if (box.x === undefined || box.y === undefined) return false;
  const self = store.getLayerCards([path])[0];
  if (!self || self.w <= 0 || self.h <= 0) return false;
  const others = store.getLayerCards(store.cardsInLayer(layer)).filter((row) => row.id !== path && row.w > 0 && row.h > 0);
  return others.some((row) =>
    box.x! < row.x + row.w + PLACEMENT_PAD && box.x! + self.w + PLACEMENT_PAD > row.x &&
    box.y! < row.y + row.h + PLACEMENT_PAD && box.y! + self.h + PLACEMENT_PAD > row.y);
}

export async function arrangeCards(
  ctx: ActionContext,
  input: ArrangeInput
): Promise<ActionResult<ArrangeDetails>> {
  const { store } = ctx;

  // `w`/`h` are frozen in plan §4, but the size of a kind is a form-table
  // fact; reject loudly rather than write a value the next paint undoes.
  if (input.w !== undefined || input.h !== undefined) {
    fail(
      'unsupported',
      'Card size is derived from CARD_FORMS (single source of truth); arrange cannot change w/h. Use the component registry to resize a kind.'
    );
  }

  const hasPlace = input.place !== undefined;
  const hasLayout = input.layout !== undefined;
  if (hasPlace === hasLayout) {
    fail('invalid_argument', 'arrange: pass either a path (place) or a layout, not both.');
  }

  if (hasPlace) {
    const place = input.place!;
    assertCardPath(place.path, 'path');
    if (place.x === undefined && place.y === undefined && place.z === undefined) {
      fail('invalid_argument', 'arrange: place needs at least one of x, y, z.');
    }
    const box: { x?: number; y?: number; z?: number } = {};
    if (place.x !== undefined) box.x = clampCoord(place.x, 'x');
    if (place.y !== undefined) box.y = clampCoord(place.y, 'y');
    if (place.z !== undefined) {
      if (!Number.isFinite(place.z)) fail('invalid_argument', 'z must be a finite number.');
      box.z = place.z;
    }

    await assertCardExists(store, place.path);
    // A nook is NOT a layer (`resolveLayer` returns null for `characters/**`,
    // local-store.ts:550-556), so it is a SIBLING branch — `resolveLayer`'s own
    // semantics are untouched. `arrangeCards` is the one
    // entry shared by the player UI (routes/world.ts) and the agent tool
    // (extensions/toolkit/arrange.ts), so the branch lives here once.
    // The scene is the path's DIRECT parent directory, and it must itself be a
    // valid `nookSceneId` — this is what keeps a subdirectory card
    // (`characters/elias/office/desk.md`) on its OWN page instead of collapsing
    // to the character root (`characterIdOfPath` only answers "which character",
    // the design notes §③ step 3). "Every directory is a scene": a real file
    // implies its parent directory exists, so `dirOf(place.path)` is equivalent
    // to `nookSceneOfPath(place.path, nookLayers)` but needs no tree build.
    // `dirOf` is the existing pure helper (layers.ts:46) — never a second parser.
    const scene = dirOf(place.path);
    const nookScene = isNookSceneId(scene) ? scene : null;
    const layer = nookScene ?? (await store.resolveLayer(place.path));
    if (layer === null) {
      fail(
        'not_found',
        `"${place.path}" is not on a canvas layer; arrange can only place cards shown on a layer page.`
      );
    }

    // Preserve legacy explicit placement semantics; versioned writes are owned
    // by LocalWorldStore.placeCard and layout uses the strict kernel below.
    await seatDeclaredRows(store, layer, [place.path]);
    // An AGENT's explicit x/y that lands on another card is dropped, so the
    // card keeps the collision-free seat `seatUnplaced` gave it
    //
    // A player's own drop is
    // always honoured — overlapping on purpose is theirs to do.
    const kept = ctx.actor.type !== 'player' && agentPlacementCollides(store, layer, place.path, box);
    if (kept) {
      delete box.x;
      delete box.y;
    }
    const card = Object.keys(box).length > 0
      ? await store.placeCard(layer, place.path, box)
      : store.getLayerCards([place.path])[0]!;
    return {
      text: kept
        ? `Kept "${card.id}" at its seat (${card.x}, ${card.y}) on layer "${layer}": the requested position overlapped another card.`
        : `Placed "${card.id}" at (${card.x}, ${card.y}, z ${card.z}) on layer "${layer}".`,
      details: {
        kind: 'cards',
        action: 'placed',
        layer,
        cards: [{ path: card.id, x: card.x, y: card.y, z: card.z }],
        path: card.id,
      },
    };
  }

  const layout = input.layout!;
  if (!LAYOUT_MODES.includes(layout.mode)) {
    fail('invalid_argument', `arrange: layout mode must be one of ${LAYOUT_MODES.join(', ')}.`);
  }

  let layer = layout.layer;
  let paths = layout.paths;

  // ── Step 0: build the nook tree ONCE (reused by ③/④). Hard prerequisite:
  // `listDirs` MUST be on the `WorldStore` interface (contract §8 P7) — this is
  // why it was added there and not only on `LocalWorldStore`.
  const nookRoot =
    layer !== undefined && characterIdOfPath(layer) !== null ? characterIdOfPath(layer)!
    : paths !== undefined && paths.length > 0 ? characterIdOfPath(paths[0]) ?? null
    : null;
  let nookLayers: Record<string, LayerConfig> = {};
  if (nookRoot !== null) {
    const nookId = nookIdOf(nookRoot)!;
    const dirs = await store.listDirs(nookId);
    const fmByDir = new Map<string, Record<string, any> | null>();
    for (const d of dirs) {
      try {
        fmByDir.set(d, parseFrontmatter(await store.readFile(`${d}/README.md`)).frontmatter);
      } catch {
        fmByDir.set(d, null); // no README → stub scene
      }
    }
    nookLayers = deriveNookLayers(nookId, dirs, (d) => fmByDir.get(d) ?? null);
  }

  // ── ①a Shape gate: a `characters/**` layer that is NOT a valid nookSceneId is
  // 400, NEVER leaked to the whitelist. Missing this, a trailing-slash
  // `characters/elias/office/` falls through to ①b and 404s as "Unknown layer"
  // — a shape error disguised as a missing name.
  if (layer !== undefined && layer.startsWith('characters/') && !isNookSceneId(layer)) {
    fail('invalid_argument', `Nook scene "${layer}" is not a valid nook scene id.`);
  }
  // ── ①b Whitelist: a nook scene id is a SIBLING of layers, not a member of the
  // derived tree (`characters/**` is not a layer, local-store.ts:550-556).
  const layerIsNook = layer !== undefined && isNookSceneId(layer);
  if (layer !== undefined && !layerIsNook) {
    const layers = (await store.getManifest()).layers;
    if (layer !== 'map' && !(layer in layers)) {
      fail('not_found', `Unknown layer "${layer}".`);
    }
  }
  // Existence, same shape as the footprint gate (contract §5.5): a scene that is
  // not a directory is 404, not "an empty scene".
  if (layer !== undefined && layerIsNook && (await store.statKind(layer)) !== 'dir') {
    fail('not_found', `Nook scene "${layer}" has no directory.`);
  }

  // ── ② Page members (when `paths` is omitted). A nook goes through the ONE
  // `nookSceneCards` derivation, same source as `GET /api/nook`; aligned with
  // `pageOfLayer().cards`, both EXCLUDING door signs (door signs are another
  // branch — the design notes §⑨ 9.1 注).
  if (paths === undefined) {
    if (layer === undefined) {
      fail('invalid_argument', 'arrange: a layout without "paths" needs a "layer".');
    }
    paths = layerIsNook
      ? nookSceneCards(layer, await store.listFiles(layer))
      : (await store.pageOfLayer(layer)).cards;
  }

  paths = [...paths].sort((a, b) => a.localeCompare(b)); // deterministic order
  for (const p of paths) assertCardPath(p, 'paths[]');

  // ── ③ Infer the layer from `paths[0]` (only when `layer` was omitted). A nook
  // wins first, and MUST NOT fall back to `layerOfPath` (its `map` fallback
  // would let a `characters/**` path pass as `'map'` — contract §5.3.1).
  if (layer === undefined) {
    if (paths.length === 0) {
      fail('invalid_argument', 'arrange: cannot infer a layer from an empty "paths".');
    }
    const scene = nookSceneOfPath(paths[0], nookLayers);
    const inferred = scene ?? (await store.resolveLayer(paths[0]));
    if (inferred === null) {
      fail(
        'not_found',
        `"${paths[0]}" is not on a canvas layer; arrange can only lay out cards shown on a layer page.`
      );
    }
    layer = inferred;
  }

  for (const p of paths) {
    try {
      await store.readFile(p);
    } catch (err) {
      if (err instanceof ActionError && err.code === 'invalid_path') throw err;
      fail('not_found', `Card not found: "${p}". Use look_at / view_canvas to list the current layer's cards.`);
    }
    // All-or-nothing: a half-reflowed layout is worse than none (doc-09 §3.2).
    // Judged per path (never via the ①-time `layerIsNook`, which may be stale
    // after ③): a path belongs to its OWN scene, so a path from another scene or
    // from another nook still fails here — the check is NOT relaxed for nooks
    //.
    const scene = characterIdOfPath(p) === null ? null : nookSceneOfPath(p, nookLayers);
    const owner = scene ?? (await store.resolveLayer(p));
    if (owner !== layer) {
      fail('not_found', `"${p}" is not on layer "${layer}".`);
    }
  }

  const existing = new Set(store.getLayerCards(paths).map((row) => row.id));
  const seeds: Array<{ path: string; w: number; h: number }> = [];
  for (const p of paths) {
    if (existing.has(p)) continue;
    const { frontmatter } = parseFrontmatter(await store.readFile(p));
    const form = cardFormOf(frontmatter, p.split('/').pop() ?? p);
    seeds.push({ path: p, w: form.w, h: form.h });
  }
  const legacyInput = {
    operationId: `legacy-arrange:${layer}`,
    layer,
    mode: layout.mode,
    expectedRevision: await store.getMaxSeq(),
    expectedCanvasVersion: store.getCanvasVersion(layer),
    snapshotId: '',
    policy: 'deoverlap',
    allowMoveStableCards: true,
    preserveLinks: true,
    paths,
    seeds,
  } as ArrangeCanvasLayerInput & {
    paths: readonly string[];
    seeds: ReadonlyArray<{ path: string; w: number; h: number }>;
  };
  const kernelResult = await arrangeCanvasLayerKernel(store, legacyInput);
  const placed = kernelResult.cards;

  if (placed.length === 0) {
    return {
      text: `Layer "${layer}" has no cards to lay out.`,
      details: { kind: 'cards', action: 'laid-out', layer, cards: [] },
    };
  }

  return {
    text: `Laid out ${placed.length} card(s) on layer "${layer}" in a ${layout.mode}.`,
    details: {
      kind: 'cards',
      action: 'laid-out',
      layer,
      cards: placed.map((c) => ({ path: c.path, x: c.x, y: c.y, z: c.z })),
    },
  };
}

registerAction('linkCards', (ctx, input) => linkCards(ctx, input as unknown as LinkInput));
registerAction('arrangeCards', (ctx, input) => arrangeCards(ctx, input as unknown as ArrangeInput));
registerAction('arrangeCanvas', (ctx, input) => arrangeCanvas(ctx, input as unknown as ArrangeCanvasLayerInput));
