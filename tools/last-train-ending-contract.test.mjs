// 末班车 (templates/last-train, last-train-jp, last-train-zh; written in Chinese) — both endings are reachable by play, and only
// by play.
//
// Two halves:
//   1. The evidence the good ending asks for really exists in the world: every
//      `has("player/<x>.md")` in report-truth names something a carriage's
// search or the confrontation roll creates, or
//      a card lies in a carriage waiting to be taken.
//   2. The rules, on a scratch copy through the real action layer: a thin report
//      costs a step and ends nothing; either evidence route ends `found`; the
//      clock running out ends `departed`; nothing works afterwards.
// (Dice rewards themselves are created by the server's dice shim; the tests
// here take the evidence into the bag the way the "take" button does.)
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { LocalWorldStore, createActionService, parseFrontmatter, parseSearchDeclarations, searchFinds, reachedEnding, clockLeft, parseStateDecls, currentStateValue, harmAmount, stateProse, parseHintTable, buildInteractiveFields, visibleChoiceOptions, runTurnEnd, endingTextOf } from '../packages/shared/dist/index.js';
import { runDeclaredRoll } from '../apps/server/dist/engine/declared-actions.js';

// Every edition plays the same: ids, paths, dice, bands and commands are identical
// across the three (check:worlds); the Chinese edition is where the prose was written.
const EDITIONS = ['last-train', 'last-train-jp', 'last-train-zh', 'last-train-ko'];
const templateOf = (edition) => fileURLToPath(new URL(`../templates/${edition}`, import.meta.url));
const GOD = { type: 'god' };
const RADIO = 'world/cab/02-radio-report.md';
/** Act Three's shortcut: 夏澄 radios from the cab; the same command. */
const RELAY = 'world/freight-car/06-radio-relay.md';
/** The three searchable carriages (the cab's key-board search was cut, the design notes); each search lands `search-scene.md`. */
const CARS = ['world/seated-car', 'world/sleeper', 'world/dining-car'];
const CONFRONT = 'world/freight-car/04-confront-dice.md';
const DICE = [...CARS.map((car) => `${car}/search-scene.md`), CONFRONT];

/** Where each piece of evidence starts: a dice reward or a card in a carriage. */
const EVIDENCE_SOURCE = {
  'su-he-testimony.md': 'world/freight-car/su-he-testimony.md',
  'logbook-page.md': 'world/freight-car/logbook-page.md',
  'pill-strip.md': 'world/sleeper/pill-strip.md',
  'tea-bill.md': 'world/dining-car/tea-bill.md',
};


/**
 * The world's checks are d100 skill checks now (the design notes;
 * the skills they test sit at 60). The scenarios below were written in the old
 * 2d10 bands; this maps a 2d10 total to a d100 roll in the same band.
 */
const asD100 = (r) => (r <= 4 ? 98 : r <= 10 ? 80 : r <= 17 ? 30 : 5);

