// 福尔摩斯：第四件案子 (templates/whitechapel, whitechapel-zh, whitechapel-jp) — the open
// world now ends (mode `semi`, the design notes). No quiz, no deduction form,
// no graded plan: once three key clues have turned up, the culprit Wayne comes to
// press Holmes himself (a `state` trigger), and what the player actually found
// decides which moves are open on world/london-map/03-before-noon.md. Every ending
// is reachable by play, in every locale, through the real action layer (searches →
// dice → `on.roll_resolved` → trigger → `on.choice_selected` → `end`); hidden hp
// from risky searches can end the case too. No agent, no writer.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { LocalWorldStore, createActionService, reachedEnding, WorldManifestSchema, parseFrontmatter } from '../packages/shared/dist/index.js';
import { runDeclaredRoll } from '../apps/server/dist/engine/declared-actions.js';

const EDITIONS = ['whitechapel', 'whitechapel-zh', 'whitechapel-jp', 'whitechapel-ko'];
const GOD = { type: 'god' };
const CARD = 'world/london-map/03-before-noon.md';
const L = 'world/london-map/';
const SEARCH = {
  scene: `${L}third-crime-scene`,
  morgue: `${L}morgue`,
  press: `${L}print-shop`,
  editor: `${L}print-shop/editor-office`,
  studio: `${L}print-shop/illustration-room`,
  edith: `${L}edith-room`,
  street: `${L}unnamed-street`,
};
const templateOf = (edition) => fileURLToPath(new URL(`../templates/${edition}`, import.meta.url));

async function play(edition) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `${edition}-end-`));
  await fs.cp(templateOf(edition), root, { recursive: true, filter: (src) => !/[/\\](assets|\.airpworld|\.pi)([/\\]|$)/.test(src) });
  const store = new LocalWorldStore(root);
  let n = 0;
  const svc = () => createActionService(store, GOD, { turn: `req:holmes-${++n}` });
  const roll = async (key, result) => {
    await svc().searchPlace({ layer: SEARCH[key], spot: 'scene' });
    return runDeclaredRoll(svc(), `${SEARCH[key]}/search-scene.md`, result);
  };
  const choose = (choice) => svc().chooseOption({ path: CARD, choice });
  const card = async () => parseFrontmatter(await store.readFile(CARD)).frontmatter;
  const hp = async () => parseFrontmatter(await store.readFile('player/README.md')).frontmatter?.status?.data?.hp ?? 10;
  return { store, roll, choose, card, hp };
}

test('locale editions share one ending / trigger / command structure', async () => {
  const shape = async (edition) => {
    const m = JSON.parse(await fs.readFile(path.join(templateOf(edition), 'world.json'), 'utf8'));
    const commands = (await fs.readdir(path.join(templateOf(edition), 'command'))).sort();
    const cardFm = parseFrontmatter(await fs.readFile(path.join(templateOf(edition), CARD), 'utf8')).frontmatter;
    const player = parseFrontmatter(await fs.readFile(path.join(templateOf(edition), 'player/README.md'), 'utf8')).frontmatter;
    return {
      mode: m.mode,
      endings: m.endings.map((e) => [e.id, e.path]),
      triggers: m.triggers.map(({ label, fallback, ...t }) => t),
      commands,
      card: { status: cardFm.status, when: cardFm.choice.options.map((o) => [o.id, o.when]), on: cardFm.on },
      hp: player.states.map(({ label, shown_as, ...s }) => ({ ...s, bands: shown_as.map(({ text, ...b }) => b) })),
    };
  };
  const en = await shape('whitechapel');
  for (const e of EDITIONS.filter((x) => x !== 'whitechapel')) assert.deepEqual(await shape(e), en, e);
});

