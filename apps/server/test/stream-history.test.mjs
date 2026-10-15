// GET /api/world/stream: the message drawer's history, rebuilt from what the save keeps — the
// event log, the chalk files, the sessions, NPC cards and the tick log — in time order, paged, in the player's view.
// Runs against built dist: `pnpm --filter @airp/server build` first.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { test } from 'node:test';
import { LocalWorldStore } from '@airp/shared';
import { createStreamRouter } from '../dist/routes/stream.js';

const T0 = Date.parse('2026-10-15T10:00:00.000Z');
const iso = (s) => new Date(T0 + s * 1000).toISOString();
const HALL = 'world/hall';

/** Append an event and pin its time (`created_at` is the store's clock otherwise). */
async function event(store, s, args) {
  const ev = await store.appendEvent(args);
  store.historyDb.prepare('UPDATE events SET created_at = ? WHERE id = ?').run(iso(s), ev.id);
  return ev;
}

const line = (o) => JSON.stringify(o);
const msg = (id, parentId, s, role, content) => line({ type: 'message', id, parentId, timestamp: iso(s), message: { role, content } });

async function harness() {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-stream-'));
  const root = path.join(repo, 'save');
  const store = new LocalWorldStore(root);
  await store.writeFile('world.json', JSON.stringify({ id: 'st', name: 'ST', description: '', author: '', genre: 'test', createdAt: '', updatedAt: '', characters: [] }));
  await store.writeFile('world/README.md', '---\nname: Map\ntype: readme\n---\n');
  await store.writeFile(`${HALL}/README.md`, '---\nname: Hall\ntype: readme\n---\n');
  // A chalk the template seated on the page (no event made it).
  await store.writeFile(`${HALL}/01-opening.md`, '---\ntype: chalk\ntitle: Arrival\n---\nThe hall is cold.\n');
  // A chalk the writer made this loop; the file has grown since and carries an authoring comment.
  await store.writeFile(`${HALL}/02-chalk.md`, '---\ntype: chalk\n---\nThe lamp flickers.\n<!-- resolved-dice: 14 -->\nThen it holds.\n');
  // A character's own page: never in the player's drawer.
  await store.writeFile('characters/xia/README.md', '---\nname: 夏澄\n---\n');
  await store.writeFile('characters/xia/diary.md', '---\ntype: chalk\n---\nSecret diary.\n');
  // An NPC card with its recorded exchange.
  await store.writeFile(`${HALL}/sou.md`, [
    '---', 'type: npc', 'name: 苍', 'persona: A peddler.', 'dialogue:',
    `  - { by: player, text: "你好", at: "${iso(55)}" }`,
    `  - { by: npc, text: "「客官好。」", at: "${iso(56)}" }`,
    '  - { by: player, text: "no time" }',
    '---', '',
  ].join('\n'));

  // ── the event log ──
  const oldChalk = await event(store, 2, { type: 'entity_created', actor: { type: 'writer' }, layer: HALL, detail: { path: `${HALL}/02-chalk.md`, name: 'Old words', kind: 'chalk', summary: 'An earlier loop said this.' } });
  const talk = await event(store, 3, { type: 'character_talked', actor: { type: 'player' }, detail: { character: 'xia', name: '夏澄', turns: 1, through: 'gone-entry', summary: { text: 'They talked.', clues_learned: [], promises_made: [], relationship_change: '', player_intent: '', notable_quotes: ['我记得那盏灯。'], important: false } } });
  const loop = await event(store, 4, { type: 'loop_reset', actor: { type: 'engine' }, detail: { loop: 2, kept: { notes: 0, links: 0, states: [], files: [] }, dropped: [], stages: [] } });
  await event(store, 4.5, { type: 'layer_entered', actor: { type: 'player' }, layer: HALL, detail: { layer: HALL, name: 'Hall', first: true } });
  await event(store, 10, { type: 'entity_created', actor: { type: 'writer' }, layer: HALL, detail: { path: `${HALL}/02-chalk.md`, name: 'The lamp', kind: 'chalk', summary: 'The lamp flickers.' } });
  await event(store, 11, { type: 'entity_created', actor: { type: 'character', id: 'xia' }, detail: { path: 'characters/xia/diary.md', name: 'Diary', kind: 'chalk' } });
  await event(store, 35, { type: 'character_talked', actor: { type: 'player' }, detail: { character: 'xia', name: '夏澄', turns: 1, through: 'c5', summary: { text: 'Hi.', clues_learned: [], promises_made: [], relationship_change: '', player_intent: '', notable_quotes: ['Should not repeat.'], important: false } } });
  const roll = await event(store, 40, { type: 'roll_resolved', actor: { type: 'player' }, layer: HALL, detail: { path: `${HALL}/check-1.md`, name: 'Look', dice: '1d100', desc: '侦查: 看门', expect: '<=60', result: 14, passed: true, outcome: 'success' } });
  await event(store, 44, { type: 'story_event', actor: { type: 'engine' }, layer: HALL, detail: { target: 'characters/xia', kind: 'character', name: '夏澄', title: 'hint', text: 'Psst, the door.', hint: 'door' } });
  const story = await event(store, 45, { type: 'story_event', actor: { type: 'writer' }, layer: HALL, detail: { target: `${HALL}/sou.md`, kind: 'character', name: '苍', title: 'Morning', text: 'A knock at the door.' } });
  const chatter = await event(store, 46, { type: 'story_event', actor: { type: 'engine' }, layer: HALL, detail: { target: 'characters/xia', kind: 'character', name: '夏澄', title: '夏澄', text: '«Nice night.»', tick: { actor: 'xia', move: 'hello', verb: 'speak', target: 'characters/xia', result: 'said', claim: { say: 'Nice night.' } } } });
  await event(store, 49, { type: 'choice_selected', actor: { type: 'writer' }, layer: HALL, detail: { path: `${HALL}/02-chalk.md`, name: 'The lamp', choice: 'writer resolved this', index: 1 } });
  const choice = await event(store, 50, { type: 'choice_selected', actor: { type: 'player' }, layer: HALL, detail: { path: `${HALL}/02-chalk.md`, name: 'The lamp', choice: 'Blow it out', index: 2 } });
  const cg = await event(store, 60, { type: 'cg_shown', actor: { type: 'writer' }, layer: HALL, detail: { path: 'assets/cg/a.webp', caption: 'Snow begins.', first: true } });

  // ── the sessions ──
  const sessions = path.join(root, '.airpworld', 'sessions');
  await fs.mkdir(sessions, { recursive: true });
  await fs.writeFile(path.join(sessions, '2026-10-15T10-00-00-000Z_w1.jsonl'), [
    line({ type: 'session', version: 3, id: 'w1', timestamp: iso(0) }),
    msg('w-u1', null, 5, 'user', [{ type: 'text', text: `[Current Layer] ${HALL}\n[Player Request] open the door\n\nRead each referenced item at its exact path and read the full current scene README.` }]),
    msg('w-a1', 'w-u1', 6, 'assistant', [{ type: 'thinking', thinking: 'WRITER THINKING' }, { type: 'toolCall', id: 't1', name: 'chalk', arguments: { body: 'x' } }]),
    msg('w-t1', 'w-a1', 6, 'toolResult', [{ type: 'text', text: 'WRITER TOOL RESULT' }]),
    msg('w-a2', 'w-t1', 7, 'assistant', [{ type: 'text', text: 'WRITER REPLY TEXT' }]),
    msg('w-u2', 'w-a2', 12, 'user', [{ type: 'text', text: '[Player Event] The player rolled the search "world/hall/search-1.md": 9.' }]),
    msg('w-u3', 'w-u2', 13, 'user', [{ type: 'text', text: '[NPC Dialogue] The player is talking to the NPC card "world/hall/sou.md" — 苍.' }]),
    'not json',
  ].join('\n'));
  await fs.writeFile(path.join(sessions, '2026-10-14T09-00-00-000Z_w0.loop-1.done'), [
    msg('w0-u1', null, -100, 'user', [{ type: 'text', text: `[Current Layer] ${HALL}\n[Player Request] before the loop` }]),
  ].join('\n'));
  await fs.writeFile(path.join(sessions, 'char-xia.jsonl'), [
    line({ type: 'session', version: 3, id: 'cx', timestamp: iso(19) }),
    msg('c1', null, 20, 'user', [{ type: 'text', text: '（场景提示，不是玩家说的话：玩家刚到。请你先开口。）' }]),
    msg('c2', 'c1', 21, 'assistant', [{ type: 'thinking', thinking: 'CHARACTER THINKING' }, { type: 'text', text: '[emo: smile] Hello there.' }, { type: 'toolCall', id: 't', name: 'read', arguments: {} }]),
    msg('c3', 'c2', 21, 'toolResult', [{ type: 'text', text: 'CHARACTER MEMORY FILE' }]),
    msg('c4', 'c3', 30, 'user', [{ type: 'text', text: 'who are you' }]),
    msg('c5', 'c4', 32, 'assistant', [{ type: 'text', text: "I'm Xia." }]),
  ].join('\n'));

  const app = express();
  let active = store;
  app.use('/api', createStreamRouter(() => active));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const get = async (q = '') => {
    const r = await fetch(`${base}/world/stream${q}`);
    return { status: r.status, body: await r.json() };
  };
  return {
    root, store, get, ids: { oldChalk, talk, loop, roll, story, chatter, choice, cg },
    detach: () => { active = null; },
    close: async () => {
      server.close();
      try { store.close(); } catch {}
      await fs.rm(repo, { recursive: true, force: true });
    },
  };
}

