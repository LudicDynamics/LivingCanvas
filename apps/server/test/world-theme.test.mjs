// World themes on the server: the workshop writes the
// theme and its derived mode, the writer's per-turn block carries the theme,
// a themed search roll resolves with the theme's dice, and the first-entry
// intro saves its answers into player/README.md. Runs against built dist.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

import { LocalWorldStore, createActionService, parseFrontmatter } from '@airp/shared';
import { createWorkshopWorld, parseCreateWorldInput, parseSuggestFormInput, suggestFormPrompt, worldBuildingBrief, writeThemeStates } from '../dist/world-workshop.js';
import { introStateOf, parseIntroFields, playerReadmeWithIntro, readIntroShown, suggestIntroFields, writeIntroShown, writePlayerIntro } from '../dist/world-intro.js';
import { runDeclaredRoll } from '../dist/engine/declared-actions.js';
import { resetTurnCacheForTests } from '../../../packages/shared/dist/inject/turn-cache.js';

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const painter = async () => ({ ok: true, mimeType: 'image/png', dataB64: PNG_B64 });

async function sandbox() {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-theme-'));
  await fs.mkdir(path.join(repo, 'templates'));
  process.env.AIRP_WORLDS_ROOT = path.join(repo, 'saves');
  process.env.AIRP_PUBLISHED_ROOT = path.join(repo, 'shared');
  delete process.env.AIRP_USER_ID;
  return repo;
}

const body = (theme) => ({ name: '雾港', description: '一座会忘记船的港口。', locale: 'zh-CN', cover: { kind: 'generate', prompt: 'harbour' }, ...(theme ? { theme } : {}) });

test('the workshop writes the theme and the mode its flags derive; no theme keeps today\'s manifest', async () => {
  const repo = await sandbox();
  const made = await createWorkshopWorld(repo, parseCreateWorldInput(body({ type: 'trpg', rules: 'coc', structure: { endings: true, mysteries: true, clock: true } })), painter);
  const manifest = JSON.parse(await fs.readFile(path.join(repo, 'saves', made.id, 'world.json'), 'utf8'));
  assert.deepEqual(manifest.theme, { players: 'single', type: 'trpg', rules: 'coc', structure: { endings: true, mysteries: true, clock: true, puzzles: false } });
  assert.equal(manifest.mode, 'closed');
  assert.equal(manifest.clock, undefined, 'no clock card: the deadline is kept in prose');
  const sandboxWorld = await createWorkshopWorld(repo, parseCreateWorldInput(body({ type: 'companion' })), painter);
  assert.equal(JSON.parse(await fs.readFile(path.join(repo, 'saves', sandboxWorld.id, 'world.json'), 'utf8')).mode, 'open');
  const plain = await createWorkshopWorld(repo, parseCreateWorldInput(body()), painter);
  const plainManifest = JSON.parse(await fs.readFile(path.join(repo, 'saves', plain.id, 'world.json'), 'utf8'));
  assert.equal(plainManifest.theme, undefined);
  assert.equal(plainManifest.mode, undefined);
  assert.throws(() => parseCreateWorldInput(body({ type: 'moba' })), (err) => err.status === 400);
  assert.throws(() => parseCreateWorldInput(body({ players: 'multi' })), (err) => err.status === 400 && /not available/.test(err.message));
  assert.match(worldBuildingBrief(manifest), /Theme: Tabletop RPG · Call of Cthulhu · Investigation/);
  assert.match(worldBuildingBrief(manifest), /world\.json `mysteries`/);
  assert.doesNotMatch(worldBuildingBrief(plainManifest), /Theme:/);
});

test('a world made with a type gets that type\'s default music as audio.theme; no type writes no audio', async () => {
  const repo = await sandbox();
  const read = async (made) => JSON.parse(await fs.readFile(path.join(repo, 'saves', made.id, 'world.json'), 'utf8'));
  const infinite = await createWorkshopWorld(repo, parseCreateWorldInput(body({ type: 'infinite', rules: 'coc' })), painter);
  assert.deepEqual((await read(infinite)).audio, { theme: 'guixiang' });
  const companion = await createWorkshopWorld(repo, parseCreateWorldInput(body({ type: 'companion' })), painter);
  assert.deepEqual((await read(companion)).audio, { theme: 'calm' });
  const plain = await createWorkshopWorld(repo, parseCreateWorldInput(body()), painter);
  assert.equal((await read(plain)).audio, undefined);
});

