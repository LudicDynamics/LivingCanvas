// 试玩: a trial of a workshop draft plays the
// draft's LATEST content with everything play produced back at the opening.
// The draft is played in place here (search → roll → find, a take, states,
// a CG, a background swap, NPC talk, an ending), then a fresh copy is loaded
// through the real route: the copy must be at the standard opening while the
// author's own edits made in between are all there, and the draft untouched.
// Runs against built dist: `pnpm --filter @airp/server build`.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { test } from 'node:test';
import {
  LocalWorldStore,
  appendNpcDialogue,
  createActionService,
  endWorld,
  parseFrontmatter,
  showCg,
  stringifyFrontmatter,
  swapBackground,
  writeState,
} from '@airp/shared';
import { createWorldRouter } from '../dist/routes/world.js';
import { runDeclaredRoll } from '../dist/engine/declared-actions.js';
import { playHistoryOf, resetPlayState } from '../dist/world-play-reset.js';

const ID = 'made-1234abcd';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

const bands = (reward) => [
  { min: 2, max: 4, text: 'Nothing.', options: [{ id: 'leave', label: 'Leave', action: { kind: 'enter', target: 'map' } }] },
  { min: 5, max: 10, text: 'Almost.', options: [{ id: 'leave', label: 'Leave', action: { kind: 'enter', target: 'map' } }] },
  { min: 11, max: 17, text: 'Found it.', options: [{ id: 'leave', label: 'Leave', action: { kind: 'enter', target: 'map' } }], rewards: [reward] },
  { min: 18, max: 20, text: 'Found it fast.', options: [{ id: 'leave', label: 'Leave', action: { kind: 'enter', target: 'map' } }], rewards: [reward] },
];

const SAFE_BODY = '\nA heavy safe.\n';

/** A small draft: states on player / world / a character, a clock, one ending, a searchable hall. */
async function writeDraft(dir) {
  const w = async (rel, text) => { await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true }); await fs.writeFile(path.join(dir, rel), text); };
  await w('world.json', JSON.stringify({
    id: ID, name: 'Trial', description: '', author: 'local', genre: 'test', characters: [], createdAt: 'x', updatedAt: 'x',
    workshop: { status: 'draft', owner: 'local', createdAt: 'x' },
    mode: 'closed',
    clock: { path: 'world/clock.md', key: 'left', start: 3, label: 'Night' },
    endings: [{ id: 'caught', title: 'Caught', path: 'endings/caught/README.md' }],
  }));
  await w('world/README.md', stringifyFrontmatter({ type: 'readme', name: 'Root', states: [{ id: 'alarm', label: 'Alarm', type: 'flag', initial: false }] }, '\nThe root.\n'));
  await w('world/clock.md', stringifyFrontmatter({ type: 'note', title: 'Clock', status: { data: { left: 3 } } }, '\n'));
  await w('player/README.md', stringifyFrontmatter({ type: 'readme', title: 'You', states: [{ id: 'hp', label: 'Wounds', type: 'number', initial: 3, range: [0, 3] }] }, '\n'));
  await w('player/lamp.md', stringifyFrontmatter({ type: 'note', title: 'Lamp', portable: true }, '\nYou start with it.\n'));
  await w('characters/su/README.md', stringifyFrontmatter({ type: 'readme', name: 'Su', states: [{ id: 'trust', label: 'Trust', type: 'number', initial: 0, range: [0, 5] }] }, '\n'));
  await w('characters/su/.pi/memory.db', 'memory');
  await w('endings/caught/README.md', stringifyFrontmatter({ type: 'ending', title: 'Caught' }, '\nCaught.\n'));
  await w('assets/scenes/a.png', PNG);
  await w('assets/scenes/b.png', PNG);
  await w('assets/cgs/c.png', PNG);
  await w('world/hall/README.md', stringifyFrontmatter({
    type: 'readme', name: 'Hall', bg: 'assets/scenes/a.png',
    search: [{
      id: 'desk', label: 'Search the desk', title: 'The desk', body: 'A desk.',
      roll_dice: { type: '2d10', desc: 'Search', expect: '>=11' },
      dice_outcomes: bands({ path: 'world/hall/letter.md', title: 'Letter', body: 'A letter.' }),
    }],
  }, '\nA hall.\n'));
  await w('world/hall/key.md', stringifyFrontmatter({ type: 'note', title: 'Key', portable: true }, '\nA key.\n'));
  await w('world/hall/lock.md', stringifyFrontmatter({ type: 'note', title: 'Lock', roll_dice: { type: '1d20', desc: 'Pick it', expect: '>=10' } }, '\nA lock.\n'));
  await w('world/hall/safe.md', stringifyFrontmatter({
    type: 'note', title: 'Safe',
    roll_dice: { type: '2d10', desc: 'Crack it', expect: '>=11' },
    dice_outcomes: bands({ path: 'world/hall/cash.md', title: 'Cash', body: 'Cash.' }),
  }, SAFE_BODY));
  await w('world/hall/su-he.md', stringifyFrontmatter({ type: 'npc', name: 'Su He', persona: 'Quiet.', knows: [], gives: [] }, '\n'));
  await w('command/give-note.yaml', 'name: Note\ndesc: d\ndo:\n  - action: give\n    with:\n      path: player/given-note.md\n      title: Given\n');
  await fs.mkdir(path.join(dir, '.airpworld'), { recursive: true });
  await fs.writeFile(path.join(dir, '.airpworld', 'intro.json'), '{"shown":true}');
  await fs.writeFile(path.join(dir, '.airpworld', 'opening.json'), '{"shown":true}');
}

