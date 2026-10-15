/**
 * Triggers + declared states.
 *
 * Pure parts (schema, planTriggers per kind, once semantics) are tested
 * directly; the engine goes through the real ActionService, so every firing
 * below is caused by an ordinary action (rollDice, createEntity, enterLayer)
 * and lands in real files and events.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  LocalWorldStore,
  createActionService,
  reachedEnding,
  clockLeft,
  StateDeclSchema,
  StatePackSchema,
  COC_STATE_PACK,
  DND_STATE_PACK,
  NARRATIVE_HP_PACK,
  parseStateDecls,
  mappedStates,
  currentStateValue,
  clampState,
  harmAmount,
  parseWorldTriggers,
  planTriggers,
  triggerHolds,
  readTriggerLog,
  runWorldTriggers,
  fireKeywordTrigger,
  activeKeywordIntents,
  keywordIntentsBlock,
  parseWorldCommand,
  WORLD_COMMAND_EFFECTS,
  RESERVED_FRONTMATTER_KEYS,
  parseFrontmatter,
} from '../dist/index.js';

const GOD = { type: 'god' };
const PLAYER = { type: 'player' };
const WRITER = { type: 'writer' };

/* ─────────────────────────── schema ─────────────────────────── */

const HP = {
  id: 'hp', label: '伤势', type: 'number', initial: 3, range: [0, 3],
  shown_as: [{ min: 3, text: '毫发无伤' }, { min: 2, text: '受了伤' }, { min: 1, text: '伤得很重' }, { max: 0, text: '奄奄一息' }],
};

test('state schema: number + range + bands, flag, enum, and the refusals', () => {
  assert.ok(StateDeclSchema.safeParse(HP).success);
  assert.ok(StateDeclSchema.safeParse({ id: 'lamp', label: '灯', type: 'flag', initial: false, shown_as: { true: '灯亮着' } }).success);
  assert.ok(StateDeclSchema.safeParse({ id: 'trust', label: '信任', type: 'enum', initial: 'wary', values: ['wary', 'open'], shown_as: { wary: '提防', open: '信任你' } }).success);
  const bad = [
    { ...HP, id: 'spot-hidden' },                 // hyphen: not a condition segment
    { ...HP, initial: 5 },                        // outside range
    { ...HP, range: [3, 0] },                     // inverted
    { ...HP, shown_as: { a: 'b' } },              // number needs bands
    { id: 'f', label: 'F', type: 'flag', initial: 'yes' },
    { id: 'e', label: 'E', type: 'enum', initial: 'x', values: ['a', 'b'] },
    { id: 'e', label: 'E', type: 'enum', initial: 'a', values: ['a', 'b'], shown_as: { c: 'x' } },
    { ...HP, extra: 1 },                          // strict
  ];
  for (const b of bad) assert.equal(StateDeclSchema.safeParse(b).success, false, JSON.stringify(b));
});

test('the example rule packs (narrative / CoC / DND) are valid state packs', () => {
  for (const pack of [NARRATIVE_HP_PACK, COC_STATE_PACK, DND_STATE_PACK]) {
    const r = StatePackSchema.safeParse(pack);
    assert.ok(r.success, JSON.stringify(r.error?.issues));
  }
});

test('mapped states: prose bands, hidden omitted, values clamped, bad entries dropped', () => {
  const fm = {
    states: [HP, { id: 'secret', label: 'S', type: 'number', initial: 1, hidden: true }, { id: 'bad-id', label: 'x', type: 'flag', initial: true }],
    status: { data: { hp: 7 } },
  };
  const { states, errors } = parseStateDecls(fm);
  assert.equal(states.length, 2);
  assert.equal(errors.length, 1);
  assert.equal(currentStateValue(states[0], fm.status.data), 3); // clamped
  assert.deepEqual(mappedStates(fm), [{ id: 'hp', label: '伤势', text: '毫发无伤' }]);
  assert.deepEqual(mappedStates({ ...fm, status: { data: { hp: 0 } } }).map((s) => s.text), ['奄奄一息']);
  assert.equal(clampState(states[0], -4), 0);
  // No number ever: the bands are all the panel says.
  assert.ok(!mappedStates({ ...fm, status: { data: { hp: 2 } } }).some((s) => /\d/.test(s.text)));
});

