// 雾坞镇·潮前 — the wuwu family (templates/wuwu, wuwu-jp, wuwu-zh) since 2026-10-02;
// written in Chinese as templates/wuwu-tide. Every ending is reachable by play, and
// only by play.
//
// Each test copies the real template into a scratch directory and drives it
// through the real action layer with forced 2d10 results: each place's
// search spawns its dice chalk, whose
// `on.roll_resolved` bindings run on the roll, the accuse card's `on.choice_selected`, `tick`
// and `end`. No agent, no writer — the ending is the engine's decision.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { LocalWorldStore, createActionService, reachedEnding, clockLeft, parseFrontmatter, parseStateDecls, currentStateValue, harmAmount, stateProse, parseSearchDeclarations } from '../packages/shared/dist/index.js';

// Every edition plays the same: ids, paths, dice, bands and commands are identical
// across the three (check:worlds); the Chinese edition is where the prose was written.
const EDITIONS = ['wuwu', 'wuwu-jp', 'wuwu-zh', 'wuwu-ko'];
const templateOf = (edition) => fileURLToPath(new URL(`../templates/${edition}`, import.meta.url));
const GOD = { type: 'god' };

// Each risky roll is a declared search: [layer, spot] → the dice chalk it spawns.
const SEARCH = {
  berth: ['world/harbor-chart/seventh-berth', 'scene'],
  lighthouse: ['world/harbor-chart/old-lighthouse', 'scene'],
  workshop: ['world/harbor-chart/workshop', 'scene'],
  chart: ['world/harbor-chart', 'fog'],
  peek: ['world/harbor-chart/old-lighthouse', 'peek-logbook'],
};
const DICE = Object.fromEntries(Object.entries(SEARCH).map(([key, [layer, spot]]) => [key, `${layer}/search-${spot}.md`]));
const ACCUSE = 'world/harbor-chart/05-accuse.md';
// Where a missed roll sends you: the same line, pinned for one more step of tide.
const LONG_WAY = {
  berth: 'world/harbor-chart/seventh-berth/05-long-way.md',
  lighthouse: 'world/harbor-chart/old-lighthouse/05-long-way.md',
  workshop: 'world/harbor-chart/workshop/05-long-way.md',
  chart: 'world/harbor-chart/06-long-way.md',
};


/**
 * The world's checks are d100 skill checks now (the design notes;
 * the skills they test sit at 60). The scenarios below were written in the old
 * 2d10 bands; this maps a 2d10 total to a d100 roll in the same band.
 */
const asD100 = (r) => (r <= 4 ? 98 : r <= 10 ? 80 : r <= 17 ? 30 : 5);