/** Play the draft in place, the way an author testing it would, plus authoring edits in between. */
async function playDraft(store) {
  const player = createActionService(store, { type: 'player' }, { turn: 'req:1', rng: () => 0.6 });
  const god = createActionService(store, { type: 'god' }, { turn: 'req:2' });
  // Authoring: a card the writer builds, and an edited scene text.
  await god.createEntity({ path: 'world/hall/diary.md', frontmatter: { type: 'note', title: 'Diary' }, body: 'Built while authoring.' });
  const hall = parseFrontmatter(await store.readFile('world/hall/README.md'));
  await store.writeFile('world/hall/README.md', stringifyFrontmatter(hall.frontmatter, '\nA hall, rewritten by the author.\n'));
  // search → roll → find (2d10 at 0.6 each = 7 + 7 = 14: success).
  await player.searchPlace({ layer: 'world/hall', spot: 'desk' });
  await runDeclaredRoll(player, 'world/hall/search-desk.md');
  // An authored dice card with declared outcomes, and a plain check.
  await runDeclaredRoll(player, 'world/hall/safe.md');
  await player.rollDice({ path: 'world/hall/lock.md' });
  // Take items into the bag: an authored key, and the find.
  await player.moveEntity({ from: 'world/hall/key.md', to: 'player/key.md' });
  await player.moveEntity({ from: 'world/hall/letter.md', to: 'player/letter.md' });
  // A declared give landed its note.
  await god.createEntity({ path: 'player/given-note.md', frontmatter: { type: 'note', title: 'Given' }, body: 'x' });
  // States, a CG, a background swap, NPC talk, the fired-trigger record.
  await writeState(player.ctx, { target: 'player', state: 'hp', by: -2 });
  await writeState(player.ctx, { target: 'world', state: 'alarm', value: true });
  // A character's state value, as the file holds it (the edit path itself is
  // gated to edit_character_config for character READMEs).
  const su = parseFrontmatter(await store.readFile('characters/su/README.md'));
  await store.writeFile('characters/su/README.md', stringifyFrontmatter({ ...su.frontmatter, status: { data: { trust: 4 } } }, su.body));
  await showCg(player.ctx, { path: 'assets/cgs/c.png' });
  await swapBackground(player.ctx, { layer: 'world/hall', path: 'assets/scenes/b.png' });
  const npc = parseFrontmatter(await store.readFile('world/hall/su-he.md'));
  await store.writeFile('world/hall/su-he.md', stringifyFrontmatter({ ...npc.frontmatter, dialogue: appendNpcDialogue([], [{ by: 'player', text: 'Hi' }, { by: 'npc', text: '...' }]) }, npc.body));
  const root = parseFrontmatter(await store.readFile('world/README.md'));
  await store.writeFile('world/README.md', stringifyFrontmatter({ ...root.frontmatter, trigger_log: { t1: { count: 1, turn: 'req:1', at: 'x', status: 'done' } } }, root.body));
  // The clock moved, then the story ended.
  const clock = parseFrontmatter(await store.readFile('world/clock.md'));
  await store.writeFile('world/clock.md', stringifyFrontmatter({ ...clock.frontmatter, status: { data: { left: 1 } } }, clock.body));
  await endWorld(god.ctx, 'caught');
}