for (const EDITION of EDITIONS) {
  const TEMPLATE = templateOf(EDITION);
  const zh = EDITION === 'last-train-zh';
  async function play() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'last-train-'));
    await fs.cp(TEMPLATE, root, { recursive: true });
    const store = new LocalWorldStore(root);
    let n = 0;
    const svc = () => createActionService(store, GOD, { turn: `req:train-${++n}` });
    /** Put a piece of evidence in the bag, as the reward / take button would. */
    const carry = async (name) => {
      await store.writeFile(`player/${name}`, `---\nname: ${name}\ntype: note\nportable: true\n---\n\nEvidence.\n`);
    };
    const report = () => svc().chooseOption({ path: RADIO, choice: 'report' });
    /** Search a carriage (unless it is the confrontation card) and roll it. */
    const roll = async (card, result) => {
      if (card !== CONFRONT) await svc().searchPlace({ layer: path.posix.dirname(card), spot: 'scene' });
      return svc().rollDice({ path: card, forcedResult: asD100(result) });
    };
    const hp = async () => {
      const fm = parseFrontmatter(await store.readFile('player/README.md')).frontmatter;
      return currentStateValue(parseStateDecls(fm).states.find((st) => st.id === 'hp'), fm?.status?.data);
    };
    return { store, svc, carry, report, roll, hp };
  }

  test(`${EDITION}: the world is closed, with a clock and exactly two endings`, async () => {
    const manifest = JSON.parse(await fs.readFile(path.join(TEMPLATE, 'world.json'), 'utf8'));
    assert.equal(manifest.mode, 'closed');
    assert.notEqual(manifest.exp, true, 'an official edition, not an experiment');
    assert.deepEqual(manifest.view, { default: 'map' }, 'a TRPG world with maps: the overview is a map');
    // Three acts: the run opens in 2 车 on the canvas, the overview is the map, each car a canvas.
    assert.equal(manifest.entry, 'world/seated-car', 'act one starts in the seated car');
    assert.equal(manifest.characters.find((c) => c.id === 'xia-cheng').home, 'world/seated-car');
    assert.equal(manifest.clock.start, 8, 'one search fewer, one step fewer');
    assert.deepEqual(manifest.intro.minutes, [25, 35]);
    assert.deepEqual(manifest.endings.map((e) => e.id).sort(), ['departed', 'found']);
    for (const e of manifest.endings) await fs.access(path.join(TEMPLATE, e.path));
    assert.equal(manifest.opening?.greeter, 'xia-cheng', 'the companion speaks first');
  });

  test(`${EDITION}: every piece of evidence the good ending asks for exists in the world`, async () => {
    const command = await fs.readFile(path.join(TEMPLATE, 'command/report-truth.yaml'), 'utf8');
    const asked = [...command.matchAll(/has\("player\/([a-z-]+\.md)"\)/g)].map((m) => m[1]);
    assert.ok(asked.length >= 3);
    const finds = new Set();
    for (const car of CARS) {
      const fm = parseFrontmatter(await fs.readFile(path.join(TEMPLATE, car, 'README.md'), 'utf8')).frontmatter;
      const { spots, errors } = parseSearchDeclarations(fm);
      assert.deepEqual(errors, [], car);
      for (const spot of spots) for (const find of searchFinds(spot)) finds.add(find);
      await assert.rejects(fs.access(path.join(TEMPLATE, car, '04-investigation-dice.md')), `${car}: no pre-placed dice card`);
    }
    const confront = await fs.readFile(path.join(TEMPLATE, CONFRONT), 'utf8');
    for (const name of new Set(asked)) {
      const source = EVIDENCE_SOURCE[name];
      assert.ok(source, `no known source for ${name}`);
      const rewarded = finds.has(source) || confront.includes(`path: ${source}`);
      const lying = await fs.access(path.join(TEMPLATE, source)).then(() => true, () => false);
      assert.ok(rewarded || lying, `${name}: neither a dice reward nor a card at ${source}`);
    }
    // The freight car's gate key is found by searching the dining car.
    const freight = parseFrontmatter(await fs.readFile(path.join(TEMPLATE, 'world/freight-car/README.md'), 'utf8')).frontmatter;
    assert.deepEqual(freight.requires.items, ['player/freight-key.md']);
    assert.ok(finds.has('world/dining-car/freight-key.md'));
    assert.equal(await fs.access(path.join(TEMPLATE, 'world/dining-car/freight-key.md')).then(() => true, () => false), false, 'the key exists only after the roll');
  });

  test(`${EDITION}: a report without enough evidence ends nothing and costs a step`, async () => {
    const { store, carry, report } = await play();
    const start = await clockLeft(store);
    await carry('su-he-testimony.md');
    await report();
    assert.equal(await reachedEnding(store), null);
    assert.equal(await clockLeft(store), start - 1);
  });

  test(`${EDITION}: found, route A: her testimony and the logbook page`, async () => {
    const { store, carry, report } = await play();
    await carry('su-he-testimony.md');
    await carry('logbook-page.md');
    await report();
    assert.equal((await reachedEnding(store))?.id, 'found');
  });

  test(`${EDITION}: found, route B: her testimony, the pill strip and the tea bill`, async () => {
    const { store, carry, report } = await play();
    await carry('su-he-testimony.md');
    await carry('pill-strip.md');
    await report(); // not enough yet — costs a step
    assert.equal(await reachedEnding(store), null);
    await carry('tea-bill.md');
    await report(); // the evidence changed, so the same choice is judged again
    assert.equal((await reachedEnding(store))?.id, 'found');
  });

  test(`${EDITION}: departed: every roll misses and the train leaves`, async () => {
    const { store, svc } = await play();
    for (const card of DICE) {
      if (await reachedEnding(store)) break;
      if (card !== CONFRONT) await svc().searchPlace({ layer: path.posix.dirname(card), spot: 'scene' });
      await svc().rollDice({ path: card, forcedResult: asD100(5) });
    }
    assert.equal(await clockLeft(store), 0);
    assert.equal((await reachedEnding(store))?.id, 'departed');
    const refused = await svc().chooseOption({ path: RADIO, choice: 'report' }).catch((e) => e);
    assert.equal(refused.code, 'game_ended', 'after the ending, only conversation remains');
  });

  // Hidden hp. No enemies: the cold of the unheated
  // freight car, the dark gangway between cars, and 钟怀礼 shoving the player off
  // the stove (the cab's rockfall went with its search, the design notes). Bands in
  // roll order: 2–4 / 5–10 / 11–17 / 18–20.
  const HARM = {
    'world/seated-car/search-scene.md': [null, null, null, null],
    'world/sleeper/search-scene.md': [null, null, null, null],
    'world/dining-car/search-scene.md': ['serious', null, null, null],
    [CONFRONT]: ['serious', 'light', null, null],
  };

  test(`${EDITION}: hidden hp: declared on the player, said only in words; a grave wound from full leaves the player badly hurt`, async () => {
    const fm = parseFrontmatter(await fs.readFile(path.join(TEMPLATE, 'player/README.md'), 'utf8')).frontmatter;
    const { states, errors } = parseStateDecls(fm);
    assert.deepEqual(errors, []);
    const decl = states.find((st) => st.id === 'hp');
    assert.equal(decl.type, 'number');
    assert.equal(decl.initial, 10);
    assert.deepEqual(decl.range, [0, 10]);
    assert.equal(decl.shown_as.length, 4);
    if (zh) assert.deepEqual(decl.shown_as.map((b) => b.text), ['毫发无伤', '受了伤', '伤得很重', '奄奄一息']);
    assert.ok(!decl.hidden);
    const afterGrave = decl.initial - harmAmount(decl, 'grave');
    assert.ok(afterGrave > 0, 'grave never kills from full');
    assert.equal(stateProse(decl, afterGrave), decl.shown_as[2].text, 'badly hurt');
    if (zh) assert.equal(stateProse(decl, afterGrave), '伤得很重');
  });

  test(`${EDITION}: hidden hp: only the risky bands hurt — the gangway and the stove`, async () => {
    for (const car of CARS) {
      const fm = parseFrontmatter(await fs.readFile(path.join(TEMPLATE, car, 'README.md'), 'utf8')).frontmatter;
      const bands = parseSearchDeclarations(fm).spots.find((sp) => sp.id === 'scene').dice_outcomes;
      assert.deepEqual(bands.map((b) => [b.min, b.max]), [[2, 4], [5, 10], [11, 17], [18, 20]], car);
      assert.deepEqual(bands.map((b) => b.harm ?? null), HARM[`${car}/search-scene.md`], car);
    }
    const confront = parseFrontmatter(await fs.readFile(path.join(TEMPLATE, CONFRONT), 'utf8')).frontmatter;
    assert.deepEqual(confront.dice_outcomes.map((b) => b.harm ?? null), HARM[CONFRONT]);
    const manifest = JSON.parse(await fs.readFile(path.join(TEMPLATE, 'world.json'), 'utf8'));
    const trigger = manifest.triggers.find((tr) => tr.id === 'too-hurt');
    assert.equal(trigger.kind, 'state');
    assert.equal(trigger.when, 'player.hp <= 0');
    assert.equal(trigger.do, 'collapse');
    const collapse = await fs.readFile(path.join(TEMPLATE, 'command/collapse.yaml'), 'utf8');
    assert.match(collapse, /ending: departed/, 'collapsing is the failure ending, not a third one');
  });

  test(`${EDITION}: hidden hp: harm lands by band, once per card; the result never carries a number`, async () => {
    const { store, roll, hp } = await play();
    await roll('world/seated-car/search-scene.md', 3);
    assert.equal(await hp(), 10, 'asking passengers hurts no one');
    const r = await roll(CONFRONT, 7);
    assert.deepEqual(r.details.harm, { severity: 'light' });
    assert.equal(await hp(), 8, 'light: a quarter of the range');
    assert.match(await store.readFile(CONFRONT), /harm_receipt/);
    await roll('world/dining-car/search-scene.md', 15);
    assert.equal(await hp(), 8, 'a success does not hurt');
    assert.equal(await reachedEnding(store), null);
  });

  test(`${EDITION}: hidden hp: the confrontation fumble is serious; badly hurt, the story goes on`, async () => {
    const { store, roll, hp } = await play();
    await roll(CONFRONT, 3);
    assert.equal(await hp(), 5, 'serious: half of the range');
    await roll('world/sleeper/search-scene.md', 2);
    assert.equal(await hp(), 5, 'a fumble in the sleeper wakes him; it hurts no one');
    assert.equal(await reachedEnding(store), null, 'badly hurt, still going');
  });

  test(`${EDITION}: hidden hp: hp 0 ends in departed — 夏澄 takes the player back, the train leaves without the truth`, async () => {
    const { store, svc, roll, hp } = await play();
    await roll(CONFRONT, 3);
    assert.equal(await hp(), 5, 'shoved into the stove: badly hurt, not dead');
    assert.equal(await reachedEnding(store), null);
    await roll('world/dining-car/search-scene.md', 4);
    assert.equal(await hp(), 0);
    assert.ok((await clockLeft(store)) > 0, 'the clock did not run out');
    assert.equal((await reachedEnding(store))?.id, 'departed');
    const events = (await store.getEventsSince(0)).filter((e) => e.type === 'story_event');
    assert.ok(events.some((e) => e.detail.target === 'characters/xia-cheng'), '夏澄 gets the player back to 2车');
    const refused = await svc().chooseOption({ path: RADIO, choice: 'report' }).catch((e) => e);
    assert.equal(refused.code, 'game_ended');
  });
}

