import { randomBytes } from 'node:crypto';
import { rememberAccountPlan } from './account-plan.js';
import { accountAccessToken, readRemoteConfig } from './remote-client.js';

/**
 * The player's small cross-device things, in the Worldlines data service
 * (data.worldlines.gg; platform products/livingcanvas/manifest.json v2):
 *
 *   setting       one per account (the service enforces it: quota 1) — performance,
 *                 voice switches + volumes, interface language. Only enums, booleans
 *                 and 0–1 numbers: no free-text field, so no key can ever travel here.
 *   favorite      { world_id }
 *   review        { world_id, rating 1–5, comment? } — published as soon as it is
 * written: everyone sees the stars and the comment,
 *                 the author edits or deletes it; an admin can take one down (then it
 *                 stays the author's own). The counts + averages are public too.
 *   report        { target: livingcanvas/review/<id>, reason, note? } — the reporter's
 *                 own; admins see every report (console).
 *   bug-report    「报告问题 / 卡住了」 { kind stuck|bug|idea, text?, world_id?, edition?, place?, client…,
 *                 errors? } (manifest v12) — write-only: the console's 「玩家反馈」 reads them; a guest of
 *                 the trial may send one too (with the guest session, sendFeedback).
 *   log           platform/log (v5): the 日志 — top banners (banner=active), the lobby's
 *                 「日志」 tab (surface lobby) and a world's 「更新记录」 (scope world:<id>);
 *                 admins publish in the console, anyone reads (no account needed).
 *   announcement  platform/announcement + livingcanvas/announcement: the old banners,
 *                 read only while data has no v5 logs (an older deploy).
 *   save-summary  { save_id, world_id, world_name, scene, turns, text } — metadata only;
 *                 the save itself stays on the device that played it.
 *
 * Same account and token as storage / ai: this server holds the session (the local
 * app's ~/.config/airp/remote.json, or the browser version's in-tab server) and calls
 * data itself, so the page never sees a token. Signed out, data not deployed, an old
 * sign-in without the data scopes, the service down: all of it is "not available" —
 * the page then keeps everything on this device and says nothing.
 */

export const DEFAULT_DATA_BASE = 'https://data.worldlines.gg';
const PRODUCT = 'livingcanvas';
const TIMEOUT_MS = 8_000;
const PAGE = 100;
const MAX_PAGES = 10;
export const LOCAL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** `AIRP_DATA_BASE` (the browser version passes VITE_AIRP_DATA_BASE through); `off` turns the whole thing off. */
export function dataBase(): string | null {
  const raw = (process.env.AIRP_DATA_BASE ?? '').trim();
  if (raw === 'off') return null;
  if (!raw) return DEFAULT_DATA_BASE; // the mode file sets it (login on) or `off` (login off): packages/shared/src/deploy-mode
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) return DEFAULT_DATA_BASE;
    return raw.replace(/\/+$/, '');
  } catch {
    return DEFAULT_DATA_BASE;
  }
}

export type Unavailable = 'off' | 'signed_out' | 'not_allowed' | 'unreachable';
export class DataUnavailable extends Error {
  constructor(public reason: Unavailable, message: string) { super(message); }
}
/** A request the service refused for a reason the page should hear (bad input, quota). */
export class DataRefused extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export interface AccountDataDeps {
  fetch?: typeof fetch;
  /** The account's access token (null = signed out); `force` after a 401. */
  token?: (opts?: { force?: boolean }) => Promise<string | null>;
}

export interface Answer { status: number; body: any }
interface DataRecord<B> { id: string; rev: number; body: B; updated_at: string }

