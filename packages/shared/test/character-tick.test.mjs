/**
 * Character tick: the pure beat rules, and the
 * engine over a small real world (files, events, commands, triggers).
 *
 * Pure: legal-move filtering (max, caps, guarded), seeded rotation and draw
 * (same seed + history → same choice; no one skipped), the one-beat counter
 * window and its `seen` start, the four counters, leaving the page, budget /
 * landCap / grace / every, easy mode.
 *
 * Engine: target must be on the player's page, `if` / `unless`, a landed move
 * runs its command as the engine and records a story event, a stopped one
 * records the stop, talk counts from the NPC card's dialogue, nothing after an
 * ending, `page_moves` and the NPC brief lines, the reserved `tick` key.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  LocalWorldStore,
  createActionService,
  parseWorldTick,
  tickForMode,
  freshTickState,
  parseTickState,
  stepTickBeat,
  chooseTickIntent,
  tickActorOrder,
  markTickSeen,
  tickMoveAllowed,
  pageOfTickTarget,
  isDoorTarget,
  runTickBeat,
  markTickIntentSeen,
  readTickView,
  tickPageMoves,
  tickNotesForNpc,
  readTickState,
  loadTickWorld,
  buildNpcBrief,
  RESERVED_FRONTMATTER_KEYS,
  TICK_GUARD_BEATS,
  parseFrontmatter,
  endWorld,
} from '../dist/index.js';

const LABEL = { intent: 'Ross → the study door', landed: 'Ross paused at the study door.', stopped: 'Ross drew back.' };
const move = (id, extra = {}) => ({ id, verb: 'mark', target: 'world/study', run: `tick-${id}`, label: LABEL, counter: ['enter', 'talk', 'guard'], ...extra });
const TICK = {
  every: 2, window: 1, grace: 1, budget: 4, landCap: 3, caps: { tamper: 1 },
  actors: {
    ross: { card: 'world/ross.md', goal: 'keep the ledger hidden', moves: [move('tamper', { cap: 'tamper', weight: 3 }), move('visit', { max: 2 })] },
    eve: { card: 'world/eve.md', goal: 'leave soon', moves: [{ ...move('whisper'), verb: 'talk', target: 'world/ross.md', counter: ['talk', 'guard'] }] },
  },
};

/* ─────────────────────────── schema ─────────────────────────── */

test('tick schema: defaults filled, strict, bad blocks reported', () => {
  const { tick, errors } = parseWorldTick({ actors: TICK.actors });
  assert.deepEqual(errors, []);
  assert.deepEqual([tick.every, tick.window, tick.grace, tick.budget, tick.landCap, tick.chooser, tick.costs, tick.wip], [3, 1, 2, 6, 4, 'rules', false, false]);
  for (const bad of [
    { actors: {} },
    { actors: TICK.actors, extra: 1 },
    { actors: { ross: { goal: 'x', moves: [{ ...move('a'), verb: 'teleport' }] } } },
    { actors: { ross: { goal: 'x', moves: [{ ...move('a'), counter: [] }] } } },
    { actors: { ross: { goal: 'x', moves: [{ ...move('a'), target: '../etc' }] } } },
    { actors: { ross: { goal: 'x', moves: [{ ...move('a'), label: { intent: 'x' } }] } } },
  ]) assert.ok(parseWorldTick(bad).errors.length > 0, JSON.stringify(bad));
  assert.equal(parseWorldTick(undefined).tick, null);
  const easy = tickForMode(parseWorldTick(TICK).tick, 'easy');
  assert.deepEqual([easy.window, easy.landCap], [2, 1], 'easy: one more beat to react, half the landings');
});

test('pages: a card on its layer, a door on its PARENT layer', () => {
  assert.equal(pageOfTickTarget('world/ross.md'), 'map');
  assert.equal(pageOfTickTarget('world/study'), 'map');
  assert.equal(pageOfTickTarget('world/study/ledger.md'), 'world/study');
  assert.equal(pageOfTickTarget('world/manor/attic'), 'world/manor');
  assert.equal(pageOfTickTarget('characters/hans'), null);
  assert.ok(isDoorTarget('world/study') && !isDoorTarget('world/ross.md'));
});

