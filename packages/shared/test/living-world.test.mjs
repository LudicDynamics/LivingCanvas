/**
 * A living world: the clock, the calendar, the
 * residents' schedules, the off-screen tick, the between-session catch-up and
 * its digest. Pure parts are tested directly; the engine runs through the real
 * ActionService against a real LocalWorldStore, so every move is a real
 * presence row and every overnight change a real declared-state write.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  LocalWorldStore,
  createActionService,
  parseLivingWorld,
  livingNow,
  catchUpMinutes,
  minutesUntilPhase,
  residentPlace,
  weatherOf,
  rollOf,
  formatLivingNow,
  readLivingState,
  writeLivingState,
  catchUpLivingWorld,
  claimAwayDigest,
  awayDigestPrompt,
  deliverAwayDigestAsEvent,
  settleLivingWorld,
  loadLivingWorld,
  livingPanelLines,
  livingContextBlock,
  passTime,
  parseFrontmatter,
  parseWorldCommand,
  WORLD_COMMAND_EFFECTS,
  RESERVED_FRONTMATTER_KEYS,
  triggerConditionProfile,
  parseTriggerCondition,
} from '../dist/index.js';

const PLAYER = { type: 'player' };
const WRITER = { type: 'writer' };
const DAY = 1440;

const LIVING = {
  seed: 7,
  start: { day: 1, time: '07:00' },
  phases: [
    { id: 'dawn', from: '05:00', label: 'Dawn' },
    { id: 'morning', from: '07:00', label: 'Morning' },
    { id: 'noon', from: '11:00', label: 'Noon' },
    { id: 'evening', from: '18:00', label: 'Evening' },
    { id: 'night', from: '21:00', label: 'Night' },
  ],
  seasons: [{ id: 'spring', label: 'Spring' }, { id: 'summer', label: 'Summer' }],
  daysPerSeason: 7,
  weekdays: [
    { id: 'mon', label: 'Mon' }, { id: 'tue', label: 'Tue' }, { id: 'wed', label: 'Wed' }, { id: 'thu', label: 'Thu' },
    { id: 'fri', label: 'Fri' }, { id: 'sat', label: 'Sat' }, { id: 'sun', label: 'Sun' },
  ],
  weather: [
    { id: 'sunny', label: 'Sunny', weight: 5 },
    { id: 'rain', label: 'Rain', weight: 2 },
    { id: 'storm', label: 'Storm', weight: 1, seasons: ['summer'] },
  ],
  pace: { perAction: 30 },
  catchUp: { ratio: 1, maxDays: 2, minMinutes: 30 },
  digest: { title: 'While you were away', writer: true, minHours: 6 },
  display: { label: 'Island time', text: '{season} day {day} · {weekday} · {phase}' },
  residents: {
    nagi: {
      schedule: [
        { at: 'world/beach', phases: ['dawn', 'morning'], text: 'hauling the nets' },
        { at: 'world/square', phases: ['noon'], text: 'selling fish' },
        { at: 'world/dock', if: 'world.boat_fixed == true', text: 'sailing the mended boat' },
        { at: 'map', text: 'at home' },
      ],
      daily: [{ state: 'mood', pick: { cheerful: 3, grumpy: 1 } }, { state: 'catch', by: 1 }],
      away: [{ text: 'Nagi landed a sea bass and told everyone.' }, { text: 'Nagi mended a net on the pier.' }],
    },
    toma: {
      schedule: [{ at: 'world/dock', text: 'watching the sea' }],
    },
  },
  events: [
    { id: 'ferry', label: 'Ferry day', on: { weekdays: ['sat'] }, phases: ['morning', 'noon'], at: 'world/dock', gather: ['nagi'] },
    { id: 'lanterns', label: 'Lantern night', on: { seasons: ['summer'], days: [3] }, phases: ['evening', 'night'], at: 'world/square', gather: 'all' },
  ],
  variants: {
    'world/square': { base: 'assets/square.webp', when: [{ events: ['lanterns'], bg: 'assets/square-lanterns.webp' }] },
  },
};

async function world({ living = LIVING, triggers = [] } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-living-'));
  const store = new LocalWorldStore(root);
  const write = (rel, text) => store.writeFile(rel, text);
  await write('world.json', JSON.stringify({
    id: 'islet-test', name: 'Islet', description: '', author: '', genre: 'test',
    characters: [
      { id: 'nagi', name: 'Nagi', home: 'map', role: 'npc' },
      { id: 'toma', name: 'Toma', home: 'world/dock', role: 'npc' },
    ],
    living,
    triggers,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }));
  const worldStates = [{ id: 'boat_fixed', label: 'Boat', type: 'flag', initial: false }];
  await write('world/README.md', `---\nname: Island\ntype: readme\nstates: ${JSON.stringify(worldStates)}\n---\n\nAn island.\n`);
  for (const [dir, name] of [['beach', 'Beach'], ['square', 'Square'], ['dock', 'Dock']]) {
    await write(`world/${dir}/README.md`, `---\nname: ${name}\ntype: readme\n${dir === 'square' ? 'bg: assets/square.webp\n' : ''}---\n\n${name}.\n`);
  }
  // Scene pictures: tiny but real files (swap_background refuses a missing one).
  for (const p of ['assets/square.webp', 'assets/square-lanterns.webp']) await fs.mkdir(path.dirname(path.join(root, p)), { recursive: true }).then(() => fs.writeFile(path.join(root, p), 'RIFF0000WEBP'));
  const nagiStates = [
    { id: 'mood', label: 'Mood', type: 'enum', values: ['cheerful', 'grumpy'], initial: 'cheerful', shown_as: { cheerful: 'in high spirits', grumpy: 'a bit grumpy' } },
    { id: 'catch', label: 'Catch', type: 'number', initial: 0, range: [0, 5], hidden: true },
  ];
  for (const id of ['nagi', 'toma']) {
    await write(`characters/${id}/README.md`, `---\ntype: readme\nname: ${id}\n${id === 'nagi' ? `states: ${JSON.stringify(nagiStates)}\n` : ''}---\n\n${id}.\n`);
  }
  await write('player/README.md', '---\ntype: readme\ntitle: You\n---\n\nYou.\n');
  await write('command/sleep.yaml', 'name: Sleep\ndo:\n  - action: pass_time\n    with:\n      until: morning\n');
  await write('command/fix-boat.yaml', 'name: Fix\ndo:\n  - action: set_state\n    with: { target: world, state: boat_fixed, value: "true" }\n');
  return { store, root, write };
}

const at = (iso) => () => iso;
const ctxOf = (store, now = '2026-10-08T12:00:00.000Z', actor = { type: 'engine' }) => ({ store, actor, turn: `t:${Math.random()}`, now: at(now) });

/* ─────────────────────────── pure ─────────────────────────── */

