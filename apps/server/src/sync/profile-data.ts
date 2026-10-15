import { chronicleBase, DataRefused, DataUnavailable, DEFAULT_BILLING_BASE, LOCAL_ID, request, type AccountDataDeps } from './account-data.js';

/**
 * The 个人页面's account half: what the Worldlines services
 * already keep about this player, read with the account's token by this server
 * (the page never holds a token), and the one thing this page adds — the endings.
 *
 *   chronicle  GET /v1/me/playthroughs · /v1/me/endings · /v1/me/summary (product livingcanvas):
 *              every save played on any device, its turns, when, and the endings reached.
 *   billing    GET /v1/me/history (product livingcanvas): the wallet's entries, newest first —
 *              the page sums the spends per day and reads the daily claims (a streak).
 *   chronicle  POST /v1/events:batch `ending.reached`: sent when the page sees an ending
 *              (idempotent per save + ending; the playthrough is ensured in the same batch).
 *
 * Signed out / not allowed / unreachable: `DataUnavailable`, which the route answers as
 * "not available" — the page then shows this device's records only.
 */

const PRODUCT = 'livingcanvas';
const billingBase = () => (process.env.AIRP_BILLING_BASE ?? '').trim().replace(/\/+$/, '') || DEFAULT_BILLING_BASE;
const clip = (raw: unknown, max: number) => (typeof raw === 'string' && raw.trim() ? [...raw.trim()].slice(0, max).join('') : null);
const iso = (raw: unknown) => (typeof raw === 'string' && Number.isFinite(Date.parse(raw)) ? raw : null);
const num = (raw: unknown) => (typeof raw === 'number' && Number.isFinite(raw) ? raw : Number(raw) || 0);

/** At most this many playthroughs (2 pages of chronicle's maximum) and wallet entries (5 pages). */
export const MAX_PLAYTHROUGHS = 400;
export const MAX_LEDGER_ENTRIES = 500;

export interface AccountPlaythrough {
  saveId: string;
  /** The edition id (`livingcanvas/world/<id>` → `<id>`), or null for another kind of ref. */
  worldRef: string | null;
  worldTitle: string | null;
  startedAt: string | null;
  lastTurnAt: string | null;
  lastPlayedAt: string | null;
  turns: number;
  playSeconds: number;
  endings: { id: string; title: string | null; at: string | null }[];
}
export interface AccountEnding { worldRef: string | null; id: string; title: string | null; firstAt: string | null; times: number }
/** One wallet entry, only what the page sums: credits (= mc / 1000; negative = spent). */
export interface LedgerEntry { at: string; credits: number; kind: string; ref: string | null }

export interface AccountProfile {
  playthroughs: AccountPlaythrough[];
  endings: AccountEnding[];
  /** Totals over every livingcanvas playthrough (chronicle's own count; null when it did not answer). */
  summary: { playthroughs: number; turns: number; playSeconds: number; endings: number; daysPlayed: number; firstPlayedAt: string | null } | null;
  /** null = billing did not answer. `complete` = every entry is here (else older days are partial). */
  ledger: { entries: LedgerEntry[]; complete: boolean } | null;
}

const editionOf = (ref: unknown) => {
  const m = typeof ref === 'string' ? /^livingcanvas\/world\/([A-Za-z0-9._-]{1,128})$/.exec(ref) : null;
  return m ? m[1] : null;
};

function playthroughOf(p: any): AccountPlaythrough | null {
  if (!p || typeof p.save_id !== 'string') return null;
  return {
    saveId: p.save_id,
    worldRef: editionOf(p.world_ref),
    worldTitle: clip(p.meta?.world_title, 120),
    startedAt: iso(p.started_at),
    lastTurnAt: iso(p.last_turn_at),
    lastPlayedAt: iso(p.last_played_at),
    turns: num(p.counts?.runs_committed),
    playSeconds: num(p.counts?.play_seconds),
    endings: (Array.isArray(p.endings) ? p.endings : [])
      .filter((e: any) => typeof e?.ending_id === 'string')
      .map((e: any) => ({ id: e.ending_id, title: clip(e.title, 200), at: iso(e.reached_at) })),
  };
}

