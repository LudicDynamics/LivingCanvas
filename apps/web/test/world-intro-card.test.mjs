// The lobby's "what is this world" card (components/WorldIntroCard.tsx, the design notes):
// what it shows, the lobby order, which bricks open it, and that it adds no analytics event.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..');
const repoRoot = path.resolve(webRoot, '../..');
const launcher = await createJiti(import.meta.url, { moduleCache: false }).import('../src/lib/world-launcher.ts');

const intro = (extra = {}) => ({
  status: 'playable', recommended: false, rank: null, hook: 'An empty ghost ship drifts in.', genres: ['mystery', 'adventure'],
  loop: ['Search the harbor chart', 'Every search costs tide', 'Accuse at the harbor office'], minutes: [30, 45], difficulty: 'intro',
  mechanics: ['dice', 'clock', 'endings', 'voice'], endings: 3, rules: 'coc',
  characters: [{ name: 'Vera', line: 'Your partner.', avatar: '/api/worlds/intro-avatar?id=wuwu&n=0' }, { name: 'Iris', line: 'No portrait.', avatar: null }],
  for: ['First-time players'], unfinished: null, derived: false, ...extra,
});
const group = (id, locale, introExtra, extra = {}) => ({
  id, name: `${id} · edition`, templatePath: `templates/${id}`, cover: `/api/worlds/cover?id=${id}`, locale, description: 'd', saves: [],
  intro: introExtra === null ? undefined : intro(introExtra), ...extra,
});
const ids = (groups, locale = 'en') => launcher.launcherWorlds(groups, locale).filter((g) => !launcher.isNewWorldBrick(g)).map((g) => g.id);

test('lobby order: 跑团 → 剧情 → 自由; inside one, finished before 实验 / 制作中, 新手推荐 on top, then rank', () => {
  const groups = [
    group('fpal', 'en', { status: 'experimental', experimental: true, rank: 11, unfinished: 'x' }, { category: 'free' }),
    group('magic', 'en', { status: 'in-development', experimental: true, rank: 9, unfinished: 'x' }, { category: 'story' }),
    group('guixiang', 'en', { rank: 3 }, { category: 'trpg' }),
    group('first-snow', 'en', { rank: 5 }, { category: 'story' }),
    group('whitechapel', 'en', { rank: 2, recommended: true }, { category: 'trpg' }),
    group('mandongbu', 'en', { status: 'experimental', experimental: true, rank: 10, unfinished: 'x' }, { category: 'free' }),
    group('door', 'en', { status: 'in-development', rank: 7, unfinished: 'x' }, { category: 'trpg' }),
    group('wuwu', 'en', { rank: 1, recommended: true }, { category: 'trpg' }),
    group('divergence', 'en', { rank: 6 }, { category: 'story' }),
    group('untyped', 'en', { rank: 0 }),
  ];
  assert.deepEqual(ids(groups), ['wuwu', 'whitechapel', 'guixiang', 'door', 'first-snow', 'divergence', 'magic', 'mandongbu', 'fpal', 'untyped']);
});

test('category chips: 全部 + each category with a world, with counts; a filter keeps 新建 first and the lobby order', () => {
  const groups = [
    group('wuwu', 'en', { rank: 1, recommended: true }, { category: 'trpg' }),
    group('guixiang', 'en', { rank: 3 }, { category: 'trpg' }),
    group('door', 'en', { status: 'in-development', rank: 2, unfinished: 'x' }, { category: 'trpg' }),
    group('first-snow', 'en', { rank: 5 }, { category: 'story' }),
    group('made-1', 'en', null, { templatePath: 'published/made-1', category: null, workshop: { status: 'published', owner: 'x', mine: false, editPath: null } }),
  ];
  const all = launcher.launcherWorlds(groups, 'en');
  // No free world here: no 自由世界 chip. The untyped published world counts only under 全部.
  assert.deepEqual(launcher.categoryChips(all), [{ id: 'all', count: 5 }, { id: 'trpg', count: 3 }, { id: 'story', count: 1 }]);
  const trpg = launcher.filterByCategory(all, 'trpg');
  assert.equal(trpg[0].id, launcher.NEW_WORLD_ID);
  assert.deepEqual(trpg.slice(1).map((g) => g.id), ['wuwu', 'guixiang', 'door']);
  assert.deepEqual(launcher.filterByCategory(all, 'story').map((g) => g.id), [launcher.NEW_WORLD_ID, 'first-snow']);
  assert.equal(launcher.filterByCategory(all, 'all').length, all.length);
  // A remembered filter with no world any more shows everything.
  assert.equal(launcher.filterByCategory(all, 'free').length, all.length);
});