test('schema: the example parses; bad references are refused', () => {
  assert.deepEqual(parseLivingWorld(LIVING).errors, []);
  const bad = [
    { ...LIVING, phases: [LIVING.phases[1], LIVING.phases[0]] },                    // out of order
    { ...LIVING, residents: { nagi: { schedule: [{ at: 'world/beach', phases: ['brunch'] }] } } },
    { ...LIVING, events: [{ id: 'x', label: 'X', on: { weekdays: ['funday'] } }] },
    { ...LIVING, events: [{ id: 'x', label: 'X', on: {} }] },                        // no date
    { ...LIVING, events: [{ id: 'x', label: 'X', on: { every: 2 }, gather: 'all' }] }, // gather without at
    { ...LIVING, residents: { nagi: { schedule: [{ at: 'beach' }] } } },              // not a layer
    { ...LIVING, residents: { nagi: { schedule: [{ at: 'map' }], daily: [{ state: 'mood' }] } } }, // no pick/set/by
  ];
  for (const b of bad) assert.ok(parseLivingWorld(b).errors.length > 0, JSON.stringify(b).slice(0, 120));
});

test('clock: day, phase (night runs past midnight), season, weekday, events', () => {
  const living = parseLivingWorld(LIVING).living;
  const n = livingNow(living, 7, 7 * 60);
  assert.deepEqual([n.day, n.phase, n.season, n.weekday, n.time], [1, 'morning', 'spring', 'mon', '07:00']);
  assert.equal(livingNow(living, 7, DAY + 2 * 60).phase, 'night'); // 02:00 on day 2
  assert.equal(livingNow(living, 7, 4 * 60 + 59).phase, 'night');
  assert.equal(livingNow(living, 7, 5 * 60).phase, 'dawn');
  const sat = livingNow(living, 7, 5 * DAY + 8 * 60); // day 6 = sat, morning
  assert.deepEqual([sat.weekday, sat.today, sat.active], ['sat', ['ferry'], ['ferry']]);
  assert.deepEqual(livingNow(living, 7, 5 * DAY + 19 * 60).active, []); // ferry is over by evening
  const summer3 = livingNow(living, 7, 9 * DAY + 19 * 60); // day 10 = summer day 3
  assert.deepEqual([summer3.season, summer3.dayOfSeason, summer3.active.includes('lanterns')], ['summer', 3, true]);
  assert.equal(livingNow(living, 7, 14 * DAY).year, 2);
  assert.equal(formatLivingNow(living, n), 'Spring day 1 · Mon · Morning');
});

