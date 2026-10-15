/**
 * The two presentation moments on the page:
 *
 *   1. entering a scene this save has never entered → a popup (「打开了新的地点」)
 *      with its animated picture (`bgVideo`) played once, closing by itself
 *      (`scenePopPlan`); the save's opening scene keeps the fuller title →
 *      clip → settle presentation (`scenePlan`);
 *   2. obtaining an item (a new file in the bag) → the item, its art, its name.
 *   The two popups are a matched pair: one frame language, two accents.
 *
 * Nothing else presents, and nothing stays on screen afterwards: no counter,
 * no badge, no progress. The server reports the facts (`GET /api/world/run` →
 * `moments`); the page compares two consecutive reads of the SAME save and
 * presents what became true in between. The first read after a load is the
 * baseline, so a reload, a reconnect or a world switch never replays anything
 *.
 *
 * Pure helpers only; the component is `components/chrome/MilestoneStage.tsx`.
 */

export interface MomentScene {
  layer: string;
  name: string;
  video: string | null;
  poster: string | null;
}

export interface MomentItem {
  path: string;
  filename: string;
  name: string;
  frontmatter: Record<string, unknown>;
  summary: string | null;
}

export interface RunMoments {
  scenes: MomentScene[];
  items: MomentItem[];
}

export type Milestone =
  | { kind: 'scene'; id: string; scene: MomentScene; /** The save's first arrival: the start scene, after the world intro. */ opening?: true }
  | { kind: 'item'; id: string; item: MomentItem };

/** The DOM event a scene tile in the bag dispatches to play its animated picture full-size. */
export const SCENE_REPLAY_DOM = 'airp:scene-replay';

/** More moments than this waiting at once means a burst (a cascade): keep the newest few. */
export const MILESTONE_QUEUE_MAX = 4;
/** How long the scene's name holds before its animated picture (or the end). */
export const SCENE_TITLE_MS = 2000;
/** Reduced motion: the name still shows, without the picture, a little shorter. */
export const SCENE_TITLE_MS_STILL = 1500;
/** The picture's settle into the backdrop / the bag. */
export const SETTLE_MS = 900;
/** An item card stays this long unless dismissed. */
export const ITEM_MS = 3200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** The server's `moments`, defensively: anything malformed reads as "nothing". */
export function normalizeMoments(raw: unknown): RunMoments | null {
  if (!isRecord(raw) || !Array.isArray(raw.scenes) || !Array.isArray(raw.items)) return null;
  return {
    scenes: raw.scenes.filter(isRecord).filter((s) => typeof s.layer === 'string').map((s) => ({
      layer: s.layer as string,
      name: str(s.name) ?? (s.layer as string),
      video: str(s.video),
      poster: str(s.poster),
    })),
    items: raw.items.filter(isRecord).filter((i) => typeof i.path === 'string').map((i) => ({
      path: i.path as string,
      filename: str(i.filename) ?? (i.path as string).split('/').pop()!,
      name: str(i.name) ?? (i.path as string).split('/').pop()!,
      frontmatter: isRecord(i.frontmatter) ? i.frontmatter : {},
      summary: str(i.summary),
    })),
  };
}

/**
 * What became true between two reads of the same save: scenes entered for
 * the first time, then items newly in the bag. A null `prev` is the baseline:
 * nothing. Anything that went away (a rollback, a dropped item) presents nothing.
 */
export function milestonesBetween(prev: RunMoments | null, next: RunMoments | null): Milestone[] {
  if (!prev || !next) return [];
  const out: Milestone[] = [];
  const seen = new Set(prev.scenes.map((s) => s.layer));
  for (const scene of next.scenes) if (!seen.has(scene.layer)) out.push({ kind: 'scene', id: `scene:${scene.layer}`, scene });
  const held = new Set(prev.items.map((i) => i.path));
  for (const item of next.items) if (!held.has(item.path)) out.push({ kind: 'item', id: `item:${item.path}`, item });
  return out;
}

/** Add moments to the queue: the same id twice is dropped; the queue is bounded. */
export function enqueueMilestones(queue: readonly Milestone[], add: readonly Milestone[]): Milestone[] {
  const next = [...queue];
  for (const m of add) if (!next.some((q) => q.id === m.id)) next.push(m);
  return next.length > MILESTONE_QUEUE_MAX ? next.slice(next.length - MILESTONE_QUEUE_MAX) : next;
}

/** Scenes entered that have an animated picture, one per clip: what the bag can replay. */
export function sceneReel(moments: RunMoments | null): MomentScene[] {
  if (!moments) return [];
  const out: MomentScene[] = [];
  for (const s of moments.scenes) if (s.video && !out.some((o) => o.video === s.video)) out.push(s);
  return out;
}

