import type { Announcement } from './announcements.js';

/**
 * 公告 / 社区: the lobby board's pure parts — merging the community feed, the
 * announcement order, JST dates, "new since your last visit", links — and the small client for /api/board.
 * The server half is apps/server/src/sync/board.ts; data decides who may write (manifest livingcanvas v11).
 */

export interface FeedReview { id: string; worldId: string; rating: number; comment: string | null; author: string | null; tag: string | null; createdAt: string; updatedAt: string }
export interface FeedWorld { id: string; name: string; description: string; publisher: string | null; coverUrl: string | null; publishedAt: string | null; updatedAt: string | null }
export interface BoardPost { id: string; title: string; text: string; worldId: string | null; author: string | null; tag: string | null; mine: boolean; createdAt: string }
export interface BoardConfig { commentMinAgeDays: number; postMinAgeDays: number; postsEnabled: boolean }
export interface BoardFeed { reviews: FeedReview[]; worlds: FeedWorld[]; posts: BoardPost[]; config: BoardConfig }
export interface BoardComment { id: string; target: string; text: string; author: string | null; tag: string | null; mine: boolean; createdAt: string }

export type FeedItem =
  | { kind: 'world'; key: string; target: string; at: string; fresh: 'new' | 'updated'; world: FeedWorld }
  | { kind: 'review'; key: string; target: string; at: string; review: FeedReview }
  | { kind: 'post'; key: string; target: string; at: string; post: BoardPost };

/** A world counts as "updated" when its newest revision came more than an hour after it was first published. */
const UPDATE_GAP_MS = 60 * 60_000;
const time = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : null;
};

/**
 * The community feed: new / updated workshop worlds, ratings with comments, player posts — one item per thing
 * (a world listed twice, a review seen twice: once), newest first, at most `limit`. Undated items are dropped
 * (nothing to place them by). Reviews without words are kept only with `bareRatings` (a stars-only line is noise).
 */
export function mergeFeed(feed: Pick<BoardFeed, 'reviews' | 'worlds' | 'posts'>, { limit = 40, bareRatings = false } = {}): FeedItem[] {
  const out = new Map<string, FeedItem>();
  const put = (item: FeedItem) => {
    const had = out.get(item.key);
    if (!had || (time(item.at) ?? 0) > (time(had.at) ?? 0)) out.set(item.key, item);
  };
  for (const world of feed.worlds ?? []) {
    const published = time(world.publishedAt);
    const updated = time(world.updatedAt);
    const at = updated ?? published;
    if (at === null) continue;
    const fresh = published !== null && updated !== null && updated - published > UPDATE_GAP_MS ? 'updated' : 'new';
    put({ kind: 'world', key: `world:${world.id}`, target: `world:${world.id}`, at: new Date(at).toISOString(), fresh, world });
  }
  for (const review of feed.reviews ?? []) {
    if (time(review.createdAt) === null || (!review.comment && !bareRatings)) continue;
    put({ kind: 'review', key: `review:${review.id}`, target: `review:${review.id}`, at: review.createdAt, review });
  }
  for (const post of feed.posts ?? []) {
    if (time(post.createdAt) === null) continue;
    put({ kind: 'post', key: `post:${post.id}`, target: `post:${post.id}`, at: post.createdAt, post });
  }
  return [...out.values()].sort((a, b) => (time(b.at) ?? 0) - (time(a.at) ?? 0) || a.key.localeCompare(b.key)).slice(0, limit);
}

/** Pinned first, then the newest start. */
export function sortAnnouncements(list: readonly Announcement[]): Announcement[] {
  return [...list].sort((x, y) => Number(y.pinned) - Number(x.pinned) || (time(y.startsAt) ?? 0) - (time(x.startsAt) ?? 0));
}

