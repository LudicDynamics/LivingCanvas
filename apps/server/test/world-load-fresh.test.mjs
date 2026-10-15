// 「重新开始这个世界」 on a draft: a draft made in the
// workshop has no template, so `fresh: true` starts a new game as a play copy
// of the author's original. Any other save refuses the flag.
// Runs against built dist: `pnpm --filter @airp/server build`.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { test } from 'node:test';
import { createWorldRouter } from '../dist/routes/world.js';

async function save(repo, id, manifest) {
  const dir = path.join(repo, 'worlds', id);
  await fs.mkdir(path.join(dir, 'world'), { recursive: true });
  await fs.writeFile(path.join(dir, 'world', 'README.md'), '---\ntype: readme\nname: Root\n---\n');
  await fs.writeFile(path.join(dir, 'world.json'), JSON.stringify({ name: 'W', description: '', author: 'local', genre: 'test', characters: [], createdAt: 'x', updatedAt: 'x', ...manifest }));
  await fs.mkdir(path.join(dir, '.airpworld'), { recursive: true });
  await fs.writeFile(path.join(dir, '.airpworld', 'intro.json'), '{"shown":true}');
  return dir;
}

async function harness() {
  delete process.env.AIRP_USER_ID;
  delete process.env.AIRP_WORLDS_ROOT;
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-load-fresh-'));
  await save(repo, 'made-1234abcd', { id: 'made-1234abcd', workshop: { status: 'draft', owner: 'local', createdAt: 'x' } });
  await save(repo, 'made-1234abcd-9f9f9f9f', { id: 'made-1234abcd', workshop: { status: 'draft', owner: 'local', createdAt: 'x' } });
  await save(repo, 'plain', { id: 'plain' });
  let active = null;
  const lifecycle = { isModelSwitching: () => false, beginWorldTransition() {}, completeWorldTransition() {}, stopCharacters: async () => {}, stopAll: async () => {}, startWriter: async () => {} };
  const bridge = { close() {}, startTailReader() {}, watchWorld() {}, broadcast() {} };
  const app = express();
  app.use(express.json());
  app.use('/api', createWorldRouter(repo, lifecycle, bridge, () => active, (store) => { active = store; }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  return {
    repo,
    active: async () => (await fetch(`${base}/worlds/active`)).json(),
    load: async (body) => {
      const r = await fetch(`${base}/worlds/load`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      return { status: r.status, body: await r.json() };
    },
    close: async () => { active?.close(); await new Promise((r) => server.close(r)); await fs.rm(repo, { recursive: true, force: true }); },
  };
}

test('fresh on the author\'s draft starts a play copy and leaves the draft alone', async () => {
  const h = await harness();
  try {
    const r = await h.load({ worldPath: 'worlds/made-1234abcd', fresh: true });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.match(path.basename(r.body.path), /^made-1234abcd-[0-9a-f]{8}$/);
    assert.notEqual(path.basename(r.body.path), 'made-1234abcd-9f9f9f9f');
    // Runtime state never travels with the copy.
    await assert.rejects(fs.access(path.join(r.body.path, '.airpworld', 'intro.json')));
    await fs.access(path.join(h.repo, 'worlds', 'made-1234abcd', '.airpworld', 'intro.json'));
  } finally { await h.close(); }
});

test('fresh is refused on a play copy and on a plain save; without it they load in place', async () => {
  const h = await harness();
  try {
    assert.equal((await h.load({ worldPath: 'worlds/made-1234abcd-9f9f9f9f', fresh: true })).status, 400);
    assert.equal((await h.load({ worldPath: 'worlds/plain', fresh: true })).status, 400);
    const inPlace = await h.load({ worldPath: 'worlds/plain', fresh: false });
    assert.equal(inPlace.status, 200);
    assert.equal(inPlace.body.path, path.join(h.repo, 'worlds', 'plain'));
  } finally { await h.close(); }
});

test('the open save: none before a load, then exactly the path the load answered (the launcher\'s 「继续这个故事」)', async () => {
  const h = await harness();
  try {
    assert.deepEqual(await h.active(), { ok: true, path: null });
    const r = await h.load({ worldPath: 'worlds/plain' });
    assert.equal(r.status, 200);
    assert.deepEqual(await h.active(), { ok: true, path: r.body.path });
  } finally { await h.close(); }
});