/**
 * Merge switch. On: each presentation is the one
 * line about its moment — an item obtained shows ONLY the item card (its
 * "Created …" / "moved …" world-event toast is not shown), and a scene entered
 * for the first time shows ONLY its title card (its "Entered …" toast is not
 * shown). Off: both show. `localStorage['airp.milestones.mergeToasts'] = 'off'`.
 */
export const MERGE_TOASTS_KEY = 'airp.milestones.mergeToasts';
export function mergeMomentToasts(): boolean {
  try {
    return localStorage.getItem(MERGE_TOASTS_KEY) !== 'off';
  } catch {
    return true;
  }
}

function layerDirOf(layer: string): string {
  const l = layer.trim().replace(/^\/+|\/+$/g, '');
  return l === '' || l === 'map' ? 'world' : l;
}

/** The layer a `layer_entered` world event entered (as a directory), or null for any other event. */
export function sceneEnteredLayer(ev: unknown): string | null {
  if (!isRecord(ev) || ev.type !== 'layer_entered') return null;
  const d = isRecord(ev.detail) ? ev.detail : {};
  const layer = typeof d.layer === 'string' ? d.layer : typeof ev.layer === 'string' ? ev.layer : null;
  return layer ? layerDirOf(layer) : null;
}

/**
 * Scene cards claim their "Entered …" toast. `useWorld` holds a
 * `layer_entered` toast for `SCENE_CLAIM_MS` (the run re-read that finds a
 * first visit lands well inside it); if a title card claimed that layer
 * meanwhile, the toast is not shown, otherwise it shows a moment late.
 */
export const SCENE_CLAIM_MS = 1500;
const claimedScenes = new Map<string, number>();
export function claimSceneToast(layer: string, now: number = Date.now()): void {
  claimedScenes.set(layerDirOf(layer), now);
}
export function sceneToastClaimed(layer: string, now: number = Date.now()): boolean {
  const at = claimedScenes.get(layerDirOf(layer));
  return at !== undefined && now - at <= SCENE_CLAIM_MS * 4;
}

/**
 * While a scene card or its animation is on screen, system notices (the voice
 * notice, the app's own toast) wait and show right after — never dropped.
 */
let stageBusy = false;
const busyListeners = new Set<() => void>();
const idleWaiters: Array<() => void> = [];
export function isStageBusy(): boolean {
  return stageBusy;
}
export function setStageBusy(busy: boolean): void {
  if (stageBusy === busy) return;
  stageBusy = busy;
  for (const l of [...busyListeners]) l();
  if (!busy) for (const run of idleWaiters.splice(0)) run();
}
export function subscribeStageBusy(listener: () => void): () => void {
  busyListeners.add(listener);
  return () => { busyListeners.delete(listener); };
}
/** Run now when idle, else right after the stage frees up. */
export function whenStageIdle(run: () => void): void {
  if (!stageBusy) run();
  else idleWaiters.push(run);
}

/** A world event that puts an item in the bag: created in `player/`, or moved into it. */
export function isItemObtainedEvent(ev: unknown): boolean {
  if (!isRecord(ev) || !isRecord(ev.detail)) return false;
  const d = ev.detail;
  const into = ev.type === 'entity_created' ? d.path : ev.type === 'entity_moved' ? d.to : null;
  return typeof into === 'string' && /^player\/[^/]+$/.test(into) && into !== 'player/README.md';
}

export type SettleTarget = 'backdrop' | 'bag';

export interface ScenePlan {
  titleMs: number;
  /** Play the scene's animated picture full-size after its name. */
  playVideo: boolean;
  /** Canvas view: dissolve into the scene backdrop. Map view (no backdrop): shrink into the bag, where it can be replayed. */
  settle: SettleTarget;
  settleMs: number;
}

/**
 * How a scene entry plays under the viewer's preferences. Reduced motion keeps
 * the name (it is information) but never plays the picture or moves it; the
 * picture can still be played from the bag on request.
 */
/**
 * `effects` is the Effects toggle: the scene's animated picture is an effect, so
 * with it off only the name card (and its sting) plays, then the settled
 * backdrop — the clip stays in the bag's reel, on demand (§2).
 */
