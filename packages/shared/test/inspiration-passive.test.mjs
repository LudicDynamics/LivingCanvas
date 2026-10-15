/**
 * The inspiration roll, passive checks and companion specialties
 *. Pure rules first, then the action path on
 * a temporary world. Imports the BUILT dist; injected rng and forced totals only,
 * no model.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  LocalWorldStore,
  createActionService,
  parseFrontmatter,
  stringifyFrontmatter,
  clockLeft,
  parseHintTable,
  planHint,
  EMPTY_HINT_LOG,
  pickInspiration,
  inspirationGate,
  inspirationConfigOf,
  inspirationConfigProblems,
  parsePassive,
  bestRoller,
  inspire,
  inspirationStatus,
  runPassiveChecks,
  cueToTeach,
  tutorialCueText,
  TUTORIAL_CUE_IDS,
  skillUseOf,
  parseSheet,
  ActionError,
} from '../dist/index.js';

// ---------------------------------------------------------------------------
// Pure rules
// ---------------------------------------------------------------------------

const TABLE = parseHintTable({
  by: 'kuri',
  hints: [
    { id: 'look-1', group: 'look', level: 1, when: { layer: 'world/hall' }, say: 'Look around the hall.', inspire: { vague: 'The hall feels important.' } },
    { id: 'look-2', group: 'look', level: 2, when: { layer: 'world/hall' }, say: 'The ledger on the desk.', suggest: [{ card: 'world/hall/README.md', option: 'read-ledger' }] },
    { id: 'look-3', group: 'look', level: 3, when: { layer: 'world/hall' }, say: 'Read the ledger.', inspire: { sharp: 'The ledger: the old page is the one that matters.' }, suggest: [{ card: 'world/hall/README.md', option: 'read-ledger' }] },
    { id: 'secret', when: { layer: 'world/hall' }, say: 'Only an inspiration finds this.', priority: 10, inspire: { only: true } },
    { id: 'quiet', when: { layer: 'world/hall' }, say: 'Never through a roll.', priority: 999, inspire: { skip: true } },
    { id: 'kitchen', when: { layer: 'world/kitchen' }, say: 'The kitchen.' },
  ],
}).table;

const state = (page, extra = {}) => ({ page, values: new Map(), paths: new Map(), seen: [page], characterIds: ['kuri'], ...extra });

test('hints.json inspire block parses; only + skip contradict', () => {
  assert.ok(TABLE, 'table parses');
  const bad = parseHintTable({ hints: [{ id: 'x', say: 'x', inspire: { only: true, skip: true } }] });
  assert.equal(bad.table, null);
  assert.match(bad.errors.join(' '), /contradict/);
  assert.equal(parseHintTable({ hints: [{ id: 'x', say: 'x', inspire: { loud: true } }] }).table, null, 'strict');
});

test('the companion never says an inspiration-only line', () => {
  const t = parseHintTable({ hints: [{ id: 'secret', say: 'S', inspire: { only: true } }] }).table;
  const plan = planHint(t, state('map'), EMPTY_HINT_LOG, { stuck: true });
  assert.equal(plan.hint, null);
});

test('pickInspiration: the tier decides how clear the line is', () => {
  const s = state('world/hall');
  const great = pickInspiration(TABLE, s, { used: {} }, 'great');
  assert.equal(great.hint.id, 'look-3', 'a critical jumps to the top rung');
  assert.equal(great.text, 'The ledger: the old page is the one that matters.', 'and reads it sharp');
  assert.equal(great.suggest.length, 1);
  const success = pickInspiration(TABLE, s, { used: {} }, 'success');
  assert.equal(success.hint.id, 'look-1', 'a success takes the next rung');
  assert.equal(success.text, 'Look around the hall.');
  const next = pickInspiration(TABLE, s, { used: { 'look-1': 3 } }, 'success');
  assert.equal(next.hint.id, 'look-2', 'then the one after it');
  assert.deepEqual(next.suggest, [{ card: 'world/hall/README.md', option: 'read-ledger' }]);
  const setback = pickInspiration(TABLE, s, { used: {} }, 'setback');
  assert.equal(setback.text, 'The hall feels important.', 'a failure gets the vague reading');
  assert.deepEqual(setback.suggest, [], 'and no slips');
  const fumble = pickInspiration(TABLE, s, { used: {} }, 'failure');
  assert.equal(fumble.hint, null, 'a fumble gets no hint at all');
  assert.ok(![great, success, setback].some((p) => p.hint?.id === 'quiet'), 'skip is never picked');
  const elsewhere = pickInspiration(TABLE, state('world/garden'), { used: {} }, 'great');
  assert.equal(elsewhere.hint, null, 'nothing holds on a page the table does not cover');
  // Spent hints (every option they point at is done) are passed over.
  const spent = pickInspiration(TABLE, s, { used: {} }, 'great', new Set(['look-3', 'look-2']));
  assert.equal(spent.hint.id, 'look-1');
});

test('inspirationGate: one per clock step, one per few actions, a cap, a fumble doubles the wait', () => {
  const clockCfg = inspirationConfigOf({ clock: { path: 'c.md', key: 'left', start: 9 } });
  assert.equal(clockCfg.per, 'clock');
  assert.equal(clockCfg.cooldown, 1);
  assert.equal(inspirationGate(clockCfg, { uses: 0 }, { clockLeft: 9, actionsSince: 0 }).ok, true, 'the first roll is free');
  const tooSoon = inspirationGate(clockCfg, { uses: 1, last_clock: 9 }, { clockLeft: 9, actionsSince: 10 });
  assert.deepEqual(tooSoon, { ok: false, reason: 'cooldown', wait: 1, unit: 'clock', left: 4 });
  assert.equal(inspirationGate(clockCfg, { uses: 1, last_clock: 9 }, { clockLeft: 8, actionsSince: 0 }).ok, true);
  assert.equal(inspirationGate(clockCfg, { uses: 1, last_clock: 9, penalty: true }, { clockLeft: 8, actionsSince: 0 }).ok, false, 'a fumble doubles the wait');
  assert.deepEqual(inspirationGate(clockCfg, { uses: 5, last_clock: 9 }, { clockLeft: 1, actionsSince: 0 }), { ok: false, reason: 'max', left: 0 });
  const actCfg = inspirationConfigOf({});
  assert.equal(actCfg.per, 'actions');
  assert.equal(inspirationGate(actCfg, { uses: 1, last_seq: 3 }, { clockLeft: null, actionsSince: 2 }).ok, false);
  assert.equal(inspirationGate(actCfg, { uses: 1, last_seq: 3 }, { clockLeft: null, actionsSince: 3 }).ok, true);
  assert.equal(inspirationConfigOf({ inspiration: false }).enabled, false);
});

test('inspirationConfigProblems: strict about keys and small fumble costs', () => {
  assert.deepEqual(inspirationConfigProblems({}), []);
  assert.deepEqual(inspirationConfigProblems({ clock: {}, inspiration: { per: 'clock', fumble: [{ clock: -1 }], max: 4 } }), []);
  assert.match(inspirationConfigProblems({ inspiration: { per: 'clock' } }).join(), /no clock/);
  assert.match(inspirationConfigProblems({ inspiration: { fumble: { clock: -2 } } }).join(), /small/);
  assert.match(inspirationConfigProblems({ inspiration: { fumble: { boon: true } } }).join(), /never gives/);
  assert.match(inspirationConfigProblems({ inspiration: { colour: 'red' } }).join(), /unknown key/);
});

test('parsePassive: README defaults to enter, a card to look; it must give something', () => {
  const ok = parsePassive({ passive: [{ id: 'breath', skill: 'listen', say: 'Too even a breath.' }] }, true);
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.passives[0].on, 'enter');
  assert.equal(parsePassive({ passive: [{ id: 'cup', skill: 'spot_hidden', say: 'A lip mark.' }] }, false).passives[0].on, 'look');
  assert.match(parsePassive({ passive: [{ id: 'cup', skill: 'spot_hidden', on: 'enter', say: 'x' }] }, false).errors.join(), /place README/);
  assert.match(parsePassive({ passive: [{ id: 'x', skill: 'listen' }] }, true).errors.join(), /gives nothing/);
  assert.match(parsePassive({ passive: [{ id: 'x', skill: 'listen', find: { path: 'world/a/README.md', title: 't', body: 'b' } }] }, true).errors.join(), /not a README/);
  assert.match(parsePassive({ passive: [{ id: 'x', skill: 'sanity', say: 'x' }] }, true).errors.join(), /sheet skill/);
  const full = parsePassive({ passive: [{ id: 'x', skill: 'listen', difficulty: 'hard', when: { lacks: ['player/a.md'] }, find: { path: 'world/a/b.md', title: 'T', body: 'B', portable: false }, great: { say: 'More.' } }] }, true);
  assert.deepEqual(full.errors, []);
  assert.equal(full.passives[0].find.portable, false);
  assert.equal(full.passives[0].great.say, 'More.');
});

test('bestRoller: a helper rolls only when strictly better (or the player lacks the skill)', () => {
  const me = { actor: 'player', name: '', label: 'Listen', value: 50 };
  const kuri = { actor: 'kuri', name: 'Kuri', label: 'Listen', value: 70 };
  const weak = { actor: 'x', name: 'X', label: 'Listen', value: 50 };
  assert.equal(bestRoller(me, [kuri]).actor, 'kuri');
  assert.equal(bestRoller(me, [weak]).actor, 'player', 'a tie stays the player’s');
  assert.equal(bestRoller(null, [weak]).actor, 'x');
  assert.equal(bestRoller(null, []), null);
});

test('sheet: assist parses; skillUseOf falls back to the catalog line', () => {
  const { sheet, errors } = parseSheet({ sheet: { skills: [{ id: 'listen', value: 70, assist: true }, { id: 'occult', value: 20, assist: 'yes' }] } }, 'coc', 'zh-CN');
  assert.equal(sheet.skills[0].assist, true);
  assert.match(errors.join(), /assist is true or false/);
  assert.equal(skillUseOf('listen', undefined, 'zh-CN'), '听见声音和动静——呼吸、脚步、低语');
  assert.equal(skillUseOf('listen', 'Own words', 'zh-CN'), 'Own words');
  assert.equal(skillUseOf('made_up', undefined, 'en'), undefined);
});

test('tutorial cues: four languages, taught once', () => {
  for (const id of TUTORIAL_CUE_IDS) for (const lang of ['en', 'zh-CN', 'ja', 'ko']) {
    const t = tutorialCueText(id, lang);
    assert.ok(t.title && t.body, `${id}/${lang}`);
  }
  assert.equal(cueToTeach('first-inspiration', []), 'first-inspiration');
  assert.equal(cueToTeach('first-inspiration', ['first-inspiration']), null);
  assert.equal(cueToTeach('nope', []), null);
});

// ---------------------------------------------------------------------------
// The action path
// ---------------------------------------------------------------------------

async function world({ category = 'trpg', clock = true, hints = true, inspiration, kuriSheet, hallPassive, cardPassive } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-inspire-'));
  const store = new LocalWorldStore(root);
  const write = (rel, text) => store.writeFile(rel, text);
  await write('world.json', JSON.stringify({
    id: 'w', name: 'W', description: '', author: '', genre: 'test', locale: 'en', mode: 'closed',
    intro: { category },
    rules: { system: 'coc' },
    characters: [{ id: 'kuri', name: 'Kuri', role: 'companion', home: 'map' }],
    endings: [{ id: 'done', title: 'Done', path: 'endings/done/README.md' }],
    ...(clock ? { clock: { path: 'world/days.md', key: 'left', start: 9, label: 'Hours' } } : {}),
    ...(inspiration !== undefined ? { inspiration } : {}),
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  }));
  await write('world/README.md', '---\nname: Inn\ntype: readme\n---\n\nThe inn.\n');
  if (clock) await write('world/days.md', '---\nname: Days\ntype: note\nstatus:\n  data:\n    left: 9\n---\n\nThe calendar.\n');
  await write('world/hall/README.md', stringifyFrontmatter({ type: 'gate', name: 'Hall', ...(hallPassive ? { passive: hallPassive } : {}), choice: { options: [{ id: 'read-ledger', label: 'Read the ledger' }] }, choice_actions: { 'read-ledger': { kind: 'read', paths: ['world/hall/ledger.md'] } } }, 'A hall.'));
  await write('world/hall/ledger.md', stringifyFrontmatter({ type: 'note', title: 'Ledger', ...(cardPassive ? { passive: cardPassive } : {}) }, 'Names.'));
  await write('world/garden/README.md', stringifyFrontmatter({ type: 'gate', name: 'Garden' }, 'A garden.'));
  await write('endings/done/README.md', '---\ntitle: Done\n---\n\nDone.\n');
  await write('player/README.md', stringifyFrontmatter({
    type: 'readme', title: 'You',
    states: [{ id: 'hp', label: 'Wounds', type: 'number', initial: 10, range: [0, 10] }],
    sheet: { skills: [{ id: 'spot_hidden', label: 'Spot Hidden', value: 60 }, { id: 'listen', label: 'Listen', value: 40 }] },
  }, 'You.'));
  await write('characters/kuri/README.md', stringifyFrontmatter({ type: 'readme', name: 'Kuri', sheet: kuriSheet ?? { skills: [{ id: 'listen', label: 'Listen', value: 75, assist: true }, { id: 'inn_lore', label: 'Inn lore', value: 80, assist: true }] } }, 'Kuri.'));
  if (hints) await write('hints.json', JSON.stringify({ by: 'kuri', hints: [
    { id: 'hall-ledger', when: { layer: 'world/hall' }, say: 'The ledger on the desk.', suggest: [{ card: 'world/hall/README.md', option: 'read-ledger' }], inspire: { vague: 'Something about the desk.', sharp: 'The ledger — the old page.' } },
  ] }));
  return { root, store };
}

const fmOf = async (store, p) => parseFrontmatter(await store.readFile(p)).frontmatter;
const ctxOf = (store, rng, actor = { type: 'player' }) => ({ store, actor, turn: 'test:inspire', ...(rng ? { rng } : {}) });
const svc = (store, actor = { type: 'player' }, opts = {}) => createActionService(store, actor, { turn: 'test:inspire', ...opts });

test('inspire: a critical reaches the sharp line and its slip, records it, uses the hint up', async () => {
  const { store } = await world();
  const r = await inspire(ctxOf(store, () => 0), { page: 'world/hall' });
  assert.equal(r.details.grade, 'great');
  assert.equal(r.details.outcome, 'crit_success');
  assert.equal(r.details.label, 'Inspiration');
  assert.equal(r.details.target, 50);
  assert.equal(r.details.say, 'The ledger — the old page.');
  assert.equal(r.details.hint, 'hall-ledger');
  assert.deepEqual(r.details.suggest, [{ card: 'world/hall/README.md', option: 'read-ledger' }]);
  assert.equal(r.details.cue, 'first-inspiration');
  const readme = await fmOf(store, 'world/README.md');
  assert.equal(readme.inspiration_log.uses, 1);
  assert.equal(readme.inspiration_log.last_clock, 9);
  assert.ok(readme.hint_log.used['hall-ledger'] !== undefined, 'the companion will not repeat it');
  const events = await store.getEventsSince(0);
  const ev = events.find((e) => e.type === 'story_event' && e.detail.inspiration);
  assert.equal(ev.detail.inspiration.grade, 'great');
  assert.equal(ev.detail.text, 'The ledger — the old page.');
  // Too soon now: one per clock step.
  await assert.rejects(inspire(ctxOf(store, () => 0), { page: 'world/hall' }), (e) => e instanceof ActionError && e.code === 'conflict' && e.details.gate.reason === 'cooldown');
  const status = await inspirationStatus(ctxOf(store));
  assert.equal(status.gate.ok, false);
});

test('inspire: a failure gets the vague line and does not use the hint up', async () => {
  const { store } = await world();
  const r = await inspire(ctxOf(store, () => 0.7), { page: 'world/hall' });
  assert.equal(r.details.grade, 'setback');
  assert.equal(r.details.say, 'Something about the desk.');
  assert.deepEqual(r.details.suggest, []);
  const readme = await fmOf(store, 'world/README.md');
  assert.equal(readme.hint_log, undefined, 'nothing marked used');
});

test('inspire: nothing written here → a place not yet visited; nowhere new → go over what you hold', async () => {
  const { store } = await world({ hints: false, clock: false });
  const r = await inspire(ctxOf(store, () => 0.3), { page: 'map' });
  assert.equal(r.details.grade, 'success');
  assert.equal(r.details.suggest.length, 1);
  assert.ok(['world/hall', 'world/garden'].includes(r.details.suggest[0].enter));
  assert.match(r.details.say, /not been there yet/);
});

test('inspire: a fumble in a trpg world costs the clock a step', async () => {
  const { store } = await world();
  const r = await inspire(ctxOf(store, () => 0.97), { page: 'world/hall' });
  assert.equal(r.details.grade, 'failure');
  assert.equal(r.details.cost.kind, 'clock');
  assert.equal(await clockLeft(store), 8);
  assert.equal(r.details.hint, undefined);
});

test('inspire: a fumble in a story world costs nothing but doubles the wait', async () => {
  const { store } = await world({ category: 'story' });
  const r = await inspire(ctxOf(store, () => 0.97), { page: 'world/hall' });
  assert.equal(r.details.cost, undefined);
  assert.equal(await clockLeft(store), 9, 'no state is touched in a story world');
  assert.equal((await fmOf(store, 'world/README.md')).inspiration_log.penalty, true);
  assert.deepEqual(r.details.status.gate, { ok: false, reason: 'cooldown', wait: 2, unit: 'clock', left: 4 });
});

test('inspire: a world fumble chain, a sheet skill, off switch, god-only forcing', async () => {
  const w1 = await world({ inspiration: { skill: 'spot_hidden', fumble: [{ harm: 'light' }] } });
  const r = await inspire(ctxOf(w1.store, () => 0.97), { page: 'world/hall' });
  assert.equal(r.details.label, 'Spot Hidden');
  assert.equal(r.details.target, 60);
  assert.equal(r.details.cost.kind, 'harm');
  const w2 = await world({ inspiration: false });
  await assert.rejects(inspire(ctxOf(w2.store), {}), /turned the inspiration roll off/);
  const w3 = await world();
  await assert.rejects(inspire(ctxOf(w3.store), { forcedResult: 1 }), /god mode/);
  const forced = await inspire(ctxOf(w3.store, null, { type: 'god' }), { page: 'world/hall', forcedResult: 40 });
  assert.equal(forced.details.result, 40);
  assert.equal(forced.details.grade, 'success');
});

test('passive: entering a place rolls in the dark once per loop; a success lands the find and the line', async () => {
  const hallPassive = [{ id: 'draft', skill: 'spot_hidden', say: 'A draught under the desk.', find: { path: 'world/hall/draught.md', title: 'A draught', body: 'Cold air from below.', portable: false } }];
  const { store } = await world({ hallPassive });
  const writerEnter = await svc(store, { type: 'writer' }, { rng: () => 0.1 }).enterLayer({ layer: 'world/hall' });
  assert.equal(writerEnter.details.passive, undefined, 'only the player’s own steps roll');
  const r = await svc(store, { type: 'player' }, { rng: () => 0.1 }).enterLayer({ layer: 'world/hall' });
  assert.equal(r.details.passive.found.length, 1);
  assert.equal(r.details.passive.found[0].by, 'player');
  assert.equal(r.details.passive.cue, 'first-passive');
  const find = await fmOf(store, 'world/hall/draught.md');
  assert.equal(find.passive_find.skill, 'spot_hidden');
  assert.equal(find.portable, false);
  const ev = (await store.getEventsSince(0)).find((e) => e.type === 'story_event' && e.detail.passive);
  assert.equal(ev.detail.text, 'A draught under the desk.');
  const again = await svc(store, { type: 'player' }, { rng: () => 0.1 }).enterLayer({ layer: 'world/hall' });
  assert.equal(again.details.passive, undefined, 'tried once per loop');
});

test('passive: a failure leaves nothing visible but is logged', async () => {
  const hallPassive = [{ id: 'draft', skill: 'spot_hidden', say: 'A draught.' }];
  const { store } = await world({ hallPassive });
  const r = await runPassiveChecks(ctxOf(store, () => 0.8), { trigger: 'enter', layer: 'world/hall' });
  assert.deepEqual(r.found, []);
  assert.equal(r.rolled, 1);
  assert.equal((await fmOf(store, 'world/README.md')).passive_log['world/hall/README.md#draft'].grade, 'setback');
  assert.equal((await store.getEventsSince(0)).filter((e) => e.type === 'story_event').length, 0);
});

test('passive: a companion with the player rolls its specialty; nobody with the skill → not rolled, not logged', async () => {
  const hallPassive = [{ id: 'lore', skill: 'inn_lore', say: 'Kuri: this board creaks for a reason.' }];
  const { store } = await world({ hallPassive });
  const away = await runPassiveChecks(ctxOf(store, () => 0.5), { trigger: 'enter', layer: 'world/hall' });
  assert.equal(away.rolled, 0, 'Kuri is on the map, not here: nobody has the skill');
  assert.equal((await fmOf(store, 'world/README.md')).passive_log, undefined);
  await svc(store, { type: 'player' }).setFollowing({ character: 'kuri', following: true });
  const r = await svc(store, { type: 'player' }, { rng: () => 0.5 }).enterLayer({ layer: 'world/hall' });
  assert.equal(r.details.passive.found[0].by, 'kuri');
  const ev = (await store.getEventsSince(0)).find((e) => e.type === 'story_event' && e.detail.passive);
  assert.equal(ev.detail.target, 'characters/kuri', 'said by the companion');
  assert.equal(ev.detail.title, 'Kuri · Inn lore');
});

test('passive: reading a card (on: look) and the when gate', async () => {
  const cardPassive = [{ id: 'ink', skill: 'spot_hidden', when: { lacks: ['player/key.md'] }, say: 'One name is in fresher ink.' }];
  const { store } = await world({ cardPassive });
  const r = await runPassiveChecks(ctxOf(store, () => 0.2), { trigger: 'look', paths: ['world/hall/ledger.md'] });
  assert.equal(r.found[0].say, 'One name is in fresher ink.');
  const w2 = await world({ cardPassive });
  await w2.store.writeFile('player/key.md', '---\ntitle: Key\n---\n\nA key.\n');
  const gated = await runPassiveChecks(ctxOf(w2.store, () => 0.2), { trigger: 'look', paths: ['world/hall/ledger.md'] });
  assert.equal(gated.rolled, 0, 'when does not hold: not rolled');
});

test('assist: a following companion lends a better number to the player’s own check; no improvement mark', async () => {
  const { store } = await world();
  await svc(store, { type: 'player' }).setFollowing({ character: 'kuri', following: true });
  await svc(store, { type: 'player' }).enterLayer({ layer: 'world/hall' });
  const framed = await svc(store, { type: 'player' }).skillCheck({ skill: 'listen', layer: 'world/hall' });
  assert.equal(framed.details.expect, '<=75', 'Kuri’s Listen 75, not the player’s 40');
  assert.deepEqual(framed.details.assist, { actor: 'kuri', name: 'Kuri' });
  const card = await fmOf(store, framed.details.path);
  assert.equal(card.skill_check.assist, 'kuri');
  const rolled = await svc(store, { type: 'god' }).rollDice({ path: framed.details.path, forcedResult: 60 });
  assert.equal(rolled.details.passed, true);
  assert.deepEqual(rolled.details.skill.assist, { actor: 'kuri', name: 'Kuri' });
  assert.equal((await fmOf(store, 'player/README.md')).status?.data?.skill_marks, undefined, 'Kuri did the work');
  // A skill only Kuri has: the player can still use it while she is along.
  const lore = await svc(store, { type: 'player' }).skillCheck({ skill: 'inn_lore', layer: 'world/hall' });
  assert.equal(lore.details.expect, '<=80');
  // She stops following and stays on the map: the player's own number again.
  await svc(store, { type: 'player' }).setFollowing({ character: 'kuri', following: false });
  await svc(store, { type: 'player' }).enterLayer({ layer: 'world/garden' });
  const own = await svc(store, { type: 'player' }).skillCheck({ skill: 'listen', layer: 'world/garden' });
  assert.equal(own.details.expect, '<=40');
  await assert.rejects(svc(store, { type: 'player' }).skillCheck({ skill: 'inn_lore', layer: 'world/garden' }), /no skill "inn_lore"/);
});