/* ─────────────────────────── pure beat rules ─────────────────────────── */

const tick = parseWorldTick(TICK).tick;
const legalAll = () => Object.entries(tick.actors).flatMap(([actor, a]) => a.moves.map((m) => ({ actor, move: m, urgent: false })));
const input = (over = {}) => ({
  page: 'map', actorsHere: true, legal: legalAll(), counter: null, enteredTarget: false, guard: null, seq: 0,
  talkOf: () => 0, moveOf: (a, m) => tick.actors[a]?.moves.find((x) => x.id === m) ?? null, ...over,
});

test('rotation: seeded once, deterministic, nobody skipped; the draw is the same for the same seed and beat', () => {
  assert.deepEqual(tickActorOrder('s1', ['ross', 'eve', 'koharu']), tickActorOrder('s1', ['koharu', 'eve', 'ross']));
  const s = { ...freshTickState('s1', ['ross', 'eve']), beat: 5 };
  const a = chooseTickIntent(s, legalAll());
  const b = chooseTickIntent(s, legalAll());
  assert.deepEqual([a.pick.actor, a.pick.move.id, a.turn], [b.pick.actor, b.pick.move.id, b.turn]);
  // Two turns in a row go to two different people.
  const first = chooseTickIntent({ ...s, turn: 0 }, legalAll());
  const second = chooseTickIntent({ ...s, turn: first.turn }, legalAll());
  assert.notEqual(first.pick.actor, second.pick.actor);
  // An actor with nothing legal is passed over, not waited for.
  const onlyEve = legalAll().filter((m) => m.actor === 'eve');
  assert.equal(chooseTickIntent({ ...s, turn: s.order.indexOf('ross') }, onlyEve).pick.actor, 'eve');
  assert.equal(chooseTickIntent(s, []), null);
});

test('grace, every and the first beat on a page: no ambush', () => {
  let s = freshTickState('seed', ['ross', 'eve']);
  const out = [];
  for (let i = 0; i < 3; i++) {
    const r = stepTickBeat(s, tick, input());
    s = r.state;
    out.push(r.outcome.kind);
  }
  // v2: the first `pace.pageGrace` (default 2) beats on a page are quiet.
  assert.deepEqual(out, ['none', 'none', 'issued'], 'beat 1 is grace; beat 2 is still the page\'s grace; beat 3 issues');
  // A new page: its first beat never issues, even when quiet is due.
  let t = { ...freshTickState('seed', ['ross', 'eve']), beat: 9, quiet: 5, page: 'world/study', pageBeats: 4 };
  assert.equal(stepTickBeat(t, tick, input({ page: 'map' })).outcome.kind, 'none');
  // No actors on the page: nothing accumulates.
  t = { ...freshTickState('seed', ['ross', 'eve']), beat: 9, quiet: 0, page: 'map', pageBeats: 3 };
  const quiet = stepTickBeat(t, tick, input({ actorsHere: false }));
  assert.equal(quiet.state.quiet, 0);
});

function issued(seed = 'seed') {
  let s = { ...freshTickState(seed, ['ross', 'eve']), beat: 4, page: 'map', pageBeats: 3, quiet: 5 };
  const r = stepTickBeat(s, tick, input());
  assert.equal(r.outcome.kind, 'issued');
  return r.state;
}

test('an unseen intent never lands; once seen it lands after the window', () => {
  let s = issued();
  for (let i = 0; i < 4; i++) {
    const r = stepTickBeat(s, tick, input());
    assert.equal(r.outcome.kind, 'none', 'not seen: the window does not run');
    s = r.state;
  }
  assert.equal(markTickSeen(s, 'nope'), false);
  assert.equal(markTickSeen(s, s.pending.id), true);
  const r = stepTickBeat(s, tick, input());
  assert.equal(r.outcome.kind, 'resolved');
  assert.equal(r.outcome.entry.result, 'landed');
  assert.equal(r.state.landed, 1);
  assert.equal(r.state.pending, null);
  assert.equal(r.state.quiet, 0, 'the gap starts again after a resolution');
});

