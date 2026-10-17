// The message drawer and the slimmer canvas. Unit tests for the pure stream module, then source
// constraints on where it is wired: the canvas keeps the newest chalks and the ones still asking for something, every
// word goes to one timeline, and the drawer rises and falls with the writer.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const read = (p) => readFile(new URL(p, import.meta.url), 'utf8');
const app = await read('../src/App.tsx');
const drawer = await read('../src/components/chrome/MessageDrawer.tsx');
const drawerCss = await read('../src/components/chrome/message-drawer.css');
const fab = await read('../src/components/chrome/WriterFab.tsx');
const dock = await read('../src/components/sidebar/CharacterDock.tsx');
const canvas = await read('../src/components/canvas/Canvas.tsx');
const object = await read('../src/components/canvas/CanvasObject.tsx');
const choiceRail = await read('../src/components/sidebar/ChoiceRail.tsx');
const storyEvents = await read('../src/components/chrome/StoryEvents.tsx');
const world = await read('../src/state/useWorld.ts');

const jiti = createJiti(import.meta.url, { moduleCache: false });
const S = await jiti.import('../src/lib/message-stream.ts');

const chalk = (path, extra = {}) => ({ path, body: `body of ${path}`, frontmatter: { type: 'chalk', ...extra } });

// ── which chalks stay on the canvas ──────────────────────────────────────────────

test('chalks order by their NN- ordinal; play-made chalks (no ordinal) come after, in item order', () => {
  const ordered = S.orderChalks([chalk('w/search-b.md'), chalk('w/03-c.md'), chalk('w/01-a.md'), chalk('w/search-a.md'), chalk('w/02-b.md')]);
  assert.deepEqual(ordered.map((c) => c.path), ['w/01-a.md', 'w/02-b.md', 'w/03-c.md', 'w/search-b.md', 'w/search-a.md']);
  assert.equal(S.chalkOrdinal('world/seated-car/12-x.md'), 12);
  assert.equal(S.chalkOrdinal('world/days.md'), null);
});

test('the canvas keeps the newest few plus every chalk still asking for something', () => {
  const list = ['01', '02', '03', '04', '05'].map((n) => chalk(`w/${n}-x.md`));
  const open = new Set(['w/01-x.md']);
  const shown = S.canvasChalks(list, 2, (c) => open.has(c.path));
  assert.deepEqual([...shown].sort(), ['w/01-x.md', 'w/04-x.md', 'w/05-x.md']);
  assert.equal(S.canvasChalks(list, 3, () => false).size, 3);
  assert.equal(S.CANVAS_CHALK_KEEP, 3);
});

test('a chalk is open while its roll is not made or an option is not done; a repeat option never pins it', () => {
  const optionsOf = (c) => c.frontmatter.options ?? [];
  const done = new Set(['take']);
  const isDone = (_c, o) => done.has(o.id);
  assert.equal(S.chalkIsOpen(chalk('a.md', { roll_dice: { type: '2d10' } }), optionsOf, isDone), true);
  assert.equal(S.chalkIsOpen(chalk('a.md', { roll_dice: { type: '2d10', result: 14 } }), optionsOf, isDone), false);
  assert.equal(S.chalkIsOpen(chalk('a.md', { options: [{ id: 'take' }] }), optionsOf, isDone), false);
  assert.equal(S.chalkIsOpen(chalk('a.md', { options: [{ id: 'take' }, { id: 'look' }] }), optionsOf, isDone), true);
  assert.equal(S.chalkIsOpen(chalk('a.md', { options: [{ id: 'back', repeat: true }] }), optionsOf, isDone), false);
  assert.equal(S.chalkIsOpen(chalk('a.md'), optionsOf, isDone), false);
});

test('the keep count is a per-browser override between 1 and 6, else the default', () => {
  const store = (v) => ({ getItem: () => v });
  assert.equal(S.readChalkKeep(store('2')), 2);
  assert.equal(S.readChalkKeep(store('0')), S.CANVAS_CHALK_KEEP);
  assert.equal(S.readChalkKeep(store('9')), S.CANVAS_CHALK_KEEP);
  assert.equal(S.readChalkKeep(store(null)), S.CANVAS_CHALK_KEEP);
  assert.equal(S.readChalkKeep({ getItem: () => { throw new Error('denied'); } }), S.CANVAS_CHALK_KEEP);
});

// ── the stream ──────────────────────────────────────────────────────────────────

