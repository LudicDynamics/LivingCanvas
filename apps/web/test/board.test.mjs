// 公告 / 社区 (lib/board.ts): the community feed merges new / updated workshop worlds, reviews with words and
// player posts — one item each, newest first, undated ones dropped; announcements pinned first; dates in JST;
// "new since the last visit" per device; links only world:<id> or https; refusals → messages.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false, tryNative: true, jsx: true });
const B = await jiti.import('../src/lib/board.ts');

const world = (id, publishedAt, updatedAt = null) => ({ id, name: id, description: '', publisher: null, coverUrl: null, publishedAt, updatedAt });
const review = (id, createdAt, comment = 'nice') => ({ id, worldId: 'whitechapel', rating: 4, comment, author: null, tag: 'ab12', createdAt, updatedAt: createdAt });

test('merge: newest first, one item per world / review, new vs updated, undated and wordless dropped', () => {
  const items = B.mergeFeed({
    worlds: [world('made-00000001', '2026-10-01T00:00:00Z'), world('made-00000002', '2026-09-01T00:00:00Z', '2026-10-03T00:00:00Z'), world('made-00000001', '2026-10-01T00:00:00Z', '2026-10-01T00:10:00Z'), world('made-00000003', null)],
    reviews: [review('r1', '2026-10-02T00:00:00Z'), review('r1', '2026-10-02T00:00:00Z'), review('r2', '2026-10-04T00:00:00Z', null), review('r3', 'not a date')],
    posts: [{ id: 'p1', title: 't', text: 'x', worldId: null, author: null, tag: null, mine: false, createdAt: '2026-10-04T01:00:00Z' }],
  });
  assert.deepEqual(items.map((i) => i.key), ['post:p1', 'world:made-00000002', 'review:r1', 'world:made-00000001']);
  assert.equal(items.find((i) => i.key === 'world:made-00000002').fresh, 'updated');
  assert.equal(items.find((i) => i.key === 'world:made-00000001').fresh, 'new', 'ten minutes after publishing is still new');
  assert.equal(items.find((i) => i.key === 'world:made-00000001').at, '2026-10-01T00:10:00.000Z', 'the later copy wins');
  assert.deepEqual(B.mergeFeed({ worlds: [], reviews: [review('r2', '2026-10-04T00:00:00Z', null)], posts: [] }, { bareRatings: true }).map((i) => i.target), ['review:r2']);
  assert.equal(B.mergeFeed({ worlds: Array.from({ length: 60 }, (_, n) => world(`made-${String(n).padStart(8, '0')}`, `2026-10-01T00:${String(n % 60).padStart(2, '0')}:00Z`)), reviews: [], posts: [] }).length, 40);
});

test('announcements: pinned first, then newest; new since the last visit; JST dates', () => {
  const a = (id, startsAt, pinned = false) => ({ id, level: 'info', title: { zh: id }, body: {}, startsAt, endsAt: null, pinned });
  const list = [a('livingcanvas/old', '2026-09-01T00:00:00Z'), a('platform/new', '2026-10-04T00:00:00Z'), a('platform/pin', '2026-08-01T00:00:00Z', true)];
  assert.deepEqual(B.sortAnnouncements(list).map((x) => x.id), ['platform/pin', 'platform/new', 'livingcanvas/old']);
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  assert.equal(B.newSince(list, B.lastSeen(storage)).length, 3, 'never opened: everything is new');
  B.markSeen(storage, Date.parse('2026-10-02T00:00:00Z'));
  assert.deepEqual(B.newSince(list, B.lastSeen(storage)).map((x) => x.id), ['platform/new']);
  assert.equal(B.lastSeen({ getItem: () => { throw new Error('blocked'); } }), 0);
  assert.equal(B.formatJst('2026-10-03T15:30:00Z', 'en'), '10/04/2026, 00:30 JST');
  assert.match(B.formatJst('2026-10-03T15:30:00Z', 'ja'), /^2026\/10\/04 00:30 JST$/);
  assert.equal(B.formatJst('nope', 'ja'), '');
});

test('links: world:<id> opens a world, https a tab, nothing else; images https only', () => {
  assert.deepEqual(B.linkOf('world:whitechapel'), { world: 'whitechapel' });
  assert.deepEqual(B.linkOf('https://worldlines.gg/x'), { href: 'https://worldlines.gg/x' });
  for (const bad of ['javascript:alert(1)', 'http://x', 'world:../x', '', undefined]) assert.equal(B.linkOf(bad), null, String(bad));
  assert.equal(B.safeImage('data:image/png;base64,xx'), null);
  assert.equal(B.safeImage('https://canvas.worldlines.gg/a.webp'), 'https://canvas.worldlines.gg/a.webp');
});

test('client: reads without the header, writes with it; offline = not available; refusals → messages', async () => {
  const calls = [];
  const client = B.createBoardClient(async (url, init = {}) => { calls.push([url, init.method, init.headers?.['x-airp-settings'] ?? null, init.body ?? null]); return { json: async () => ({ ok: true, comments: [] }) }; });
  await client.comments('world:made-00000001');
  await client.comment('world:made-00000001', 'hi');
  await client.report('comments', 'c1', 'spam');
  assert.deepEqual(calls.map((c) => c.slice(0, 3)), [['/api/board/comments?target=world%3Amade-00000001', 'GET', null], ['/api/board/comments', 'POST', '1'], ['/api/board/comments/c1/report', 'POST', '1']]);
  const off = B.createBoardClient(async () => { throw new Error('offline'); });
  assert.deepEqual(await off.feed(), { ok: false, available: false, reason: 'unreachable' });
  assert.equal(B.refusalText({ ok: false, reason: 'signed_out' }), 'Sign in to comment.');
  assert.match(B.refusalText({ ok: false, code: 'content_refused' }), /not allowed/);
  assert.match(B.refusalText({ ok: false, code: 'account_too_new' }), /\{date\}/);
});

test('source contracts: the board lives in the launcher only, in its own component; text stays text; links safe', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = (p) => readFile(new URL(p, import.meta.url), 'utf8');
  const [board, notices, launcher, app, server] = await Promise.all([src('../src/components/CommunityBoard.tsx'), src('../src/components/Announcements.tsx'), src('../src/components/WorldLauncher.tsx'), src('../src/App.tsx'), src('../../server/src/index.ts')]);
  assert.ok(notices.includes('<CommunityBoard ') && !app.includes('CommunityBoard'), 'never over the play screen');
  assert.match(launcher, /<LauncherNotices onOpenWorld=\{openWorldByKey\} worldName=\{worldNameOf\} \/>/);
  assert.ok(!/dangerouslySetInnerHTML/.test(board), 'comments and posts render as text');
  assert.ok(board.includes('rel="noopener noreferrer"') && board.includes('safeImage(') && board.includes('linkOf('));
  assert.ok(board.includes('maxLength={MAX_COMMENT}') && /const MAX_COMMENT = 500;/.test(board), 'the 500-character cap shows before data refuses');
  assert.ok(board.includes("feed?.config.postsEnabled && <PostComposer"), 'posting only while an admin has it open');
  assert.ok(server.includes("app.use('/api', createBoardRouter());"));
});
