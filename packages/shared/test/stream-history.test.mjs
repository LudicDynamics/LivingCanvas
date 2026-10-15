// The message drawer's history: the pure builders the server and the page share — one world event
// to entries, chalks from the log, sessions, NPC cards, the tick log, and the merge + page cut.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  compareStreamItems,
  pageStreamItems,
  parseStreamCursor,
  parseTickState,
  streamChalksOfEvents,
  streamItemsOfCharacterSession,
  streamItemsOfEvent,
  streamItemsOfNpcCard,
  streamItemsOfTick,
  streamItemsOfWriterSession,
  streamItemsOfFastPathLog,
  streamRecapOfTalk,
  streamSeatedChalks,
  tickStreamKey,
  tickViewOf,
} from '../dist/index.js';

const T = Date.parse('2026-10-15T10:00:00.000Z');
const iso = (s) => new Date(T + s * 1000).toISOString();
const ev = (seq, type, detail, extra = {}) => ({ seq, id: `evt-${seq}`, type, actor: { type: 'writer' }, layer: 'world/hall', detail, createdAt: iso(seq), ...extra });

test('one world event → what the drawer shows: rolls, the player\'s choices, story lines, a person\'s own words, captions, endings, loops', () => {
  assert.deepEqual(streamItemsOfEvent(ev(1, 'roll_resolved', { path: 'world/hall/check-1.md', name: 'Look', dice: '1d100', desc: '侦查: 看门', expect: '<=60', result: 9, passed: true, outcome: 'crit_success' }, { actor: { type: 'player' } })), [
    { id: 'dice:evt-1', kind: 'dice', text: '侦查: 看门', title: '侦查: 看门', score: '9 / <=60', outcome: 'crit', at: T + 1000, layer: 'world/hall', chalkPath: 'world/hall/check-1.md' },
  ]);
  assert.equal(streamItemsOfEvent(ev(2, 'roll_resolved', { path: 'x', name: 'n', dice: '1d6', desc: '', expect: '', result: 1, passed: false, outcome: 'crit_fail' }))[0].outcome, 'fumble');
  // The player's choice is theirs; a writer resolving one is said in its chalk.
  assert.equal(streamItemsOfEvent(ev(3, 'choice_selected', { path: 'world/hall/a.md', name: 'A', choice: 'Go', index: 1 })).length, 0);
  assert.deepEqual(streamItemsOfEvent(ev(4, 'choice_selected', { path: 'world/hall/a.md', name: 'A', choice: 'Go', index: 1 }, { actor: { type: 'player' } })).map((e) => [e.kind, e.who, e.text, e.chalkPath]), [['you', 'writer', 'Go', 'world/hall/a.md']]);
  // A hint is the companion's nudge, not a story line.
  assert.equal(streamItemsOfEvent(ev(5, 'story_event', { target: 'characters/x', kind: 'character', name: 'X', title: 't', text: 'psst', hint: 'h' })).length, 0);
  assert.deepEqual(streamItemsOfEvent(ev(6, 'story_event', { target: 'world/hall/sou.md', kind: 'character', name: '苍', title: 'Morning', text: 'A knock.' })).map((e) => [e.id, e.kind, e.name, e.title, e.chalkPath]), [['event:evt-6', 'event', '苍', 'Morning', 'world/hall/sou.md']]);
  // A person's own beat is their words, attributed to them; a note is written, not said.
  const said = (claim) => streamItemsOfEvent(ev(7, 'story_event', { target: 'characters/xia', kind: 'character', name: '夏澄', title: '夏澄', text: '«…»', tick: { actor: 'xia', move: 'm', verb: 'speak', target: 'characters/xia', result: 'said', claim } }))[0];
  assert.deepEqual([said({ say: 'Nice night.' }).kind, said({ say: 'Nice night.' }).who, said({ say: 'Nice night.' }).text, said({ say: 'Nice night.' }).note], ['character', 'xia', 'Nice night.', undefined]);
  assert.equal(said({ note: 'Gone to the well.' }).note, true);
  // A move's outcome stays an event line.
  assert.equal(streamItemsOfEvent(ev(8, 'story_event', { target: 'characters/xia', kind: 'character', name: '夏澄', title: 'peeks', text: 'peeked', tick: { actor: 'xia', move: 'm', verb: 'mark', target: 'world/hall/a.md', result: 'landed' } }))[0].kind, 'event');
  assert.deepEqual(streamItemsOfEvent(ev(9, 'cg_shown', { path: 'assets/cg/a.webp', caption: 'Snow.', first: true })).map((e) => [e.id, e.text]), [['cg:evt-9', 'Snow.']]);
  assert.equal(streamItemsOfEvent(ev(10, 'cg_shown', { path: 'assets/cg/a.webp', first: true })).length, 0);
  assert.deepEqual(streamItemsOfEvent(ev(11, 'ending_reached', { ending: 'alone', title: '一个人下了山', path: 'endings/alone/README.md' })).map((e) => [e.kind, e.text, e.chalkPath]), [['event', '一个人下了山', undefined]]);
  assert.deepEqual(streamItemsOfEvent(ev(12, 'loop_reset', { loop: 2 })).map((e) => [e.id, e.kind, e.loop]), [['loop:evt-12', 'loop', 2]]);
  assert.equal(streamItemsOfEvent(ev(13, 'entity_moved', { from: 'a', to: 'b', name: 'n', rewrote: 0, dangling: 0 })).length, 0);
  assert.equal(streamItemsOfEvent({ ...ev(14, 'cg_shown', { caption: 'x' }), createdAt: 'not a time' }).length, 0);
});

