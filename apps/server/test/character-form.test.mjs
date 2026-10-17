// A character's forms on GET /api/characters.
// Runs against built dist: `pnpm --filter @airp/server build` first.
//
// 「归乡」's companion opens as a girl and is later seen as the old woman she is.
// The switch is the declared `form` state; the route is where the character rail,
// the dialogue header and TTS learn the name / portrait / voice, so it must follow.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { test } from 'node:test';
import { LocalWorldStore, createActionService, characterFormOf, characterFormProblems, parseFrontmatter, writeState } from '@airp/shared';
import { createWorldRouter } from '../dist/routes/world.js';
import { EventBridge } from '../dist/engine/event-bridge.js';

const README = `---
type: readme
name: Lianmei
avatar: assets/characters/girl.webp
voice: gentle-calm
states:
  - id: form
    label: Look
    type: enum
    values: [young, elder]
    initial: young
    hidden: true
forms:
  elder:
    name: Granny Xiulian
    avatar: assets/characters/granny.webp
    voice: mature-elegant
    description: The keeper of the hall, as she really is.
---

A girl with wet cuffs.
`;

async function harness() {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-form-repo-'));
  const store = new LocalWorldStore(path.join(repo, 'world-root'));
  await store.writeFile('world.json', JSON.stringify({
    id: 'proj-form', name: 'Form', description: '', author: '', genre: 'test', createdAt: '', updatedAt: '',
    characters: [{ id: 'xiulian', name: 'Lianmei', home: 'map', description: 'A girl with wet cuffs.', avatar: 'assets/characters/girl.webp' }],
  }));
  await store.writeFile('world/README.md', '---\nname: Map\ntype: readme\n---\n\n# Map\n');
  await store.writeFile('characters/xiulian/README.md', README);
  await store.writeFile('characters/xiulian/preset.json', JSON.stringify({ id: 'xiulian' }));
  const lifecycle = { stopCharacters: async () => {}, startWriter: async () => {}, stopAll: async () => {} };
  const app = express();
  app.use(express.json());
  app.use('/api', createWorldRouter(repo, lifecycle, new EventBridge(), () => store, () => {}));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  return {
    store,
    character: async () => (await (await fetch(`${base}/characters`)).json()).characters.find((c) => c.id === 'xiulian'),
    close: async () => { server.close(); try { store.close(); } catch {} await fs.rm(repo, { recursive: true, force: true }); },
  };
}

test('the base form is what world.json and the README say', async () => {
  const h = await harness();
  try {
    const c = await h.character();
    assert.equal(c.name, 'Lianmei');
    assert.equal(c.avatar, 'assets/characters/girl.webp');
    assert.equal(c.voice, 'gentle-calm');
    assert.equal(c.bio, 'A girl with wet cuffs.');
  } finally { await h.close(); }
});

test('set_state form → elder: the route reports the other face, name, voice and bio', async () => {
  const h = await harness();
  try {
    await writeState(createActionService(h.store, { type: 'god' }, { turn: 'req:form' }).ctx, { target: 'characters/xiulian', state: 'form', value: 'elder' });
    const c = await h.character();
    assert.equal(c.name, 'Granny Xiulian');
    assert.equal(c.avatar, 'assets/characters/granny.webp');
    assert.equal(c.voice, 'mature-elegant');
    assert.equal(c.bio, 'The keeper of the hall, as she really is.');
    // The README itself still declares the base face: the form is a state, not a rewrite.
    const fm = parseFrontmatter(await h.store.readFile('characters/xiulian/README.md')).frontmatter;
    assert.equal(fm.name, 'Lianmei');
    assert.equal(characterFormOf(fm)?.form, 'elder');
  } finally { await h.close(); }
});

test('characterFormProblems: forms need an enum form state and only replace identity fields', () => {
  const fm = parseFrontmatter(README).frontmatter;
  assert.deepEqual(characterFormProblems(fm), []);
  assert.match(characterFormProblems({ forms: { elder: { name: 'x' } } })[0], /enum state "form"/);
  const bad = characterFormProblems({ ...fm, forms: { old: { name: 'x', home: 'map' } } });
  assert.ok(bad.some((p) => p.includes('forms.old: not a value')));
  assert.ok(bad.some((p) => p.includes('forms.old.home')));
});