/** One call with the account's token: to data (`rel`), or to another Worldlines service (`opts.url`, absolute). */
export async function request(method: string, rel: string, deps: AccountDataDeps, opts: { body?: unknown; ifMatch?: number; anonymous?: boolean; url?: string; headers?: Record<string, string> } = {}): Promise<Answer> {
  const base = opts.url ? '' : dataBase();
  if (base === null) throw new DataUnavailable('off', 'The data service is turned off on this computer (AIRP_DATA_BASE=off).');
  // A service base set to `off` (AIRP_CHRONICLE_BASE=off) leaves a URL with no scheme: never sent anywhere.
  if (opts.url && !/^https?:\/\//i.test(opts.url)) throw new DataUnavailable('off', 'This service is turned off on this computer.');
  const getToken = deps.token ?? accountAccessToken;
  let token: string | null = null;
  if (!opts.anonymous) {
    token = await getToken();
    if (!token) throw new DataUnavailable('signed_out', 'Not signed in.');
  }
  const once = async (bearer: string | null): Promise<Answer> => {
    let res: Response;
    try {
      res = await (deps.fetch ?? fetch)(opts.url ?? `${base}${rel}`, {
        method,
        redirect: 'error',
        headers: {
          accept: 'application/json',
          ...(opts.headers ?? {}),
          ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
          ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(opts.ifMatch !== undefined ? { 'if-match': `"${opts.ifMatch}"` } : {}),
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new DataUnavailable('unreachable', `The data service could not be reached (${error instanceof Error ? error.name : 'network error'}).`);
    }
    const text = await res.text().catch(() => '');
    let body: any = null;
    try { body = text ? JSON.parse(text) : null; } catch { /* not JSON: a proxy page */ }
    return { status: res.status, body };
  };
  let answer = await once(token);
  if (answer.status === 401 && !opts.anonymous) {
    token = await getToken({ force: true });
    if (!token) throw new DataUnavailable('signed_out', 'Not signed in.');
    answer = await once(token);
    if (answer.status === 401) throw new DataUnavailable('signed_out', 'The data service did not accept the sign-in.');
  }
  const code = typeof answer.body?.error === 'string' ? answer.body.error : typeof answer.body?.error?.code === 'string' ? answer.body.error.code : '';
  // An app sign-in from before the data scopes (insufficient_scope), a guest, a service without the collection yet.
  if (answer.status === 403 && ['insufficient_scope', 'anonymous_forbidden', 'product_not_allowed'].includes(code)) throw new DataUnavailable('not_allowed', 'This sign-in may not use the data service; sign in again to allow it.');
  if (answer.status >= 500 || (answer.status === 404 && (code === 'unknown_collection' || !answer.body))) throw new DataUnavailable('unreachable', `The data service answered HTTP ${answer.status}.`);
  return answer;
}

function refused(a: Answer): never {
  const code = typeof a.body?.error === 'string' ? a.body.error : 'data_error';
  throw new DataRefused(a.status >= 400 && a.status < 500 ? a.status : 502, code, typeof a.body?.message === 'string' ? a.body.message : `The data service answered HTTP ${a.status}.`);
}
const path = (kind: string, id?: string) => `/v1/records/${PRODUCT}/${kind}${id ? `/${encodeURIComponent(id)}` : ''}`;

async function mine<B>(kind: string, deps: AccountDataDeps, where: Record<string, string> = {}, order = '-updated_at'): Promise<DataRecord<B>[]> {
  const out: DataRecord<B>[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const q = new URLSearchParams({ scope: 'mine', limit: String(PAGE), order });
    for (const [k, v] of Object.entries(where)) q.set(`where[${k}]`, v);
    if (cursor) q.set('cursor', cursor);
    const a = await request('GET', `${path(kind)}?${q}`, deps);
    if (a.status !== 200) refused(a);
    out.push(...(a.body?.records ?? []));
    cursor = a.body?.next_cursor ?? null;
    if (!cursor) break;
  }
  return out;
}
const create = (kind: string, body: unknown, deps: AccountDataDeps) => request('POST', path(kind), deps, { body: { body } });
const replace = (kind: string, id: string, rev: number, body: unknown, deps: AccountDataDeps) => request('PUT', path(kind, id), deps, { body: { body }, ifMatch: rev });
const remove = (kind: string, id: string, deps: AccountDataDeps) => request('DELETE', path(kind, id), deps);

/**
 * Write `body` into the record `found` (or a new one): last write wins. A stale
 * rev (another device wrote in between) is retried once at the rev the service
 * reports; a record deleted meanwhile is created again.
 */
async function upsert<B>(kind: string, found: DataRecord<B> | null, body: B, deps: AccountDataDeps): Promise<DataRecord<B>> {
  if (found) {
    let a = await replace(kind, found.id, found.rev, body, deps);
    if (a.status === 409 && Number.isInteger(a.body?.rev)) a = await replace(kind, found.id, a.body.rev, body, deps);
    if (a.status === 200) return a.body;
    if (a.status !== 404) refused(a);
  }
  const a = await create(kind, body, deps);
  if (a.status === 201) return a.body;
  refused(a);
}

// ── settings ────────────────────────────────────────────────────────────────

const ENUMS = {
  preset: ['balanced', 'performance', 'quality', 'custom'],
  particleDensity: ['full', 'reduced'],
  shadowQuality: ['full', 'reduced', 'off'],
  backdropBlur: ['full', 'reduced', 'off'],
  diceRendering: ['3d', 'numeric'],
} as const;
export const ANNOUNCEMENT_ID = /^(platform|livingcanvas)\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
export interface SyncedSettings {
  v: 1;
  /** Announcements this player closed (`platform/<id>` / `livingcanvas/<id>`), newest last. */
  dismissed?: string[];
  locale?: 'en' | 'zh-CN' | 'ja' | 'ko';
  performance?: Partial<{ preset: string; effectsEnabled: boolean; particleDensity: string; shadowQuality: string; backdropBlur: string; canvasGrain: boolean; diceRendering: string }>;
  voice?: Partial<{ ttsEnabled: boolean; studioVoice: boolean; musicVolume: number; voiceVolume: number }>;
  /** 卡面角色 of the plan key visuals (m 男性角色 / f 女性角色 / r 随机); absent = 默认. Manifest v10 (the Worldlines platform). */
  planLook?: 'm' | 'f' | 'r';
}

/** Keep only what the manifest's schema takes; anything else (a key, a URL, a name) is dropped here, before it travels. */
export function cleanSettings(input: unknown): SyncedSettings {
  const src = (input && typeof input === 'object' && !Array.isArray(input) ? input : {}) as Record<string, any>;
  const out: SyncedSettings = { v: 1 };
  if (['en', 'zh-CN', 'ja', 'ko'].includes(src.locale)) out.locale = src.locale;
  const p = src.performance;
  if (p && typeof p === 'object') {
    const perf: NonNullable<SyncedSettings['performance']> = {};
    for (const [k, allowed] of Object.entries(ENUMS)) if ((allowed as readonly string[]).includes(p[k])) (perf as any)[k] = p[k];
    for (const k of ['effectsEnabled', 'canvasGrain'] as const) if (typeof p[k] === 'boolean') perf[k] = p[k];
    if (Object.keys(perf).length) out.performance = perf;
  }
  if (Array.isArray(src.dismissed)) {
    const ids = [...new Set(src.dismissed.filter((x: unknown): x is string => typeof x === 'string' && ANNOUNCEMENT_ID.test(x)))].slice(-100);
    if (ids.length) out.dismissed = ids;
  }
  const v = src.voice;
  if (v && typeof v === 'object') {
    const voice: NonNullable<SyncedSettings['voice']> = {};
    for (const k of ['ttsEnabled', 'studioVoice'] as const) if (typeof v[k] === 'boolean') voice[k] = v[k];
    for (const k of ['musicVolume', 'voiceVolume'] as const) if (typeof v[k] === 'number' && Number.isFinite(v[k])) voice[k] = Math.round(Math.min(1, Math.max(0, v[k])) * 100) / 100;
    if (Object.keys(voice).length) out.voice = voice;
  }
  if (src.planLook === 'm' || src.planLook === 'f' || src.planLook === 'r') out.planLook = src.planLook;
  return out;
}

export async function saveSettings(input: unknown, deps: AccountDataDeps = {}): Promise<{ updatedAt: string }> {
  const body = cleanSettings(input);
  const [found] = await mine<SyncedSettings>('setting', deps);
  try {
    return { updatedAt: (await upsert('setting', found ?? null, body, deps)).updated_at };
  } catch (error) {
    // Two devices created the one record at once: the other won (quota 1); write into theirs.
    if (!(error instanceof DataRefused && error.code === 'quota_count_exceeded')) throw error;
    const [theirs] = await mine<SyncedSettings>('setting', deps);
    if (!theirs) throw error;
    return { updatedAt: (await upsert('setting', theirs, body, deps)).updated_at };
  }
}

// ── favorites / reviews ─────────────────────────────────────────────────────

export function worldIdOf(raw: unknown): string {
  const id = typeof raw === 'string' ? raw.trim() : '';
  if (!LOCAL_ID.test(id)) throw new DataRefused(400, 'invalid_world', 'Not a world id.');
  return id;
}

export async function setFavorite(worldId: string, on: boolean, deps: AccountDataDeps = {}): Promise<{ favorite: boolean }> {
  const found = await mine<{ world_id: string }>('favorite', deps, { world_id: worldId });
  if (on && !found.length) {
    const a = await create('favorite', { world_id: worldId }, deps);
    if (a.status !== 201) refused(a);
  }
  // off — or a duplicate from two devices: keep at most one
  for (const r of on ? found.slice(1) : found) {
    const a = await remove('favorite', r.id, deps);
    if (a.status !== 200 && a.status !== 404) refused(a);
  }
  return { favorite: on };
}

export const MAX_COMMENT = 1000;
/**
 * Write the player's rating + comment for a world and make it public. A comment an
 * admin took down stays saved but private (`takenDown`); too many edits → 429.
 */
export async function setReview(worldId: string, input: { rating?: unknown; comment?: unknown; note?: unknown }, deps: AccountDataDeps = {}): Promise<{ rating: number; comment: string | null; note: string | null; updatedAt: string; public: boolean; takenDown: boolean }> {
  const rating = Number(input.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new DataRefused(400, 'invalid_rating', 'A rating is 1 to 5 stars.');
  const comment = typeof input.comment === 'string' ? input.comment.trim() : '';
  if ([...comment].length > MAX_COMMENT) throw new DataRefused(400, 'comment_too_long', `A note is at most ${MAX_COMMENT} characters.`);
  // the private note: kept with the review, never in its public view (manifest public_fields)
  const note = typeof input.note === 'string' ? input.note.trim() : '';
  if ([...note].length > MAX_COMMENT) throw new DataRefused(400, 'note_too_long', `A note is at most ${MAX_COMMENT} characters.`);
  const body = { world_id: worldId, rating, ...(comment ? { comment } : {}), ...(note ? { note } : {}) };
  const [found, ...extra] = await mine<typeof body>('review', deps, { world_id: worldId });
  const saved = await upsert('review', found ?? null, body, deps);
  for (const r of extra) await remove('review', r.id, deps).catch(() => undefined);
  let published = (saved as DataRecord<typeof body> & { visibility?: string }).visibility === 'published';
  let takenDown = false;
  if (!published) {
    const a = await request('POST', `${path('review', saved.id)}/publish`, deps);
    if (a.status === 200) published = a.body?.visibility === 'published';
    else if (a.status === 409 && a.body?.error === 'taken_down') takenDown = true;
    else refused(a);
  }
  return { rating, comment: comment || null, note: note || null, updatedAt: saved.updated_at, public: published, takenDown };
}

// ── the public nickname (profile) ───────────────────────────────────────────────

/**
 * Comments are anonymous unless the player chooses a nickname: never the account's
 * display name. The nickname is a `profile` record (one per player); data shows it with the player's
 * comments at read time, joined inside data — no uid ever reaches a reader. Clearing it = deleting it.
 */
export const NICKNAME = /^(?=\S)(?!.*(?:https?:\/\/|www\.|@|\.(?:com|net|org|gg|jp|cn|io|me|app|xyz|ly|co)(?:\/|\s|$)))[^\u0000-\u001F\u007F-\u009F]{1,20}(?<=\S)$/u;
export async function setNickname(raw: unknown, deps: AccountDataDeps = {}): Promise<{ nickname: string | null }> {
  const nickname = typeof raw === 'string' ? raw.trim() : '';
  const found = await mine<{ nickname: string }>('profile', deps);
  if (!nickname) {
    for (const r of found) { const a = await remove('profile', r.id, deps); if (a.status !== 200 && a.status !== 404) refused(a); }
    return { nickname: null };
  }
  if (!NICKNAME.test(nickname)) throw new DataRefused(400, 'invalid_nickname', 'A nickname is 1–20 characters, without links, email addresses or control characters.');
  try {
    await upsert('profile', found[0] ?? null, { nickname }, deps);
  } catch (error) {
    // data's schema / deny-list answers 422: the same words to the page
    if (error instanceof DataRefused && error.code === 'content_refused') throw new DataRefused(400, 'content_refused', 'That nickname is not allowed. Try another one.');
    if (error instanceof DataRefused && error.code === 'schema_invalid') throw new DataRefused(400, 'invalid_nickname', 'A nickname is 1–20 characters, without links, email addresses or control characters.');
    throw error;
  }
  return { nickname };
}

export interface PublicComment { id: string; rating: number; comment: string | null; author: string | null; tag: string | null; mine: boolean; createdAt: string; updatedAt: string }
/**
 * Public: one page of a world's published ratings + comments, newest first (`cursor` for the next page).
 * No account needed; signed in, the player's own is marked `mine` (by its id: the public view has no uid).
 */
export async function comments(worldId: string, deps: AccountDataDeps = {}, cursor: string | null = null): Promise<{ comments: PublicComment[]; nextCursor: string | null }> {
  const q = new URLSearchParams({ 'where[world_id]': worldId, limit: '20', order: '-created_at', ...(cursor ? { cursor } : {}) });
  const a = await request('GET', `/v1/public/records/${PRODUCT}/review?${q}`, deps, { anonymous: true });
  if (a.status === 400 && a.body?.error === 'invalid_cursor') throw new DataRefused(400, 'invalid_cursor', 'That page is gone; reload the comments.');
  if (a.status !== 200) refused(a);
  let mineId: string | null = null;
  try { mineId = (await mine<{ world_id: string }>('review', deps, { world_id: worldId }))[0]?.id ?? null; } catch { /* signed out */ }
  const list = ((a.body?.records ?? []) as Array<{ id: string; author_tag?: string; author_name?: string | null; body: { rating?: number; comment?: string }; created_at?: string; updated_at: string }>).map((r) => ({
    id: r.id,
    rating: Number(r.body?.rating) || 0,
    comment: typeof r.body?.comment === 'string' && r.body.comment ? r.body.comment : null,
    author: typeof r.author_name === 'string' && r.author_name ? r.author_name : null, // the nickname, or anonymous
    tag: typeof r.author_tag === 'string' ? r.author_tag.slice(0, 4) : null,
    mine: r.id === mineId,
    createdAt: r.created_at ?? r.updated_at,
    updatedAt: r.updated_at,
  }));
  return { comments: list, nextCursor: typeof a.body?.next_cursor === 'string' ? a.body.next_cursor : null };
}

// ── likes, public numbers per world ─────────────────────────────────────────

/** The public +1 (one per player per world; off = the record deleted). Separate from the private favorites. */
export async function setLike(worldId: string, on: boolean, deps: AccountDataDeps = {}): Promise<{ liked: boolean }> {
  const found = await mine<{ world_id: string }>('like', deps, { world_id: worldId });
  if (on && !found.length) {
    const a = await create('like', { world_id: worldId }, deps);
    if (a.status !== 201) refused(a);
  }
  for (const r of on ? found.slice(1) : found) {
    const a = await remove('like', r.id, deps);
    if (a.status !== 200 && a.status !== 404) refused(a);
  }
  return { liked: on };
}

export const DEFAULT_CHRONICLE_BASE = 'https://chronicle.worldlines.gg';
/** `AIRP_CHRONICLE_BASE`; `off` = no play counts and no usage reports from this computer (request() refuses it). */
export const chronicleBase = () => (process.env.AIRP_CHRONICLE_BASE ?? '').trim().replace(/\/+$/, '') || DEFAULT_CHRONICLE_BASE;

export interface WorldNumbers {
  rating: { count: number; average: number | null };
  likes: number;
  plays: number | null;
  players: number | null;
  /** 「总打开次数」 summed over the world's published editions (chronicle /v1/stats/activity); null = none shown. */
  opens: number | null;
  /** 「总消耗 token 数」 (chat tokens counted since 2026-10-04) summed over the editions ai knows; null = no data / unknown. */
  tokens: number | null;
}
/** opens / tokens of one world = the sums over its editions chronicle answered for (none = null; tokens: only known ones). */
export function activityOf(editions: string[], activity: Map<string, { opens: number; tokens: number | null }>): { opens: number | null; tokens: number | null } {
  const seen = editions.map((r) => activity.get(r)).filter((x): x is { opens: number; tokens: number | null } => !!x);
  const known = seen.filter((x) => x.tokens !== null);
  return {
    opens: seen.length ? seen.reduce((sum, x) => sum + x.opens, 0) : null,
    tokens: known.length ? known.reduce((sum, x) => sum + (x.tokens as number), 0) : null,
  };
}
/**
 * Public numbers per world (no account): ratings and likes from data, plays from chronicle.
 * `refs` = world key → its edition ids (livingcanvas/world/<id>): plays are summed over the editions chronicle
 * shows (each needs ≥ 5 players and to be published; otherwise null = not shown).
 */
export async function worldNumbers(keys: string[], refs: Record<string, string[]>, deps: AccountDataDeps = {}): Promise<Record<string, WorldNumbers>> {
  const ids = [...new Set(keys.filter((id) => LOCAL_ID.test(id)))].slice(0, 100);
  if (!ids.length) return {};
  const stats = async (kind: string) => {
    const a = await request('GET', `/v1/public/stats/${PRODUCT}/${kind}?in=${ids.map(encodeURIComponent).join(',')}`, deps, { anonymous: true });
    return a.status === 200 ? (a.body?.groups ?? {}) as Record<string, { count?: number; avg?: { rating?: number | null } }> : {};
  };
  type Groups = Record<string, { count?: number; avg?: { rating?: number | null } }>;
  const [ratingGroups, likeGroups]: [Groups, Groups] = await Promise.all([stats('review'), stats('like').catch((): Groups => ({}))]);
  const editionRefs = [...new Set(ids.flatMap((k) => (refs[k] ?? [k]).filter((r) => LOCAL_ID.test(r))))].slice(0, 50);
  const plays = new Map<string, { playthroughs: number; players: number }>();
  if (editionRefs.length) {
    try {
      const q = editionRefs.map((r) => encodeURIComponent(`${PRODUCT}/world/${r}`)).join(',');
      const a = await request('GET', '', deps, { anonymous: true, url: `${chronicleBase()}/v1/stats/worlds?refs=${q}` });
      for (const w of (a.status === 200 ? a.body?.worlds ?? [] : []) as Array<{ world_ref: string; public?: boolean; playthroughs?: number; players?: number }>) {
        if (w.public) plays.set(w.world_ref.split('/').pop()!, { playthroughs: Number(w.playthroughs) || 0, players: Number(w.players) || 0 });
      }
    } catch { /* chronicle down: no play counts */ }
  }
  // server-wide opens + tokens per edition (published only; chronicle caches 2 min). Down = null, never 0.
  const activity = new Map<string, { opens: number; tokens: number | null }>();
  if (editionRefs.length) {
    try {
      const a = await request('GET', '', deps, { anonymous: true, url: `${chronicleBase()}/v1/stats/activity?product=${PRODUCT}&ids=${editionRefs.map(encodeURIComponent).join(',')}` });
      const worlds = (a.status === 200 ? a.body?.worlds ?? {} : {}) as Record<string, { opens?: unknown; tokens?: unknown }>;
      for (const [id, w] of Object.entries(worlds)) {
        activity.set(id, { opens: Number(w?.opens) || 0, tokens: typeof w?.tokens === 'number' && Number.isFinite(w.tokens) ? w.tokens : null });
      }
    } catch { /* chronicle down: no opens / tokens */ }
  }
  const out: Record<string, WorldNumbers> = {};
  for (const k of ids) {
    const g = ratingGroups[k];
    const shown = (refs[k] ?? [k]).map((r) => plays.get(r)).filter((x): x is { playthroughs: number; players: number } => !!x);
    out[k] = {
      rating: { count: Number(g?.count) || 0, average: typeof g?.avg?.rating === 'number' ? g.avg.rating : null },
      likes: Number(likeGroups[k]?.count) || 0,
      plays: shown.length ? shown.reduce((sum, x) => sum + x.playthroughs, 0) : null,
      players: shown.length ? shown.reduce((sum, x) => sum + x.players, 0) : null,
      ...activityOf(refs[k] ?? [k], activity),
    };
  }
  return out;
}

// ── the account's AI use and wallet (account panel) ─────────────────────────────

export const DEFAULT_BILLING_BASE = 'https://billing.worldlines.gg';
const aiBase = () => ((process.env.AIRP_AI_BASE ?? '').trim() || (process.env.AIRP_AI_ACCOUNT_BASE ?? '').trim() || 'https://ai.worldlines.gg/v1').replace(/\/+$/, '');
export const billingBase = () => (process.env.AIRP_BILLING_BASE ?? '').trim().replace(/\/+$/, '') || DEFAULT_BILLING_BASE;

export interface AccountUsage {
  plan: string | null;
  today: { tokens: number; usd: number } | null;
  month: { tokens: number; usd: number } | null;
  /** credits (the wallet's units / 1000) */
  wallet: { pointName: string | null; available: number | null; usedToday: number | null; resetsAt: string | null; daily?: DailyAllowance | null } | null;
  /**
   * The membership as billing has it (`/v1/me/subscription`): the plan, where it comes from (stripe / admin / code)
   * and, for a 体验会员 (redemption code), when the trial ends; endsAt = when a canceled paid subscription ends (it
   * won't renew; billing cancel_at, 0014 — or current_period_end on an older billing); null = renews / no subscription.
   * null when billing did not answer.
   */
  membership: { plan: string; source: string | null; trialEndsAt: string | null; endsAt: string | null } | null;
}
/**
 * Today's free allowance (billing `/v1/me/balance` → daily): claim-only — nothing is granted until the player
 * presses 「领取今日额度」 (POST /v1/claims/worldlines/daily). Credits; null fields when billing left them out.
 */
export interface DailyAllowance {
  allowance: number;
  claimed: number;
  claimable: boolean;
  resetsAt: string | null;
  /**
   * Which free tier applies today (billing migration 0008): `newcomer` = the account's first
   * newcomer_days days (100 credits a day; newcomerDay / newcomerDays for 「新手期 第 n/8 天」), `regular` = after
   * that (50 a day), `none` = a paid plan. Absent when billing is older than 0008.
   */
  tier?: 'newcomer' | 'regular' | 'none';
  newcomerDay?: number;
  newcomerDays?: number;
  /** Credits a day once the newcomer period is over. */
  regular?: number;
}
const TIERS = new Set(['newcomer', 'regular', 'none']);
const dailyOf = (d: any): DailyAllowance | null => {
  if (!d || typeof d !== 'object' || typeof d.allowance !== 'number') return null;
  const out: DailyAllowance = { allowance: Math.round(d.allowance) / 1000, claimed: typeof d.claimed === 'number' ? Math.round(d.claimed) / 1000 : 0, claimable: d.claimable === true, resetsAt: typeof d.resets_at === 'string' ? d.resets_at : null };
  if (TIERS.has(d.tier)) {
    out.tier = d.tier;
    if (typeof d.regular_mc === 'number') out.regular = Math.round(d.regular_mc) / 1000;
    if (d.tier === 'newcomer' && Number.isInteger(d.newcomer_day) && Number.isInteger(d.newcomer_days) && d.newcomer_days > 0) {
      out.newcomerDay = d.newcomer_day;
      out.newcomerDays = d.newcomer_days;
    }
  }
  return out;
};

/** Today / this month's tokens and spend (ai.worldlines.gg) + the wallet (billing.worldlines.gg). Each part may be null. */
export async function usage(deps: AccountDataDeps = {}): Promise<AccountUsage> {
  const [ai, bill, sub] = await Promise.all([
    request('GET', '', deps, { url: `${aiBase()}/usage/me`, headers: { 'x-worldlines-product': PRODUCT } }).catch((e) => { if (e instanceof DataUnavailable && e.reason === 'signed_out') throw e; return null; }),
    request('GET', '', deps, { url: `${billingBase()}/v1/me/balance?product=${PRODUCT}` }).catch(() => null),
    request('GET', '', deps, { url: `${billingBase()}/v1/me/subscription` }).catch(() => null),
  ]);
  const m = sub?.status === 200 && typeof sub.body?.plan === 'string' ? sub.body : null;
  // the world model hints (engine/world-models.ts) read the plan from here
  rememberAccountPlan(ai?.status === 200 && typeof ai.body?.plan === 'string' ? ai.body.plan : m?.plan);
  const spend = (x: any) => (x && typeof x === 'object' ? { tokens: Number(x.tokens) || 0, usd: Number(x.usd) || 0 } : null);
  const b = bill?.status === 200 ? bill.body : null;
  const credits = (mc: unknown) => (typeof mc === 'number' ? Math.round(mc) / 1000 : null);
  return {
    plan: ai?.status === 200 && typeof ai.body?.plan === 'string' ? ai.body.plan : null,
    today: ai?.status === 200 ? spend(ai.body?.today) : null,
    month: ai?.status === 200 ? spend(ai.body?.month) : null,
    wallet: b ? { pointName: b.point_name?.persistent ?? b.point_name?.daily ?? null, available: credits(b.available_mc), usedToday: credits(b.daily?.used), resetsAt: b.daily?.resets_at ?? null, daily: dailyOf(b.daily) } : null,
    membership: m ? { plan: m.plan, source: typeof m.source === 'string' ? m.source : null, trialEndsAt: typeof m.trial_ends_at === 'string' ? m.trial_ends_at : null, endsAt: endsAtOf(m) } : null,
  };
}

/** A paid subscription that ends at a set time and won't renew (billing cancel_at / cancel_at_period_end) → that time. */
function endsAtOf(m: any): string | null {
  if (m?.cancel_at_period_end !== true || typeof m.trial_ends_at === 'string') return null;
  const at = typeof m.cancel_at === 'string' ? m.cancel_at : typeof m.current_period_end === 'string' ? m.current_period_end : null;
  return at;
}

// ── today's free allowance (billing POST /v1/claims/worldlines/daily) ──────────────

/**
 * The wallet LivingCanvas spends: pricing v3 has ONE consumer wallet `worldlines` for every Worldlines product
 * (platform manifest products/livingcanvas `billing.wallet`; the ai service bills LivingCanvas calls to it), so the
 * daily claim names it directly — billing would alias `livingcanvas` to it too.
 */
export const CLAIM_WALLET = 'worldlines';
/**
 * 「领取今日额度」 for the signed-in account (account panel; the gentle prompt when a call says claim_required).
 * Once per wallet day: a second press answers `duplicated`. billing's refusals (nothing_to_claim,
 * session_required …) come back as DataRefused with billing's code.
 */
export async function claimDaily(deps: AccountDataDeps = {}, device?: unknown): Promise<{ claimed: { credits: number; duplicated: boolean; available: number | null; daily: DailyAllowance | null } }> {
  // billing caps free claims per device / address (anti-abuse 2026-10-04): the page's device id rides along
  const a = await request('POST', '', deps, { url: `${billingBase()}/v1/claims/${CLAIM_WALLET}/daily`, body: {}, headers: deviceHeader(device) });
  if (a.status !== 200 && a.status !== 201) {
    const err = typeof a.body?.error === 'string' ? a.body.error : 'claim_failed';
    throw new DataRefused(a.status >= 400 && a.status < 500 ? a.status : 502, err, typeof a.body?.message === 'string' ? a.body.message : `billing answered HTTP ${a.status}.`);
  }
  const mc = Number(a.body?.amount_mc ?? a.body?.entry?.delta_mc);
  const bal = a.body?.balance;
  return {
    claimed: {
      credits: Number.isFinite(mc) ? Math.round(mc) / 1000 : 0,
      duplicated: a.body?.duplicated === true || a.body?.status === 'duplicated',
      available: typeof bal?.available_mc === 'number' ? Math.round(bal.available_mc) / 1000 : null,
      daily: dailyOf(bal?.daily),
    },
  };
}

// ── the newcomer gift (billing POST /v1/claims/worldlines/newcomer, migration 0011) ──────────────

/**
 * 新手礼包: 500 credits once per account, asked for WITHOUT a click — the page calls this when a
 * signed-in player enters a scene / sends an action. Same path and device id as the daily claim, so billing's
 * free-claim caps per device / address apply. `created` = it arrived just now (the page shows a toast);
 * `duplicated` = the account already had it (nothing to show). Refusals (nothing_to_claim, claim_limited …) come back
 * as DataRefused with billing's code.
 */
export async function claimNewcomer(deps: AccountDataDeps = {}, device?: unknown): Promise<{ gift: { credits: number; created: boolean; expiresAt: string | null; available: number | null } }> {
  const a = await request('POST', '', deps, { url: `${billingBase()}/v1/claims/${CLAIM_WALLET}/newcomer`, body: {}, headers: deviceHeader(device) });
  if (a.status !== 200 && a.status !== 201) {
    const err = typeof a.body?.error === 'string' ? a.body.error : 'claim_failed';
    throw new DataRefused(a.status >= 400 && a.status < 500 ? a.status : 502, err, typeof a.body?.message === 'string' ? a.body.message : `billing answered HTTP ${a.status}.`);
  }
  const mc = Number(a.body?.amount_mc);
  const bal = a.body?.balance;
  return {
    gift: {
      credits: Number.isFinite(mc) ? Math.round(mc) / 1000 : 0,
      created: a.body?.status === 'created',
      expiresAt: typeof a.body?.expires_at === 'string' ? a.body.expires_at : null,
      available: typeof bal?.available_mc === 'number' ? Math.round(bal.available_mc) / 1000 : null,
    },
  };
}

// ── redemption codes (体验会员; billing POST /v1/me/redeem) ─────────────────────

export interface Redeemed {
  /** invite = an invite code (WL-XXXXXX, billing src/invite.mjs): only credits, never a plan */
  outcome: 'trial_started' | 'credits_only' | 'invite';
  code: string;
  /** the plan the account is on afterwards */
  plan: string | null;
  /** a trial: when it ends (ISO); otherwise null */
  endsAt: string | null;
  credits: number;
  /** a trial code used by a member: the plan stayed, only the credits came */
  alreadyMember: boolean;
  /** an invite code: the credits are a reward that unlocks after playing a bit (billing `pending_verification`), not added yet */
  pendingVerification: boolean;
  rewardId: string | null;
}
// ko: billing remembers it for the trial-ending mail (platform migration 0005); an older billing drops it to null.
const REDEEM_LOCALE: Record<string, string> = { 'zh-CN': 'zh', zh: 'zh', ja: 'ja', en: 'en', ko: 'ko' };
/**
 * Redeem a code for the signed-in account (the account panel's 「输入兑换码」). billing decides everything; its
 * refusals come back as DataRefused with billing's code (invalid_code, already_redeemed, already_member,
 * trial_active, rate_limited, session_required …) for the page to say in the player's language.
 */
export async function redeem(input: { code?: unknown; locale?: unknown; device?: unknown }, deps: AccountDataDeps = {}): Promise<{ redeemed: Redeemed }> {
  const code = typeof input.code === 'string' ? input.code.trim() : '';
  if (!code || code.length > 80) throw new DataRefused(400, 'invalid_code', 'Enter a code.');
  const locale = typeof input.locale === 'string' ? REDEEM_LOCALE[input.locale] : undefined;
  const headers = deviceHeader(input.device);
  const a = await request('POST', '', deps, { url: `${billingBase()}/v1/me/redeem`, body: { code, ...(locale ? { locale } : {}) }, headers });
  if (a.status !== 200) {
    const err = typeof a.body?.error === 'string' ? a.body.error : 'redeem_failed';
    throw new DataRefused(a.status >= 400 && a.status < 500 ? a.status : 502, err, typeof a.body?.message === 'string' ? a.body.message : `billing answered HTTP ${a.status}.`);
  }
  const r = a.body ?? {};
  return {
    redeemed: {
      outcome: r.outcome === 'trial_started' ? 'trial_started' : r.outcome === 'invite' ? 'invite' : 'credits_only',
      code: typeof r.code === 'string' ? r.code : code,
      plan: typeof r.plan === 'string' ? r.plan : null,
      endsAt: typeof r.ends_at === 'string' ? r.ends_at : null,
      credits: typeof r.credits === 'number' ? r.credits : 0,
      alreadyMember: r.already_member === true,
      pendingVerification: r.pending_verification === true,
      rewardId: typeof r.reward_id === 'string' ? r.reward_id : null,
    },
  };
}

// ── playthroughs → chronicle (play counts) ────────────────────────────────────

/**
 * LivingCanvas has no backend, so this server reports the player's own plays to chronicle
 * (via=user; product livingcanvas counts in the public numbers, capped per player): a
 * playthrough per save, a session per save per process, and a run per finished writer turn.
 * Best effort — never blocks or fails a turn.
 */
const sessions = new Map<string, string>();
export async function reportTurn(input: { saveId?: unknown; worldRef?: unknown; worldName?: unknown; client?: unknown }, deps: AccountDataDeps = {}, now = Date.now()): Promise<{ reported: boolean }> {
  const saveId = typeof input.saveId === 'string' && LOCAL_ID.test(input.saveId) ? input.saveId : null;
  const world = typeof input.worldRef === 'string' && LOCAL_ID.test(input.worldRef) ? input.worldRef : null;
  if (!saveId || !world) throw new DataRefused(400, 'invalid_turn', 'saveId and worldRef are required.');
  const at = new Date(now).toISOString();
  const events: Record<string, unknown>[] = [];
  let session = sessions.get(saveId);
  if (!session) {
    session = `${saveId}-${now.toString(36)}`;
    const title = clip(input.worldName, 120);
    events.push({ type: 'playthrough.ensure', occurred_at: at, save_id: saveId, world_ref: `${PRODUCT}/world/${world}`, ...(title ? { meta: { world_title: title } } : {}) });
    events.push({ type: 'session.start', occurred_at: at, save_id: saveId, session_id: session, client: input.client === 'local' ? 'local' : 'web' });
  }
  const run = `${session}-${randomBytes(6).toString('hex')}`;
  events.push({ type: 'run.begin', occurred_at: at, save_id: saveId, run_id: run, session_id: session });
  events.push({ type: 'run.commit', occurred_at: at, save_id: saveId, run_id: run });
  const a = await request('POST', '', deps, { url: `${chronicleBase()}/v1/events:batch`, body: { product: PRODUCT, events } });
  if (a.status !== 200) return { reported: false };
  sessions.set(saveId, session);
  return { reported: true };
}

/**
 * 「总打开次数」: the player opened a world → chronicle `world.open` (via=user, the account's token). The server folds a
 * reopen of the same world within 30 minutes; each call carries a fresh open id, so a retry of THIS call is a duplicate.
 * Best effort — never blocks opening the world.
 */
export async function reportOpen(input: { worldRef?: unknown; client?: unknown }, deps: AccountDataDeps = {}, now = Date.now()): Promise<{ reported: boolean }> {
  const world = typeof input.worldRef === 'string' && LOCAL_ID.test(input.worldRef) ? input.worldRef : null;
  if (!world) throw new DataRefused(400, 'invalid_open', 'worldRef is required.');
  const event = { type: 'world.open', occurred_at: new Date(now).toISOString(), world_ref: `${PRODUCT}/world/${world}`, open_id: `o-${now.toString(36)}-${randomBytes(8).toString('hex')}`, client: input.client === 'local' ? 'local' : 'web' };
  const a = await request('POST', '', deps, { url: `${chronicleBase()}/v1/events:batch`, body: { product: PRODUCT, events: [event] } });
  return { reported: a.status === 200 };
}

/**
 * 改进产品 (anonymous usage + front-end errors, apps/web/src/lib/analytics.ts): a signed-in page's batch goes to chronicle
 * `POST /v1/events` with the account's token, so the rows carry the uid (the page never holds the token). The page
 * already checked every event against the closed list; chronicle checks again. Here: only the envelope (product fixed,
 * ≤ 50 events, ≤ 60 KB) — the batch passes through unchanged. Signed out → "not available" (the page decides).
 */
export const USAGE_MAX_EVENTS = 50;
export const USAGE_MAX_BYTES = 60_000;
const USAGE_KEYS = new Set(['product', 'session_id', 'app_version', 'locale', 'src', 'events']);
export async function reportUsage(input: unknown, deps: AccountDataDeps = {}): Promise<{ status: number; accepted: number | null }> {
  const b = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : null;
  if (!b || !Array.isArray(b.events) || !b.events.length || b.events.length > USAGE_MAX_EVENTS) throw new DataRefused(400, 'invalid_events', `events must be 1–${USAGE_MAX_EVENTS} items.`);
  if (Object.keys(b).some((k) => !USAGE_KEYS.has(k)) || typeof b.session_id !== 'string') throw new DataRefused(400, 'invalid_events', 'Unexpected envelope.');
  const body = { ...b, product: PRODUCT };
  if (Buffer.byteLength(JSON.stringify(body)) > USAGE_MAX_BYTES) throw new DataRefused(413, 'too_large', 'Batch too large.');
  const a = await request('POST', '', deps, { url: `${chronicleBase()}/v1/events`, body });
  return { status: a.status, accepted: typeof a.body?.accepted === 'number' ? a.body.accepted : null };
}

// ── invites + claimable rewards (邀请好友; billing src/invite.mjs) ─────────────────

/** This browser / computer, for billing's per-device limits on invites and free claims (a random id the page keeps; billing hashes it). */
function deviceHeader(raw: unknown): Record<string, string> {
  return typeof raw === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(raw) ? { 'x-worldlines-device': raw } : {};
}

export interface InviteInfo {
  code: string;
  shareUrl: string;
  enabled: boolean;
  inviteeCredits: number;
  inviterCredits: number;
  monthlyCap: number;
  windowDays: number;
  stats: { invited: number; played: number; rewarded: number; creditsEarned: number; creditsPending: number; remainingThisMonth: number };
  /** The invite code this account itself redeemed, if any. */
  redeemed: { code: string; credits: number } | null;
  canRedeem: boolean;
}
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
/** 「邀请好友」: the account's own code, its share link and the numbers (billing GET /v1/me/invite). */
export async function invite(deps: AccountDataDeps = {}): Promise<{ invite: InviteInfo }> {
  const a = await request('GET', '', deps, { url: `${billingBase()}/v1/me/invite` });
  if (a.status !== 200 || typeof a.body?.code !== 'string') {
    throw new DataRefused(a.status >= 400 && a.status < 500 ? a.status : 502, typeof a.body?.error === 'string' ? a.body.error : 'invite_failed', `billing answered HTTP ${a.status}.`);
  }
  const b = a.body;
  const st = b.stats ?? {};
  return {
    invite: {
      code: b.code,
      shareUrl: typeof b.share_url === 'string' ? b.share_url : `https://canvas.worldlines.gg/?invite=${encodeURIComponent(b.code)}`,
      enabled: b.enabled !== false,
      inviteeCredits: num(b.invitee_credits),
      inviterCredits: num(b.inviter_credits),
      monthlyCap: num(b.monthly_cap),
      windowDays: num(b.window_days),
      stats: { invited: num(st.invited), played: num(st.played), rewarded: num(st.rewarded), creditsEarned: num(st.credits_earned), creditsPending: num(st.credits_pending), remainingThisMonth: num(st.remaining_this_month) },
      redeemed: b.redeemed && typeof b.redeemed.code === 'string' ? { code: b.redeemed.code, credits: num(b.redeemed.credits) } : null,
      canRedeem: b.can_redeem === true,
    },
  };
}

export const MILESTONE_KINDS = ['first_clear'] as const;
/** A first (today: the first ending reached) → billing, which rewards the inviter once the play is real. Best effort. */
export async function reportMilestone(input: { kind?: unknown; world?: unknown; ending?: unknown }, deps: AccountDataDeps = {}): Promise<{ reported: boolean; first?: boolean; invite?: string | null }> {
  if (!MILESTONE_KINDS.includes(input.kind as typeof MILESTONE_KINDS[number])) throw new DataRefused(400, 'unknown_milestone', 'Not a milestone.');
  const ref = (v: unknown) => (typeof v === 'string' && /^[A-Za-z0-9._:@/-]{1,128}$/.test(v) ? v : undefined);
  const a = await request('POST', '', deps, { url: `${billingBase()}/v1/me/milestones`, body: { kind: input.kind, ...(ref(input.world) ? { world: ref(input.world) } : {}), ...(ref(input.ending) ? { ending: ref(input.ending) } : {}) } });
  if (a.status !== 200) return { reported: false };
  return { reported: true, first: a.body?.first === true, invite: typeof a.body?.invite === 'string' ? a.body.invite : null };
}

/**
 * Where a reward stands (billing, anti-abuse): `pending_verification` = waiting for play billing
 * itself served (calls in one world, maybe an ending; `progress`), `claimable` = the claim button, then `claimed`,
 * or `revoked` / `expired`. Kinds: invite (the inviter's, after the friend really played), invite_welcome (the
 * invitee's, after ≥ need turns in one world within the window), trial_rest (the rest of the welcome credits,
 * after the account's first turns).
 */
export type RewardState = 'pending_verification' | 'claimable' | 'claimed' | 'revoked' | 'expired';
export interface RewardProgress { calls: number; need: number; endingNeeded: boolean; ending: boolean }
export interface Reward {
  id: string; kind: string; credits: number;
  state: RewardState;
  /** billing's legacy field: 'pending' = claimable */
  status: 'pending_verification' | 'pending' | 'claimed' | 'revoked' | 'expired';
  progress: RewardProgress | null;
  expiresAt: string | null; createdAt: string | null; claimedAt: string | null;
}
const REWARD_STATES: readonly RewardState[] = ['pending_verification', 'claimable', 'claimed', 'revoked', 'expired'];
const LEGACY_STATE: Record<string, RewardState> = { pending: 'claimable', pending_verification: 'pending_verification', claimed: 'claimed', revoked: 'revoked', expired: 'expired' };
const isoOrNull = (v: unknown) => (typeof v === 'string' ? v : null);
/** One billing reward row → Reward. An older billing without `state` → from `status` (a bare 'pending' is claimable). */
export function rewardOf(r: any): Reward {
  const state: RewardState = REWARD_STATES.includes(r?.state) ? r.state : LEGACY_STATE[r?.status] ?? 'claimable';
  const p = r?.progress;
  const progress = p && typeof p === 'object'
    ? { calls: num(p.calls), need: num(p.need), endingNeeded: p.ending_needed === true, ending: p.ending === true }
    : null;
  return {
    id: String(r?.id), kind: String(r?.kind), credits: num(r?.credits),
    state,
    status: state === 'claimable' ? 'pending' : state,
    progress,
    expiresAt: isoOrNull(r?.expires_at), createdAt: isoOrNull(r?.created_at), claimedAt: isoOrNull(r?.claimed_at),
  };
}
/** The account's rewards (billing GET /v1/me/rewards): claimable ones and those still waiting for play. */
export async function rewards(deps: AccountDataDeps = {}): Promise<{ rewards: Reward[] }> {
  const a = await request('GET', '', deps, { url: `${billingBase()}/v1/me/rewards` });
  if (a.status !== 200) throw new DataRefused(a.status >= 400 && a.status < 500 ? a.status : 502, typeof a.body?.error === 'string' ? a.body.error : 'rewards_failed', `billing answered HTTP ${a.status}.`);
  return { rewards: (Array.isArray(a.body?.rewards) ? a.body.rewards : []).map(rewardOf) };
}
export async function claimReward(idRaw: unknown, deps: AccountDataDeps = {}, device?: unknown): Promise<{ reward: Reward }> {
  const id = typeof idRaw === 'string' && /^[0-9a-f-]{36}$/.test(idRaw) ? idRaw : null;
  if (!id) throw new DataRefused(400, 'unknown_reward', 'Not a reward.');
  const a = await request('POST', '', deps, { url: `${billingBase()}/v1/me/rewards/${id}/claim`, body: {}, headers: deviceHeader(device) });
  if (a.status !== 200) throw new DataRefused(a.status >= 400 && a.status < 500 ? a.status : 502, typeof a.body?.error === 'string' ? a.body.error : 'claim_failed', `billing answered HTTP ${a.status}.`);
  return { reward: rewardOf(a.body?.reward ?? {}) };
}

export const REPORT_REASONS = ['spam', 'abuse', 'spoiler', 'personal_info', 'other'] as const;
/** Flag a comment for the admins. One report per comment per player is enough: a repeat is a no-op. */
export async function report(reviewIdRaw: unknown, input: { reason?: unknown; note?: unknown }, deps: AccountDataDeps = {}): Promise<{ reported: true }> {
  const reviewId = typeof reviewIdRaw === 'string' && LOCAL_ID.test(reviewIdRaw) ? reviewIdRaw : null;
  if (!reviewId) throw new DataRefused(400, 'invalid_target', 'Not a comment.');
  if (!REPORT_REASONS.includes(input.reason as typeof REPORT_REASONS[number])) throw new DataRefused(400, 'invalid_reason', 'Pick a reason.');
  const target = `${PRODUCT}/review/${reviewId}`;
  const [already] = await mine('report', deps, { target });
  if (already) return { reported: true };
  const note = clip(input.note, 500);
  const a = await create('report', { target, reason: input.reason, ...(note ? { note } : {}) }, deps);
  if (a.status !== 201) refused(a);
  return { reported: true };
}

// ── 报告问题 / 卡住了 (bug-report, the Worldlines platform manifest v12) ───────────────

export const FEEDBACK_KINDS = ['stuck', 'bug', 'idea'] as const;
export type FeedbackKind = typeof FEEDBACK_KINDS[number];
export const FEEDBACK_TEXT_MAX = 1000;
const FINGERPRINT = /^[a-f0-9]{32}$/;
const CLIENT_VERSION = /^[A-Za-z0-9._+-]{1,40}$/;
// eslint-disable-next-line no-control-regex
const PLACE = /^[^\u0000-\u001F\u007F]{1,200}$/;
export interface FeedbackBody {
  kind: FeedbackKind;
  text?: string;
  world_id?: string;
  edition?: string;
  place?: string;
  place_title?: string;
  client_version?: string;
  client_mode?: 'local' | 'browser';
  locale?: 'en' | 'zh-CN' | 'ja' | 'ko';
  guest?: boolean;
  errors?: string[];
}

/**
 * The page's report → exactly the manifest's fields (what the player was shown before sending): the kind, their own
 * words, where they were (world, edition, place), the client and up to five error fingerprints. Never conversation
 * text — there is no field for it. Anything malformed is dropped, not refused; only the kind and the text length refuse.
 */
export function cleanFeedback(input: unknown): FeedbackBody {
  const src = (input && typeof input === 'object' && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
  if (!FEEDBACK_KINDS.includes(src.kind as FeedbackKind)) throw new DataRefused(400, 'invalid_kind', 'Pick 卡住了, 出 bug 了 or 建议.');
  const text = typeof src.text === 'string' ? src.text.trim() : '';
  if ([...text].length > FEEDBACK_TEXT_MAX) throw new DataRefused(400, 'text_too_long', `At most ${FEEDBACK_TEXT_MAX} characters.`);
  const out: FeedbackBody = { kind: src.kind as FeedbackKind };
  if (text) out.text = text;
  const id = (v: unknown) => (typeof v === 'string' && LOCAL_ID.test(v.trim()) ? v.trim() : null);
  const world = id(src.world_id);
  if (world) out.world_id = world;
  const edition = id(src.edition);
  if (edition) out.edition = edition;
  if (typeof src.place === 'string' && PLACE.test(src.place.trim())) out.place = src.place.trim();
  const title = clip(src.place_title, 120);
  if (title) out.place_title = title;
  if (typeof src.client_version === 'string' && CLIENT_VERSION.test(src.client_version)) out.client_version = src.client_version;
  if (src.client_mode === 'local' || src.client_mode === 'browser') out.client_mode = src.client_mode;
  if (['en', 'zh-CN', 'ja', 'ko'].includes(src.locale as string)) out.locale = src.locale as FeedbackBody['locale'];
  if (Array.isArray(src.errors)) {
    const fps = [...new Set(src.errors.filter((x): x is string => typeof x === 'string' && FINGERPRINT.test(x)))].slice(0, 5);
    if (fps.length) out.errors = fps;
  }
  return out;
}

/**
 * Send a report to the admins (the console's 「玩家反馈」). Signed in: as the account. Signed out with a guest trial
 * session on this device: as the guest (bug-report takes guests; `deps.guestToken`). Neither: signed_out (the page
 * then points at the contact channels). Nothing is kept on this device.
 */
export async function sendFeedback(input: unknown, deps: AccountDataDeps & { guestToken?: (opts?: { force?: boolean }) => Promise<string | null> } = {}): Promise<{ sent: true; id: string | null; as: 'account' | 'guest' }> {
  const body = cleanFeedback(input);
  let as: 'account' | 'guest' = 'account';
  let a: Answer;
  try {
    a = await create('bug-report', body, deps);
  } catch (error) {
    if (!(error instanceof DataUnavailable) || error.reason !== 'signed_out' || !deps.guestToken) throw error;
    const guest = deps.guestToken;
    if (!(await guest())) throw error;
    as = 'guest';
    a = await create('bug-report', { ...body, guest: true }, { ...deps, token: guest });
  }
  if (a.status !== 201) refused(a);
  return { sent: true, id: typeof a.body?.id === 'string' ? a.body.id : null, as };
}

export interface Announcement {
  id: string;
  level: 'info' | 'maintenance' | 'important';
  title: Record<string, string>;
  body: Record<string, string>;
  startsAt: string;
  endsAt: string | null;
  pinned: boolean;
  imageUrl?: string;
  linkUrl?: string;
  /** log = a 日志 with a banner (platform/log v5, id log/<id>); announcement = the old platform|livingcanvas/announcement */
  source: 'log' | 'announcement';
  category?: string;
}
/** Optional picture / link (platform-data v3, livingcanvas v11): https only; a link may also be world:<id> (opens that world). */
const ANNOUNCEMENT_IMAGE = /^https:\/\/\S{1,490}$/;
const ANNOUNCEMENT_LINK = /^(https:\/\/\S{1,490}|world:[A-Za-z0-9][A-Za-z0-9._-]{0,127})$/;
const LEVELS = ['info', 'maintenance', 'important'];
/** starts_at ≤ now < ends_at (no ends_at = until the entry is taken down). */
export function bannerOn(startsAt: unknown, endsAt: unknown, now: number): boolean {
  const starts = typeof startsAt === 'string' ? Date.parse(startsAt) : NaN;
  const ends = typeof endsAt === 'string' && endsAt ? Date.parse(endsAt) : null;
  return Number.isFinite(starts) && starts <= now && !(ends !== null && (!Number.isFinite(ends) || ends <= now));
}

/**
 * Public: the top banners on now (pinned first, then newest). Since platform-data v5 they are 日志 with a banner
 * (GET /v1/public/logs?platform=livingcanvas&banner=active); the old platform/announcement + livingcanvas/announcement
 * are read ONLY while data answers that the logs endpoint is not there / does not know v5 (an older data deploy), so
 * this ships before or after the platform. The answer may be cached anywhere: the window is checked again here (and
 * again on the page).
 */
export async function announcements(deps: AccountDataDeps = {}, now = Date.now()): Promise<Announcement[]> {
  const banners = await bannerLogs(deps, now);
  const out = banners ?? (await oldAnnouncements(deps, now));
  return dedupeAnnouncements(out).sort((x, y) => Number(y.pinned) - Number(x.pinned) || y.startsAt.localeCompare(x.startsAt));
}

/** v5 banner logs on now; null = this data deploy has no v5 logs (read the old announcements instead). */
async function bannerLogs(deps: AccountDataDeps, now: number): Promise<Announcement[] | null> {
  const a = await publicLogs({ platform: PRODUCT, banner: 'active', limit: '50' }, deps);
  if (!a.v5) return null;
  const out: Announcement[] = [];
  for (const raw of a.logs) {
    const l = logOf(raw);
    const b = l?.banner;
    if (!l || !b || !bannerOn(b.startsAt, b.endsAt, now)) continue;
    out.push({ id: `log/${l.id}`, level: b.level, title: l.title, body: l.body, startsAt: b.startsAt, endsAt: b.endsAt, pinned: b.pinned, source: 'log', category: l.category, ...(l.imageUrl ? { imageUrl: l.imageUrl } : {}), ...(b.linkUrl ? { linkUrl: b.linkUrl } : {}) });
  }
  return out;
}

async function oldAnnouncements(deps: AccountDataDeps, now: number): Promise<Announcement[]> {
  const out: Announcement[] = [];
  let failed: unknown = null;
  for (const scope of ['platform', PRODUCT]) {
    let a: Answer;
    try {
      a = await request('GET', `/v1/public/records/${scope}/announcement?limit=50&order=-created_at`, deps, { anonymous: true });
    } catch (error) {
      failed = error; // one scope missing (not deployed yet) still shows the other
      continue;
    }
    if (a.status !== 200) { failed = new DataRefused(a.status, 'data_error', `HTTP ${a.status}`); continue; }
    for (const r of (a.body?.records ?? []) as Array<{ id: string; body: any }>) {
      const b = r.body ?? {};
      if (!bannerOn(b.starts_at, b.ends_at, now) || !LEVELS.includes(b.level)) continue;
      out.push({ id: `${scope}/${r.id}`, level: b.level, title: b.title ?? {}, body: b.body ?? {}, startsAt: b.starts_at, endsAt: b.ends_at ?? null, pinned: b.pinned === true, source: 'announcement', ...(typeof b.image_url === 'string' && ANNOUNCEMENT_IMAGE.test(b.image_url) ? { imageUrl: b.image_url } : {}), ...(typeof b.link_url === 'string' && ANNOUNCEMENT_LINK.test(b.link_url) ? { linkUrl: b.link_url } : {}) });
    }
  }
  if (failed && !out.length) throw failed;
  return out;
}

/** The migration copies platform/announcement X to the log ann-platform-X (livingcanvas likewise): never both. */
export const MIGRATED_LOG = /^log\/ann-(platform|livingcanvas)-([A-Za-z0-9][A-Za-z0-9._-]{0,127})$/;
export function dedupeAnnouncements<T extends { id: string }>(list: readonly T[]): T[] {
  const migrated = new Set<string>();
  for (const a of list) { const m = MIGRATED_LOG.exec(a.id); if (m) migrated.add(`${m[1]}/${m[2]}`); }
  const seen = new Set<string>();
  return list.filter((a) => !migrated.has(a.id) && !seen.has(a.id) && (seen.add(a.id), true));
}

// ── 日志 (platform/log v5, data GET /v1/public/logs: published only, newest first; ETag / 304) ────────────────

export interface LogBanner { level: 'info' | 'maintenance' | 'important'; startsAt: string; endsAt: string | null; pinned: boolean; linkUrl?: string }
export interface LogEntry { id: string; scope: string; category: string; title: Record<string, string>; body: Record<string, string>; publishedAt: string; links: Array<{ url: string; label?: string }>; tags: string[]; imageUrl?: string; banner?: LogBanner }
const LOG_TEXT_LOCALES = ['zh', 'ja', 'ko', 'en'];
const LOG_LINK = ANNOUNCEMENT_LINK;
const LOG_CATEGORIES = ['release', 'feature', 'improvement', 'fix', 'incident', 'maintenance', 'world-update', 'plan', 'notice'];
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;
const textOf = (raw: unknown): Record<string, string> => {
  const out: Record<string, string> = {};
  if (raw && typeof raw === 'object') for (const l of LOG_TEXT_LOCALES) { const v = (raw as Record<string, unknown>)[l]; if (typeof v === 'string' && v) out[l] = v; }
  return out;
};
/** One entry as the page may see it: unknown fields dropped, links / picture checked (https, or world:<id> for links). */
export function logOf(r: Record<string, any> | null | undefined): LogEntry | null {
  if (!r || typeof r.id !== 'string' || !LOCAL_ID.test(r.id) || typeof r.published_at !== 'string' || !Number.isFinite(Date.parse(r.published_at))) return null;
  const title = textOf(r.title);
  if (!Object.keys(title).length) return null;
  const links = (Array.isArray(r.links) ? r.links : []).filter((l: any) => typeof l?.url === 'string' && LOG_LINK.test(l.url)).slice(0, 8).map((l: any) => ({ url: l.url, ...(typeof l.label === 'string' && l.label ? { label: l.label.slice(0, 80) } : {}) }));
  const tags = (Array.isArray(r.tags) ? r.tags : []).filter((t: unknown): t is string => typeof t === 'string' && /^[a-z0-9][a-z0-9-]{0,31}$/.test(t)).slice(0, 12);
  const b = r.banner;
  const banner: LogBanner | undefined = b && typeof b === 'object' && LEVELS.includes(b.level) && typeof b.starts_at === 'string' && Number.isFinite(Date.parse(b.starts_at))
    ? { level: b.level, startsAt: b.starts_at, endsAt: typeof b.ends_at === 'string' && b.ends_at ? b.ends_at : null, pinned: b.pinned === true, ...(typeof b.link_url === 'string' && LOG_LINK.test(b.link_url) ? { linkUrl: b.link_url } : {}) }
    : undefined;
  return {
    id: r.id,
    scope: String(r.scope ?? ''),
    category: LOG_CATEGORIES.includes(r.category) ? r.category : 'notice',
    title,
    body: textOf(r.body),
    publishedAt: r.published_at,
    links,
    tags,
    ...(typeof r.image_url === 'string' && ANNOUNCEMENT_IMAGE.test(r.image_url) ? { imageUrl: r.image_url } : {}),
    ...(banner ? { banner } : {}),
  };
}

interface LogsAnswer { v5: boolean; logs: Array<Record<string, any>>; nextBefore: string | null }
const NO_LOGS: LogsAnswer = { v5: false, logs: [], nextBefore: null };
const LOG_CACHE_MAX = 40;
/** url → the last 200 answer and its ETag: asked again with If-None-Match (304 = unchanged), and kept when data is down. */
const logCache = new Map<string, LogsAnswer & { etag: string | null }>();
export const clearLogCache = () => logCache.clear();

/**
 * GET /v1/public/logs without a token. 404 (no logs on this deploy) and 400 (a deploy that does not know these
 * parameters) = no logs, `v5: false`; a 200 without `next_before` is a v4 deploy (it ignores platform / banner).
 * Unreachable / 5xx / 429: the last answer for this URL if there is one, else "not available".
 */
async function publicLogs(params: Record<string, string>, deps: AccountDataDeps): Promise<LogsAnswer> {
  const base = dataBase();
  if (base === null) throw new DataUnavailable('off', 'The data service is turned off on this computer (AIRP_DATA_BASE=off).');
  const url = `${base}/v1/public/logs?${new URLSearchParams(params)}`;
  const hit = logCache.get(url);
  let res: Response;
  try {
    res = await (deps.fetch ?? fetch)(url, { method: 'GET', redirect: 'error', headers: { accept: 'application/json', ...(hit?.etag ? { 'if-none-match': hit.etag } : {}) }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    if (hit) return hit;
    throw new DataUnavailable('unreachable', `The data service could not be reached (${error instanceof Error ? error.name : 'network error'}).`);
  }
  if (res.status === 304 && hit) return hit;
  if (res.status === 404 || res.status === 400) { logCache.delete(url); return NO_LOGS; }
  let body: any = null;
  if (res.status === 200) body = await res.json().catch(() => null);
  if (!body || typeof body !== 'object' || !Array.isArray(body.logs)) {
    if (hit) return hit;
    throw new DataUnavailable('unreachable', `The data service answered HTTP ${res.status}.`);
  }
  const answer: LogsAnswer = { v5: Object.hasOwn(body, 'next_before'), logs: body.logs.slice(0, 100), nextBefore: typeof body.next_before === 'string' && ISO_TIME.test(body.next_before) ? body.next_before : null };
  const etag = res.headers.get('etag');
  logCache.delete(url);
  if (etag) {
    logCache.set(url, { ...answer, etag });
    while (logCache.size > LOG_CACHE_MAX) logCache.delete(logCache.keys().next().value!);
  }
  return answer;
}

const listOf = (a: LogsAnswer) => a.logs.map(logOf).filter((l): l is LogEntry => l !== null);
/** A world's 「更新记录」: its latest three published logs shown on the intro card. */
export async function worldLogs(worldId: string, deps: AccountDataDeps = {}): Promise<LogEntry[]> {
  return listOf(await publicLogs({ platform: PRODUCT, scope: `world:${worldId}`, surface: 'world', limit: '3' }, deps)).slice(0, 3);
}
export const LOBBY_LOG_PAGE = 10;
/** The lobby's 「日志」 tab: every log published to platform=livingcanvas, newest first (no surface filter — ticking the
 * platform is enough); `before` = the previous page's next_before. */
export async function lobbyLogs(beforeRaw: unknown, deps: AccountDataDeps = {}): Promise<{ logs: LogEntry[]; nextBefore: string | null }> {
  const before = typeof beforeRaw === 'string' && ISO_TIME.test(beforeRaw) ? beforeRaw : null;
  if (beforeRaw !== undefined && beforeRaw !== '' && !before) throw new DataRefused(400, 'invalid_before', 'before must be a time.');
  const a = await publicLogs({ platform: PRODUCT, ...(before ? { before } : {}), limit: String(LOBBY_LOG_PAGE) }, deps);
  // a v4 deploy ignores `before`: its one page is all there is (never the same page twice)
  if (before && !a.v5) return { logs: [], nextBefore: null };
  return { logs: listOf(a), nextBefore: a.nextBefore };
}

export async function deleteReview(worldId: string, deps: AccountDataDeps = {}): Promise<void> {
  for (const r of await mine('review', deps, { world_id: worldId })) {
    const a = await remove('review', r.id, deps);
    if (a.status !== 200 && a.status !== 404) refused(a);
  }
}

/** Public: how many players rated each world and their average. No account needed. */
export async function ratings(worldIds: string[], deps: AccountDataDeps = {}): Promise<Record<string, { count: number; average: number | null }>> {
  const ids = [...new Set(worldIds.filter((id) => LOCAL_ID.test(id)))].slice(0, 100);
  if (!ids.length) return {};
  const a = await request('GET', `/v1/public/stats/${PRODUCT}/review?in=${ids.map(encodeURIComponent).join(',')}`, deps, { anonymous: true });
  if (a.status !== 200) refused(a);
  const out: Record<string, { count: number; average: number | null }> = {};
  for (const [id, g] of Object.entries((a.body?.groups ?? {}) as Record<string, { count?: number; avg?: { rating?: number | null } }>)) {
    out[id] = { count: Number(g.count) || 0, average: typeof g.avg?.rating === 'number' ? g.avg.rating : null };
  }
  return out;
}

// ── save summaries ──────────────────────────────────────────────────────────

export interface SaveSummary { saveId: string; worldId: string; worldName: string | null; scene: string | null; turns: number; text: string | null; updatedAt: string }
const clip = (raw: unknown, max: number) => (typeof raw === 'string' && raw.trim() ? [...raw.trim()].slice(0, max).join('') : undefined);

export async function putSaveSummary(saveIdRaw: unknown, input: Record<string, unknown>, deps: AccountDataDeps = {}): Promise<SaveSummary> {
  const saveId = typeof saveIdRaw === 'string' && LOCAL_ID.test(saveIdRaw) ? saveIdRaw : null;
  if (!saveId) throw new DataRefused(400, 'invalid_save', 'Not a save id.');
  const worldId = worldIdOf(input.worldId);
  const turns = Number.isInteger(input.turns) && (input.turns as number) >= 0 ? Math.min(input.turns as number, 1_000_000) : undefined;
  const body = {
    save_id: saveId,
    world_id: worldId,
    ...(clip(input.worldName, 120) ? { world_name: clip(input.worldName, 120) } : {}),
    ...(clip(input.scene, 120) ? { scene: clip(input.scene, 120) } : {}),
    ...(turns !== undefined ? { turns } : {}),
    ...(clip(input.text, 200) ? { text: clip(input.text, 200) } : {}),
  };
  const [found] = await mine<typeof body>('save-summary', deps, { save_id: saveId });
  let saved: DataRecord<typeof body>;
  try {
    saved = await upsert('save-summary', found ?? null, body, deps);
  } catch (error) {
    // Full (100 saves remembered): forget the one played longest ago, then try once more.
    if (!(error instanceof DataRefused && error.code === 'quota_count_exceeded')) throw error;
    const a = await request('GET', `${path('save-summary')}?scope=mine&limit=1&order=updated_at`, deps);
    const oldest = a.body?.records?.[0];
    if (!oldest) throw error;
    await remove('save-summary', oldest.id, deps);
    saved = await upsert('save-summary', null, body, deps);
  }
  return summaryOf(saved);
}

function summaryOf(r: DataRecord<any>): SaveSummary {
  const b = r.body ?? {};
  return { saveId: b.save_id, worldId: b.world_id, worldName: b.world_name ?? null, scene: b.scene ?? null, turns: Number(b.turns) || 0, text: b.text ?? null, updatedAt: r.updated_at };
}

// ── everything at once (the launcher opens / the account changes) ─────────────

export interface AccountDataSnapshot {
  settings: { prefs: SyncedSettings; updatedAt: string } | null;
  favorites: string[];
  likes: string[];
  /** The public nickname this player chose (null = anonymous). */
  nickname: string | null;
  reviews: Record<string, { rating: number; comment: string | null; note: string | null; updatedAt: string }>;
  saves: SaveSummary[];
}

export async function snapshot(deps: AccountDataDeps = {}): Promise<AccountDataSnapshot> {
  const [settings, favorites, reviews, saves, likes, profile] = await Promise.all([
    mine<SyncedSettings>('setting', deps),
    mine<{ world_id: string }>('favorite', deps),
    mine<{ world_id: string; rating: number; comment?: string; note?: string }>('review', deps),
    mine('save-summary', deps),
    mine<{ world_id: string }>('like', deps).catch((e) => { if (e instanceof DataUnavailable && e.reason === 'unreachable') return []; throw e; }), // not deployed yet: no likes
    mine<{ nickname: string }>('profile', deps).catch((e) => { if (e instanceof DataUnavailable && e.reason === 'unreachable') return []; throw e; }),
  ]);
  const reviewMap: AccountDataSnapshot['reviews'] = {};
  // newest first: the first one per world wins
  for (const r of reviews) reviewMap[r.body.world_id] ??= { rating: r.body.rating, comment: r.body.comment ?? null, note: r.body.note ?? null, updatedAt: r.updated_at };
  return {
    settings: settings[0] ? { prefs: cleanSettings(settings[0].body), updatedAt: settings[0].updated_at } : null,
    favorites: [...new Set(favorites.map((r) => r.body.world_id))],
    likes: [...new Set(likes.map((r) => r.body.world_id))],
    nickname: profile[0]?.body.nickname ?? null,
    reviews: reviewMap,
    saves: saves.map(summaryOf),
  };
}
