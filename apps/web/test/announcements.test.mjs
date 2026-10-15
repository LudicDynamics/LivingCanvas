// 公告 in the launcher (lib/announcements.ts, lib/mini-markdown.tsx, components/Announcements.tsx):
// read without an account, closed ones remembered (and merged from the account, never un-closed),
// the body's small Markdown built as elements (no HTML from the text, http(s) links only),
// and nothing of it over the play screen except a dot.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false, tryNative: true, jsx: true });
const { createAnnouncements, localized, unread, current, onNow, isDismissed, syncIdOf, localIdOf, DISMISSED_KEY } = await jiti.import('../src/lib/announcements.ts');
const src = (p) => readFile(new URL(p, import.meta.url), 'utf8');

const LIST = [
  { id: 'livingcanvas/l1', level: 'important', title: { ja: '新しい世界' }, body: {}, startsAt: '2026-10-01T00:00:00Z', endsAt: null, pinned: true },
  { id: 'platform/p1', level: 'maintenance', title: { zh: '维护', en: 'Maintenance' }, body: { zh: '**今晚**' }, startsAt: '2026-10-01T00:00:00Z', endsAt: null, pinned: false },
];

function setup({ answer = { ok: true, announcements: LIST }, stored = null } = {}) {
  const storage = new Map(stored ? [[DISMISSED_KEY, stored]] : []);
  const calls = [];
  let now = 1_000_000;
  const a = createAnnouncements({
    fetch: async (url) => { calls.push(url); return { json: async () => answer }; },
    storage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) },
    now: () => now,
  });
  return { a, storage, calls, tick: (ms) => { now += ms; } };
}

test('loaded without an account, at most once a minute (the five-minute tick / a focus ask again); offline keeps the last list', async () => {
  const s = setup();
  await s.a.load();
  await s.a.load();
  assert.deepEqual([s.calls, s.a.getState().list.length], [['/api/account-data/announcements'], 2]);
  s.tick(61_000);
  await s.a.load();
  assert.equal(s.calls.length, 2);
  const off = setup({ answer: { ok: false, available: false } });
  await off.a.load();
  assert.equal(off.a.getState().list.length, 0);
  // a later failed answer never empties what is shown
  let answer = { ok: true, announcements: LIST };
  const flaky = setup();
  const b = createAnnouncements({ fetch: async () => ({ json: async () => answer }), storage: null, now: () => Date.now() });
  await b.load();
  answer = { ok: false, available: false, reason: 'unreachable' };
  await b.load(true);
  assert.equal(b.getState().list.length, 2);
  void flaky;
});

test('closing is remembered here and merged from the account, never undone', async () => {
  const s = setup({ stored: JSON.stringify(['platform/old', 'https://evil']) });
  await s.a.load();
  assert.deepEqual(unread(s.a.getState()).map((x) => x.id), ['livingcanvas/l1', 'platform/p1']);
  s.a.dismiss('livingcanvas/l1');
  assert.deepEqual(JSON.parse(s.storage.get(DISMISSED_KEY)), ['platform/old', 'livingcanvas/l1']);
  s.a.mergeDismissed(['platform/p1', 'nope']);
  assert.deepEqual(unread(s.a.getState()), []);
  assert.deepEqual(s.a.dismissedIds(), ['platform/old', 'livingcanvas/l1', 'platform/p1']);
});

test('the interface language first, then zh → ja → en', () => {
  assert.equal(localized({ zh: '维护', en: 'Maintenance' }, 'zh-CN'), '维护');
  assert.equal(localized({ zh: '维护', en: 'Maintenance' }, 'en'), 'Maintenance');
  assert.equal(localized({ ja: '新しい世界' }, 'en'), '新しい世界');
  assert.equal(localized(undefined, 'en'), '');
});

