/**
 * doc-03 `look_at` + `view_canvas` — the two read-only eyes.
 *
 * `look_at` is the text eye: "what is here, what does it look like, what can I do
 * with it". `view_canvas` is the composition eye: "does this layer read as a
 * scene". Both read only; neither writes a file, a canvas row, or an event
 * (doc-03 §8: all three admission questions fail, so nothing is appended).
 *
 * The page membership question is NOT answered here — `store.pageOfLayer` wraps
 * `cardsOfLayer` / `childLayers`, the same pair `GET /api/layer` reads, so the
 * agent's text view and the player's canvas can never diverge (doc-03 §4.3).
 */
import type { WorldStore } from '../store/world-store.js';
import {
  cardsOfLayer,
  childLayers,
  deriveLayers,
  dirOfLayer,
  layerOfDir,
  MAP_LAYER,
  WORLD_DIR,
} from '../store/layers.js';
import type { LayerConfig } from '../schemas/world.js';
import { parseFrontmatter } from '../schemas/frontmatter.js';
import { resolveComponentKind } from '../components/registry.js';
import { resolveAppearance } from '../appearance/resolver.js';
import type { AppearanceResolution } from '../schemas/appearance.js';
import { formatInteractiveText } from '../rules/interactive.js';
import { optionStatesOf } from './option-state.js';
import { characterViewOf, projectFrontmatterForCharacter } from '../rules/character-view.js';
import { isHtmlPath, parseHtmlHead } from '../rules/html-head.js';
import { displayItemOf } from '../rules/html-item.js';
import { fail } from './errors.js';
import { registerAction } from './service.js';
import type { ActionContext, ActionResult } from './types.js';
import {
  renderCanvasBlock,
  renderEntityBlock,
  renderLayerBlock,
  type CanvasComposition,
  type LayerItem,
} from '../render/layer-page.js';
import { readCanvasSnapshot, type CanvasSnapshot } from '../render/canvas-snapshot.js';

export interface LookAtInput {
  /**
   * World-relative POSIX path of a single `.md` entity, OR a directory (= a
   * layer / the map / `player` / `characters/<id>`), OR an array of both.
   * Omitted → the caller's current layer (doc-03 §2.1).
   * No leading `./`, no absolute path, no trailing `/` (00 §2.1).
   */
  path?: string | string[];
}

export interface AppearanceDisplaySummary {
  font: string;
  surface: string;
  accent: string;
  ornament: string;
  motion: string;
}

export interface LookAtDetails {
  /** Normalized paths actually resolved, in output order. */
  paths: string[];
  /** Which rendering each entry used. */
  entries: Array<{
    path: string;
    mode: 'entity' | 'directory';
    title: string;
    appearance?: AppearanceDisplaySummary;
    /**
     * H1 / contract §5.4: `parseHtmlHead` diagnostics, `.html` only. Present
     * only when non-empty; the code shape is NOT frozen (M3 §7.3), so no
     * consumer may `switch` on it. Always absent for `.md`.
     */
    diagnostics?: string[];
  }>;
  /** True when at least one entity body was cut by the body cap (doc-03 §5.4). */
  truncated: boolean;
  /** Total characters of `text` — lets a test assert size without re-measuring. */
  textLength: number;
  /** Never present: read-only (01 §4.1). Declared so the type is explicit. */
  event?: never;
}

