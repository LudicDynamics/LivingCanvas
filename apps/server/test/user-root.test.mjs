// Per-user save roots. Runs against built dist
//: `pnpm --filter @airp/server build` first.
//
// The property under test is not "a path is built correctly" but the two
// promises accounts made:
//   1. a signed-in player sees ONLY their own saves, and a new game lands in
//      their own directory — same save id, different directory;
//   2. a developer with no account env gets byte-for-byte today's behaviour
//      (`<repo>/worlds`), so accounts cannot quietly relocate local work.
// `AIRP_USER_ID` is read per call (never cached at import), because one server
// process is one seat and the gateway sets that env before the process starts —
// but a test that cached it would pass while the real thing regressed.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { relativeSavePath, resolveWorldPath, userId, worldsRoot } from '../dist/engine/user-root.js';
import { readWorldShelf, trashWorldSave } from '../dist/world-shelf.js';

const MANIFEST = (id, name) => JSON.stringify({
  id, name, description: '', author: '', genre: 'test',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
});

/** A repo root with one template and one save per named user (plus a `local` save). */
async function repo(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-user-root-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const write = async (dir, id, name) => {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'world.json'), MANIFEST(id, name));
  };
  await write(path.join(root, 'templates', 'wuwu'), 'wuwu', 'Fogwharf');
  await write(path.join(root, 'worlds', 'wuwu-local'), 'wuwu', 'Fogwharf');
  await write(path.join(root, 'worlds', 'users', 'alice', 'wuwu-a1'), 'wuwu', 'Fogwharf');
  await write(path.join(root, 'worlds', 'users', 'bob', 'wuwu-b1'), 'wuwu', 'Fogwharf');
  return root;
}

/** Set `AIRP_USER_ID` for one body and always restore it. */
function asUser(t, uid) {
  const previous = process.env.AIRP_USER_ID;
  if (uid === undefined) delete process.env.AIRP_USER_ID;
  else process.env.AIRP_USER_ID = uid;
  t.after(() => {
    if (previous === undefined) delete process.env.AIRP_USER_ID;
    else process.env.AIRP_USER_ID = previous;
  });
}

test('no account env keeps today: uid local, saves in <repo>/worlds', async (t) => {
  const root = await repo(t);
  asUser(t, undefined);
  assert.equal(userId(), 'local');
  assert.equal(worldsRoot(root), path.join(root, 'worlds'));

  const shelf = await readWorldShelf(root);
  assert.deepEqual(shelf.worlds, ['wuwu-local'], 'only the top-level save, never another user\'s');
});

test('a signed-in user sees only their own saves, under worlds/users/<uid>', async (t) => {
  const root = await repo(t);
  asUser(t, 'alice');
  assert.equal(userId(), 'alice');
  assert.equal(worldsRoot(root), path.join(root, 'worlds', 'users', 'alice'));

  const shelf = await readWorldShelf(root);
  assert.deepEqual(shelf.worlds, ['wuwu-a1']);
  assert.ok(!JSON.stringify(shelf).includes('wuwu-b1'), 'bob\'s save must not leak into alice\'s shelf');
  assert.ok(!JSON.stringify(shelf).includes('wuwu-local'), 'the local save is not alice\'s either');

  // The client-facing id is unchanged — only the directory moved.
  const group = shelf.groups.find((g) => g.id === 'wuwu');
  assert.deepEqual(group.saves.map((s) => s.path), ['worlds/wuwu-a1']);
});

test('the same save id is a different directory for a different user', async (t) => {
  const root = await repo(t);
  asUser(t, 'alice');
  const alice = resolveWorldPath(root, 'worlds/shared-id');
  process.env.AIRP_USER_ID = 'bob';
  const bob = resolveWorldPath(root, 'worlds/shared-id');
  assert.notEqual(alice, bob);
  assert.equal(alice, path.join(root, 'worlds', 'users', 'alice', 'shared-id'));
  assert.equal(bob, path.join(root, 'worlds', 'users', 'bob', 'shared-id'));
});

test('templates stay shared and absolute paths pass through', async (t) => {
  const root = await repo(t);
  asUser(t, 'alice');
  assert.equal(resolveWorldPath(root, 'templates/wuwu'), path.join(root, 'templates', 'wuwu'));
  assert.equal(resolveWorldPath(root, '/tmp/elsewhere'), '/tmp/elsewhere');
});

test('an unsafe or absent uid falls back to local rather than escaping the root', async (t) => {
  const root = await repo(t);
  for (const bad of ['../etc', 'a/b', 'Alice', '', '  ', 'x'.repeat(65)]) {
    process.env.AIRP_USER_ID = bad;
    assert.equal(userId(), 'local', `uid ${JSON.stringify(bad)} must not be honoured`);
    assert.equal(worldsRoot(root), path.join(root, 'worlds'));
  }
  asUser(t, undefined);
});

test('AIRP_WORLDS_ROOT wins, so a container can mount the volume where it likes', async (t) => {
  const root = await repo(t);
  asUser(t, 'alice');
  const previous = process.env.AIRP_WORLDS_ROOT;
  process.env.AIRP_WORLDS_ROOT = path.join(root, 'mounted');
  t.after(() => {
    if (previous === undefined) delete process.env.AIRP_WORLDS_ROOT;
    else process.env.AIRP_WORLDS_ROOT = previous;
  });
  assert.equal(worldsRoot(root), path.join(root, 'mounted'));
  assert.equal(resolveWorldPath(root, 'worlds/s1'), path.join(root, 'mounted', 's1'));
});

test('relativeSavePath gives the client back the id it sent', async (t) => {
  const root = await repo(t);
  asUser(t, 'alice');
  assert.equal(relativeSavePath(root, path.join(root, 'worlds', 'users', 'alice', 'wuwu-a1')), 'worlds/wuwu-a1');
  // Outside the user's root (a template, an absolute AIRP_WORLD) → repo-relative.
  assert.equal(relativeSavePath(root, path.join(root, 'templates', 'wuwu')), 'templates/wuwu');
});

test('deleting resolves inside the caller\'s root, so one user cannot trash another\'s save', async (t) => {
  const root = await repo(t);
  asUser(t, 'alice');
  // `worlds/wuwu-b1` is bob's id; for alice it simply does not exist.
  await assert.rejects(() => trashWorldSave(root, 'worlds/wuwu-b1'), /Save not found/);
  await fs.access(path.join(root, 'worlds', 'users', 'bob', 'wuwu-b1', 'world.json'));

  const result = await trashWorldSave(root, 'worlds/wuwu-a1');
  assert.equal(result.ok, true);
  assert.match(result.recoveryPath, /\.trash/);
  await assert.rejects(() => fs.access(path.join(root, 'worlds', 'users', 'alice', 'wuwu-a1')));
});