test('Markdown: elements only, http(s) links in a new tab without the opener', async () => {
  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { MiniMarkdown } = await jiti.import('../src/lib/mini-markdown.tsx');
  const html = renderToStaticMarkup(React.createElement(MiniMarkdown, { text: '**今晚** 22:00 *维护*\n<script>alert(1)</script>\n\n- [详情](https://worldlines.gg/x)\n- [坏](javascript:alert(1))' }));
  assert.match(html, /<strong>今晚<\/strong> 22:00 <em>维护<\/em>/);
  assert.ok(html.includes('&lt;script&gt;'), 'text stays text');
  assert.match(html, /<a href="https:\/\/worldlines.gg\/x" target="_blank" rel="noopener noreferrer">详情<\/a>/);
  assert.ok(!html.includes('href="javascript'), 'only http(s) links');
});

test('only the launcher shows announcements; a world gets a dot on its launcher button', async () => {
  const app = await src('../src/App.tsx');
  const launcher = await src('../src/components/WorldLauncher.tsx');
  assert.ok(launcher.includes('<LauncherNotices onOpenWorld={openWorldByKey} worldName={worldNameOf} />'));
  assert.ok(!app.includes('<LauncherNotices'), 'not over the play screen');
  assert.match(app, /\{t\('World launcher'\)\}<NoticeDot \/>/);
  // counts (ratings, likes, plays) live on the launcher's bricks, not on the play screen
  assert.ok(launcher.includes('<BrickSocialMarks') && !app.includes('BrickSocialMarks') && !app.includes('loadNumbers'));
});

test('comment authors: the nickname or 「Anonymous player」 + tag — never the account name or email', async () => {
  const social = await src('../src/components/WorldSocial.tsx');
  const field = await src('../src/components/chrome/NicknameField.tsx');
  assert.match(social, /comment\.author \?\? \(comment\.tag \? `\$\{t\('Anonymous player'\)\} \$\{comment\.tag\}`/);
  for (const text of [social, field]) assert.ok(!/display_name|displayName|\.email/.test(text));
});

test('banner logs (log/<id>): the window is checked again on the page, the list re-renders at the next end', async () => {
  const now = Date.parse('2026-10-08T12:00:00Z');
  const at = (ms) => new Date(now + ms).toISOString();
  const list = [
    { id: 'log/on', level: 'info', title: { en: 'On' }, body: {}, startsAt: at(-60e3), endsAt: at(60e3), pinned: false, source: 'log' },
    { id: 'log/ended', level: 'important', title: { en: 'Ended' }, body: {}, startsAt: at(-3600e3), endsAt: at(-1), pinned: true, source: 'log' },
    { id: 'log/later', level: 'maintenance', title: { en: 'Later' }, body: {}, startsAt: at(1), endsAt: null, pinned: false, source: 'log' },
  ];
  const timers = [];
  let clock = now;
  const a = createAnnouncements({ fetch: async () => ({ json: async () => ({ ok: true, announcements: list }) }), storage: null, now: () => clock, setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimer: () => {} });
  let renders = 0;
  a.subscribe(() => { renders += 1; });
  await a.load();
  assert.deepEqual(unread(a.getState(), now).map((x) => x.id), ['log/on'], 'a stale answer still listing an ended one: not shown');
  assert.deepEqual(current(a.getState(), now + 61e3).map((x) => x.id), ['log/later']);
  assert.equal(timers.at(-1).ms, 1 + 50, 'next boundary: log/later starts');
  clock += 2; timers.at(-1).fn();
  assert.equal(renders, 2, 're-rendered at the boundary');
  assert.equal(onNow({ startsAt: 'nope', endsAt: null }, now), false);
});

test('closing: per id; banner logs travel to the account as livingcanvas/log.<id>; a migrated ann-… is closed when its old announcement was', async () => {
  const s = setup({ answer: { ok: true, announcements: [...LIST, { id: 'log/r_1', level: 'info', title: { ko: '업데이트' }, body: {}, startsAt: '2026-10-02T00:00:00Z', endsAt: null, pinned: false, source: 'log' }, { id: 'log/ann-platform-p9', level: 'info', title: { en: 'm' }, body: {}, startsAt: '2026-10-02T00:00:00Z', endsAt: null, pinned: false, source: 'log' }, { id: 'other/x', level: 'info', title: { en: 'x' }, body: {}, startsAt: '2026-10-02T00:00:00Z', endsAt: null, pinned: false }] } });
  await s.a.load();
  assert.deepEqual(s.a.getState().list.map((a) => a.id), ['livingcanvas/l1', 'platform/p1', 'log/r_1', 'log/ann-platform-p9']);
  s.a.dismiss('log/r_1');
  assert.ok(s.a.getState().dismissed.has('log/r_1'));
  assert.deepEqual(s.a.dismissedIds(), ['livingcanvas/log.r_1']);
  s.a.mergeDismissed(['livingcanvas/log.r_2', 'platform/p9']);
  assert.deepEqual([...s.a.getState().dismissed], ['log/r_1', 'log/r_2', 'platform/p9']);
  assert.deepEqual(unread(s.a.getState()).map((a) => a.id), ['livingcanvas/l1', 'platform/p1'], 'ann-platform-p9 counts as closed');
  assert.equal(isDismissed(new Set(['platform/p9']), 'log/ann-platform-p9'), true);
  assert.equal(syncIdOf(`log/${'x'.repeat(126)}`), null, 'too long for the account copy: this device only');
  assert.equal(localIdOf('platform/p1'), 'platform/p1');
});

test('the top line: any banner log, an old announcement only when important / maintenance / pinned; links open the world or a tab, else the board', async () => {
  const { topBanner, threadOf } = await jiti.import('../src/lib/announcements.ts');
  const old = { id: 'platform/i', level: 'info', pinned: false, source: 'announcement' };
  assert.equal(topBanner([old]), null);
  assert.equal(topBanner([old, { id: 'log/i', level: 'info', pinned: false, source: 'log' }]).id, 'log/i');
  const notices = await src('../src/components/Announcements.tsx');
  assert.match(notices, /'world' in link && onOpenWorld\(link\.world\)\)\) setOpenRequest/);
  assert.match(notices, /href=\{link\.href\} target="_blank" rel="noopener noreferrer"/);
  const board = await src('../src/components/CommunityBoard.tsx');
  assert.deepEqual([threadOf('platform/p1'), threadOf('log/r_1'), threadOf('log/ann-livingcanvas-l2')], ['announcement:platform/p1', null, 'announcement:livingcanvas/l2'], 'a migrated log keeps its old thread');
  assert.match(board, /sortAnnouncements\(current\(state\)\)/, 'the board lists only what is on now');
});

