import { useSyncExternalStore } from 'react';

/**
 * What follows the player's account from device to device (the Worldlines data
 * service, through this app's server: /api/account-data, apps/server/src/routes/
 * account-data.ts — the page never holds a token):
 *
 *   - settings: performance, voice switches + volumes, interface language, the
 *     plans' 卡面角色 (lib/plan-look.ts). Pulled
 *     when the account appears, pushed (debounced) when one changes; the newer one
 *     wins (the service's time vs. when this device last changed them);
 *   - favorite worlds (the heart on a brick); the player's rating + comment, public
 * — everyone's comments are listed under the brick, each can be
 *     reported to the admins, an admin can take one down;
 *   - where each save got to ("Whitechapel · The morgue, turn 12"), written after
 *     a writer turn (at most once a minute per save) — the save itself stays here.
 *
 * Signed out, no data service, offline: everything still works on this device
 * (localStorage), nothing is shown as an error, and what changed meanwhile is
 * sent the next time the account is there (a rating / comment then goes public).
 */

export interface Review { rating: number; comment: string | null; note?: string | null }
export interface Rating { count: number; average: number | null }
/**
 * Public numbers per world (no account): ratings and likes (data), plays (chronicle; null under 5 players), and the
 * server-wide 「总打开次数」/「总消耗 token 数」 (chronicle /v1/stats/activity; null = not known / not published / no data
 * yet — tokens are counted from 2026-10-04). Older servers leave opens / tokens out.
 */
export interface WorldNumbers { rating: Rating; likes: number; plays: number | null; players: number | null; opens?: number | null; tokens?: number | null }
export interface AccountUsage {
  plan: string | null;
  today: { tokens: number; usd: number } | null;
  month: { tokens: number; usd: number } | null;
  /** daily: today's claim-only free allowance (credits); missing on an older server. */
  wallet: { pointName: string | null; available: number | null; usedToday: number | null; resetsAt: string | null; daily?: DailyAllowance | null } | null;
  /**
   * billing's view of the membership; trialEndsAt is set for a 体验会员 (redemption code); endsAt for a canceled paid
   * subscription that runs to that time and won't renew (missing on an older server). Missing on an older server.
   */
  membership?: { plan: string; source: string | null; trialEndsAt: string | null; endsAt?: string | null } | null;
}
/**
 * Today's free allowance (billing /v1/me/balance → daily, in credits): claim-only, once per wallet day.
 * tier / newcomerDay / newcomerDays / regular: 's free tiers (server sync/account-data.ts); absent on an older billing.
 */
export interface DailyAllowance { allowance: number; claimed: number; claimable: boolean; resetsAt: string | null; tier?: 'newcomer' | 'regular' | 'none'; newcomerDay?: number; newcomerDays?: number; regular?: number }
/** What 「领取今日额度」 did (billing POST /v1/claims/worldlines/daily, through this app's server). */
/** 新手礼包: 500 credits once per account; `created` = it arrived just now (through this app's server). */
export interface NewcomerGift { credits: number; created: boolean; expiresAt: string | null; available: number | null }
export interface DailyClaimed { credits: number; duplicated: boolean; available: number | null; daily: DailyAllowance | null }
/** What a redemption code did (billing POST /v1/me/redeem, through this app's server). */
export interface Redeemed {
  outcome: 'trial_started' | 'credits_only' | 'invite'; code: string; plan: string | null; endsAt: string | null; credits: number; alreadyMember: boolean;
  /** an invite code: the credits unlock after playing a bit (a pending reward), they are not added yet */
  pendingVerification?: boolean;
  rewardId?: string | null;
}
/** 「邀请好友」 (billing GET /v1/me/invite through this app's server). */
export interface InviteInfo {
  code: string;
  shareUrl: string;
  enabled: boolean;
  inviteeCredits: number;
  inviterCredits: number;
  monthlyCap: number;
  windowDays: number;
  stats: { invited: number; played: number; rewarded: number; creditsEarned: number; creditsPending: number; remainingThisMonth: number };
  redeemed: { code: string; credits: number } | null;
  canRedeem: boolean;
}
/**
 * A reward (billing GET /v1/me/rewards, mapped by apps/server sync/account-data.ts `rewardOf`). `state`:
 * pending_verification = unlocks after play billing served itself (`progress`: calls of `need` in one world, maybe
 * an ending too), claimable = the claim button, then claimed / revoked / expired. Kinds: invite, invite_welcome,
 * trial_rest. `status` is billing's legacy field ('pending' = claimable).
 */