test('determinism: the same seed and minute give the same weather, rolls and places', () => {
  const living = parseLivingWorld(LIVING).living;
  for (let day = 1; day <= 40; day += 1) {
    assert.equal(weatherOf(living, 7, day), weatherOf(living, 7, day));
    if (living.seasons[Math.floor((day - 1) / 7) % 2].id === 'spring') assert.notEqual(weatherOf(living, 7, day), 'storm', `no storms in spring (day ${day})`);
  }
  assert.equal(rollOf(7, 'a', 1), rollOf(7, 'a', 1));
  assert.notEqual(rollOf(7, 'a', 1), rollOf(8, 'a', 1));
  const seq = (seed) => Array.from({ length: 30 }, (_, d) => weatherOf(living, seed, d + 1)).join(',');
  assert.equal(seq(7), seq(7));
  assert.notEqual(seq(7), seq(99), 'a different seed is a different season of weather');
});

test('schedules: event gathering beats the schedule; first entry that holds; `if`; home fallback', () => {
  const living = parseLivingWorld(LIVING).living;
  const nowAt = (minute) => livingNow(living, 7, minute);
  assert.equal(residentPlace(living, 'nagi', nowAt(7 * 60), 'map').layer, 'world/beach');
  assert.equal(residentPlace(living, 'nagi', nowAt(12 * 60), 'map').layer, 'world/square');
  assert.equal(residentPlace(living, 'nagi', nowAt(19 * 60), 'map').layer, 'map');
  assert.equal(residentPlace(living, 'nagi', nowAt(19 * 60), 'map', (e) => e === 'world.boat_fixed == true').layer, 'world/dock');
  const ferry = residentPlace(living, 'nagi', nowAt(5 * DAY + 8 * 60), 'map');
  assert.deepEqual([ferry.layer, ferry.source.kind], ['world/dock', 'event']);
  assert.equal(residentPlace(living, 'toma', nowAt(9 * DAY + 19 * 60), 'world/dock').layer, 'world/square', 'gather: all');
  assert.equal(residentPlace(living, 'stranger', nowAt(0), 'world/beach').source.kind, 'home');
});

test('catch-up cap: reloads pass nothing, long absences stop at maxDays', () => {
  const living = parseLivingWorld(LIVING).living;
  const min = 60000;
  assert.equal(catchUpMinutes(living, 10 * min), 0, 'a reload is not an absence');
  assert.equal(catchUpMinutes(living, 90 * min), 90);
  assert.equal(catchUpMinutes(living, 30 * DAY * min), 2 * DAY, 'thirty days away = two days on the island');
  assert.equal(catchUpMinutes({ ...living, catchUp: { ratio: 4, maxDays: 1, minMinutes: 0 } }, 60 * min), 240);
  assert.equal(catchUpMinutes(living, -5), 0);
  assert.equal(minutesUntilPhase(living, 20 * 60, 'morning'), 11 * 60);
  assert.equal(minutesUntilPhase(living, 7 * 60, 'morning'), DAY, 'asking for morning in the morning means tomorrow');
  assert.equal(minutesUntilPhase(living, 0, 'brunch'), null);
});

