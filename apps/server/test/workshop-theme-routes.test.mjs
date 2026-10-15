// Creation-mode 设定: the draft's world type, rule pack
// and structure flags stay editable after creation. Saving writes world.json
// `theme` + `mode` and merges the new defaults into the READMEs by id, never
// deleting a state. Draft workshop worlds only.
// Runs against built dist: `pnpm --filter @airp/server build`.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { test } from 'node:test';
import { LocalWorldStore, parseFrontmatter } from '@airp/shared';
import { createWorkshopThemeRouter } from '../dist/routes/workshop-theme.js';
import { writeDefaultSheets, writeThemeStates } from '../dist/world-workshop.js';

const INFINITE_COC = { players: 'single', type: 'infinite', rules: 'coc', structure: { endings: true, mysteries: true, clock: false, puzzles: false } };

async function world({ status = 'draft', id = 'made-1234abcd', theme = INFINITE_COC } = {}) {
  delete process.env.AIRP_USER_ID;
  const root = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'airp-theme-')), id);
  const store = new LocalWorldStore(root);
  await store.writeFile('world.json', JSON.stringify({
    id: 'made-1234abcd', name: 'Village', description: 'A village.', author: 'local', genre: 'Workshop', locale: 'en',
    workshop: { status, owner: 'local', createdAt: 'x' },
    characters: [{ id: 'po', name: 'Po', home: 'map' }],
    triggers: [{ id: 'keep-me', kind: 'place', when: { layer: 'world/well' } }],
    ...(theme ? { theme, mode: 'semi' } : {}),
    createdAt: 'x', updatedAt: 'x',
  }, null, 2));
  await store.writeFile('world/README.md', '---\ntype: readme\nname: Root\nstates:\n  - id: names_rested\n    label: Names\n    type: number\n    default: 0\n---\n\nThe hall.\n');
  await store.writeFile('player/README.md', '---\ntype: readme\ntitle: You\n---\n\nYou.\n');
  await store.writeFile('characters/po/README.md', '---\ntype: readme\nname: Po\n---\n\nPo.\n');
  // A character folder the manifest does not list yet still gets the defaults.
  await store.writeFile('characters/lin/README.md', '---\ntype: readme\nname: Lin\n---\n\nLin.\n');
  if (theme) await writeThemeStates(root, theme, 'en', [{ id: 'po' }, { id: 'lin' }]);
  return store;
}

