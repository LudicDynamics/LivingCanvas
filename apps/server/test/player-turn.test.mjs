// The server's half of a clock that moves with the player's turns (world.json
// `clock.perTurns`): a request to the writer and a line to a character are one
// turn each; an author's request in their own workshop world is not; a world
// without `perTurns` is never touched.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { LocalWorldStore, clockLeft, parseFrontmatter } from '@airp/shared';
import { countServerPlayerTurn } from '../dist/engine/player-turn.js';

async function world(id, manifest) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-player-turn-'));
  const root = path.join(base, id);
  const write = async (rel, text) => {
    await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await fs.writeFile(path.join(root, rel), text);
  };
  await write('world.json', JSON.stringify({ id, name: id, description: '', author: '', genre: '', createdAt: '', updatedAt: '', mode: 'closed', endings: [], ...manifest }));
  await write('world/README.md', '---\ntype: readme\nname: Map\n---\n');
  await write('world/days.md', '---\ntype: chalk\ntitle: Days\nstatus:\n  data:\n    left: 3\n    turns: 0\n---\n');
  const store = new LocalWorldStore(root);
  const turns = async () => parseFrontmatter(await store.readFile('world/days.md')).frontmatter.status.data.turns;
  return { store, turns };
}

const CLOCK = { clock: { path: 'world/days.md', key: 'left', start: 3, label: 'h', perTurns: 2 } };

test('a request and a line to a character are one turn each; the second moves the clock', async () => {
  const { store, turns } = await world('inn-1a2b3c4d', CLOCK);
  try {
    assert.equal((await countServerPlayerTurn(store, 'request')).turns, 1);
    assert.equal(await turns(), 1);
    const second = await countServerPlayerTurn(store, 'talk');
    assert.equal(second.ticked, true);
    assert.equal(await clockLeft(store), 2);
    assert.equal(await turns(), 0);
  } finally {
    store.close();
  }
});

test('no perTurns, no count; an author in their own workshop world is not playing', async () => {
  const plain = await world('plain-1a2b3c4d', { clock: { path: 'world/days.md', key: 'left', start: 3, label: 'h' } });
  try {
    assert.equal(await countServerPlayerTurn(plain.store, 'request'), null);
    assert.equal(await plain.turns(), 0);
  } finally {
    plain.store.close();
  }
  // The ORIGINAL of a workshop world (directory name == id, owned by this user).
  const authoring = await world('made-inn', { ...CLOCK, workshop: { status: 'draft', owner: 'local', createdAt: '' } });
  try {
    assert.equal(await countServerPlayerTurn(authoring.store, 'request'), null);
    assert.equal(await authoring.turns(), 0);
  } finally {
    authoring.store.close();
  }
  assert.equal(await countServerPlayerTurn(null, 'request'), null);
});
