/**
 * `searchPlace`: a search spawns a dice chalk and
 * nothing else; the finds only exist after the roll. Imports the BUILT dist.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  LocalWorldStore,
  createActionService,
  parseFrontmatter,
  parseSearchDeclarations,
  searchFinds,
  stringifyFrontmatter,
} from '../dist/index.js';

const SPOT = {
  id: 'drawer',
  label: 'Search the drawer (roll)',
  title: 'Rummage through the drawer',
  body: 'Nothing is found until you roll.',
  roll_dice: { type: '2d10', desc: 'Rummage through the drawer', expect: '>=11' },
  dice_outcomes: [[2, 4], [5, 10], [11, 17], [18, 20]].map(([min, max]) => ({
    min, max, text: `band ${min}`,
    options: [{ id: 'back', label: 'Back', action: { kind: 'enter', target: 'world/study' } }],
    ...(min >= 11 ? { rewards: [{ path: 'world/study/letter.md', title: 'A letter', body: 'Dear…' }] } : {}),
  })),
};

function tmpWorld(search = [SPOT]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'airp-search-'));
  fs.mkdirSync(path.join(root, 'world', 'study'), { recursive: true });
  fs.writeFileSync(path.join(root, 'world.json'), JSON.stringify({
    id: 'search-world', name: 'Search', version: '1.0.0', schema: 1, description: 'd', author: 'a', genre: 'mystery',
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  }));
  fs.writeFileSync(path.join(root, 'world', 'README.md'), '---\ntype: readme\nname: Root\n---\n\nRoot.\n');
  fs.writeFileSync(path.join(root, 'world', 'study', 'README.md'), stringifyFrontmatter({ type: 'gate', name: 'Study', search }, 'A study.'));
  return root;
}

const svcFor = (root, actor = { type: 'player' }, opts = {}) => {
  const store = new LocalWorldStore(root);
  return { store, svc: createActionService(store, actor, { turn: 'test:search', ...opts }) };
};

test('parseSearchDeclarations validates spots and lists their finds', () => {
  const ok = parseSearchDeclarations({ search: [SPOT] });
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(searchFinds(ok.spots[0]), ['world/study/letter.md']);
  const bad = parseSearchDeclarations({ search: [
    { ...SPOT, id: 'Bad Id' },
    { ...SPOT, roll_dice: { ...SPOT.roll_dice, result: 12 } },
    { ...SPOT, id: 'no-table', dice_outcomes: undefined },
  ] });
  assert.equal(bad.errors.length, 3, bad.errors.join('\n'));
  assert.match(bad.errors.join('\n'), /kebab-case/);
  assert.match(bad.errors.join('\n'), /must not carry a result/);
  assert.match(bad.errors.join('\n'), /neither dice_outcomes nor on/);
});

test('a declared search spawns only the dice chalk; the find does not exist yet', async () => {
  const root = tmpWorld();
  const { store, svc } = svcFor(root);
  const before = (await store.getEventsSince(0)).length;
  const res = await svc.searchPlace({ layer: 'world/study', spot: 'drawer' });
  assert.equal(res.details.path, 'world/study/search-drawer.md');
  assert.equal(res.details.created, true);
  assert.deepEqual(res.details.finds, ['world/study/letter.md']);
  assert.equal(await store.statKind('world/study/letter.md'), 'missing', 'no item before the roll');
  const chalk = parseFrontmatter(await store.readFile(res.details.path));
  assert.equal(chalk.frontmatter.type, 'chalk');
  assert.equal(chalk.interactive.roll_dice.type, '2d10');
  assert.equal(chalk.interactive.roll_dice.result, undefined);
  assert.deepEqual(chalk.frontmatter.search_source, { layer: 'world/study', spot: 'drawer' });
  assert.equal(chalk.frontmatter.dice_outcomes.length, 4);
  const events = (await store.getEventsSince(0)).slice(before);
  assert.deepEqual(events.map((e) => e.type), ['entity_created'], 'exactly one event: the dice chalk');
});

test('searching the same spot twice returns the same chalk; a removed chalk is not respawned', async () => {
  const root = tmpWorld();
  const { store, svc } = svcFor(root);
  await svc.searchPlace({ layer: 'world/study', spot: 'drawer' });
  const again = await svc.searchPlace({ layer: 'world/study/README.md', spot: 'drawer' });
  assert.equal(again.details.created, false);
  assert.equal((await store.getEventsSince(0)).filter((e) => e.type === 'entity_created').length, 1);
  fs.rmSync(path.join(root, 'world/study/search-drawer.md'));
  await assert.rejects(() => svc.searchPlace({ layer: 'world/study', spot: 'drawer' }), (e) => e.code === 'already_exists');
});

test('a find that is already on disk is an authoring error, not a second copy', async () => {
  const root = tmpWorld();
  fs.writeFileSync(path.join(root, 'world/study/letter.md'), '---\ntype: note\ntitle: Pre-placed\n---\n\nOops.\n');
  const { svc } = svcFor(root);
  await assert.rejects(() => svc.searchPlace({ layer: 'world/study', spot: 'drawer' }), /never placed beforehand/);
});

test('an undeclared spot and an unknown place are refused', async () => {
  const { svc } = svcFor(tmpWorld());
  await assert.rejects(() => svc.searchPlace({ layer: 'world/study', spot: 'safe' }), (e) => e.code === 'not_found');
  await assert.rejects(() => svc.searchPlace({ layer: 'world/nowhere', spot: 'drawer' }), (e) => e.code === 'not_found');
  await assert.rejects(() => svc.searchPlace({ layer: 'world/study' }), (e) => e.code === 'invalid_argument');
});

const IMPROVISE = {
  title: 'Check under the rug',
  continue_label: 'Go on',
  outcomes: {
    failure: { text: 'Dust.' },
    setback: { text: 'A loose thread.' },
    success: { text: 'A coin.', find: { title: 'Old coin', body: 'A worn penny.' } },
    great: { text: 'A coin and a note.', find: { title: 'Coin and note', body: 'A penny wrapped in a note.' } },
  },
};

test('the writer may improvise a minor find: standard 2d10 bands, finds created only by the roll', async () => {
  const root = tmpWorld();
  const { store, svc } = svcFor(root, { type: 'writer' });
  const res = await svc.searchPlace({ layer: 'world/study', improvise: IMPROVISE });
  assert.equal(res.details.path, 'world/study/search-1.md');
  assert.deepEqual(res.details.finds, ['world/study/search-1-success.md', 'world/study/search-1-great.md']);
  for (const find of res.details.finds) assert.equal(await store.statKind(find), 'missing');
  const fm = parseFrontmatter(await store.readFile(res.details.path)).frontmatter;
  assert.deepEqual(fm.dice_outcomes.map((b) => [b.min, b.max]), [[2, 4], [5, 10], [11, 17], [18, 20]]);
  assert.deepEqual(fm.roll_dice, { type: '2d10', desc: 'Check under the rug', expect: '>=11' });
  const second = await svc.searchPlace({ layer: 'world/study', improvise: IMPROVISE });
  assert.equal(second.details.path, 'world/study/search-2.md');
});

test('players cannot improvise, and agents cannot roll a search for the player', async () => {
  const root = tmpWorld();
  await assert.rejects(() => svcFor(root).svc.searchPlace({ layer: 'world/study', improvise: IMPROVISE }), /Only the writer/);
  const { svc: player } = svcFor(root);
  const { details } = await player.searchPlace({ layer: 'world/study', spot: 'drawer' });
  const { svc: writer } = svcFor(root, { type: 'writer' });
  await assert.rejects(() => writer.rollDice({ path: details.path }), (e) => e.code === 'not_interactive');
  const { svc: rolling } = svcFor(root, { type: 'player' }, { rng: () => 0.9 });
  const rolled = await rolling.rollDice({ path: details.path });
  assert.equal(typeof rolled.details.result, 'number');
});