export type RewardState = 'pending_verification' | 'claimable' | 'claimed' | 'revoked' | 'expired';
export interface RewardProgress { calls: number; need: number; endingNeeded: boolean; ending: boolean }
export interface Reward {
  id: string; kind: string; credits: number;
  state?: RewardState;
  status: 'pending_verification' | 'pending' | 'claimed' | 'revoked' | 'expired';
  progress?: RewardProgress | null;
  expiresAt?: string | null; createdAt: string | null; claimedAt: string | null;
}
/** The reward's state; a server from before `state` → from `status` (a bare 'pending' is claimable). */
export function rewardState(r: Pick<Reward, 'state' | 'status'>): RewardState {
  if (r.state) return r.state;
  return r.status === 'pending' ? 'claimable' : r.status;
}
export interface PublicComment { id: string; rating: number; comment: string | null; author: string | null; tag?: string | null; mine: boolean; createdAt: string; updatedAt: string }
/** Why the player's last rating / comment did not go public: too many edits, or an admin took it down. */
export type ReviewNotice = 'rate_limited' | 'taken_down' | 'signed_out' | 'content_refused';
export interface SaveSummary { saveId: string; worldId: string; worldName: string | null; scene: string | null; turns: number; text: string | null; updatedAt: string }
export interface SyncedPrefs {
  locale?: string;
  dismissed?: string[];
  performance?: Record<string, unknown>;
  voice?: { ttsEnabled?: boolean; studioVoice?: boolean; musicVolume?: number; voiceVolume?: number };
  /** 卡面角色 (lib/plan-look.ts): m / f / r; absent = 默认. */
  planLook?: string;
}
export interface AccountDataState {
  /** pending = not asked yet; synced = the account's copy is here; local = this device only. */
  sync: 'pending' | 'synced' | 'local';
  favorites: ReadonlySet<string>;
  reviews: Readonly<Record<string, Review>>;
  /** Every save this account played anywhere (newest first), merged with this device's. */
  saves: readonly SaveSummary[];
  ratings: Readonly<Record<string, Rating>>;
  /** Public numbers per world key, once asked for. */
  numbers: Readonly<Record<string, WorldNumbers>>;
  /** Worlds this player liked (the public +1; separate from the private favorites). */
  likes: ReadonlySet<string>;
  /** The public nickname shown with this player's comments (null = anonymous; signed in only). */
  nickname: string | null;
  /** Public comments per world, once asked for (newest first), and the cursor of the next page. */
  comments: Readonly<Record<string, readonly PublicComment[]>>;
  commentsNext: Readonly<Record<string, string | null>>;
  notices: Readonly<Record<string, ReviewNotice>>;
}

interface LocalCopy {
  favorites: string[];
  likes: string[];
  reviews: Record<string, Review>;
  saves: Record<string, SaveSummary>;
  /** Changes made while the account was not there, sent at the next sync. */
  pending: { favorites: Record<string, boolean>; likes: Record<string, boolean>; reviews: Record<string, Review | null> };
  /** When this device last changed a synced setting (ms; 0 = never). */
  prefsChangedAt: number;
}