test('harm scales with the range and a grave wound never kills from full health', () => {
  const hp = StateDeclSchema.parse(HP);
  assert.deepEqual(['light', 'serious', 'grave'].map((s) => harmAmount(hp, s)), [1, 1, 2]);
  const big = StateDeclSchema.parse({ ...HP, initial: 12, range: [0, 12], shown_as: undefined });
  assert.deepEqual(['light', 'serious', 'grave'].map((s) => harmAmount(big, s)), [3, 6, 11]);
});

test('trigger schema: five kinds, a consequence required, bad entries dropped fail-soft', () => {
  const { triggers, errors } = parseWorldTriggers([
    { id: 'departed', kind: 'clock', when: 'clock <= 0', ending: 'departed' },
    { id: 'confront', kind: 'state', when: 'clues.held >= 3', clues: ['world/a.md'], do: 'wayne-confronts' },
    { id: 'accuse', kind: 'keyword', when: { intent: '玩家指认韦恩是凶手' }, ending: 'caught' },
    { id: 'fog', kind: 'place', when: { layer: 'world/fog' }, fallback: '雾吞没了脚步声。' },
    { id: 'fumble', kind: 'dice', when: { layer: 'world/fog', band: 'failure' }, ending: 'lost' },
    { id: 'no-effect', kind: 'place', when: { layer: 'map' } },
    { id: 'bad-clock', kind: 'clock', when: 'player.hp <= 0', ending: 'x' },
    { id: 'confront', kind: 'place', when: { layer: 'map' }, fallback: 'dup' },
    { id: 'empty-dice', kind: 'dice', when: {}, fallback: 'x' },
    { id: 'asset', kind: 'place', when: { layer: 'map' }, fallback: 'x', assets: [{ kind: 'cg', path: 'assets/cg/x.webp', prompt: 'p' }] },
    { id: 'bad-asset', kind: 'place', when: { layer: 'map' }, fallback: 'x', assets: [{ kind: 'cg', path: '../x.webp', prompt: 'p' }] },
  ]);
  assert.deepEqual(triggers.map((t) => t.id), ['departed', 'confront', 'accuse', 'fog', 'fumble', 'asset']);
  assert.equal(errors.length, 5, errors.join('\n'));
  assert.equal(triggers[2].when.scope, 'player'); // default
  assert.equal(triggers[0].once, true);          // default
});

/* ─────────────────────────── pure evaluator ─────────────────────────── */

const snap = (values = {}, extra = {}) => ({
  values: new Map(Object.entries(values)),
  paths: new Map(Object.entries(extra.paths ?? {})),
  clues: new Map(Object.entries(extra.clues ?? {})),
  ended: extra.ended ?? false,
});
const ACTION = { kind: 'action', action: 'editEntity' };
const T = (list) => parseWorldTriggers(list).triggers;

test('clock kind: the endings[].when grammar over clock.left', () => {
  const [t] = T([{ id: 'c', kind: 'clock', when: 'clock <= 0', ending: 'x' }]);
  assert.equal(triggerHolds(t, snap({ 'clock.left': 1 }), ACTION), false);
  assert.equal(triggerHolds(t, snap({ 'clock.left': 0 }), ACTION), true);
  assert.equal(triggerHolds(t, snap({}), ACTION), false); // no clock
});

test('state kind: states, clue counts, has() and character refs', () => {
  const [t] = T([{ id: 's', kind: 'state', when: 'clues.held >= 3 && has("player/letter.md") && xia_cheng.trust == "open" || player.hp <= 0', clues: ['world/a.md', 'world/b.md', 'world/c.md'], fallback: 'x' }]);
  const ids = ['xia-cheng'];
  const base = { 'player.hp': 2, 'xia_cheng.trust': 'open' };
  assert.equal(triggerHolds(t, snap(base, { paths: { 'player/letter.md': 'file' }, clues: { s: { held: 2, total: 3 } } }), ACTION, ids), false);
  assert.equal(triggerHolds(t, snap(base, { paths: { 'player/letter.md': 'file' }, clues: { s: { held: 3, total: 3 } } }), ACTION, ids), true);
  assert.equal(triggerHolds(t, snap(base, { paths: { 'player/letter.md': 'missing' }, clues: { s: { held: 3, total: 3 } } }), ACTION, ids), false);
  assert.equal(triggerHolds(t, snap({ ...base, 'player.hp': 0 }, { paths: { 'player/letter.md': 'missing' } }), ACTION, ids), true);
  // An undeclared state is "not yet", never a throw.
  const [u] = T([{ id: 'u', kind: 'state', when: 'player.sanity < 10', fallback: 'x' }]);
  assert.equal(triggerHolds(u, snap({}), ACTION), false);
});

