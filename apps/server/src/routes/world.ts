import { Router } from 'express';
import { readWorldShelf, worldCover, worldIntroAvatar, trashWorldSave, ShelfError } from '../world-shelf.js';
import { createCoverPainter, createWorkshopWorld, isAuthoringWorld, parseCreateWorldInput, parseSuggestFormInput, publishWorkshopWorld, suggestWorldForm, unpublishWorkshopWorld, worldCopyFilter, WorkshopError } from '../world-workshop.js';
import type { Response } from 'express';
import fs from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { catchUpOnOpen, deliverReturnDigest } from '../living-return.js';
import { readWorldSettings, updateWorldSettings } from '../engine/world-settings.js';
import { readOpening, writeOpening } from '../engine/opening.js';
import { playHistoryOf, resetPlayState } from '../world-play-reset.js';
import { introStateOf, parseIntroFields, suggestIntroFields, writeIntroShown, writePlayerIntro } from '../world-intro.js';
import { parseReplySuggestBody, suggestReplies } from '../reply-suggest.js';
import { publishedRoot, resolveWorldPath, worldsRoot } from '../engine/user-root.js';
import { fileHash, knownFileHash, mediaCacheControl, warmHashes, worldAssetIndex } from '../asset-hash.js';
import { runDeclaredChoice, runDeclaredRoll, serialDeclared, prepareMaterialReview } from '../engine/declared-actions.js';
import {
  ActionError,
  AgentModelSelectionSchema,
  WorldSettingsPatchSchema,
  startsChoiceTurn,
  LocalWorldStore,
  SEAT_ANCHOR,
  boxSizeOf,
  dirOfLayer,
  EMOTIONS,
  emotionPortraitsOf,
  createActionService,
  initializeMissingCharacterPresence,
  isValidCharacterId,
  listBackpack,
  nookCardPaths,
  isValidNookScenePath,
  isNookSceneId,
  nookSceneCards,
  deriveNookLayers,
  nookSceneDoors,
  nookIdOf,
  NookNoteInputSchema,
  NookNoteOutcomeSchema,
  writeNookNote,
  parsePlayerNoteInput,
  parsePlayerBoardInput,
  writePlayerNote,
  updatePlayerBoard,
  playerBoardForLayer,
  parseFrontmatter,
  optionStatesOf,
  displayItemOf,
  cardFormOf,
  cardKindOf,
  componentDefOf,
  resolveAppearance,
  sanitiseForBlock,
  assertAssetReference,
  assertWorldFileReference,
  type Actor,
  type CardRecord,
  type SeatFile,
  type ViewRect,
  isQuietAudioValue,
  musicTrack,
  platformAudioFallback,
  playersMayCreate,
  worldCategoryIdOf,
  prepareLoop,
  prepareRun,
  runTurnEnd,
  inspire,
  runTickBeat,
  markTickIntentSeen,
  readTickView,
  characterTickMode,
  characterVoicesOn,
  planTickPrefetch,
  hintDueNow,
  characterFormOf,
} from '@airp/shared';
import { createTickModelHost } from '../tick-model.js';
import type { AgentLifecycleManager } from '../engine/lifecycle.js';
import type { EventBridge } from '../engine/event-bridge.js';
import type { LiveCallRegistry } from '../engine/live-session.js';
import { readAiGateway } from '../ai-gateway.js';
import { syncWorlds } from '../sync/world-sync.js';

interface LayerItem {
  path: string;
  filename: string;
  frontmatter: Record<string, unknown> | null;
  body: string;
}

interface SceneReadme extends LayerItem {
  kind: 'scene';
}

/**
 * One HTTP request = one `turn` anchor.
 *
 * `randomUUID()` and not a counter: the server and every agent process each
 * keep their own counter, so the two would collide. A request id only has to
 * be unique and stable, never ordered.
 */
function serviceFor(store: LocalWorldStore, actor: Actor) {
  return createActionService(store, actor, { turn: `req:${randomUUID()}` });
}

/**
 * ActionError → HTTP; anything else → 500. The status code comes from the ONE
 * table in the design notes (`ActionError.toHttp`); this layer MUST NOT
 * invent its own.
 *
 * The response body is always `{ ok: true, ...details }` or
 * `{ ok: false, code, error }`.
 */