test('the chosen category is remembered for the session, and a broken store never breaks the lobby', () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  assert.equal(launcher.readLobbyCategory(storage), 'all');
  launcher.writeLobbyCategory('story', storage);
  assert.equal(store.get(launcher.LOBBY_CATEGORY_KEY), 'story');
  assert.equal(launcher.readLobbyCategory(storage), 'story');
  store.set(launcher.LOBBY_CATEGORY_KEY, 'galgame');
  assert.equal(launcher.readLobbyCategory(storage), 'all', 'an id the table does not know is ignored');
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.equal(launcher.readLobbyCategory(broken), 'all');
  assert.doesNotThrow(() => launcher.writeLobbyCategory('trpg', broken));
  assert.equal(launcher.readLobbyCategory(null), 'all');
});

test('the wall opens with the first bricks of the lobby order in its top-left, not the wrapped end of the list', () => {
  for (const width of [1440, 390]) {
    const geometry = launcher.brickGeometry(width);
    const at = launcher.startPan(geometry);
    const count = 12;
    const visible = launcher.visibleBricks(at.x, at.y, width, 800, geometry, 0)
      .filter((b) => b.left - at.x >= -1 && b.top - at.y >= -1); // fully inside on the top/left edges
    const first = visible.sort((a, b) => a.top - b.top || a.left - b.left)[0];
    assert.equal(launcher.brickWorld(first.col, first.row, count), 0, `${width}px: the new-world brick leads`);
    const topRow = visible.filter((b) => b.row === first.row).map((b) => launcher.brickWorld(b.col, b.row, count));
    assert.deepEqual(topRow, topRow.map((_, i) => i), `${width}px: the top row reads 0, 1, 2…`);
  }
});

test('experimental worlds show to every player of their language, and only to them', () => {
  const groups = [group('fpal', 'zh-CN', { status: 'experimental', unfinished: 'x' }, { exp: true }), group('wuwu', 'en', {}), group('wuwu-zh', 'zh-CN', {})];
  assert.deepEqual(ids(groups, 'zh-CN'), ['wuwu-zh', 'fpal']);
  assert.deepEqual(ids(groups, 'en'), ['wuwu']);
});

test('the shown edition lists every language the world exists in', () => {
  const groups = [group('wuwu', 'en', {}), group('wuwu-jp', 'ja', {}), group('wuwu-zh', 'zh-CN', {}), group('wuwu-ko', 'ko', {})];
  const [shown] = launcher.launcherWorlds(groups, 'ja').slice(1);
  assert.equal(shown.id, 'wuwu-jp');
  assert.deepEqual(shown.languages, ['zh-CN', 'en', 'ja', 'ko']);
});

test('a click opens the intro card for every world a player may start, but not the author’s own draft', () => {
  assert.equal(launcher.opensIntroCard(group('wuwu', 'en', {})), true);
  assert.equal(launcher.opensIntroCard(group('made-1', 'en', null, { templatePath: 'published/made-1', workshop: { status: 'published', owner: 'x', mine: false, editPath: null } })), true);
  assert.equal(launcher.opensIntroCard(group('made-2', 'en', null, { templatePath: null, workshop: { status: 'draft', owner: 'me', mine: true, editPath: 'worlds/made-2' } })), false);
  assert.equal(launcher.opensIntroCard(launcher.NEW_WORLD_GROUP), false);
});