test('chalks already on a page are seated before now in file order; a later chalk is stamped when it lands', () => {
  let now = 1_000_000;
  const stream = S.createMessageStream({ now: () => now, storage: null });
  stream.scope('save-a');
  stream.observeChalks('world/car', [chalk('world/car/02-b.md'), chalk('world/car/01-a.md')]);
  const first = stream.entries();
  assert.deepEqual(first.map((e) => e.id), ['chalk:world/car/01-a.md', 'chalk:world/car/02-b.md']);
  assert.ok(first.every((e) => e.at < now && e.kind === 'writer' && e.layer === 'world/car'));
  now += 5000;
  stream.record({ id: 'you:1', kind: 'you', who: 'writer', text: 'open the door' });
  now += 5000;
  stream.observeChalks('world/car', [chalk('world/car/01-a.md'), chalk('world/car/02-b.md'), chalk('world/car/03-c.md')]);
  const rows = S.streamRows(stream.entries()).filter((r) => r.type === 'entry').map((r) => r.entry.id);
  assert.deepEqual(rows, ['chalk:world/car/01-a.md', 'chalk:world/car/02-b.md', 'you:1', 'chalk:world/car/03-c.md']);
});

test('a chalk that grows updates its entry in place; its time stays; resolved-dice markers are not text', () => {
  let now = 10;
  const stream = S.createMessageStream({ now: () => now, storage: null });
  stream.scope('s');
  stream.observeChalks('l', [{ path: 'l/01-a.md', body: 'one', frontmatter: { title: 'A' } }]);
  const at = stream.entries()[0].at;
  now = 99;
  stream.observeChalks('l', [{ path: 'l/01-a.md', body: 'one\n<!-- resolved-dice: 14 -->\ntwo', frontmatter: { title: 'A' } }]);
  assert.equal(stream.entries().length, 1);
  assert.equal(stream.entries()[0].at, at);
  assert.equal(stream.entries()[0].text, 'one\n\ntwo');
  assert.equal(stream.entries()[0].title, 'A');
});

test('the stream is per save, survives the tab session (the newest STREAM_CAP), and never records empty words', () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const a = S.createMessageStream({ now: () => 1, storage });
  a.scope('save-1');
  a.record({ id: 'x', kind: 'character', who: 'xia', text: '  hello ' });
  a.record({ id: 'y', kind: 'character', who: 'xia', text: '   ' });
  assert.deepEqual(a.entries().map((e) => [e.id, e.text]), [['x', 'hello']]);
  a.scope('save-2');
  assert.equal(a.entries().length, 0);
  const b = S.createMessageStream({ now: () => 2, storage });
  b.scope('save-1');
  assert.deepEqual(b.entries().map((e) => e.id), ['x']);
  let t = 10;
  const c = S.createMessageStream({ now: () => (t += 1), storage });
  c.scope('save-1');
  for (let i = 0; i < S.STREAM_CAP + 20; i += 1) c.record({ id: `n${i}`, kind: 'you', text: `line ${i}` });
  // Memory keeps them all (the history read by scrolling up lives here too); the tab copy keeps the newest.
  assert.equal(c.entries().length, S.STREAM_CAP + 21);
  const d = S.createMessageStream({ now: () => 3, storage });
  d.scope('save-1');
  assert.equal(d.entries().length, S.STREAM_CAP);
  assert.equal(d.entries().at(-1).id, `n${S.STREAM_CAP + 19}`);
  assert.ok(S.STREAM_MEMORY_CAP > S.STREAM_CAP);
});

test('dividers mark a change of place and a quiet gap; the peek is the newest entry, one line', () => {
  const entries = [
    { id: 'a', kind: 'writer', text: 'x', at: 0, layer: 'car-2' },
    { id: 'b', kind: 'character', text: 'y', at: 1000 },
    { id: 'c', kind: 'you', text: 'z', at: 1000 + S.STREAM_GAP_MS },
    { id: 'd', kind: 'writer', text: '**Bold** line\nsecond', at: 1000 + S.STREAM_GAP_MS + 1, layer: 'car-3' },
  ];
  const rows = S.streamRows(entries);
  assert.deepEqual(rows.map((r) => (r.type === 'divider' ? `|${r.place ? r.layer : 'time'}` : r.entry.id)), ['|car-2', 'a', 'b', '|time', 'c', '|car-3', 'd']);
  assert.equal(S.latestEntry(entries).id, 'd');
  assert.equal(S.oneLine(entries[3].text), 'Bold line');
  assert.equal(S.isLongText('x'.repeat(S.LONG_CHARS + 1)), true);
  assert.equal(S.isLongText('a\nb\nc\nd\ne'), true);
  assert.equal(S.isLongText('short'), false);
});