test('日志 markup: escaped text, paragraphs, **bold**, https links, - lists, a picture line; nothing else', async () => {
  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { MiniMarkdown, plainText } = await jiti.import('../src/lib/mini-markdown.tsx');
  const text = '第一段 **粗** *不是斜体* `不是代码` <img src=x onerror=alert(1)>\n第二行\n\n- [详情](https://worldlines.gg/log/)\n- [坏](javascript:alert(1)) [http](http://x.test)\n\n前文\n![地图](https://worldlines.gg/a.webp)\n![坏图](javascript:x)\n后文';
  const html = renderToStaticMarkup(React.createElement(MiniMarkdown, { text, variant: 'log' }));
  assert.match(html, /<p>第一段 <strong>粗<\/strong> \*不是斜体\* `不是代码` &lt;img src=x onerror=alert\(1\)&gt;<br\/>第二行<\/p>/);
  assert.match(html, /<ul><li><a href="https:\/\/worldlines.gg\/log\/" target="_blank" rel="noopener noreferrer">详情<\/a><\/li><li>\[坏\]\(javascript:alert\(1\)\) \[http\]\(http:\/\/x.test\)<\/li><\/ul>/);
  assert.match(html, /<p>前文<\/p><figure><img src="https:\/\/worldlines.gg\/a.webp" alt="地图" loading="lazy" decoding="async" referrerPolicy="no-referrer"\/><\/figure><p>!\[坏图\]\(javascript:x\)<br\/>后文<\/p>/);
  assert.ok(!/<img src="x"|<script|href="javascript|href="http:/.test(html));
  assert.equal(plainText('**新** [地图](https://x.test/a)\n\n![图](https://x.test/i.webp)\n- 一'), '新 地图\n· 一');
});
