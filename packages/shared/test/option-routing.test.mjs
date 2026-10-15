// Option routing and companion hints: who an option is said to, the opening
// replies' object form, the hint table and its per-beat pick, the beat through runTurnEnd, and the fence that
// keeps hints.json from the characters.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  addresseeOf,
  buildInteractiveFields,
  characterViewOf,
  createActionService,
  LocalWorldStore,
  openingRepliesFor,
  openingReplyItemsFor,
  parseFrontmatter,
  parseHintLog,
  parseHintTable,
  planHint,
  renderEvent,
  runTurnEnd,
} from '../dist/index.js';

const opt = (fm, id) => buildInteractiveFields(fm).choice.options.find((o) => o.id === id);

test('addresseeOf: the verb decides — moves go to the writer, kind: character to that character', () => {
  const fm = {
    choice: {
      options: [
        { id: 'ask', label: '用骰子问问20号的学生' },
        { id: 'talk', label: '告诉夏澄' },
        { id: 'who', label: '苏禾是谁？', to: 'xia-cheng', say: '苏禾是谁？你认识她吗？' },
        { id: 'go', label: '去5车' },
        { id: 'bare', label: '想一想' },
        { id: 'pal', label: '你先看看？', to: 'companion' },
        { id: 'w', label: '和夏澄商量', to: 'writer' },
      ],
    },
    choice_actions: {
      ask: { kind: 'search', spot: 'scene' },
      talk: { kind: 'character', character: 'xia-cheng' },
      go: { kind: 'enter', target: 'world/freight-car' },
      w: { kind: 'character', character: 'xia-cheng' },
    },
  };
  assert.deepEqual(addresseeOf(fm, opt(fm, 'ask')), { to: 'writer', say: null });
  assert.deepEqual(addresseeOf(fm, opt(fm, 'talk')), { to: 'xia-cheng', say: '告诉夏澄' });
  assert.deepEqual(addresseeOf(fm, opt(fm, 'who')), { to: 'xia-cheng', say: '苏禾是谁？你认识她吗？' });
  assert.deepEqual(addresseeOf(fm, opt(fm, 'go')), { to: 'writer', say: null });
  assert.deepEqual(addresseeOf(fm, opt(fm, 'bare')), { to: 'writer', say: null }, 'nothing declared → the writer, as before');
  assert.deepEqual(addresseeOf(fm, opt(fm, 'pal')), { to: 'companion', say: '你先看看？' });
  assert.deepEqual(addresseeOf(fm, opt(fm, 'w')), { to: 'writer', say: null }, 'an explicit to beats the inference');
  assert.deepEqual(addresseeOf({ roll_dice: { expect: '>=11' } }, { label: 'x' }), { to: 'writer', say: null });
});

test('choice options keep to / say / for; a malformed one is dropped, never the widget', () => {
  const errors = [];
  const fm = { choice: { options: [{ id: 'a', label: 'A', to: 'Bad Id' }, { id: 'b', label: 'B', for: 'from-prologue' }, { id: 'c', label: 'C', for: 'everyone' }] } };
  const choice = buildInteractiveFields(fm, errors).choice;
  assert.equal(choice.options.length, 3);
  assert.equal(choice.options[0].to, undefined);
  assert.equal(choice.options[1].for, 'from-prologue');
  assert.equal(choice.options[2].for, undefined);
  assert.equal(errors.length, 2);
});

test('opening.replies: strings go to the greeter, { text, to } keeps its address', () => {
  const replies = ['我睡着了', { text: '先看看17号座', to: 'writer' }, { text: '你好' }];
  assert.deepEqual(openingReplyItemsFor(replies, 'zh-CN', 'zh-CN', 'xia-cheng'), [
    { text: '我睡着了', to: 'xia-cheng' },
    { text: '先看看17号座', to: 'writer' },
    { text: '你好', to: 'xia-cheng' },
  ]);
  assert.deepEqual(openingRepliesFor(replies, 'zh-CN', 'zh-CN'), ['我睡着了', '你好'], 'the dock shows only the lines said to someone');
  assert.deepEqual(openingRepliesFor({ en: [{ text: 'Hi', to: 'writer' }] }, 'en'), []);
});