test('every source merges into one timeline, oldest first, with the page\'s own ids', async () => {
  const h = await harness();
  try {
    const { status, body } = await h.get();
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.savePath, h.root);
    assert.equal(body.more, false);
    assert.equal(body.next, null);
    const { oldChalk, talk, loop, roll, story, chatter, choice, cg } = h.ids;
    assert.deepEqual(body.entries.map((e) => e.id), [
      'ask:w0-u1', // a retired loop's writer session still says what the player asked
      `chalk:${HALL}/02-chalk.md#${oldChalk.seq}`, // an earlier loop's chalk on a path used again
      `talk:${talk.id}`, // the forgotten chat's kept lines
      `loop:${loop.id}`,
      `chalk:${HALL}/01-opening.md`, // seated: stamped just after the player walked in this loop
      'ask:w-u1',
      `chalk:${HALL}/02-chalk.md`,
      'chat:xia:c1:reply', // a greeting answering a scene cue (the cue itself is the engine's)
      'chat:xia:c4',
      'chat:xia:c4:reply',
      `dice:${roll.id}`,
      `event:${story.id}`,
      `event:${chatter.id}`,
      `choice:${choice.id}`,
      `npc:${HALL}/sou.md:0:你好`,
      `npc:${HALL}/sou.md:1:「客官好。」`,
      `cg:${cg.id}`,
    ]);
    const by = Object.fromEntries(body.entries.map((e) => [e.id, e]));
    assert.deepEqual(by['ask:w-u1'], { id: 'ask:w-u1', kind: 'you', who: 'writer', text: 'open the door', at: T0 + 5000, layer: HALL });
    assert.equal(by[`chalk:${HALL}/02-chalk.md`].text, 'The lamp flickers.\n\nThen it holds.');
    assert.equal(by[`chalk:${HALL}/02-chalk.md`].chalkPath, `${HALL}/02-chalk.md`);
    assert.equal(by[`chalk:${HALL}/01-opening.md`].title, 'Arrival');
    assert.equal(by[`chalk:${HALL}/02-chalk.md#${oldChalk.seq}`].text, 'An earlier loop said this.');
    assert.equal(by[`loop:${loop.id}`].loop, 2);
    assert.deepEqual(by['chat:xia:c1:reply'], { id: 'chat:xia:c1:reply', kind: 'character', who: 'xia', text: 'Hello there.', at: T0 + 21000 });
    assert.equal(by['chat:xia:c4'].text, 'who are you');
    assert.equal(by[`dice:${roll.id}`].score, '14 / <=60');
    assert.equal(by[`dice:${roll.id}`].outcome, 'pass');
    assert.equal(by[`dice:${roll.id}`].chalkPath, `${HALL}/check-1.md`);
    assert.deepEqual(by[`event:${chatter.id}`], { id: `event:${chatter.id}`, kind: 'character', who: 'xia', text: 'Nice night.', at: T0 + 46000, layer: HALL, name: '夏澄' });
    assert.equal(by[`choice:${choice.id}`].text, 'Blow it out');
    assert.equal(by[`npc:${HALL}/sou.md:1:「客官好。」`].kind, 'character');
    assert.equal(by[`npc:${HALL}/sou.md:1:「客官好。」`].name, '苍');
    const recap = body.entries.find((e) => e.id.startsWith('talk:'));
    assert.equal(recap.text, '我记得那盏灯。');
    assert.equal(recap.recap, true);
    // Times only ever go up.
    for (let i = 1; i < body.entries.length; i += 1) assert.ok(body.entries[i].at >= body.entries[i - 1].at);
  } finally {
    await h.close();
  }
});

