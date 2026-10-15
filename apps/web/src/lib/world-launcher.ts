import { WORLD_CATEGORIES, worldCategoryOf } from '@airp/shared/themes';
import type { WorldShelf } from './airp-gateway.js';

/** World launcher helpers. */
export type ShelfGroup = NonNullable<WorldShelf['groups']>[number];

/**
 * The launcher's own music: the team's Suno track 「弹幕翻页夜」, looped seamlessly
 * and turned down to sit behind the wall. It lives only locally in
 * `assets/audio/licensed/` (gitignored); where it is absent the server plays
 * the calm piano bed instead (platformAudioFallback). LAUNCHER_CREDIT is shown when a track's terms require a credit
 * (e.g. 「音楽：魔王魂」 for a 魔王魂 track); this one needs none.
 */
export const LAUNCHER_THEME = '/api/audio?path=licensed%2Flauncher.mp3';
export const LAUNCHER_CREDIT = '';

/** Edition suffixes (tools/world-editions.mjs): English `<id>`, Japanese `<id>-jp`, Chinese `<id>-zh`, Korean `<id>-ko`. */
const EDITION_SUFFIX = /-(jp|zh|ko)$/;
const editionLocale = (group: ShelfGroup) => group.locale ?? 'en';
const LANGUAGE_ORDER = ['zh-CN', 'en', 'ja', 'ko'];

/**
 * The launcher's first brick is not a world but the door to making one
 *. It travels through `launcherWorlds` as a
 * synthetic group so the wall's geometry, repetition and hover logic need no
 * special case; only the brick's face differs.
 */
export const NEW_WORLD_ID = '__new-world__';
export const NEW_WORLD_GROUP: ShelfGroup = { id: NEW_WORLD_ID, name: '', templatePath: null, cover: null, locale: null, description: '', saves: [] };
export const isNewWorldBrick = (group: ShelfGroup) => group.id === NEW_WORLD_ID;

/**
 * One entry per world, in shelf order, after the new-world brick. The editions
 * of a curated world share an entry; the edition follows the interface
 * language. A curated (official or experimental) world with NO edition in the
 * interface language is left off the wall, its filters and counts
 * —
 * unless the player already has a save in one of its editions, which then
 * shows: the player's own play never disappears. Worlds made in the workshop
 * exist in ONE language and are never folded or hidden: each shows as itself,
 * in every interface language. Save-only groups (no template, no cover) stay
 * in the save manager, not the launcher.
 */
export function launcherWorlds(groups: readonly ShelfGroup[], locale: string): ShelfGroup[] {
  const byWorld = new Map<string, ShelfGroup[]>();
  const made: ShelfGroup[] = [];
  for (const group of groups) {
    if (!group.cover) continue;
    if (group.workshop) { made.push(group); continue; }
    if (!group.templatePath) continue;
    // A hidden world (the first-run prologue, the design notes) is reached another way, never from a tile.
    if (group.intro?.hidden) continue;
    const base = group.id.replace(EDITION_SUFFIX, '');
    byWorld.set(base, [...(byWorld.get(base) ?? []), group]);
  }
  const want = locale === 'ja' || locale === 'zh-CN' || locale === 'ko' ? locale : 'en';
  const curated = [...byWorld.values()].flatMap(editions => {
    const shown = editions.find(group => editionLocale(group) === want)
      ?? editions.find(group => (group.saves?.length ?? 0) > 0);
    if (!shown) return [];
    const languages = LANGUAGE_ORDER.filter(l => editions.some(group => editionLocale(group) === l));
    return [{ ...shown, languages }];
  });
  // The lobby order: 跑团 → 剧情 → 自由; inside a
  // category finished worlds before 实验 and 制作中 ones, 新手推荐 on top, then rank.
  const order = new Map(curated.map((group, index) => [group, index]));
  curated.sort((a, b) => introOrder(a) - introOrder(b) || (order.get(a) ?? 0) - (order.get(b) ?? 0));
  // The author's own worlds come first: they are what they came back for. Other
  // people's published worlds follow the official ones.
  const mine = made.filter(group => group.workshop?.mine);
  const others = made.filter(group => !group.workshop?.mine);
  return [NEW_WORLD_GROUP, ...mine, ...curated, ...others];
}

