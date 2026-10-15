import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  ActionError,
  LocalWorldStore,
  NookNoteInputSchema,
  NookNoteOutcomeSchema,
  createActionService,
  parseFrontmatter,
  writeNookNote,
} from '../dist/index.js';

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-nook-note-'));
  const store = new LocalWorldStore(root);
  await store.writeFile('world.json', JSON.stringify({
    id: 'nook-note-test',
    name: 'Nook note test',
    description: '',
    author: '',
    genre: 'test',
    createdAt: '',
    updatedAt: '',
    characters: [{ id: 'ryo', name: 'Ryo', home: 'world/map' }],
  }));
  await store.writeFile('world/README.md', '---\ntype: readme\nname: Map\n---\n');
  await store.writeFile('characters/ryo/README.md', '---\ntype: readme\nname: Ryo\n---\n');
  await store.writeFile('characters/ryo/01-old.md', '---\ntype: note\ntitle: Old\n---\nOld.\n');
  return { root, store };
}

function isCode(code) {
  return (error) => error instanceof ActionError && error.code === code;
}

test('NookNote schemas describe the narrow transport and player outcome', () => {
  assert.equal(NookNoteInputSchema.safeParse({ characterId: 'ryo', title: 'A note', body: 'Body' }).success, true);
  assert.equal(NookNoteInputSchema.safeParse({ characterId: 'ryo', title: 'A note', body: 'Body', path: 'characters/ryo/README.md' }).success, false);
  assert.equal(NookNoteInputSchema.safeParse({ characterId: 'ryo', title: 'A note', body: 'Body', actor: { type: 'god' } }).success, false);
  assert.equal(NookNoteOutcomeSchema.safeParse({
    path: 'characters/ryo/02-a-note.md',
    eventSeq: 1,
    actor: { type: 'player' },
    created: true,
  }).success, true);
  assert.equal(NookNoteOutcomeSchema.safeParse({
    path: 'characters/ryo/README.md',
    eventSeq: 1,
    actor: { type: 'player' },
    created: true,
  }).success, false);
});

test('writeNookNote generates a direct child, records player entity_created, and is player-only', async () => {
  const { root, store } = await fixture();
  try {
    const service = createActionService(store, { type: 'player' }, { turn: 'req:nook-note-test' });
    const result = await writeNookNote(service.ctx, { characterId: 'ryo', title: 'A note', body: 'Body' });
    assert.equal(result.details.path, 'characters/ryo/02-a-note.md');
    assert.equal(result.details.created, true);
    assert.deepEqual(result.details.actor, { type: 'player' });
    assert.equal(result.details.eventSeq, result.details.event.seq);

    const parsed = parseFrontmatter(await store.readFile(result.details.path));
    assert.equal(parsed.frontmatter.title, 'A note');
    assert.equal(parsed.body.trim(), 'Body');
    const events = await store.getEventsSince(0);
    assert.equal(events.length, 1);
    assert.deepEqual(events[0].actor, { type: 'player' });
    assert.equal(events[0].subject, result.details.path);

    const god = createActionService(store, { type: 'god' }, { turn: 'req:god' });
    await assert.rejects(
      () => writeNookNote(god.ctx, { characterId: 'ryo', title: 'Nope', body: 'Nope' }),
      isCode('invalid_argument')
    );
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('writeNookNote rejects invalid ids and missing nooks without writing', async () => {
  const { root, store } = await fixture();
  try {
    const service = createActionService(store, { type: 'player' }, { turn: 'req:nook-note-test' });
    await assert.rejects(
      () => writeNookNote(service.ctx, { characterId: 'ryo/../x', title: 'Nope', body: 'Nope' }),
      isCode('invalid_argument')
    );
    await assert.rejects(
      () => writeNookNote(service.ctx, { characterId: 'ghost', title: 'Nope', body: 'Nope' }),
      isCode('not_found')
    );
    assert.deepEqual((await store.listFiles('characters/ryo')).sort(), [
      'characters/ryo/01-old.md',
      'characters/ryo/README.md',
    ]);
    assert.deepEqual(await store.getEventsSince(0), []);
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('writeNookNote serializes concurrent ordinal allocation and deduplicates clientRef retries', async () => {
  const { root, store } = await fixture();
  try {
    const service = createActionService(store, { type: 'player' }, { turn: 'req:nook-note-concurrent' });
    const inputs = [
      { characterId: 'ryo', title: 'Concurrent A', body: 'A' },
      { characterId: 'ryo', title: 'Concurrent B', body: 'B' },
      { characterId: 'ryo', title: 'Concurrent C', body: 'C' },
      { characterId: 'ryo', title: 'Concurrent D', body: 'D' },
      { characterId: 'ryo', title: 'Retry note', body: 'same', clientRef: 'retry-1' },
      { characterId: 'ryo', title: 'Retry note', body: 'same', clientRef: 'retry-1' },
    ];
    const results = await Promise.all(inputs.map((input) => writeNookNote(service.ctx, input)));
    const paths = results.map((result) => result.details.path);
    assert.equal(new Set(paths).size, 5, `paths must have one deduplicated retry: ${paths.join(', ')}`);
    assert.equal(paths[4], paths[5]);
    assert.equal(new Set(results.map((result) => result.details.eventSeq)).size, 5);

    const events = await store.getEventsSince(0);
    assert.equal(events.length, 5);
    assert.equal(new Set(events.map((event) => event.subject)).size, 5);
    assert.deepEqual(new Set(events.map((event) => event.actor.type)), new Set(['player']));

    await assert.rejects(
      () => writeNookNote(service.ctx, {
        characterId: 'ryo',
        title: 'Retry changed',
        body: 'different',
        clientRef: 'retry-1',
      }),
      isCode('invalid_argument')
    );
    assert.equal((await store.getEventsSince(0)).length, 5);
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