const TABLE = {
  by: 'xia-cheng',
  gap: 2,
  hints: [
    { id: 'nb', when: { layer: 'world/seated-car', lacks: ['player/nb.md'], idle: 1 }, say: '笔记本还摊着……', suggest: [{ card: 'world/seated-car/nb.md', option: 'take' }], priority: 80 },
    { id: 'late', when: { expr: 'clock.left <= 3' }, say: '快三点半了。', priority: 90 },
    { id: 'b1', group: 'bill', level: 1, when: { layer: 'world/dining-car', idle: 1 }, say: '4号桌还没收拾。' },
    { id: 'b2', group: 'bill', level: 2, when: { layer: 'world/dining-car', idle: 3 }, say: '小票上记的是谁？' },
    { id: 'fresh', when: { layer: 'map', unvisited: 'world/sleeper' }, say: '卧铺、餐车都能去。', by: 'writer' },
  ],
};

test('parseHintTable: valid tables parse; duplicates, bad ids and lone levels do not', () => {
  assert.deepEqual(parseHintTable(TABLE).errors, []);
  assert.ok(parseHintTable({ hints: [{ id: 'a', say: 'x' }, { id: 'a', say: 'y' }] }).errors.some((e) => /duplicate/.test(e)));
  assert.ok(parseHintTable({ hints: [{ id: 'A b', say: 'x' }] }).errors.length);
  assert.ok(parseHintTable({ hints: [{ id: 'a', say: 'x', level: 2 }] }).errors.some((e) => /group and level/.test(e)));
  assert.ok(parseHintTable('{not json').errors.length);
});

const state = (page, values = {}, paths = {}) => ({
  page,
  values: new Map(Object.entries(values)),
  paths: new Map(Object.entries(paths)),
  characterIds: ['xia-cheng'],
});

test('planHint: idle, gap, priority, once and escalation, one beat at a time', () => {
  const { table } = parseHintTable(TABLE);
  let log = parseHintLog(null);
  const step = (s, opts) => { const p = planHint(table, s, log, opts); log = p.log; return p; };
  const car = state('world/seated-car', { 'clock.left': 8 }, { 'player/nb.md': 'missing' });
  assert.equal(step(car).hint, null, 'beat 1: the notebook condition just started holding (idle 1)');
  const said = step(car);
  assert.equal(said.hint?.id, 'nb', 'beat 2: held for one beat → said');
  assert.equal(said.by, 'xia-cheng');
  assert.equal(step(car).hint, null, 'once: never again');
  // The dining car: level 1 after a beat, level 2 only after level 1 and three idle beats, and the gap holds.
  const dining = state('world/dining-car', { 'clock.left': 8 });
  assert.equal(step(dining).hint, null);
  assert.equal(step(dining).hint?.id, 'b1');
  assert.equal(step(dining).hint, null, 'gap 2');
  assert.equal(step(dining).hint?.id, 'b2', 'level 2 after level 1, three beats in');
  // Priority: the late warning beats anything else once it holds; `stuck` ignores the gap.
  const late = state('world/dining-car', { 'clock.left': 3 });
  assert.equal(step(late, { stuck: true, count: false }).hint?.id, 'late');
  assert.equal(log.seen.includes('world/seated-car') && log.seen.includes('world/dining-car'), true, 'pages seen this run');
});

test('planHint: visited / unvisited read the pages seen; a hint names its own speaker', () => {
  const { table } = parseHintTable(TABLE);
  const first = planHint(table, state('map', { 'clock.left': 8 }), parseHintLog(null));
  assert.equal(first.hint?.id, 'fresh');
  assert.equal(first.by, 'writer');
  const later = planHint(table, state('map', { 'clock.left': 8 }), parseHintLog({ beat: 5, used: {}, since: {}, seen: ['world/sleeper'] }));
  assert.equal(later.hint, null, 'been to the sleeper: the overview line is moot');
});

test('hints.json is the writer\'s: a character never reads it', () => {
  assert.equal(characterViewOf('hints.json', 'xia-cheng').kind, 'withheld');
  assert.equal(characterViewOf('world/hints.json', 'xia-cheng').kind, 'full', 'only the root table is fenced');
});

