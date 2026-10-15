// The lobby's "what is this world" card (schemas/world-intro.ts, the design notes).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { WorldManifestSchema, worldIntroMachine, worldIntroProblems } from '../dist/index.js';

const templates = fileURLToPath(new URL('../../../templates/', import.meta.url));
const read = (id) => JSON.parse(fs.readFileSync(path.join(templates, id, 'world.json'), 'utf8'));

const intro = (extra = {}) => ({
  status: 'playable', category: 'trpg', rank: 1, hook: 'A hook.', genres: ['mystery'], loop: ['one', 'two', 'three'], minutes: [30, 45],
  difficulty: 'intro', mechanics: ['dice', 'clock', 'endings'], endings: 2, characters: [{ id: 'a', line: 'A line.' }], for: ['First-time players'], ...extra,
});
const world = (extra = {}, introExtra = {}) => ({
  rules: { system: 'coc' }, clock: { path: 'world/c.md', key: 'left', start: 8 },
  endings: [{ id: 'x', title: 'X', path: 'endings/x/README.md' }, { id: 'y', title: 'Y', path: 'endings/y/README.md' }],
  characters: [{ id: 'a', home: 'map' }], intro: intro(introExtra), ...extra,
});

test('an honest intro has no problems', () => {
  assert.deepEqual(worldIntroProblems(world()), []);
});

test('the gate catches promises the world does not keep', () => {
  assert.match(worldIntroProblems(world({ clock: undefined })).join('\n'), /no clock/);
  assert.match(worldIntroProblems(world({ rules: undefined })).join('\n'), /declares no rules/);
  assert.match(worldIntroProblems(world({}, { endings: 3 })).join('\n'), /declares 2 endings/);
  assert.match(worldIntroProblems(world({}, { characters: [{ id: 'ghost', line: 'Boo.' }] })).join('\n'), /no character "ghost"/);
  assert.match(worldIntroProblems(world({}, { mechanics: ['sanity'] })).join('\n'), /rules.sanity/);
});

test('an unfinished world must say what is unfinished, and cannot be recommended', () => {
  assert.match(worldIntroProblems(world({}, { status: 'in-development' })).join('\n'), /unfinished is required/);
  assert.match(worldIntroProblems(world({}, { status: 'experimental', unfinished: 'No endings yet.', recommended: true })).join('\n'), /only a playable world/);
  assert.deepEqual(worldIntroProblems(world({}, { status: 'experimental', unfinished: 'No endings yet.' })), []);
});

test('shape: three loop lines, known enums, from ≤ to', () => {
  assert.match(worldIntroProblems(world({}, { loop: ['one'] })).join('\n'), /intro.loop/);
  assert.match(worldIntroProblems(world({}, { genres: ['western'] })).join('\n'), /intro.genres/);
  assert.match(worldIntroProblems(world({}, { minutes: [45, 30] })).join('\n'), /from ≤ to/);
  assert.match(worldIntroProblems(world({ intro: undefined })).join('\n'), /intro/);
});

test('a malformed intro never refuses the world at runtime', () => {
  const base = { id: 'w', name: 'W', description: 'd', author: 'a', genre: 'g', createdAt: '', updatedAt: '' };
  assert.equal(WorldManifestSchema.parse({ ...base, intro: { status: 'nope' } }).intro, undefined);
  assert.equal(WorldManifestSchema.parse({ ...base, intro: intro() }).intro.status, 'playable');
});

test('every official world and experiment ships an intro; the machine part is the same in every edition', () => {
  // The open-source copy carries only some worlds: check the ones here.
  const families = ['wuwu', 'guixiang', 'whitechapel', 'last-train', 'first-snow', 'divergence', 'unwritten-door', 'moonlit-contract', 'magic-academy', 'forger', 'islet', 'last-witness']
    .filter((id) => fs.existsSync(path.join(templates, id, 'world.json')));
  const status = {};
  for (const base of families) {
    const editions = ['', '-jp', '-zh', '-ko'].map((s) => read(base + s));
    for (const m of editions) assert.deepEqual(worldIntroProblems(m), [], m.id);
    for (const m of editions.slice(1)) assert.deepEqual(worldIntroMachine(m.intro), worldIntroMachine(editions[0].intro), m.id);
    status[base] = editions[0].intro.status;
  }
  // fpal is withheld from the open-source copy; everywhere else both experiments are present.
  const experiments = ['mandongbu', 'fpal'].filter((id) => fs.existsSync(path.join(templates, id, 'world.json')));
  for (const id of experiments) {
    assert.deepEqual(worldIntroProblems(read(id)), [], id);
    status[id] = read(id).intro.status;
  }
  assert.deepEqual(Object.keys(status).filter((k) => status[k] === 'playable'), ['wuwu', 'guixiang', 'whitechapel', 'last-train', 'first-snow', 'divergence', 'forger', 'last-witness'].filter((id) => id in status));
  assert.deepEqual(Object.keys(status).filter((k) => status[k] === 'experimental'), experiments);
  const recommended = families.filter((base) => read(base).intro.recommended);
  assert.ok(recommended.length >= 1 && recommended.length <= 2, `1–2 新手推荐, got ${recommended}`);
});

test('category: required for an official world, one of three, the same in every edition', () => {
  assert.match(worldIntroProblems(world({}, { category: undefined })).join('\n'), /intro.category is required/);
  assert.match(worldIntroProblems(world({}, { category: 'galgame' })).join('\n'), /category/);
  assert.match(worldIntroProblems(world({}, { category: 'experimental' })).join('\n'), /category/);
  // Lenient at runtime: a workshop world's card without a category still parses.
  assert.equal(WorldManifestSchema.parse({ id: 'w', name: 'W', description: 'd', author: 'a', genre: 'g', createdAt: '', updatedAt: '', intro: intro({ category: undefined }) }).intro?.category, undefined);
  assert.notDeepEqual(worldIntroMachine(intro()), worldIntroMachine(intro({ category: 'free' })));
  assert.notDeepEqual(worldIntroMachine(intro()), worldIntroMachine(intro({ experimental: true })));
  const expected = {
    wuwu: 'trpg', guixiang: 'trpg', whitechapel: 'trpg', 'last-train': 'trpg', 'unwritten-door': 'trpg', forger: 'trpg', 'last-witness': 'trpg',
    // The first-run prologue: a hidden family of its own.
    'last-train-prologue': 'trpg',
    'first-snow': 'story', divergence: 'story', 'moonlit-contract': 'story', 'magic-academy': 'story',
    mandongbu: 'free', fpal: 'free', islet: 'free',
    // Frames (2026-10-08, `exp: true`): not edition families yet.
    'night-radio': 'trpg', 'lost-map': 'trpg', 'seven-days-inn': 'story',
  };
  const experimental = new Set(['magic-academy', 'mandongbu', 'fpal', 'islet', 'night-radio', 'seven-days-inn']);
  for (const id of fs.readdirSync(templates)) {
    if (!fs.existsSync(path.join(templates, id, 'world.json'))) continue;
    const family = id.replace(/-(jp|zh|ko)$/, '');
    assert.equal(read(id).intro?.category, expected[family], `${id}: intro.category`);
    assert.equal(read(id).intro?.experimental === true, experimental.has(family), `${id}: intro.experimental`);
  }
});