test('effects and reserved keys: pass_time is a command effect; living is engine bookkeeping', () => {
  assert.ok(WORLD_COMMAND_EFFECTS.includes('pass_time'));
  assert.ok(RESERVED_FRONTMATTER_KEYS.includes('living'));
  assert.ok(parseWorldCommand('sleep', 'name: Sleep\ndo:\n  - action: pass_time\n    with:\n      until: morning\n').ok);
  assert.ok(parseWorldCommand('nap', 'name: Nap\ndo:\n  - action: pass_time\n    with:\n      minutes: "90"\n').ok);
  assert.equal(parseWorldCommand('bad', 'name: Bad\ndo:\n  - action: pass_time\n    with:\n      minutes: "90"\n      until: morning\n').ok, false, 'minutes XOR until');
  assert.ok(triggerConditionProfile([]).roots.includes('time') && triggerConditionProfile([]).roots.includes('events'));
  assert.ok(parseTriggerCondition('time.phase == "evening" && events.lantern_night == true', []).ok);
});

/* ─────────────────────────── engine ─────────────────────────── */

test('first settle starts the clock and puts residents where their schedule says', async () => {
  const { store } = await world();
  const r = await settleLivingWorld(ctxOf(store), { force: true });
  assert.ok(r);
  const state = await readLivingState(store);
  assert.deepEqual([state.minute, state.settled, state.seed], [7 * 60, 7 * 60, 7]);
  assert.equal(store.getPresenceOf('nagi').layer, 'world/beach');
  assert.equal(store.getPresenceOf('toma').layer, 'world/dock');
  const events = await store.getEventsSince(0);
  assert.ok(events.some((e) => e.type === 'character_moved' && e.detail.character === 'nagi' && e.actor.type === 'engine'));
});

test('play moves time: each player action takes perAction minutes; writer actions do not', async () => {
  const { store } = await world();
  await settleLivingWorld(ctxOf(store), { force: true });
  const player = createActionService(store, PLAYER, { now: at('2026-10-08T12:00:00.000Z') });
  await player.enterLayer({ layer: 'world/beach' });
  assert.equal((await readLivingState(store)).minute, 7 * 60 + 30);
  const writer = createActionService(store, WRITER, { now: at('2026-10-08T12:00:00.000Z') });
  await writer.enterLayer({ layer: 'world/dock' });
  assert.equal((await readLivingState(store)).minute, 7 * 60 + 30, 'only the player\'s own steps take time');
  // Read-only actions take none either.
  await player.lookAt({ path: 'world/README.md' });
  assert.equal((await readLivingState(store)).minute, 7 * 60 + 30);
});

test('pass_time until morning: a night passes, overnight rules apply once, residents walk', async () => {
  const { store } = await world();
  await settleLivingWorld(ctxOf(store), { force: true });
  await passTime(ctxOf(store), { minutes: 12 * 60 }); // 19:00
  const evening = await settleLivingWorld(ctxOf(store));
  assert.deepEqual(evening.days, []);
  assert.equal(store.getPresenceOf('nagi').layer, 'map');
  await passTime(ctxOf(store), { until: 'morning' }); // day 2, 07:00
  const morning = await settleLivingWorld(ctxOf(store));
  assert.deepEqual(morning.days, [2]);
  assert.equal(store.getPresenceOf('nagi').layer, 'world/beach');
  const fm = parseFrontmatter(await store.readFile('characters/nagi/README.md')).frontmatter;
  assert.equal(fm.status.data.catch, 1, 'one night = one `by: 1`');
  assert.ok(['cheerful', 'grumpy'].includes(fm.status.data.mood));
  // Settling again changes nothing: the night is applied exactly once.
  const again = await settleLivingWorld(ctxOf(store));
  assert.deepEqual(again.days, []);
  assert.equal(parseFrontmatter(await store.readFile('characters/nagi/README.md')).frontmatter.status.data.catch, 1);
});