test('a hint story event reads as a line said, to the speaker and to everyone else', () => {
  const ev = { type: 'story_event', actor: { type: 'player' }, detail: { target: 'characters/xia-cheng', kind: 'character', name: '夏澄', title: '夏澄', text: '你先看看？', hint: 'nb' } };
  assert.match(renderEvent(ev, { layerNames: {} }), /夏澄 said to the player: "你先看看？"/);
  const note = { type: 'story_event', actor: { type: 'player' }, detail: { target: 'world/seated-car', kind: 'place', name: '2车', title: 'Margin note', text: '看看名单。', hint: 'x' } };
  assert.match(renderEvent(note, { layerNames: {} }), /margin/);
});

async function scratchWorld(hints) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hints-'));
  const write = async (rel, text) => { await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true }); await fs.writeFile(path.join(root, rel), text); };
  await write('world.json', JSON.stringify({
    id: 'hint-world', name: 'Hint world', version: '1.0.0', schema: 1, locale: 'en', mode: 'closed',
    description: 'A test world.', author: 'test', genre: 'test', player: { id: 'player', name: 'You' }, createdAt: '2026-10-11T00:00:00Z', updatedAt: '2026-10-11T00:00:00Z',
    characters: [{ id: 'pal', name: 'Pal', home: 'map', role: 'companion' }],
    endings: [{ id: 'done', title: 'Done', path: 'endings/done/README.md' }],
    entry: 'map',
  }));
  await write('world/README.md', '---\ntype: readme\ntitle: Here\n---\n\nA room.\n');
  await write('world/box.md', '---\ntype: note\ntitle: Box\nportable: true\n---\n\nA box.\n');
  await write('endings/done/README.md', '---\ntype: ending\ntitle: Done\n---\n\nThe end.\n');
  await write('characters/pal/README.md', '---\nname: Pal\n---\n\nPal.\n');
  if (hints) await write('hints.json', JSON.stringify(hints));
  return { root, store: new LocalWorldStore(root) };
}

test('runTurnEnd: a world with hints.json says one line per due beat, logs it, and records it for the speaker', async () => {
  const { store } = await scratchWorld({ by: 'pal', gap: 0, hints: [{ id: 'box', when: { lacks: ['player/box.md'], idle: 1 }, say: 'Open the box?', replies: ['What box?'] }] });
  let n = 0;
  const beat = () => runTurnEnd(createActionService(store, { type: 'player' }, { turn: `req:h-${++n}` }).ctx, { tick: { page: 'map' } });
  assert.equal((await beat()).details.hint, null, 'not yet idle');
  const second = (await beat()).details.hint;
  assert.equal(second?.id, 'box');
  assert.equal(second.by, 'pal', 'the companion is home on this page');
  assert.deepEqual(second.replies, ['What box?']);
  const log = parseFrontmatter(await store.readFile('world/README.md')).frontmatter.hint_log;
  assert.equal(log.beat, 2);
  assert.equal(log.used.box, 2);
  const events = (await store.getEventsSince(0)).filter((e) => e.type === 'story_event');
  assert.equal(events.length, 1);
  assert.equal(events[0].detail.hint, 'box');
  assert.equal(events[0].detail.target, 'characters/pal');
  assert.equal((await beat()).details.hint, null, 'once');
});

test('runTurnEnd: a speaker not on the page becomes the writer\'s margin note; no table, no hint', async () => {
  const { store } = await scratchWorld({ by: 'pal', gap: 0, hints: [{ id: 'away', say: 'Psst.' }] });
  await fs.mkdir(path.join(store.worldRoot, 'world/cellar'), { recursive: true });
  await fs.writeFile(path.join(store.worldRoot, 'world/cellar/README.md'), '---\ntype: gate\ntitle: Cellar\n---\n\nDark.\n');
  const ctx = createActionService(store, { type: 'player' }, { turn: 'req:away' }).ctx;
  const hint = (await runTurnEnd(ctx, { tick: { page: 'world/cellar' } })).details.hint;
  assert.equal(hint?.by, 'writer');
  const plain = await scratchWorld(null);
  const none = await runTurnEnd(createActionService(plain.store, { type: 'player' }, { turn: 'req:none' }).ctx, { tick: { page: 'map' } });
  assert.equal(none.details.hint, null);
  assert.equal((await plain.store.getEventsSince(0)).filter((e) => e.type === 'story_event').length, 0);
});
