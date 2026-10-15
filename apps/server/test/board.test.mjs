// 公告 / 社区 (sync/board.ts, routes/board.ts) against a fake fetch that answers like data v11 + storage's catalog.
// Pinned: public reads go without a token; only public fields reach the page (no uid, no private note);
// workshop worlds only; comment / post writes create then publish; data's refusals keep their meaning
// (content_refused, account_too_new with retryAt, writing_closed, rate_limited); reports point at the board kinds;
// the router is localhost + header only like /api/account-data. Runs against built dist.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { boardComments, boardConfig, boardCounts, boardFeed, postBoardComment, postBoardPost, recentReviews, recentWorlds, reportBoard, targetOf } from '../dist/sync/board.js';

// The fake fetch below answers the hosted data service's address; the
// open-source edition has no default, so name one.
process.env.AIRP_DATA_BASE ||= 'https://data.worldlines.gg';

const json = (status, body) => ({ ok: status < 400, status, text: async () => JSON.stringify(body), json: async () => body });
function fake(routes) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const call = { method: init.method ?? 'GET', path: u.pathname, query: Object.fromEntries(u.searchParams), auth: init.headers?.authorization ?? null, body: init.body ? JSON.parse(init.body) : null, host: u.host };
    calls.push(call);
    for (const [re, answer] of routes) if (re.test(`${call.method} ${u.host}${u.pathname}`)) return typeof answer === 'function' ? answer(call) : answer;
    return json(404, { error: 'not_found' });
  };
  return { calls, deps: { fetch, token: async () => 'tok-alice' } };
}

test('feed: newest reviews (public fields only, bad world ids dropped) + workshop worlds newest first + config defaults', async () => {
  const f = fake([
    [/GET data\.worldlines\.gg\/v1\/public\/records\/livingcanvas\/review$/, json(200, { records: [
      { id: 'r2', author_tag: 'abcdef1234', author_name: '夜行者', owner: null, body: { world_id: 'whitechapel', rating: 5, comment: '好' }, created_at: '2026-10-03T10:00:00Z', updated_at: '2026-10-03T10:00:00Z' },
      { id: 'r1', author_tag: '0011223344', body: { world_id: '../x', rating: 3 }, updated_at: '2026-10-02T00:00:00Z' },
    ] })],
    [/GET storage\.worldlines\.gg\/v1\/public\/livingcanvas\/worlds$/, json(200, { worlds: [
      { id: 'whitechapel-zh', name: 'Official', published_at: '2026-10-04T00:00:00Z' },
      { id: 'made-0000aaaa', name: 'Old', published_at: '2026-09-01T00:00:00Z', cover_url: 'javascript:x' },
      { id: 'made-0000bbbb', name: 'New', publisher: 'Mio', published_at: '2026-10-03T00:00:00Z', updated_at: '2026-10-03T05:00:00Z', cover_url: 'https://storage.worldlines.gg/c.webp' },
    ] })],
    [/GET data\.worldlines\.gg\/v1\/public\/records\/livingcanvas\/board-post$/, json(404, { error: 'unknown_collection' })],
    [/GET data\.worldlines\.gg\/v1\/public\/records\/livingcanvas\/board-config$/, json(404, { error: 'unknown_collection' })],
  ]);
  const feed = await boardFeed(f.deps);
  assert.deepEqual(feed.reviews.map((r) => [r.id, r.worldId, r.rating, r.author, r.tag]), [['r2', 'whitechapel', 5, '夜行者', 'abcd']]);
  assert.ok(!('owner' in feed.reviews[0]));
  assert.deepEqual(feed.worlds.map((w) => [w.id, w.coverUrl]), [['made-0000bbbb', 'https://storage.worldlines.gg/c.webp'], ['made-0000aaaa', null]]);
  assert.deepEqual(feed.posts, []);
  assert.deepEqual(feed.config, { commentMinAgeDays: 1, postMinAgeDays: 1, postsEnabled: false });
  assert.ok(f.calls.every((c) => c.auth === null), 'public reads carry no token');
  assert.equal(f.calls.find((c) => c.path.endsWith('/review')).query.order, '-created_at');
});

test('a source that fails leaves the others', async () => {
  const f = fake([[/storage/, json(500, {})]]);
  assert.deepEqual(await recentWorlds(f.deps), []);
  await assert.rejects(recentReviews(f.deps));
  const feed = await boardFeed(f.deps);
  assert.deepEqual([feed.reviews, feed.worlds], [[], []]);
});

test('config from the newest admin record', async () => {
  const f = fake([[/board-config$/, json(200, { records: [{ body: { comment_min_age_days: 0, posts_enabled: true } }] })]]);
  assert.deepEqual(await boardConfig(f.deps), { commentMinAgeDays: 0, postMinAgeDays: 1, postsEnabled: true });
});