test('pass_time as a command effect, through a choice; the world settles in the same action', async () => {
  const { store, write } = await world();
  await settleLivingWorld(ctxOf(store), { force: true });
  await write('world/bed.md', [
    '---', 'type: chalk', 'title: Bed', 'choice:', '  options:', '    - id: sleep', '      label: Sleep', 'on:', '  choice_selected:',
    '    - when: choice.option_id == "sleep"', '      run: sleep', '---', '', 'A bed.', '',
  ].join('\n'));
  const player = createActionService(store, PLAYER, { now: at('2026-10-08T12:00:00.000Z') });
  const r = await player.chooseOption({ path: 'world/bed.md', choice: 'sleep' });
  const state = await readLivingState(store);
  assert.equal(state.minute, DAY + 7 * 60, 'slept until the next morning; the step itself took no extra time');
  assert.equal(state.settled, state.minute);
  assert.equal(r.details.living.days, 1);
});

test('a state condition in `if` moves a resident once the story makes it true', async () => {
  const { store } = await world();
  await passTime(ctxOf(store), { minutes: 12 * 60 }); // 19:00
  await settleLivingWorld(ctxOf(store));
  assert.equal(store.getPresenceOf('nagi').layer, 'map');
  const god = createActionService(store, { type: 'god' });
  await god.editEntity({ path: 'world/README.md', frontmatter: { status: { data: { boat_fixed: true } } } });
  await settleLivingWorld(ctxOf(store), { force: true });
  assert.equal(store.getPresenceOf('nagi').layer, 'world/dock');
});

test('a follower stays with the player; a story-chosen picture is never overwritten', async () => {
  const { store } = await world();
  await settleLivingWorld(ctxOf(store), { force: true });
  await store.upsertPresence({ characterId: 'nagi', layer: 'world/dock', x: 0, y: 0, following: true });
  await passTime(ctxOf(store), { minutes: 5 * 60 }); // noon: schedule says square
  await settleLivingWorld(ctxOf(store));
  assert.equal(store.getPresenceOf('nagi').layer, 'world/dock');
  // Lantern night swaps the square's picture; a picture the story chose stays.
  await passTime(ctxOf(store), { minutes: 9 * DAY }); // day 10 evening... (12:00 + 9 days = day 10 noon)
  await passTime(ctxOf(store), { until: 'evening' });
  await settleLivingWorld(ctxOf(store));
  assert.equal(parseFrontmatter(await store.readFile('world/square/README.md')).frontmatter.bg, 'assets/square-lanterns.webp');
  await passTime(ctxOf(store), { until: 'morning' });
  await settleLivingWorld(ctxOf(store));
  assert.equal(parseFrontmatter(await store.readFile('world/square/README.md')).frontmatter.bg, 'assets/square.webp', 'back to the base picture');
  const god = createActionService(store, { type: 'god' });
  await god.editEntity({ path: 'world/square/README.md', frontmatter: { bg: 'assets/burnt.webp' } });
  await passTime(ctxOf(store), { minutes: 8 * DAY });
  await passTime(ctxOf(store), { until: 'evening' });
  await settleLivingWorld(ctxOf(store));
  assert.equal(parseFrontmatter(await store.readFile('world/square/README.md')).frontmatter.bg, 'assets/burnt.webp');
});

test('festivals are ordinary triggers on time.* / events.* — fired once per occurrence', async () => {
  const triggers = [
    { id: 'ferry-in', kind: 'state', when: 'events.ferry == true', once: false, fallback: 'The ferry horn sounds.' },
    { id: 'first-summer', kind: 'state', when: 'time.season == "summer"', fallback: 'Summer.' },
  ];
  const { store } = await world({ triggers });
  await settleLivingWorld(ctxOf(store), { force: true });
  await passTime(ctxOf(store), { minutes: 5 * DAY + 60 }); // day 6 (sat) 08:00
  const sat = await settleLivingWorld(ctxOf(store));
  assert.deepEqual(sat.fired.map((f) => f.id), ['ferry-in']);
  await passTime(ctxOf(store), { minutes: 60 });
  assert.deepEqual((await settleLivingWorld(ctxOf(store))).fired, [], 'still the same ferry');
  await passTime(ctxOf(store), { minutes: 7 * DAY });
  const next = await settleLivingWorld(ctxOf(store));
  assert.deepEqual(next.fired.map((f) => f.id).sort(), ['ferry-in', 'first-summer'], 'the next ferry, and summer');
});

