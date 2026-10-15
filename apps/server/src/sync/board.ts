import { DataRefused, LOCAL_ID, request, type AccountDataDeps, type Answer } from './account-data.js';
import { servicesConfig } from './remote-client.js';
import { MADE_ID } from '../world-workshop.js';

/**
 * 公告 / 社区 (the lobby board, the design notes; data manifest livingcanvas v11).
 *
 * Public reads (no account, nothing private): the newest published reviews across worlds, the newest published
 * workshop worlds (storage's public catalog), the board settings, a feed item's comments and their counts, and
 * player posts. Writes go with the account's token and data decides who may write (write_gate: a verified
 * account, old enough; 10 comments an hour; posts only while an admin has them open, 3 a day); the deny-list
 * answers 422 content_refused, which reaches the page as 400 content_refused like the review comment does.
 */

const PRODUCT = 'livingcanvas';
export const MAX_BOARD_COMMENT = 500;
export const MAX_POST_TITLE = 80;
export const MAX_POST_TEXT = 1000;
/** announcement:<scope>/<id> | world:<id> | review:<id> | post:<id> — the same pattern as the manifest. */
export const BOARD_TARGET = /^(announcement:(platform|livingcanvas)\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}|(world|review|post):[A-Za-z0-9][A-Za-z0-9._-]{0,127})$/;

function refused(a: Answer): never {
  const code = typeof a.body?.error === 'string' ? a.body.error : 'data_error';
  const message = typeof a.body?.message === 'string' ? a.body.message : `The data service answered HTTP ${a.status}.`;
  if (a.status === 422 && code === 'content_refused') throw new DataRefused(400, 'content_refused', 'That text contains words that are not allowed here.');
  if (a.status === 422 || a.status === 413) throw new DataRefused(400, 'invalid_text', message);
  if (a.status === 403 && code === 'account_too_new') {
    const err = new DataRefused(403, 'account_too_new', message) as DataRefused & { retryAt?: string; minAgeDays?: number };
    throw Object.assign(err, { retryAt: typeof a.body?.retry_at === 'string' ? a.body.retry_at : undefined, minAgeDays: Number(a.body?.min_age_days) || undefined });
  }
  throw new DataRefused(a.status >= 400 && a.status < 500 ? a.status : 502, code, message);
}
const rec = (kind: string, id?: string) => `/v1/records/${PRODUCT}/${kind}${id ? `/${encodeURIComponent(id)}` : ''}`;
const pub = (kind: string, q: URLSearchParams) => `/v1/public/records/${PRODUCT}/${kind}?${q}`;
const str = (v: unknown, max = 2000) => (typeof v === 'string' && v ? v.slice(0, max) : null);

interface PublicRecord { id: string; author_tag?: string; author_name?: string | null; body?: Record<string, unknown>; created_at?: string; updated_at: string }
const author = (r: PublicRecord) => ({ author: str(r.author_name, 40), tag: typeof r.author_tag === 'string' ? r.author_tag.slice(0, 4) : null });

// ── the feed's sources ─────────────────────────────────────────────────────────

export interface FeedReview { id: string; worldId: string; rating: number; comment: string | null; author: string | null; tag: string | null; createdAt: string; updatedAt: string }
export interface FeedWorld { id: string; name: string; description: string; publisher: string | null; coverUrl: string | null; publishedAt: string | null; updatedAt: string | null }
export interface BoardConfig { commentMinAgeDays: number; postMinAgeDays: number; postsEnabled: boolean }
export const DEFAULT_BOARD_CONFIG: BoardConfig = { commentMinAgeDays: 1, postMinAgeDays: 1, postsEnabled: false };