test('the dock keeps only the latest exchange; every settled line is recorded once', () => {
  const lines = [
    { id: 1, who: 'character', text: 'hi' },
    { id: 2, who: 'player', text: 'yo' },
    { id: 3, who: 'character', text: 'well' },
    { id: 4, who: 'character', text: 'and then' },
  ];
  assert.deepEqual(S.latestExchange(lines).map((l) => l.id), [2, 3, 4]);
  assert.deepEqual(S.latestExchange(lines.slice(0, 1)).map((l) => l.id), [1]);
  assert.deepEqual(S.latestExchange([...lines, { id: 5, who: 'character', text: 'more' }]).map((l) => l.id), [3, 4, 5]);
  const stream = S.createMessageStream({ now: () => 1, storage: null });
  stream.scope('s');
  S.recordDockLine('xia', lines[1], stream);
  S.recordDockLine('xia', lines[1], stream);
  S.recordDockLine('xia', lines[2], stream);
  assert.deepEqual(stream.entries().map((e) => [e.kind, e.who]), [['you', 'xia'], ['character', 'xia']]);
});

// ── wiring (source constraints) ─────────────────────────────────────────────────

test('the canvas and the map draw the same slimmed items; older chalks fade before they leave', () => {
  assert.match(app, /const shownChalks = canvasChalks\(orderedChalks, chalkKeep, chalkOpen\);/);
  assert.match(app, /const retiringChalks = useRetiringChalks\(shownChalks,/);
  assert.match(app, /retiringPaths=\{streamOn \? retiringChalks : undefined\}/);
  assert.match(canvas, /retiring=\{retiringPaths\?\.has\(item\.path\)\}/);
  assert.match(object, /data-chalk-retiring=\{retiring \? 'true' : undefined\}/);
  assert.match(drawerCss, /\.object\[data-chalk-retiring='true'\] \{\s*opacity: 0;\s*pointer-events: none;/);
  // Classic and the nook are untouched.
  assert.match(app, /const streamOn = companion && !nookChar && !launcherOpen;/);
});

test('a chalk on the canvas jumps to its place in the drawer, lit', () => {
  assert.match(object, /isChalk && onShowInStream && !retiring && \(/);
  assert.match(object, /onPointerDown=\{event => event\.stopPropagation\(\)\}/);
  assert.match(app, /onChalkToStream=\{streamOn \? openStreamAt : undefined\}/);
  assert.match(app, /setStreamFocus\(\(f\) => \(\{ id: `chalk:\$\{path\}`, n: \(f\?\.n \?\? 0\) \+ 1 \}\)\)/);
  assert.match(drawer, /row\?\.scrollIntoView\(\{ block: 'center' \}\)/);
  assert.match(drawer, /'data-lit': lit === entry\.id \? 'true' : undefined/);
});

test('the drawer rises with the writer and goes down with it; a press in the drawer is not "outside"', () => {
  assert.match(app, /const streamOpen = streamOn && \(writerSheetOpen \|\| streamSolo\);/);
  assert.match(app, /onOpenChange=\{onWriterOpenChange\}/);
  assert.match(app, /const closeStream = \(\): void => \{\s*setStreamSolo\(false\);\s*if \(writerSheetOpen\) onWriterOpenChange\(false\);/);
  assert.match(fab, /if \(target\.closest\('\[data-message-drawer\]'\)\) return;/);
  assert.match(fab, /selector: "\.message-drawer\[data-open='true'\] \.message-drawer__panel"/);
  assert.match(drawer, /data-message-drawer=""/);
});

test('every word reaches the stream: the writer asks, slips, dock lines, tick lines, rolls, events', () => {
  assert.match(app, /messageStream\.record\(\{ id: `you:\$\{Date\.now\(\)\}:\$\{text\.slice\(0, 16\)\}`, kind: 'you', who: 'writer'/);
  assert.match(app, /if \(!slip\.text\) messageStream\.record\(/);
  assert.match(dock, /recordDockLine\(speakerId, line\)/);
  assert.match(dock, /const shownLines = latestExchange\(dialogue\.lines\);/);
  assert.match(dock, /\{shownLines\.map\(line => \(/);
  assert.match(app, /return subscribeTick\(take\);/);
  assert.match(app, /return subscribeCeremony\(\(\) => \{/);
  assert.match(app, /window\.addEventListener\('airp:story-event', onEvent\)/);
  // Choices, CG captions, endings, loop resets: the history's own mapping, live (rolls come from the ceremony).
  assert.match(app, /for \(const item of streamItemsOfEvent\(ev\)\) if \(item\.kind !== 'dice'\) messageStream\.record\(item\);/);
  assert.match(world, /window\.dispatchEvent\(new CustomEvent\('airp:stream-event', \{ detail: ev \}\)\);/);
  // Tick lines are keyed by id + time, the way the history keys them.
  assert.match(app, /const key = tickStreamKey\(entry\);/);
  assert.match(app, /id: `tick:\$\{key\}:say`/);
  // Story events still show, one at a time; the drawer keeps them all.
  assert.match(storyEvents, /const MAX_CARDS = 1;/);
  // A world switch never stamps the old page's chalks into the new save.
  assert.match(app, /const streamSettled = loadingWorld === null && !launcherOpen;/);
});

test('the left journal and the parked option rail left the companion screen', () => {
  assert.match(app, /\{!companion && <aside className=\{`prototype-narrative/);
  assert.match(app, /\{!companion && <button onClick=\{\(\) => toggleShell\('journal'\)\}/);
  assert.match(choiceRail, /if \(variant === 'drawer'\) \{/);
  assert.match(drawerCss, /\.message-drawer__options \.choice-rail--drawer \{[\s\S]{0,120}position: static;/);
});

test('the drawer: writer / people / you told apart, folding, compact done cards, phone sheet, reduced motion', () => {
  for (const cls of ['message-stream__writer', 'message-stream__said--you', 'message-stream__dice', 'message-stream__event', 'message-stream__divider']) {
    assert.match(drawer + drawerCss, new RegExp(cls));
  }
  assert.match(drawer, /<Folding text=\{entry\.text\} markdown \/>/);
  assert.match(drawerCss, /\.message-stream__text\[data-folded='true'\] \{[\s\S]{0,80}-webkit-line-clamp: 4;/);
  assert.match(drawerCss, /\.message-stream__writer\[data-compact='true'\]/);
  assert.match(drawerCss, /@media \(max-width: 700px\) \{[\s\S]*\.message-drawer\[data-open='true'\] \{\s*left: 0;\s*right: 0;\s*bottom: 0;/);
  assert.match(drawerCss, /@media \(prefers-reduced-motion: reduce\) \{\s*\.message-drawer__panel \{ animation: none; \}/);
  // Tokens only: no literal colours in the drawer's stylesheet.
  assert.doesNotMatch(drawerCss.replace(/\/\*[\s\S]*?\*\//g, ''), /#[0-9a-fA-F]{3,8}\b|rgba?\(/);
});


// ── the history ────────────────────────────────────────────────

const server = (entry) => ({ origin: 'server', ...entry });

test('a line the page stamped and the same line from the server are one entry; the server time wins', () => {
  let now = 1_000_000;
  const stream = S.createMessageStream({ now: () => now, storage: null });
  stream.scope('save');
  stream.observeChalks('world/car', [chalk('world/car/01-a.md')]);
  S.recordDockLine('xia', { id: 3, who: 'player', text: '你还记得我吗' }, stream);
  S.recordDockLine('xia', { id: 4, who: 'character', text: '[emo: smile] 咦……这话该我问你才对呀。' }, stream);
  stream.record({ id: 'dice:local', kind: 'dice', title: '侦查: 看门', text: '侦查: 看门', score: '14 / <=60', outcome: 'pass' });
  stream.hydrate([
    { id: 'chalk:world/car/01-a.md', kind: 'writer', text: 'body of world/car/01-a.md', at: 500_000, layer: 'world/car', chalkPath: 'world/car/01-a.md' },
    { id: 'chat:xia:u1', kind: 'you', who: 'xia', text: '你还记得我吗', at: now - 2000 },
    { id: 'chat:xia:u1:reply', kind: 'character', who: 'xia', text: '咦……这话该我问你才对呀', at: now - 1000 },
    { id: 'dice:evt-9', kind: 'dice', title: '侦查: 看门', text: '侦查: 看门', score: '14 / <=60', outcome: 'pass', at: now - 500 },
  ]);
  const list = stream.entries();
  assert.deepEqual(list.map((e) => e.id).sort(), ['chalk:world/car/01-a.md', 'chat:xia:u1', 'chat:xia:u1:reply', 'dice:evt-9']);
  assert.equal(list.find((e) => e.id === 'chalk:world/car/01-a.md').at, 500_000, 'the save knows when the chalk landed');
  assert.ok(list.every((e) => e.origin === 'server'));
  // The dock records its lines again on every change: they stay the server's, never a second copy.
  now += 60_000;
  S.recordDockLine('xia', { id: 3, who: 'player', text: '你还记得我吗' }, stream);
  S.recordDockLine('xia', { id: 4, who: 'character', text: '[emo: smile] 咦……这话该我问你才对呀。' }, stream);
  assert.equal(stream.entries().length, 4);
  // A new line that happens to say the same as an old one an hour ago is a new line.
  now += 3_600_000;
  S.recordDockLine('xia', { id: 9, who: 'player', text: '你还记得我吗' }, stream);
  assert.equal(stream.entries().length, 5);
});

test('a live line the history already brought (they raced) is that line, once; a second one is new', () => {
  const now = 2_000_000;
  const stream = S.createMessageStream({ now: () => now, storage: null });
  stream.scope('save');
  stream.hydrate([{ id: 'ask:e1', kind: 'you', who: 'writer', text: '搜索这个房间', at: now - 3000 }]);
  stream.record({ id: 'you:1', kind: 'you', who: 'writer', text: '搜索这个房间' });
  assert.equal(stream.entries().length, 1);
  stream.record({ id: 'you:1', kind: 'you', who: 'writer', text: '搜索这个房间' });
  assert.equal(stream.entries().length, 1);
  stream.record({ id: 'you:2', kind: 'you', who: 'writer', text: '搜索这个房间' });
  assert.equal(stream.entries().length, 2, 'the player really asked twice');
  // Ids the page shares with the server never need matching.
  stream.record({ id: 'loop:evt-5', kind: 'loop', text: '2', loop: 2, at: now });
  stream.hydrate([server({ id: 'loop:evt-5', kind: 'loop', text: '2', loop: 2, at: now - 10 })]);
  assert.equal(stream.entries().filter((e) => e.kind === 'loop').length, 1);
});

test('fingerprints: kind, speaker and words; emotion tags, spaces and punctuation do not count; a roll is result + what', () => {
  assert.equal(S.streamFingerprint({ kind: 'writer', text: 'x' }), null);
  assert.equal(S.streamFingerprint({ kind: 'loop', text: '2' }), null);
  assert.equal(
    S.streamFingerprint({ kind: 'character', who: 'kuri', text: '[emo: smile] 咦…… 这话。' }),
    S.streamFingerprint({ kind: 'character', who: 'kuri', text: '咦这话' }),
  );
  assert.notEqual(S.streamFingerprint({ kind: 'character', who: 'kuri', text: '好' }), S.streamFingerprint({ kind: 'character', who: 'sou', text: '好' }));
  assert.equal(S.streamFingerprint({ kind: 'you', name: '苍', text: '你好' }), 'you|苍|你好');
  assert.equal(S.streamFingerprint({ kind: 'dice', title: '侦查: 看门', text: '', score: '14 / <=60' }), S.streamFingerprint({ kind: 'dice', title: '侦查：看门', text: 'x', score: '14' }));
});

test('a loop reset is a line across the timeline; the next entry names its place again; the peek skips it', () => {
  const entries = [
    { id: 'a', kind: 'writer', text: 'x', at: 0, layer: 'world/hall' },
    { id: 'loop:evt-1', kind: 'loop', text: '2', loop: 2, at: 10 },
    { id: 'b', kind: 'writer', text: 'y', at: 20, layer: 'world/hall' },
  ];
  const rows = S.streamRows(entries);
  assert.deepEqual(rows.map((r) => r.type === 'entry' ? r.entry.id : r.type === 'loop' ? `↻${r.loop}` : `|${r.layer}`), ['|world/hall', 'a', '↻2', '|world/hall', 'b']);
  assert.equal(S.latestEntry([...entries, { id: 'loop:evt-2', kind: 'loop', text: '3', loop: 3, at: 99 }]).id, 'b');
});

test('a divider names the day once the history reaches past today', () => {
  const now = new Date(2026, 9, 15, 12, 0).getTime();
  assert.equal(S.stampOf(new Date(2026, 9, 15, 9, 5).getTime(), now), '09:05');
  assert.equal(S.stampOf(new Date(2026, 9, 13, 21, 40).getTime(), now), '10/13 21:40');
});

test('opening a save reads the newest page; scrolling up reads the page above; an answer for another save is dropped', async () => {
  const calls = [];
  const pages = {
    '': { ok: true, savePath: '/w/a', entries: [{ id: 'ask:2', kind: 'you', who: 'writer', text: 'two', at: 200 }, { id: 'bad', kind: 'nope', text: 'x', at: 1 }], more: true, next: '200:ask:2' },
    '200:ask:2': { ok: true, savePath: '/w/a', entries: [{ id: 'ask:1', kind: 'you', who: 'writer', text: 'one', at: 100 }], more: false, next: null },
  };
  const fetch = async (url) => {
    calls.push(url);
    const before = new URL(url, 'http://x').searchParams.get('before') ?? '';
    return { ok: true, json: async () => pages[before] };
  };
  const stream = S.createMessageStream({ now: () => 1000, storage: null, fetch });
  stream.scope('/w/a');
  assert.equal(stream.history().status, 'idle');
  await stream.loadLatest();
  assert.deepEqual(stream.entries().map((e) => e.id), ['ask:2'], 'a malformed entry is dropped');
  assert.deepEqual(stream.history(), { status: 'ready', more: true });
  await stream.loadOlder();
  assert.deepEqual(stream.entries().map((e) => e.id).sort(), ['ask:1', 'ask:2']);
  assert.equal(stream.history().more, false);
  await stream.loadOlder();
  assert.equal(calls.length, 2, 'nothing above: no request');
  assert.match(calls[0], /^\/api\/world\/stream\?limit=\d+$/);
  assert.match(calls[1], /before=200%3Aask%3A2/);
  // Reading the newest page again (a reopened save) does not forget how far up the drawer has read.
  await stream.loadLatest();
  assert.equal(stream.history().more, false);

  // The page switched saves while a page was on its way: the answer belongs to the old one.
  let release;
  const slow = S.createMessageStream({ now: () => 1, storage: null, fetch: () => new Promise((r) => { release = r; }) });
  slow.scope('/w/a');
  const pending = slow.loadLatest();
  slow.scope('/w/b');
  release({ ok: true, json: async () => pages[''] });
  await pending;
  assert.equal(slow.entries().length, 0);
  // The server answered for another save (the active world moved): dropped.
  const other = S.createMessageStream({ now: () => 1, storage: null, retryMs: 0, fetch: async () => ({ ok: true, json: async () => ({ ...pages[''], savePath: '/w/z' }) }) });
  other.scope('/w/a');
  await other.loadLatest();
  assert.equal(other.entries().length, 0);
  assert.equal(other.history().status, 'error');
  // Opening a save races the server switching to it: the newest page is read again until it answers for this save.
  let tries = 0;
  const racing = S.createMessageStream({ now: () => 1, storage: null, retryMs: 5, fetch: async () => {
    tries += 1;
    return tries < 3 ? { ok: false, json: async () => ({}) } : { ok: true, json: async () => pages[''] };
  } });
  racing.scope('/w/a');
  await racing.loadLatest();
  // The retries are timers (5 ms, then 10 ms); a loaded machine can fire them late, so wait for them rather than a fixed 60 ms.
  for (let waited = 0; tries < 3 && waited < 2000; waited += 20) await new Promise((r) => setTimeout(r, 20));
  assert.equal(tries, 3);
  assert.deepEqual(racing.entries().map((e) => e.id), ['ask:2']);
});

test('wiring: the save is read when it opens; the drawer reads older pages at its top and draws the loop line', () => {
  assert.match(app, /if \(streamScope && streamSettled\) void messageStream\.loadLatest\(\);/);
  assert.match(app, /onLoadOlder=\{\(\) => void messageStream\.loadOlder\(\)\}/);
  assert.match(app, /history=\{streamHistory\}/);
  assert.match(drawer, /if \(el\.scrollTop < OLDER_EDGE\) askOlder\(\);/);
  assert.match(drawer, /list\.scrollTop = anchor\.top \+ \(list\.scrollHeight - anchor\.height\);/);
  assert.match(drawer, /row\.type === 'loop' \? \(/);
  assert.match(drawer, /t\('Loop \{n\}', \{ n: row\.loop \}\)/);
  assert.match(drawerCss, /\.message-stream__loop \{/);
  // The ceremony's roll carries its card, like the history's.
  assert.match(app, /\.\.\.\(v\.path \? \{ chalkPath: v\.path \} : \{\}\),/);
});