test('catch-up: real time passes on return, capped; reload passes none; the digest is earned once', async () => {
  const { store } = await world();
  // First visit: the clock starts, nothing has been missed.
  const first = await catchUpLivingWorld(ctxOf(store, '2026-10-08T12:00:00.000Z'));
  assert.equal(first.minutes, 0);
  assert.equal(first.away, null);
  // A reload ten minutes later is not an absence.
  const reload = await catchUpLivingWorld(ctxOf(store, '2026-10-08T12:10:00.000Z'));
  assert.equal(reload.minutes, 0);
  // Thirty real days away: only two days pass on the island.
  const back = await catchUpLivingWorld(ctxOf(store, '2026-11-07T12:10:00.000Z'));
  assert.equal(back.minutes, 2 * DAY);
  assert.deepEqual(back.settle.days, [2, 3]);
  assert.ok(back.away && back.away.facts.length >= 1, JSON.stringify(back.away));
  const state = await readLivingState(store);
  assert.equal(state.minute, 2 * DAY + 7 * 60);
  // The digest goes out exactly once, by one path.
  const claimed = await claimAwayDigest(store, 'writer');
  assert.ok(claimed);
  assert.equal(await claimAwayDigest(store, 'writer'), null);
  assert.equal(await deliverAwayDigestAsEvent(ctxOf(store)), false, 'already delivered by the writer');
  const prompt = awayDigestPrompt(await loadLivingWorld(store), state.seed, claimed);
  assert.match(prompt, /^\[World Event\] The player has come back/);
  assert.match(prompt, /ONE short chalk/);
});

test('digest trigger: a short absence earns none; the template path lands one story event', async () => {
  const { store } = await world();
  await catchUpLivingWorld(ctxOf(store, '2026-10-08T12:00:00.000Z'));
  const short = await catchUpLivingWorld(ctxOf(store, '2026-10-08T15:00:00.000Z')); // 3h < minHours 6
  assert.equal(short.minutes, 180);
  assert.equal(short.away, null);
  const long = await catchUpLivingWorld(ctxOf(store, '2026-10-09T12:00:00.000Z'));
  assert.ok(long.away);
  assert.equal(await deliverAwayDigestAsEvent(ctxOf(store)), true);
  assert.equal(await deliverAwayDigestAsEvent(ctxOf(store)), false, 'once');
  const events = await store.getEventsSince(0);
  assert.equal(events.filter((e) => e.detail?.title === 'While you were away').length, 1);
  // No digest configured: the clock still catches up, silently.
  const quiet = await world({ living: { ...LIVING, digest: undefined } });
  await catchUpLivingWorld(ctxOf(quiet.store, '2026-10-08T12:00:00.000Z'));
  const r = await catchUpLivingWorld(ctxOf(quiet.store, '2026-10-10T12:00:00.000Z'));
  assert.equal(r.minutes, 2 * DAY);
  assert.equal(r.away, null);
});

test('determinism end to end: two saves with the same seed live the same days', async () => {
  const run = async () => {
    const { store } = await world();
    await catchUpLivingWorld(ctxOf(store, '2026-10-08T12:00:00.000Z'));
    const r = await catchUpLivingWorld(ctxOf(store, '2026-10-10T12:00:00.000Z'));
    const fm = parseFrontmatter(await store.readFile('characters/nagi/README.md')).frontmatter;
    return JSON.stringify({ facts: r.away.facts, mood: fm.status.data.mood, catch: fm.status.data.catch, nagi: store.getPresenceOf('nagi').layer });
  };
  assert.equal(await run(), await run());
});

