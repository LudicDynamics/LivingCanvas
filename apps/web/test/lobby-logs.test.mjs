// The lobby's 「日志」 tab (lib/lobby-logs.ts, components/CommunityBoard.tsx): platform=livingcanvas
// through this app's server, ten a page with 「Load more」 (before = next_before), hidden while there is nothing
// (offline, an older data), a refresh never loses the older pages already read; every entry's text escaped.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false, tryNative: true, jsx: true });
const { createLobbyLogs } = await jiti.import('../src/lib/lobby-logs.ts');
const src = (p) => readFile(new URL(p, import.meta.url), 'utf8');

const entry = (n) => ({ id: `l${n}`, scope: 'livingcanvas', category: 'fix', title: { zh: `第${n}条` }, body: {}, publishedAt: `2026-10-${String(n).padStart(2, '0')}T00:00:00Z`, links: [], tags: [] });
/** A fake /api/account-data/logs over `all` (newest first), ten a page. */
function server(all, { down = false } = {}) {
  const calls = [];
  const state = { all, down };
  const fetch = async (url) => {
    calls.push(url);
    if (state.down) throw new TypeError('offline');
    const before = new URL(url, 'http://x').searchParams.get('before');
    const rest = state.all.filter((l) => !before || l.publishedAt < before);
    const page = rest.slice(0, 10);
    return { json: async () => ({ ok: true, available: true, logs: page, nextBefore: rest.length > 10 ? page.at(-1).publishedAt : null }) };
  };
  return { fetch, calls, state };
}

test('ten a page, 「Load more」 asks before = next_before until there is no more', async () => {
  const all = Array.from({ length: 23 }, (_, i) => entry(23 - i));
  const s = server(all);
  let now = 0;
  const logs = createLobbyLogs({ fetch: s.fetch, now: () => now });
  await logs.load();
  assert.deepEqual([logs.getState().list.length, logs.getState().nextBefore], [10, '2026-10-14T00:00:00Z']);
  await logs.more();
  await logs.more();
  assert.deepEqual([logs.getState().list.map((l) => l.id).at(-1), logs.getState().list.length, logs.getState().nextBefore], ['l1', 23, null]);
  assert.deepEqual(s.calls, ['/api/account-data/logs', '/api/account-data/logs?before=2026-10-14T00%3A00%3A00Z', '/api/account-data/logs?before=2026-10-04T00%3A00%3A00Z']);
  await logs.more();
  assert.equal(s.calls.length, 3, 'no more pages: no call');
  // a refresh (a minute later): a new entry on top, the older pages already read stay
  s.state.all = [entry(24), ...all];
  now += 61_000;
  await logs.load();
  assert.deepEqual([logs.getState().list.length, logs.getState().list[0].id, logs.getState().nextBefore], [24, 'l24', null]);
  await logs.load();
  assert.equal(s.calls.length, 4, 'at most once a minute');
});

test('offline / an older data / bad entries: nothing shown, nothing thrown; a failed refresh keeps the list', async () => {
  const off = createLobbyLogs({ fetch: server([], { down: true }).fetch, now: () => 0 });
  await off.load();
  assert.deepEqual(off.getState().list, []);
  const na = createLobbyLogs({ fetch: async () => ({ json: async () => ({ ok: false, available: false, reason: 'off' }) }), now: () => 0 });
  await na.load();
  assert.deepEqual(na.getState().list, []);
  const s = server([entry(2), { ...entry(1), id: '../x' }, { id: 'y' }]);
  let now = 0;
  const logs = createLobbyLogs({ fetch: s.fetch, now: () => now });
  await logs.load();
  assert.deepEqual(logs.getState().list.map((l) => l.id), ['l2']);
  s.state.down = true;
  now += 61_000;
  await logs.load();
  assert.deepEqual(logs.getState().list.map((l) => l.id), ['l2']);
});

test('the board: a 「日志」 tab only while there are logs, cards render escaped markup, world links open the world', async () => {
  const board = await src('../src/components/CommunityBoard.tsx');
  assert.match(board, /\{hasLogs && <button type="button" role="tab" aria-selected=\{tab === 'logs'\}/);
  assert.match(board, /if \(tab === 'logs' && !hasLogs\) setTab\('news'\)/);
  assert.match(board, /<MiniMarkdown className="community-board__body" text=\{body\} variant="log" \/>/);
  assert.match(board, /'world' in l\.link\s*\? <OpenWorld/);
  assert.match(board, /lobbyLogs\(\)\?\.more\(\)/);
  assert.ok(!/track\('(?!board_open)/.test(board), 'no new analytics event names');
  const app = await src('../src/lib/account-data-app.ts');
  assert.match(app, /window\.setInterval\(refresh, REFRESH_MS\)/);
  assert.match(app, /addEventListener\('focus', refresh\)/);
  assert.match(app, /void lobbyLogs\(\)\?\.load\(\)/);
  const { REFRESH_MS } = await jiti.import('../src/lib/announcements.ts');
  assert.equal(REFRESH_MS, 5 * 60_000);
});

test('the world card preview drops the markup (the words stay)', async () => {
  const card = await src('../src/components/WorldIntroCard.tsx');
  assert.match(card, /plainText\(localized\(l\.body, lang\)\)/);
});