async function reply(
  res: Response,
  run: () => Promise<{ details: Record<string, unknown> }>
): Promise<void> {
  try {
    res.json({ ok: true, ...(await run()).details });
  } catch (err) {
    if (err instanceof ActionError) {
      const http = err.toHttp();
      res.status(http.status).json(http.body);
      return;
    }
    // The store's own no-clobber guard (a concurrent move won the race) is a
    // conflict, not a server fault.
    if ((err as NodeJS.ErrnoException | null)?.code === 'EEXIST') {
      res.status(409).json({ ok: false, code: 'already_exists', error: err instanceof Error ? err.message : String(err) });
      return;
    }
    res.status(500).json({
      ok: false,
      code: 'internal',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * World-write guard.
 *
 * `revision` is the world's event high-water mark (`store.getMaxSeq()`) — the
 * ONE monotonic number the world already publishes, so the guard introduces no
 * second state namespace (00 §2.4): the world files stay the truth, this is a
 * veto, not a shadow copy.
 *
 * A request MAY carry `expectedRevision`. When it does and the world has moved
 * on since, the write is REFUSED with 409 `stale` and the current revision is
 * handed back so the caller can align and retry. A request WITHOUT it is an
 * unconditional write (the agent paths and legacy clients).
 *
 * Both the revision read and the write run INSIDE `serialDeclared`, so two
 * concurrent requests can never observe the same revision and then both append:
 * the "one key opens two locks" replay
 * is closed here rather than in the tools, which own no concurrency state.
 *
 * Every error still goes through `reply` — this only adds the veto and the
 * post-write revision; the ONE status table stays there.
 */
async function worldWrite(
  res: Response,
  store: LocalWorldStore,
  expected: unknown,
  run: () => Promise<{ details: Record<string, unknown> }>
): Promise<void> {
  if (expected !== undefined && (!Number.isInteger(expected) || (expected as number) < 0)) {
    res.status(400).json({ ok: false, code: 'invalid_argument', error: 'expectedRevision must be a non-negative integer' });
    return;
  }
  let current: number | null = null;
  const applied = await serialDeclared(store.worldRoot, async () => {
    const revision = await store.getMaxSeq();
    if (expected !== undefined && expected !== revision) {
      current = revision;
      return false;
    }
    await reply(res, async () => {
      const result = await run();
      return { details: { ...result.details, revision: await store.getMaxSeq() } };
    });
    return true;
  });
  if (!applied) {
    res.status(409).json({
      ok: false,
      code: 'stale',
      error: `The world moved on: expected revision ${String(expected)}, current ${String(current)}. Re-read and retry.`,
      revision: current,
    });
  }
}

/** Deterministic pseudorandom hash (doc-04 §4) - mirror of the frontend lib/camera hashInt. */
function hashInt(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}

/** Integer degrees in [-3, 3], derived per card path, never persisted. */
function rotOf(cardPath: string): number {
  return (hashInt(cardPath) % 7) - 3;
}

/** SHAPE gate only (00 §14.1 rule 4): the value must LOOK like a layer id.
 *  NOT dot-relative like `assertWorldPath` (presence.ts:29) — relative paths are
 *  meaningless outside the action layer. This is NECESSARY, NOT SUFFICIENT: it
 *  does not reject newlines / quotes / backticks / injected prose, and the value
 *  is echoed verbatim into the state block, so every accepted value MUST then
 *  pass `sanitiseForBlock` (00 §14). */
function isPlausibleLayer(layer: string): boolean {
  if (layer === 'map') return true; // MAP_LAYER, store/layers.ts
  if (!layer.startsWith('world/')) return false;
  const segs = layer.split('/');
  return segs.every((s) => s !== '' && s !== '.' && s !== '..');
}

/** Clamp a numeric field, or null when it is not a real finite number.
 *  NOT Nodesign's `Number(v)`: `Number(null)`/`Number('')` are 0 and would let a
 *  null camera component through — 00 §11 requires the whole report be refused. */
function num(v: unknown, min: number, max: number): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return Math.min(max, Math.max(min, v));
}

/** The one NEW browser-direct input on the injection path (00 §5.2). Rejects
 *  the WHOLE report on a malformed camera — a half-believed rect is worse than
 *  none. Every accepted STRING is then folded through `sanitiseForBlock`
 *  (00 §14). `at` is NOT produced here: it is the server clock's stamp (05 §4.1
 *  table's last row), applied by `writeViewpoint`. */
function sanitizeViewpoint(raw: unknown): {
  layer: string;
  focus: ViewRect | null;
  selected: string[];
  bagCount: number;
} | null {
  if (!raw || typeof raw !== 'object') return null;
  const body = raw as Record<string, unknown>;

  const rawLayer = typeof body.layer === 'string' && body.layer.length <= 300 ? body.layer : '';
  if (rawLayer !== '' && !isPlausibleLayer(rawLayer)) return null;
  // Content-level pass (00 §14.1 rules 1-3): fold newlines / control chars /
  // quotes and cap length. The shape gate above is NOT enough (INJ-01).
  const layer = sanitiseForBlock(rawLayer, { maxLength: 300 });

  let focus: ViewRect | null = null;
  if (body.camera !== undefined && body.camera !== null) {
    if (typeof body.camera !== 'object') return null;
    const c = body.camera as Record<string, unknown>;
    const x = num(c.x, -1e6, 1e6);
    const y = num(c.y, -1e6, 1e6);
    const w = num(c.w, 1, 1e5);
    const h = num(c.h, 1, 1e5);
    if (x === null || y === null || w === null || h === null) return null;
    // The wire sends the world-space visible rect's TOP-LEFT. `focus` is the
    // CENTRE in WORLD coords (ViewpointRecord's contract): `camera.x` already
    // equals `cam.x - vw / (2 * z)`, so the centre is x + w / 2.
    focus = { x: x + w / 2, y: y + h / 2, w, h };
  }

  const rawBag = num(body.bagCount, 0, 999);
  const bagCount = rawBag === null ? 0 : Math.trunc(rawBag);

  const selected = (Array.isArray(body.selected) ? body.selected : [])
    .filter((s): s is string => typeof s === 'string' && s.length <= 300)
    .slice(0, 24)
    .map((s) => sanitiseForBlock(s, { maxLength: 300 }));

  return { layer, focus, selected, bagCount };
}

/**
 * DECLARED footprint of a kind — `reseatLayer` judges "was this kind resized in
 * code?" by hashing `kind + w + h`, so `kind` is part of the payload (00 §5.1
 * 第 4 条 / §9 第 8 条). MUST NOT be used for a collision test: since F1 the
 * stored row is the card's real footprint (00 §3.1).
 */
function declaredSizeOf(item: LayerItem): { kind: string; w: number; h: number } {
  const form = cardFormOf(item.frontmatter, item.filename);
  return { kind: cardKindOf(item.frontmatter, item.filename), w: form.w, h: form.h };
}

/**
 * STORED footprint — the row is the truth; declared is only the first-paint
 * default for a card that has no row yet (00 §3.4). This is what `seatUnplaced`
 * seats a brand-new card with, so a long chalk gets a seat that fits it.
 */
function storedSizeOf(
  item: LayerItem,
  row: CardRecord | undefined
): { kind: string; w: number; h: number } {
  const declared = declaredSizeOf(item);
  if (row && (row.w <= 0 || row.h <= 0)) {
    // Degenerate row is corruption, not a normal state: never silent (00 §7).
    console.warn(`/api/layer: card "${item.path}" has a degenerate row (w=${row.w}, h=${row.h}); using the declared form.`);
  }
  const { w, h } = boxSizeOf(row, declared);
  return { kind: declared.kind, w, h };
}

type SeatOrderInput = Pick<SeatFile, 'path' | 'kind' | 'order'>;

function asciiCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function numericPrefixOf(filePath: string): number | null {
  const name = path.basename(filePath);
  const match = /^(\d+)-/.exec(name);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}


function seatStageOf(kind: string | undefined): number {
  if (kind === 'chalk') return 0;
  if (componentDefOf(kind)) return 1;
  return 2;
}

/**
 * Canonical page order for one automatic seating batch. Explicit finite order
 * is authoritative; the remaining files use Chalk/component/other stages,
 * numeric filename prefixes, and finally POSIX path bytes.
 */
function stableSeatOrderOf(files: readonly SeatOrderInput[]): Array<{ path: string; order: number }> {
  const sorted = [...files].sort((a, b) => {
    const stage = seatStageOf(a.kind) - seatStageOf(b.kind);
    if (stage !== 0) return stage;
    const aOrder = Number.isFinite(a.order);
    const bOrder = Number.isFinite(b.order);
    if (aOrder !== bOrder) return aOrder ? -1 : 1;
    if (aOrder && bOrder && a.order !== b.order) return a.order! - b.order!;
    const aPrefix = numericPrefixOf(a.path);
    const bPrefix = numericPrefixOf(b.path);
    if (aPrefix === null && bPrefix !== null) return 1;
    if (aPrefix !== null && bPrefix === null) return -1;
    if (aPrefix !== null && bPrefix !== null && aPrefix !== bPrefix) return aPrefix - bPrefix;
    return asciiCompare(a.path, b.path);
  });
  return sorted.map((file, order) => ({ path: file.path, order }));
}

/**
 * One author-written first-act line: `greeting`,
 * `invites_follow_line` or `arrival_line`.
 *
 * Bounded because it is rendered verbatim into the dock: an accidental
 * thousand-line paste in a README would push the portrait and the input off
 * screen. Blank reads as absent, so an empty key in a template never produces
 * an empty speech bubble.
 */
const FIRST_ACT_LINE_MAX = 400;
function firstActLine(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const line = value.trim();
  return line === '' ? undefined : line.slice(0, FIRST_ACT_LINE_MAX);
}

/**
 * Layer background config from the layer README (doc-10 E0: bg is a README field).
 * `bgStyle` is a NESTED block (templates/holmes-world/world/README.md:6-8); a bare
 * regex on the raw text also matched prose lines, so tone/grain
 * now come from the structured frontmatter. `bg.src` cleaning is unchanged.
 */
function readLayerBg(raw: string): { src: string | null; video?: string; tone: string; grain: string } {
  let src: string | null = null;
  let video: string | undefined;
  let tone = 'warm';
  let grain = 'parchment';
  try {
    const fm = parseFrontmatter(raw).frontmatter;
    const bgValue = fm?.bg;
    if (typeof fm?.bgVideo === 'string' && /\.(mp4|webm)$/i.test(fm.bgVideo)) video = fm.bgVideo;
    if (typeof bgValue === 'string' && bgValue.trim() !== '') {
      // Strip trailing inline comments and quotes (parser keeps them verbatim).
      const cleaned = bgValue.replace(/\s+#.*$/, '').trim().replace(/^["']|["']$/g, '').trim();
      src = cleaned === '' ? null : cleaned;
    }
    if (typeof fm?.bgStyle?.tone === 'string') tone = fm.bgStyle.tone;
    if (typeof fm?.bgStyle?.grain === 'string') grain = fm.bgStyle.grain;
  } catch {
    src = null;
  }
  return { src, ...(video ? { video } : {}), tone, grain };
}

/**
 * Bare-name candidate table, order = priority.
 * Probing is LEVEL-MAJOR: every WORLD-level candidate is tried before any
 * PLATFORM-level one, so a world's private `ambient/pool/X` beats a platform
 * `ambient/X` — world overrides platform.
 */
const AUDIO_POOL: Record<'ambient' | 'bgm', readonly string[]> = {
  ambient: ['ambient/{n}.mp3', 'ambient/pool/{n}.mp3'],
  bgm: ['bgm/{n}.mp3', 'themes/{n}.mp3'],
};

/**
 * `h=<content hash>` on a media URL when the file's hash is already known
 *: world media is hashed when the world loads,
 * platform audio when the router starts. Unknown → the URL as before.
 */
function hashed(url: string, file: string): string {
  const hash = knownFileHash(file);
  return hash ? `${url}&h=${hash}` : url;
}

/**
 * One audio value → URL. Three shapes:
 *   - `assets/…` → direct world-relative file → `/api/asset?path=<enc>&kind=audio` (missing → null)
 *   - a value containing `/` that is NOT `assets/`-prefixed → contract violation:
 *     warn + null (fail-loud, response shape unchanged)
 *   - a bare name → the 5-step override chain: world-level (all candidates, override)
 *     then platform-level (all candidates, fallback); nothing found → null
 */
function resolveAudioRef(
  v: string,
  kind: 'ambient' | 'bgm',
  store: LocalWorldStore,
  audioRoot: string
): string | null {
  const val = v.trim();
  if (val === '') return null;
  // `silence` / `none` (rules/music.ts): declared quiet — never probe a file of that name.
  if (isQuietAudioValue(val)) return null;

  if (val.startsWith('assets/')) {
    const abs = path.resolve(store.worldRoot, val);
    if (abs !== store.worldRoot && !abs.startsWith(store.worldRoot + path.sep)) {
      console.warn('[audio] ref escapes world root:', val);
      return null;
    }
    // A declared-but-absent world path folds to null (declared silence), NOT a
    // frontend fetch failure (which would fall back to synthesis, 00 §7).
    if (!existsSync(abs)) return null;
    return hashed(`/api/asset?path=${encodeURIComponent(val)}&kind=audio`, abs);
  }

  if (val.includes('/')) {
    console.warn('[audio] ref must be a bare pool key or start with assets/:', val);
    return null;
  }

  for (const level of ['world', 'platform'] as const) {
    for (const tpl of AUDIO_POOL[kind]) {
      const cand = tpl.replace('{n}', val);
      if (level === 'world') {
        const abs = path.resolve(store.worldRoot, 'assets/audio', cand);
        if (existsSync(abs)) {
          return hashed(`/api/asset?path=${encodeURIComponent(`assets/audio/${cand}`)}&kind=audio`, abs);
        }
      } else if (existsSync(path.join(audioRoot, cand))) {
        return hashed(`/api/audio?path=${encodeURIComponent(cand)}`, path.join(audioRoot, cand));
      }
    }
  }
  // A platform theme that is not installed here (the open-source copy has no
  // MaouDamashii files) plays its redistributable stand-in instead.
  const fallback = kind === 'bgm' ? musicTrack(val)?.fallback : undefined;
  if (fallback && fallback !== val) return resolveAudioRef(fallback, kind, store, audioRoot);
  return null;
}

/**
 * Translate one README's top-level `ambient` / `bgm` into URLs.
 * Pure translation of THIS file — inheritance across READMEs lives in `/api/layer`.
 */
function readLayerAudio(
  fm: Record<string, any> | null,
  store: LocalWorldStore,
  audioRoot: string
): LayerAudio {
  const out: LayerAudio = { ambient: null, bgm: null };
  for (const kind of ['ambient', 'bgm'] as const) {
    const raw = fm?.[kind];
    if (typeof raw === 'string' && raw.trim() !== '') {
      out[kind] = resolveAudioRef(raw, kind, store, audioRoot);
    }
  }
  // `bgm: silence` (set_music, the design notes): the world theme rests too.
  if (isQuietAudioValue(fm?.bgm)) out.quiet = true;
  return out;
}

/**
 * A layer's audio as the page plays it. `bgm` set → the place's own music and
 * the world theme rests; `quiet` → no music at all; neither → the world theme.
 */
interface LayerAudio { ambient: string | null; bgm: string | null; quiet?: true }

/**
 * Read card files into the route's `LayerItem` (no seat fields yet). Same shape
 * as the inline map in `/api/layer`; used by `/api/nook` so "one md -> one
 * LayerItem" has one definition the nook docs can point at.
 */
async function readLayerItems(store: LocalWorldStore, paths: string[]): Promise<LayerItem[]> {
  return Promise.all(
    paths.map(async (file): Promise<LayerItem> => {
      const raw = await store.readFile(file);
      const { frontmatter, body } = displayItemOf(file, raw);
      return { path: file, filename: path.basename(file), frontmatter, body };
    })
  );
}

/** Read the world/layer material context used by the shared appearance resolver. */
async function appearanceContext(
  store: LocalWorldStore,
  layerId: string
): Promise<{ worldId: string; worldMaterial: string | null; layerId: string; layerMaterial: string | null }> {
  // Appearance context only needs the two world-level leaves. Do not call
  // `getManifest()` here: nook reads are also valid for legacy fixtures whose
  // character records predate the required `home` field, and resolving a card
  // appearance must not turn that unrelated manifest compatibility issue into
  // a 500 response.
  let worldId = path.basename(store.worldRoot);
  let worldMaterial: string | null = null;
  try {
    const raw = JSON.parse(await store.readFile('world.json')) as Record<string, unknown>;
    if (typeof raw.id === 'string' && raw.id.trim() !== '') worldId = raw.id;
    if (typeof raw.material === 'string') worldMaterial = raw.material;
  } catch {
    // The layer can still render with base/kind appearance defaults.
  }
  let layerMaterial: string | null = null;
  const readmePath = layerId === 'map' ? 'world/README.md' : `${layerId}/README.md`;
  try {
    const fm = parseFrontmatter(await store.readFile(readmePath)).frontmatter;
    layerMaterial = typeof fm?.material === 'string' ? fm.material : null;
  } catch {
    // A stub layer/nook has no README and therefore no local material override.
  }
  return { worldId, worldMaterial, layerId, layerMaterial };
}

export function createWorldRouter(
  repoRoot: string,
  lifecycle: AgentLifecycleManager,
  eventBridge: EventBridge,
  getActiveStore: () => LocalWorldStore | null,
  setActiveStore: (store: LocalWorldStore | null) => void,
  // Live calls are torn down with the world:
  // a call points at a character agent inside one specific world root, so it
  // cannot outlive that world. Optional — tests and any caller without a voice
  // channel get a no-op, so this router gains no hard dependency on the registry.
  liveCalls: Pick<LiveCallRegistry, 'closeAll'> = { closeAll: async () => {} }
): Router {
  const router = Router();
  // Character tick v2: the model behind 「角色自己说话」 (tick-model.ts). Re-reads its config per call.
  const tickModels = createTickModelHost();
  // World-shelf operation gate. A load/delete intentionally detaches the store
  // before it attaches the replacement (see the load route), so a world-scoped
  // request landing mid-swap must WAIT for it. `no_active_world` is a durable
  // state — the player picks a world — and answering it transiently makes the
  // client tear down a world that is still arriving.
  let shelfBusy = false;
  // Resolved when the in-flight shelf operation settles. Starts resolved so the
  // gate stays a no-op while idle.
  let shelfSettled: Promise<void> = Promise.resolve();
  let settleShelf: (() => void) | null = null;
  const beginShelfOperation = (): void => {
    shelfBusy = true;
    shelfSettled = new Promise<void>((resolve) => { settleShelf = resolve; });
  };
  const endShelfOperation = (): void => {
    shelfBusy = false;
    settleShelf?.();
    settleShelf = null;
  };
  let releasingWorld: Promise<void> | null = null;
  router.use(async (req, res, next) => {
    const store = getActiveStore();
    if (store && !existsSync(path.join(store.worldRoot, 'world.json'))) {
      // Every later world-scoped request answers no_active_world: say why, once.
      console.warn(`[AIRP Server] Active world detached: ${path.relative(repoRoot, store.worldRoot)}/world.json is gone (on ${req.method} ${req.path})`);
      setActiveStore(null);
      eventBridge.close();
      // Fire-and-forget on the 409 path: this branch must return quickly
      //, and
      // `closeAll` may await socket teardown. Its own errors are swallowed.
      void liveCalls.closeAll().catch(() => {});
      releasingWorld = lifecycle.stopAll().finally(() => { store.close(); releasingWorld = null; });
    }
    if (releasingWorld) {
      try { await releasingWorld; } catch { /* The unavailable world stays detached. */ }
    }
    const needsWorld = ['/agent-settings', '/manifest', '/nook', '/nook-note', '/player-note', '/player-board', '/layer', '/backpack', '/characters', '/following', '/move', '/card/position', '/card/footprint', '/dice', '/skill-check', '/inspiration', '/use-item', '/choice', '/material-review', '/enter-layer', '/viewpoint', '/freeze', '/god-action', '/snapshot', '/rollback', '/asset', '/asset-index', '/audio', '/world-file', '/opening', '/world-intro', '/world-intro/suggest', '/replies/suggest', '/npc/talk', '/tick', '/tick/seen', '/tick/guard', '/tick/prefetch'].includes(req.path);
    if (needsWorld && shelfBusy) await shelfSettled;
    if (!getActiveStore() && needsWorld) {
      return res.status(409).json({ code: 'no_active_world', error: 'Choose a world or start a new save.' });
    }
    next();
  });
  router.get('/agent-settings', async (req, res) => {
    const store = getActiveStore();
    if (!store) { res.status(409).json({ error: 'Load a world first.' }); return; }
    try { res.json(await lifecycle.modelStatus(store.worldRoot, req.query.brief !== 'true')); }
    // `agent_starting`: the agents are (re)starting (a world load, a crash restart, a busy writer):
    // the page says "the characters are starting" instead of reading it as disconnected.
    catch (error) { res.status(503).json({ code: 'agent_starting', error: error instanceof Error ? error.message : 'Agent unavailable.' }); }
  });
  router.post('/agent-settings', async (req, res) => {
    const store = getActiveStore();
    if (!store) { res.status(409).json({ error: 'Load a world first.' }); return; }
    const parsed = AgentModelSelectionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid model settings.' }); return;
    }
    const { role, provider, model, thinking, world } = parsed.data;
    if (world !== store.worldRoot) { res.status(409).json({ error: 'The active world changed. Reopen model settings.' }); return; }
    try { res.json(await lifecycle.changeModel(store.worldRoot, role, { provider, model, thinking })); }
    catch (error) { res.status(409).json({ error: error instanceof Error ? error.message : 'Could not change models.' }); }
  });
  // Per-world auto-write preference. GET returns the stored
  // value (defaults when absent); POST validates and writes. The route is the
  // ONLY writer of `<worldRoot>/.airpworld/settings.json`, so the client and the
  // `/choice` auto-turn gate below always read the same value.
  router.get('/world-settings', (_req, res) => {
    const store = getActiveStore();
    if (!store) { res.status(409).json({ error: 'Load a world first.' }); return; }
    res.json({ world: store.worldRoot, ...readWorldSettings(store.worldRoot) });
  });
  // Body is a PATCH: `WorldSettingsPatchSchema` accepts
  // a subset of the fields, and `updateWorldSettings` merges it over what is on
  // disk. Whole-object overwrite would reset every field the caller omitted.
  router.post('/world-settings', (req, res) => {
    const store = getActiveStore();
    if (!store) { res.status(409).json({ error: 'Load a world first.' }); return; }
    const parsed = WorldSettingsPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid world settings.' }); return;
    }
    const next = updateWorldSettings(store.worldRoot, parsed.data);
    res.json({ world: store.worldRoot, ...next });
  });
  // Has this save had its first act yet? A marker beside the
  // save, not a world file and not an event: the greeting is a DISPLAY, so
  // remembering that it played must not look like world history.
  router.get('/opening', (_req, res) => {
    const store = getActiveStore();
    if (!store) { res.status(409).json({ error: 'Load a world first.' }); return; }
    res.json({ world: store.worldRoot, ...readOpening(store.worldRoot) });
  });
  // `{ shown: true }` after the opening runs; `{ shown: false }` is the replay
  // control in the settings panel. One key, so the body cannot grow into state.
  router.post('/opening', (req, res) => {
    const store = getActiveStore();
    if (!store) { res.status(409).json({ error: 'Load a world first.' }); return; }
    const shown = (req.body as { shown?: unknown } | null)?.shown;
    if (typeof shown !== 'boolean') {
      res.status(400).json({ ok: false, code: 'invalid_argument', error: 'shown must be a boolean' });
      return;
    }
    res.json({ world: store.worldRoot, ...writeOpening(store.worldRoot, shown) });
  });
  // The first-entry intro of a workshop world: the
  // world's logic in a few deterministic sentences, three setup answers saved
  // to player/README.md, and a once-per-save marker beside the save.
  router.get('/world-intro', async (_req, res) => {
    const store = getActiveStore();
    if (!store) { res.status(409).json({ error: 'Load a world first.' }); return; }
    try {
      const manifest = JSON.parse(await fs.readFile(path.join(store.worldRoot, 'world.json'), 'utf8')) as Record<string, unknown>;
      res.json({ world: store.worldRoot, ...introStateOf(store.worldRoot, manifest), canSuggest: Boolean(process.env.DEEPSEEK_API_KEY?.trim() || readAiGateway()) });
    } catch (err) {
      res.status(500).json({ ok: false, code: 'internal', error: err instanceof Error ? err.message : String(err) });
    }
  });
  router.post('/world-intro', async (req, res) => {
    const store = getActiveStore();
    if (!store) { res.status(409).json({ error: 'Load a world first.' }); return; }
    try {
      const fields = parseIntroFields(req.body);
      const manifest = JSON.parse(await fs.readFile(path.join(store.worldRoot, 'world.json'), 'utf8')) as Record<string, unknown>;
      if (Object.values(fields).some(Boolean)) writePlayerIntro(store.worldRoot, fields, manifest.locale);
      writeIntroShown(store.worldRoot, true);
      res.json({ ok: true, shown: true, fields });
    } catch (err) {
      workshopFailure(res, err);
    }
  });
  router.post('/world-intro/suggest', async (req, res) => {
    const store = getActiveStore();
    if (!store) { res.status(409).json({ error: 'Load a world first.' }); return; }
    try {
      const fields = parseIntroFields(req.body);
      const manifest = JSON.parse(await fs.readFile(path.join(store.worldRoot, 'world.json'), 'utf8')) as Record<string, unknown>;
      res.json({ ok: true, ...(await suggestIntroFields(manifest, fields)) });
    } catch (err) {
      workshopFailure(res, err);
    }
  });
  // 「再生成一批」: a fresh batch of lines to say to one character or NPC. One cheap text-model
  // call; a trial guest has no text model here (503 no_text_model) and the page greys the chip out.
  router.post('/replies/suggest', async (req, res) => {
    const store = getActiveStore();
    if (!store) { res.status(409).json({ error: 'Load a world first.' }); return; }
    try {
      res.json({ ok: true, lines: await suggestReplies(store, parseReplySuggestBody(req.body)) });
    } catch (err) {
      workshopFailure(res, err);
    }
  });
  const dispatch = (store: LocalWorldStore, prompt: string) => {
    void lifecycle.submitWriter(store.worldRoot, prompt).catch(error => {
      eventBridge.broadcast({ type: 'error', source: 'writer', message: error instanceof Error ? error.message : String(error), savePath: store.worldRoot });
    });
  };
  let worldFrozen = false;
  // Platform audio root: <REPO_ROOT>/assets/audio. `repoRoot` (index.ts:15) is the
  // repo root in both dev and prod, so this always points at the 31 produced clips.
  const AUDIO_ROOT = path.resolve(repoRoot, 'assets/audio');
  // Hash the platform clips once, in the background, so the audio resolver can
  // put `h=` on their URLs. Until it finishes the
  // URLs simply go out without it.
  void warmHashes(AUDIO_ROOT).catch(() => 0);
  const clientManifest = async (store: LocalWorldStore) => {
    const manifest = await store.getManifest();
    const key = manifest.audio?.theme;
    const theme = typeof key === 'string' && key.trim() ? resolveAudioRef(key, 'bgm', store, AUDIO_ROOT) : null;
    // `authoring`: this save is the author's own workshop original, so the
    // client shows the creator guide and the writer gets the building brief
    //. Decided here, where the directory is known.
    // The debrief's answer key never reaches the
    // page: questions arrive through `GET /api/world/run` once an ending exists.
    const { mysteries: _mysteries, reckoning: _reckoning, ...visible } = manifest;
    // `hints`: the world carries a companion hint table — the page then sends a beat after each move.
    const hints = await store.statKind('hints.json').then((k) => k === 'file', () => false);
    return { ...visible, audio: { theme }, authoring: isAuthoringWorld(store.worldRoot, manifest as Record<string, unknown>), hints };
  };


  // List available templates and worlds
  router.get('/worlds', async (_req, res) => {
    try {
      res.json(await readWorldShelf(repoRoot, getActiveStore()?.worldRoot));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // The save the server has open, as `/api/worlds/load` names it (`path`), or
  // null. The launcher's 「继续这个故事」 asks before closing: a reloaded page
  // shows this world without having selected its save, and another tab may
  // have opened another one (apps/web/src/lib/world-reopen.ts).
  router.get('/worlds/active', (_req, res) => {
    res.json({ ok: true, path: getActiveStore()?.worldRoot ?? null });
  });

  // Launcher covers: a world's cover image, read-only
  // and independent of the active world (`/asset` serves only that). `id` names
  // a template; `save` a made world in the current user's root; `published` a
  // published workshop world.
  router.get('/worlds/cover', async (req, res) => {
    const kind = req.query.kind === 'video' ? 'video' : 'image';
    const [scope, id] = typeof req.query.save === 'string' ? ['save', req.query.save] as const
      : typeof req.query.published === 'string' ? ['published', req.query.published] as const
      : ['template', req.query.id] as const;
    const file = await worldCover(repoRoot, id, kind, scope).catch(() => null);
    if (!file) return res.status(404).json({ ok: false, code: 'not_found', error: 'No cover for this world.' });
    // A made world's cover can be replaced by its author; templates never change at runtime.
    // A URL carrying the cover's content hash is immutable.
    const fallback = scope === 'template' ? 'public, max-age=3600' : 'private, max-age=60';
    const actual = typeof req.query.h === 'string' ? await fileHash(file) : null;
    res.set('Cache-Control', mediaCacheControl(req.query.h, actual, scope === 'template' ? 'public' : 'private', fallback)!);
    res.sendFile(file, (err) => {
      if (err && !res.headersSent) res.status(404).json({ ok: false, code: 'not_found', error: err.message });
    });
  });

  // Lobby card portraits: who you meet in a world, shown
  // before it is opened. `id` names a template, `published` a published world;
  // `n` is the cast member's index on the card. Read-only, like covers.
  router.get('/worlds/intro-avatar', async (req, res) => {
    const [scope, id] = typeof req.query.published === 'string' ? ['published', req.query.published] as const : ['template', req.query.id] as const;
    const file = await worldIntroAvatar(repoRoot, id, req.query.n, scope).catch(() => null);
    if (!file) return res.status(404).json({ ok: false, code: 'not_found', error: 'No portrait.' });
    const actual = typeof req.query.h === 'string' ? await fileHash(file) : null;
    res.set('Cache-Control', mediaCacheControl(req.query.h, actual, 'public', 'public, max-age=3600')!);
    res.sendFile(file, (err) => {
      if (err && !res.headersSent) res.status(404).json({ ok: false, code: 'not_found', error: err.message });
    });
  });

  const workshopFailure = (res: Response, err: unknown) => {
    if (err instanceof WorkshopError) return res.status(err.status).json({ ok: false, code: err.code, error: err.message });
    res.status(500).json({ ok: false, code: 'internal', error: err instanceof Error ? err.message : String(err) });
  };

  // The workshop. Making a world writes a NEW save
  // directory and touches neither the active store nor the shelf lock: painting
  // a cover can take a minute, and loading or deleting other saves meanwhile is
  // fine. The client loads the result through `/worlds/load` like any save.
  router.post('/worlds/create', async (req, res) => {
    try {
      const input = parseCreateWorldInput(req.body);
      const made = await createWorkshopWorld(repoRoot, input, createCoverPainter());
      res.json({ ok: true, ...made });
      // A 云端 world goes up right away; signed out, it waits for the next pass.
      if (input.location === 'cloud') void syncWorlds(repoRoot, { activeStore: getActiveStore }, made.worldPath).catch(() => null);
    } catch (err) {
      workshopFailure(res, err);
    }
  });
  router.get('/worlds/create/config', (_req, res) => {
    // Readiness only: whether a cover can be painted / the form filled in here, never which key.
    res.json({
      ok: true,
      canPaint: createCoverPainter() !== null && Boolean(process.env.OPENAI_API_KEY?.trim() || readAiGateway()),
      canSuggest: Boolean(process.env.DEEPSEEK_API_KEY?.trim() || readAiGateway()),
    });
  });
  // 一键补完: the text model fills whatever the author left blank, the way the
  // world-workshop skill will later expect it.
  router.post('/worlds/create/suggest', async (req, res) => {
    try {
      res.json({ ok: true, ...(await suggestWorldForm(parseSuggestFormInput(req.body))) });
    } catch (err) {
      workshopFailure(res, err);
    }
  });
  router.post('/worlds/publish', async (req, res) => {
    try {
      res.json(await publishWorkshopWorld(repoRoot, req.body?.worldPath));
    } catch (err) {
      workshopFailure(res, err);
    }
  });
  router.post('/worlds/unpublish', async (req, res) => {
    try {
      res.json(await unpublishWorkshopWorld(repoRoot, req.body?.worldPath));
    } catch (err) {
      workshopFailure(res, err);
    }
  });

  // Load a world
  router.post('/worlds/load', async (req, res) => {
    if (lifecycle.isModelSwitching()) return res.status(409).json({ error: 'Wait for model settings to finish applying.' });
    if (shelfBusy) return res.status(409).json({ error: 'A world operation is in progress.' });
    beginShelfOperation();
    let store: LocalWorldStore | null = null;
    let characterTransitionStarted = false;
    try {
      const { worldPath } = req.body;
      // `fresh: true` asks for a new game of a world that has no template: the
      // author's own draft (a workshop original), played as a copy so the draft
      // itself is never played in place. Templates and published worlds are
      // always fresh copies anyway; any other save refuses the flag.
      const fresh = req.body?.fresh === true;
      // `worlds/<id>` is an ID, not a location: it resolves inside the CURRENT
      // user's save root, so two players may hold the same
      // save id in different directories. Templates stay shared.
      let resolvedPath = resolveWorldPath(repoRoot, worldPath);
      // Validate before copying or closing the current store. Never recreate a deleted save.
      const loadedManifest = JSON.parse(await fs.readFile(path.join(resolvedPath, 'world.json'), 'utf8')) as Record<string, unknown>;
      const templatesRoot = path.join(repoRoot, 'templates') + path.sep;
      // A published workshop world is played like a template: as a fresh copy
      // in the player's own root, never in place.
      const publishedDir = publishedRoot(repoRoot) + path.sep;
      const isTemplateLike = resolvedPath.startsWith(templatesRoot) || resolvedPath.startsWith(publishedDir);
      if (fresh && !isTemplateLike && !isAuthoringWorld(resolvedPath, loadedManifest)) {
        return res.status(400).json({ error: 'Only a template, a published world or your own draft can start a new game.' });
      }
      if (isTemplateLike || fresh) {
        const playPath = path.join(worldsRoot(repoRoot), `${path.basename(resolvedPath)}-${randomUUID().slice(0, 8)}`);
        // 试玩: a draft's play copy is the draft's
        // latest content at its opening. Its moves / swaps are read from the
        // draft's history BEFORE copying (the copy has none of its own).
        const trial = fresh && !isTemplateLike;
        const history = trial ? await playHistoryOf(resolvedPath, getActiveStore()) : null;
        // Runtime state (history DB, sessions) never travels with a template
        // copy; generated pictures (`.airpworld/assets`) do — see `worldCopyFilter`.
        await fs.cp(resolvedPath, playPath, { recursive: true, filter: worldCopyFilter(resolvedPath) });
        if (history) {
          try {
            const report = await resetPlayState(playPath, { history, dropRuntime: true });
            if (report.unresolved.length) console.warn('[Trial] play traces left in the copy:', report.unresolved);
          } catch (error) {
            // A half-reset copy must not appear on the shelf as a save.
            await fs.rm(playPath, { recursive: true, force: true });
            throw error;
          }
        }
        // A new run draws its variants: the seed and the
        // picked options land in the copy's world/README.md, the unpicked overlays
        // are deleted. A no-op for a world without `variants`. AIRP_RUN_SEED pins
        // the seed for a reproducible local run.
        try {
          await prepareRun(playPath, { seed: process.env.AIRP_RUN_SEED });
          // A looping world's starting point: after the
          // variant draw, so every loop of this run plays the same truth.
          await prepareLoop(playPath);
        } catch (error) {
          await fs.rm(playPath, { recursive: true, force: true });
          throw error;
        }
        resolvedPath = playPath;
      }
      // One line per switch: the server holds ONE active world, so every other
      // connected tab is about to be reset to that world's entry layer. The
      // log is how "my scene jumped back on its own" gets traced to a second
      // tab or another session loading a save.
      console.log(`[AIRP Server] Loading world: ${path.relative(repoRoot, resolvedPath)}`);
      lifecycle.beginWorldTransition();
      characterTransitionStarted = true;

      worldFrozen = false;
      // Hang up every live call before the character agents go away, so no
      // sideband survives into the next world.
      await liveCalls.closeAll();
      await lifecycle.stopCharacters();

      const current = getActiveStore();
      if (current) {
        // Session-end snapshot point (doc-07 C4 / doc-16 §3): the world being
        // left behind gets a restore point. Best effort — a snapshot failure
        // must never block loading the next world.
        await serviceFor(current, { type: 'engine' })
          .snapshotWorld({ reason: 'session end' })
          .catch((err) => console.warn('[Snapshot Warning]', err instanceof Error ? err.message : String(err)));
        eventBridge.close?.();
        current.close();
        // Detach before any later request can hit the closed database while the
        // replacement store is being reconciled.
        setActiveStore(null);
      }

      // Reconcile missing character presence before activating the store or
      // starting its event tail. Initial positions come from manifest home and
      // are written through the existing move action only.
      // An older save of a looping world gets its loop-start snapshot the first
      // time it is opened (a no-op when it has one, or the world does not loop).
      await prepareLoop(resolvedPath).catch((err) => console.warn('[Loop] no loop-start snapshot:', err instanceof Error ? err.message : String(err)));
      store = new LocalWorldStore(resolvedPath);
      await initializeMissingCharacterPresence(store, { turn: `init:${randomUUID()}` });
      // A living world lets the time the player was away pass before anyone
      // looks; every other world: a no-op.
      const catchUp = await catchUpOnOpen(store);
      const manifest = await clientManifest(store);
      // Re-align lastSeq against the NEW history.db before watching: the old
      // cursor belongs to another sequence and could permanently skip events
      //.
      eventBridge.startTailReader(store);
      eventBridge.watchWorld(resolvedPath);
      setActiveStore(store);
      lifecycle.completeWorldTransition(resolvedPath);
      characterTransitionStarted = false;
      store = null;

      // Start writer process (reused when the same world is already loaded)
      lifecycle.startWriter(resolvedPath).catch((err) => {
        console.warn('[Writer Startup Warning]', err);
      });
      // …and tell the returning player what happened while they were away, once.
      const opened = getActiveStore();
      if (opened) void deliverReturnDigest(opened, catchUp, (prompt) => lifecycle.submitWriter(opened.worldRoot, prompt));

      // Content hashes of the world's media, so the page can ask for them by
      // immutable URLs from the first scene on.
      const assetIndex = await worldAssetIndex(resolvedPath).catch(() => ({}));
      res.json({ ok: true, manifest, path: resolvedPath, assetIndex });
    } catch (err) {
      if (characterTransitionStarted) {
        await lifecycle.stopCharacters().catch(() => {});
        const restoredRoot = getActiveStore()?.worldRoot ?? null;
        lifecycle.completeWorldTransition(restoredRoot);
        if (restoredRoot) lifecycle.startWriter(restoredRoot).catch((error) => {
          console.warn('[Writer Restore Warning]', error);
        });
      }
      eventBridge.close?.();
      if (store) {
        try { store.close(); } catch { /* The load failure is already reported below. */ }
      }
      if (!getActiveStore()) console.warn(`[AIRP Server] World load failed; no world is open now: ${err instanceof Error ? err.message : String(err)}`);
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      endShelfOperation();
    }
  });

  router.delete('/worlds/save', async (req, res) => {
    if (shelfBusy) return res.status(409).json({ error: 'A world operation is in progress.' });
    beginShelfOperation();
    try {
      res.json(await trashWorldSave(repoRoot, req.body?.worldPath, getActiveStore()?.worldRoot));
    } catch (err) {
      res.status(err instanceof ShelfError ? err.status : 500).json({ error: err instanceof Error ? err.message : String(err) });
    } finally { endShelfOperation(); }
  });

  // Get active world manifest
  router.get('/manifest', async (_req, res) => {
    const store = getActiveStore();
    if (!store) return res.status(400).json({ error: 'No active world' });

    try {
      res.json(await clientManifest(store));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  /**
   * Get one SCENE of a character's nook. Same
   * `LayerState` shape as `/api/layer`, but a nook is NOT a layer: `resolveLayer`
   * returns null for `characters/**` by construction, so the layer gate cannot be
   * reused. The READ side that shares its assembly is only the seat half
   * (nook 00 §3.3).
   *
   * `?character=<id>` is a BARE id — never a path (nook 00 §3.2). The optional
   * `?scene=<rel path>` names a directory BELOW that character root and is
   * omitted/empty for the root scene. Both are gated by the ONE id validator of
   * §5.1; the store's own `resolvePath` guards are a second line, not the first
   * (they throw, which would surface as a 500).
   */
  router.get('/nook', async (req, res) => {
    const store = getActiveStore();
    if (!store) return res.status(400).json({ error: 'No active world' });
    try {
      const id = typeof req.query.character === 'string' ? req.query.character : '';
      if (!isValidCharacterId(id)) {
        return res.status(400).json({
          ok: false,
          code: 'invalid_argument',
          error: 'character must be a lower-kebab-case id',
        });
      }
      const nookId = nookIdOf(id)!;
      // `scene` addresses a sub-scene directory below the character root
      //; omitted / '' means the root scene, which stays
      // byte-identical to N1. Shape first, existence later: a malformed segment
      // must 400 and never reach `statKind` (whose `resolvePath` throws ⇒ 500),
      // and a leading/trailing '/' MUST be rejected rather than normalised away —
      // `path.normalize` would quietly accept a second spelling of the same scene.
      const rawScene = req.query.scene;
      if (!(rawScene === undefined || typeof rawScene === 'string')) {
        return res.status(400).json({
          ok: false,
          code: 'invalid_argument',
          error: 'scene must be a single string',
        });
      }
      const scenePath = rawScene ?? '';
      if (!isValidNookScenePath(scenePath)) {
        return res.status(400).json({
          ok: false,
          code: 'invalid_argument',
          error: 'scene must be a slash-joined path of lower-kebab-case segments',
        });
      }
      const sceneId = scenePath === '' ? nookId : `${nookId}/${scenePath}`;
      // Cheap mechanical re-assertion of the frozen id shape (no leading or
      // trailing '/'): the segment gate above is what makes it unreachable.
      if (!isNookSceneId(sceneId)) {
        return res.status(400).json({
          ok: false,
          code: 'invalid_argument',
          error: 'scene must be a valid nook scene path',
        });
      }
      // `statKind` is the only primitive that separates "missing" from "empty":
      // `listFiles` returns [] for both (local-store.ts:226-228), so using it
      // here would make the 404 unreachable and dress "no such character" up as
      // "the nook is empty". One check now covers the
      // root scene (`scene === ''`) and every sub-scene: "does this scene exist"
      // is the same question as "does this character exist", one level down.
      if ((await store.statKind(sceneId)) !== 'dir') {
        return res.status(404).json({
          ok: false,
          code: 'not_found',
          error: scenePath === '' ? `No such character: "${id}"` : `No such scene: "${sceneId}"`,
        });
      }

      // Two walks, both scoped to THIS character (never the world): the file set
      // answers "which cards belong to a scene" (for this scene and for each
      // door's stub test), the directory set answers "which scenes exist at all".
      // The directory walk is REQUIRED — `listFiles` is a FILE walk, so a
      // completely empty sub-directory disappears and its door can never exist,
      // while `world/**` DOES get a stub door for an empty room
      //.
      const allFiles = await store.listFiles(nookId);
      const dirs = await store.listDirs(nookId);
      const fmByDir = new Map<string, Record<string, any> | null>();
      for (const d of dirs) {
        try {
          fmByDir.set(d, parseFrontmatter(await store.readFile(`${d}/README.md`)).frontmatter);
        } catch {
          fmByDir.set(d, null);
        }
      }
      // `readFm` is SYNCHRONOUS (same shape as `deriveLayers`), so the frontmatter
      // MUST be pre-read: awaiting inside the callback would hand back Promises,
      // every directory would look like a stub and every door would lose its name
      // (the same reason `scanLayers` pre-reads).
      const nookTree = deriveNookLayers(nookId, dirs, (d) => fmByDir.get(d) ?? null);
      const doorIds = nookSceneDoors(sceneId, nookTree);

      // Cards via §5.2's one page-membership function (root ⇒ nookCardPaths,
      // sub-scene ⇒ cardsOfLayer); then one door per DIRECT child directory,
      // always `<scene>/README.md`, synthesised only when that README is absent —
      // the door is how a scene you have not written yet stays enterable.
      const items = await readLayerItems(store, nookSceneCards(sceneId, allFiles));
      items.push(
        ...(await Promise.all(
          doorIds.map(async (doorId): Promise<LayerItem> => {
            const doorPath = `${doorId}/README.md`;
            try {
              const { frontmatter, body } = parseFrontmatter(await store.readFile(doorPath));
              return { path: doorPath, filename: 'README.md', frontmatter, body };
            } catch {
              // `stub` = "this directory itself holds nothing readable" — no
              // README AND no direct card. Not "no README found": a sub-scene can
              // be full of cards and still have no facade, and marking that
              // UNWRITTEN would be a lie. `body` stays
              // empty on purpose — the layer path's "not written yet" English
              // would be that same lie here.
              const hasCards = nookSceneCards(doorId, allFiles).length > 0;
              return {
                path: doorPath,
                filename: 'README.md',
                frontmatter: { type: 'readme', name: doorId.split('/').pop(), door: true, stub: !hasCards },
                body: '',
              };
            }
          })
        ))
      );

      const rowByPath = new Map(store.getLayerCards(items.map((it) => it.path)).map((r) => [r.id, r]));

      const unseated = items
        .filter((it) => !rowByPath.has(it.path))
        .map((it) => ({ path: it.path, ...storedSizeOf(it, rowByPath.get(it.path)) }));
      // The seat namespace is the SCENE, not the character (nook-scene 00 §4.5):
      // `seatUnplaced`/`reseatLayer` key occupancy off `cards.layer`, so passing
      // `nookId` would make a parent's door cards and a sub-scene's cards shove
      // each other around although they are never on screen together.
      if (unseated.length > 0) {
        for (const row of await store.seatUnplaced(sceneId, unseated)) rowByPath.set(row.id, row);
      }
      for (const row of await store.reseatLayer(
        sceneId,
        items.map((it) => ({ path: it.path, ...declaredSizeOf(it) }))
      )) {
        rowByPath.set(row.id, row);
      }

      const context = await appearanceContext(store, sceneId);
      const enriched = items.map((it) => {
        const row = rowByPath.get(it.path);
        const { kind, w, h } = storedSizeOf(it, row);
        const appearance = resolveAppearance({
          kind,
          entityPath: it.path,
          frontmatter: it.frontmatter,
          context,
        });
        return {
          ...it,
          kind,
          appearance,
          x: row ? row.x : SEAT_ANCHOR.x,
          y: row ? row.y : SEAT_ANCHOR.y,
          w,
          h,
          z: row ? row.z : 1,
          rot: rotOf(it.path),
        };
      });

      // The SCENE's own README is its facade (`scene`), kept out of `items` so one
      // path never has two positions (same rule as /api/layer) — the doors in
      // `items` are OTHER scenes' READMEs. NO stub is synthesised: a scene without
      // a README has no facade to fake, so the frontend shows its own state for it.
      let scene: SceneReadme | null = null;
      let bg: { src: string | null; tone: string; grain: string } = { src: null, tone: 'warm', grain: 'parchment' };
      let audio: LayerAudio = { ambient: null, bgm: null };
      try {
        const readmePath = `${sceneId}/README.md`;
        const raw = await store.readFile(readmePath);
        const parsed = parseFrontmatter(raw);
        scene = {
          path: readmePath,
          filename: 'README.md',
          frontmatter: parsed.frontmatter,
          body: parsed.body,
          kind: 'scene',
        };
        bg = readLayerBg(raw);
        // OWN-only: `characters/` does not inherit the map's audio tri-state
        // (nook 00 §3.1). The inheritance block of /api/layer reads
        // world/README.md, which is the wrong source here.
        audio = readLayerAudio(parsed.frontmatter, store, AUDIO_ROOT);
      } catch {
        // README missing -> scene null, bg/audio keep their defaults.
      }

      // Literal empty arrays: a nook has no links or presence this batch (nook
      // 00 §3.1). Querying `WHERE layer = ?` would look like support; it is not.
      res.json({ layer: sceneId, scene, bg, audio, items: enriched, links: [], presence: [], worldFrozen });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  /**
   * Leave a player-authored note in a character's Nook. The request is a
   * deliberately narrow transport seam: it carries no path, frontmatter,
   * link, or actor. `writeNookNote` performs the shared id/path checks and
   * delegates serialization + entity_created to the existing writeChalk action.
   * The event bridge's tail reader observes that event and the normal
   * world_event refresh path re-reads the Nook.
   */
  router.post('/nook-note', async (req, res) => {
    const store = getActiveStore();
    if (!store) return res.status(400).json({ error: 'No active world' });
    const parsed = NookNoteInputSchema.safeParse(req.body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return res.status(400).json({
        ok: false,
        code: 'invalid_argument',
        error: issue?.message ?? 'Invalid nook note input',
      });
    }

    const service = serviceFor(store, { type: 'player' });
    await worldWrite(res, store, req.body?.expectedRevision, async () => {
      const result = await writeNookNote(service.ctx, parsed.data);
      const details = NookNoteOutcomeSchema.parse({
        path: result.details.path,
        eventSeq: result.details.eventSeq,
        actor: result.details.actor,
        created: result.details.created,
      });
      return { details };
    });
  });

  /**
   * The player's sticky notes. Player actor
   * only; the body carries an `op` and never an actor or frontmatter. The note
   * is a world file, so its `entity_*` event reaches the canvas through the
   * normal `world_event` refresh path.
   */
  router.post('/player-note', async (req, res) => {
    const store = getActiveStore();
    if (!store) return res.status(400).json({ error: 'No active world' });
    const service = serviceFor(store, { type: 'player' });
    await worldWrite(res, store, req.body?.expectedRevision, async () => {
      const result = await writePlayerNote(service.ctx, parsePlayerNoteInput(req.body));
      const { event: _event, ...details } = result.details;
      return { details };
    });
  });

  /** The player's clue board for one page: lines and marks. */
  router.get('/player-board', async (req, res) => {
    const store = getActiveStore();
    if (!store) return res.status(400).json({ error: 'No active world' });
    const layer = typeof req.query.layer === 'string' ? req.query.layer : 'map';
    if (!isPlausibleLayer(layer)) return res.status(400).json({ ok: false, code: 'invalid_argument', error: 'layer is not a layer id' });
    res.json({ ok: true, layer, board: await playerBoardForLayer(store, layer) });
  });

  /**
   * Draw / erase a line between two cards, or mark a card (可疑 / 已确认 / 无关).
   * Written to `player-board.json`, never into the writer's cards. Other open
   * tabs learn it from the `player_board` frame.
   */
  router.post('/player-board', async (req, res) => {
    const store = getActiveStore();
    if (!store) return res.status(400).json({ error: 'No active world' });
    const service = serviceFor(store, { type: 'player' });
    await worldWrite(res, store, req.body?.expectedRevision, async () => {
      const result = await updatePlayerBoard(service.ctx, parsePlayerBoardInput(req.body));
      const { event: _event, ...details } = result.details;
      if (details.changed) eventBridge.broadcast({ type: 'player_board', layer: details.layer, board: details.board, timestamp: new Date().toISOString() });
      return { details };
    });
  });

  // Get layer contents (cards, files)
  router.get('/layer', async (req, res) => {
    const store = getActiveStore();
    if (!store) return res.status(400).json({ error: 'No active world' });
    try {
      const layer = (req.query.layer as string) || 'map';
      const { cards: cardFiles, doorIds } = await store.pageOfLayer(layer);
      // Each door = the child layer's README if it exists (a written scene), or
      // a synthesised stub door when the child has no README yet (doc-11 §3).
      const allItems: LayerItem[] = await Promise.all([
        ...cardFiles.map(async (file): Promise<LayerItem> => {
          const raw = await store.readFile(file);
          const { frontmatter: shown, body } = displayItemOf(file, raw);
          // An NPC card's tick prompt is the engine's, never the page's.
          let frontmatter = shown as Record<string, unknown> | null;
          if (frontmatter && 'tick' in frontmatter) { const { tick: _tick, ...rest } = frontmatter; frontmatter = rest; }
          return { path: file, filename: path.basename(file), frontmatter, body };
        }),
        ...doorIds.map(async (id): Promise<LayerItem> => {
          const readme = `${id}/README.md`;
          try {
            const { frontmatter, body } = parseFrontmatter(await store.readFile(readme));
            return { path: readme, filename: 'README.md', frontmatter, body };
          } catch {
            return {
              path: readme,
              filename: 'README.md',
              frontmatter: { type: 'readme', stub: true, name: id.split('/').pop() },
              body: 'This scene has not been written yet.',
            };
          }
        }),
      ]);
      // Character presence is rendered from canvas.db, not from legacy world
      // cards. Filter old saves as well as new templates so loading a save made
      // before the migration cannot paint a duplicate character component.
      const nonCharacterItems = allItems.filter((it) => !['character', 'spirit'].includes(String(it.frontmatter?.type ?? '')));
      // An authored gate replaces the automatic child directory sign.
      const targets = new Set(nonCharacterItems.filter(it => it.frontmatter?.type === 'gate').map(it => it.frontmatter?.target));
      const items = nonCharacterItems.filter(it => it.filename !== 'README.md' || !targets.has(it.path.replace(/\/README\.md$/, '')));
      const mdFiles = items.map((it) => it.path);

      // Store seating receives the complete page, including existing rows and
      // cross-layer README doors, then re-reads rows inside its write transaction.
      const initialRows = new Map(store.getLayerCards(mdFiles).map((row) => [row.id, row]));
      const eventOrderByPath = new Map<string, number>();
      for (const event of await store.getEvents(1000)) {
        if (event.type === 'entity_created') {
          const eventPath = event.detail.path;
          if (typeof eventPath === 'string' && !eventOrderByPath.has(eventPath)) {
            eventOrderByPath.set(eventPath, event.seq);
          }
        } else if (event.type === 'layer_initialized' && event.detail.layer === layer) {
          const eventFiles = event.detail.files;
          if (Array.isArray(eventFiles)) {
            eventFiles.forEach((eventPath, index) => {
              if (typeof eventPath === 'string' && !eventOrderByPath.has(eventPath)) {
                eventOrderByPath.set(eventPath, event.seq * 1000 + index);
              }
            });
          }
        }
      }
      const orderHints = stableSeatOrderOf(
        items.map((item) => {
          const declared = declaredSizeOf(item);
          const rawOrder = item.frontmatter?.order;
          return {
            path: item.path,
            kind: declared.kind,
            order:
              typeof rawOrder === 'number' && Number.isFinite(rawOrder)
                ? rawOrder
                : eventOrderByPath.get(item.path),
          };
        })
      );
      const orderByPath = new Map(orderHints.map((entry) => [entry.path, entry.order]));
      const seatFiles: SeatFile[] = items.map((item) => ({
        path: item.path,
        ...storedSizeOf(item, initialRows.get(item.path)),
        order: orderByPath.get(item.path),
      }));
      const rowByPath = new Map(initialRows);

      // Perception capture pages read this route with `readOnly=1`
      //: the page must never seat or reseat — rows are
      // returned as-is and rowless items fall back to the seat anchor. The
      // screenshot route refuses unplaced layers before any capture.
      const readOnly = req.query.readOnly === '1';
      if (!readOnly) {
        // The store filters rowless files again while holding BEGIN IMMEDIATE;
        // passing the full page makes every existing page row an obstacle.
        for (const row of await store.seatUnplaced(layer, seatFiles)) {
          rowByPath.set(row.id, row);
        }

        // Re-flow only cards whose declared or measured footprint legitimately
        // drifted. Stable rows retain their current x/y/z.
        for (const row of await store.reseatLayer(
          layer,
          items.map((item) => ({ path: item.path, ...declaredSizeOf(item), order: orderByPath.get(item.path) }))
        )) {
          rowByPath.set(row.id, row);
        }
      }

      const context = await appearanceContext(store, layer);
      const enriched = items.map((it) => {
        const row = rowByPath.get(it.path);
        const { kind, w, h } = storedSizeOf(it, row);
        const appearance = resolveAppearance({
          kind,
          entityPath: it.path,
          frontmatter: it.frontmatter,
          context,
        });
        return {
          ...it,
          kind,
          appearance,
          x: row ? row.x : SEAT_ANCHOR.x,
          y: row ? row.y : SEAT_ANCHOR.y,
          // w/h come from the stored row: since F1 those columns are the card's
          // REAL footprint, written by POST /api/card/footprint once the front
          // end measures it (00 §3.1). The form table is only the first-paint
          // default for a row that is missing or degenerate.
          w,
          h,
          z: row ? row.z : 1,
          rot: rotOf(it.path), // derived, never persisted
        };
      });

      // The layer's own README is its entry Chalk as well as its scene config.
      // It is returned separately from `items`: the same README is a gate on
      // the parent page, so seating it again here would create one path with two
      // incompatible positions.
      let scene: SceneReadme | null = null;

      // bg + audio from the layer README frontmatter (doc-10 E0; the design notes).
      let bg: { src: string | null; video?: string; tone: string; grain: string } = { src: null, tone: 'warm', grain: 'parchment' };
      let audio: LayerAudio = { ambient: null, bgm: null };
      try {
        const readmePath = layer === 'map' ? 'world/README.md' : `${layer}/README.md`;
        const raw = await store.readFile(readmePath);
        const parsedReadme = parseFrontmatter(raw);
        scene = {
          path: readmePath,
          filename: 'README.md',
          frontmatter: parsedReadme.frontmatter,
          body: parsedReadme.body,
          kind: 'scene',
        };
        bg = readLayerBg(raw);
        if (bg.video && !bg.video.includes('-transparent')) {
          const lightweight = bg.video.replace(/\.(webm|mp4)$/i, '-lite.mp4');
          if (await store.statKind(lightweight) === 'file') bg.video = lightweight;
        }
        const ownFm = parsedReadme.frontmatter;
        const own = readLayerAudio(ownFm, store, AUDIO_ROOT);
        audio = own;
        // Inheritance is keyed on DECLARATION, not on resolution: `??` cannot tell
        // "key absent" from "key present but null" — and the latter is declared
        // silence that MUST NOT fall back.
        if (layer !== 'map') {
          // Only the map README read is guarded — a failure here must not swallow
          // the layer's own `audio` resolved above.
          try {
            const mapFm = parseFrontmatter(await store.readFile('world/README.md')).frontmatter;
            const inh = readLayerAudio(mapFm, store, AUDIO_ROOT);
            // `k in ownFm` = "declared"; resolution result is
            // separate — a declared key that resolves to null stays null (silence).
            const ownBgm = ownFm != null && 'bgm' in ownFm;
            audio = {
              ambient: ownFm != null && 'ambient' in ownFm ? own.ambient : (inh.ambient ?? null),
              bgm: ownBgm ? own.bgm : (inh.bgm ?? null),
              ...((ownBgm ? own.quiet : inh.quiet) ? { quiet: true as const } : {}),
            };
          } catch {
            // map README missing -> no inheritance, keep own
          }
        }
      } catch {
        // README missing -> defaults (audio stays the declared-silence default)
      }

      const links = (store.queryCanvas(
        'SELECT id, from_id, to_id, style, label FROM links WHERE layer = ?',
        [layer]
      ) as Array<Record<string, unknown>>).map((row) => ({
        id: String(row.id),
        from: String(row.from_id),
        to: String(row.to_id),
        style: row.style ? String(row.style) : 'solid',
        label: row.label == null ? null : String(row.label),
      }));

      const presence = (store.queryCanvas(
        'SELECT character_id, x, y, following FROM presence WHERE layer = ? ORDER BY character_id',
        [layer]
      ) as Array<Record<string, unknown>>).map((row) => ({
        characterId: String(row.character_id),
        x: Number(row.x),
        y: Number(row.y),
        following: Number(row.following) === 1,
      }));

      // Which options are done in this save: the page hides them, `look_at` marks them —
      // one answer from the save. A failure here only means the page falls back to its own reading.
      const optionStates = await optionStatesOf(store, scene ? [scene, ...items] : items).catch(() => undefined);

      res.json({ layer, scene, bg, audio, items: enriched, links, presence, worldFrozen, ...(optionStates ? { optionStates } : {}) });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Get backpack items (player/ directory). The scan lives in shared so the
  // injection-side `bag` section and this route name one fact once
  //; `BagItem`'s field names are the contract the
  // backpack chrome reads, so they are not this route's to change.
  router.get('/backpack', async (_req, res) => {
    const store = getActiveStore();
    if (!store) return res.status(400).json({ error: 'No active world' });
    try {
      res.json({ items: await listBackpack(store) });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Get characters and presence
  router.get('/characters', async (_req, res) => {
    const store = getActiveStore();
    if (!store) return res.status(400).json({ error: 'No active world' });
    try {
      const manifest = await store.getManifest();
      // `presence` is the ONE cross-layer fact the character rail needs:
      // `home` is only the initial layer baked into world.json
      //, never "where they are now". Read the whole
      // presence table once and index it — one query, not one per character.
      const presenceByCharacter = new Map(
        store.getPresence().map((row) => [row.characterId, row])
      );
      const chars = await Promise.all(
        (manifest.characters || []).map(async (c) => {
          let name = c.name;
          let avatar = c.avatar;
          let avatarVideo = c.avatarVideo;
          let bio = c.description;
          let formVoice: string | undefined;
          let voice: string | undefined;
          let greeting: string | undefined;
          let invitesFollowLine: string | undefined;
          let arrivalLine: string | undefined;
          try {
            const raw = await store.readFile(`characters/${c.id}/README.md`);
            const { frontmatter, body } = parseFrontmatter(raw);
            if (frontmatter?.avatar) avatar = frontmatter.avatar;
            if (typeof frontmatter?.avatarVideo === 'string') avatarVideo = frontmatter.avatarVideo;
            if (!bio) bio = body.slice(0, 100);
            // A character in another form: the
            // `form` state's entry replaces name / avatar / voice below.
            const form = characterFormOf(frontmatter);
            if (form?.name) name = form.name;
            if (form?.avatar) avatar = form.avatar;
            if (form?.description) bio = form.description;
            formVoice = form?.voice;
            // `voice` is a character property declared in the README frontmatter
            // — passed through VERBATIM, alias or raw id, and
            // resolved exactly once, in `POST /api/tts` (the design notes: one
            // resolver). Absent ⇒ the key is omitted and the client falls back to
            // the server default (§15.5).
            if (typeof frontmatter?.voice === 'string' && frontmatter.voice.trim() !== '') {
              voice = frontmatter.voice.trim();
            }
            if (formVoice) voice = formVoice;
            // The first act's three author-written lines.
            // They live beside the character, travel with the same edition, and
            // are passed through VERBATIM: the writer never generates them and
            // the server never rewrites them.
            greeting = firstActLine(frontmatter?.greeting);
            invitesFollowLine = firstActLine(frontmatter?.invites_follow_line);
            arrivalLine = firstActLine(frontmatter?.arrival_line);
          } catch {}
          // 6-emotion differentials: the server is the ONE
          // place that knows the `<id>/<emo>.webp` convention. Reported only when
          // ALL SIX exist — a half set would switch faces mid-reply and jump;
          // absent ⇒ the client keeps its single-portrait fallback.
          const portraits = emotionPortraitsOf(c.id);
          const present = await Promise.all(
            EMOTIONS.map(async (e) => (await store.statKind(portraits[e])) === 'file')
          );
          const emotions = present.every(Boolean) ? portraits : undefined;
          const row = presenceByCharacter.get(c.id);
          return {
            ...c,
            ...(name ? { name } : {}),
            ...(avatar ? { avatar } : {}),
            ...(avatarVideo ? { avatarVideo } : {}),
            bio,
            // The key is ALWAYS present; `null` means "not in the world"
            // (no `presence` row), never "the key is missing".
            presence: row ? { layer: row.layer, following: row.following } : null,
            ...(voice ? { voice } : {}),
            ...(emotions ? { emotions } : {}),
            ...(greeting ? { greeting } : {}),
            ...(invitesFollowLine ? { invitesFollowLine } : {}),
            ...(arrivalLine ? { arrivalLine } : {}),
          };
        })
      );
      res.json({ characters: chars });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Toggle a character's following state (05 §3.6.1 / the design notes).
  // The body carries the TERMINAL state, not a toggle: the UI inverts, the
  // action writes. A repeat is an idempotent no-op that lands no event — the
  // writer may have flipped it in the meantime, so the client MUST NOT hold
  // the truth (`presence.following` is the only source).
  router.post('/following', async (req, res) => {
    const store = getActiveStore();
    if (!store) return res.status(400).json({ error: 'No active world' });
    const { character, following } = req.body as { character?: unknown; following?: unknown };
    if (typeof character !== 'string' || character === '') {
      return res.status(400).json({ ok: false, code: 'invalid_argument', error: 'character must be a non-empty character id' });
    }
    if (typeof following !== 'boolean') {
      return res.status(400).json({ ok: false, code: 'invalid_argument', error: 'following must be a boolean' });
    }
    await worldWrite(res, store, req.body?.expectedRevision, async () => {
      const result = await serviceFor(store, { type: 'player' }).setFollowing({ character, following });
      // Teach-once cue: someone walks with the player now.
      return following && result.details.changed ? { ...result, details: { ...result.details, cue: 'first-follow' } } : result;
    });
  });

  // Move item (backpack <-> scene, etc.) — the single action, no local rules.
  // The router used to call `store.move` + `renameCardPosition` and broadcast an
  // `item_moved` frame; the frame is deleted and the event
  // reaches the frontend as `world_event{entity_moved}` via the tail reader.
  router.post('/move', async (req, res) => {
    const store = getActiveStore();
    if (!store) return res.status(400).json({ error: 'No active world' });
    const { from, to, near } = req.body as { from?: unknown; to?: unknown; near?: unknown };
    if (typeof from !== 'string' || from === '') {
      return res.status(400).json({ ok: false, code: 'invalid_argument', error: 'from must be a non-empty world-relative path' });
    }
    if (typeof to !== 'string' || to === '') {
      return res.status(400).json({ ok: false, code: 'invalid_argument', error: 'to must be a non-empty world-relative path' });
    }
    await worldWrite(res, store, req.body?.expectedRevision, () =>
      serviceFor(store, { type: 'player' }).moveEntity({
        from,
        to,
        ...(typeof near === 'string' && near !== '' ? { near } : {}),
      })
    );
  });

  /**
   * Persist a card's dropped position.
   *
   * The state write goes through `arrangeCards({ place })` (09 §8.3: one action
   * semantics), but the frame is `card_position` — NOT `canvas_patched`, which is
   * reserved for the tool path. Broadcasting has to happen
   * after the action succeeded, so this route goes through `worldWrite` (which
   * serializes, guards the revision and maps errors) rather than the plain
   * `reply`, which swallows the error.
   */
  router.post('/card/position', async (req, res) => {
    const store = getActiveStore();
    if (!store) return res.status(400).json({ error: 'No active world' });
    const { path: cardPath, x, y } = req.body as { path?: unknown; x?: unknown; y?: unknown };
    if (typeof cardPath !== 'string' || cardPath === '') {
      return res.status(400).json({ ok: false, code: 'invalid_argument', error: 'path must be a non-empty string' });
    }
    if (
      typeof x !== 'number' || !Number.isFinite(x) ||
      typeof y !== 'number' || !Number.isFinite(y)
    ) {
      return res.status(400).json({ ok: false, code: 'invalid_argument', error: 'x and y must be finite numbers' });
    }
    await worldWrite(res, store, req.body?.expectedRevision, async () => {
      const r = await serviceFor(store, { type: 'player' }).arrangeCards({ place: { path: cardPath, x, y } });
      eventBridge.broadcast({ type: 'card_position', path: cardPath, x, y, savePath: store.worldRoot });
      return r;
    });
  });

  /**
   * Persist measured card footprints.
   *
   * The second "card state HTTP write", deliberately asymmetric with
   * `/card/position`: a player may never resize a card through `arrange`, but
   * the renderer's measured fact may overwrite the stored box (contract §5.3).
   *
   * Writes ONLY `cards.width/height` (+ `metadata.measuredAt`) via the store,
   * keyed by `id = path` alone. It MUST NOT write an event (contract §3.6 — a
   * derived render fact, not world content) and MUST NOT broadcast a frame:
   * the caller IS the measurer, so a frame would only echo stale data back.
   *
   * 200 → { ok: true, updated, unchanged }   (unknown path/row → skipped, counted in `unchanged`)
   * 404 → { ok: false, code: 'not_found' }   (layer name does not exist)
   * 400 → { ok: false, code: 'invalid_argument' } (malformed layer/boxes)
   */
  router.post('/card/footprint', async (req, res) => {
    const store = getActiveStore();
    if (!store) return res.status(400).json({ error: 'No active world' });
    const { layer, boxes } = req.body as { layer?: unknown; boxes?: unknown };
    if (typeof layer !== 'string' || layer === '') {
      return res.status(400).json({ ok: false, code: 'invalid_argument', error: 'layer must be a non-empty layer id' });
    }
    // L3: the store matches rows by `id = path` ONLY, so this gate is what keeps
    // a mistyped name from silently writing rows that live elsewhere. It has TWO
    // shapes because a nook is NOT a layer: `resolveLayer` returns null for
    // `characters/**` by construction (local-store.ts:552-555), so routing a nook
    // through it would 404 every nook footprint forever — the C plan this batch
    // rejected. Same shape as `arrangeCards`' nook branch
    // (§3.7): the shape gate is the ONE id validator `isNookSceneId` (§5.1), and
    // existence is the SCENE directory itself — a subdirectory scene
    // (`characters/elias/office`) is a page of its own, not the character root.
    if (layer.startsWith('characters/')) {
      // Shape gate first (NEVER path-normalise: §3.2), then existence. The
      // prefix branch catches malformed `characters/**` values (`.`, empty
      // segments, trailing slash) so they 400 here instead of leaking to the
      // layer gate and getting a misleading 404.
      if (!isNookSceneId(layer)) {
        return res.status(400).json({
          ok: false,
          code: 'invalid_argument',
          error: `nook scene "${layer}" is not a valid nook scene id`,
        });
      }
      if ((await store.statKind(layer)) !== 'dir') {
        return res.status(404).json({
          ok: false,
          code: 'not_found',
          error: `nook scene "${layer}" has no directory`,
        });
      }
    } else if ((await store.resolveLayer(dirOfLayer(layer))) !== layer) {
      return res.status(404).json({ ok: false, code: 'not_found', error: 'layer must be an existing layer id' });
    }
    if (!Array.isArray(boxes)) {
      return res.status(400).json({ ok: false, code: 'invalid_argument', error: 'boxes must be an array' });
    }
    if (boxes.length === 0) return res.json({ ok: true, updated: 0, unchanged: 0 });
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i] as { path?: unknown; w?: unknown; h?: unknown } | null;
      // Whole-request 400, never "skip the bad ones": the only caller is our own
      // frontend, so a bad box is a bug and partial writes would hide it (03 L6).
      if (b === null || typeof b !== 'object') {
        return res.status(400).json({ ok: false, code: 'invalid_argument', error: `boxes[${i}] must be an object` });
      }
      if (typeof b.path !== 'string' || b.path === '') {
        return res.status(400).json({ ok: false, code: 'invalid_argument', error: `boxes[${i}].path must be a non-empty string` });
      }
      if (typeof b.w !== 'number' || !Number.isFinite(b.w) || b.w <= 0 || b.w > 1e6) {
        return res.status(400).json({ ok: false, code: 'invalid_argument', error: `boxes[${i}].w must be a finite positive number` });
      }
      if (typeof b.h !== 'number' || !Number.isFinite(b.h) || b.h <= 0 || b.h > 1e6) {
        return res.status(400).json({ ok: false, code: 'invalid_argument', error: `boxes[${i}].h must be a finite positive number` });
      }
    }
    await worldWrite(res, store, req.body?.expectedRevision, async () => ({
      details: await store.writeFootprints(layer, boxes as Array<{ path: string; w: number; h: number }>),
    }));
  });

  // Resolve roll_dice — `rollDice` is the ONE adjudicator (doc-20 §2.2). The old
  // body rolled, parsed `expect` and wrote the file back here, a second rule set.
  // The HTTP path sends NO presentation frame (§3.3 step 5): the frontend drives
  // the animation from this response; `dice_result` belongs to the tool path.
  router.post('/dice', async (req, res) => {
    const store = getActiveStore();
    if (!store) return res.status(400).json({ error: 'No active world' });
    const { path: dicePath, forcedResult } = req.body as { path?: unknown; forcedResult?: unknown };
    if (typeof dicePath !== 'string' || dicePath === '') {
      return res.status(400).json({ ok: false, code: 'invalid_argument', error: 'path must be a non-empty world-relative path' });
    }
    if (forcedResult !== undefined && (typeof forcedResult !== 'number' || !Number.isFinite(forcedResult))) {
      return res.status(400).json({ ok: false, code: 'invalid_argument', error: 'forcedResult must be a finite number' });
    }
    // Only a forged score is a god action; a plain click is the player's (07 §5.2).
    const actor: Actor = typeof forcedResult === 'number' ? { type: 'god' } : { type: 'player' };
    await worldWrite(res, store, req.body?.expectedRevision, async () => {
      const result = await runDeclaredRoll(serviceFor(store, actor), dicePath, typeof forcedResult === 'number' ? forcedResult : undefined);
      // A search's roll has just created its finds:
      // the writer narrates what was found, after the fact — never before.
      const source = parseFrontmatter(await store.readFile(dicePath)).frontmatter;
      const skillDetails = (result.details as { skill?: { label?: unknown; tierLabel?: unknown; grade?: unknown; target?: unknown } }).skill;
      if (!source?.search_source && skillDetails && startsChoiceTurn(readWorldSettings(store.worldRoot).autoWrite)) {
        const d = result.details as { result?: unknown; rewards?: Array<{ path: string }> };
        const found = (d.rewards ?? []).map((r) => r.path);
        dispatch(store, `[Player Event] The player rolled the skill check ${JSON.stringify(dicePath)} (${String(skillDetails.label)}, target ${String(skillDetails.target)}): ${String(d.result)} — ${String(skillDetails.tierLabel)} (grade ${String(skillDetails.grade)}).${found.length ? ` The roll created: ${found.map((p) => JSON.stringify(p)).join(', ')}.` : ''} Read the card, then narrate what this grade means in one chalk. Do not re-roll, raise the difficulty or change the result.`);
      }
      if (source?.search_source && startsChoiceTurn(readWorldSettings(store.worldRoot).autoWrite)) {
        const details = result.details as { result?: unknown; outcomeGrade?: unknown; rewards?: Array<{ path: string }> };
        const found = (details.rewards ?? []).map((r) => r.path);
        dispatch(store, `[Player Event] The player rolled the search ${JSON.stringify(dicePath)}: ${String(details.result)}${details.outcomeGrade ? ` (${String(details.outcomeGrade)})` : ''}. ${found.length ? `The roll created: ${found.map((p) => JSON.stringify(p)).join(', ')}.` : 'The roll found nothing to carry.'} Read the search card and what it created, then narrate the result in one chalk. Do not create, move or re-roll the found items; they already exist.`);
      }
      return result;
    });
  });

  // The player uses a skill from their character sheet:
  // the engine frames a regular-difficulty check card at once — no model in the
  // way — and the player rolls it like any dice card. The writer narrates after.
  router.post('/skill-check', async (req, res) => {
    const store = getActiveStore();
    if (!store) return res.status(400).json({ error: 'No active world' });
    const { skill, intent } = req.body as { skill?: unknown; intent?: unknown };
    if (typeof skill !== 'string' || skill === '') {
      return res.status(400).json({ ok: false, code: 'invalid_argument', error: 'skill must be a skill id from the sheet' });
    }
    if (intent !== undefined && (typeof intent !== 'string' || intent.length > 200)) {
      return res.status(400).json({ ok: false, code: 'invalid_argument', error: 'intent is one short line (at most 200 characters)' });
    }
    const title = typeof intent === 'string' && intent.trim() !== '' ? intent.trim() : undefined;
    await worldWrite(res, store, req.body?.expectedRevision, async () => {
      const result = await serviceFor(store, { type: 'player' }).skillCheck({ skill, ...(title ? { title } : {}) });
      // Teach-once cue: the player used a skill from their sheet.
      return { ...result, details: { ...result.details, cue: 'first-skill' } };
    });
  });

  // The inspiration roll: the player is stuck and rolls for a hint from the
  // character sheet. The engine rolls at once (no card on the canvas, no model) and answers with the tier and the
  // line; a fumble's small cost lands here too. 409 `conflict` with `details.gate` when it is too soon.
  router.post('/inspiration', async (req, res) => {
    const store = getActiveStore();
    if (!store) return res.status(400).json({ error: 'No active world' });
    const { layer, forcedResult } = req.body as { layer?: unknown; forcedResult?: unknown };
    if (layer !== undefined && (typeof layer !== 'string' || !/^(map|world\/[A-Za-z0-9_/-]+)$/.test(layer))) {
      return res.status(400).json({ ok: false, code: 'invalid_argument', error: 'layer must be a layer id' });
    }
    if (forcedResult !== undefined && (typeof forcedResult !== 'number' || !Number.isInteger(forcedResult))) {
      return res.status(400).json({ ok: false, code: 'invalid_argument', error: 'forcedResult must be an integer' });
    }
    // Only a forged score is a god action (same rule as /dice).
    const actor: Actor = typeof forcedResult === 'number' ? { type: 'god' } : { type: 'player' };
    await worldWrite(res, store, req.body?.expectedRevision, () =>
      inspire(serviceFor(store, actor).ctx, { page: typeof layer === 'string' ? layer : null, ...(typeof forcedResult === 'number' ? { forcedResult } : {}) }));
  });

  // Use item on target (point-and-click puzzle). No bare frame: the event goes
  // out as `world_event{use_item_on}`.
  router.post('/use-item', async (req, res) => {
    const store = getActiveStore();
    if (!store) return res.status(400).json({ error: 'No active world' });
    const { item, target } = req.body as { item?: unknown; target?: unknown };
    if (typeof item !== 'string' || item === '') {
      return res.status(400).json({ ok: false, code: 'invalid_argument', error: 'item must be a non-empty world-relative path' });
    }
    if (typeof target !== 'string' || target === '') {
      return res.status(400).json({ ok: false, code: 'invalid_argument', error: 'target must be a non-empty world-relative path' });
    }
    await worldWrite(res, store, req.body?.expectedRevision, () => serviceFor(store, { type: 'player' }).useItemOn({ item, target }));
  });

  // Player picks one of the public options an entity declares (06 §2.5).
  router.post('/material-review', async (req, res) => {
    const store = getActiveStore();
    if (!store) return res.status(400).json({ error: 'No active world' });
    // A panel opened before a world switch must not submit into the new world.
    if (req.body?.world !== store.worldRoot) return res.status(409).json({ error: 'The active world changed. Reopen the materials panel.' });
    // Flat `{ ok, ...details }` per the design notes; actionDetailsOf reads both shapes.
    await worldWrite(res, store, req.body?.expectedRevision, () => prepareMaterialReview(serviceFor(store, { type: 'player' }), req.body));
  });

  router.post('/choice', async (req, res) => {
    const store = getActiveStore();
    if (!store) return res.status(400).json({ error: 'No active world' });
    const { path: choicePath, choice } = req.body as { path?: unknown; choice?: unknown };
    if (typeof choicePath !== 'string' || choicePath === '') {
      return res.status(400).json({ ok: false, code: 'invalid_argument', error: 'path must be a non-empty world-relative path' });
    }
    if (!((typeof choice === 'string' && choice !== '') || (typeof choice === 'number' && Number.isFinite(choice)))) {
      return res.status(400).json({ ok: false, code: 'invalid_argument', error: 'choice must be a string label or a 1-based number' });
    }
    await worldWrite(res, store, req.body?.expectedRevision, async () => {
      const declared = await runDeclaredChoice(serviceFor(store, { type: 'player' }), choicePath, choice);
      if (declared) {
        Object.assign(declared.details.action, { world: store.worldRoot });
        return declared;
      }
      const result = await serviceFor(store, { type: 'player' }).chooseOption({ path: choicePath, choice });
      // Auto-turn is per-world opt-in. The shipped default is
      // `scenes-and-choices` (changed 2026-09-15); the quiet `off` mode keeps
      // doc-21 §5.5: the event lands, the writer sees it in the injection of the
      // player's next input, no turn starts here.
      if (startsChoiceTurn(readWorldSettings(store.worldRoot).autoWrite)) {
        dispatch(store, `[Player Event] ${JSON.stringify(result.details.event)}\nRead ${JSON.stringify(choicePath)} and the world skill. Resolve this choice, update the source file, and write a chalk response. Do not record the choice a second time.`);
      }
      return result;
    });
  });

  // A guided experience's turn end: the page says a player turn settled; the
  // world's `experience.turnEnd` command runs once and the world's triggers are evaluated. A world without one
  // answers ok with `turnEnd.ran: false`. Never starts a writer turn.
  // A world with `tick` takes its character beat in the same call; the page
  // sends the layer it shows (`layer`), so "only on this page" is the page the player is looking at.
  router.post('/turn-end', async (req, res) => {
    const store = getActiveStore();
    if (!store) return res.status(400).json({ error: 'No active world' });
    const layer = typeof req.body?.layer === 'string' ? req.body.layer : null;
    const settings = readWorldSettings(store.worldRoot);
    const mode = characterTickMode(settings);
    const voices = characterVoicesOn(settings);
    // v2: the people's own words, when there is a model and the save has them on.
    const model = voices ? tickModels.runner(store.worldRoot) : null;
    await worldWrite(res, store, req.body?.expectedRevision, async () => runTurnEnd(serviceFor(store, { type: 'player' }).ctx, { tick: { mode, page: layer, voices, model } }));
  });

  // Character tick v2: a beat has started (the player's input just arrived).
  // Work out what the next beat would ask the model and send it now, beside the writer; the beat takes it if it
  // still fits. Answers at once — never waits for the model. Nothing is written.
  router.post('/tick/prefetch', async (req, res) => {
    const store = getActiveStore();
    if (!store) return res.status(409).json({ ok: false, code: 'no_active_world', error: 'Load a world first.' });
    const layer = typeof req.body?.layer === 'string' && /^(map|world\/[A-Za-z0-9_/-]+)$/.test(req.body.layer) ? req.body.layer : null;
    const settings = readWorldSettings(store.worldRoot);
    const voices = characterVoicesOn(settings);
    const tier = tickModels.tier();
    if (!voices || !tier) return res.json({ ok: true, prefetching: false });
    try {
      const ctx = serviceFor(store, { type: 'player' }).ctx;
      // A written hint due now keeps the people quiet this beat (turn-end does the same): no line to prefetch.
      const quiet = await hintDueNow(ctx, { page: layer }).catch(() => false);
      const request = await planTickPrefetch(ctx, { mode: characterTickMode(settings), page: layer, voices, tier, quiet });
      res.json({ ok: true, prefetching: request ? tickModels.prefetch(store.worldRoot, request) : false });
    } catch (err) {
      res.json({ ok: true, prefetching: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Character tick: what the page shows now — the intent, the recent moves, the marks.
  router.get('/tick', async (_req, res) => {
    const store = getActiveStore();
    if (!store) return res.status(409).json({ ok: false, code: 'no_active_world', error: 'Load a world first.' });
    try {
      const settings = readWorldSettings(store.worldRoot);
      res.json({ ok: true, tick: await readTickView(store, characterTickMode(settings), characterVoicesOn(settings)) });
    } catch (err) {
      res.status(500).json({ ok: false, code: 'internal', error: err instanceof Error ? err.message : String(err) });
    }
  });
  // The page really drew the intent: its counter window starts now (an unseen intent never lands).
  router.post('/tick/seen', async (req, res) => {
    const store = getActiveStore();
    if (!store) return res.status(409).json({ ok: false, code: 'no_active_world', error: 'Load a world first.' });
    const id = req.body?.id;
    if (typeof id !== 'string' || id === '' || id.length > 200) {
      return res.status(400).json({ ok: false, code: 'invalid_argument', error: 'id must be the pending intent id' });
    }
    const settings = readWorldSettings(store.worldRoot);
    const result = await markTickIntentSeen(serviceFor(store, { type: 'player' }).ctx, id, characterTickMode(settings), characterVoicesOn(settings));
    res.json({ ok: result.ok, tick: result.view });
  });
  // 「盯住」: the player spends this beat watching the target — a beat of its own that stops the intent.
  router.post('/tick/guard', async (req, res) => {
    const store = getActiveStore();
    if (!store) return res.status(409).json({ ok: false, code: 'no_active_world', error: 'Load a world first.' });
    const id = req.body?.id;
    const layer = typeof req.body?.layer === 'string' ? req.body.layer : null;
    if (typeof id !== 'string' || id === '' || id.length > 200) {
      return res.status(400).json({ ok: false, code: 'invalid_argument', error: 'id must be the pending intent id' });
    }
    const settings = readWorldSettings(store.worldRoot);
    const mode = characterTickMode(settings);
    const voices = characterVoicesOn(settings);
    const model = voices ? tickModels.runner(store.worldRoot) : null;
    await worldWrite(res, store, req.body?.expectedRevision, async () => {
      const tick = await runTickBeat(serviceFor(store, { type: 'player' }).ctx, { mode, page: layer, guard: id, voices, model });
      return { text: 'Guarded.', details: { tick } };
    });
  });

  // Player walks through a door into another layer (05 §3.6.2 / 12 §2.4).
  router.post('/enter-layer', async (req, res) => {
    const store = getActiveStore();
    if (!store) return res.status(400).json({ error: 'No active world' });
    const { layer } = req.body as { layer?: unknown };
    if (typeof layer !== 'string' || layer === '') {
      return res.status(400).json({ ok: false, code: 'invalid_argument', error: 'layer must be a non-empty layer id' });
    }
    // P0 gate contract: a target README may require exact backpack paths.
    // Later requirement axes (facts / companions / adjudicated RP) will extend
    // this block without changing the README-as-gate source of truth.
    const readmePath = layer === 'map' ? 'world/README.md' : `${layer}/README.md`;
    if ((await store.statKind(readmePath)) === 'file') {
      const parsed = parseFrontmatter(await store.readFile(readmePath));
      if (parsed.errors.length > 0) {
        return res.status(409).json({
          ok: false,
          code: 'invalid_gate',
          error: `This scene cannot be entered because its README is invalid: ${parsed.errors[0]}`,
        });
      }
      const rawItems = parsed.frontmatter?.requires?.items;
      const requiredItems = Array.isArray(rawItems)
        ? rawItems.filter((item): item is string => typeof item === 'string' && item !== '')
        : [];
      const invalidItem = requiredItems.find(
        (item) => !item.startsWith('player/') || !item.endsWith('.md') || item.split('/').includes('..')
      );
      if (invalidItem) {
        return res.status(409).json({
          ok: false,
          code: 'invalid_gate',
          error: `Gate requirements must name player/*.md backpack paths, got: ${invalidItem}`,
        });
      }
      const missing: string[] = [];
      for (const item of requiredItems) {
        if ((await store.statKind(item)) !== 'file') missing.push(item);
      }
      if (missing.length > 0) {
        const blocked = parsed.frontmatter?.blocked;
        return res.status(409).json({
          ok: false,
          code: 'requirements_not_met',
          error:
            typeof blocked === 'string' && blocked.trim() !== ''
              ? blocked
              : `This scene is still locked. Missing: ${missing.join(', ')}`,
          missing,
        });
      }
    }
    // A stub has no README yet; entering it is what asks the world to
    // materialise one, so absence must not become an artificial lock. The
    // materialisation itself is NOT a writer turn: it goes through the I1
    // initialiser (`airp-init` → scene-init preset + structured brief + W2
    // fallback), which the frontend fires on the `first` signal below
    //. This route only records `layer_entered`. The
    // `dispatch` that used to live here was a second, contract-violating path
    // (doc-21 §5.5: an event landing never starts a turn) that also bypassed
    // the brief, the emptiness check and the fallback.
    await worldWrite(res, store, req.body?.expectedRevision, async () => {
      const layers = (await store.getManifest()).layers;
      if (!layers[layer]) throw new ActionError({ code: 'not_found', message: 'Scene does not exist.' });
      return serviceFor(store, { type: 'player' }).enterLayer({ layer });
    });
  });

  // The player's viewpoint (00 §5). No event, no WS frame: this is a
  // current-value report, not a world change (there is no `state_changed`; the
  // row is not the world). Synchronous: `writeViewpoint` uses `execCanvas`, and
  // this is not an action, so it does not go through `reply()`.
  router.post('/viewpoint', (req, res) => {
    const store = getActiveStore();
    if (!store) return res.status(400).json({ error: 'No active world' });
    const v = sanitizeViewpoint(req.body);
    if (!v) {
      return res.status(400).json({ ok: false, code: 'invalid_argument', error: 'viewpoint report rejected' });
    }
    const at = store.writeViewpoint(v); // the ONE writer; returns the server-stamped `at`
    res.json({ ok: true, at });
  });


  /**
   * World snapshot (doc-16 §3). Engine-initiated points — a plot beat, session
   * end, before a god-scale rewrite — plus an explicit player/god request. The
   * action owns the zip and the `world_snapshot` event; this route only resolves
   * the actor and the reason.
   */
  router.post('/snapshot', async (req, res) => {
    const store = getActiveStore();
    if (!store) return res.status(400).json({ error: 'No active world' });
    const body = req.body as { reason?: unknown };
    const reason = typeof body.reason === 'string' && body.reason.trim() !== ''
      ? body.reason.trim()
      : 'manual snapshot';
    await worldWrite(res, store, req.body?.expectedRevision, () => serviceFor(store, { type: 'god' }).snapshotWorld({ reason }));
  });

  /**
   * Roll back the world FILES to a snapshot (doc-16 §4). The event table is
   * append-only: this appends `world_rolled_back` and pushes every read cursor,
   * so the writer is told the world moved back but no history is deleted.
   */
  router.post('/rollback', async (req, res) => {
    const store = getActiveStore();
    if (!store) return res.status(400).json({ error: 'No active world' });
    const body = req.body as { snapshot?: unknown };
    if (typeof body.snapshot !== 'string' || body.snapshot.trim() === '') {
      return res.status(400).json({ ok: false, code: 'invalid_argument', error: 'snapshot must be a non-empty id' });
    }
    await worldWrite(res, store, req.body?.expectedRevision, () => serviceFor(store, { type: 'engine' }).rollbackWorld({ snapshot: body.snapshot }));
  });
  // God mode toggle freeze — a presentation toggle, not an action: it writes no
  // event and broadcasts a演出 frame directly.
  router.post('/freeze', (_req, res) => {
    const store = getActiveStore();
    if (!store) { res.status(409).json({ error: 'Load a world first.' }); return; }
    worldFrozen = !worldFrozen;
    eventBridge.broadcast({
      type: worldFrozen ? 'world_frozen' : 'world_thawed',
      timestamp: new Date().toISOString(),
      savePath: store.worldRoot,
    });
    res.json({ worldFrozen });
  });

  /**
   * God mode entity create/edit/delete — actor `god`, through the same actions
   * the tools use. `content` stays as an escape hatch for a whole-file god
   * rewrite; it is parsed into frontmatter + body so the single action path
   * still owns the event.
   */
  router.post('/god-action', async (req, res) => {
    const store = getActiveStore();
    if (!store) return res.status(400).json({ error: 'No active world' });
    const body = req.body as {
      action?: unknown;
      path?: unknown;
      frontmatter?: unknown;
      body?: unknown;
      content?: unknown;
      expectedRevision?: unknown;
      mode?: unknown;
    };
    const action = body.action;
    if (action !== 'create' && action !== 'update' && action !== 'delete') {
      return res.status(400).json({ ok: false, code: 'invalid_argument', error: 'action must be one of: create, update, delete' });
    }
    // Who may make world facts:
    // in a free / story world the player creates straight from the right-click
    // radial; a TRPG world keeps that to authoring mode (`mode: 'authoring'`,
    // the writer sheet open) or the author's own workshop draft, so a
    // player-made clue or NPC cannot break the case and the dice.
    if (body.mode !== undefined && body.mode !== 'play' && body.mode !== 'authoring') {
      return res.status(400).json({ ok: false, code: 'invalid_argument', error: 'mode must be play or authoring' });
    }
    if (body.mode !== 'authoring') {
      const manifest = await store.getManifest();
      if (!playersMayCreate(worldCategoryIdOf(manifest)) && !isAuthoringWorld(store.worldRoot, manifest as Record<string, unknown>)) {
        return res.status(403).json({ ok: false, code: 'not_in_this_world', error: 'In a TRPG world, scenes, characters, clues and chalk are made in authoring mode.' });
      }
    }
    const targetPath = body.path;
    if (typeof targetPath !== 'string' || targetPath === '') {
      return res.status(400).json({ ok: false, code: 'invalid_argument', error: 'path must be a non-empty world-relative path' });
    }

    let frontmatter = (typeof body.frontmatter === 'object' && body.frontmatter !== null
      ? (body.frontmatter as Record<string, unknown>)
      : undefined);
    let content = typeof body.body === 'string' ? body.body : undefined;
    if (typeof body.content === 'string') {
      const parsed = parseFrontmatter(body.content);
      frontmatter = frontmatter ?? (parsed.frontmatter ?? undefined);
      content = content ?? parsed.body;
    }

    const svc = serviceFor(store, { type: 'god' });
    if (action === 'delete') {
      await worldWrite(res, store, body.expectedRevision, () => svc.removeEntity({ path: targetPath }));
      return;
    }
    if (action === 'create') {
      await worldWrite(res, store, body.expectedRevision, () =>
        svc.createEntity({
          path: targetPath,
          body: content ?? '',
          ...(frontmatter ? { frontmatter } : {}),
        })
      );
      return;
    }
    await worldWrite(res, store, body.expectedRevision, () =>
      svc.editEntity({
        path: targetPath,
        ...(frontmatter ? { frontmatter } : {}),
        ...(content !== undefined ? { body: content } : {}),
      })
    );
  });

  /**
   * Content hashes of the active world's media:
   * `{ files: { "assets/scenes/world.jpg": "<32 hex>" } }`. The page builds
   * `/api/asset?…&h=<hash>` from it — an immutable URL the browser and the
   * Service Worker keep. Re-read after the world's files change.
   */
  router.get('/asset-index', async (_req, res) => {
    const store = getActiveStore();
    if (!store) return res.status(409).json({ ok: false, code: 'no_active_world', error: 'Choose a world or start a new save.' });
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, files: await worldAssetIndex(store.worldRoot) });
  });

  /**
   * Serve a world asset through an explicit media lane. The endpoint is shared
   * by scene images, portrait video and world audio; `kind` is required so a
   * caller cannot widen an image reference into another media type.
   */
  router.get('/asset', async (req, res) => {
    const store = getActiveStore();
    if (!store) return res.status(400).json({ error: 'No active world' });
    const rel = typeof req.query.path === 'string' ? req.query.path : '';
    if (!rel) return res.status(400).json({ error: 'path required' });
    const kind = typeof req.query.kind === 'string' ? req.query.kind : '';
    if (kind !== 'image' && kind !== 'video' && kind !== 'audio') {
      return res.status(400).json({
        ok: false,
        code: 'invalid_argument',
        error: 'kind must be one of: image, video, audio',
      });
    }
    try {
      const { absolutePath, mimeType } = await assertAssetReference(
        store.worldRoot,
        rel,
        kind,
      );
      res.type(mimeType);
      // `h` = the content hash from `/api/asset-index`: a match makes the URL
      // immutable (a player's world may be an unpublished draft, so `private`);
      // a stale `h` is served `no-cache` and never pinned.
      const cacheControl = typeof req.query.h === 'string' ? mediaCacheControl(req.query.h, await fileHash(absolutePath), 'private', null) : null;
      if (cacheControl) res.set('Cache-Control', cacheControl);
      res.sendFile(absolutePath, (err) => {
        if (err && !res.headersSent) {
          res.status(404).json({ ok: false, code: 'not_found', error: err.message });
        }
      });
    } catch (err) {
      if (err instanceof ActionError) {
        const body = err.toHttp().body;
        const status = err.code === 'invalid_asset_ref'
          ? (err.details.reason === 'not_found' ? 404 : 403)
          : err.httpStatus;
        return res.status(status).json(body);
      }
      return res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  /**
   * Serve ONE world file. A NEW route, NOT a fourth
   * `/asset` lane: `world/a/x.html` is under no approved asset root, and
   * widening those roots would weaken the three existing media lanes at the
   * same time (§7.1). The four checks are REUSED from `inspectAsset` with a
   * different root policy — no traversal check is written twice (§7.3).
   */
  router.get('/world-file', async (req, res) => {
    const store = getActiveStore();
    if (!store) return res.status(400).json({ error: 'No active world' });
    const rel = typeof req.query.path === 'string' ? req.query.path : '';
    if (!rel) {
      return res.status(400).json({ ok: false, code: 'invalid_argument', error: 'path required' });
    }
    try {
      const { absolutePath, mimeType } = await assertWorldFileReference(store.worldRoot, rel);
      // World files are AI-rewritable: `no-cache`, never `immutable` (§7.2).
      res.set('Cache-Control', 'no-cache');
      res.type(mimeType);
      res.sendFile(absolutePath, (err) => {
        if (err && !res.headersSent) {
          res.status(404).json({ ok: false, code: 'invalid_asset_ref', error: err.message });
        }
      });
    } catch (err) {
      if (err instanceof ActionError) {
        const body = err.toHttp().body;
        const status = err.code === 'invalid_asset_ref'
          ? (err.details.reason === 'not_found' ? 404 : 403)
          : err.httpStatus;
        return res.status(status).json({ ...body, details: err.details });
      }
      return res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  /**
   * Serve a platform audio clip from `<REPO_ROOT>/assets/audio` (the 31 produced
   * files). Same double traversal belt as `/asset`, plus a symlink re-check since
   * only the first check inspects the unresolved string. Clips are immutable build
   * artifacts, so they get a year-long `immutable` cache.
   */
  router.get('/audio', (req, res) => {
    let rel = String(req.query.path || '').replace(/^\/+/, '');
    if (!rel) return res.status(400).json({ error: 'path required' });
    if (rel.split('/').includes('..')) {
      return res.status(403).json({ error: 'path must not contain ..' });
    }
    // A platform file this copy does not carry (not redistributable) plays its stand-in.
    if (!existsSync(path.resolve(AUDIO_ROOT, rel))) rel = platformAudioFallback(rel) ?? rel;
    try {
      const abs = path.resolve(AUDIO_ROOT, rel);
      if (!abs.startsWith(AUDIO_ROOT + path.sep)) {
        return res.status(403).json({ error: 'path escapes audio root' });
      }
      const real = realpathSync(abs);
      if (!real.startsWith(realpathSync(AUDIO_ROOT) + path.sep)) {
        return res.status(403).json({ error: 'path escapes audio root (symlink)' });
      }
      // Platform clips are build artifacts: immutable with or without `h`. A
      // stale `h` (the clip was replaced under a live page) is the exception.
      const stale = typeof req.query.h === 'string' && knownFileHash(abs) !== null && knownFileHash(abs) !== req.query.h;
      res.sendFile(
        abs,
        { headers: { 'Cache-Control': stale ? 'no-cache' : 'public, max-age=31536000, immutable' } },
        (err) => {
          if (err && !res.headersSent) {
            res.status(404).json({ error: err.message });
          }
        }
      );
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