test('the player\'s view: no writer reply, thinking or tool call, no character thinking or memory, no hint, no private page', async () => {
  const h = await harness();
  try {
    const { body } = await h.get();
    const all = JSON.stringify(body);
    for (const secret of ['WRITER THINKING', 'WRITER TOOL RESULT', 'WRITER REPLY TEXT', 'CHARACTER THINKING', 'CHARACTER MEMORY FILE', 'Secret diary', 'Psst, the door', '场景提示', 'Player Event', 'NPC Dialogue', 'writer resolved this', 'Read each referenced item', 'resolved-dice', 'no time', 'Should not repeat']) {
      assert.ok(!all.includes(secret), `leaked: ${secret}`);
    }
    assert.ok(!body.entries.some((e) => (e.chalkPath ?? '').startsWith('characters/')));
  } finally {
    await h.close();
  }
});

test('pages: the newest first, `before` reads the page above without repeating or skipping; bad input is refused', async () => {
  const h = await harness();
  try {
    const whole = (await h.get()).body.entries.map((e) => e.id);
    const seen = [];
    let before = '';
    let rounds = 0;
    for (;;) {
      const { body } = await h.get(`?limit=4${before ? `&before=${encodeURIComponent(before)}` : ''}`);
      assert.ok(body.entries.length <= 4);
      seen.unshift(...body.entries.map((e) => e.id));
      rounds += 1;
      if (!body.more) { assert.equal(body.next, null); break; }
      assert.equal(body.next, `${body.entries[0].at}:${body.entries[0].id}`);
      before = body.next;
    }
    assert.equal(rounds, Math.ceil(whole.length / 4));
    assert.deepEqual(seen, whole);
    assert.equal((await h.get('?limit=0')).status, 400);
    assert.equal((await h.get('?limit=abc')).status, 400);
    // A cursor that names nothing still cuts by time.
    const cut = (await h.get(`?before=${encodeURIComponent(`${T0 + 30000}:zzz`)}`)).body.entries;
    assert.ok(cut.length > 0 && cut.every((e) => e.at <= T0 + 30000));
    h.detach();
    const none = await h.get();
    assert.equal(none.status, 409);
    assert.equal(none.body.code, 'no_active_world');
  } finally {
    await h.close();
  }
});