test('一键补完 is told the chosen theme', () => {
  const prompt = suggestFormPrompt(parseSuggestFormInput({ locale: 'en', theme: { type: 'galgame' } }));
  assert.match(prompt, /theme is Dating sim/);
  assert.doesNotMatch(suggestFormPrompt(parseSuggestFormInput({ locale: 'en' })), /theme is/);
});

const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  tryNative: true,
  alias: { '@earendil-works/pi-coding-agent': new URL('../../../vendor/pi-rp/packages/coding-agent/dist/index.js', import.meta.url).pathname },
});

async function worldWith(theme) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-theme-ctx-'));
  const store = new LocalWorldStore(root);
  await store.writeFile('world.json', JSON.stringify({
    id: 'theme-ctx', name: 'T', description: '', author: '', genre: 'Workshop', characters: [],
    ...(theme ? { theme } : {}), createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  }));
  await store.writeFile('world/study/README.md', '---\nname: Study\n---\n\n# S\n');
  store.writeViewpoint({ layer: 'world/study', focus: null, selected: [], bagCount: 0 });
  store.close();
  return root;
}

async function injectedFor(root) {
  process.env.AIRP_AGENT_ROLE = 'writer';
  const mod = await jiti.import('../../../extensions/context.ts');
  const handlers = new Map();
  mod.default({ on: (event, handler) => handlers.set(event, handler), registerCustomType: () => {} });
  const ctx = { sessionManager: { getSessionId: () => `theme-${path.basename(root)}` }, cwd: root };
  await handlers.get('agent_start')({ type: 'agent_start' }, ctx);
  handlers.get('turn_start')({ type: 'turn_start', turnIndex: 0 });
  const result = handlers.get('context')({ type: 'context', messages: [] }, ctx);
  return result.messages.at(-1).content.map((b) => b.text).join('\n');
}