test('counters: take / enter / talk / guard stop it; a counter the move does not allow does not', () => {
  for (const counter of ['enter', 'talk']) {
    const s = issued();
    markTickSeen(s, s.pending.id);
    const r = stepTickBeat(s, tick, input({ counter }));
    assert.deepEqual([r.outcome.entry.result, r.outcome.entry.by], ['stopped', counter]);
    assert.equal(r.state.landed, 0);
    assert.equal(r.state.used[`${r.outcome.entry.actor}/${r.outcome.entry.move}`], 1, 'a stopped move is not refunded');
  }
  const s = issued();
  markTickSeen(s, s.pending.id);
  const take = stepTickBeat(s, tick, input({ counter: 'take' }));
  assert.equal(take.outcome.entry.result, 'landed', 'take is not in this move\'s counters');
  // Guard: a beat of its own, works before seen too, and the target rests for 4 beats.
  const g = issued();
  const guarded = stepTickBeat(g, tick, input({ guard: g.pending.id }));
  assert.deepEqual([guarded.outcome.entry.result, guarded.outcome.entry.by], ['stopped', 'guard']);
  assert.equal(guarded.state.guarded[g.pending.target], guarded.state.beat + TICK_GUARD_BEATS);
  assert.equal(tickMoveAllowed(guarded.state, tick, 'ross', tick.actors.ross.moves[1]), false);
  assert.equal(tickMoveAllowed({ ...guarded.state, beat: guarded.state.beat + TICK_GUARD_BEATS }, tick, 'ross', tick.actors.ross.moves[1]), true);
});

test('leaving the page: through the intent\'s own door = stopped (enter); elsewhere = void', () => {
  let s = issued();
  const left = stepTickBeat(s, tick, input({ page: 'world/stables' }));
  assert.equal(left.outcome.entry.result, 'void');
  s = issued();
  const entered = stepTickBeat(s, tick, input({ page: 'world/study', enteredTarget: true }));
  assert.deepEqual([entered.outcome.entry.result, entered.outcome.entry.by], ['stopped', 'enter']);
});

test('budget, landCap and caps bound the run', () => {
  const full = { ...freshTickState('seed', ['ross', 'eve']), beat: 10, page: 'map', pageBeats: 3, quiet: 9 };
  assert.equal(stepTickBeat({ ...full, issued: tick.budget }, tick, input()).outcome.kind, 'none');
  assert.equal(stepTickBeat({ ...full, landed: tick.landCap }, tick, input()).outcome.kind, 'none');
  const capped = { ...full, capLanded: { tamper: 1 } };
  assert.equal(tickMoveAllowed(capped, tick, 'ross', tick.actors.ross.moves[0]), false);
  assert.equal(tickMoveAllowed({ ...full, used: { 'ross/visit': 2 } }, tick, 'ross', tick.actors.ross.moves[1]), false, 'max');
});

test('the saved record round-trips; garbage starts afresh', () => {
  const s = issued();
  const back = parseTickState(JSON.parse(JSON.stringify(s)), 'other', ['ross', 'eve']);
  assert.deepEqual(back, s);
  assert.equal(parseTickState('nope', 'x', ['ross']).beat, 0);
});

/* ─────────────────────────── engine over a real world ─────────────────────────── */

const fm = (o, body = '') => `---\n${Object.entries(o).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n')}\n---\n${body}\n`;