test('chalks from the log: the standing one reads its file; earlier loops, deletes and reused paths keep their line; a character\'s page never', () => {
  const made = (seq, path, summary) => ev(seq, 'entity_created', { path, name: summary.slice(0, 4), kind: 'chalk', summary });
  const events = [
    made(1, 'world/hall/01-a.md', 'Loop one words.'),
    ev(2, 'loop_reset', { loop: 2 }),
    made(3, 'world/hall/01-a.md', 'Loop two words.'),
    made(4, 'world/hall/02-b.md', 'Gone soon.'),
    ev(5, 'entity_deleted', { path: 'world/hall/02-b.md', name: 'b' }),
    made(6, 'characters/xia/diary.md', 'Secret.'),
    made(7, 'world/hall/03-c.md', 'No longer a chalk.'),
  ];
  const files = { 'world/hall/01-a.md': { text: 'Loop two, grown.', title: 'A' }, 'world/hall/02-b.md': { text: 'still here?' }, 'characters/xia/diary.md': { text: 'Secret.' } };
  const items = streamChalksOfEvents(events, (p) => files[p] ?? null);
  assert.deepEqual(items.map((e) => [e.id, e.text, e.title ?? null, e.chalkPath ?? null]), [
    ['chalk:world/hall/01-a.md#1', 'Loop one words.', null, null],
    ['chalk:world/hall/01-a.md', 'Loop two, grown.', 'A', 'world/hall/01-a.md'],
    ['chalk:world/hall/02-b.md#4', 'Gone soon.', null, null],
    ['chalk:world/hall/03-c.md#7', 'No longer a chalk.', null, null],
  ]);
});

test('seated chalks: stamped just after the visit, in file order, unless the log already has them', () => {
  const items = streamSeatedChalks([{ layer: 'world/hall', at: T, chalks: [{ path: 'world/hall/search-x.md', text: 's' }, { path: 'world/hall/02-b.md', text: 'b' }, { path: 'world/hall/01-a.md', text: 'a' }, { path: 'world/hall/03-c.md', text: 'c' }] }], new Set(['world/hall/03-c.md']));
  assert.deepEqual(items.map((e) => [e.id, e.at - T]), [['chalk:world/hall/01-a.md', 1], ['chalk:world/hall/02-b.md', 2], ['chalk:world/hall/search-x.md', 3]]);
});

