import type { TickView } from '@airp/shared/tick';
import type { HintView } from '@airp/shared/hints';
import { PLAYER_ACT_EVENT, PLAYER_ACT_ROUTES } from './tick/beat.js';
import type { WorldSettings } from '@airp/shared/world-settings';
import type {
  ChooseOptionDetails,
  EnterLayerDetails,
  MoveEntityDetails,
  UseItemOnDetails,
} from '@airp/shared';
// Subpath import, NOT the root barrel: the barrel pulls in `node:crypto`
// (`schemas/canvas.ts`) and breaks the browser build. Same convention as
// `@airp/shared/forms` / `@airp/shared/characters`.
import { PROTOCOL_VERSION } from '@airp/shared/protocol';
import { forgetAssetHash, setAssetIndex, worldAssetUrl } from './asset-index.js';
import { deviceId } from './invite.js';
import { perfSocketFrame, perfSocketSend } from './perf.js';
import { noteCue } from './tutorial-cues.js';

export type AssetMediaKind = 'image' | 'video' | 'audio';

export interface WorldShelf {
  /** Shipped edition template ids only (experimental sandboxes excluded). */
  templates: string[];
  /** Experimental sandbox template ids (`world.json` `exp: true`). */
  expTemplates?: string[];
  worlds: string[];
  groups?: {
    id: string;
    name: string;
    templatePath: string | null;
    /** Launcher cover URL (`/api/worlds/cover`); templates only. */
    cover?: string | null;
    /** Launcher video URL; templates with an intro video only. */
    coverVideo?: string | null;
    locale?: string | null;
    description?: string;
    /** Experimental sandbox (`world.json` `exp: true`), not a shipped edition. */
    exp?: boolean;
    /**
     * A world made in the workshop. `mine` — this
     * seat is its author; `editPath` — the author's original save, the one that
     * opens for editing; `templatePath` is `published/<id>` once published.
     * `official` — the owner's editable copy of an official edition
     * republished on the remote, never withdrawn from the brick.
     */
    workshop?: { status: 'draft' | 'published'; owner: string; mine: boolean; editPath: string | null; publishedAt?: string; official?: true };
    /** The lobby's "what is this world" card; templates and published worlds. */
    intro?: ShelfIntro;
    /** 跑团世界 / 剧情世界 / 自由世界 id (`WORLD_CATEGORIES`); null/absent: shown only under 「全部」. */
    category?: string | null;
    /** Edition locales of this world, set by the launcher (lib/world-launcher.ts `launcherWorlds`). */
    languages?: string[];
    saves: { id: string; path: string; updatedAt: string; active: boolean; place?: SavePlace }[];
    /**
     * 官方 / 云端 / 本机: `pending` — a 云端 original with changes not uploaded
     * yet (「本机 · 未同步」); `conflict` — the cloud copy moved on while this one changed too. Absent on an
     * older server.
     */
    place?: { kind: 'official' | 'cloud' | 'local'; pending: boolean; conflict: boolean };
  }[];
}

/** Where one save lives: only an author's original can be 云端; an official edition's owner copy stays 官方. */
export interface SavePlace { location: 'official' | 'cloud' | 'local'; pending: boolean; conflict: boolean }

/** `GET|POST /api/remote/sync`: the last pass over the 云端 worlds. */
export interface WorldSyncStatus {
  ok: boolean;
  signedIn: boolean;
  running: boolean;
  lastRunAt: string | null;
  lastError: string | null;
  worlds: { path: string; id: string; name: string; state: 'synced' | 'pending' | 'pushed' | 'pulled' | 'behind' | 'conflict' | 'error'; error?: string }[];
  /** 「两份都保留」 only: the save path of the cloud version that came down as a second world. */
  copyPath?: string;
}

/** One lobby card (apps/server/src/lobby-intro.ts `ShelfIntro`); enum ids from @airp/shared/world-intro. */
export interface ShelfIntro {
  status: 'playable' | 'in-development' | 'experimental' | null;
  /** The 「实验」 badge. */
  experimental?: boolean;
  /** Not a lobby tile of its own (intro.hidden): the first-run prologue. */
  hidden?: boolean;
  recommended: boolean;
  rank: number | null;
  hook: string;
  genres: string[];
  loop: string[];
  minutes: [number, number] | null;
  difficulty: 'intro' | 'standard' | 'hardcore' | null;
  mechanics: string[];
  endings: number;
  rules: 'coc' | 'dnd' | null;
  characters: { name: string; line: string; avatar: string | null }[];
  for: string[];
  unfinished: string | null;
  /** No authored intro: read off the world's own data. */
  derived: boolean;
  /** The world declares a character tick; `wip` = 「制作中」. */
  characterTick?: { wip: boolean };
}