// ── the ending card follows the run (playtest 10-13): no fixed hour, the logbook passage only with the page ──────
for (const EDITION of EDITIONS) {
  const TEMPLATE = templateOf(EDITION);
  const zh = EDITION === 'last-train-zh';
  async function scratch() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'last-train-text-'));
    await fs.cp(TEMPLATE, root, { recursive: true });
    const store = new LocalWorldStore(root);
    const carry = (name) => store.writeFile(`player/${name}`, `---\nname: ${name}\ntype: note\nportable: true\n---\n\nEvidence.\n`);
    return { store, carry };
  }
  const FOUND = 'endings/found/README.md';
  const DEPARTED = 'endings/departed/README.md';

  test(`${EDITION}: found reads differently for the logbook route, the burned page and the page never seen`, async () => {
    const a = await scratch();
    await a.carry('su-he-testimony.md'); await a.carry('logbook-page.md');
    const b = await scratch();
    await b.carry('su-he-testimony.md'); await b.carry('pill-strip.md'); await b.carry('tea-bill.md'); await b.carry('torn-corner.md');
    const c = await scratch();
    await c.carry('su-he-testimony.md'); await c.carry('pill-strip.md'); await c.carry('tea-bill.md');
    const [ta, tb, tc] = [(await endingTextOf(a.store, FOUND)).body, (await endingTextOf(b.store, FOUND)).body, (await endingTextOf(c.store, FOUND)).body];
    assert.equal(new Set([ta, tb, tc]).size, 3);
    for (const t of [ta, tb, tc]) assert.equal(t.split('\n\n').length, 4, 'opening, proof, the ride, the page');
    if (zh) {
      assert.doesNotMatch(ta + tb + tc, /凌晨四点/, 'no fixed hour');
      assert.match(ta, /终于有人替苏长庚说了实话/);
      assert.doesNotMatch(tb + tc, /终于有人替苏长庚说了实话/);
    }
  });

  test(`${EDITION}: departed knows whether she was found, whether the page is in hand, and whether the player fell`, async () => {
    const none = await scratch();
    const held = await scratch();
    await held.carry('su-he-testimony.md'); await held.carry('logbook-page.md');
    const tNone = (await endingTextOf(none.store, DEPARTED)).body;
    const tHeld = (await endingTextOf(held.store, DEPARTED)).body;
    assert.notEqual(tNone, tHeld);
    if (zh) {
      assert.match(tNone, /日志页再也没有找到/);
      assert.doesNotMatch(tHeld, /日志页再也没有找到/);
      assert.match(tHeld, /那页日志还在你手里/);
    }
  });
}