async function world({ ended = false } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tick-'));
  const w = (rel, text) => fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true }).then(() => fs.writeFile(path.join(root, rel), text));
  await w('world.json', JSON.stringify({
    id: 'tick-test', name: 'Tick test', description: '', author: '', genre: 'test', locale: 'en', mode: 'closed', entry: 'map',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    endings: [{ id: 'done', title: 'Done', path: 'endings/done/README.md' }],
    characters: [], tick: { ...TICK, grace: 0, every: 1 },
  }, null, 2));
  await w('endings/done/README.md', '# Done\n');
  await w('world/README.md', fm({ type: 'readme', name: 'Room', states: [{ id: 'culprit', label: 'C', type: 'enum', values: ['ross', 'eve'], initial: 'ross', hidden: true }] }, 'A room.'));
  await w('world/study/README.md', fm({ type: 'gate', name: 'Study' }, 'The study.'));
  await w('world/ross.md', fm({ type: 'npc', name: 'Ross', persona: 'A partner.', knows: ['world/ross.md'] }, 'Ross.'));
  await w('world/eve.md', fm({ type: 'npc', name: 'Eve', persona: 'A widow.', knows: ['world/eve.md'] }, 'Eve.'));
  for (const id of ['tamper', 'visit', 'whisper']) {
    await w(`command/tick-${id}.yaml`, `name: ${id}\ndesc: test\ndo:\n  - action: give\n    with:\n      path: world/trace-${id}.md\n      title: Trace ${id}\n      frontmatter:\n        type: chalk\n      body: A trace.\n`);
  }
  const store = new LocalWorldStore(root);
  if (ended) await endWorld(createActionService(store, { type: 'god' }, { turn: 'req:end' }).ctx, 'done');
  let n = 0;
  const ctx = () => createActionService(store, { type: 'player' }, { turn: `req:t-${++n}` }).ctx;
  return { root, store, ctx, has: (rel) => fs.access(path.join(root, rel)).then(() => true, () => false) };
}

async function untilIssued(h, page = 'map') {
  for (let i = 0; i < 6; i++) {
    const r = await runTickBeat(h.ctx(), { page });
    if (r.issued) return r;
  }
  assert.fail('no intent issued');
}

test('engine: an intent shows on the player\'s page, lands after seen + a beat, runs its command as the engine, and is told', async () => {
  const h = await world();
  try {
    const r = await untilIssued(h);
    assert.equal(r.view.pending.page, 'map');
    assert.equal(r.view.pending.seen, false);
    assert.ok(['Ross', 'Eve'].includes(r.view.pending.name));
    // Not seen: another beat does nothing.
    assert.equal((await runTickBeat(h.ctx(), { page: 'map' })).resolved, undefined);
    await markTickIntentSeen(h.ctx(), r.issued);
    const done = await runTickBeat(h.ctx(), { page: 'map' });
    assert.equal(done.resolved.result, 'landed');
    const runId = r.issued.split('/')[1];
    assert.ok(await h.has(`world/trace-${runId}.md`), 'the move\'s command ran');
    const events = await h.store.getEvents(20);
    const story = events.filter((e) => e.type === 'story_event' && e.detail.tick);
    assert.equal(story.length, 1);
    assert.equal(story[0].actor.type, 'engine');
    assert.equal(story[0].detail.tick.result, 'landed');
    // The writer and the actor hear about it.
    assert.match(await tickPageMoves(h.store, 'map'), /\(landed\)/);
    assert.equal(await tickPageMoves(h.store, 'world/study'), null, 'another page hears nothing');
    const actor = r.view.pending.actor;
    const notes = await tickNotesForNpc(h.store, `world/${actor}.md`);
    assert.match(notes.join('\n'), /You just did this/);
    // The record is engine bookkeeping in world/README.md, reserved from commands and agents.
    assert.ok(RESERVED_FRONTMATTER_KEYS.includes('tick'));
    const raw = parseFrontmatter(await h.store.readFile('world/README.md')).frontmatter.tick;
    assert.equal(raw.landed, 1);
    await assert.rejects(
      createActionService(h.store, { type: 'writer' }, { turn: 'turn:w' }).editEntity({ path: 'world/README.md', frontmatter: { tick: {} } }),
      /tick/,
    );
  } finally {
    h.store.close();
  }
});