/** `POST /api/worlds/create` body. */
export interface CreateWorldRequest {
  name: string;
  description: string;
  locale: 'en' | 'ja' | 'zh-CN' | 'ko';
  playerName?: string;
  cover: { kind: 'generate'; prompt: string } | { kind: 'upload'; mimeType: string; dataB64: string };
  /** World type, rule pack and structure flags. */
  theme?: WorldThemeRequest;
  /** The view the world opens in (world.json `view.default`). Absent → canvas. */
  view?: 'canvas' | 'map';
  /** 本机 / 云端. */
  location?: 'cloud' | 'local';
}

/** `theme` as the create form sends it; the server validates it against the shared registry. */
export interface WorldThemeRequest {
  players: 'single';
  /** Absent for a legacy theme whose author has not picked a type. */
  type?: string;
  rules: string;
  structure: Record<string, boolean>;
}

/** `GET /api/world-intro`: the first-entry popup of a workshop world. */
export interface WorldIntroState {
  workshop: boolean;
  shown: boolean;
  canSuggest: boolean;
  intro: { title: string; kicker: string; lines: string[] };
  fields: WorldIntroFields;
}

export interface WorldIntroFields {
  identity: string;
  goal: string;
  first: string;
}

export interface CreateWorldResult {
  ok: boolean;
  id: string;
  /** `worlds/<id>`, ready for `loadWorld`. */
  worldPath: string;
}

export interface WorldLoadResult<TManifest = Record<string, unknown>> {
  ok: boolean;
  manifest: TManifest;
  path: string;
  /** Content hashes of the world's media; absent from an older server. */
  assetIndex?: Record<string, string>;
}

export class AirpRequestError extends Error {
  constructor(message: string, public status: number, public payload: Record<string, unknown> | null) {
    super(message);
    this.name = 'AirpRequestError';
  }
}

// `no_active_world` is a durable state, not a one-shot moment: the initial
// `loadChromeData` can resolve before the App's listener registers (a StrictMode
// remount or a slow first paint opens that gap), and a lost signal strands the
// player on a blank canvas while the backend only needs a world chosen. Record
// the state here and replay it to late subscribers (the design notes: release the
// input lock and make the world shelf topmost).
let worldUnavailable = false;
const worldUnavailableListeners = new Set<() => void>();

/**
 * Observe the "no active world" state. When a world-scoped reply has already
 * answered `no_active_world`, the listener runs immediately so a late
 * subscriber cannot miss it. Returns an unsubscribe function.
 */
export function onWorldUnavailable(listener: () => void): () => void {
  worldUnavailableListeners.add(listener);
  if (worldUnavailable) listener();
  return () => { worldUnavailableListeners.delete(listener); };
}

export type PlayerNoteColor = 'yellow' | 'pink' | 'blue' | 'green';
export type PlayerNoteSize = 's' | 'm' | 'l';
export type PlayerTagValue = 'suspect' | 'confirmed' | 'irrelevant';
export type PlayerNoteRequest =
  | { op: 'create'; layer: string; text: string; color?: PlayerNoteColor; size?: PlayerNoteSize; x?: number; y?: number }
  | { op: 'update'; path: string; text?: string; color?: PlayerNoteColor; size?: PlayerNoteSize }
  | { op: 'delete'; path: string };
export type PlayerBoardRequest =
  | { op: 'link'; from: string; to: string; label?: string }
  | { op: 'unlink'; id: string }
  | { op: 'tag'; path: string; tag: PlayerTagValue | null };
export interface PlayerBoardView {
  links: { id: string; layer: string; from: string; to: string; label?: string }[];
  tags: Record<string, PlayerTagValue>;
}

/** True from a `no_active_world` answer until the next world loads: the page is reopening or choosing a world. */
export function isWorldUnavailable(): boolean {
  return worldUnavailable;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const message = await response.text();
    let payload: Record<string, unknown> | null = null;
    try { payload = JSON.parse(message); } catch { /* Keep non-JSON diagnostics. */ }
    if (payload?.code === 'no_active_world') {
      worldUnavailable = true;
      // `useWorld` and the live-call forwarder still consume the DOM event.
      if (typeof window !== 'undefined') window.dispatchEvent(new Event('airp:world-unavailable'));
      for (const listener of worldUnavailableListeners) listener();
    }
    throw new AirpRequestError(`${init?.method ?? 'GET'} ${url} -> ${response.status}${message ? ` ${message}` : ''}`, response.status, payload);
  }
  // The player's own move landed: one signal toward the character tick's beat (lib/tick/beat.ts; coalesced
  // with the world event that follows, so either path alone is enough).
  if (init?.method === 'POST' && PLAYER_ACT_ROUTES.includes(url) && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(PLAYER_ACT_EVENT, { detail: { route: url } }));
  }
  return response.json() as Promise<T>;
}