test('a chat still in its transcript is not repeated from its summary; words said with an intent come from the tick log', async () => {
  const h = await harness();
  try {
    // The tick log: a landed intent with words (stamped), one without a time (an older save), a chatter beat (its
    // words are its story event, already in the timeline).
    await h.store.writeFile('world.json', JSON.stringify({
      id: 'st', name: 'ST', description: '', author: '', genre: 'test', createdAt: '', updatedAt: '',
      characters: [],
      tick: { actors: { xia: { goal: 'Look around.', moves: [{ id: 'peek', verb: 'mark', target: `${HALL}/02-chalk.md`, run: 'peek-run', label: { intent: 'peeks', landed: 'peeked', stopped: 'stopped' }, counter: ['guard'] }] } } },
    }));
    const log = [
      { id: 'i1', actor: 'xia', move: 'peek', verb: 'mark', target: `${HALL}/02-chalk.md`, page: HALL, beat: 2, result: 'landed', words: { say: 'Just looking.' }, at: iso(47) },
      { id: 'i0', actor: 'xia', move: 'peek', verb: 'mark', target: `${HALL}/02-chalk.md`, page: HALL, beat: 1, result: 'landed', words: { say: 'No time on me.' } },
      { id: '3:xia/hello', actor: 'xia', move: 'hello', verb: 'speak', target: 'characters/xia', page: HALL, beat: 3, result: 'said', words: { say: 'Nice night.' }, at: iso(46) },
    ];
    await h.store.writeFile('world/README.md', `---\nname: Map\ntype: readme\ntick:\n  seed: s\n  beat: 3\n  log: ${JSON.stringify(log)}\n---\n`);
    const { body } = await h.get();
    const ticks = body.entries.filter((e) => e.id.startsWith('tick:'));
    assert.deepEqual(ticks.map((e) => [e.id, e.text]), [[`tick:i1@${iso(47)}:say`, 'Just looking.']]);
    assert.equal(body.entries.filter((e) => e.text === 'Nice night.').length, 1, 'a chatter beat once, from its story event');
    assert.equal(body.entries.filter((e) => e.recap).length, 1, 'only the chat the transcript lost');
  } finally {
    await h.close();
  }
});