const fm = async (dir, rel) => parseFrontmatter(await fs.readFile(path.join(dir, rel), 'utf8'));
const missing = async (file) => fs.access(file).then(() => false, () => true);

/** Everything a standard opening must look like, for a world directory that went through the reset. */
async function assertOpening(dir) {
  for (const rel of ['world/hall/search-desk.md', 'world/hall/letter.md', 'player/letter.md', 'world/hall/cash.md', 'player/given-note.md', 'player/key.md']) {
    assert.ok(await missing(path.join(dir, rel)), `${rel} is play state and must be gone`);
  }
  assert.equal((await fm(dir, 'world/hall/key.md')).frontmatter.title, 'Key', 'the taken key is back where it was');
  assert.equal((await fm(dir, 'player/lamp.md')).frontmatter.title, 'Lamp', 'a starting item stays in the bag');
  const lock = (await fm(dir, 'world/hall/lock.md')).frontmatter.roll_dice;
  assert.deepEqual(lock, { type: '1d20', desc: 'Pick it', expect: '>=10' });
  const safe = await fm(dir, 'world/hall/safe.md');
  for (const key of ['dice_receipt', 'dice_grade', 'choice', 'choice_actions']) assert.equal(key in safe.frontmatter, false, `safe.${key}`);
  assert.equal(safe.frontmatter.roll_dice.result, undefined);
  assert.equal(safe.body, SAFE_BODY);
  assert.equal((await fm(dir, 'player/README.md')).frontmatter.status, undefined, 'hp back to initial');
  assert.equal((await fm(dir, 'characters/su/README.md')).frontmatter.status, undefined, 'trust back to initial');
  const root = (await fm(dir, 'world/README.md')).frontmatter;
  assert.equal(root.status, undefined, 'alarm, ending and endingTurn gone');
  assert.equal(root.trigger_log, undefined);
  assert.equal(root.cg_log, undefined);
  assert.deepEqual((await fm(dir, 'world/clock.md')).frontmatter.status, { data: { left: 3 } });
  assert.equal((await fm(dir, 'world/hall/su-he.md')).frontmatter.dialogue, undefined);
  const hall = await fm(dir, 'world/hall/README.md');
  assert.equal(hall.frontmatter.bg, 'assets/scenes/a.png', 'the swapped background is back');
  // The author's work survives.
  assert.equal(hall.body, '\nA hall, rewritten by the author.\n');
  assert.equal((await fm(dir, 'world/hall/diary.md')).frontmatter.title, 'Diary');
  assert.ok(Array.isArray(hall.frontmatter.search), 'declared search spots stay');
}