test('keyword / place / dice kinds only answer their own cause', () => {
  const [k, p, d] = T([
    { id: 'k', kind: 'keyword', when: { intent: 'accuse' }, ending: 'x' },
    { id: 'p', kind: 'place', when: { layer: 'world/fog' }, fallback: 'x' },
    { id: 'd', kind: 'dice', when: { card: 'world/fog/', band: 'failure' }, ending: 'x' },
  ]);
  const roll = (over) => ({ kind: 'roll', path: 'world/fog/search-1.md', layer: 'world/fog', result: 3, passed: false, crit: false, fumble: false, band: 'failure', ...over });
  assert.equal(triggerHolds(k, snap(), ACTION), false);
  assert.equal(triggerHolds(k, snap(), { kind: 'keyword', id: 'k' }), true);
  assert.equal(triggerHolds(p, snap(), { kind: 'enter', layer: 'world/fog' }), true);
  assert.equal(triggerHolds(p, snap(), { kind: 'enter', layer: 'map' }), false);
  assert.equal(triggerHolds(d, snap(), roll()), true);
  assert.equal(triggerHolds(d, snap(), roll({ band: 'setback' })), false);
  assert.equal(triggerHolds(d, snap(), roll({ path: 'world/street/search-1.md' })), false);
  assert.equal(triggerHolds(d, snap(), ACTION), false);
});

test('once semantics: once fires once; once:false re-arms (level) or fires per fact (event)', () => {
  const triggers = T([
    { id: 'once', kind: 'state', when: 'player.hp <= 1', fallback: 'x' },
    { id: 'again', kind: 'state', when: 'player.hp <= 1', once: false, fallback: 'x' },
    { id: 'every-roll', kind: 'dice', when: { passed: false }, once: false, fallback: 'x' },
  ]);
  const low = snap({ 'player.hp': 1 });
  const high = snap({ 'player.hp': 3 });
  const plan1 = planTriggers(triggers, low, ACTION, {}, 't1');
  assert.deepEqual(plan1.fire.map((t) => t.id), ['once', 'again']);
  const log = { once: { count: 1, turn: 't1', at: '', status: 'done' }, again: { count: 1, turn: 't1', at: '', status: 'done', holding: true } };
  assert.deepEqual(planTriggers(triggers, low, ACTION, log, 't2').fire, []);
  const rel = planTriggers(triggers, high, ACTION, log, 't3');
  assert.deepEqual(rel.release, ['again']);
  assert.deepEqual(planTriggers(triggers, low, ACTION, { ...log, again: { ...log.again, holding: false } }, 't4').fire.map((t) => t.id), ['again']);
  const roll = (p) => ({ kind: 'roll', path: p, layer: 'map', result: 2, passed: false, crit: false, fumble: true, band: 'failure' });
  const r1 = planTriggers(triggers, high, roll('world/a.md'), {}, 't5');
  assert.deepEqual(r1.fire.map((t) => t.id), ['every-roll']);
  const seen = { 'every-roll': { count: 1, turn: 't5', at: '', status: 'done', fact: 'world/a.md' } };
  assert.deepEqual(planTriggers(triggers, high, roll('world/a.md'), seen, 't6').fire, []);
  assert.deepEqual(planTriggers(triggers, high, roll('world/b.md'), seen, 't6').fire.map((t) => t.id), ['every-roll']);
  // An ended world fires nothing.
  assert.deepEqual(planTriggers(triggers, { ...low, ended: true }, ACTION, {}, 't7').fire, []);
});

/* ─────────────────────────── engine fixtures ─────────────────────────── */