test('a beat the writer\'s fast path answered: its request comes from the fast-path log, once, at its time; a fallback or a shadow run is the session\'s', async () => {
  const h = await harness();
  try {
    const rec = (s, o) => JSON.stringify({ at: iso(s + 2), ...o });
    await fs.writeFile(path.join(h.root, '.airpworld', 'fast-path.log'), [
      // Answered on the fast path: only here.
      rec(8, { mode: 'on', route: 'fast', beat: '[Current Layer] world/hall…', reply: { chalk: { text: 'FAST CHALK TEXT' }, why: 'FAST WHY' }, raw: 'FAST RAW', request: { id: 'fast:one', at: iso(8), message: `[Current Layer] ${HALL}\n[Player Request] light the lamp\n\nRead each referenced item at its exact path and read the full current scene README.` } }),
      // Handed to the agent (its session holds `open the door`): nothing here.
      rec(5, { mode: 'on', route: 'agent', fallback: 'model HTTP 503', beat: `[Current Layer] ${HALL}\n[Player Request] open the door` }),
      // Shadow: the agent answered it.
      rec(5, { mode: 'shadow', layer: HALL, beat: `[Current Layer] ${HALL}\n[Player Request] open the door`, reply: { chalk: { text: 'SHADOW CHALK' } } }),
    ].join('\n'));
    const { body } = await h.get();
    const asks = body.entries.filter((e) => e.id.startsWith('ask:'));
    assert.deepEqual(asks.map((e) => [e.id, e.text, e.at - T0]), [
      ['ask:w0-u1', 'before the loop', -100000],
      ['ask:w-u1', 'open the door', 5000],
      ['ask:fast:one', 'light the lamp', 8000],
    ]);
    assert.deepEqual(asks[2], { id: 'ask:fast:one', kind: 'you', who: 'writer', text: 'light the lamp', at: T0 + 8000, layer: HALL });
    const all = JSON.stringify(body);
    for (const secret of ['FAST CHALK TEXT', 'FAST WHY', 'FAST RAW', 'SHADOW CHALK', 'Read each referenced item']) assert.ok(!all.includes(secret), `leaked: ${secret}`);
  } finally {
    await h.close();
  }
});