/** Newest published reviews across every world: data's public view only (no uid, no private note). */
export async function recentReviews(deps: AccountDataDeps = {}, limit = 30): Promise<FeedReview[]> {
  const a = await request('GET', pub('review', new URLSearchParams({ order: '-created_at', limit: String(limit) })), deps, { anonymous: true });
  if (a.status !== 200) refused(a);
  return ((a.body?.records ?? []) as PublicRecord[])
    .filter((r) => typeof r.body?.world_id === 'string' && LOCAL_ID.test(r.body.world_id as string))
    .map((r) => ({
      id: r.id,
      worldId: r.body!.world_id as string,
      rating: Math.max(1, Math.min(5, Number(r.body?.rating) || 0)),
      comment: str(r.body?.comment, 1000),
      ...author(r),
      createdAt: r.created_at ?? r.updated_at,
      updatedAt: r.updated_at,
    }));
}

/** Newest published workshop worlds (storage's public catalog; the official worlds are the lobby's own). */
export async function recentWorlds(deps: AccountDataDeps = {}, limit = 30): Promise<FeedWorld[]> {
  let res: Response;
  try {
    res = await (deps.fetch ?? fetch)(`${servicesConfig().storage}/v1/public/livingcanvas/worlds`, { headers: { accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(8000) });
  } catch {
    return [];
  }
  if (!res.ok) return [];
  const body = await res.json().catch(() => null) as { worlds?: Array<Record<string, unknown>> } | null;
  return (body?.worlds ?? [])
    .filter((w) => typeof w.id === 'string' && MADE_ID.test(w.id))
    .map((w) => ({
      id: w.id as string,
      name: str(w.name, 120) ?? (w.id as string),
      description: str(w.description, 300) ?? '',
      publisher: str(w.publisher, 40),
      coverUrl: typeof w.cover_url === 'string' && /^https:\/\//.test(w.cover_url) ? w.cover_url : null,
      publishedAt: str(w.published_at, 40),
      updatedAt: str(w.updated_at, 40),
    }))
    .sort((x, y) => (y.updatedAt ?? y.publishedAt ?? '').localeCompare(x.updatedAt ?? x.publishedAt ?? ''))
    .slice(0, limit);
}

export async function boardConfig(deps: AccountDataDeps = {}): Promise<BoardConfig> {
  try {
    const a = await request('GET', pub('board-config', new URLSearchParams({ order: '-updated_at', limit: '1' })), deps, { anonymous: true });
    const b = a.status === 200 ? a.body?.records?.[0]?.body : null;
    if (!b) return DEFAULT_BOARD_CONFIG;
    const days = (v: unknown, d: number) => (Number.isInteger(v) && (v as number) >= 0 ? (v as number) : d);
    return { commentMinAgeDays: days(b.comment_min_age_days, 1), postMinAgeDays: days(b.post_min_age_days, 1), postsEnabled: b.posts_enabled === true };
  } catch {
    return DEFAULT_BOARD_CONFIG; // board v11 not deployed yet: comments closed by data anyway
  }
}

/** One call for the board: each source on its own (one missing still shows the others). */
export async function boardFeed(deps: AccountDataDeps = {}): Promise<{ reviews: FeedReview[]; worlds: FeedWorld[]; posts: BoardPost[]; config: BoardConfig }> {
  const [reviews, worlds, posts, config] = await Promise.all([
    recentReviews(deps).catch(() => [] as FeedReview[]),
    recentWorlds(deps),
    boardPosts(deps).then((p) => p.posts).catch(() => [] as BoardPost[]),
    boardConfig(deps),
  ]);
  return { reviews, worlds, posts, config };
}

// ── comments on a feed item ────────────────────────────────────────────────────

export interface BoardComment { id: string; target: string; text: string; author: string | null; tag: string | null; mine: boolean; createdAt: string }

export function targetOf(raw: unknown): string {
  const t = typeof raw === 'string' ? raw.trim() : '';
  if (!BOARD_TARGET.test(t)) throw new DataRefused(400, 'invalid_target', 'Not something on the board.');
  return t;
}

async function mineIds(kind: string, deps: AccountDataDeps, where: Record<string, string> = {}): Promise<Set<string>> {
  try {
    const q = new URLSearchParams({ scope: 'mine', limit: '100', order: '-created_at' });
    for (const [k, v] of Object.entries(where)) q.set(`where[${k}]`, v);
    const a = await request('GET', `${rec(kind)}?${q}`, deps);
    return new Set(a.status === 200 ? ((a.body?.records ?? []) as Array<{ id: string }>).map((r) => r.id) : []);
  } catch {
    return new Set(); // signed out
  }
}

/** Public: one page of an item's comments, oldest first (a conversation reads down); signed in, the player's own are `mine`. */
export async function boardComments(target: string, deps: AccountDataDeps = {}, cursor: string | null = null): Promise<{ comments: BoardComment[]; nextCursor: string | null }> {
  const q = new URLSearchParams({ 'where[target]': target, order: 'created_at', limit: '50', ...(cursor ? { cursor } : {}) });
  const a = await request('GET', pub('board-comment', q), deps, { anonymous: true });
  if (a.status === 400 && a.body?.error === 'invalid_cursor') throw new DataRefused(400, 'invalid_cursor', 'That page is gone; reload.');
  if (a.status !== 200) refused(a);
  const mine = await mineIds('board-comment', deps, { target });
  const comments = ((a.body?.records ?? []) as PublicRecord[]).map((r) => ({
    id: r.id,
    target,
    text: str(r.body?.text, MAX_BOARD_COMMENT) ?? '',
    ...author(r),
    mine: mine.has(r.id),
    createdAt: r.created_at ?? r.updated_at,
  }));
  return { comments, nextCursor: typeof a.body?.next_cursor === 'string' ? a.body.next_cursor : null };
}

/** Public: how many comments each item has (data's public_stats by target). */
export async function boardCounts(targets: string[], deps: AccountDataDeps = {}): Promise<Record<string, number>> {
  const list = [...new Set(targets.filter((t) => BOARD_TARGET.test(t)))].slice(0, 50);
  if (!list.length) return {};
  try {
    const a = await request('GET', `/v1/public/stats/${PRODUCT}/board-comment?in=${list.map(encodeURIComponent).join(',')}`, deps, { anonymous: true });
    if (a.status !== 200) return {};
    return Object.fromEntries(list.map((t) => [t, Number(a.body?.groups?.[t]?.count) || 0]));
  } catch {
    return {};
  }
}

/** Write a comment and make it public (data screens it, checks the account, counts it against the hourly cap). */
export async function postBoardComment(input: { target?: unknown; text?: unknown }, deps: AccountDataDeps = {}): Promise<{ comment: BoardComment }> {
  const target = targetOf(input.target);
  const text = typeof input.text === 'string' ? input.text.trim() : '';
  if (!text) throw new DataRefused(400, 'empty', 'Write something first.');
  if ([...text].length > MAX_BOARD_COMMENT) throw new DataRefused(400, 'too_long', `A comment is at most ${MAX_BOARD_COMMENT} characters.`);
  const a = await request('POST', rec('board-comment'), deps, { body: { body: { target, text } } });
  if (a.status !== 201) refused(a);
  const p = await request('POST', `${rec('board-comment', a.body.id)}/publish`, deps);
  if (p.status !== 200) refused(p);
  return { comment: { id: a.body.id, target, text, author: null, tag: null, mine: true, createdAt: a.body.created_at ?? new Date().toISOString() } };
}

export async function deleteBoardRecord(kind: 'board-comment' | 'board-post', idRaw: unknown, deps: AccountDataDeps = {}): Promise<void> {
  const id = typeof idRaw === 'string' && LOCAL_ID.test(idRaw) ? idRaw : null;
  if (!id) throw new DataRefused(400, 'invalid_target', 'Not a comment.');
  const a = await request('DELETE', rec(kind, id), deps);
  if (a.status !== 200 && a.status !== 404) refused(a);
}

// ── player posts (v1.5: closed until an admin opens them in the console) ─────────

export interface BoardPost { id: string; title: string; text: string; worldId: string | null; author: string | null; tag: string | null; mine: boolean; createdAt: string }

export async function boardPosts(deps: AccountDataDeps = {}, cursor: string | null = null): Promise<{ posts: BoardPost[]; nextCursor: string | null }> {
  const a = await request('GET', pub('board-post', new URLSearchParams({ order: '-created_at', limit: '20', ...(cursor ? { cursor } : {}) })), deps, { anonymous: true });
  if (a.status !== 200) refused(a);
  const mine = await mineIds('board-post', deps);
  const posts = ((a.body?.records ?? []) as PublicRecord[]).map((r) => ({
    id: r.id,
    title: str(r.body?.title, MAX_POST_TITLE) ?? '',
    text: str(r.body?.text, MAX_POST_TEXT) ?? '',
    worldId: typeof r.body?.world_id === 'string' && LOCAL_ID.test(r.body.world_id) ? r.body.world_id : null,
    ...author(r),
    mine: mine.has(r.id),
    createdAt: r.created_at ?? r.updated_at,
  }));
  return { posts, nextCursor: typeof a.body?.next_cursor === 'string' ? a.body.next_cursor : null };
}

export async function postBoardPost(input: { title?: unknown; text?: unknown; worldId?: unknown }, deps: AccountDataDeps = {}): Promise<{ post: BoardPost }> {
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  const text = typeof input.text === 'string' ? input.text.trim() : '';
  if (!title || !text) throw new DataRefused(400, 'empty', 'A post needs a title and some text.');
  if ([...title].length > MAX_POST_TITLE || [...text].length > MAX_POST_TEXT) throw new DataRefused(400, 'too_long', `A post is at most ${MAX_POST_TITLE} characters of title and ${MAX_POST_TEXT} of text.`);
  const worldId = typeof input.worldId === 'string' && LOCAL_ID.test(input.worldId) ? input.worldId : null;
  const a = await request('POST', rec('board-post'), deps, { body: { body: { title, text, ...(worldId ? { world_id: worldId } : {}) } } });
  if (a.status !== 201) refused(a);
  const p = await request('POST', `${rec('board-post', a.body.id)}/publish`, deps);
  if (p.status !== 200) refused(p);
  return { post: { id: a.body.id, title, text, worldId, author: null, tag: null, mine: true, createdAt: a.body.created_at ?? new Date().toISOString() } };
}

// ── report a comment / post (data's report kind, v11 targets) ───────────────────

export const BOARD_REPORT_REASONS = ['spam', 'abuse', 'spoiler', 'personal_info', 'other'] as const;
export async function reportBoard(kind: 'board-comment' | 'board-post', idRaw: unknown, input: { reason?: unknown; note?: unknown }, deps: AccountDataDeps = {}): Promise<{ reported: true }> {
  const id = typeof idRaw === 'string' && LOCAL_ID.test(idRaw) ? idRaw : null;
  if (!id) throw new DataRefused(400, 'invalid_target', 'Not a comment.');
  if (!BOARD_REPORT_REASONS.includes(input.reason as typeof BOARD_REPORT_REASONS[number])) throw new DataRefused(400, 'invalid_reason', 'Pick a reason.');
  const target = `${PRODUCT}/${kind}/${id}`;
  const mine = await request('GET', `${rec('report')}?${new URLSearchParams({ scope: 'mine', limit: '1', 'where[target]': target })}`, deps);
  if (mine.status === 200 && mine.body?.records?.length) return { reported: true };
  const note = typeof input.note === 'string' ? input.note.trim().slice(0, 500) : '';
  const a = await request('POST', rec('report'), deps, { body: { body: { target, reason: input.reason, ...(note ? { note } : {}) } } });
  if (a.status !== 201) refused(a);
  return { reported: true };
}