async function world({ triggers = [], endings, clock = true, playerStates = [HP], mode = 'closed', characters = [] } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-triggers-'));
  const store = new LocalWorldStore(root);
  const write = (rel, text) => store.writeFile(rel, text);
  await write('world.json', JSON.stringify({
    id: 'w', name: 'W', description: '', author: '', genre: 'test', characters,
    mode,
    ...(clock ? { clock: { path: 'world/clock.md', key: 'left', start: 2, label: 'Left' } } : {}),
    endings: endings ?? [
      { id: 'departed', title: 'Departed', path: 'endings/departed/README.md', when: 'clock <= 0' },
      { id: 'caught', title: 'Caught', path: 'endings/caught/README.md' },
      { id: 'dead', title: 'Dead', path: 'endings/dead/README.md' },
    ],
    triggers,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }));
  await write('world/README.md', '---\nname: Street\ntype: readme\n---\n\n# Street\n');
  await write('world/fog/README.md', '---\nname: Fog\ntype: readme\n---\n\n# Fog\n');
  await write('world/clock.md', '---\nname: Clock\ntype: note\nstatus:\n  data:\n    left: 2\n---\n\nTick.\n');
  const statesYaml = playerStates.length ? `states: ${JSON.stringify(playerStates)}\n` : '';
  await write('player/README.md', `---\ntype: readme\ntitle: You\n${statesYaml}---\n\nYou.\n`);
  for (const id of ['departed', 'caught', 'dead']) await write(`endings/${id}/README.md`, `---\ntype: ending\ntitle: ${id}\n---\n\n${id}.\n`);
  await write('command/tick.yaml', 'name: Tick\ndo:\n  - action: tick\n    with:\n      by: "-1"\n');
  return { store, write, root };
}

function diceCard({ harm = {}, on = true, layer = 'world' } = {}) {
  const band = (min, max, grade) => ({ min, max, text: grade, options: [{ id: 'ok', label: 'ok', action: { kind: 'writer', prompt: 'x' } }], ...(harm[grade] ? { harm: harm[grade] } : {}) });
  const fm = {
    type: 'chalk', title: 'Search',
    roll_dice: { type: '2d10', desc: 'Search', expect: '>=11' },
    dice_outcomes: [band(2, 4, 'failure'), band(5, 10, 'setback'), band(11, 17, 'success'), band(18, 20, 'great')],
    ...(on ? { on: { roll_resolved: [{ run: 'tick' }] } } : {}),
  };
  return `---\n${toYaml(fm)}---\n\nSearch.\n`;
}
// JSON is valid YAML flow style, but the roll patcher needs a block `roll_dice:`.
function toYaml(fm) {
  const lines = [];
  for (const [k, v] of Object.entries(fm)) {
    if (k === 'roll_dice') {
      lines.push('roll_dice:', `  type: ${v.type}`, `  desc: ${v.desc}`, `  expect: "${v.expect}"`);
    } else lines.push(`${k}: ${JSON.stringify(v)}`);
  }
  return lines.join('\n') + '\n';
}

/* ─────────────────────────── engine ─────────────────────────── */

test('state trigger: the third key clue makes the culprit confront the player — once, recorded with its turn', async () => {
  const { store, write } = await world({
    characters: [{ id: 'wayne', home: 'map', name: 'Wayne' }],
    triggers: [{
      id: 'wayne-confronts', kind: 'state', when: 'clues.held >= 3',
      clues: ['world/clue-a.md', 'world/clue-b.md', 'world/clue-c.md'],
      do: 'confront', fallback: '韦恩堵在了门口。',
    }],
  });
  await write('characters/wayne/README.md', '---\ntype: readme\nname: Wayne\n---\n\nWayne.\n');
  await write('command/confront.yaml', 'name: Confront\ndo:\n  - action: event\n    with:\n      target: characters/wayne\n      title: 摊牌\n      text: 韦恩放下画笔，转身看着你。\n');
  const svc = createActionService(store, GOD, { turn: 'req:s1' });
  const a = await svc.createEntity({ path: 'world/clue-a.md', frontmatter: { type: 'note', title: 'A' }, body: 'a' });
  assert.equal(a.details.triggers, undefined);
  await svc.createEntity({ path: 'world/clue-b.md', frontmatter: { type: 'note', title: 'B' }, body: 'b' });
  const svc2 = createActionService(store, GOD, { turn: 'req:s2' });
  const c = await svc2.createEntity({ path: 'player/clue-c.md', frontmatter: { type: 'note', title: 'C' }, body: 'c' }); // carried counts
  assert.deepEqual(c.details.triggers.map((t) => [t.id, t.settle, t.effects, t.fallback]), [['wayne-confronts', 'ran', 1, false]]);
  const log = await readTriggerLog(store);
  assert.equal(log['wayne-confronts'].turn, 'req:s2');
  assert.equal(log['wayne-confronts'].status, 'done');
  // Retry of the same request, and any later action: nothing fires again.
  assert.deepEqual(await runWorldTriggers(svc2.ctx, { kind: 'action', action: 'createEntity' }), []);
  const d = await svc.createEntity({ path: 'world/clue-d.md', frontmatter: { type: 'note', title: 'D' }, body: 'd' });
  assert.equal(d.details.triggers, undefined);
  const events = await store.getEvents(50);
  assert.equal(events.filter((e) => e.type === 'story_event').length, 1);
});