test('the writer\'s per-turn block carries the theme rules; an unthemed world gets none', async () => {
  resetTurnCacheForTests();
  const themed = await worldWith({ type: 'trpg', rules: 'dnd', structure: { endings: true } });
  const plain = await worldWith(null);
  try {
    const text = await injectedFor(themed);
    assert.match(text, /\[World state/);
    assert.match(text, /\[World Theme\] Tabletop RPG · D&D/);
    assert.match(text, /1d20\+2, expect ">=12"/);
    assert.match(text, /Endings: this world ends/);
    assert.doesNotMatch(await injectedFor(plain), /\[World Theme\]/);
  } finally {
    resetTurnCacheForTests();
    await fs.rm(themed, { recursive: true, force: true });
    await fs.rm(plain, { recursive: true, force: true });
  }
});

test('a search improvised in a D&D world resolves on the d20 table and creates its find only then', async () => {
  const root = await worldWith({ rules: 'dnd' });
  const store = new LocalWorldStore(root);
  try {
    const writer = createActionService(store, { type: 'writer' }, { turn: 'test:theme' });
    const { details } = await writer.searchPlace({
      layer: 'world/study',
      improvise: {
        title: 'Search the desk',
        outcomes: {
          failure: { text: 'Nothing.' },
          setback: { text: 'Splinters.' },
          success: { text: 'A key.', find: { title: 'Key', body: 'Brass.' } },
          great: { text: 'A key and a map.', find: { title: 'Key and map', body: 'Brass and paper.' } },
        },
      },
    });
    // rng 0.9 → a natural 19, +2 → 21: the great band (20–22).
    const player = createActionService(store, { type: 'player' }, { turn: 'test:theme-roll', rng: () => 0.9 });
    const rolled = await runDeclaredRoll(player, details.path);
    assert.equal(rolled.details.result, 21);
    assert.equal(rolled.details.outcomeGrade, 'great-success');
    assert.equal(rolled.details.outcomeText, 'A key and a map.');
    assert.equal(await store.statKind('world/study/search-1-great.md'), 'file');
    assert.equal(await store.statKind('world/study/search-1-success.md'), 'missing');
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('the intro: once per workshop save, answers land in player/README.md without clobbering it', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-intro-'));
  try {
    const manifest = { id: 'made-12345678', name: '雾港', description: '一座会忘记船的港口。', locale: 'zh-CN', workshop: { status: 'draft', owner: 'local' }, theme: { type: 'trpg' } };
    const state = introStateOf(root, manifest);
    assert.equal(state.workshop, true);
    assert.equal(state.shown, false);
    assert.equal(state.intro.title, '雾港');
    assert.match(state.intro.kicker, /类跑团/);
    assert.equal(introStateOf(root, { name: 'x' }).shown, true, 'a curated world has no intro');

    const fields = parseIntroFields({ identity: '港务局的新调查员', goal: '找出失踪的船', first: '码头的值班记录' });
    writePlayerIntro(root, fields, 'zh-CN');
    writeIntroShown(root, true);
    assert.equal(readIntroShown(root), true);
    const page = parseFrontmatter(await fs.readFile(path.join(root, 'player/README.md'), 'utf8'));
    assert.equal(page.frontmatter.type, 'readme');
    assert.equal(page.frontmatter.title, '你');
    assert.equal(page.frontmatter.goal, '找出失踪的船');
    assert.match(page.body, /\*\*你想做成什么\*\*: 找出失踪的船/);
    assert.deepEqual(introStateOf(root, manifest).fields, fields);

    // Re-answering replaces the block and keeps the author's own prose.
    const authored = '---\ntype: readme\ntitle: 你\n---\n\n你是K7次末班车的乘客。\n';
    const next = playerReadmeWithIntro(authored, { identity: 'A', goal: '', first: 'B' }, 'zh-CN');
    const again = playerReadmeWithIntro(next, { identity: 'C', goal: '', first: '' }, 'zh-CN');
    assert.match(again, /你是K7次末班车的乘客。/);
    assert.equal(again.split('<!-- world-intro -->').length, 2, 'one intro block');
    assert.match(again, /\*\*你是谁\*\*: C/);
    assert.doesNotMatch(again, /first:/);
    assert.throws(() => parseIntroFields({ goal: 'x'.repeat(301) }), (err) => err.status === 400);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('一键填写 for the intro keeps typed answers and asks with the world and its theme', async () => {
  const manifest = { name: 'Snow', description: 'A quiet town.', locale: 'en', theme: { type: 'companion' } };
  const calls = [];
  const fake = async (url, init) => {
    calls.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ identity: 'IGNORED', goal: 'Learn the baker\'s song', first: 'The bakery' }) } }] }), { status: 200 });
  };
  const filled = await suggestIntroFields(manifest, { identity: 'A new neighbour', goal: '', first: '' }, { DEEPSEEK_API_KEY: 'k' }, fake);
  assert.equal(filled.identity, 'A new neighbour');
  assert.equal(filled.first, 'The bakery');
  assert.match(calls[0].messages[0].content, /Companion life/);
  assert.match(calls[0].messages[0].content, /World: Snow/);
  await assert.rejects(suggestIntroFields(manifest, { identity: '', goal: '', first: '' }, {}, fake), (err) => err.code === 'no_text_model');
});