test('panels and agent context: prose lines, no engine numbers', async () => {
  const { store } = await world();
  await settleLivingWorld(ctxOf(store), { force: true });
  const panels = await livingPanelLines(store);
  assert.equal(panels.world[0].text, 'Spring day 1 · Mon · Morning');
  assert.equal(panels.characters.nagi[0].text, 'hauling the nets');
  const writer = await livingContextBlock(store, { type: 'writer' });
  assert.match(writer, /\[The living world/);
  assert.match(writer, /Nagi \(nagi\): Beach — hauling the nets; Mood: in high spirits/);
  assert.doesNotMatch(writer, /Catch/, 'hidden states stay hidden');
  const nagi = await livingContextBlock(store, { type: 'character', id: 'nagi' });
  assert.match(nagi, /You are at Beach — hauling the nets/);
  // A world without `living` gets nothing.
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-living-none-'));
  const plain = new LocalWorldStore(root);
  await plain.writeFile('world.json', JSON.stringify({ id: 'p', name: 'P', description: '', author: '', genre: 'x', createdAt: '', updatedAt: '' }));
  assert.equal(await livingContextBlock(plain, { type: 'writer' }), '');
  assert.equal(await livingPanelLines(plain), null);
  assert.equal(await settleLivingWorld(ctxOf(plain)), null);
  await assert.rejects(passTime(ctxOf(plain), { minutes: 10 }), /no living clock/);
});

test('the living record is engine-only: agents cannot rewrite it', async () => {
  const { store } = await world();
  await settleLivingWorld(ctxOf(store), { force: true });
  const writer = createActionService(store, WRITER);
  await assert.rejects(writer.editEntity({ path: 'world/README.md', frontmatter: { living: { minute: 0, seed: 1 } } }), /living/);
  const state = await readLivingState(store);
  await writeLivingState(store, { ...state, minute: state.minute + 1 });
  assert.equal((await readLivingState(store)).minute, state.minute + 1);
});

test('a command set_state / add_state reaches a character README (configuration files refuse generic edits)', async () => {
  const { store, write } = await world();
  await write('command/cheer.yaml', 'name: Cheer\ndo:\n  - action: set_state\n    with: { target: characters/nagi, state: mood, value: grumpy }\n  - action: add_state\n    with: { target: characters/nagi, state: catch, by: "2" }\n');
  await write('world/note.md', [
    '---', 'type: chalk', 'title: Note', 'choice:', '  options:', '    - id: go', '      label: Go', 'on:', '  choice_selected:',
    '    - when: choice.option_id == "go"', '      run: cheer', '---', '', 'Note.', '',
  ].join('\n'));
  const player = createActionService(store, PLAYER);
  await player.chooseOption({ path: 'world/note.md', choice: 'go' });
  const fm = parseFrontmatter(await store.readFile('characters/nagi/README.md')).frontmatter;
  assert.deepEqual([fm.status.data.mood, fm.status.data.catch], ['grumpy', 2]);
  assert.equal(fm.name, 'nagi', 'the rest of the README is untouched');
  const events = await store.getEventsSince(0);
  assert.ok(events.some((e) => e.type === 'entity_edited' && e.subject === 'characters/nagi/README.md' && e.detail.command === 'cheer'));
});

test('a daily activity repeats on another hour; a double click in the same minute does not', async () => {
  const { store, write } = await world({ living: { ...LIVING, pace: { perAction: 0 } } });
  await settleLivingWorld(ctxOf(store), { force: true });
  await write('command/fish.yaml', 'name: Fish\ndo:\n  - action: add_state\n    with: { target: characters/nagi, state: catch, by: "1" }\n  - action: pass_time\n    with: { minutes: "60" }\n');
  await write('command/look.yaml', 'name: Look\ndo:\n  - action: add_state\n    with: { target: characters/nagi, state: catch, by: "1" }\n');
  await write('world/beach/README.md', [
    '---', 'type: readme', 'name: Beach', 'choice:', '  options:', '    - id: fish', '      label: Fish', '    - id: look', '      label: Look', 'on:', '  choice_selected:',
    '    - when: choice.option_id == "fish"', '      run: fish', '    - when: choice.option_id == "look"', '      run: look', '---', '', 'Beach.', '',
  ].join('\n'));
  const choose = (choice) => createActionService(store, PLAYER).chooseOption({ path: 'world/beach/README.md', choice });
  const catchOf = async () => parseFrontmatter(await store.readFile('characters/nagi/README.md')).frontmatter.status?.data?.catch ?? 0;
  await choose('fish');
  await choose('fish');
  assert.equal(await catchOf(), 2, 'an hour later is another fishing trip');
  // perAction 0 and no pass_time: the clock stands still, so the same choice is the same fact.
  await choose('look');
  await choose('look');
  assert.equal(await catchOf(), 3);
});
