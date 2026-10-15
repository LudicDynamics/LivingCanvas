/**
 * Scene media — the two things a world command can SHOW rather than change
 *:
 *
 *   - `showCg`         — a full-screen picture revealed to the player (a CG);
 *   - `swapBackground` — a layer's scene background, changed for good.
 *
 * Both only point at pictures that already exist in the world (`assets/…`, or a
 * generated `.airpworld/assets/…`): nothing is generated at play time.
 *
 * Where the truth lives (so reload AND rollback agree with what the page shows):
 *
 *   - a swapped background IS the layer README's `bg:` — the same field
 *     `/api/layer` already reads. A reload reads it back; a snapshot rollback
 *     restores the README and with it the old picture; `tools/refresh-save-art`
 *     leaves it alone because the save's value is no longer a template value.
 *     A status override was rejected: it would need a second reader beside
 *     `readLayerBg`, and two places that decide one picture drift.
 *   - the CGs a save has seen are `cg_log` in `world/README.md` — engine
 *     bookkeeping beside `trigger_log` (no event of its own, reserved from
 *     commands and agents). It is a world file, so a rollback forgets a CG
 *     seen after the snapshot, and `once` is answered from it.
 *
 * Each landed effect also appends ONE world event (`cg_shown` /
 * `background_swapped`) so the page learns about it live through `world_event`,
 * and the writer reads it next turn.
 */
import type { WorldEvent } from '../schemas/events.js';
import { parseFrontmatter, stringifyFrontmatter } from '../schemas/frontmatter.js';
import type { WorldStore } from '../store/world-store.js';
import { ENDING_RECORD_PATH } from './closed-world-state.js';
import { ActionError } from './errors.js';
import type { ActionContext } from './types.js';

/** `world/README.md` frontmatter key holding the CGs this save has shown. Engine-owned. */
export const CG_LOG_KEY = 'cg_log';
export const CG_LOG_PATH = ENDING_RECORD_PATH;
/** A long save cannot grow the README without bound. */
export const CG_LOG_MAX = 64;
export const CG_CAPTION_MAX = 300;

const IMAGE_EXT = /\.(webp|png|jpe?g|gif|avif)$/i;
const VIDEO_EXT = /\.(mp4|webm)$/i;
const MEDIA_ROOT = /^(assets|\.airpworld\/assets)\//;

export interface CgLogEntry {
  path: string;
  caption?: string;
  /** The request / agent turn that showed it. */
  turn: string | null;
  at: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Why `path` cannot be a scene picture, or `null` when its SHAPE is fine
 * (existence is checked separately). Pure — shared with the publish checks.
 */
export function sceneMediaPathProblem(path: unknown, kind: 'cg' | 'background'): string | null {
  if (typeof path !== 'string' || path.trim() === '') return 'a picture path is required';
  const p = path.trim();
  if (p.includes('..') || p.startsWith('/') || p.includes('\\')) return `"${p}" must be a world-relative path without ".."`;
  if (!MEDIA_ROOT.test(p)) return `"${p}" must be under assets/ (or a generated .airpworld/assets/)`;
  const ok = kind === 'cg' ? IMAGE_EXT.test(p) : IMAGE_EXT.test(p) || VIDEO_EXT.test(p);
  if (!ok) return `"${p}" is not ${kind === 'cg' ? 'an image' : 'an image or video'}`;
  return null;
}

async function assertSceneMedia(store: WorldStore, path: unknown, kind: 'cg' | 'background'): Promise<string> {
  const problem = sceneMediaPathProblem(path, kind);
  if (problem) throw new ActionError({ code: 'invalid_argument', message: `${kind === 'cg' ? 'show_cg' : 'swap_background'}: ${problem}` });
  const p = String(path).trim();
  if ((await store.statKind(p)) !== 'file') {
    throw new ActionError({ code: 'not_found', message: `Picture not found: "${p}" (generate or upload it before play).` });
  }
  return p;
}

/** Parse a raw `cg_log`; malformed entries are dropped. */
export function parseCgLog(raw: unknown): CgLogEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: CgLogEntry[] = [];
  for (const v of raw) {
    if (!isPlainObject(v) || typeof v.path !== 'string' || v.path === '') continue;
    out.push({
      path: v.path,
      ...(typeof v.caption === 'string' && v.caption ? { caption: v.caption } : {}),
      turn: typeof v.turn === 'string' ? v.turn : null,
      at: typeof v.at === 'string' ? v.at : '',
    });
  }
  return out;
}

/** The CGs this save has shown, oldest first. `[]` when none (or no world README). */
export async function readCgLog(store: WorldStore): Promise<CgLogEntry[]> {
  if ((await store.statKind(CG_LOG_PATH)) !== 'file') return [];
  return parseCgLog(parseFrontmatter(await store.readFile(CG_LOG_PATH)).frontmatter?.[CG_LOG_KEY]);
}