export interface AccountDataEnv {
  fetch: typeof fetch;
  storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  now: () => number;
  readPrefs: () => SyncedPrefs;
  applyPrefs: (prefs: SyncedPrefs) => void;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

export const STORAGE_KEY = 'airp:account-data';
export const SUMMARY_INTERVAL_MS = 60_000;
export const PREFS_DEBOUNCE_MS = 1_500;
const RATINGS_TTL_MS = 5 * 60_000;
export const MAX_NOTE = 1000;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const HEADERS = { 'content-type': 'application/json', 'x-airp-settings': '1' };

const empty = (): LocalCopy => ({ favorites: [], likes: [], reviews: {}, saves: {}, pending: { favorites: {}, likes: {}, reviews: {} }, prefsChangedAt: 0 });

export function createAccountData(env: AccountDataEnv) {
  const later = env.setTimeout ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const cancel = env.clearTimeout ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let local = load();
  let remoteSaves: SaveSummary[] = [];
  let comments: Record<string, readonly PublicComment[]> = {};
  let commentsNext: Record<string, string | null> = {};
  let numbers: Record<string, WorldNumbers> = {};
  let nickname: string | null = null;
  let notices: Record<string, ReviewNotice> = {};
  let state: AccountDataState = build('pending', {});
  const listeners = new Set<() => void>();
  let applying = false;
  let prefsTimer: unknown = null;
  let refreshing: Promise<void> | null = null;
  const ratingsAt = new Map<string, number>();
  const summaryAt = new Map<string, number>();
  const summaryTimers = new Map<string, unknown>();
  const summaryQueue = new Map<string, Omit<SaveSummary, 'updatedAt'>>();

  function load(): LocalCopy {
    try {
      const raw = env.storage?.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (!parsed || typeof parsed !== 'object') return empty();
      const base = empty();
      return {
        favorites: Array.isArray(parsed.favorites) ? parsed.favorites.filter((x: unknown) => typeof x === 'string' && ID.test(x)) : base.favorites,
        likes: Array.isArray(parsed.likes) ? parsed.likes.filter((x: unknown) => typeof x === 'string' && ID.test(x)) : base.likes,
        reviews: parsed.reviews && typeof parsed.reviews === 'object' ? parsed.reviews : base.reviews,
        saves: parsed.saves && typeof parsed.saves === 'object' ? parsed.saves : base.saves,
        pending: { favorites: parsed.pending?.favorites ?? {}, likes: parsed.pending?.likes ?? {}, reviews: parsed.pending?.reviews ?? {} },
        prefsChangedAt: Number(parsed.prefsChangedAt) || 0,
      };
    } catch {
      return empty();
    }
  }
  function save() {
    try { env.storage?.setItem(STORAGE_KEY, JSON.stringify(local)); } catch { /* storage full or blocked: memory only */ }
  }
  function build(sync: AccountDataState['sync'], ratings: AccountDataState['ratings']): AccountDataState {
    const saves = new Map<string, SaveSummary>();
    for (const s of [...remoteSaves, ...Object.values(local.saves)]) {
      const had = saves.get(s.saveId);
      if (!had || had.updatedAt < s.updatedAt) saves.set(s.saveId, s);
    }
    return {
      sync,
      favorites: new Set(local.favorites),
      likes: new Set(local.likes),
      nickname,
      numbers,
      commentsNext,
      reviews: { ...local.reviews },
      saves: [...saves.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      ratings,
      comments,
      notices,
    };
  }
  function emit(sync = state.sync, ratings = state.ratings) {
    state = build(sync, ratings);
    for (const l of [...listeners]) l();
  }

  let lastReason: string | null = null;
  let lastStatus = 0;
  /** One call to this app's server. null = the account (or the data service) is not there. */
  async function call(method: string, rel: string, body?: unknown): Promise<any | null> {
    lastReason = null;
    lastStatus = 0;
    try {
      const res = await env.fetch(`/api/account-data${rel}`, method === 'GET' ? {} : { method, headers: HEADERS, body: JSON.stringify(body ?? {}) });
      lastStatus = res.status;
      const json = await res.json().catch(() => null);
      if (json?.available === false) lastReason = typeof json.reason === 'string' ? json.reason : null;
      if (!json || json.available === false || !res.ok) return null;
      return json;
    } catch {
      return null;
    }
  }

  // ── settings ──────────────────────────────────────────────────────────────

  async function pushPrefs() {
    prefsTimer = null;
    if (state.sync !== 'synced') return; // sent at the next sync: prefsChangedAt is newer than the account's copy
    const r = await call('PUT', '/settings', { prefs: env.readPrefs() });
    if (!r) return emit('local');
    const at = Date.parse(r.updatedAt);
    // Align with the service's clock: the next sync then sees the account's copy as this one.
    if (Number.isFinite(at)) { local.prefsChangedAt = at; save(); }
  }
  function prefsChanged() {
    if (applying) return;
    local.prefsChangedAt = env.now();
    save();
    if (prefsTimer !== null) cancel(prefsTimer);
    prefsTimer = later(() => { void pushPrefs(); }, PREFS_DEBOUNCE_MS);
  }

  /** Public counts + averages for these worlds (no account needed), at most every five minutes each. */
  async function loadRatings(worldIds: readonly string[]): Promise<void> {
    const t = env.now();
    const want = [...new Set(worldIds)].filter((id) => ID.test(id) && t - (ratingsAt.get(id) ?? -Infinity) > RATINGS_TTL_MS).slice(0, 100);
    if (!want.length) return;
    for (const id of want) ratingsAt.set(id, t);
    const r = await call('GET', `/ratings?worlds=${want.map(encodeURIComponent).join(',')}`);
    if (!r?.ratings) { for (const id of want) ratingsAt.delete(id); return; }
    emit(state.sync, { ...state.ratings, ...r.ratings });
  }

  /** A world's public comments (no account needed), at most every minute unless forced. */
  const commentsAt = new Map<string, number>();
  async function loadComments(worldId: string, force = false): Promise<void> {
    if (!ID.test(worldId)) return;
    if (!force && env.now() - (commentsAt.get(worldId) ?? -Infinity) < 60_000) return;
    commentsAt.set(worldId, env.now());
    const r = await call('GET', `/comments?world=${encodeURIComponent(worldId)}`);
    if (!r?.comments) { commentsAt.delete(worldId); return; }
    comments = { ...comments, [worldId]: r.comments };
    commentsNext = { ...commentsNext, [worldId]: r.nextCursor ?? null };
    emit();
  }

  /** Public numbers per world (ratings, likes, plays), at most every five minutes each unless forced. refs = key → edition ids. */
  const numbersAt = new Map<string, number>();
  async function loadNumbers(keys: readonly string[], refs: Readonly<Record<string, readonly string[]>> = {}, force = false): Promise<void> {
    const t = env.now();
    const want = [...new Set(keys)].filter((id) => ID.test(id) && (force || t - (numbersAt.get(id) ?? -Infinity) > RATINGS_TTL_MS)).slice(0, 50);
    if (!want.length) return;
    for (const id of want) numbersAt.set(id, t);
    const refParam = want.map((k) => `${k}:${(refs[k] ?? [k]).filter((r) => ID.test(r)).slice(0, 4).join('|')}`).join(',');
    const r = await call('GET', `/world-stats?worlds=${want.map(encodeURIComponent).join(',')}&refs=${encodeURIComponent(refParam)}`);
    if (!r?.stats) { for (const id of want) numbersAt.delete(id); return; }
    numbers = { ...numbers, ...r.stats };
    emit();
  }

  // ── save summaries ────────────────────────────────────────────────────────

  async function flushSummary(saveId: string): Promise<void> {
    const summary = summaryQueue.get(saveId);
    if (!summary || state.sync !== 'synced') return; // kept: sent after the next sync
    summaryQueue.delete(saveId);
    summaryAt.set(saveId, env.now());
    const { saveId: id, ...body } = summary;
    await call('PUT', `/saves/${encodeURIComponent(id)}`, body);
  }

  // ── sync ──────────────────────────────────────────────────────────────────

  async function sync() {
    const r = await call('GET', '');
    if (!r) {
      // Signed out after being in: this device stops showing that account's favorites, notes and saves.
      if (lastReason === 'signed_out' && state.sync === 'synced') {
        local = { ...empty(), prefsChangedAt: local.prefsChangedAt };
        remoteSaves = [];
        nickname = null;
        save();
      }
      return emit('local');
    }
    // What changed here while the account was away goes first.
    for (const [world, on] of Object.entries(local.pending.favorites)) {
      if (!(await call('PUT', `/favorites/${encodeURIComponent(world)}`, { on }))) return emit('local');
    }
    for (const [world, on] of Object.entries(local.pending.likes)) {
      if (!(await call('PUT', `/likes/${encodeURIComponent(world)}`, { on }))) return emit('local');
    }
    for (const [world, review] of Object.entries(local.pending.reviews)) {
      const done = review ? await call('PUT', `/reviews/${encodeURIComponent(world)}`, review) : await call('DELETE', `/reviews/${encodeURIComponent(world)}`, {});
      if (!done) return emit('local');
    }
    const favorites = new Set<string>(r.favorites ?? []);
    for (const [world, on] of Object.entries(local.pending.favorites)) { if (on) favorites.add(world); else favorites.delete(world); }
    const reviews: Record<string, Review> = {};
    for (const [world, rv] of Object.entries((r.reviews ?? {}) as Record<string, Review>)) reviews[world] = { rating: rv.rating, comment: rv.comment ?? null, note: rv.note ?? null };
    const likes = new Set<string>(r.likes ?? []);
    for (const [world, on] of Object.entries(local.pending.likes)) { if (on) likes.add(world); else likes.delete(world); }
    for (const [world, rv] of Object.entries(local.pending.reviews)) { if (rv) reviews[world] = rv; else delete reviews[world]; }
    local = { ...local, favorites: [...favorites], likes: [...likes], reviews, pending: { favorites: {}, likes: {}, reviews: {} } };
    remoteSaves = Array.isArray(r.saves) ? r.saves : [];
    nickname = typeof r.nickname === 'string' && r.nickname ? r.nickname : null;

    const remoteAt = r.settings ? Date.parse(r.settings.updatedAt) : 0;
    if (r.settings && remoteAt >= local.prefsChangedAt) {
      applying = true;
      try { env.applyPrefs(r.settings.prefs ?? {}); } finally { applying = false; }
      local.prefsChangedAt = remoteAt;
      save();
      emit('synced');
    } else {
      save();
      emit('synced');
      await pushPrefs(); // this device changed them later (or the account has none yet)
    }
    for (const id of [...summaryQueue.keys()]) if (!summaryTimers.has(id)) await flushSummary(id);
  }

  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    /** Ask the account again (it appeared, changed, or the launcher opened). */
    refresh(): Promise<void> {
      refreshing ??= sync().finally(() => { refreshing = null; });
      return refreshing;
    },
    prefsChanged,

    async toggleFavorite(worldId: string): Promise<void> {
      if (!ID.test(worldId)) return;
      const on = !local.favorites.includes(worldId);
      local.favorites = on ? [...local.favorites, worldId] : local.favorites.filter((w) => w !== worldId);
      save();
      emit();
      const sent = state.sync === 'synced' && await call('PUT', `/favorites/${encodeURIComponent(worldId)}`, { on });
      if (!sent) { local.pending.favorites[worldId] = on; save(); }
    },

    /** The public +1 on a world (one per player; again = take it back). Offline: kept and sent later. */
    async toggleLike(worldId: string): Promise<void> {
      if (!ID.test(worldId)) return;
      const on = !local.likes.includes(worldId);
      local.likes = on ? [...local.likes, worldId] : local.likes.filter((w) => w !== worldId);
      const n = numbers[worldId];
      if (n) numbers = { ...numbers, [worldId]: { ...n, likes: Math.max(0, n.likes + (on ? 1 : -1)) } }; // shown at once; the service's count follows
      save();
      emit();
      const sent = state.sync === 'synced' && await call('PUT', `/likes/${encodeURIComponent(worldId)}`, { on });
      if (!sent) { local.pending.likes[worldId] = on; save(); }
    },

    /**
     * rating null = take the rating (and comment) back. Signed in it goes public at
     * once; signed out it is kept here and sent at the next sign-in.
     */
    async setReview(worldId: string, rating: number | null, comment = '', privateNote: string | null = null): Promise<void> {
      if (!ID.test(worldId)) return;
      const text = [...comment.trim()].slice(0, MAX_NOTE).join('');
      const keepNote = privateNote ?? local.reviews[worldId]?.note ?? '';
      const note = [...keepNote.trim()].slice(0, MAX_NOTE).join('');
      const review = rating === null ? null : { rating: Math.min(5, Math.max(1, Math.round(rating))), comment: text || null, note: note || null };
      if (review) local.reviews = { ...local.reviews, [worldId]: review };
      else { const { [worldId]: _gone, ...rest } = local.reviews; local.reviews = rest; }
      const { [worldId]: _old, ...otherNotices } = notices;
      notices = otherNotices;
      save();
      emit();
      const r = state.sync === 'synced'
        ? (review ? await call('PUT', `/reviews/${encodeURIComponent(worldId)}`, review) : await call('DELETE', `/reviews/${encodeURIComponent(worldId)}`, {}))
        : null;
      if (!r) {
        if (state.sync === 'synced' && lastStatus === 429) { notices = { ...notices, [worldId]: 'rate_limited' }; return emit(); }
        // the platform's deny list (slurs, contact spam, …): not saved, not queued — the player rewrites it
        if (state.sync === 'synced' && lastStatus === 422) { notices = { ...notices, [worldId]: 'content_refused' }; return emit(); }
        local.pending.reviews[worldId] = review;
        save();
        notices = { ...notices, [worldId]: 'signed_out' };
        return emit();
      }
      if (r.takenDown) notices = { ...notices, [worldId]: 'taken_down' };
      ratingsAt.delete(worldId);
      emit();
      void loadNumbers([worldId], {}, true);
      void loadComments(worldId, true);
    },

    loadComments,
    loadNumbers,
    /** The next page of a world's comments. */
    async loadMoreComments(worldId: string): Promise<void> {
      const cursor = commentsNext[worldId];
      if (!cursor) return;
      const r = await call('GET', `/comments?world=${encodeURIComponent(worldId)}&cursor=${encodeURIComponent(cursor)}`);
      if (!r?.comments) return;
      comments = { ...comments, [worldId]: [...(comments[worldId] ?? []), ...r.comments] };
      commentsNext = { ...commentsNext, [worldId]: r.nextCursor ?? null };
      emit();
    },
    /**
     * The nickname shown with this player's public comments ('' = anonymous again). Signed in only.
     * → null when saved, else the reason ('invalid_nickname' | 'content_refused' | 'rate_limited' | 'signed_out').
     */
    async setNickname(value: string): Promise<string | null> {
      if (state.sync !== 'synced') return 'signed_out';
      try {
        const res = await env.fetch('/api/account-data/profile', { method: 'PUT', headers: HEADERS, body: JSON.stringify({ nickname: value }) });
        const json = await res.json().catch(() => null);
        if (res.status === 429) return 'rate_limited';
        if (!json?.ok) return typeof json?.code === 'string' ? json.code : json?.available === false ? 'signed_out' : 'invalid_nickname';
        nickname = json.nickname ?? null;
        for (const w of Object.keys(comments)) void loadComments(w, true); // the open lists show the new name
        emit();
        return null;
      } catch {
        return 'signed_out';
      }
    },
    /** The account's AI use and wallet (account panel); null when not signed in / unavailable. */
    async loadUsage(): Promise<AccountUsage | null> {
      const r = await call('GET', '/usage');
      return r?.usage ?? null;
    },

    /**
     * 「输入兑换码」: redeem a code for the signed-in account. → { ok: true, redeemed } or { ok: false, code } where code is
     * billing's reason (invalid_code, already_redeemed, already_member, trial_active, rate_limited, session_required …),
     * 'signed_out' (no account / not available) or 'unreachable'.
     */
    async redeem(code: string, locale: string, device?: string | null): Promise<{ ok: true; redeemed: Redeemed } | { ok: false; code: string }> {
      try {
        const res = await env.fetch('/api/account-data/redeem', { method: 'POST', headers: HEADERS, body: JSON.stringify({ code, locale, ...(device ? { device } : {}) }) });
        const json = await res.json().catch(() => null);
        if (json?.ok && json.redeemed) return { ok: true, redeemed: json.redeemed as Redeemed };
        if (json?.available === false) return { ok: false, code: json.reason === 'unreachable' ? 'unreachable' : 'signed_out' };
        return { ok: false, code: typeof json?.code === 'string' ? json.code : res.status === 429 ? 'rate_limited' : 'unreachable' };
      } catch {
        return { ok: false, code: 'unreachable' };
      }
    },

    /**
     * 「领取今日额度」: today's free allowance into the shared worldlines wallet, through this app's server (it holds
     * the token). → { ok: true, claimed } or { ok: false, code }: billing's reason (nothing_to_claim,
     * session_required …), 'signed_out' or 'unreachable'.
     */
    async claimDaily(device?: string | null): Promise<{ ok: true; claimed: DailyClaimed } | { ok: false; code: string }> {
      try {
        const res = await env.fetch('/api/account-data/claim-daily', { method: 'POST', headers: HEADERS, body: JSON.stringify(device ? { device } : {}) });
        const json = await res.json().catch(() => null);
        if (json?.ok && json.claimed) return { ok: true, claimed: json.claimed as DailyClaimed };
        if (json?.available === false) return { ok: false, code: json.reason === 'unreachable' ? 'unreachable' : 'signed_out' };
        return { ok: false, code: typeof json?.code === 'string' ? json.code : res.status === 429 ? 'rate_limited' : 'unreachable' };
      } catch {
        return { ok: false, code: 'unreachable' };
      }
    },
    /** 新手礼包: asked for without a click (lib/newcomer-gift.ts); billing's refusal code (claim_limited …) on failure. */
    async claimNewcomer(device?: string | null): Promise<{ ok: true; gift: NewcomerGift } | { ok: false; code: string }> {
      try {
        const res = await env.fetch('/api/account-data/claim-newcomer', { method: 'POST', headers: HEADERS, body: JSON.stringify(device ? { device } : {}) });
        const json = await res.json().catch(() => null);
        if (json?.ok && json.gift) return { ok: true, gift: json.gift as NewcomerGift };
        if (json?.available === false) return { ok: false, code: json.reason === 'unreachable' ? 'unreachable' : 'signed_out' };
        return { ok: false, code: typeof json?.code === 'string' ? json.code : res.status === 429 ? 'rate_limited' : 'unreachable' };
      } catch {
        return { ok: false, code: 'unreachable' };
      }
    },
    /** 「邀请好友」: the account's invite code, link and numbers; null when signed out / unavailable. */
    async invite(): Promise<InviteInfo | null> {
      const r = await call('GET', '/invite');
      return r?.invite ?? null;
    },
    /** A first (the first ending reached): billing rewards the inviter once the play is real. Best effort. */
    async reportMilestone(kind: 'first_clear', meta: { world?: string; ending?: string } = {}): Promise<boolean> {
      const r = await call('POST', '/milestones', { kind, ...meta });
      return r?.reported === true;
    },
    /** The account's rewards (claimable and still unlocking); null when signed out / unavailable. */
    async rewards(): Promise<Reward[] | null> {
      const r = await call('GET', '/rewards');
      return Array.isArray(r?.rewards) ? (r.rewards as Reward[]) : null;
    },
    /** Claim one (device: billing's per-device claim cap) → the reward (status claimed), or null (already claimed / gone / offline). */
    async claimReward(id: string, device?: string | null): Promise<Reward | null> {
      const r = await call('POST', `/rewards/${encodeURIComponent(id)}/claim`, device ? { device } : {});
      return r?.reward ?? null;
    },

    /** Flag someone's comment for the admins (signed in only). → whether it was sent. */
    async report(reviewId: string, reason: string, note = ''): Promise<boolean> {
      if (!ID.test(reviewId) || state.sync !== 'synced') return false;
      return !!(await call('POST', `/reports/${encodeURIComponent(reviewId)}`, { reason, note: note.trim().slice(0, 500) }));
    },

    loadRatings,

    /**
     * A writer turn finished in this save. Counted here; written to the account
     * at most once a minute per save (the latest wins), and kept on this device.
     */
    /** A world was opened (the launcher gave way to it): chronicle `world.open`, best effort; signed out = the server drops it. */
    noteOpen(input: { worldRef: string }): void {
      if (!ID.test(input.worldRef)) return;
      void call('POST', '/opens', { worldRef: input.worldRef });
    },
    noteTurn(input: { saveId: string; worldId: string; worldRef?: string; worldName?: string | null; scene?: string | null }): void {
      if (!ID.test(input.saveId) || !ID.test(input.worldId)) return;
      // every finished turn is a run in the player's chronicle (play counts): best effort; the server answers
      // "not available" when nobody is signed in (chronicle does not depend on the data service being up)
      if (input.worldRef && ID.test(input.worldRef)) void call('POST', '/turns', { saveId: input.saveId, worldRef: input.worldRef, worldName: input.worldName ?? null });
      const before = state.saves.find((s) => s.saveId === input.saveId);
      const summary = {
        saveId: input.saveId,
        worldId: input.worldId,
        worldName: input.worldName?.trim() || null,
        scene: input.scene?.trim() || null,
        turns: (before?.turns ?? 0) + 1,
        text: [input.worldName?.trim(), input.scene?.trim()].filter(Boolean).join(' · ').slice(0, 200) || null,
      };
      local.saves = { ...local.saves, [input.saveId]: { ...summary, updatedAt: new Date(env.now()).toISOString() } };
      save();
      emit();
      summaryQueue.set(input.saveId, summary);
      if (summaryTimers.has(input.saveId)) return;
      const wait = Math.max(0, (summaryAt.get(input.saveId) ?? -Infinity) + SUMMARY_INTERVAL_MS - env.now());
      summaryTimers.set(input.saveId, later(() => { summaryTimers.delete(input.saveId); void flushSummary(input.saveId); }, wait));
    },
    /** Leaving the page: send what waits now (best effort). */
    flushAll(): void {
      for (const [id, timer] of summaryTimers) { cancel(timer); summaryTimers.delete(id); void flushSummary(id); }
      if (prefsTimer !== null) { cancel(prefsTimer); void pushPrefs(); }
    },
  };
}

export type AccountData = ReturnType<typeof createAccountData>;

/** The id a world is favorited / rated / summarised under: the editions of a curated world share one. */
export function worldKeyOf(group: { id: string; workshop?: unknown }): string {
  return group.workshop ? group.id : group.id.replace(/-(jp|zh|ko)$/, '');
}

// ── the app's instance ────────────────────────────────────────────────────────

let instance: AccountData | null = null;
/** Set by startAccountData(); null in tests and before the app starts. */
export function accountData(): AccountData | null {
  return instance;
}
export function installAccountData(next: AccountData | null): void {
  instance = next;
}

const EMPTY: AccountDataState = { sync: 'pending', favorites: new Set(), likes: new Set(), nickname: null, reviews: {}, saves: [], ratings: {}, numbers: {}, comments: {}, commentsNext: {}, notices: {} };
const noop = () => () => {};
export function useAccountData(): AccountDataState {
  return useSyncExternalStore(instance?.subscribe ?? noop, instance?.getState ?? (() => EMPTY), () => EMPTY);
}
