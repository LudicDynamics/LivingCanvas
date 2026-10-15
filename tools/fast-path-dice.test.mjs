// The engine pays a declared spot's finds for a skill check (the design notes,
// the design notes step 2 ①): a protagonist check whose skill is the spot's `skill` or
// one of its `alt_skills`, or a check framed with `spot`, IS that spot's search. The card lands as
// `search-<spot>.md` with the spot's own bands, and the ROLL creates the band's declared rewards —
// for every grade, every time, whoever framed the check (the player's sheet, the agent writer, the
// fast path). Nothing is left to the narrator's judgment.
//
// Uses 七日旅店 (templates/seven-days-inn-zh): the shrine's `scene` spot is occult, with
// `alt_skills: [spot_hidden]`; 侦查 60. Bands: great → shrine-path + stele-back, success →
// shrine-path, setback / failure → the half clue (partial).
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test as nodeTest } from 'node:test';
import { testsNeeding } from './shipped-worlds.mjs';
import { fileURLToPath } from 'node:url';
import { LocalWorldStore, createActionService, parseFrontmatter, parseSearchDeclarations } from '../packages/shared/dist/index.js';
import { runDeclaredRoll } from '../apps/server/dist/engine/declared-actions.js';
import { altSkillProblems } from './check-world-editions.mjs';

const TEMPLATE = fileURLToPath(new URL('../templates/seven-days-inn-zh', import.meta.url));
// Every test here plays 七日旅店; skipped where this copy does not carry it.
const test = testsNeeding(nodeTest, 'seven-days-inn-zh');
const SHRINE = 'world/shrine';
/** d100 under 侦查 60: one score per grade. */
const SCORE = { great: 9, success: 47, setback: 67, failure: 98 };
const FINDS = {
  great: ['world/shrine/shrine-path.md', 'world/shrine/stele-back.md'],
  success: ['world/shrine/shrine-path.md'],
  setback: ['world/shrine/shrine-path-half.md'],
  failure: ['world/shrine/shrine-path-half.md'],
};
const ALL_FINDS = ['world/shrine/shrine-path.md', 'world/shrine/stele-back.md', 'world/shrine/shrine-path-half.md'];

async function world() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fast-path-dice-'));
  await fs.cp(TEMPLATE, root, { recursive: true });
  const store = new LocalWorldStore(root);
  let n = 0;
  const svc = (actor = { type: 'player' }) => createActionService(store, actor, { turn: `req:fpd-${++n}` });
  const has = (rel) => fs.access(path.join(root, rel)).then(() => true, () => false);
  const fm = async (rel) => parseFrontmatter(await store.readFile(rel)).frontmatter;
  return { root, store, svc, has, fm, done: () => { store.close(); return fs.rm(root, { recursive: true, force: true }); } };
}

for (const grade of Object.keys(SCORE)) {
  test(`a player's 侦查 check at the shrine is the stele search; a ${grade} roll creates exactly that band's finds`, async () => {
    const w = await world();
    try {
      const framed = await w.svc().skillCheck({ skill: 'spot_hidden', title: '查看这里还有什么', layer: SHRINE });
      assert.equal(framed.details.path, `${SHRINE}/search-scene.md`, 'bound to the declared spot');
      assert.equal(framed.details.spot, 'scene');
      assert.deepEqual([...framed.details.finds].sort(), [...ALL_FINDS].sort());
      const card = await w.fm(framed.details.path);
      assert.deepEqual(card.search_source, { layer: SHRINE, spot: 'scene' });
      assert.equal(card.skill_check.skill, 'spot_hidden');
      assert.equal(card.dice_outcomes.length, 4, 'the spot\'s own bands');
      for (const f of ALL_FINDS) assert.equal(await w.has(f), false, 'nothing before the roll');
      const rolled = await runDeclaredRoll(w.svc({ type: 'god' }), framed.details.path, SCORE[grade]);
      assert.equal(rolled.details.skill.grade, grade);
      for (const f of ALL_FINDS) assert.equal(await w.has(f), FINDS[grade].includes(f), `${grade}: ${f}`);
      if (grade === 'setback' || grade === 'failure') assert.equal((await w.fm('world/shrine/shrine-path-half.md')).title, '半条线索 · 「过三棵」');
    } finally {
      await w.done();
    }
  });
}