async function serve(store) {
  const app = express();
  app.use(express.json());
  app.use('/api', createWorkshopThemeRouter({ getStore: () => store }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/workshop/theme`;
  const get = async () => { const r = await fetch(base); return { status: r.status, body: await r.json() }; };
  const post = async (body) => {
    const r = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  return { get, post, close: () => new Promise((r) => server.close(r)) };
}

const ids = async (store, file) => (parseFrontmatter(await store.readFile(file)).frontmatter.states ?? []).map((s) => s.id);
const manifestOf = async (store) => JSON.parse(await store.readFile('world.json'));

test('GET answers the stored theme, its mode and the registry ids', async () => {
  const s = await serve(await world());
  try {
    const { status, body } = await s.get();
    assert.equal(status, 200);
    assert.deepEqual(body.theme, INFINITE_COC);
    assert.equal(body.mode, 'semi');
    assert.equal(body.stored, true);
    assert.deepEqual(body.options.players, ['single']);
    assert.ok(body.options.types.includes('companion'));
    assert.ok(body.options.rules.includes('coc'));
    assert.deepEqual(body.options.flags, ['endings', 'mysteries', 'clock', 'puzzles']);
  } finally { await s.close(); }
});

test('GET resolves a world without a theme to the default', async () => {
  const s = await serve(await world({ theme: null }));
  try {
    const { body } = await s.get();
    assert.equal(body.stored, false);
    assert.equal(body.theme.rules, 'narrative');
    assert.equal(body.mode, 'open');
  } finally { await s.close(); }
});

test('POST rewrites theme + mode, merges the new defaults by id and deletes nothing', async () => {
  const store = await world();
  const beforePlayer = await ids(store, 'player/README.md');
  const s = await serve(store);
  try {
    const { status, body } = await s.post({ theme: { players: 'single', type: 'sim', rules: 'narrative', structure: { endings: true, clock: true } } });
    assert.equal(status, 200, JSON.stringify(body));
    const m = await manifestOf(store);
    assert.equal(m.theme.type, 'sim');
    assert.equal(m.theme.rules, 'narrative');
    assert.deepEqual(m.theme.structure, { endings: true, mysteries: false, clock: true, puzzles: false });
    assert.equal(m.mode, 'closed');
    assert.equal(body.mode, 'closed');
    // The rest of world.json is untouched.
    assert.deepEqual(m.triggers, [{ id: 'keep-me', kind: 'place', when: { layer: 'world/well' } }]);
    assert.equal(m.name, 'Village');
    // Old states stay, new ones are appended.
    const player = await ids(store, 'player/README.md');
    for (const id of beforePlayer) assert.ok(player.includes(id), `kept ${id}`);
    assert.ok(player.includes('skill') && player.includes('stamina'));
    assert.deepEqual(await ids(store, 'world/README.md'), ['names_rested', 'day']);
    assert.ok((await ids(store, 'characters/lin/README.md')).includes('trust'));
    // What the old theme brought and the new one does not, still declared.
    assert.ok(body.unused.player.includes('sanity') && body.unused.player.includes('points'));
    assert.ok(!body.unused.player.includes('hp'));
    assert.deepEqual(body.unused.world, []);
    assert.deepEqual(body.unused.character, ['trust']);
  } finally { await s.close(); }
});

test('POST refuses a malformed theme, multiplayer, and a missing theme — and writes nothing', async () => {
  const store = await world();
  const before = await store.readFile('world.json');
  const s = await serve(store);
  try {
    assert.equal((await s.post({ theme: { players: 'multi', type: 'trpg' } })).status, 400);
    assert.equal((await s.post({ theme: { type: 'nope' } })).status, 400);
    assert.equal((await s.post({ theme: { rules: 'coc', structure: { endings: 'yes' } } })).status, 400);
    assert.equal((await s.post({})).status, 400);
    assert.equal(await store.readFile('world.json'), before);
  } finally { await s.close(); }
});

test("only the author's draft: a published world, a play copy and no world are refused", async () => {
  const published = await serve(await world({ status: 'published' }));
  try {
    assert.equal((await published.get()).status, 409);
    assert.equal((await published.post({ theme: { type: 'story' } })).status, 409);
  } finally { await published.close(); }
  const copy = await serve(await world({ id: 'made-1234abcd-9f9f9f9f' }));
  try { assert.equal((await copy.post({ theme: { type: 'story' } })).status, 403); } finally { await copy.close(); }
  const none = await serve(null);
  try { assert.equal((await none.get()).status, 409); } finally { await none.close(); }
});

test('changing the type moves default music along, but never music the author chose', async () => {
  // The infinite type's default is guixiang; story's is divergence.
  const store = await world();
  const s = await serve(store);
  try {
    const m = await manifestOf(store);
    m.audio = { theme: 'guixiang' };
    await store.writeFile('world.json', JSON.stringify(m, null, 2));
    assert.equal((await s.post({ theme: { type: 'story' } })).status, 200);
    assert.equal((await manifestOf(store)).audio.theme, 'divergence', 'old default follows the new type');

    const chosen = await manifestOf(store);
    chosen.audio = { theme: 'wuwu' };
    await store.writeFile('world.json', JSON.stringify(chosen, null, 2));
    assert.equal((await s.post({ theme: { type: 'sim' } })).status, 200);
    assert.equal((await manifestOf(store)).audio.theme, 'wuwu', 'an author-chosen theme stays');
  } finally {
    await s.close();
  }
});

// Character skills: a coc / dnd rule pack
// makes world.json `rules` and default sheets; the 设定 page edits them.
test('rules and sheets follow the rule pack; a system change resets the sheets', async () => {
  const store = await world();
  await writeDefaultSheets(store.worldRoot, 'coc', 'en', [{ id: 'po' }, { id: 'lin' }]);
  const s = await serve(store);
  try {
    const coc = await s.post({ theme: INFINITE_COC });
    assert.equal(coc.status, 200);
    assert.equal((await manifestOf(store)).rules.system, 'coc');
    assert.deepEqual(coc.body.sheetsReset, [], 'same system: sheets kept');
    // Switching CoC → D&D asks first: a 409 naming the sheets, nothing written.
    const asked = await s.post({ theme: { ...INFINITE_COC, rules: 'dnd' } });
    assert.equal(asked.status, 409);
    assert.equal(asked.body.code, 'sheets_reset_required');
    assert.deepEqual(asked.body.replace.sort(), ['characters/lin/README.md', 'characters/po/README.md', 'player/README.md']);
    assert.equal((await manifestOf(store)).rules.system, 'coc', 'cancel keeps the old system');
    assert.equal((await manifestOf(store)).theme.rules, 'coc');
    assert.equal(parseFrontmatter(await store.readFile('player/README.md')).frontmatter.sheet.abilities, undefined, 'and the old sheets');
    const dnd = await s.post({ theme: { ...INFINITE_COC, rules: 'dnd' }, confirmReset: true });
    assert.equal(dnd.status, 200);
    assert.equal((await manifestOf(store)).rules.system, 'dnd');
    assert.deepEqual(dnd.body.sheetsReset.sort(), ['characters/lin/README.md', 'characters/po/README.md', 'player/README.md']);
    assert.ok(parseFrontmatter(await store.readFile('player/README.md')).frontmatter.sheet.abilities, 'a D&D sheet now');
    await s.post({ theme: { ...INFINITE_COC, rules: 'narrative' } });
    assert.equal((await manifestOf(store)).rules, undefined, 'narrative: no skill rules');
  } finally {
    await s.close();
  }
});

test('GET /workshop/sheets lists every sheet; POST /workshop/sheet saves a clean one, refuses a bad one', async () => {
  const store = await world();
  await writeDefaultSheets(store.worldRoot, 'coc', 'en', [{ id: 'po' }]);
  const manifest = await manifestOf(store);
  manifest.rules = { system: 'coc' };
  await store.writeFile('world.json', JSON.stringify(manifest, null, 2));
  const s = await serve(store);
  try {
    const app = express();
    app.use(express.json());
    app.use('/api', createWorkshopThemeRouter({ getStore: () => store }));
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const root = `http://127.0.0.1:${server.address().port}/api/workshop`;
    try {
      const list = await (await fetch(`${root}/sheets`)).json();
      assert.equal(list.rules.system, 'coc');
      assert.deepEqual(Object.keys(list.sheets).sort(), ['player', 'po']);
      const save = (target, sheet) => fetch(`${root}/sheet`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target, sheet }) });
      const ok = await save('player', { skills: [{ id: 'spot_hidden', label: 'Eyes', value: 75 }, { id: 'radio', label: 'Radio', value: 50 }] });
      assert.equal(ok.status, 200);
      const sheet = parseFrontmatter(await store.readFile('player/README.md')).frontmatter.sheet;
      assert.deepEqual(sheet.skills.map((x) => [x.id, x.value]), [['spot_hidden', 75], ['radio', 50]]);
      const bad = await save('player', { skills: [{ id: 'listen', value: 140 }] });
      assert.equal(bad.status, 400);
      assert.equal(parseFrontmatter(await store.readFile('player/README.md')).frontmatter.sheet.skills[0].value, 75, 'nothing half-written');
      assert.equal((await save('ghost', { skills: [{ id: 'listen', value: 40 }] })).status, 404);
    } finally {
      await new Promise((r) => server.close(r));
    }
  } finally {
    await s.close();
  }
});