test('sessions: a character\'s talk (no thinking, no tools, no cue), the writer\'s requests only', () => {
  const m = (id, parentId, s, role, content) => JSON.stringify({ type: 'message', id, parentId, timestamp: iso(s), message: { role, content } });
  const chat = streamItemsOfCharacterSession('xia', [
    m('c1', null, 1, 'user', [{ type: 'text', text: '(Scene note, not something the player said: say hi.)' }]),
    m('c2', 'c1', 2, 'assistant', [{ type: 'thinking', thinking: 'THINK' }, { type: 'text', text: '[emo: smile] Hi.' }]),
    m('c3', 'c2', 5, 'user', [{ type: 'text', text: 'hey' }]),
    m('c4', 'c3', 6, 'assistant', [{ type: 'toolCall', id: 't', name: 'read', arguments: {} }]),
    m('c5', 'c4', 6, 'toolResult', [{ type: 'text', text: 'MEMORY' }]),
    m('c6', 'c5', 8, 'assistant', [{ type: 'text', text: 'Yes?' }]),
  ].join('\n'));
  assert.deepEqual(chat.items.map((e) => [e.id, e.kind, e.text, e.at - T]), [
    ['chat:xia:c1:reply', 'character', 'Hi.', 2000],
    ['chat:xia:c3', 'you', 'hey', 5000],
    ['chat:xia:c3:reply', 'character', 'Yes?', 8000],
  ]);
  assert.ok(chat.entryIds.has('c5'));
  const asks = streamItemsOfWriterSession([
    m('w1', null, 1, 'user', [{ type: 'text', text: '[Current Layer] world/hall\n[Player Request] 使用[铜钱](player/coin.md)。扔进去\n\nRead each referenced item at its exact path.' }]),
    m('w2', 'w1', 2, 'assistant', [{ type: 'text', text: 'REPLY' }]),
    m('w3', 'w2', 3, 'user', [{ type: 'text', text: '[Current Layer] world/hall\n[Quiet Beat] No player request this turn.' }]),
    m('w4', 'w3', 4, 'user', [{ type: 'text', text: 'brief\n\n[Current Layer] map\n[Author Request] add a well' }]),
  ].join('\n'));
  assert.deepEqual(asks.map((e) => [e.id, e.text, e.layer]), [['ask:w1', '使用[铜钱](player/coin.md)。扔进去', 'world/hall'], ['ask:w4', 'add a well', 'map']]);
});

test('fast-path log: only beats the fast path answered (on, route fast) say what the player asked; same parse as a session', () => {
  const rec = (o) => JSON.stringify({ at: iso(30), ...o });
  const asks = streamItemsOfFastPathLog([
    rec({ mode: 'on', route: 'fast', beat: 'x', reply: { chalk: { text: 'WRITER CHALK' } }, request: { id: 'fast:a', at: iso(10), message: '[Current Layer] world/hall\n[Player Request] 用[钥匙](player/key.md)开门\n\nRead each referenced item at its exact path.' } }),
    rec({ mode: 'on', route: 'agent', fallback: 'model HTTP 503', request: { id: 'fast:b', at: iso(11), message: '[Player Request] handed to the agent' } }),
    rec({ mode: 'shadow', route: 'fast', request: { id: 'fast:c', at: iso(12), message: '[Player Request] shadow' } }),
    rec({ mode: 'on', route: 'fast', request: { id: 'fast:d', at: iso(13), message: '[Current Layer] world/hall\n[Quiet Beat] No player request this turn.' } }),
    rec({ mode: 'on', route: 'fast', request: { id: 'fast:e', at: 'never', message: '[Player Request] no time' } }),
    rec({ mode: 'on', route: 'fast' }),
    'not json "request"',
    rec({ mode: 'on', route: 'fast', aborted: true, request: { id: 'fast:f', at: iso(20), message: '[Current Layer] map\n[Player Request] stop' } }),
  ].join('\n'));
  assert.deepEqual(asks.map((e) => [e.id, e.kind, e.who, e.text, e.layer, e.at - T]), [
    ['ask:fast:a', 'you', 'writer', '用[钥匙](player/key.md)开门', 'world/hall', 10000],
    ['ask:fast:f', 'you', 'writer', 'stop', 'map', 20000],
  ]);
});

test('a forgotten chat keeps its quoted lines; a chat still in its transcript is not repeated', () => {
  const talk = (through, quotes) => ev(9, 'character_talked', { character: 'xia', name: '夏澄', turns: 1, through, summary: { text: 'prose for the writer', notable_quotes: quotes } });
  assert.deepEqual(streamRecapOfTalk(talk('gone', ['我记得。']), () => false).map((e) => [e.kind, e.who, e.text, e.recap]), [['character', 'xia', '我记得。', true]]);
  assert.equal(streamRecapOfTalk(talk('here', ['x']), (c, id) => c === 'xia' && id === 'here').length, 0);
  assert.equal(streamRecapOfTalk(talk('gone', []), () => false).length, 0, 'the summary prose is the writer\'s');
});