test('fired record persists in the save file (world/README.md trigger_log) and is reserved from commands', async () => {
  const { store } = await world({ triggers: [{ id: 'fog', kind: 'place', when: { layer: 'world/fog' }, fallback: '雾吞没了脚步声。' }] });
  const svc = createActionService(store, PLAYER, { turn: 'req:p1' });
  const r = await svc.enterLayer({ layer: 'world/fog' });
  assert.deepEqual(r.details.triggers.map((t) => [t.id, t.fallback]), [['fog', true]]);
  const fm = parseFrontmatter(await store.readFile('world/README.md')).frontmatter;
  assert.equal(fm.trigger_log.fog.turn, 'req:p1');
  assert.ok(RESERVED_FRONTMATTER_KEYS.includes('trigger_log'));
  const again = await createActionService(store, PLAYER, { turn: 'req:p2' }).enterLayer({ layer: 'world/fog' });
  assert.equal(again.details.triggers, undefined);
  const stories = (await store.getEvents(50)).filter((e) => e.type === 'story_event');
  assert.equal(stories.length, 1);
  assert.equal(stories[0].detail.text, '雾吞没了脚步声。');
  assert.equal(stories[0].layer, 'world/fog');
});

test('clock trigger ≡ endings[].when: the same rolls reach the same ending', async () => {
  const legacy = await world();
  const viaTrigger = await world({
    endings: [
      { id: 'departed', title: 'Departed', path: 'endings/departed/README.md' },
      { id: 'caught', title: 'Caught', path: 'endings/caught/README.md' },
      { id: 'dead', title: 'Dead', path: 'endings/dead/README.md' },
    ],
    triggers: [{ id: 'train-leaves', kind: 'clock', when: 'clock <= 0', ending: 'departed' }],
  });
  for (const w of [legacy, viaTrigger]) {
    await w.write('world/d1.md', diceCard());
    await w.write('world/d2.md', diceCard());
    const svc = createActionService(w.store, GOD, { turn: 'req:c1' });
    await svc.rollDice({ path: 'world/d1.md', forcedResult: 12 });
    assert.equal(await reachedEnding(w.store), null);
    await createActionService(w.store, GOD, { turn: 'req:c2' }).rollDice({ path: 'world/d2.md', forcedResult: 12 });
    assert.equal(await clockLeft(w.store), 0);
    assert.equal((await reachedEnding(w.store))?.id, 'departed');
  }
});