/** Chronicle + billing for the signed-in player. Each part that fails is null / empty; signed out throws. */
export async function accountProfile(deps: AccountDataDeps = {}): Promise<AccountProfile> {
  const chronicle = chronicleBase();
  // The first call decides "signed out" (DataUnavailable); the others degrade to nothing.
  const first = await request('GET', '', deps, { url: `${chronicle}/v1/me/playthroughs?product=${PRODUCT}&limit=200` });
  if (first.status === 403) throw new DataUnavailable('not_allowed', 'This sign-in may not read chronicle; sign in again to allow it.');
  const playthroughs: AccountPlaythrough[] = [];
  let page = first;
  for (let i = 0; i < Math.ceil(MAX_PLAYTHROUGHS / 200); i++) {
    if (page.status !== 200) break;
    for (const raw of page.body?.playthroughs ?? []) { const p = playthroughOf(raw); if (p) playthroughs.push(p); }
    const cursor = page.body?.next_cursor;
    if (!cursor || playthroughs.length >= MAX_PLAYTHROUGHS) break;
    page = await request('GET', '', deps, { url: `${chronicle}/v1/me/playthroughs?product=${PRODUCT}&limit=200&cursor=${encodeURIComponent(cursor)}` }).catch(() => ({ status: 0, body: null }));
  }
  const soft = (url: string) => request('GET', '', deps, { url }).catch(() => null);
  const [endingsA, summaryA, ledger] = await Promise.all([
    soft(`${chronicle}/v1/me/endings?product=${PRODUCT}`),
    soft(`${chronicle}/v1/me/summary`),
    ledgerEntries(deps),
  ]);
  const endings: AccountEnding[] = (endingsA?.status === 200 && Array.isArray(endingsA.body?.endings) ? endingsA.body.endings : [])
    .filter((e: any) => typeof e?.ending_id === 'string')
    .map((e: any) => ({ worldRef: editionOf(e.world_ref), id: e.ending_id, title: clip(e.title, 200), firstAt: iso(e.first_reached_at), times: Math.max(1, num(e.times)) }));
  const lc = summaryA?.status === 200 && Array.isArray(summaryA.body?.products) ? summaryA.body.products.find((p: any) => p?.product === PRODUCT) : null;
  const summary = summaryA?.status === 200
    ? {
        playthroughs: num(lc?.playthroughs),
        turns: num(lc?.turns),
        playSeconds: num(lc?.play_seconds),
        endings: num(lc?.endings),
        daysPlayed: num(lc?.days_played),
        firstPlayedAt: iso(lc?.first_played_at),
      }
    : null;
  return { playthroughs, endings, summary, ledger };
}

/** The wallet's newest entries (≤ MAX_LEDGER_ENTRIES), compacted. null when billing does not answer. */
async function ledgerEntries(deps: AccountDataDeps): Promise<AccountProfile['ledger']> {
  const entries: LedgerEntry[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < Math.ceil(MAX_LEDGER_ENTRIES / 100); i++) {
    const q: string = `product=${PRODUCT}&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const a = await request('GET', '', deps, { url: `${billingBase()}/v1/me/history?${q}` }).catch(() => null);
    if (!a || a.status !== 200) return i === 0 ? null : { entries, complete: false };
    for (const e of (Array.isArray(a.body?.entries) ? a.body.entries : []) as any[]) {
      const at = iso(e?.occurred_at) ?? iso(e?.recorded_at);
      if (!at) continue;
      const ref = typeof e.ref_type === 'string' ? `${e.ref_type}${typeof e.ref_id === 'string' ? `:${e.ref_id}` : ''}` : null;
      entries.push({ at, credits: Math.round(num(e.delta_mc)) / 1000, kind: typeof e.kind === 'string' ? e.kind : 'other', ref: ref ? ref.slice(0, 160) : null });
    }
    cursor = typeof a.body?.next_cursor === 'string' ? a.body.next_cursor : null;
    if (!cursor) return { entries, complete: true };
  }
  return { entries, complete: false };
}

/**
 * The page saw an ending in this save: chronicle records it for the player (cross-device),
 * once per save + ending. Best effort — `{ reported: false }` when chronicle refused it.
 */
export async function reportEnding(input: { saveId?: unknown; worldRef?: unknown; worldName?: unknown; endingId?: unknown; title?: unknown }, deps: AccountDataDeps = {}, now = Date.now()): Promise<{ reported: boolean }> {
  const saveId = typeof input.saveId === 'string' && LOCAL_ID.test(input.saveId) ? input.saveId : null;
  const world = typeof input.worldRef === 'string' && LOCAL_ID.test(input.worldRef) ? input.worldRef : null;
  const ending = typeof input.endingId === 'string' && LOCAL_ID.test(input.endingId) ? input.endingId : null;
  if (!saveId || !world || !ending) throw new DataRefused(400, 'invalid_ending', 'saveId, worldRef and endingId are required.');
  const at = new Date(now).toISOString();
  const title = clip(input.title, 200);
  const worldTitle = clip(input.worldName, 120);
  const events = [
    { type: 'playthrough.ensure', occurred_at: at, save_id: saveId, world_ref: `${PRODUCT}/world/${world}`, ...(worldTitle ? { meta: { world_title: worldTitle } } : {}) },
    { type: 'ending.reached', occurred_at: at, save_id: saveId, ending_id: ending, ...(title ? { title } : {}) },
  ];
  const a = await request('POST', '', deps, { url: `${chronicleBase()}/v1/events:batch`, body: { product: PRODUCT, events } });
  return { reported: a.status === 200 };
}