/** Bookkeeping write, like `trigger_log`: no event (the `cg_shown` event is the story fact). */
async function writeCgLog(store: WorldStore, log: CgLogEntry[]): Promise<void> {
  const exists = (await store.statKind(CG_LOG_PATH)) === 'file';
  const parsed = exists ? parseFrontmatter(await store.readFile(CG_LOG_PATH)) : { frontmatter: {}, body: '' };
  const fm: Record<string, unknown> = { ...(parsed.frontmatter ?? {}), [CG_LOG_KEY]: log.slice(-CG_LOG_MAX) };
  await store.writeFileAtomic(CG_LOG_PATH, stringifyFrontmatter(fm, parsed.body));
}

function playerLayerOf(store: WorldStore): string | undefined {
  try {
    return store.readViewpoint()?.layer ?? undefined;
  } catch {
    return undefined;
  }
}

export interface ShowCgInput {
  path: string;
  caption?: string;
  /** Default true: a CG this save has already shown is not shown again (`reused`). */
  once?: boolean | string;
}

export interface ShowCgResult {
  path: string;
  /** Absent when `reused`. */
  event?: WorldEvent;
  reused: boolean;
}

function flag(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const s = String(value).trim().toLowerCase();
  if (s === 'true' || s === 'yes' || s === '1') return true;
  if (s === 'false' || s === 'no' || s === '0') return false;
  throw new ActionError({ code: 'invalid_argument', message: `show_cg: once must be true or false, got "${String(value)}"` });
}

/** Show one CG to the player: record it in `cg_log`, append `cg_shown`. */
export async function showCg(ctx: ActionContext, input: ShowCgInput): Promise<ShowCgResult> {
  const { store } = ctx;
  const path = await assertSceneMedia(store, input?.path, 'cg');
  const once = flag(input?.once, true);
  const caption = typeof input?.caption === 'string' && input.caption.trim() ? input.caption.trim().slice(0, CG_CAPTION_MAX) : undefined;
  const log = await readCgLog(store);
  const seen = log.some((e) => e.path === path);
  if (once && seen) return { path, reused: true };
  const at = (ctx.now ?? (() => new Date().toISOString()))();
  // A repeat showing (once: false) moves the entry to the end instead of duplicating it:
  // the gallery lists each picture once, in the order last seen.
  const next = [...log.filter((e) => e.path !== path), { path, ...(caption ? { caption } : {}), turn: ctx.turn ?? null, at }];
  await writeCgLog(store, next);
  const event = await store.appendEvent({
    type: 'cg_shown',
    actor: ctx.actor,
    subject: path,
    layer: playerLayerOf(store),
    turn: ctx.turn,
    detail: { path, ...(caption ? { caption } : {}), first: !seen },
  });
  return { path, event, reused: false };
}

export interface SwapBackgroundInput {
  /** `map` (the root) or a layer directory `world/...`. */
  layer: string;
  path: string;
}

export interface SwapBackgroundResult {
  layer: string;
  readme: string;
  path: string;
  from: string | null;
  event?: WorldEvent;
  reused: boolean;
}

/** `map` / `world` → the root README; `world/...` → that layer's README. Pure. */
export function layerReadmeOf(layer: unknown): { layer: string; readme: string } | null {
  const l = String(layer ?? '').trim().replace(/\/+$/, '').replace(/\/README\.md$/, '');
  if (l === 'map' || l === 'world') return { layer: 'map', readme: 'world/README.md' };
  if (!/^world(\/[^/]+)+$/.test(l) || l.includes('..')) return null;
  return { layer: l, readme: `${l}/README.md` };
}

/** Point a layer README's `bg:` at `path` — for good (reload and rollback read the file). */
export async function swapBackground(ctx: ActionContext, input: SwapBackgroundInput): Promise<SwapBackgroundResult> {
  const { store } = ctx;
  const where = layerReadmeOf(input?.layer);
  if (!where) {
    throw new ActionError({ code: 'invalid_argument', message: `swap_background: layer "${String(input?.layer)}" must be map or a world/... layer` });
  }
  if ((await store.statKind(where.readme)) !== 'file') {
    throw new ActionError({ code: 'not_found', message: `swap_background: layer "${where.layer}" has no README.md` });
  }
  const path = await assertSceneMedia(store, input?.path, 'background');
  const parsed = parseFrontmatter(await store.readFile(where.readme));
  const fm: Record<string, unknown> = { ...(parsed.frontmatter ?? {}) };
  const from = typeof fm.bg === 'string' && fm.bg.trim() ? fm.bg.trim() : null;
  if (from === path && fm.bgVideo === undefined) {
    return { layer: where.layer, readme: where.readme, path, from, reused: true };
  }
  fm.bg = path;
  // A `bgVideo` animates the OLD picture; it would keep covering the new one.
  delete fm.bgVideo;
  await store.writeFileAtomic(where.readme, stringifyFrontmatter(fm, parsed.body));
  const name = typeof fm.name === 'string' && fm.name.trim()
    ? fm.name.trim()
    : typeof fm.title === 'string' && fm.title.trim() ? fm.title.trim() : where.layer.split('/').pop() ?? where.layer;
  const event = await store.appendEvent({
    type: 'background_swapped',
    actor: ctx.actor,
    subject: where.readme,
    layer: where.layer,
    turn: ctx.turn,
    detail: { layer: where.layer, name, path, ...(from ? { from } : {}) },
  });
  return { layer: where.layer, readme: where.readme, path, from, event, reused: false };
}