test('hidden hp: harmful bands lower it by severity, the panel says prose, and hp <= 0 ends the story', async () => {
  const { store, write } = await world({
    clock: false,
    triggers: [{ id: 'death', kind: 'state', when: 'player.hp <= 0', ending: 'dead' }],
  });
  await write('world/d1.md', diceCard({ on: false, harm: { failure: 'grave' } }));
  await write('world/d2.md', diceCard({ on: false, harm: { failure: 'light' } }));
  const r1 = await createActionService(store, GOD, { turn: 'req:h1' }).rollDice({ path: 'world/d1.md', forcedResult: 3 });
  assert.deepEqual(r1.details.harm, { severity: 'grave' });
  assert.ok(!JSON.stringify(r1.details.harm).match(/\d/), 'no hp number in the result');
  let fm = parseFrontmatter(await store.readFile('player/README.md')).frontmatter;
  assert.equal(fm.status.data.hp, 1);
  assert.deepEqual(mappedStates(fm).map((s) => s.text), ['伤得很重']);
  assert.equal(await reachedEnding(store), null);
  const r2 = await createActionService(store, GOD, { turn: 'req:h2' }).rollDice({ path: 'world/d2.md', forcedResult: 2 });
  assert.deepEqual(r2.details.triggers.map((t) => [t.id, t.ending]), [['death', 'dead']]);
  assert.equal((await reachedEnding(store))?.id, 'dead');
  fm = parseFrontmatter(await store.readFile('player/README.md')).frontmatter;
  assert.deepEqual(mappedStates(fm).map((s) => s.text), ['奄奄一息']);
  // The card keeps a receipt: harm lands once per card.
  assert.match(await store.readFile('world/d1.md'), /harm_receipt/);
});

test('harm is ignored in an open world and where the player declares no hp', async () => {
  for (const opts of [{ mode: 'open' }, { playerStates: [] }]) {
    const { store, write } = await world({ clock: false, ...opts });
    await write('world/d1.md', diceCard({ on: false, harm: { failure: 'grave' } }));
    const r = await createActionService(store, GOD, { turn: 'req:o1' }).rollDice({ path: 'world/d1.md', forcedResult: 3 });
    assert.equal(r.details.harm, undefined);
  }
});

test('dice trigger: a failure in the fog kills', async () => {
  const { store, write } = await world({
    clock: false,
    triggers: [{ id: 'lost-in-fog', kind: 'dice', when: { card: 'world/fog/', band: 'failure' }, ending: 'dead' }],
  });
  await write('world/fog/d1.md', diceCard({ on: false }));
  await write('world/fog/d2.md', diceCard({ on: false }));
  const ok = await createActionService(store, GOD, { turn: 'req:f1' }).rollDice({ path: 'world/fog/d1.md', forcedResult: 12 });
  assert.equal(ok.details.triggers, undefined);
  const bad = await createActionService(store, GOD, { turn: 'req:f2' }).rollDice({ path: 'world/fog/d2.md', forcedResult: 2 });
  assert.deepEqual(bad.details.triggers.map((t) => t.ending), ['dead']);
});

test('set_state / add_state: typed, clamped, and refused on the wrong type', async () => {
  const { store, write } = await world({
    clock: false,
    playerStates: [HP, { id: 'mood', label: '心情', type: 'enum', initial: 'calm', values: ['calm', 'shaken'] }],
    triggers: [{ id: 'crash', kind: 'place', when: { layer: 'world/fog' }, do: 'crash' }],
  });
  assert.ok(WORLD_COMMAND_EFFECTS.includes('set_state') && WORLD_COMMAND_EFFECTS.includes('add_state'));
  const yaml = [
    'name: Crash', 'do:',
    '  - action: add_state', '    with:', '      target: player', '      state: hp', '      by: "-10"',
    '  - action: set_state', '    with:', '      target: player', '      state: mood', '      value: shaken',
    '  - action: set_state', '    with:', '      target: player', '      state: mood', '      value: furious',
    '',
  ].join('\n');
  assert.ok(parseWorldCommand('crash', yaml).ok);
  await write('command/crash.yaml', yaml);
  const r = await createActionService(store, PLAYER, { turn: 'req:x1' }).enterLayer({ layer: 'world/fog' });
  const fired = r.details.triggers[0];
  assert.equal(fired.settle, 'failed');   // the third step refused "furious"
  assert.equal(fired.effects, 2);
  const fm = parseFrontmatter(await store.readFile('player/README.md')).frontmatter;
  assert.equal(fm.status.data.hp, 0);     // clamped, not -7
  assert.equal(fm.status.data.mood, 'shaken');
  assert.equal((await readTriggerLog(store)).crash.status, 'failed');
});