async function harness() {
  delete process.env.AIRP_USER_ID;
  delete process.env.AIRP_WORLDS_ROOT;
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-play-reset-'));
  const draft = path.join(repo, 'worlds', ID);
  await writeDraft(draft);
  let active = new LocalWorldStore(draft);
  const lifecycle = { isModelSwitching: () => false, beginWorldTransition() {}, completeWorldTransition() {}, stopCharacters: async () => {}, stopAll: async () => {}, startWriter: async () => {} };
  const bridge = { close() {}, startTailReader() {}, watchWorld() {}, broadcast() {} };
  const app = express();
  app.use(express.json());
  app.use('/api', createWorldRouter(repo, lifecycle, bridge, () => active, (store) => { active = store; }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  return {
    repo, draft, store: () => active,
    load: async (body) => {
      const r = await fetch(`${base}/worlds/load`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      return { status: r.status, body: await r.json() };
    },
    close: async () => { active?.close(); await new Promise((r) => server.close(r)); await fs.rm(repo, { recursive: true, force: true }); },
  };
}

test('a trial copy of a played draft starts at the standard opening with the latest authored content', async () => {
  const h = await harness();
  try {
    await playDraft(h.store());
    // The play really left its traces in the draft.
    assert.equal((await fm(h.draft, 'player/letter.md')).frontmatter.dice_reward.grade, 'success');
    assert.equal((await fm(h.draft, 'world/hall/safe.md')).frontmatter.dice_grade, 'success');
    assert.equal(typeof (await fm(h.draft, 'world/hall/lock.md')).frontmatter.roll_dice.result, 'number');
    assert.equal((await fm(h.draft, 'world/hall/cash.md')).frontmatter.dice_reward.source, 'world/hall/safe.md');
    assert.equal((await fm(h.draft, 'world/hall/README.md')).frontmatter.bg, 'assets/scenes/b.png');
    assert.equal((await fm(h.draft, 'world/README.md')).frontmatter.cg_log.length, 1);
    const r = await h.load({ worldPath: `worlds/${ID}`, fresh: true });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const copy = r.body.path;
    assert.match(path.basename(copy), new RegExp(`^${ID}-[0-9a-f]{8}$`));
    await assertOpening(copy);
    // Runtime markers never travel: the opening and the intro play again.
    assert.ok(await missing(path.join(copy, '.airpworld', 'intro.json')));
    assert.ok(await missing(path.join(copy, '.airpworld', 'opening.json')));
    assert.ok(await missing(path.join(copy, 'characters', 'su', '.pi')), 'a character memory store stays with the draft');
    // The draft itself is left exactly as played.
    assert.equal((await fm(h.draft, 'player/key.md')).frontmatter.title, 'Key');
    assert.equal((await fm(h.draft, 'world/README.md')).frontmatter.status.data.ending, 'caught');
    await fs.access(path.join(h.draft, 'characters', 'su', '.pi', 'memory.db'));
  } finally { await h.close(); }
});

test('clearing the draft in place backs every text file up first, and a second run finds nothing', async () => {
  const h = await harness();
  try {
    const store = h.store();
    await playDraft(store);
    const backupDir = path.join(h.draft, '.airpworld', 'backups', 'test');
    const report = await resetPlayState(h.draft, { history: await playHistoryOf(h.draft, store), store, backupDir });
    assert.deepEqual(report.unresolved, []);
    assert.ok(report.moved.some((m) => m.from === 'player/key.md' && m.to === 'world/hall/key.md'));
    await assertOpening(h.draft);
    // The draft keeps its own sessions and markers.
    await fs.access(path.join(h.draft, 'characters', 'su', '.pi', 'memory.db'));
    await fs.access(path.join(h.draft, '.airpworld', 'intro.json'));
    // The backup holds the played state.
    assert.equal(parseFrontmatter(await fs.readFile(path.join(backupDir, 'world/README.md'), 'utf8')).frontmatter.status.data.ending, 'caught');
    assert.equal(parseFrontmatter(await fs.readFile(path.join(backupDir, 'player/key.md'), 'utf8')).frontmatter.title, 'Key');
    const again = await resetPlayState(h.draft, { history: await playHistoryOf(h.draft, store), store });
    assert.deepEqual({ reset: again.reset, deleted: again.deleted, moved: again.moved }, { reset: [], deleted: [], moved: [] });
  } finally { await h.close(); }
});

test('a picked-up item whose place is taken again stays in the bag and is reported', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-play-reset-'));
  try {
    await fs.mkdir(path.join(dir, 'world', 'hall'), { recursive: true });
    await fs.mkdir(path.join(dir, 'player'), { recursive: true });
    await fs.writeFile(path.join(dir, 'world.json'), JSON.stringify({ id: 'w' }));
    await fs.writeFile(path.join(dir, 'player', 'key.md'), '---\ntitle: Key\n---\n');
    await fs.writeFile(path.join(dir, 'world', 'hall', 'key.md'), '---\ntitle: Another key the author placed\n---\n');
    const report = await resetPlayState(dir, { history: { moves: [{ seq: 1, from: 'world/hall/key.md', to: 'player/key.md' }], swaps: [] } });
    assert.deepEqual(report.moved, []);
    assert.equal(report.unresolved[0].path, 'player/key.md');
    await fs.access(path.join(dir, 'player', 'key.md'));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