export interface ViewCanvasInput {
  /** Layer to look at. Omitted → same default chain as look_at (doc-03 §2.1). */
  layer?: string;
  /**
   * 'auto' (default) — structured composition summary (B1's implementation).
   * 'image'          — a real screenshot. Declared legal, NOT implemented in B1
   *                    → ActionError('unsupported', …) (00 §7 anti-pattern 4:
   *                    no silent downgrade). Full plan + cost in doc-03 §6.
   */
  mode?: 'auto' | 'image';
  /** 'image' only: viewport in CSS px. Clamped to [320,2560]×[240,1600]. */
  viewport?: { width: number; height: number };
}
export interface ViewCanvasDetails {
  layer: string;
  /** What actually happened. 'summary' today; 'image' only when a shot was returned. */
  mode: 'summary' | 'image';
  /** Viewport the summary describes / the shot was taken at. */
  viewport: { width: number; height: number };
  /** Composition numbers the summary was rendered from (stable, for probes). */
  items: Array<{ path: string; kind: string; x: number; y: number; w: number; h: number; z: number }>;
  /** Pairs whose boxes intersect — the player sees these stacked. */
  overlaps: Array<[string, string]>;
  /** Items with no row in `canvas.db` yet. */
  unplaced: string[];
  /** Characters on this layer (canvas.db `presence`). */
  presence: Array<{ characterId: string; x: number; y: number; following: boolean }>;
  /** NEW: canonical CanvasSnapshotV1 identity used by arrangement fences. */
  identity: CanvasSnapshot['identity'];
  /** NEW: complete layer rows, including layer and footprint provenance. */
  rows: CanvasSnapshot['rows'];
  /** NEW: canonical unplaced diagnostics; `unplaced` remains the legacy path list. */
  unplacedRows: CanvasSnapshot['unplaced'];
  /** NEW: complete link rows; `links` are not rendered into the legacy summary. */
  links: CanvasSnapshot['links'];
  /** NEW: complete presence rows with freshness evidence. */
  presenceRows: CanvasSnapshot['presence'];
  /** NEW: the current TTL-filtered viewpoint, when available. */
  viewpoint: CanvasSnapshot['viewpoint'];
  /** 'image' only, when implemented (doc-03 §6.3): `.airpworld/eye/<hash>.png`. */
  shot?: string;
  event?: never;
}

/** doc-03 §7.1 row 16: the clamp band for a declared viewport. */
const VIEWPORT_MIN = { width: 320, height: 240 };
const VIEWPORT_MAX = { width: 2560, height: 1600 };
/** The default when a summary runs with no declared viewport (doc-03 §6.1 row 4: the measured shot size). */
const VIEWPORT_DEFAULT = { width: 1440, height: 900 };

/**
 * doc-03 §7.2 layer 2 — the action layer re-checks the path discipline before
 * trusting the store. `resolvePath` is shared code with a known hole until
 * 01 §7.3's tightening lands, and a tool fed by model input must not outsource
 * its own safety.
 */