test('NPC cards: the page\'s own ids; a row without a time is left out; only world cards', () => {
  const fm = { type: 'npc', name: '苍', dialogue: [{ by: 'player', text: ' 你好 ', at: iso(1) }, { by: 'npc', text: '「好。」', at: iso(2) }, { by: 'npc', text: 'no time' }] };
  assert.deepEqual(streamItemsOfNpcCard('world/hall/sou.md', fm, 'world/hall').map((e) => [e.id, e.kind, e.name, e.text]), [
    ['npc:world/hall/sou.md:0:你好', 'you', '苍', '你好'],
    ['npc:world/hall/sou.md:1:「好。」', 'character', '苍', '「好。」'],
  ]);
  assert.equal(streamItemsOfNpcCard('characters/x/sou.md', fm, null).length, 0);
  assert.equal(streamItemsOfNpcCard('world/hall/a.md', { type: 'note' }, null).length, 0);
});

test('the tick log keeps its time; the drawer key is id + time; chatter comes from its event, not the log', () => {
  const raw = { seed: 's', beat: 4, log: [
    { id: 'i1', actor: 'xia', move: 'peek', verb: 'mark', target: 'world/hall/a.md', page: 'world/hall', beat: 2, result: 'landed', words: { say: 'Just looking.' }, at: iso(3) },
    { id: 'i0', actor: 'xia', move: 'peek', verb: 'mark', target: 'world/hall/a.md', page: 'world/hall', beat: 1, result: 'landed', at: 'garbage' },
  ] };
  const state = parseTickState(raw, 's', ['xia']);
  assert.equal(state.log[0].at, iso(3));
  assert.equal(state.log[1].at, undefined);
  assert.equal(tickStreamKey(state.log[0]), `i1@${iso(3)}`);
  assert.equal(tickStreamKey({ id: 'i0' }), 'i0');
  const tick = { actors: { xia: { goal: 'g', moves: [], chatter: [] } } };
  assert.equal(tickViewOf(state, tick, 'standard', (a) => a).recent[0].at, iso(3));
  const items = streamItemsOfTick([
    { key: 'a', at: iso(3), actor: 'xia', name: '夏澄', page: 'world/hall', words: { say: 'Just looking.', note: { title: 'T', body: 'B' } }, chatter: false },
    { key: 'b', actor: 'xia', name: '夏澄', page: 'world/hall', words: { say: 'no time' }, chatter: false },
    { key: 'c', at: iso(4), actor: 'xia', name: '夏澄', page: 'world/hall', words: { say: 'chatter' }, chatter: true },
  ]);
  assert.deepEqual(items.map((e) => [e.id, e.text, e.note ?? false]), [['tick:a:say', 'Just looking.', false], ['tick:a:note', 'B', true]]);
});

test('merge and page: one entry per id, ordered by time then id, cut from the newest; cursors round-trip', () => {
  const at = (id, s) => ({ id, kind: 'you', text: id, at: T + s });
  const page = pageStreamItems([[at('b', 2), at('a', 2), at('c', 1)], [at('a', 9), at('d', 3), { ...at('e', 4), text: '  ' }]], { limit: 2 });
  assert.deepEqual(page.entries.map((e) => e.id), ['b', 'd']);
  assert.equal(page.more, true);
  assert.equal(page.next, `${T + 2}:b`);
  const above = pageStreamItems([[at('b', 2), at('a', 2), at('c', 1), at('d', 3)]], { before: page.next, limit: 2 });
  assert.deepEqual(above.entries.map((e) => e.id), ['c', 'a']);
  assert.equal(above.more, false);
  assert.equal(above.next, null);
  assert.deepEqual(parseStreamCursor('12:chat:x:y'), { at: 12, id: 'chat:x:y' });
  assert.equal(parseStreamCursor('nope'), null);
  assert.equal(parseStreamCursor(':x'), null);
  assert.ok(compareStreamItems(at('a', 1), at('b', 1)) < 0);
  assert.equal(pageStreamItems([[at('a', 1)]], { limit: 99999 }).entries.length, 1);
});
