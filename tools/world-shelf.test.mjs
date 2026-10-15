import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readWorldShelf, templateCover, trashWorldSave } from '../apps/server/dist/world-shelf.js';

test('saves group under their template and deletion is recoverable and scoped', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-shelf-'));
  const write = async (dir, id) => {
    await fs.mkdir(path.join(root, dir), { recursive: true });
    await fs.writeFile(path.join(root, dir, 'world.json'), JSON.stringify({ id, name: 'Same display name' }));
  };
  try {
    await write('templates/snow', 'snow');
    await write('templates/snow-jp', 'snow-jp');
    await write('worlds/snow-one', 'snow');
    await write('worlds/snow-two', 'snow-custom-id');
    await write('worlds/snow-jp-three', 'snow-jp');
    await write('worlds/orphan', 'orphan');
    const active = path.join(root, 'worlds/snow-one');
    const shelf = await readWorldShelf(root, active);
    assert.equal(shelf.groups.find(g => g.id === 'snow').saves.length, 2);
    assert.equal(shelf.groups.find(g => g.id === 'snow-jp').saves.length, 1);
    assert.equal(shelf.groups.find(g => g.id === 'orphan').templatePath, null);
    assert.equal(shelf.groups.find(g => g.id === 'snow').saves.find(s => s.id === 'snow-one').active, true);
    // Launcher media: intro image and video; never outside templates/.
    await fs.mkdir(path.join(root, 'templates/snow/assets/scenes'), { recursive: true });
    await fs.writeFile(path.join(root, 'templates/snow/assets/scenes/intro.webm'), 'webm');
    await fs.writeFile(path.join(root, 'templates/snow/assets/scenes/intro.webp'), 'webp');
    const media = (await readWorldShelf(root, active)).groups;
    // Cover URLs carry the file's content hash.
    const h = (text) => createHash('sha256').update(text).digest('hex').slice(0, 32);
    assert.equal(media.find(g => g.id === 'snow').cover, `/api/worlds/cover?id=snow&h=${h('webp')}`);
    assert.equal(media.find(g => g.id === 'snow').coverVideo, `/api/worlds/cover?id=snow&kind=video&h=${h('webm')}`);
    assert.equal(media.find(g => g.id === 'snow-jp').coverVideo, null);
    assert.match(await templateCover(root, 'snow', 'video'), /intro\.webm$/);
    assert.equal(await templateCover(root, '../worlds', 'image'), null);
    for (const invalid of ['templates/snow', 'worlds/..', 'worlds/.trash', 'worlds/snow-one/world', '/tmp', null]) {
      await assert.rejects(trashWorldSave(root, invalid, active));
    }
    await assert.rejects(trashWorldSave(root, 'worlds/snow-one', active), e => e.status === 409);
    await fs.symlink(path.join(root, 'templates/snow'), path.join(root, 'worlds/alias'));
    await assert.rejects(trashWorldSave(root, 'worlds/alias', active));
    const removed = await trashWorldSave(root, 'worlds/snow-two', active);
    assert.equal(JSON.parse(await fs.readFile(path.join(root, removed.recoveryPath, 'world.json'))).id, 'snow-custom-id');
    assert.equal((await readWorldShelf(root)).worlds.includes('snow-two'), false);
    assert.equal((await readWorldShelf(root)).worlds.includes('.trash'), false);
    await assert.rejects(trashWorldSave(root, 'worlds/snow-two', active), e => e.status === 404);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