/** Sort key of a curated world: category, then 实验 last, then unfinished after finished, 新手推荐, rank. */
export function introOrder(group: ShelfGroup): number {
  const intro = group.intro;
  const category = WORLD_CATEGORIES.findIndex(c => c.id === group.category);
  return (category < 0 ? WORLD_CATEGORIES.length : category) * 1_000_000
    + (intro?.experimental ? 200_000 : 0)
    + (intro?.status && intro.status !== 'playable' ? 100_000 : 0)
    + (intro?.recommended ? 0 : 50_000)
    + Math.min(intro?.rank ?? 999, 999);
}

/**
 * The lobby's category filter: 「全部」 plus one
 * chip per category that has at least one world on the wall, in
 * WORLD_CATEGORIES order, with its count. A world without a category counts
 * only under 「全部」.
 */
export const ALL_CATEGORIES = 'all';
export interface CategoryChip { id: string; count: number }

/** A brick's category id, or null when it names none the table knows. */
export const categoryOfGroup = (group: ShelfGroup): string | null => worldCategoryOf(group.category)?.id ?? null;

export function categoryChips(worlds: readonly ShelfGroup[]): CategoryChip[] {
  const shown = worlds.filter(world => !isNewWorldBrick(world));
  const counts = new Map<string, number>();
  for (const world of shown) {
    const id = categoryOfGroup(world);
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return [{ id: ALL_CATEGORIES, count: shown.length }, ...WORLD_CATEGORIES.filter(c => counts.has(c.id)).map(c => ({ id: c.id, count: counts.get(c.id)! }))];
}

/**
 * The wall under a filter: 「＋ 新建」 stays first, then that category's worlds
 * in lobby order. A filter no chip offers any more shows everything.
 */
export function filterByCategory(worlds: readonly ShelfGroup[], category: string): ShelfGroup[] {
  if (category === ALL_CATEGORIES || !worlds.some(world => !isNewWorldBrick(world) && categoryOfGroup(world) === category)) return [...worlds];
  return worlds.filter(world => isNewWorldBrick(world) || categoryOfGroup(world) === category);
}

/** The chosen filter lasts the browser session (sessionStorage; fail-soft where storage throws). */
export const LOBBY_CATEGORY_KEY = 'airp.lobby.category';
type SessionStore = Pick<Storage, 'getItem' | 'setItem'>;
const sessionStore = (): SessionStore | null => { try { return globalThis.sessionStorage ?? null; } catch { return null; } };
export function readLobbyCategory(storage: Pick<Storage, 'getItem'> | null = sessionStore()): string {
  try {
    const value = storage?.getItem(LOBBY_CATEGORY_KEY);
    return value && worldCategoryOf(value) ? value : ALL_CATEGORIES;
  } catch {
    return ALL_CATEGORIES;
  }
}
export function writeLobbyCategory(category: string, storage: Pick<Storage, 'setItem'> | null = sessionStore()): void {
  try { storage?.setItem(LOBBY_CATEGORY_KEY, category); } catch { /* not remembered, still applied */ }
}

/**
 * Does a click on this brick open the world's intro card?
 * Every world a player may start — official, or someone's published world. The
 * author's own made world keeps its in-brick actions (keep building, publish).
 */
export function opensIntroCard(group: ShelfGroup): boolean {
  return !isNewWorldBrick(group) && Boolean(group.templatePath || group.saves.length) && !group.workshop?.mine;
}

/** Edition label on a brick. */
export function editionLabel(locale: string | null | undefined): string {
  return locale === 'ja' ? '日本語' : locale === 'zh-CN' ? '中文' : locale === 'ko' ? '한국어' : 'English';
}

/** "霧埠の町 · 日本語" → "霧埠の町": the edition is implied by the interface language. */
export function worldTitle(name: string): string {
  return name.split(' · ')[0]?.trim() || name;
}

/**
 * Which world sits in brick (col, row) of the endless wall. Odd rows are shifted
 * half a brick, so a brick touches ±1 in its row and +2/+3 (or −2/−3) across
 * rows: with five or more worlds, no two touching bricks repeat.
 */
export function brickWorld(col: number, row: number, count: number): number {
  if (count <= 0) return 0;
  return (((col + 3 * row) % count) + count) % count;
}

export interface BrickGeometry { w: number; h: number; gap: number }

/** Brick size for a viewport width: about three bricks across, 280–520px wide. */
export function brickGeometry(viewportWidth: number): BrickGeometry {
  const w = Math.round(Math.min(520, Math.max(280, viewportWidth * 0.3)));
  return { w, h: Math.round(w * 0.6), gap: Math.round(w * 0.05) };
}

/** One pointer sample of a drag: when (ms) and where the wall was (px, wall coordinates). */
export interface PanSample { t: number; x: number; y: number }
/** How far back the release velocity looks: long enough to smooth one jittery event, short enough to follow a flick. */
export const VELOCITY_WINDOW_MS = 90;

/**
 * Wall velocity (px/ms) at the release of a drag, from the samples of the last
 * VELOCITY_WINDOW_MS before `now`: displacement over elapsed time, not the
 * last event alone. A single pointermove can arrive 1ms or 30ms after the one
 * before it, so one-event velocity threw the coast at a random speed. Zero
 * when the pointer held still before release (the newest sample is older
 * than `holdMs`) or there is too little to measure.
 */
export function releaseVelocity(samples: readonly PanSample[], now: number, holdMs: number, maxSpeed: number): { vx: number; vy: number } {
  const newest = samples[samples.length - 1];
  if (!newest || now - newest.t > holdMs) return { vx: 0, vy: 0 };
  let oldest = newest;
  for (let i = samples.length - 1; i >= 0 && newest.t - samples[i].t <= VELOCITY_WINDOW_MS; i--) oldest = samples[i];
  const elapsed = newest.t - oldest.t;
  if (elapsed < 8) return { vx: 0, vy: 0 };
  const clamp = (value: number) => Math.max(-maxSpeed, Math.min(maxSpeed, value));
  return { vx: clamp((newest.x - oldest.x) / elapsed), vy: clamp((newest.y - oldest.y) / elapsed) };
}

/** Speed kept per 16ms of coast. */
export const GLIDE_DECAY_PER_16MS = 0.94;
/** Below this speed (px/ms) the coast stops. */
export const GLIDE_STOP_SPEED = 0.02;
/** Longest frame gap a coast step integrates: a long stall must not throw the wall. */
export const GLIDE_MAX_STEP_MS = 64;

/**
 * One coast step over `dt` ms: the distance travelled and the decayed velocity.
 * Time-based (exact integral of v·decay^(t/16)), so a dropped frame moves the
 * wall as far as the two frames it replaced would have: the speed curve does
 * not depend on the frame rate.
 */
export function glideStep(vx: number, vy: number, dt: number): { dx: number; dy: number; vx: number; vy: number } {
  const step = Math.max(0, Math.min(GLIDE_MAX_STEP_MS, dt));
  const decay = Math.pow(GLIDE_DECAY_PER_16MS, step / 16);
  // ∫0^step v·k^(t/16) dt = v·16·(k^(step/16) − 1)/ln k
  const travel = step === 0 ? 0 : (16 * (decay - 1)) / Math.log(GLIDE_DECAY_PER_16MS);
  return { dx: vx * travel, dy: vy * travel, vx: vx * decay, vy: vy * decay };
}

/**
 * Where the wall opens: brick (0, 0) — the new-world brick — at the stage's
 * top-left, a gap in from the edges. Reading right then down from there
 * follows the lobby order; the wrapped end of the list sits up and to the
 * left, out of view.
 */
export function startPan(geometry: BrickGeometry): { x: number; y: number } {
  return { x: -(geometry.gap + 12), y: -geometry.gap };
}

export interface Brick { col: number; row: number; left: number; top: number }

/** Every brick overlapping the rectangle (x, y, width, height) of the wall, plus `margin` bricks around it. */
export function visibleBricks(x: number, y: number, width: number, height: number, geometry: BrickGeometry, margin = 1): Brick[] {
  const cellW = geometry.w + geometry.gap;
  const cellH = geometry.h + geometry.gap;
  const bricks: Brick[] = [];
  for (let row = Math.floor(y / cellH) - margin; row <= Math.floor((y + height) / cellH) + margin; row++) {
    const shift = (row & 1) ? cellW / 2 : 0;
    for (let col = Math.floor((x - shift) / cellW) - margin; col <= Math.floor((x + width - shift) / cellW) + margin; col++) {
      bricks.push({ col, row, left: col * cellW + shift, top: row * cellH });
    }
  }
  return bricks;
}

/** Where a new game of a world starts, and whether it must be asked for as a fresh copy. */
export interface RestartTarget { path: string; fresh: boolean }

/**
 * The in-world 「重新开始这个世界」 and the closed run's "Play again" start the
 * SAME thing the launcher's "＋ Start a new game" does: a fresh save of the
 * world, leaving the current save on the shelf. A template or a published
 * world has a `templatePath`; a draft made in the workshop has none, so its
 * author starts a fresh play copy of the draft (`fresh`, server-checked). A
 * world the shelf does not know falls back to its template id when one exists.
 */
export function restartTargetOf(shelf: WorldShelf, worldId: string | null | undefined): RestartTarget | null {
  if (!worldId) return null;
  const groups = shelf.groups ?? [];
  const group = groups.find(g => g.id === worldId) ?? groups.find(g => g.saves.some(s => s.active));
  if (group?.templatePath) return { path: group.templatePath, fresh: false };
  if (group?.workshop?.mine && group.workshop.editPath) return { path: group.workshop.editPath, fresh: true };
  if (shelf.templates.includes(worldId) || shelf.expTemplates?.includes(worldId)) return { path: `templates/${worldId}`, fresh: false };
  return null;
}

/**
 * 试玩: the draft a trial came from, when the
 * world in hand is a play copy of a world the current seat made. The author's
 * original is the one save whose `authoring` is true; any other save of a
 * world the shelf marks `mine` with an `editPath` is a copy of it, and
 * 「结束试玩，回到编辑」 loads that path again (in place, not fresh).
 */
export function trialOriginOf(
  shelf: WorldShelf,
  manifest: { id?: string; authoring?: boolean; workshop?: unknown } | null | undefined,
): string | null {
  if (!manifest?.id || manifest.authoring === true || !manifest.workshop) return null;
  const group = (shelf.groups ?? []).find(g => g.id === manifest.id);
  return group?.workshop?.mine && group.workshop.editPath ? group.workshop.editPath : null;
}

/**
 * How far to move the wall along one axis so a box [start, end] sits inside [lo, hi] (smoke test 2026-10-05: on a
 * 390px phone an opened brick half off the left edge kept its 「开始新游戏」 off screen). 0 when it already fits;
 * a box larger than the room aligns its start. The result is the pan change (`panBy`): the wall's point at the
 * stage's top-left moves by it, so the box moves by minus it.
 */
export function revealDelta(start: number, end: number, lo: number, hi: number): number {
  if (end - start > hi - lo) return start - lo;
  if (start < lo) return start - lo;
  if (end > hi) return end - hi;
  return 0;
}