/** A result's teach-once cue: its own `cue`, or a passive check's. */
function tapCue<T>(body: T): T {
  const b = body as Record<string, any> | null;
  const d = b && typeof b.details === 'object' && b.details ? b.details : b;
  const cue = d?.cue ?? d?.passive?.cue;
  if (cue && typeof document !== 'undefined') noteCue(cue, document.documentElement.lang || 'en');
  return body;
}

function json(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

/**
 * The localhost-only settings routes (and the hosted token routes) want a
 * custom header: it forces a CORS preflight, so no other site can drive them
 * with the player's cookie.
 */
function settingsRequest(init: RequestInit): RequestInit {
  return { ...init, headers: { ...((init.headers as Record<string, string> | undefined) ?? {}), 'X-AIRP-Settings': '1' } };
}

/** `GET /api/remote/settings`: who is signed in, never a token. */
export interface RemoteSettings {
  ok: boolean; url: string; defaultUrl: string; custom: boolean; signedIn: boolean; email: string | null; uid: string | null; pending: boolean; playRequiresAccount?: boolean; playAccountScope?: 'all' | 'shared' | 'none';
  /** The guest trial is on here (the trial world plays signed out). */
  guestTrial?: boolean;
  /** App login (identity spec §2.4): the app this computer signed in as and what it may do. */
  app?: { clientId: string; scopes: string[] } | null;
  /** A sign-in with a code in progress (device flow). */
  device?: { status: 'waiting' | 'done' | 'failed'; userCode?: string; verificationUri?: string; verificationUriComplete?: string | null; error?: string } | null;
}
/** `GET|POST /api/remote/guest` (apps/server sync/guest-session.ts). */
export interface GuestTrialView { ok?: boolean; enabled: boolean; signedIn: boolean; active: boolean; credits: number; remaining: number | null; low: boolean; refused: string | null; refusedBy?: 'device' | 'network' | 'device-or-network' | null }
export interface DeviceLoginCode { ok: boolean; userCode: string; verificationUri: string; verificationUriComplete: string | null; expiresIn: number }

/** One world on the remote, annotated with the local world it is paired with. */
export interface RemoteWorld {
  id: string;
  name: string;
  description: string;
  locale: string | null;
  updatedAt: string;
  size: number;
  revision: number;
  hash: string | null;
  status: 'draft' | 'published';
  owner: string;
  mine: boolean;
  local: { path: string; revision: number } | null;
  /** The cover's content hash and size; null when the world has none. */
  cover?: { hash: string; bytes: number; type: string } | null;
  /** Relayed by this computer's server (`/api/remote/cover?…&h=`), which holds the session; null = no cover. */
  coverUrl?: string | null;
  /** Only on your own draft: an admin took it out of the public area. */
  takenDown?: { by: string; at: string; reason?: string };
  /** An official edition you own (in `drafts`): download it to edit, republish it; it stays public. */
  official?: boolean;
}

/** One API key (a `wl_pat_…` at the identity service); the value itself is never listed. */
export interface ApiKey { id: string; name: string; hint: string | null; scopes: string[]; createdAt: string; expiresAt: string | null; lastUsedAt: string | null }

export interface RemoteWorldList { ok: boolean; url: string; uid: string | null; email: string | null; admin?: boolean; drafts: RemoteWorld[]; public: RemoteWorld[] }
/** quota: set when the account's cloud storage is near its plan's limit (storage warn_pct, 80 %); null / absent otherwise. */
export interface RemoteQuotaNotice { plan: string; bytesPercent: number | null; countPercent: number | null; warnings: string[] }
export interface RemotePushResult { ok: boolean; id: string; revision: number; hash: string; replaced: boolean; renamed: boolean; files: number; bytes: number; skipped: string[]; quota?: RemoteQuotaNotice | null }
export interface RemotePullResult { ok: boolean; id: string; worldPath: string; from: 'tenant' | 'public'; revision: number; replaced: boolean }

// World-relative filenames are not globally unique. Rotate the asset namespace
// after a successful world load, including re-opening the same world/template.
let assetSession = `${Date.now()}-0`;
let assetGeneration = 0;

/**
 * Re-read the active world's media hashes. Never
 * throws: without an index every URL keeps its per-load `session=` form.
 */
export async function refreshAssetIndex(): Promise<void> {
  try {
    const res = await fetch('/api/asset-index', { cache: 'no-store' });
    if (!res.ok) return;
    const body = await res.json().catch(() => null) as { files?: unknown } | null;
    setAssetIndex(body?.files);
  } catch { /* An old server or no world: session URLs as before. */ }
}

// A world file changed. The watcher debounces, so one `file_changed` may stand
// for several files: drop the named path's hash at once, and re-read the whole
// index together with the layer refetch that this very frame triggers — the
// re-render after it then never asks for new bytes under an old hash.
let assetIndexDirty = false;
if (typeof window !== 'undefined') {
  window.addEventListener('airp:world-event', (event) => {
    const detail = (event as CustomEvent<{ type?: unknown; filename?: unknown }>).detail;
    if (detail?.type !== 'file_changed') return;
    if (typeof detail.filename === 'string') forgetAssetHash(detail.filename);
    assetIndexDirty = true;
  });
}
const withFreshAssetIndex = async <T>(read: Promise<T>): Promise<T> => {
  if (!assetIndexDirty) return read;
  assetIndexDirty = false;
  return (await Promise.all([read, refreshAssetIndex()]))[0];
};

/** One picture the world needs (`GET /api/workshop/art`, shared `ArtSlot` + URLs). */
export interface WorkshopArtSlot {
  id: string;
  owner: 'layer' | 'character' | 'npc' | 'ending' | 'cg' | 'trigger';
  ownerPath: string;
  kind: 'scene' | 'map' | 'portrait' | 'cg' | 'item';
  layer?: string;
  label: string;
  path: string;
  prompt: string;
  exists: boolean;
  declared: boolean;
  inUse?: string;
  inUseExists?: boolean;
  when?: string;
  cutout?: boolean;
  url?: string;
  inUseUrl?: string;
}

export interface WorkshopArtList {
  ok: boolean;
  world: string;
  canPaint: boolean;
  slots: WorkshopArtSlot[];
}

/** A stored world theme as the server resolves it (`@airp/shared` `WorldTheme`). */
export interface WorldThemeView {
  players: 'single' | 'multi';
  type?: string;
  rules: string;
  structure: Record<string, boolean>;
}

/** `GET /api/workshop/theme`: the draft's 设定. */
export interface WorkshopThemeState {
  ok: boolean;
  world: string;
  theme: WorldThemeView;
  mode: 'open' | 'semi' | 'closed';
  /** False when world.json has no `theme` yet (the default is shown). */
  stored: boolean;
  options: { players: string[]; types: string[]; rules: string[]; flags: string[] };
}

/** `GET /api/workshop/music`: the world theme and one place's declared music. Raw values: catalog ids or keywords. */
export interface WorkshopMusicState {
  ok: boolean;
  world: { theme: string | null; typeDefault: string | null };
  place: { layer: string; name: string; bgm: string | null; ambient: string | null; exists: boolean };
}

/** `POST /api/workshop/theme`: default states the old theme brought that the new one does not, still declared. */
export interface WorkshopThemeSaved {
  ok: boolean;
  world: string;
  theme: WorldThemeView;
  mode: 'open' | 'semi' | 'closed';
  unused: { player: string[]; world: string[]; character: string[] };
  /** Sheets replaced with the new rule system's defaults. */
  sheetsReset?: string[];
}

/** One editable sheet skill, as README `sheet:` stores it. */
export interface DraftSheetSkill {
  id: string;
  label: string;
  desc?: string;
  value?: number;
  ability?: string;
  proficient?: boolean;
  expertise?: boolean;
}
export interface DraftSheet {
  abilities?: Record<string, number>;
  skills: DraftSheetSkill[];
}
/** `GET /api/workshop/sheets`: the draft's skill rules and every sheet (player + characters). */
export interface WorkshopSheets {
  ok: boolean;
  rules: { system: 'coc' | 'dnd'; proficiency: number } | null;
  sheets: Record<string, DraftSheet>;
  /** The world's language: new skills take their label in it. */
  locale?: string;
}

/** `POST /api/workshop/clear-play`: what the reset changed in the draft, and where the backup went. */
export interface DraftPlayCleared {
  ok: boolean;
  backup: string;
  reset: string[];
  deleted: string[];
  moved: { from: string; to: string }[];
  unresolved: { path: string; reason: string }[];
}

/** `POST /api/npc/talk` reply (apps/server/src/engine/npc-talk.ts). */
export interface NpcTalkReply {
  ok: boolean;
  path: string;
  name: string;
  reply: string;
  gives: { id: string; text?: string }[];
  dialogue: { by: 'player' | 'npc'; text: string; at?: string }[];
}

export const airpGateway = {
  worlds: () => request<WorldShelf>('/api/worlds'),
  /** The save the server has open (`/api/worlds/load` → `path`), or null (lib/world-reopen.ts `continueStoryAction`). */
  activeWorld: () => request<{ ok: boolean; path: string | null }>('/api/worlds/active'),
  // The media hash index is read alongside, so the first scene after a page
  // load already uses immutable URLs.
  manifest: async <TManifest = Record<string, unknown>>() => (await Promise.all([request<TManifest>('/api/manifest'), refreshAssetIndex()]))[0],
  deleteSave: (worldPath: string) => request<{ ok: boolean; recoveryPath: string }>('/api/worlds/save', json('DELETE', { worldPath })),
  // The workshop. Creating paints or stores the
  // cover and writes the save; the caller then loads it like any other save.
  createWorldConfig: () => request<{ ok: boolean; canPaint: boolean; canSuggest: boolean }>('/api/worlds/create/config'),
  suggestWorld: (body: { locale: 'en' | 'ja' | 'zh-CN' | 'ko'; name?: string; description?: string; playerName?: string; coverPrompt?: string; theme?: WorldThemeRequest }) =>
    request<{ ok: boolean; name: string; description: string; playerName: string; coverPrompt: string }>('/api/worlds/create/suggest', json('POST', { locale: body.locale, name: body.name, description: body.description, playerName: body.playerName, coverPrompt: body.coverPrompt, theme: body.theme })),
  createWorld: (body: CreateWorldRequest) =>
    request<CreateWorldResult>('/api/worlds/create', json('POST', { name: body.name, description: body.description, locale: body.locale, playerName: body.playerName, cover: body.cover, theme: body.theme, location: body.location })),
  // The first-entry intro of a workshop world. The
  // marker belongs to the save, like `/api/opening`. Registered in
  // tools/check-request-bodies.mjs.
  worldIntro: () => request<WorldIntroState>('/api/world-intro'),
  saveWorldIntro: (fields: WorldIntroFields) =>
    request<{ ok: boolean; shown: boolean }>('/api/world-intro', json('POST', { identity: fields.identity, goal: fields.goal, first: fields.first })),
  suggestWorldIntro: (fields: WorldIntroFields) =>
    request<{ ok: boolean } & WorldIntroFields>('/api/world-intro/suggest', json('POST', { identity: fields.identity, goal: fields.goal, first: fields.first })),
  publishWorld: (worldPath: string) => request<{ ok: boolean; publishedPath: string; publishedAt: string }>('/api/worlds/publish', json('POST', { worldPath })),
  unpublishWorld: (worldPath: string) => request<{ ok: boolean; status: 'draft' }>('/api/worlds/unpublish', json('POST', { worldPath })),
  // Local ↔ remote. `/api/remote/*` is this
  // computer's server signing the owner in to their account and calling the
  // hosted AIRP with that session (localhost only); the page never holds a
  // token. Registered in tools/check-request-bodies.mjs.
  remoteSettings: () => request<RemoteSettings>('/api/remote/settings'),
  saveRemoteUrl: (url: string) => request<RemoteSettings>('/api/remote/settings', settingsRequest(json('POST', { url }))),
  // device: the page's id (same as billing's X-Worldlines-Device) for identity's per-device new-account limit; dropped when unknown.
  startRemoteLogin: (method: 'google' | 'email' | 'account', email: string, origin: string) =>
    request<{ ok: boolean; authorizeUrl?: string; sent?: boolean }>('/api/remote/login', settingsRequest(json('POST', { method, email, origin, device: deviceId() ?? undefined }))),
  // Sign in with a code on another device (no browser here); bodyless.
  startDeviceLogin: () => request<DeviceLoginCode>('/api/remote/login/device', settingsRequest(json('POST'))),
  cancelDeviceLogin: () => request<{ ok: boolean }>('/api/remote/login/device/cancel', settingsRequest(json('POST'))),
  verifyRemoteLoginCode: (email: string, code: string) =>
    request<RemoteSettings>('/api/remote/login/verify', settingsRequest(json('POST', { email, code }))),
  logoutRemote: () => request<RemoteSettings>('/api/remote/logout', settingsRequest(json('POST'))),
  // The guest trial: its state; start = a guest session + the trial credits (device: billing's per-device cap).
  guestTrial: () => request<GuestTrialView>('/api/remote/guest'),
  startGuestTrial: () => request<GuestTrialView>('/api/remote/guest', settingsRequest(json('POST', { device: deviceId() ?? undefined }))),
  testRemote: () => request<{ ok: boolean; uid: string; email: string | null; url: string }>('/api/remote/test', settingsRequest(json('POST'))),
  remoteWorlds: () => request<RemoteWorldList>('/api/remote/worlds'),
  // 本机 / 云端. `keepalive` on leaving the page: the local server finishes it.
  worldSync: () => request<WorldSyncStatus>('/api/remote/sync'),
  syncWorlds: (worldPath?: string, opts: { keepalive?: boolean } = {}) =>
    request<WorldSyncStatus>('/api/remote/sync', settingsRequest({ ...json('POST', { worldPath }), ...(opts.keepalive ? { keepalive: true } : {}) })),
  keepInCloud: (worldPath: string) => request<WorldSyncStatus>('/api/remote/sync/cloud', settingsRequest(json('POST', { worldPath }))),
  keepBoth: (worldPath: string) => request<WorldSyncStatus>('/api/remote/sync/keep-both', settingsRequest(json('POST', { worldPath }))),
  // API keys: the create answer carries the value ONCE; the page shows it and forgets it.
  apiKeys: () => request<{ ok: boolean; keys: ApiKey[] }>('/api/remote/api-keys'),
  createApiKey: (name: string, expiresInDays: number | null) =>
    request<{ ok: boolean; key: ApiKey; token: string }>('/api/remote/api-keys', settingsRequest(json('POST', { name, expiresInDays }))),
  revokeApiKey: (id: string) => request<{ ok: boolean; id: string }>(`/api/remote/api-keys/${encodeURIComponent(id)}`, settingsRequest(json('DELETE'))),
  pushToRemote: (worldPath: string) => request<RemotePushResult>('/api/remote/push', settingsRequest(json('POST', { worldPath }))),
  pullFromRemote: (id: string, from: 'tenant' | 'public', replace: boolean) =>
    request<RemotePullResult>('/api/remote/pull', settingsRequest(json('POST', { id, from, replace }))),
  publishOnRemote: (id: string) => request<{ ok: boolean; id: string; publishedAt: string }>('/api/remote/publish', settingsRequest(json('POST', { id }))),
  /** 撤回发布 on the remote: by remote `id`, or by a local original's `worldPath` (its remembered pair). */
  forceUnpublishOnRemote: (id: string, reason?: string) =>
    request<{ ok: boolean; id: string; owner: string }>('/api/remote/force-unpublish', settingsRequest(json('POST', { id, reason }))),
  unpublishOnRemote: (target: { id?: string; worldPath?: string }) =>
    request<{ ok: boolean; id: string }>('/api/remote/unpublish', settingsRequest(json('POST', { id: target.id, worldPath: target.worldPath }))),
  /**
   * Hosted only: the page's own publish / unpublish through the SAME sync path
   * a local AIRP uses (the gateway verifies the session cookie; the header is
   * what lets a cookie in, deploy/vps/seat-gateway.mjs). The tenant then keeps
   * only unpublished drafts, on the hosted site too.
   */
  hostedSync: (id: string, action: 'publish' | 'unpublish') =>
    request<{ ok: boolean; id: string }>(`/api/sync/worlds/${encodeURIComponent(id)}/${action}`, { method: 'POST', headers: { accept: 'application/json', 'X-AIRP-Sync': '1' } }),
  // Creation-mode art: the 素材 panel. Draft
  // workshop worlds only. Registered in tools/check-request-bodies.mjs.
  workshopArt: () => request<WorkshopArtList>('/api/workshop/art'),
  workshopTheme: () => request<WorkshopThemeState>('/api/workshop/theme'),
  /** `confirmReset`: the author agreed to replace the character sheets (a CoC ↔ D&D switch); without it the server answers 409 `sheets_reset_required`. */
  saveWorkshopTheme: (theme: WorldThemeRequest, confirmReset = false) => request<WorkshopThemeSaved>('/api/workshop/theme', json('POST', { theme, confirmReset })),
  workshopMusic: (layer: string) => request<WorkshopMusicState>(`/api/workshop/music?layer=${encodeURIComponent(layer)}`),
  /** `layer`: "world" (the theme) or a place; `track` / `ambient`: catalog id or keyword (`silence` / `none` / `default`); null = leave as is. */
  saveWorkshopMusic: (layer: string, track: string | null, ambient: string | null) => request<{ ok: boolean; changed: boolean }>('/api/workshop/music', json('POST', { layer, track, ambient })),
  workshopSheets: () => request<WorkshopSheets>('/api/workshop/sheets'),
  saveWorkshopSheet: (target: string, sheet: DraftSheet) => request<{ ok: boolean; target: string; sheet: DraftSheet }>('/api/workshop/sheet', json('POST', { target, sheet })),
  /** 「清除草稿里的试玩痕迹」: the trial reset, on the draft itself (backed up first). Bodyless. */
  clearDraftPlay: () => request<DraftPlayCleared>('/api/workshop/clear-play', json('POST')),
  saveArtPrompt: (slot: string, prompt: string) =>
    request<{ ok: boolean; slot: WorkshopArtSlot | null }>('/api/workshop/art/prompt', json('POST', { slot, prompt })),
  generateArt: (slot: string, prompt: string, cutout: boolean) =>
    request<{ ok: boolean; slot: WorkshopArtSlot | null }>('/api/workshop/art/generate', json('POST', { slot, prompt, cutout })),
  uploadArt: (slot: string, mimeType: string, dataB64: string, cutout: boolean) =>
    request<{ ok: boolean; slot: WorkshopArtSlot | null }>('/api/workshop/art/upload', json('POST', { slot, mimeType, dataB64, cutout })),
  /** `fresh` starts a new game of the author's own draft (a play copy); templates and published worlds always start fresh. */
  loadWorld: async <TManifest = Record<string, unknown>>(worldPath: string, options?: { fresh?: boolean }) => {
    const result = await request<WorldLoadResult<TManifest>>('/api/worlds/load', json('POST', { worldPath, fresh: options?.fresh === true }));
    if (result.ok) {
      worldUnavailable = false;
      assetSession = `${Date.now()}-${++assetGeneration}`;
      if (result.assetIndex) setAssetIndex(result.assetIndex);
      else await refreshAssetIndex();
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('airp:gate-feedback', { detail: null }));
    }
    return result;
  },
  move: (from: string, to: string, signal?: AbortSignal) =>
    request<MoveEntityDetails>('/api/move', { ...json('POST', { from, to }), signal }),
  /**
   * The player's beat: runs the world's
   * `experience.turnEnd` command once and, in a world with `tick`, its character beat on
   * the page the player is looking at (`layer`). Registered in tools/check-request-bodies.mjs.
   */
  turnEnd: (layer?: string | null) =>
    request<{ turnEnd: { ran: boolean; command: string | null; effects: number }; tick?: { ran: boolean; view: TickView; resolved?: { id: string; result: 'landed' | 'stopped' | 'void' | 'said' }; said?: string }; hint?: HintView | null }>('/api/turn-end', json('POST', { layer: layer ?? undefined })),
  /**
   * 「再生成一批」: three fresh lines the player might say to one character (`character`) or
   * NPC card (`npc`), from what is on screen and the last lines of that conversation. A guest gets 503.
   * Registered in tools/check-request-bodies.mjs.
   */
  suggestReplies: (body: { character?: string; npc?: string; layer?: string | null; recent?: { who: 'player' | 'character'; text: string }[] }, signal?: AbortSignal) =>
    request<{ ok: boolean; lines: string[] }>('/api/replies/suggest', { ...json('POST', { character: body.character, npc: body.npc, layer: body.layer ?? undefined, recent: body.recent }), signal }),
  /** Character tick: the intent showing now, recent moves, touched targets. */
  tick: () => request<{ ok: boolean; tick: TickView }>('/api/tick'),
  /** The page drew the intent: its counter window starts. Registered in tools/check-request-bodies.mjs. */
  tickSeen: (id: string) => request<{ ok: boolean; tick: TickView }>('/api/tick/seen', json('POST', { id })),
  /** 「盯住」 — a beat of its own. Registered in tools/check-request-bodies.mjs. */
  tickGuard: (id: string, layer?: string | null) =>
    request<{ tick: { ran: boolean; view: TickView } }>('/api/tick/guard', json('POST', { id, layer: layer ?? undefined })),
  /** Character tick v2: a beat has started — fire the next beat's model call now. */
  tickPrefetch: (layer?: string | null) =>
    request<{ ok: boolean; prefetching: boolean }>('/api/tick/prefetch', json('POST', { layer: layer ?? undefined })),
  choose: (path: string, choice: string | number, signal?: AbortSignal) =>
    request<ChooseOptionDetails | { action: Record<string, unknown> }>('/api/choice', { ...json('POST', { path, choice }), signal }).then(tapCue),
  layer: <TLayer = Record<string, unknown>>(layer: string, signal?: AbortSignal) =>
    withFreshAssetIndex(request<TLayer>(`/api/layer?layer=${encodeURIComponent(layer)}`, { signal })),
  backpack: <TItems = unknown[]>() => request<{ items: TItems }>('/api/backpack'),
  characters: <TCharacters = unknown[]>() =>
    request<{ characters: TCharacters }>('/api/characters'),
  // `first` = the target layer had no README (a stub) — the auto-init signal
  //. The server decides it; the client only reads it.
  // `followers` is the carry-along settlement:
  // a character left behind must be visible, never silent.
  enterLayer: (layer: string, signal?: AbortSignal) =>
    request<{ ok: boolean } & EnterLayerDetails>('/api/enter-layer', { ...json('POST', { layer }), signal }).then(tapCue),
  // Terminal state, not a toggle: the UI inverts, the
  // action writes. Registered in tools/check-request-bodies.mjs.
  setFollowing: (character: string, following: boolean) =>
    request('/api/following', json('POST', { character, following })).then(tapCue),
  // Has this SAVE had its first act? Server-side because the
  // opening belongs to the save, not to this browser. Registered in
  // tools/check-request-bodies.mjs.
  opening: () => request<{ shown: boolean }>('/api/opening'),
  markOpening: (shown: boolean) => request<{ shown: boolean }>('/api/opening', json('POST', { shown })),
  worldSettings: () => request<WorldSettings>('/api/world-settings'),
  saveWorldSettings: (settings: WorldSettings) =>
    request<WorldSettings>('/api/world-settings', json('POST', settings)),
  moveCard: (path: string, x: number, y: number, signal?: AbortSignal) =>
    request<Record<string, unknown>>('/api/card/position', { ...json('POST', { path, x, y }), signal }),
  // Frozen request bodies: the server reads `path` only;
  // rollType/expect are parsed server-side from frontmatter.
  rollDice: (path: string) =>
    request<{ ok: boolean; result: number; passed: boolean }>(
      '/api/dice',
      json('POST', { path }),
    ),
  // Server reads `{ item, target }`.
  useItem: (item: string, target: string, signal?: AbortSignal) =>
    request<UseItemOnDetails>('/api/use-item', { ...json('POST', { item, target }), signal }),
  // One line to an NPC card. The request stays open for
  // the writer's turn; the exchange is also recorded on the card. Registered in
  // tools/check-request-bodies.mjs.
  talkToNpc: (path: string, message: string, signal?: AbortSignal) =>
    request<NpcTalkReply>('/api/npc/talk', { ...json('POST', { path, message }), signal }),
  toggleFreeze: () => request<{ worldFrozen: boolean }>('/api/freeze', json('POST')),
  // The player's sticky notes + clue board.
  // Bodies are registered in tools/check-request-bodies.mjs.
  playerNote: (body: PlayerNoteRequest) => {
    const b = body as Partial<Record<'layer' | 'path' | 'text' | 'color' | 'size' | 'x' | 'y', unknown>>;
    return request<{ ok: boolean; path: string; op: string; layer: string; revision: number }>('/api/player-note', json('POST', { op: body.op, layer: b.layer, path: b.path, text: b.text, color: b.color, size: b.size, x: b.x, y: b.y }));
  },
  playerBoard: (layer: string, signal?: AbortSignal) =>
    request<{ ok: boolean; layer: string; board: PlayerBoardView }>(`/api/player-board?layer=${encodeURIComponent(layer)}`, { signal }),
  updatePlayerBoard: (body: PlayerBoardRequest) => {
    const b = body as Partial<Record<'from' | 'to' | 'label' | 'id' | 'path' | 'tag', unknown>>;
    return request<{ ok: boolean; layer: string; board: PlayerBoardView; changed: boolean; revision: number }>('/api/player-board', json('POST', { op: body.op, from: b.from, to: b.to, label: b.label, id: b.id, path: b.path, tag: b.tag }));
  },
  // Server reads `path`. `mode`: where the request comes
  // from — a TRPG world refuses `play` creation.
  godAction: (action: 'create' | 'update' | 'delete', path: string, content?: string, mode: 'play' | 'authoring' = 'authoring') =>
    request('/api/god-action', json('POST', { action, path, content, mode })),
  // `/api/world-file` serves ONE `.html` page for the card face and the live
  // view (contract §7). Deliberately NOT `assetUrl`: that URL is shaped for the
  // three `AssetMediaKind` lanes (`kind=`/`session=`), neither of which this
  // route has — the server IGNORES unknown query keys, so borrowing it would
  // work and lie.
  worldFileUrl: (path: string) =>
    `/api/world-file?path=${encodeURIComponent(path)}`,
  assetUrl: (
    path: string,
    session: string | undefined,
    mediaKind: AssetMediaKind,
  ) =>
    worldAssetUrl(path, mediaKind, session ?? assetSession),
};

export function openAirpSocket(onMessage: (message: Record<string, unknown>) => void): WebSocket {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  // The version gate MUST land in the same commit as the server's (the design notes
  // 03 §9.1): an old backend ignores the extra query harmlessly, but a new
  // backend without this closes every client with 4400.
  const socket = new WebSocket(`${protocol}//${window.location.host}/ws?v=${PROTOCOL_VERSION}`);
  socket.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data) as Record<string, unknown>;
      perfSocketFrame(message.type);
      onMessage(message);
    } catch (error) {
      console.error('Could not parse AIRP WebSocket message:', error);
    }
  };
  return socket;
}

export function sendSocket(socket: WebSocket | null, payload: Record<string, unknown>): boolean {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(payload));
  perfSocketSend(payload.type);
  return true;
}
