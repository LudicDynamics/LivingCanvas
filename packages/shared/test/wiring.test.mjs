/**
 * Tests for the doc-12 wiring actions: createEntity / enterLayer /
 * recordLayerInitialized / recordLayerInitFailed / noteCharacterTalked.
 *
 * These import the BUILT dist, so run `pnpm --filter @airp/shared build` first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  LocalWorldStore,
  createActionService,
  ACTION_METHODS,
  parseFrontmatter,
} from '../dist/index.js';

function tmpWorld() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'airp-wire-'));
  fs.mkdirSync(path.join(root, 'world', 'baker-street'), { recursive: true });
  fs.mkdirSync(path.join(root, 'characters', 'watson'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'world.json'),
    JSON.stringify({
      id: 'test-world', name: 'Test', version: '1.0.0', schema: 1,
      description: 'd', author: 'a', genre: 'mystery',
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    })
  );
  fs.writeFileSync(
    path.join(root, 'world', 'baker-street', 'README.md'),
    '---\ntype: readme\nname: Baker Street\n---\n\nA foggy street.\n'
  );
  fs.writeFileSync(
    path.join(root, 'characters', 'watson', 'README.md'),
    '---\ntype: readme\nname: Watson\n---\n\nA doctor.\n'
  );
  return root;
}

function svcFor(root, actor = { type: 'god' }) {
  const store = new LocalWorldStore(root);
  return { store, svc: createActionService(store, actor, { turn: 'test:1' }) };
}

test('all 32 frozen method names are bound (snapshot/rollback, searchPlace, skillCheck, setMusic and the dice consequences are included)', () => {
  assert.equal(ACTION_METHODS.length, 32);
  assert.ok(ACTION_METHODS.includes('diceConsequence'));
  assert.ok(ACTION_METHODS.includes('settleDiceConsequences'));
  assert.ok(ACTION_METHODS.includes('skillCheck'));
  assert.ok(ACTION_METHODS.includes('setMusic'));
});

test('createEntity writes a file, derives kind/name, and appends entity_created', async () => {
  const root = tmpWorld();
  const { store, svc } = svcFor(root);
  const res = await svc.createEntity({
    path: 'world/baker-street/the-old-mill.md',
    body: 'A mill by the river.',
    frontmatter: { type: 'note', title: 'The Old Mill' },
  });
  assert.equal(res.details.kind, 'note');
  assert.equal(res.details.name, 'The Old Mill');
  const written = fs.readFileSync(path.join(root, 'world/baker-street/the-old-mill.md'), 'utf-8');
  const { frontmatter } = parseFrontmatter(written);
  assert.equal(frontmatter.type, 'note');
  assert.equal(frontmatter.title, 'The Old Mill');
  const events = await store.getEvents();
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'entity_created');
  assert.equal(events[0].actor.type, 'god');
  assert.equal(events[0].detail.kind, 'note');
  assert.equal(events[0].layer, 'world/baker-street');
  store.close();
});

test('createEntity refuses README, non-md, absolute, and existing files', async () => {
  const root = tmpWorld();
  const { store, svc } = svcFor(root);
  await assert.rejects(() => svc.createEntity({ path: 'world/baker-street/README.md', body: '' }), /identity/i);
  await assert.rejects(() => svc.createEntity({ path: 'world/baker-street/x.txt', body: '' }), /markdown/i);
  await assert.rejects(() => svc.createEntity({ path: '/abs/x.md', body: '' }), /relative/i);
  // existing file (README's sibling already written)
  await svc.createEntity({ path: 'world/baker-street/dup.md', body: 'one' });
  await assert.rejects(() => svc.createEntity({ path: 'world/baker-street/dup.md', body: 'two' }), /already exists/i);
  store.close();
});

test('enterLayer records layer_entered with first=true for a stub layer', async () => {
  const root = tmpWorld();
  fs.mkdirSync(path.join(root, 'world', 'abandoned-orchard'), { recursive: true }); // no README => stub
  const { store, svc } = svcFor(root, { type: 'player' });
  const res = await svc.enterLayer({ layer: 'world/abandoned-orchard' });
  assert.equal(res.details.first, true);
  const events = await store.getEvents();
  assert.equal(events[0].type, 'layer_entered');
  assert.equal(events[0].detail.first, true);
  assert.equal(events[0].layer, 'world/abandoned-orchard');
  store.close();
});

test('enterLayer reports first=false for a written layer and reads its name', async () => {
  const root = tmpWorld();
  const { store, svc } = svcFor(root, { type: 'player' });
  const res = await svc.enterLayer({ layer: 'world/baker-street' });
  assert.equal(res.details.first, false);
  assert.equal(res.details.name, 'Baker Street');
  store.close();
});

test('recordLayerInitialized appends layer_initialized as engine', async () => {
  const root = tmpWorld();
  const { store, svc } = svcFor(root, { type: 'writer' });
  await svc.recordLayerInitialized({
    layer: 'world/baker-street', by: 'writer', files: ['world/baker-street/a.md'],
  });
  const events = await store.getEvents();
  assert.equal(events[0].type, 'layer_initialized');
  assert.equal(events[0].actor.type, 'engine');
  assert.deepEqual(events[0].detail.files, ['world/baker-street/a.md']);
  store.close();
});

test('recordLayerInitFailed DOES append (the one failure that records)', async () => {
  const root = tmpWorld();
  const { store, svc } = svcFor(root, { type: 'engine' });
  await svc.recordLayerInitFailed({
    layer: 'world/baker-street', reason: 'timeout', fallback: 'template',
  });
  const events = await store.getEvents();
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'layer_init_failed');
  assert.equal(events[0].detail.fallback, 'template');
  store.close();
});

test('noteCharacterTalked defaults turns to 1 and marks it estimated', async () => {
  const root = tmpWorld();
  const { store, svc } = svcFor(root, { type: 'player' });
  const res = await svc.noteCharacterTalked({ character: 'watson' });
  assert.equal(res.details.turns, 1);
  assert.equal(res.details.turnsEstimated, true);
  assert.equal(res.details.name, 'Watson');
  const events = await store.getEvents();
  assert.equal(events[0].type, 'character_talked');
  assert.equal(events[0].layer, null); // a character is not a layer
  assert.equal(events[0].detail.turns, 1);
  store.close();
});

test('noteCharacterTalked honours a real count and rejects unknown characters', async () => {
  const root = tmpWorld();
  const { store, svc } = svcFor(root, { type: 'player' });
  const res = await svc.noteCharacterTalked({ character: 'watson', turns: 4, turnsEstimated: false });
  assert.equal(res.details.turns, 4);
  assert.equal(res.details.turnsEstimated, false);
  await assert.rejects(() => svc.noteCharacterTalked({ character: 'nobody' }), /No character/);
  store.close();
});

test('create/enter/init all share the passed turn anchor', async () => {
  const root = tmpWorld();
  const { store, svc } = svcFor(root, { type: 'god' });
  await svc.createEntity({ path: 'world/baker-street/a.md', body: 'x', frontmatter: { type: 'note' } });
  await svc.enterLayer({ layer: 'world/baker-street' });
  const events = await store.getEvents();
  assert.ok(events.every((e) => e.turn === 'test:1'));
  store.close();
});