/** "2026/10/04 21:30 JST" in the interface language's digits and order — every board date is Tokyo time. */
export function formatJst(iso: string, locale: string): string {
  const t = time(iso);
  if (t === null) return '';
  const tag = locale === 'zh-CN' ? 'zh-CN' : locale;
  const text = new Intl.DateTimeFormat(tag, { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(t);
  return `${text} JST`;
}

// ── "new since your last visit" (this device only) ─────────────────────────────
export const SEEN_KEY = 'airp:board-seen';
type Store = Pick<Storage, 'getItem' | 'setItem'> | null;
export function lastSeen(storage: Store): number {
  try {
    const t = Number(storage?.getItem(SEEN_KEY));
    return Number.isFinite(t) && t > 0 ? t : 0;
  } catch {
    return 0;
  }
}
export function markSeen(storage: Store, now = Date.now()): void {
  try { storage?.setItem(SEEN_KEY, String(now)); } catch { /* private mode: the dot comes back next time */ }
}
/** Announcements that started after the last time this device opened the board (never opened: all of them). */
export const newSince = (list: readonly Announcement[], seen: number) => list.filter((a) => (time(a.startsAt) ?? 0) > seen);

// ── links ──────────────────────────────────────────────────────────────────────
export type BoardLink = { world: string } | { href: string } | null;
const WORLD_LINK = /^world:([A-Za-z0-9][A-Za-z0-9._-]{0,127})$/;
/** An announcement's link: world:<id> opens that world in the launcher; https opens a new tab; anything else is ignored. */
export function linkOf(raw: string | undefined | null): BoardLink {
  if (!raw) return null;
  const w = WORLD_LINK.exec(raw);
  if (w) return { world: w[1] };
  return /^https:\/\/\S+$/.test(raw) ? { href: raw } : null;
}
export const safeImage = (raw: string | undefined | null) => (raw && /^https:\/\/\S+$/.test(raw) ? raw : null);

// ── the client (this computer's server: /api/board) ────────────────────────────
export type BoardAnswer<T> = ({ ok: true } & T) | { ok: false; available: boolean; reason?: string; code?: string; error?: string; retryAt?: string; minAgeDays?: number };
const HEADERS = { 'content-type': 'application/json', 'x-airp-settings': '1' };

export function createBoardClient(fetchImpl: typeof fetch = (...args) => fetch(...args)) {
  const call = async <T>(method: string, path: string, body?: unknown): Promise<BoardAnswer<T>> => {
    try {
      const res = await fetchImpl(`/api/board${path}`, { method, headers: method === 'GET' ? undefined : HEADERS, body: body === undefined ? undefined : JSON.stringify(body) });
      const json = await res.json().catch(() => null);
      if (json && typeof json === 'object') return json as BoardAnswer<T>;
      return { ok: false, available: false, reason: 'unreachable' };
    } catch {
      return { ok: false, available: false, reason: 'unreachable' };
    }
  };
  return {
    feed: () => call<BoardFeed>('GET', '/feed'),
    counts: (targets: string[]) => call<{ counts: Record<string, number> }>('GET', `/counts?targets=${targets.map(encodeURIComponent).join(',')}`),
    comments: (target: string) => call<{ comments: BoardComment[]; nextCursor: string | null }>('GET', `/comments?target=${encodeURIComponent(target)}`),
    comment: (target: string, text: string) => call<{ comment: BoardComment }>('POST', '/comments', { target, text }),
    post: (title: string, text: string) => call<{ post: BoardPost }>('POST', '/posts', { title, text }),
    remove: (what: 'comments' | 'posts', id: string) => call<Record<string, never>>('DELETE', `/${what}/${encodeURIComponent(id)}`),
    report: (what: 'comments' | 'posts', id: string, reason: string) => call<{ reported: true }>('POST', `/${what}/${encodeURIComponent(id)}/report`, { reason }),
  };
}
export type BoardClient = ReturnType<typeof createBoardClient>;

/** A refusal → the message key the page shows (i18n in messages.json). */
export function refusalText(answer: { ok: false; reason?: string; code?: string }): string {
  if (answer.reason === 'signed_out' || answer.reason === 'not_allowed') return 'Sign in to comment.';
  if (answer.reason) return 'The board could not be reached. Try again later.';
  switch (answer.code) {
    case 'content_refused': return 'Your comment was not posted: it contains words that are not allowed here (slurs, contact details, explicit content).';
    case 'account_too_new': return 'New accounts can comment a little later (from {date}).';
    case 'account_required': return 'Guests cannot comment. Sign in with an email account.';
    case 'writing_closed': return 'Posting is closed right now.';
    case 'rate_limited': return 'Too many comments just now. Try again in a few minutes.';
    case 'too_long': return 'That is too long.';
    case 'empty': return 'Write something first.';
    default: return 'Could not post. Try again later.';
  }
}