test('engine: talking to the actor in the window stops it; the stop is a fact too', async () => {
  const h = await world();
  try {
    const r = await untilIssued(h);
    await markTickIntentSeen(h.ctx(), r.issued);
    const card = `world/${r.view.pending.actor}.md`;
    const f = parseFrontmatter(await h.store.readFile(card));
    await createActionService(h.store, { type: 'player' }, { turn: 'req:talk' }).editEntity({ path: card, frontmatter: { dialogue: [...(f.frontmatter.dialogue ?? []), { by: 'player', text: 'A word?' }] } });
    const done = await runTickBeat(h.ctx(), { page: 'map' });
    assert.deepEqual([done.resolved.result, done.resolved.by], ['stopped', 'talk']);
    const story = (await h.store.getEvents(20)).filter((e) => e.type === 'story_event' && e.detail.tick);
    assert.equal(story[0].detail.tick.result, 'stopped');
    assert.match(await tickPageMoves(h.store, 'map'), /stopped, the player called them over/);
  } finally {
    h.store.close();
  }
});

test('engine: guard is its own beat; off the page nothing shows; after an ending nothing moves; off mode is silent', async () => {
  const h = await world();
  try {
    // On another page the actors are not there: nothing issues.
    for (let i = 0; i < 4; i++) assert.equal((await runTickBeat(h.ctx(), { page: 'world/study' })).issued, undefined);
    const r = await untilIssued(h);
    const g = await runTickBeat(h.ctx(), { page: 'map', guard: r.issued });
    assert.deepEqual([g.resolved.result, g.resolved.by], ['stopped', 'guard']);
    const off = await runTickBeat(h.ctx(), { page: 'map', mode: 'off' });
    assert.deepEqual([off.ran, off.paused], [false, 'off']);
    assert.equal((await readTickView(h.store, 'off')).enabled, false);
  } finally {
    h.store.close();
  }
  const e = await world({ ended: true });
  try {
    for (let i = 0; i < 4; i++) {
      const r = await runTickBeat(e.ctx(), { page: 'map' });
      assert.deepEqual([r.ran, r.paused], [false, 'ended']);
    }
  } finally {
    e.store.close();
  }
});

test('engine: a target not on the player\'s page is never legal; `if` / `unless` read the world', async () => {
  const h = await world();
  try {
    const w = await loadTickWorld(h.store);
    w.tick.actors.ross.moves = [move('tamper', { target: 'world/study/README.md', if: 'world.culprit == "eve"' })];
    // Rewrite world.json with the narrowed menu.
    const manifest = JSON.parse(await h.store.readFile('world.json'));
    manifest.tick.actors = { ross: { card: 'world/ross.md', goal: 'x', moves: [move('tamper', { if: 'world.culprit == "eve"' }), move('visit', { unless: ['world/ross.md'] })] } };
    await fs.writeFile(path.join(h.root, 'world.json'), JSON.stringify(manifest));
    for (let i = 0; i < 5; i++) assert.equal((await runTickBeat(h.ctx(), { page: 'map' })).issued, undefined, 'if false / unless present: nothing legal');
    const state = await readTickState(h.store, await loadTickWorld(h.store));
    assert.equal(state.issued, 0);
  } finally {
    h.store.close();
  }
});

test('the NPC brief carries the tick lines as engine facts', () => {
  const brief = buildNpcBrief({
    path: 'world/ross.md',
    npc: { name: 'Ross', persona: 'A partner.', knows: [], gives: [] },
    knows: [], history: [], line: 'Where were you?', language: 'en',
    moves: ['You just tried this and were stopped (the player called them over to talk): Ross drew back.'],
  });
  assert.match(brief, /Just now, on this page \(engine facts/);
  assert.match(brief, /Ross drew back/);
});