export function scenePlan(opts: { reducedMotion: boolean; effects: boolean; hasVideo: boolean; view: 'canvas' | 'map' }): ScenePlan {
  const settle: SettleTarget = opts.view === 'map' ? 'bag' : 'backdrop';
  if (opts.reducedMotion) return { titleMs: SCENE_TITLE_MS_STILL, playVideo: false, settle, settleMs: 0 };
  return { titleMs: SCENE_TITLE_MS, playVideo: opts.hasVideo && opts.effects, settle, settleMs: SETTLE_MS };
}

/* ───────────────────────── the new-scene popup ─────────────────────────
 * A new scene entered during play is something the player OBTAINS, the same
 * family as an item: a popup (never the whole screen) with the place's moving
 * picture and 「打开了新的地点：…」, played once, then it closes by itself. The
 * save's opening scene keeps the fuller title → clip → settle presentation
 * (`scenePlan` above): it is the world's first look, not a find.
 */

/**
 * `motion`: the scene's clip plays once in the popup's window.
 * `still`: the scene's picture with a slow Ken Burns drift (no clip, or the clip failed).
 * `static`: Effects off or reduced motion — a small toast-like card low centre
 * (the item card's place), nothing moves, no scrim.
 */
export type ScenePopMode = 'motion' | 'still' | 'static';

export interface ScenePopPlan {
  mode: ScenePopMode;
  /** The popup stays at least this long once shown (motion: the floor while the clip plays). */
  holdMs: number;
  /** Never longer than this once shown (a clip that never reports `ended`). */
  maxMs: number;
  /** The exit: a fade, or the flight into the bag. */
  exitMs: number;
  /** On close, fly into the bag button: the clip joins the bag's scene reel (§4). */
  flyToBag: boolean;
  /** A dim, click-to-close scrim behind the popup (static mode has none: it is a toast). */
  scrim: boolean;
}

/** Still mode (picture + Ken Burns) holds this long. */
export const SCENE_POP_MS = 4200;
/** Static card (Effects off / reduced motion): the item card's length. */
export const SCENE_POP_STATIC_MS = ITEM_MS;
/** Motion: the popup stays at least this long, even for a short clip. */
export const SCENE_POP_MIN_MS = 3200;
/** Motion: after the clip's last frame, a short beat before it closes. */
export const SCENE_POP_TAIL_MS = 700;
/** Motion: a clip that never ends still hands over (the worlds' clips run about 6 s). */
export const SCENE_POP_MAX_MS = 10_000;
/** Media decodes before the popup shows; past this it shows with what it has. */
export const SCENE_POP_DECODE_MS = 1200;
/** The exit (fade, or the flight into the bag). */
export const SCENE_POP_EXIT_MS = 520;
/** Reduced motion reads a little longer, like the item card. */
export const SCENE_POP_STILL_EXTRA_MS = 800;

/**
 * How a scene entered during play pops up under the viewer's preferences.
 * Effects on (balanced / quality): the clip (or the picture drifting); Effects
 * off (performance) and reduced motion: the small static card. Every mode keeps
 * the name and the sting: they are information.
 */
export function scenePopPlan(opts: { reducedMotion: boolean; effects: boolean; hasVideo: boolean; hasPoster: boolean }): ScenePopPlan {
  if (opts.reducedMotion || !opts.effects) {
    const hold = SCENE_POP_STATIC_MS + (opts.reducedMotion ? SCENE_POP_STILL_EXTRA_MS : 0);
    return { mode: 'static', holdMs: hold, maxMs: hold, exitMs: opts.reducedMotion ? 0 : 240, flyToBag: false, scrim: false };
  }
  if (opts.hasVideo) return { mode: 'motion', holdMs: SCENE_POP_MIN_MS, maxMs: SCENE_POP_MAX_MS, exitMs: SCENE_POP_EXIT_MS, flyToBag: true, scrim: true };
  // No clip: nothing joins the bag's reel, so it closes in place.
  const hold = opts.hasPoster ? SCENE_POP_MS : SCENE_POP_STATIC_MS;
  return { mode: 'still', holdMs: hold, maxMs: hold, exitMs: SCENE_POP_EXIT_MS, flyToBag: false, scrim: true };
}

/**
 * How long until the popup starts closing, `elapsedMs` after it was shown.
 * Motion waits for the clip (`clipEnded`), then a beat — never under the hold,
 * never past the max. The others just hold.
 */
export function scenePopRemainingMs(plan: ScenePopPlan, elapsedMs: number, clipEnded: boolean): number {
  const cap = Math.max(0, plan.maxMs - elapsedMs);
  if (plan.mode !== 'motion') return Math.max(0, plan.holdMs - elapsedMs);
  if (!clipEnded) return cap;
  return Math.min(cap, Math.max(SCENE_POP_TAIL_MS, plan.holdMs - elapsedMs));
}