test('the workshop writes the theme\'s declared states into player, world and character READMEs; merge keeps what is declared', async () => {
  const repo = await sandbox();
  const made = await createWorkshopWorld(repo, parseCreateWorldInput(body({ type: 'trpg', rules: 'dnd' })), painter);
  const dir = path.join(repo, 'saves', made.id);
  const read = async (rel) => parseFrontmatter(await fs.readFile(path.join(dir, rel), 'utf8'));
  const player = await read('player/README.md');
  assert.equal(player.frontmatter.type, 'readme');
  assert.equal(player.frontmatter.title, '你');
  const hp = player.frontmatter.states.find((s) => s.id === 'hp');
  assert.equal(hp.label, '生命');
  assert.deepEqual(hp.range, [0, 12]);
  assert.equal(hp.shown_as.at(-1).text, '倒地不起');
  assert.ok(player.frontmatter.states.every((s) => !s.hidden));
  // Character skills: rules + a D&D sheet in the world's language.
  const madeManifest = JSON.parse(await fs.readFile(path.join(dir, 'world.json'), 'utf8'));
  assert.equal(madeManifest.rules.system, 'dnd');
  assert.ok(player.frontmatter.sheet.abilities);
  assert.equal(player.frontmatter.sheet.skills.find((x) => x.id === 'perception').label, '察觉');
  assert.ok(!player.frontmatter.states.some((x) => x.id === 'str'), 'abilities live on the sheet, not in states');
  const world = await read('world/README.md');
  assert.equal(world.frontmatter.bg, 'assets/scenes/intro.png', 'the entry scene keeps its frontmatter');
  assert.match(world.body, /一座会忘记船的港口/);
  assert.deepEqual(world.frontmatter.states.map((s) => s.id), ['alarm']);

  // Characters: none at creation; every listed character README gets the character defaults, merged by id.
  await fs.mkdir(path.join(dir, 'characters', 'lin'), { recursive: true });
  await fs.writeFile(path.join(dir, 'characters', 'lin', 'README.md'),
    '---\ntype: readme\nname: 林\nstates:\n  - { id: wariness, label: 戒备, type: number, initial: 90, range: [0, 100] }\n---\n\n林在码头。\n');
  await fs.writeFile(path.join(dir, 'player', 'README.md'), '---\ntype: readme\ntitle: 你\nstates: []\n---\n\n你是旅人。\n');
  await writeThemeStates(dir, { players: 'single', type: 'trpg', rules: 'dnd', structure: { endings: true, mysteries: true, clock: false, puzzles: false } }, 'zh-CN', [{ id: 'lin' }, { id: 'ghost' }]);
  const lin = await read('characters/lin/README.md');
  assert.deepEqual(lin.frontmatter.states.map((s) => s.id), ['wariness', 'stance']);
  assert.equal(lin.frontmatter.states[0].initial, 90, 'an existing declaration is never overwritten');
  assert.equal(lin.frontmatter.states[0].label, '戒备');
  assert.match(lin.body, /林在码头/);
  const again = await read('player/README.md');
  assert.ok(again.frontmatter.states.some((s) => s.id === 'hp'));
  assert.match(again.body, /你是旅人/);
  await assert.rejects(fs.access(path.join(dir, 'characters', 'ghost', 'README.md')), 'a missing character README is not invented');

  // English story world: world progress in English; no theme writes nothing.
  const story = await createWorkshopWorld(repo, parseCreateWorldInput({ ...body({ type: 'story' }), locale: 'en' }), painter);
  const storyWorld = parseFrontmatter(await fs.readFile(path.join(repo, 'saves', story.id, 'world', 'README.md'), 'utf8'));
  assert.equal(storyWorld.frontmatter.states[0].label, 'Plot progress');
  assert.equal(storyWorld.frontmatter.states[0].shown_as[0].text, 'The story has just begun');
  const plain = await createWorkshopWorld(repo, parseCreateWorldInput(body()), painter);
  await assert.rejects(fs.access(path.join(repo, 'saves', plain.id, 'player', 'README.md')));
  assert.equal(parseFrontmatter(await fs.readFile(path.join(repo, 'saves', plain.id, 'world', 'README.md'), 'utf8')).frontmatter.states, undefined);
});

test('create_char in a themed world declares the character defaults; an unthemed world gets none', async () => {
  const repo = await sandbox();
  const preset = { id: 'character', name: '', description: '', items: [{ id: 'a' }, { id: 'b' }] };
  const make = async (theme) => {
    const made = await createWorkshopWorld(repo, parseCreateWorldInput({ ...body(theme), locale: 'ja' }), painter);
    const root = path.join(repo, 'saves', made.id);
    const writer = createActionService(new LocalWorldStore(root), { type: 'writer' }, { turn: 'test:char', agentScope: 'writer-top-level' });
    await writer.createChar({ input: { id: 'mio', name: '澪', desc: '灯台守。', avatar: 'assets/scenes/intro.png' }, platformPreset: preset });
    return parseFrontmatter(await fs.readFile(path.join(root, 'characters', 'mio', 'README.md'), 'utf8')).frontmatter;
  };
  try {
    const gal = await make({ type: 'galgame' });
    assert.deepEqual(gal.states.map((s) => s.id), ['affection', 'trust']);
    assert.equal(gal.sheet, undefined, 'a narrative galgame has no skill rules');
    const trpg = await make({ type: 'trpg', rules: 'coc' });
    assert.equal(trpg.sheet.skills[0].label, '目星', 'a character in a CoC world gets a default sheet');
    assert.equal(gal.states[0].label, '好感度');
    assert.equal(gal.name, '澪');
    assert.equal((await make()).states, undefined);
  } finally {
    resetTurnCacheForTests();
  }
});