for (const edition of EDITIONS) {
  test(`${edition}: semi world, three endings, four mysteries, no deduction forms`, async () => {
    const root = templateOf(edition);
    const manifest = WorldManifestSchema.parse(JSON.parse(await fs.readFile(path.join(root, 'world.json'), 'utf8')));
    assert.equal(manifest.mode, 'semi');
    // The noon clock: failed searches eat the morning.
    assert.deepEqual({ ...manifest.clock, label: undefined }, { path: CARD, key: 'left', start: 10, label: undefined, time: { start: '10:00', end: '12:00' } });
    assert.deepEqual(manifest.endings.map((e) => e.id), ['caught', 'half-truth', 'fourth-picture']);
    assert.equal(manifest.endings.find((e) => e.id === 'fourth-picture').when, 'clock <= 0');
    for (const e of manifest.endings) {
      const fm = parseFrontmatter(await fs.readFile(path.join(root, e.path), 'utf8')).frontmatter;
      assert.equal(fm.type, 'ending');
      await fs.access(path.join(root, fm.bg));
    }
    assert.equal(manifest.mysteries.length, 4);
    assert.ok(manifest.reckoning.epilogues.all && manifest.reckoning.epilogues.most && manifest.reckoning.epilogues.few);
    // The graded deduction loop is gone.
    for (const gone of ['02-deduction-and-plan.md', '04-investigation-dice.md']) {
      await assert.rejects(fs.access(path.join(root, L, gone)), `${gone} removed`);
    }
    const skill = await fs.readFile(path.join(root, `skills/${edition}-play/SKILL.md`), 'utf8');
    assert.doesNotMatch(skill, /player\/deduction\.md|player\/operation-plan\.md/);
    for (const f of ['README.md', '01-opening.md']) {
      const text = await fs.readFile(path.join(root, L, f), 'utf8');
      assert.doesNotMatch(text, /kind: stage|investigate-with-dice|deduction\.md|operation-plan\.md|04-investigation-dice/);
    }
  });

  test(`${edition}: Wayne turns up only after three key clues, and the moves follow the evidence`, async () => {
    const { store, roll, choose, card } = await play(edition);
    await assert.rejects(() => choose('edith-first'), 'nothing to decide before he turns up');
    await roll('edith', 30);
    await roll('street', 30);
    assert.equal((await card()).status.data.arrived, 'no', 'two clues are not enough');
    await assert.rejects(() => choose('edith-first'));
    await roll('editor', 30);
    const pressed = await card();
    assert.deepEqual({ ...pressed.status.data }, { left: 10, arrived: 'yes', picture: 'no', hand: 'no', address: 'yes' });
    assert.notEqual(pressed.title, parseFrontmatter(await fs.readFile(path.join(templateOf(edition), CARD), 'utf8')).frontmatter.title, 'the card now names him');
    await assert.rejects(() => choose('confront'), 'no proof that the picture came first or that his hand was there');
    await choose('edith-first');
    assert.equal((await reachedEnding(store))?.id, 'half-truth');
    const refused = await roll('morgue', 30).catch((e) => e);
    assert.equal(refused.code, 'game_ended');
  });

  test(`${edition}: caught — confront him with the whole chain`, async () => {
    const { store, roll, choose, card } = await play(edition);
    await roll('scene', 30);
    await roll('press', 30);
    assert.equal((await card()).status.data.arrived, 'no', 'the shift ledger is not a key clue on its own');
    await roll('editor', 30);
    assert.deepEqual({ ...(await card()).status.data }, { left: 10, arrived: 'yes', picture: 'yes', hand: 'yes', address: 'yes' });
    await choose('confront');
    assert.equal((await reachedEnding(store))?.id, 'caught');
  });

  test(`${edition}: confronting without the address link only saves half`, async () => {
    const { store, roll, choose } = await play(edition);
    await roll('scene', 30);
    await roll('studio', 30);
    await roll('morgue', 30);
    await assert.rejects(() => choose('trap'), 'the trap needs the address link');
    await choose('confront');
    assert.equal((await reachedEnding(store))?.id, 'half-truth');
  });

  test(`${edition}: the courtyard trap — he shoves you; other proof decides whether he is held`, async () => {
    const held = await play(edition);
    await held.roll('edith', 30);
    await held.roll('street', 30);
    await held.roll('studio', 30);
    await held.choose('trap');
    assert.equal((await reachedEnding(held.store))?.id, 'caught');
    assert.equal(await held.hp(), 8, 'the shove is a light wound');

    const loose = await play(edition);
    await loose.roll('edith', 30);
    await loose.roll('street', 30);
    await loose.roll('editor', 30);
    await loose.choose('trap');
    assert.equal((await reachedEnding(loose.store))?.id, 'half-truth');
  });

  test(`${edition}: fourth-picture — letting him walk`, async () => {
    const { store, roll, choose, hp } = await play(edition);
    await roll('scene', 30);
    await roll('morgue', 30);
    await roll('edith', 30);
    await choose('follow-him');
    assert.equal((await reachedEnding(store))?.id, 'fourth-picture');
    assert.equal(await hp(), 5);
  });

  test(`${edition}: hidden hp — two bad falls end the case (too-hurt)`, async () => {
    const { store, roll, hp } = await play(edition);
    await roll('street', 97); // light: a coal cart in the alley (and two steps of the clock)
    assert.equal(await hp(), 8);
    assert.equal(await reachedEnding(store), null);
    await roll('scene', 98); // serious: the wet railing
    assert.equal(await hp(), 3);
    assert.equal(await reachedEnding(store), null, 'hurt, still standing');
    await roll('press', 99); // serious: the type case — 3 → 0
    assert.equal(await hp(), 0);
    assert.equal((await reachedEnding(store))?.id, 'fourth-picture');
  });

  test(`${edition}: a great roll turns up the hidden find; a success the key clue; a failure only half, and time`, async () => {
    const { store, roll, card } = await play(edition);
    await roll('edith', 5);
    assert.equal(await store.statKind(`${SEARCH.edith}/margin-note.md`), 'file');
    assert.equal(await store.statKind(`${SEARCH.edith}/address-correction.md`), 'file');
    await roll('street', 40);
    assert.equal(await store.statKind(`${SEARCH.street}/asked-the-way.md`), 'missing');
    assert.equal(await store.statKind(`${SEARCH.street}/revision-scrap.md`), 'file');
    assert.equal((await card()).status.data.left, 10, 'successes cost no time');
    await roll('morgue', 70);
    assert.equal(await store.statKind(`${SEARCH.morgue}/time-record.md`), 'missing', 'a failure holds back the key clue');
    assert.equal(await store.statKind(`${SEARCH.morgue}/time-record-half.md`), 'file');
    assert.equal((await card()).status.data.picture, 'no', 'a failure pins nothing');
    assert.equal((await card()).status.data.left, 9);
    await roll('studio', 97);
    assert.equal(await store.statKind(`${SEARCH.studio}/visible-details.md`), 'missing');
    assert.equal(await store.statKind(`${SEARCH.studio}/visible-details-half.md`), 'file');
    assert.equal((await card()).status.data.left, 7, 'a critical failure costs two steps');
  });

  test(`${edition}: too many misses — Wayne turns up anyway, and noon brings the fourth picture`, async () => {
    const { store, roll, choose, card } = await play(edition);
    for (const key of ['morgue', 'studio', 'editor', 'edith']) await roll(key, 97); // 10 → 2
    assert.equal((await card()).status.data.arrived, 'no', 'four half clues: there may still be a way');
    await roll('street', 70); // 2 → 1, five half clues: three key clues are out of reach
    assert.deepEqual({ ...(await card()).status.data }, { left: 1, arrived: 'yes', picture: 'no', hand: 'no', address: 'no' });
    await assert.rejects(() => choose('confront'));
    await assert.rejects(() => choose('trap'));
    assert.equal(await reachedEnding(store), null);
    await roll('scene', 70); // 1 → 0
    assert.equal((await card()).status.data.left, 0);
    assert.equal((await reachedEnding(store))?.id, 'fourth-picture');
  });
}