test('the writer cannot edit a declared state or the trigger record; god can', async () => {
  const { store } = await world({ clock: false });
  const writer = createActionService(store, WRITER, { turn: 'turn:w1' });
  await assert.rejects(
    () => writer.editEntity({ path: 'player/README.md', frontmatter: { status: { data: { hp: 3, note: 'x' } } } }).then(() =>
      writer.editEntity({ path: 'player/README.md', frontmatter: { status: { data: { hp: 0 } } } })),
    (err) => err.code === 'invalid_argument' && /dice and world commands/.test(err.message),
  );
  await assert.rejects(() => writer.editEntity({ path: 'world/README.md', frontmatter: { trigger_log: {} } }), (err) => err.code === 'invalid_argument');
  await createActionService(store, GOD, { turn: 'req:g1' }).editEntity({ path: 'player/README.md', frontmatter: { status: { data: { hp: 1 } } } });
  assert.equal(parseFrontmatter(await store.readFile('player/README.md')).frontmatter.status.data.hp, 1);
});

test('keyword trigger: the writer sees intents (not consequences); the tool validates, fires once, ends the story', async () => {
  const { store } = await world({
    clock: false,
    triggers: [
      { id: 'accuse-wayne', kind: 'keyword', when: { intent: '玩家明确指认韦恩就是凶手' }, ending: 'caught' },
      { id: 'harbour-only', kind: 'keyword', when: { intent: '在雾里呼救', layers: ['world/fog'], scope: 'any' }, fallback: '有人听见了。' },
      { id: 'place', kind: 'place', when: { layer: 'world/fog' }, fallback: 'x' },
    ],
  });
  const intents = await activeKeywordIntents(store, 'map');
  assert.deepEqual(intents.map((k) => k.id), ['accuse-wayne']);
  const block = keywordIntentsBlock(intents);
  assert.match(block, /玩家明确指认韦恩就是凶手/);
  assert.ok(!/caught/.test(block), 'the consequence is never shown');
  assert.deepEqual((await activeKeywordIntents(store, 'world/fog')).map((k) => k.id), ['accuse-wayne', 'harbour-only']);

  const ctx = createActionService(store, WRITER, { turn: 'turn:k1' }).ctx;
  await assert.rejects(() => fireKeywordTrigger(ctx, { id: 'nope', layer: 'map' }), (e) => e.code === 'not_found');
  await assert.rejects(() => fireKeywordTrigger(ctx, { id: 'place', layer: 'map' }), (e) => e.code === 'invalid_argument');
  await assert.rejects(() => fireKeywordTrigger(ctx, { id: 'harbour-only', layer: 'map' }), (e) => /only counts in world\/fog/.test(e.message));
  await assert.rejects(() => fireKeywordTrigger(ctx, { id: 'accuse-wayne', layer: 'map', by: 'character' }), (e) => /player's own/.test(e.message));
  const fired = await fireKeywordTrigger(ctx, { id: 'accuse-wayne', layer: 'map' });
  assert.equal(fired.ending, 'caught');
  assert.equal((await reachedEnding(store))?.id, 'caught');
  await assert.rejects(() => fireKeywordTrigger(ctx, { id: 'accuse-wayne', layer: 'map' }), (e) => e.code === 'game_ended');
  assert.deepEqual(await activeKeywordIntents(store, 'map'), []);
});

test('a keyword fires once even when the world keeps going', async () => {
  const { store } = await world({ clock: false, triggers: [{ id: 'call', kind: 'keyword', when: { intent: '呼救' }, fallback: '有人听见了。' }] });
  const ctx = createActionService(store, WRITER, { turn: 'turn:k2' }).ctx;
  const fired = await fireKeywordTrigger(ctx, { id: 'call', layer: 'map' });
  assert.equal(fired.fallback, true);
  await assert.rejects(() => fireKeywordTrigger(ctx, { id: 'call', layer: 'map' }), (e) => /already fired/.test(e.message));
});

test('worlds without triggers are untouched: no trigger_log, no details.triggers', async () => {
  const { store, write } = await world({ triggers: [] });
  await write('world/d1.md', diceCard());
  const r = await createActionService(store, GOD, { turn: 'req:n1' }).rollDice({ path: 'world/d1.md', forcedResult: 12 });
  assert.equal(r.details.triggers, undefined);
  assert.doesNotMatch(await store.readFile('world/README.md'), /trigger_log/);
});