function assertSafePath(path: string): void {
  if (path === '') fail('invalid_argument', 'Path must not be empty');
  if (path.startsWith('/')) {
    fail('invalid_path', `Path must be world-relative, got "${path}"`);
  }
  if (path.includes('\\') || path.split('/').some((seg) => seg === '..')) {
    fail('invalid_path', `Path must not contain "..", got "${path}"`);
  }
  const first = path.replace(/^\.\//, '').split('/')[0];
  if (first.startsWith('.') || first === 'node_modules') {
    // `.airpworld/assets/**` is the one allowed hidden root (00 §2.5), but no
    // look_at target lives there: it is binary content, not an entity.
    fail('invalid_path', `Path is inside a reserved directory: "${path}"`);
  }
}

const APPEARANCE_DISPLAY_LABELS: Record<string, string> = {
  serif: 'Serif',
  hand: 'Handwritten',
  mono: 'Monospace',
  none: 'Bare',
  paper: 'Paper',
  parchment: 'Parchment',
  iron: 'Iron',
  scroll: 'Scroll',
  panel: 'Panel',
  board: 'Board',
  ink: 'Ink',
  rust: 'Rust',
  blue: 'Blue',
  sage: 'Sage',
  underline: 'Underline',
  seal: 'Seal',
  ribbon: 'Ribbon',
  etched: 'Etched',
  'route-marks': 'Route marks',
  rules: 'Rules',
  ticks: 'Ticks',
  grid: 'Grid',
  still: 'Still',
  calm: 'Calm',
};

function appearanceDisplayOf(resolution: AppearanceResolution): AppearanceDisplaySummary {
  const label = (value: string) => APPEARANCE_DISPLAY_LABELS[value] ?? 'Default';
  return {
    font: label(resolution.values.font),
    surface: label(resolution.values.surface),
    accent: label(resolution.values.accent),
    ornament: label(resolution.values.ornament),
    motion: label(resolution.values.motion),
  };
}

async function appearanceForEntity(
  ctx: ActionContext,
  entityPath: string,
  fm: Record<string, any> | null
): Promise<AppearanceResolution> {
  const manifest = await ctx.store.getManifest();
  const resolvedLayer = await ctx.store.resolveLayer(entityPath);
  const layerId =
    resolvedLayer ??
    (entityPath.startsWith('characters/') ? entityPath.split('/').slice(0, 2).join('/') :
      entityPath.startsWith('player/') ? 'player' : MAP_LAYER);
  let layerMaterial: string | null = null;
  const readmePath = layerId === 'map' ? 'world/README.md' : `${layerId}/README.md`;
  try {
    const readmeFm = parseFrontmatter(await ctx.store.readFile(readmePath)).frontmatter;
    layerMaterial = typeof readmeFm?.material === 'string' ? readmeFm.material : null;
  } catch {
    // Missing README means no layer-local material override.
  }
  const kind = resolveComponentKind(fm, entityPath.split('/').pop() ?? entityPath);
  return resolveAppearance({
    kind,
    entityPath,
    frontmatter: fm,
    context: {
      worldId: manifest.id,
      worldMaterial: typeof manifest.material === 'string' ? manifest.material : null,
      layerId,
      layerMaterial,
    },
  });
}

/** A parsed `.md` file, or a `.html` page, or `null` when the path is not a readable file. */
interface LoadedFile {
  fm: Record<string, any> | null;
  body: string;
  /** H1 / contract §5.4. `.html` only; `undefined` for every other kind. */
  diagnostics?: string[];
}

async function loadFile(ctx: ActionContext, path: string): Promise<LoadedFile | null> {
  if ((await ctx.store.statKind(path)) !== 'file') return null;
  const parsed = parseFrontmatter(await ctx.store.readFile(path));
  return asSeenBy(ctx, path, { fm: parsed.frontmatter, body: parsed.body });
}

/**
 * A character looks at the world as a person in it (rules/character-view.ts):
 * the writer's frontmatter — `intent`, NPC briefs, hidden states, outcomes —
 * never reaches its render. Every other actor sees the file as it is.
 */
function asSeenBy(ctx: ActionContext, path: string, loaded: LoadedFile): LoadedFile {
  if (ctx.actor.type !== 'character') return loaded;
  const own = path.startsWith(`characters/${ctx.actor.id ?? ''}/`);
  return { ...loaded, fm: projectFrontmatterForCharacter(loaded.fm, { own }) };
}

/**
 * H1 / contract §5.3b: the fetch semantics live in `displayItemOf` (shared, the
 * ONE choke point). This adapter only widens its two-key return to `LoadedFile`
 * by adding `diagnostics`, and MUST NOT re-read the file: `raw` is already in
 * hand, and `parseHtmlHead` is pure, so both parses see the same string.
 */
function loadedFrom(path: string, raw: string): LoadedFile {
  const item = displayItemOf(path, raw);
  const diagnostics = isHtmlPath(path) ? parseHtmlHead(raw).diagnostics : [];
  return {
    fm: item.frontmatter,
    body: item.body, // `.html` is always '' (contract §5.1)
    ...(diagnostics.length ? { diagnostics } : {}),
  };
}

/** The fetch point for everything this file renders. Exactly one read per path. */
async function loadedItemOf(ctx: ActionContext, path: string): Promise<LoadedFile | null> {
  if ((await ctx.store.statKind(path)) !== 'file') return null;
  return asSeenBy(ctx, path, loadedFrom(path, await ctx.store.readFile(path)));
}

/** The derived layer map, from one directory scan (doc-03 §5.1 boundary: 03 owns directories). */
async function layerConfigs(ctx: ActionContext): Promise<Record<string, LayerConfig>> {
  const files = await ctx.store.listFiles(WORLD_DIR);
  const dirs = new Set<string>([WORLD_DIR]);
  for (const file of files) {
    const parts = file.split('/');
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
  }
  const fmByDir = new Map<string, Record<string, any> | null>();
  for (const dir of dirs) fmByDir.set(dir, (await loadFile(ctx, `${dir}/README.md`))?.fm ?? null);
  return deriveLayers([...dirs], (dir) => fmByDir.get(dir) ?? null);
}

/** Card boxes by path, for the layout/overlap sections. */
async function boxesOf(ctx: ActionContext, paths: string[]) {
  const rows = ctx.store.getLayerCards(paths);
  return new Map(rows.map((row) => [row.id, { x: row.x, y: row.y, w: row.w, h: row.h, z: row.z }]));
}

/** One file item, with its box attached when `cards` has a row (doc-03 §3.1). */
async function itemOf(
  ctx: ActionContext,
  path: string,
  box: { x: number; y: number; w: number; h: number; z: number } | undefined
): Promise<LayerItem | null> {
  const loaded = await loadedItemOf(ctx, path);
  if (!loaded) return null;
  const item: LayerItem = { path, fm: loaded.fm, body: loaded.body, z: box?.z ?? 0 };
  if (box) item.box = { x: box.x, y: box.y, w: box.w, h: box.h };
  return item;
}

/**
 * B1 default chain (doc-03 §2.1): an omitted path means the player's current
 * layer. The viewpoint row now lives in `canvas.db` (B2 / 05 §2.6) — read it
 * through the store method rather than probing `sqlite_master` here. No row,
 * an empty row, or an expired one all degrade to `map`, which is what the old
 * probe did when the table was absent.
 */
async function resolveDefaultLayer(ctx: ActionContext): Promise<string> {
  return ctx.store.readViewpoint()?.layer || MAP_LAYER;
}

/** The entity block: path, title, body, then 06's interactive text (doc-03 §4.1). */
async function renderEntity(
  ctx: ActionContext,
  path: string
): Promise<{
  text: string;
  truncated: boolean;
  appearance?: AppearanceDisplaySummary;
  diagnostics?: string[];
}> {
  const loaded = await loadedItemOf(ctx, path);
  if (!loaded) fail('not_found', `Nothing at "${path}" in this world`);
  // Contract §6.5 rule 3: the description IS the body position, and
  // `renderEntityBlock` reads the `body` ARGUMENT — not `fm.preview` (only
  // `summaryOf` prefers `preview`). The fetch layer still returns `body: ''`
  // for `.html` (contract §5.1), so the page source never travels here; this
  // one line is the only place the virtual fm's `preview` becomes body text.
  const body = isHtmlPath(path) ? String(loaded.fm?.preview ?? '') : loaded.body;
  const done = new Set((await optionStatesOf(ctx.store, [{ path, frontmatter: loaded.fm }]).catch(() => ({} as Record<string, { done: string[] }>)))[path]?.done ?? []);
  const rendered = renderEntityBlock(path, loaded.fm, body, formatInteractiveText(loaded.fm, done));
  // H1 §5.4: diagnostics ride in `details` only. `text` comes from
  // `renderEntityBlock`, whose four arguments do not include them — so the body
  // position structurally CANNOT print a diagnostic.
  const withDiagnostics = {
    ...rendered,
    ...(loaded.diagnostics?.length ? { diagnostics: loaded.diagnostics } : {}),
  };
  if (!loaded.fm || !Object.prototype.hasOwnProperty.call(loaded.fm, 'appearance')) {
    return withDiagnostics;
  }
  const appearance = appearanceDisplayOf(await appearanceForEntity(ctx, path, loaded.fm));
  return {
    ...withDiagnostics,
    text: `${withDiagnostics.text}\n\nAppearance: font=${appearance.font}; surface=${appearance.surface}; accent=${appearance.accent}; ornament=${appearance.ornament}; motion=${appearance.motion}`,
    appearance,
  };
}

/** The directory block: this layer's files + its direct child doors (doc-03 §4.2). */
async function renderDirectory(ctx: ActionContext, dir: string): Promise<string> {
  const layerId = layerOfDir(dir);
  const allFiles = await ctx.store.listFiles(WORLD_DIR);
  const layers = await layerConfigs(ctx);
  const cardPaths = cardsOfLayer(layerId, allFiles);
  const doorPaths = childLayers(layerId, layers).map((child) => `${child}/README.md`);
  const boxes = await boxesOf(ctx, [...cardPaths, ...doorPaths]);

  const cards: LayerItem[] = [];
  for (const cardPath of cardPaths) {
    const item = await itemOf(ctx, cardPath, boxes.get(cardPath));
    if (item) cards.push(item);
  }
  const doors: LayerItem[] = [];
  for (const doorPath of doorPaths) {
    const loaded = await loadFile(ctx, doorPath);
    if (!loaded) {
      // Stub layer: the door exists, the scene does not (doc-03 §4.2 rule 4).
      const item: LayerItem = { path: doorPath, fm: null, body: '', z: 0 };
      const box = boxes.get(doorPath);
      if (box) item.box = { x: box.x, y: box.y, w: box.w, h: box.h };
      doors.push(item);
      continue;
    }
    const item: LayerItem = { path: doorPath, fm: loaded.fm, body: loaded.body, z: 0 };
    const box = boxes.get(doorPath);
    if (box) item.box = { x: box.x, y: box.y, w: box.w, h: box.h };
    doors.push(item);
  }

  const config = layers[layerId];
  return renderLayerBlock({
    layerId,
    dir,
    layerName: config?.name ?? dir.split('/').pop() ?? layerId,
    stub: config?.stub === true,
    cards,
    doors,
    readmeFm: (await loadFile(ctx, `${dir}/README.md`))?.fm ?? null,
  });
}

export async function lookAt(ctx: ActionContext, input: LookAtInput): Promise<ActionResult<LookAtDetails>> {
  const raw = input?.path;
  if (Array.isArray(raw) && raw.length === 0) {
    fail('invalid_argument', 'Cannot look at an empty path list');
  }
  const targets =
    raw === undefined ? [await resolveDefaultLayer(ctx)] : Array.isArray(raw) ? [...raw] : [raw];

  // Deduplicate while preserving order: a repeated path must not print twice
  // (doc-03 §3.1 step 1 — the same discipline 10 §3.2 step 1 applies).
  const ordered: string[] = [];
  for (const target of targets) {
    const targetPath = String(target).replace(/\/+$/, '');
    assertSafePath(targetPath);
    if (!ordered.includes(targetPath)) ordered.push(targetPath);
  }

  const blocks: string[] = [];
  const entries: LookAtDetails['entries'] = [];
  let truncated = false;

  for (const targetPath of ordered) {
    const kind = await ctx.store.statKind(targetPath);
    if (kind === 'missing') fail('not_found', `Nothing at "${targetPath}" in this world`);
    if (ctx.actor.type === 'character') {
      const view = characterViewOf(targetPath, ctx.actor.id ?? '');
      if (view.kind === 'withheld') fail('invalid_path', `"${targetPath}" is not something you can see: ${view.reason}`);
    }
    if (kind === 'dir') {
      const text = await renderDirectory(ctx, targetPath);
      blocks.push(text);
      entries.push({ path: targetPath, mode: 'directory', title: text.split('\n')[1] ?? targetPath });
      continue;
    }
    const rendered = await renderEntity(ctx, targetPath);
    if (rendered.truncated) truncated = true;
    blocks.push(rendered.text);
    entries.push({
      path: targetPath,
      mode: 'entity',
      title: rendered.text.split('\n')[1] ?? targetPath,
      ...(rendered.appearance ? { appearance: rendered.appearance } : {}),
      ...(rendered.diagnostics?.length ? { diagnostics: rendered.diagnostics } : {}),
    });
  }

  const text = blocks.join('\n\n');
  return { text, details: { paths: ordered, entries, truncated, textLength: text.length } };
}

/** doc-03 §7.1 row 16: clamp, never fail. */
function clampViewport(viewport?: { width: number; height: number }): { width: number; height: number } {
  if (!viewport) return { ...VIEWPORT_DEFAULT };
  const width = Math.min(Math.max(Math.round(viewport.width), VIEWPORT_MIN.width), VIEWPORT_MAX.width);
  const height = Math.min(
    Math.max(Math.round(viewport.height), VIEWPORT_MIN.height),
    VIEWPORT_MAX.height
  );
  return { width, height };
}


export async function viewCanvas(
  ctx: ActionContext,
  input: ViewCanvasInput
): Promise<ActionResult<ViewCanvasDetails>> {
  if (input?.mode === 'image') {
    fail(
      'unsupported',
      'view_canvas image mode is not implemented in B1; use mode "auto" for a structured composition summary'
    );
  }

  const rawLayer = input?.layer;
  const snapshot = await readCanvasSnapshot(ctx.store, { layer: rawLayer });
  const layerId = snapshot.layer.id;
  const dir = snapshot.layer.dir;
  const viewport = clampViewport(input?.viewport);
  const rowByPath = new Map(snapshot.rows.map((row) => [row.path, row]));
  const pagePaths = [...snapshot.rows.map((row) => row.path), ...snapshot.unplaced.map((row) => row.path)];
  const items: LayerItem[] = [];
  for (const cardPath of pagePaths) {
    const loaded = await loadedItemOf(ctx, cardPath);
    const row = rowByPath.get(cardPath);
    const item: LayerItem = {
      path: cardPath,
      fm: loaded?.fm ?? null,
      body: loaded?.body ?? '',
      z: row?.z ?? 0,
    };
    if (row) item.box = { x: row.x, y: row.y, w: row.w, h: row.h };
    items.push(item);
  }

  const composition: CanvasComposition = {
    layerId,
    dir,
    layerName: snapshot.layer.name,
    stub: snapshot.layer.stub,
    readmeFm: (await loadFile(ctx, `${dir}/README.md`))?.fm ?? null,
    items,
    links: snapshot.links.map((link) => ({
      from: link.from,
      to: link.to,
      style: link.style,
      label: link.label,
    })),
    presence: snapshot.presence.map(({ characterId, x, y, following }) => ({
      characterId,
      x,
      y,
      following,
    })),
    viewport,
  };

  return {
    text: renderCanvasBlock(composition),
    details: {
      layer: layerId,
      mode: 'summary',
      viewport,
      items: snapshot.rows.map((row) => ({
        path: row.path,
        kind: row.kind,
        x: row.x,
        y: row.y,
        w: row.w,
        h: row.h,
        z: row.z,
      })),
      overlaps: snapshot.overlaps,
      unplaced: snapshot.unplaced.map((row) => row.path),
      presence: snapshot.presence.map(({ characterId, x, y, following }) => ({
        characterId,
        x,
        y,
        following,
      })),
      identity: snapshot.identity,
      rows: snapshot.rows,
      unplacedRows: snapshot.unplaced,
      links: snapshot.links,
      presenceRows: snapshot.presence,
      viewpoint: snapshot.viewpoint,
    },
  };
}

registerAction('lookAt', (ctx, input) => lookAt(ctx, input as unknown as LookAtInput));
registerAction('viewCanvas', (ctx, input) => viewCanvas(ctx, input as unknown as ViewCanvasInput));