test('once the spot is searched, the next check there is a free one (no second payout)', async () => {
  const w = await world();
  try {
    const first = await w.svc().skillCheck({ skill: 'spot_hidden', title: '寻找小路', layer: SHRINE });
    await runDeclaredRoll(w.svc({ type: 'god' }), first.details.path, SCORE.setback);
    const again = await w.svc().skillCheck({ skill: 'occult', title: '再看一次石碑', layer: SHRINE });
    assert.equal(again.details.path, `${SHRINE}/check-1.md`);
    assert.equal(again.details.spot, undefined);
    assert.equal((await w.fm(again.details.path)).dice_outcomes, undefined, 'a free check carries no declared bands');
  } finally {
    await w.done();
  }
});

test('a skill the spot does not name stays a free check; the writer can bind any skill with spot', async () => {
  const w = await world();
  try {
    const free = await w.svc().skillCheck({ skill: 'persuade', title: '劝自己相信', layer: SHRINE });
    assert.equal(free.details.path, `${SHRINE}/check-1.md`);
    // The writer frames psychology at the stele with improvised outcomes: the spot's bands win.
    const writer = w.svc({ type: 'writer' });
    const bound = await writer.skillCheck({
      skill: 'psychology', title: '想起口诀', layer: SHRINE, spot: 'scene',
      outcomes: Object.fromEntries(['failure', 'setback', 'success', 'great'].map((g) => [g, { text: `${g} prose` }])),
    });
    assert.equal(bound.details.path, `${SHRINE}/search-scene.md`);
    assert.match(bound.text, /outcomes you wrote were not used/);
    await runDeclaredRoll(w.svc({ type: 'god' }), bound.details.path, 30);
    assert.equal(await w.has('world/shrine/shrine-path.md'), true);
    await assert.rejects(writer.skillCheck({ skill: 'occult', title: 'x', layer: SHRINE, spot: 'nowhere' }), /declares no searchable spot "nowhere"/);
    await assert.rejects(writer.skillCheck({ skill: 'listen', actor: 'kuri', title: 'x', layer: SHRINE, spot: 'scene' }), /Only the protagonist/);
  } finally {
    await w.done();
  }
});

test('the front hall\'s spot_hidden spot binds by its own skill (no alt_skills needed)', async () => {
  const w = await world();
  try {
    const framed = await w.svc().skillCheck({ skill: 'spot_hidden', title: '查看这个房间还有什么东西', layer: 'world/front-hall' });
    assert.equal(framed.details.path, 'world/front-hall/search-scene.md');
    // The search button on the README now answers with the same card.
    const searched = await w.svc().searchPlace({ layer: 'world/front-hall', spot: 'scene' });
    assert.equal(searched.details.created, false);
  } finally {
    await w.done();
  }
});

test('alt_skills is validated: a list of known skill ids, never the spot\'s own skill twice', async () => {
  const base = { id: 'scene', label: 'l', title: 't', roll_dice: { type: '1d100', desc: 'd', expect: '<=60' }, dice_outcomes: [], skill: 'occult' };
  assert.deepEqual(parseSearchDeclarations({ search: [{ ...base, alt_skills: ['spot_hidden'] }] }).errors, []);
  assert.deepEqual(parseSearchDeclarations({ search: [{ ...base, alt_skills: ['spot_hidden'] }] }).spots[0].alt_skills, ['spot_hidden']);
  for (const bad of [[], 'spot_hidden', ['Spot Hidden'], ['occult'], ['a', 'a']]) {
    assert.match(parseSearchDeclarations({ search: [{ ...base, alt_skills: bad }] }).errors.join(' '), /alt_skills/, JSON.stringify(bad));
  }
  // check:worlds: every alt skill is on the protagonist's sheet.
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fast-path-alt-'));
  try {
    await fs.cp(TEMPLATE, root, { recursive: true });
    const manifest = JSON.parse(await fs.readFile(path.join(root, 'world.json'), 'utf8'));
    assert.deepEqual(await altSkillProblems(root, manifest), []);
    const readme = path.join(root, 'world/shrine/README.md');
    await fs.writeFile(readme, (await fs.readFile(readme, 'utf8')).replace('alt_skills: [spot_hidden]', 'alt_skills: [lockpicking]'));
    assert.match((await altSkillProblems(root, manifest)).join(' '), /alt_skills "lockpicking" is not on the protagonist's sheet/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