test('no new analytics event: the card reuses world_tile_open, 开始游戏 loads (App tracks world_enter)', () => {
  const src = fs.readFileSync(path.join(webRoot, 'src/components/WorldIntroCard.tsx'), 'utf8');
  assert.doesNotMatch(src, /track\(/);
  const wall = fs.readFileSync(path.join(webRoot, 'src/components/WorldLauncher.tsx'), 'utf8');
  assert.match(wall, /opensIntroCard\(world\)\) \{ track\('world_tile_open'/);
});

// ── Rendering ─────────────────────────────────────────────────────────────────
const require = createRequire(pathToFileURL(path.join(webRoot, 'test/x.mjs')));
let WorldIntroCard = null;
let WorldUpdates = null;
let React = null;
let renderToStaticMarkup = null;
try {
  const esbuild = require(path.join(repoRoot, 'node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild/lib/main.js'));
  React = await import('react');
  ({ renderToStaticMarkup } = await import('react-dom/server'));
  const out = await esbuild.build({
    entryPoints: [path.join(webRoot, 'src/components/WorldIntroCard.tsx')],
    bundle: true, write: false, format: 'esm', jsx: 'automatic', outdir: 'out',
    external: ['react', 'react/jsx-runtime', 'react-dom'], platform: 'node', absWorkingDir: webRoot, loader: { '.css': 'empty' },
    define: { 'import.meta.env': '{}' },
    // A bundled CommonJS dependency requires react at runtime: give the ESM bundle a `require`.
    banner: { js: "import { createRequire as __airpRequire } from 'node:module'; const require = __airpRequire(import.meta.url);" },
  });
  const cacheDir = path.join(webRoot, 'node_modules/.cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  const dir = fs.mkdtempSync(path.join(cacheDir, 'airp-intro-card-'));
  const file = path.join(dir, 'WorldIntroCard.mjs');
  fs.writeFileSync(file, out.outputFiles.find((f) => f.path.endsWith('.js')).text, 'utf-8');
  ({ WorldIntroCard, WorldUpdates } = await import(pathToFileURL(file).href));
  fs.rmSync(dir, { recursive: true, force: true });
} catch (err) {
  console.error('render bootstrap unavailable, skipping group:', err?.message ?? err);
}
const skip = WorldIntroCard ? false : 'esbuild/react unavailable';
const t = (key, values = {}) => key.replace(/\{(\w+)\}/g, (_, k) => String(values[k] ?? `{${k}}`));
// No document here: the card renders in place instead of in a portal.
const render = (world, locale = 'en') => renderToStaticMarkup(React.createElement(WorldIntroCard, {
  world, cover: '/cover.webp', social: null, loading: null, t, locale, onStart() {}, onContinue() {}, onClose() {},
}));

test('the card shows every field of the intro', { skip }, () => {
  const html = render({ ...group('wuwu', 'en', { recommended: true }, { category: 'trpg' }), languages: ['zh-CN', 'en', 'ja', 'ko'] });
  // The category badge and its one line replace the 可游玩 status badge.
  assert.doesNotMatch(html, /Playable/);
  for (const text of ['Tabletop worlds', 'A case to crack', 'Recommended for beginners', 'An empty ghost ship drifts in.', 'Detective', 'Adventure', '30–45 min', 'Beginner',
    'CoC rules', 'Endings · 3', '中文 / English / 日本語 / 한국어', 'What you do here', 'Search the harbor chart', 'Accuse at the harbor office',
    'Dice checks', 'Time limit', 'Multiple endings · 3', 'Voiced characters', 'Who you meet', 'Vera', 'Your partner.', 'Good for', 'First-time players', 'Start game']) {
    assert.ok(html.includes(text), `card shows ${text}`);
  }
  assert.match(html, /src="\/api\/worlds\/intro-avatar\?id=wuwu&amp;n=0"/);
  // No portrait: the name's initial.
  assert.match(html, /world-intro-card__initial[^>]*>I</);
  assert.doesNotMatch(html, /Continue latest save/);
});

test('an unfinished world says what is unfinished; a save in progress can be continued', { skip }, () => {
  const html = render(group('magic', 'en', { status: 'in-development', experimental: true, unfinished: 'Only one room so far.', mechanics: ['free-explore'], endings: 0, rules: null },
    { category: 'story', saves: [{ id: 's1', path: 'worlds/s1', updatedAt: '', active: false }] }));
  assert.ok(html.includes('Story worlds'));
  assert.ok(html.includes('Experimental'));
  assert.ok(html.includes('Work in progress'));
  assert.doesNotMatch(html, /In development/);
  assert.ok(html.includes('Only one room so far.'));
  assert.ok(html.includes('Free exploration · no fixed ending'));
  assert.ok(html.includes('No fixed ending'));
  assert.ok(html.includes('No rules'));
  assert.ok(html.includes('Continue latest save'));
  assert.ok(html.includes('Start a new game'));
});

test('the category reads the interface language from the one table', { skip }, () => {
  const html = render(group('first-snow', 'zh-CN', {}, { category: 'story' }), 'zh-CN');
  assert.ok(html.includes('剧情世界'));
  assert.ok(html.includes('由人推动的故事'));
});

test('a world without an intro still gets a card from its description', { skip }, () => {
  const html = render(group('made-1', 'en', null, { description: 'A world someone made.' }));
  assert.ok(html.includes('A world someone made.'));
  assert.ok(html.includes('No rules'));
  // No category: no badge, no category line.
  assert.doesNotMatch(html, /world-category|world-intro-card__category/);
});

// 日志 (platform/log v5: platform livingcanvas, scope world:<id>, surface world): the card's 「更新记录」 — the latest three, in the interface language with fallback.
const LOGS = [
  { id: 'a', category: 'world-update', title: { zh: '第二章开放', ja: '第二章公開', ko: '2장 공개', en: 'Chapter two' }, body: { zh: '新增**港口**线索', en: 'New harbor clues' }, publishedAt: '2026-10-07T00:00:00Z', links: [] },
  { id: 'b', category: 'fix', title: { ja: '不具合修正' }, body: {}, publishedAt: '2026-10-05T00:00:00Z', links: [] },
  { id: 'c', category: 'fix', title: { en: 'Dice fix' }, body: { en: 'x'.repeat(300) }, publishedAt: '2026-10-03T00:00:00Z', links: [] },
  { id: 'd', category: 'fix', title: { en: 'Fourth' }, body: {}, publishedAt: '2026-10-01T00:00:00Z', links: [] },
];
test('world intro card 「更新记录」: three newest, localized (ko / zh-CN / ja / en), long bodies cut, nothing when empty', { skip }, () => {
  const html = (locale) => renderToStaticMarkup(React.createElement(WorldUpdates, { logs: LOGS, t, locale }));
  const ko = html('ko');
  assert.match(ko, /Update log/);
  assert.ok(ko.includes('2장 공개') && ko.includes('New harbor clues'), 'ko title; body falls back to en');
  assert.ok(html('zh-CN').includes('第二章开放') && html('zh-CN').includes('新增港口线索'), 'the preview drops the markup, keeps the words');
  assert.ok(html('ja').includes('第二章公開') && html('ja').includes('不具合修正'));
  assert.ok(html('en').includes('Dice fix') && html('en').includes('…') && !html('en').includes('x'.repeat(200)));
  assert.ok(!ko.includes('Fourth'), 'three at most');
  assert.equal(renderToStaticMarkup(React.createElement(WorldUpdates, { logs: [], t, locale: 'en' })), '');
  // the card itself renders without logs (fetched after mount) and without a crash
  assert.doesNotMatch(render(group('wuwu', 'en', {})), /Update log/);
});

test('world logs: asked once per world (5 min cache) through the app server; offline / bad answers = nothing', async () => {
  const lib = await createJiti(import.meta.url, { moduleCache: false }).import('../src/lib/world-logs.ts');
  const asked = [];
  let now = 0;
  const env = { now: () => now, fetch: async (url) => { asked.push(url); return new Response(JSON.stringify({ ok: true, logs: LOGS })); } };
  assert.equal((await lib.fetchWorldLogs('whitechapel', env)).length, 3);
  await lib.fetchWorldLogs('whitechapel', env);
  assert.deepEqual(asked, ['/api/account-data/logs?world=whitechapel']);
  now = 6 * 60_000;
  await lib.fetchWorldLogs('whitechapel', env);
  assert.equal(asked.length, 2);
  assert.deepEqual(await lib.fetchWorldLogs('../x', env), []);
  assert.deepEqual(await lib.fetchWorldLogs('door', { now: () => 0, fetch: async () => { throw new Error('offline'); } }), []);
  assert.deepEqual(await lib.fetchWorldLogs('magic', { now: () => 0, fetch: async () => new Response(JSON.stringify({ ok: false, available: false })) }), []);
});