// ── the three-act rework ─────────────────────────────

for (const EDITION of EDITIONS) {
  const TEMPLATE = templateOf(EDITION);
  const fmOf = async (f) => parseFrontmatter(await fs.readFile(path.join(TEMPLATE, f), 'utf8')).frontmatter;
  async function scratch() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'last-train-acts-'));
    await fs.cp(TEMPLATE, root, { recursive: true });
    const store = new LocalWorldStore(root);
    let n = 0;
    return { root, store, svc: () => createActionService(store, { type: 'player' }, { turn: `req:acts-${++n}` }), god: () => createActionService(store, GOD, { turn: `req:acts-${++n}` }) };
  }

  test(`${EDITION}: each act declares its view — the cars on the canvas, the overview on the map`, async () => {
    assert.equal((await fmOf('world/README.md')).view, 'map');
    for (const car of ['world/seated-car', 'world/sleeper', 'world/dining-car', 'world/cab', 'world/freight-car']) {
      assert.equal((await fmOf(`${car}/README.md`)).view, 'canvas', car);
    }
    const cab = await fmOf('world/cab/README.md');
    assert.equal(cab.search, undefined, 'the key-board search is cut');
    assert.ok(!JSON.stringify(cab.map.plan.pins).includes('key-board'));
    const overview = await fmOf('world/README.md');
    assert.ok(!overview.choice.options.some((o) => o.id === 'read-clock' || o.id === 'talk'), 'no 「看离发车还有多久」 / 「和夏澄商量」');
  });

  test(`${EDITION}: lines are said to someone, moves go to the writer — no 「和夏澄商量」 left anywhere`, async () => {
    for (const car of ['world/README.md', 'world/seated-car/README.md', 'world/sleeper/README.md', 'world/dining-car/README.md', 'world/cab/README.md', 'world/freight-car/README.md']) {
      const fm = await fmOf(car);
      for (const o of fm.choice.options) {
        const kind = fm.choice_actions?.[o.id]?.kind;
        if (kind === 'character') assert.equal(o.to, 'writer', `${car}#${o.id}: a 「go talk to」 move is the writer's (it opens the person)`);
        if (o.to && o.to !== 'writer') assert.ok(o.say, `${car}#${o.id}: a line says something`);
      }
    }
    // The NPCs carry their own lines, and the writer can hand the player to them.
    for (const npc of ['world/seated-car/zhou-zihang.md', 'world/dining-car/lao-he.md', 'world/cab/lao-qin.md', 'world/freight-car/su-he.md']) {
      const fm = await fmOf(npc);
      assert.equal(fm.replies.length, 2, npc);
    }
    // talking to 周子航 stays possible (his card's 「对话」), but it is not a smooth default option —
    // the roll is THE way to his account.
    const seated = await fmOf('world/seated-car/README.md');
    assert.equal(seated.choice_actions['talk-student'], undefined, 'no 「去和20号的学生聊聊」 default');
    assert.ok(!seated.choice.options.some((o) => seated.choice_actions?.[o.id]?.kind === 'talk'), 'no talk option in car 2');
    assert.deepEqual(seated.choice_actions.search, { kind: 'search', spot: 'scene' });
    assert.equal((await fmOf('world/seated-car/zhou-zihang.md')).type, 'npc', 'his own card still opens a conversation');
  });

  test(`${EDITION}: car 2's dice give the account itself — every tier, no 「go and chat」 band; hints point at the roll`, async () => {
    const fm = await fmOf('world/seated-car/README.md');
    const bands = parseSearchDeclarations(fm).spots.find((sp) => sp.id === 'scene').dice_outcomes;
    for (const b of bands) {
      const paths = (b.rewards ?? []).map((r) => r.path);
      assert.ok(paths.includes(b.min >= 11 ? 'world/seated-car/witness-account.md' : 'world/seated-car/witness-half.md'), `${b.min}–${b.max}: the band hands over the account`);
      for (const o of b.options ?? []) assert.notEqual(o.action?.kind, 'talk', `${b.min}–${b.max}#${o.id}: no 「go talk to him」 after the roll`);
    }
    // The four tiers, through the real roll: success / crit give the account, fail / fumble half of it.
    for (const [roll, file] of [[5, 'witness-account.md'], [30, 'witness-account.md'], [80, 'witness-half.md'], [98, 'witness-half.md']]) {
      const { store, god } = await scratch();
      await god().searchPlace({ layer: 'world/seated-car', spot: 'scene' });
      await runDeclaredRoll(god(), 'world/seated-car/search-scene.md', roll);
      assert.equal(await store.statKind(`world/seated-car/${file}`), 'file', `d100 ${roll}`);
      store.close();
    }
    const hints = JSON.parse(await fs.readFile(path.join(TEMPLATE, 'hints.json'), 'utf8')).hints;
    for (const h of hints) for (const sg of h.suggest ?? []) assert.notEqual(sg.option, 'talk-student', h.id);
    assert.deepEqual(hints.find((h) => h.id === 'lt-ask').suggest, [{ card: 'world/seated-car/README.md', option: 'search' }]);
  });

  test(`${EDITION}: car 2's way out — two exits lead the options once the account is in, or after four beats anyway`, async () => {
    const visibleIds = async (store) => visibleChoiceOptions(buildInteractiveFields(parseFrontmatter(await store.readFile('world/seated-car/README.md')).frontmatter).choice).map((o) => o.id);
    const fm = await fmOf('world/seated-car/README.md');
    assert.deepEqual(fm.choice.options.slice(0, 2).map((o) => o.id), ['go-sleeper', 'go-train'], 'ordered first');
    assert.deepEqual(fm.choice_actions['go-sleeper'], { kind: 'enter', target: 'world/sleeper' });
    assert.deepEqual(fm.choice_actions['go-train'], { kind: 'enter', target: 'map' });
    // The account opens them (a half account too).
    for (const roll of [30, 80]) {
      const { store, god } = await scratch();
      assert.ok(!(await visibleIds(store)).includes('go-sleeper'), 'hidden at first');
      await god().searchPlace({ layer: 'world/seated-car', spot: 'scene' });
      await runDeclaredRoll(god(), 'world/seated-car/search-scene.md', roll);
      assert.deepEqual((await visibleIds(store)).slice(0, 2), ['go-sleeper', 'go-train'], `after d100 ${roll}`);
      store.close();
    }
    // Four beats in car 2 without the account open them anyway (the turn-end beat the page sends).
    const { store, svc } = await scratch();
    for (let i = 0; i < 3; i++) await runTurnEnd(svc().ctx, { tick: { page: 'world/seated-car', mode: 'off' } });
    assert.ok(!(await visibleIds(store)).includes('go-train'), 'not yet after three');
    await runTurnEnd(svc().ctx, { tick: { page: 'world/seated-car', mode: 'off' } });
    assert.deepEqual((await visibleIds(store)).slice(0, 2), ['go-sleeper', 'go-train'], 'after four');
    // Pressable now (the page then walks to world/sleeper by its choice_actions `enter`).
    const chose = await svc().chooseOption({ path: 'world/seated-car/README.md', choice: 'go-sleeper' });
    assert.equal(chose.details.optionId, 'go-sleeper');
    store.close();
    // 夏澄's nudges point at exactly these notes.
    const hints = JSON.parse(await fs.readFile(path.join(TEMPLATE, 'hints.json'), 'utf8')).hints;
    for (const id of ['lt-coat', 'lt-coat-half', 'lt-move-on']) {
      assert.deepEqual(hints.find((h) => h.id === id).suggest[0], { card: 'world/seated-car/README.md', option: 'go-sleeper' }, id);
    }
    const tick = JSON.parse(await fs.readFile(path.join(TEMPLATE, 'world.json'), 'utf8')).tick;
    assert.deepEqual(tick.actors['xia-cheng'].moves.find((m) => m.id === 'nudge-on').suggest, [
      { card: 'world/seated-car/README.md', option: 'go-sleeper' },
      { card: 'world/seated-car/README.md', option: 'go-train' },
    ]);
  });

  test(`${EDITION}: the overview map — every car is a named place pin`, async () => {
    const overview = await fmOf('world/README.md');
    for (const car of ['cab', 'seated-car', 'sleeper', 'dining-car', 'freight-car']) {
      assert.ok(Array.isArray(overview.map.plan.pins[car]), `${car} has a pin`);
      const fm = await fmOf(`world/${car}/README.md`);
      assert.equal(fm.type, 'gate', car);
      assert.ok(typeof fm.name === 'string' && fm.name.trim().length > 0, `${car} has a name on its pin`);
    }
  });

  test(`${EDITION}: the companion's hint table parses, names real cards and options, and is the same in every language`, async () => {
    const raw = JSON.parse(await fs.readFile(path.join(TEMPLATE, 'hints.json'), 'utf8'));
    const { table, errors } = parseHintTable(raw);
    assert.deepEqual(errors, []);
    assert.equal(table.by, 'xia-cheng');
    assert.ok(table.hints.length >= 20, 'about twenty entries');
    const zh = JSON.parse(await fs.readFile(path.join(templateOf('last-train-zh'), 'hints.json'), 'utf8'));
    assert.deepEqual(table.hints.map((h) => [h.id, JSON.stringify(h.when), h.priority, (h.suggest ?? []).map((s) => s.card ?? s.enter)]), zh.hints.map((h) => [h.id, JSON.stringify(h.when), h.priority, (h.suggest ?? []).map((s) => s.card ?? s.enter)]));
    for (const h of table.hints) {
      for (const s of h.suggest ?? []) {
        if (s.enter) { await fs.access(path.join(TEMPLATE, s.enter === 'map' ? 'world' : s.enter, 'README.md')); continue; }
        if (/search-scene\.md$|04-confront-dice\.md$/.test(s.card)) continue; // spawned / resolved by a roll
        const fm = await fmOf(s.card);
        assert.ok(fm.choice.options.some((o) => o.id === s.option), `${h.id}: ${s.card} has option ${s.option}`);
      }
    }
  });

  test(`${EDITION}: act three's shortcut — 夏澄 radios from car 5, the same report: thin costs a step, enough ends found`, async () => {
    const { store, svc } = await scratch();
    const carry = async (name) => store.writeFile(`player/${name}`, `---\nname: ${name}\ntype: note\nportable: true\n---\n\nEvidence.\n`);
    const start = await clockLeft(store);
    await carry('su-he-testimony.md');
    await svc().chooseOption({ path: RELAY, choice: 'relay' });
    assert.equal(await reachedEnding(store), null);
    assert.equal(await clockLeft(store), start - 1);
    await carry('logbook-page.md');
    await svc().chooseOption({ path: RELAY, choice: 'relay' });
    assert.equal((await reachedEnding(store))?.id, 'found');
  });

  test(`${EDITION}: the prologue's fast-forward — notebook and account in the bag, one step, on the train map; offered once`, async () => {
    const { store, svc } = await scratch();
    const opening = await fmOf('world/seated-car/01-opening.md');
    assert.equal(opening.choice.options[0].for, 'from-prologue', 'only a player from the prologue sees it');
    const start = await clockLeft(store);
    await svc().enterLayer({ layer: 'world/seated-car' });
    await svc().chooseOption({ path: 'world/seated-car/01-opening.md', choice: 'skip-act-one' });
    assert.equal(await store.statKind('player/su-he-notebook.md'), 'file');
    assert.equal(await store.statKind('world/seated-car/su-he-notebook.md'), 'missing');
    assert.equal(await store.statKind('player/witness-account.md'), 'file');
    assert.equal(await clockLeft(store), start - 1);
    assert.equal(store.readViewpoint()?.layer ?? (await store.getEventsSince(0)).filter((e) => e.type === 'layer_entered').at(-1)?.detail.layer, 'map', 'on the train map');
    const after = parseFrontmatter(await store.readFile('world/seated-car/01-opening.md')).frontmatter;
    assert.equal(after.status.data.skipped, 'yes', 'the option is gone afterwards');
  });
}