test('comments: public list oldest first, my own marked; counts per target; targets checked', async () => {
  const f = fake([
    [/GET data\.worldlines\.gg\/v1\/public\/records\/livingcanvas\/board-comment$/, json(200, { records: [{ id: 'c1', author_tag: 'aaaa000000', body: { target: 'world:made-0000bbbb', text: 'hi' }, created_at: '2026-10-04T00:00:00Z', updated_at: '2026-10-04T00:00:00Z' }], next_cursor: null })],
    [/GET data\.worldlines\.gg\/v1\/records\/livingcanvas\/board-comment$/, json(200, { records: [{ id: 'c1' }] })],
    [/GET data\.worldlines\.gg\/v1\/public\/stats\/livingcanvas\/board-comment$/, json(200, { groups: { 'world:made-0000bbbb': { count: 3 } } })],
  ]);
  const r = await boardComments('world:made-0000bbbb', f.deps);
  assert.deepEqual(r.comments.map((c) => [c.id, c.text, c.mine, c.author, c.tag]), [['c1', 'hi', true, null, 'aaaa']]);
  assert.equal(f.calls[0].query.order, 'created_at');
  assert.equal(f.calls[0].auth, null);
  assert.deepEqual(await boardCounts(['world:made-0000bbbb', 'bad target', 'review:r2'], f.deps), { 'world:made-0000bbbb': 3, 'review:r2': 0 });
  assert.throws(() => targetOf('user:1'), /Not something on the board/);
  assert.equal(targetOf(' announcement:platform/r_1 '), 'announcement:platform/r_1');
});

test('posting a comment: create then publish with the token; refusals keep their codes', async () => {
  let answer = json(201, { id: 'c9', created_at: '2026-10-04T01:00:00Z' });
  const f = fake([
    [/POST data\.worldlines\.gg\/v1\/records\/livingcanvas\/board-comment$/, () => answer],
    [/POST data\.worldlines\.gg\/v1\/records\/livingcanvas\/board-comment\/c9\/publish$/, json(200, { visibility: 'published' })],
  ]);
  const ok = await postBoardComment({ target: 'review:r2', text: '  同意  ' }, f.deps);
  assert.deepEqual([ok.comment.id, ok.comment.text, ok.comment.mine], ['c9', '同意', true]);
  assert.deepEqual(f.calls[0].body, { body: { target: 'review:r2', text: '同意' } });
  assert.equal(f.calls[0].auth, 'Bearer tok-alice');
  assert.equal(f.calls[1].path.endsWith('/publish'), true);
  await assert.rejects(postBoardComment({ target: 'review:r2', text: 'x'.repeat(501) }, f.deps), { code: 'too_long' });
  await assert.rejects(postBoardComment({ target: 'review:r2', text: ' ' }, f.deps), { code: 'empty' });
  answer = json(422, { error: 'content_refused', message: 'body/text contains a word…' });
  await assert.rejects(postBoardComment({ target: 'review:r2', text: 'discord.gg' }, f.deps), { code: 'content_refused', status: 400 });
  answer = json(403, { error: 'account_too_new', min_age_days: 1, retry_at: '2026-10-05T00:00:00Z' });
  await assert.rejects(postBoardComment({ target: 'review:r2', text: 'hi' }, f.deps), (e) => e.code === 'account_too_new' && e.retryAt === '2026-10-05T00:00:00Z' && e.minAgeDays === 1);
  answer = json(429, { error: 'rate_limited' });
  await assert.rejects(postBoardComment({ target: 'review:r2', text: 'hi' }, f.deps), { code: 'rate_limited', status: 429 });
});

test('posts: closed → writing_closed; title + text + optional world', async () => {
  let answer = json(403, { error: 'writing_closed' });
  const f = fake([
    [/POST data\.worldlines\.gg\/v1\/records\/livingcanvas\/board-post$/, () => answer],
    [/publish$/, json(200, { visibility: 'published' })],
  ]);
  await assert.rejects(postBoardPost({ title: 't', text: 'x' }, f.deps), { code: 'writing_closed' });
  answer = json(201, { id: 'p1' });
  const p = await postBoardPost({ title: '组队', text: '一起玩', worldId: 'whitechapel' }, f.deps);
  assert.deepEqual(f.calls.at(-2).body, { body: { title: '组队', text: '一起玩', world_id: 'whitechapel' } });
  assert.equal(p.post.worldId, 'whitechapel');
  await assert.rejects(postBoardPost({ title: 'x'.repeat(81), text: 'y' }, f.deps), { code: 'too_long' });
});

test('report: one per item per player, pointing at the board kind', async () => {
  const f = fake([
    [/GET data\.worldlines\.gg\/v1\/records\/livingcanvas\/report$/, json(200, { records: [] })],
    [/POST data\.worldlines\.gg\/v1\/records\/livingcanvas\/report$/, json(201, { id: 'x' })],
  ]);
  await reportBoard('board-comment', 'c1', { reason: 'spam', note: ' ad ' }, f.deps);
  assert.deepEqual(f.calls.at(-1).body, { body: { target: 'livingcanvas/board-comment/c1', reason: 'spam', note: 'ad' } });
  await assert.rejects(reportBoard('board-post', 'p1', { reason: 'meh' }, f.deps), { code: 'invalid_reason' });
});