for (const EDITION of EDITIONS) {
  const TEMPLATE = templateOf(EDITION);
  const zh = EDITION === 'wuwu-zh';
  async function play() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wuwu-tide-'));
    await fs.cp(TEMPLATE, root, { recursive: true });
    const store = new LocalWorldStore(root);
    let n = 0;
    // A fresh request per player action, like the HTTP entry.
    const svc = () => createActionService(store, GOD, { turn: `req:tide-${++n}` });
    const search = (key) => svc().searchPlace({ layer: SEARCH[key][0], spot: SEARCH[key][1] });
    // The player searches (the dice chalk appears), then rolls it.
    const roll = async (key, result) => {
      await search(key);
      return svc().rollDice({ path: DICE[key], forcedResult: asD100(result) });
    };
    const has = async (rel) => (await store.statKind(rel)) === 'file';
    const hp = async () => {
      const fm = parseFrontmatter(await store.readFile('player/README.md')).frontmatter;
      return currentStateValue(parseStateDecls(fm).states.find((s) => s.id === 'hp'), fm?.status?.data);
    };
    return { store, svc, roll, search, has, hp };
  }

  test(`${EDITION}: a search spawns only its dice chalk: no evidence, no tide, until the roll`, async () => {
    const { store, search, has } = await play();
    for (const key of Object.keys(SEARCH)) {
      assert.equal(await has(DICE[key]), false, `${key}: no dice card is pre-placed`);
      await search(key);
      assert.ok(await has(DICE[key]), `${key}: the search lands its dice chalk`);
    }
    for (const rel of ['player/decoy-ship.md', 'player/customs-tunnel.md', 'player/ledger-page.md', 'player/second-wake.md', 'player/decoy-ship-half.md']) {
      assert.equal(await has(rel), false, `${rel} does not exist before a roll`);
    }
    assert.equal(await clockLeft(store), 8, 'searching costs no tide; rolling does');
  });

  test(`${EDITION}: the world is closed, with its clock and exactly three endings`, async () => {
    const manifest = JSON.parse(await fs.readFile(path.join(TEMPLATE, 'world.json'), 'utf8'));
    assert.equal(manifest.mode, 'closed');
    assert.notEqual(manifest.exp, true, 'an official edition, not an experiment');
    assert.deepEqual(manifest.view, { default: 'map' }, 'a TRPG world with maps opens on the map');
    assert.deepEqual(manifest.endings.map((e) => e.id).sort(), ['exposed', 'lost', 'swallowed']);
    for (const e of manifest.endings) {
      await fs.access(path.join(TEMPLATE, e.path));
    }
    const { store } = await play();
    assert.equal(await clockLeft(store), manifest.clock.start);
  });

  test(`${EDITION}: exposed: all four lines of evidence, then the accusation`, async () => {
    const { store, svc, roll, has } = await play();
    // Accusing too early changes nothing.
    await svc().chooseOption({ path: ACCUSE, choice: 'not-ready' });
    assert.equal(await reachedEnding(store), null);

    for (const key of ['berth', 'lighthouse', 'workshop', 'chart']) await roll(key, 15);
    for (const rel of ['player/decoy-ship.md', 'player/customs-tunnel.md', 'player/ledger-page.md', 'player/second-wake.md']) {
      assert.ok(await has(rel), `${rel} must be in the bag after the rolls`);
    }
    assert.equal(await clockLeft(store), 4, 'four clean rolls cost four steps of tide');

    await svc().chooseOption({ path: ACCUSE, choice: 'accuse' });
    assert.equal((await reachedEnding(store))?.id, 'exposed');
  });

  test(`${EDITION}: lost: misses force the long way, and the long way eats the tide`, async () => {
    const { store, svc, roll, has } = await play();
    // 7 is a miss: the roll costs one step and pins nothing — only half a line.
    for (const key of ['berth', 'lighthouse', 'workshop', 'chart']) await roll(key, 7);
    assert.equal(await clockLeft(store), 4);
    assert.equal(await has('player/decoy-ship.md'), false, 'a miss does not pin the line');
    // Each long way pins its line for one more step of tide.
    for (const key of ['berth', 'lighthouse', 'workshop']) await svc().chooseOption({ path: LONG_WAY[key], choice: 'long-way' });
    assert.equal(await clockLeft(store), 1);
    assert.equal(await reachedEnding(store), null);
    await svc().chooseOption({ path: LONG_WAY.chart, choice: 'long-way' });
    assert.equal(await clockLeft(store), 0);
    assert.equal((await reachedEnding(store))?.id, 'lost');
  });

  test(`${EDITION}: the roll decides the evidence: full line, half a line, or a character who saw you`, async () => {
    // 11–17: the line is pinned on the spot.
    const hit = await play();
    await hit.roll('berth', 15);
    assert.ok(await hit.has('player/decoy-ship.md'));
    assert.equal(await hit.has('player/decoy-ship-half.md'), false);

    // 5–10: half a line, the line is NOT pinned, and the long way opens.
    const half = await play();
    await half.roll('berth', 7);
    assert.ok(await half.has('player/decoy-ship-half.md'), 'a near miss drops half a line');
    assert.equal(await half.has('player/decoy-ship.md'), false);
    const accuse = parseFrontmatter(await half.store.readFile(ACCUSE)).frontmatter.status.data;
    assert.equal(accuse.decoy, 'no', 'the accusation card has no tick for a half line');
    const way = parseFrontmatter(await half.store.readFile(LONG_WAY.berth)).frontmatter.status.data;
    assert.equal(way.open, 'yes');

    // 2–4: nothing in hand; Silver Kite saw you (a character event), and the tide surges.
    const caught = await play();
    await caught.roll('berth', 3);
    assert.equal(await caught.has('player/decoy-ship-half.md'), false);
    assert.equal(await caught.has('player/decoy-ship.md'), false);
    const [seen] = (await caught.store.getEventsSince(0)).filter((e) => e.type === 'story_event');
    assert.equal(seen.detail.kind, 'character');
    assert.equal(seen.detail.target, 'characters/silver-kite');
    assert.equal(await clockLeft(caught.store), 6, 'a fumble costs the roll and a surge');
    // The long way still reaches the evidence: failure opens a route, it never dead-ends.
    await caught.svc().chooseOption({ path: LONG_WAY.berth, choice: 'long-way' });
    assert.ok(await caught.has('player/decoy-ship.md'));
    assert.equal(await clockLeft(caught.store), 5);

    // 18–20: pinned, and fast enough that the tide does not move.
    const great = await play();
    await great.roll('workshop', 19);
    assert.ok(await great.has('player/ledger-page.md'));
    assert.equal(await clockLeft(great.store), 8);
  });

  test(`${EDITION}: the long way cannot be taken before a miss, nor twice`, async () => {
    const { store, svc, roll, has } = await play();
    // Closed: no visible option, nothing happens, no tide spent.
    await assert.rejects(() => svc().chooseOption({ path: LONG_WAY.workshop, choice: 'long-way' }));
    assert.equal(await clockLeft(store), 8);
    await roll('workshop', 6);
    await svc().chooseOption({ path: LONG_WAY.workshop, choice: 'long-way' });
    assert.ok(await has('player/ledger-page.md'));
    assert.equal(await clockLeft(store), 6);
    await assert.rejects(() => svc().chooseOption({ path: LONG_WAY.workshop, choice: 'long-way' }));
    assert.equal(await clockLeft(store), 6, 'a second click spends nothing');
  });

  test(`${EDITION}: exposed after misses: the long way keeps the evidence obtainable`, async () => {
    const { store, svc, roll } = await play();
    await roll('berth', 7);
    await roll('lighthouse', 3);
    await roll('workshop', 15);
    await roll('chart', 15);
    await svc().chooseOption({ path: LONG_WAY.berth, choice: 'long-way' });
    await svc().chooseOption({ path: LONG_WAY.lighthouse, choice: 'long-way' });
    // 8 − 4 rolls − 1 surge − 2 long ways = 1 step of tide left.
    assert.equal(await clockLeft(store), 1);
    await svc().chooseOption({ path: ACCUSE, choice: 'accuse' });
    assert.equal((await reachedEnding(store))?.id, 'exposed');
  });

  test(`${EDITION}: swallowed: the decisive roll fumbles with no lamp oil`, async () => {
    const { store, roll } = await play();
    await roll('chart', 3);
    assert.equal((await reachedEnding(store))?.id, 'swallowed');
  });

  test(`${EDITION}: carrying the oil survives one fumble — it burns instead`, async () => {
    const { store, svc, roll, has } = await play();
    await svc().moveEntity({ from: 'world/harbor-chart/old-lighthouse/lamp-oil.md', to: 'player/lamp-oil.md' });
    await roll('chart', 3);
    assert.equal(await reachedEnding(store), null, 'the oil was burned, the story goes on');
    assert.ok(await has('player/empty-oil-flask.md'));
    assert.equal(await has('player/second-wake.md'), false, 'a steadied fumble still sees nothing');
    await svc().chooseOption({ path: LONG_WAY.chart, choice: 'long-way' });
    assert.ok(await has('player/second-wake.md'), 'the shore walk pins the line instead');
  });

  test(`${EDITION}: after an ending, the next action is refused`, async () => {
    const { store, roll } = await play();
    await roll('chart', 3);
    assert.equal((await reachedEnding(store))?.id, 'swallowed');
    const refused = await roll('berth', 15).catch((e) => e);
    assert.equal(refused.code, 'game_ended');
  });

  test(`${EDITION}: the optional peek at Old Mo\'s logbook: an item event on success, a character event on failure, no tide`, async () => {
    const story = async (store) => (await store.getEventsSince(0)).filter((e) => e.type === 'story_event');

    const won = await play();
    await won.roll('peek', 15);
    const [hit] = await story(won.store);
    assert.equal(hit.detail.kind, 'item');
    assert.match(await fs.readFile(path.join(won.store.worldRoot, 'world/harbor-chart/old-lighthouse/lighthouse-logbook.md'), 'utf8'), zh ? /三短一长/ : /\S/);
    assert.equal(await clockLeft(won.store), 8, 'optional: it costs no tide');

    const lost = await play();
    await lost.roll('peek', 5);
    const [seen] = await story(lost.store);
    assert.equal(seen.detail.kind, 'character');
    assert.equal(seen.detail.target, 'characters/old-mo');
    assert.equal(seen.layer, 'world/harbor-chart/old-lighthouse', 'Old Mo reads it where he stands');
    assert.equal(await clockLeft(lost.store), 8);
  });

  // Hidden hp. No enemies: the tide and the fog at the harbor mouth
  // hurt worst, the lighthouse stairs less, the gangway and the vise least.
  const HARM = { chart: 'grave', lighthouse: 'serious', berth: 'light', workshop: 'light', peek: null };

  test(`${EDITION}: hidden hp: declared as words only, and only the 2–4 bands hurt`, async () => {
    const fm = parseFrontmatter(await fs.readFile(path.join(TEMPLATE, 'player/README.md'), 'utf8')).frontmatter;
    const { states, errors } = parseStateDecls(fm);
    assert.deepEqual(errors, []);
    const decl = states.find((s) => s.id === 'hp');
    assert.equal(decl.initial, 10);
    assert.deepEqual(decl.range, [0, 10]);
    assert.equal(decl.shown_as.length, 4);
    if (zh) assert.deepEqual(decl.shown_as.map((b) => b.text), ['毫发无伤', '受了伤', '伤得很重', '奄奄一息']);
    for (const [key, [layer, spot]] of Object.entries(SEARCH)) {
      const readme = parseFrontmatter(await fs.readFile(path.join(TEMPLATE, layer, 'README.md'), 'utf8')).frontmatter;
      const bands = parseSearchDeclarations(readme).spots.find((s) => s.id === spot).dice_outcomes ?? [];
      const hurt = bands.filter((b) => b.harm).map((b) => [b.min, b.max, b.harm]);
      assert.deepEqual(hurt, HARM[key] ? [[2, 4, HARM[key]]] : [], `${key}: harm only on 2–4`);
    }
    const { triggers } = JSON.parse(await fs.readFile(path.join(TEMPLATE, 'world.json'), 'utf8'));
    // the one STATE trigger is the hp floor; the mid-story CGs (3dc2132f) are place triggers and never touch hp
    assert.deepEqual(triggers.filter((t) => t.kind === 'state').map(({ id, kind, when, do: run }) => ({ id, kind, when, run })), [{ id: 'too-hurt', kind: 'state', when: 'player.hp <= 0', run: 'hurt-out' }]);
    for (const t of triggers.filter((t) => t.kind !== 'state')) assert.match(t.id, /^cg-/, `${t.id}: only CG place triggers besides the hp floor`);
    assert.match(await fs.readFile(path.join(TEMPLATE, 'command/hurt-out.yaml'), 'utf8'), /ending: swallowed/);
  });

  test(`${EDITION}: harm lowers hp by its band: light 2, serious 5`, async () => {
    const { roll, hp } = await play();
    await roll('berth', 3);
    assert.equal(await hp(), 8);
    await roll('lighthouse', 3);
    assert.equal(await hp(), 3);
    await roll('workshop', 15);
    assert.equal(await hp(), 3, 'a success does not hurt');
  });

  test(`${EDITION}: a grave fumble from full leaves the player badly hurt, not dead; the next hurt swallows them`, async () => {
    const { store, svc, roll, hp } = await play();
    await svc().moveEntity({ from: 'world/harbor-chart/old-lighthouse/lamp-oil.md', to: 'player/lamp-oil.md' });
    await roll('chart', 3);
    const decl = parseStateDecls(parseFrontmatter(await store.readFile('player/README.md')).frontmatter).states[0];
    assert.equal(await hp(), 10 - harmAmount(decl, 'grave'));
    assert.equal(stateProse(decl, await hp()), decl.shown_as[2].text, 'badly hurt');
    if (zh) assert.equal(stateProse(decl, await hp()), '伤得很重');
    assert.equal(await reachedEnding(store), null, 'the oil held the fog off, and grave is not death');
    await roll('workshop', 3);
    assert.equal(await hp(), 0);
    assert.equal((await reachedEnding(store))?.id, 'swallowed');
    const events = (await store.getEventsSince(0)).filter((e) => e.type === 'story_event');
    assert.ok(events.some((e) => e.detail.target === 'characters/old-mo' && (!zh || /站不起来/.test(e.detail.text ?? JSON.stringify(e.detail)))));
  });
}
