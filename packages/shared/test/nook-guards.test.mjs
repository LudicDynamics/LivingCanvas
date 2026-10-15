import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { ActionError } from '../dist/actions/errors.js';
import { createActionService } from '../dist/actions/service.js';
import '../dist/actions/delete.js';
import '../dist/actions/move.js';
import '../dist/actions/chalk.js';
import { writeNookNote } from '../dist/actions/nook-note.js';
import { editCharacterConfig } from '../dist/actions/edit-character-config.js';
import { LocalWorldStore } from '../dist/store/local-store.js';

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-nook-guard-'));
  const store = new LocalWorldStore(root);
  await store.writeFile('world.json', JSON.stringify({
    id: 'guard-test', name: 'Guard test', description: '', author: '', genre: 'test',
    characters: [{ id: 'ryo', name: 'Ryo', home: 'world/inn' }],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  }));
  await store.writeFile('world/README.md', '---\ntype: readme\n---\nMap');
  await store.writeFile('characters/other/key.md', 'Other key');
  await store.writeFile('characters/ryo/identity.md', 'Identity');
  await store.writeFile('characters/ryo/personality.md', 'Personality');
  await store.writeFile('characters/ryo/memory.md', 'Memory');
  await store.writeFile('characters/ryo/key.md', 'A key');
  return store;
}

function code(expected) {
  return (error) => {
    assert.ok(error instanceof ActionError);
    assert.equal(error.code, expected);
    return true;
  };
}

test('generic character operations protect configuration and foreign nooks', async () => {
  const store = await fixture();
  const character = createActionService(store, { type: 'character', id: 'ryo' }, { turn: 'guard:character', agentScope: 'character' });
  await assert.rejects(() => character.editEntity({ path: 'characters/other/key.md', body: 'Nope' }), code('unsupported'));
  const ownMemory = await editCharacterConfig(character.ctx, {
    characterId: 'ryo', file: 'memory.md', content: 'Character fact', mode: 'append',
  });
  await assert.rejects(
    () => character.moveEntity({ from: 'characters/ryo/key.md', to: 'characters/ryo/memory.md' }),
    code('not_movable'),
  );
  assert.equal(ownMemory.details.path, 'characters/ryo/memory.md');
  await assert.rejects(
    () => editCharacterConfig(character.ctx, { characterId: 'ryo', file: 'identity.md', content: 'Nope', mode: 'replace' }),
    code('unsupported'),
  );
  const writer = createActionService(store, { type: 'writer' }, { turn: 'guard:writer', agentScope: 'writer-top-level' });
  const edited = await editCharacterConfig(writer.ctx, {
    characterId: 'ryo', file: 'memory.md', content: 'A sourced fact', mode: 'append',
  });
  assert.equal(edited.details.path, 'characters/ryo/memory.md');
  assert.match(await store.readFile('characters/ryo/memory.md'), /A sourced fact/);
});

test('the initializer may create a missing configuration file but never rewrite one', async () => {
  const store = await fixture();
  const initializer = createActionService(
    store,
    { type: 'writer' },
    { turn: 'guard:initializer', agentScope: 'initializer' },
  );
  const created = await editCharacterConfig(initializer.ctx, {
    characterId: 'ryo', file: 'README.md', content: '# Ryo\n\nA quiet room.', mode: 'replace',
  });
  assert.equal(created.details.path, 'characters/ryo/README.md');
  assert.match(await store.readFile('characters/ryo/README.md'), /A quiet room/);
  // Second run must not rewrite it: create-only is the whole point.
  await assert.rejects(
    () => editCharacterConfig(initializer.ctx, {
      characterId: 'ryo', file: 'README.md', content: '# Overwrite', mode: 'replace',
    }),
    code('unsupported'),
  );
  // An initializer may not touch a file that already exists either.
  await assert.rejects(
    () => editCharacterConfig(initializer.ctx, {
      characterId: 'ryo', file: 'identity.md', content: 'Nope', mode: 'append',
    }),
    code('unsupported'),
  );
});

test('validated player nook note remains the only player character write', async () => {
  const store = await fixture();
  const player = createActionService(store, { type: 'player' }, { turn: 'guard:player', agentScope: 'player' });
  const result = await writeNookNote(player.ctx, { characterId: 'ryo', title: 'Note', body: 'A player note' });
  assert.equal(result.details.actor.type, 'player');
  assert.match(await store.readFile(result.details.path), /A player note/);
  await assert.rejects(() => player.editEntity({ path: 'characters/ryo/key.md', body: 'Nope' }), code('unsupported'));
});
