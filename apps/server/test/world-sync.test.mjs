// 本机 / 云端 against the REAL identity +
// storage services (same harness as remote-services.test.mjs; skipped without the
// sibling checkouts). Two "devices" = two local world roots signed in to one account.
//
// Pinned:
//   - a world created as 云端 is uploaded by the sync pass; a 本机 one never is, until 「上传到云端」;
//   - the shelf says 官方 / 云端 / 本机 and 「本机 · 未同步」 (pending) per group and per save;
//   - a cloud world this device lacks comes down; a newer cloud revision comes down when this copy is clean;
//   - both changed → conflict (nothing uploaded, nothing overwritten); 「两份都保留」 keeps both, in the cloud too.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';
import express from 'express';

import { createRemoteRouter } from '../dist/routes/remote.js';
import { readWorldShelf } from '../dist/world-shelf.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** The sibling checkout: next to the repository (or next to the main checkout, from a worktree). */
async function findSibling(name) {
  if (process.env.WORLDLINES_STORAGE_DIR) return path.resolve(process.env.WORLDLINES_STORAGE_DIR);
  for (let dir = path.join(HERE, '../../..'); dir !== path.dirname(dir); dir = path.dirname(dir)) {
    const candidate = path.join(path.dirname(dir), name);
    if (await fs.access(path.join(candidate, 'test', 'helpers.mjs')).then(() => true, () => false)) return candidate;
  }
  return path.join(HERE, '../../../..', name);
}
const STORAGE_DIR = await findSibling('worldlines-storage');
const HAS = await fs.access(path.join(STORAGE_DIR, 'test', 'helpers.mjs')).then(() => true, () => false);
if (HAS && !process.env.WORLDLINES_IDENTITY_DIR) process.env.WORLDLINES_IDENTITY_DIR = path.join(path.dirname(STORAGE_DIR), 'worldlines-identity');
const helpers = HAS ? await import(pathToFileURL(path.join(STORAGE_DIR, 'test', 'helpers.mjs')).href) : null;
const skip = !HAS ? `worldlines-storage not found at ${STORAGE_DIR}` : helpers.skip;
// per-plan quotas + quota.warnings (platform storage 2026-10-03; the old standalone worldlines-storage has neither)
const skipPlanQuotas = skip || (await import(pathToFileURL(path.join(STORAGE_DIR, 'src', 'config.mjs')).href).then((m) => (typeof m.parsePlanQuotas === 'function' ? false : `storage at ${STORAGE_DIR} predates per-plan quotas (set WORLDLINES_STORAGE_DIR to the platform's services/storage)`)));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

async function tmp(t, label) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `airp-svc-${label}-`));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}
async function write(root, rel, data) {
  await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
  await fs.writeFile(path.join(root, rel), data);
}
async function madeWorld(dir, { id = 'made-0000abcd', name = 'Fog Harbour' } = {}) {
  await write(dir, 'world.json', JSON.stringify({
    id, name, description: 'A town that forgets its ships.', author: 'local', genre: 'Workshop', locale: 'zh-CN', cover: 'assets/cover.png',
    workshop: { status: 'draft', owner: 'local', createdAt: '2026-09-28T00:00:00.000Z' },
    createdAt: '2026-09-28T00:00:00.000Z', updatedAt: '2026-09-28T00:00:00.000Z',
  }, null, 2));
  await write(dir, 'world/README.md', '---\ntype: readme\nname: Root\n---\n\nThe hall.\n');
  await write(dir, 'world/「灯塔」・备忘.md', '---\ntype: note\nname: 灯塔\n---\n\n光。\n');
  await write(dir, 'assets/cover.png', PNG);
  await write(dir, '.airpworld/assets/gen/pic.png', PNG);
  await write(dir, '.airpworld/history.jsonl', '{"turn":1}\n');
  await write(dir, '.pi/sessions/s.jsonl', 'secret play\n');
  await write(dir, 'tools/run.exe', 'MZ');
}

const ENV = ['AIRP_WORLDS_ROOT', 'AIRP_PUBLISHED_ROOT', 'AIRP_REMOTE_CONFIG', 'AIRP_REMOTE_URL', 'AIRP_ID_BASE', 'AIRP_STORAGE_BASE', 'AIRP_AUTH_URL', 'AIRP_AUTH_PROVIDER', 'AIRP_USER_ID'];

/** Both services + a local AIRP server whose remote is them. `signIn(user)` writes the session the app holds. */
async function stack(t, { storageEnv = {}, identityEnv = {} } = {}) {
  const env = await helpers.startBoth({ identityEnv: { ID_PAT_SCOPES: 'api:use,resources:read,resources:write,storage:read,storage:write', ...identityEnv }, storageEnv: { STORAGE_QUOTAS: 'off', STORAGE_PUBLIC_CATALOG_TTL_SEC: '5', ...storageEnv } });
  t.after(() => env.close());
  const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  for (const k of ENV) delete process.env[k];
  t.after(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
  const localRepo = await tmp(t, 'near');
  const secrets = await tmp(t, 'home');
  process.env.AIRP_WORLDS_ROOT = path.join(localRepo, 'worlds');
  process.env.AIRP_PUBLISHED_ROOT = path.join(localRepo, 'worlds', 'published');
  process.env.AIRP_REMOTE_CONFIG = path.join(secrets, 'remote.json');
  process.env.AIRP_ID_BASE = env.id.base;
  process.env.AIRP_STORAGE_BASE = env.st.base;
  const app = express();
  app.use(express.json());
  app.use('/api', createRemoteRouter(localRepo));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const seen = [];
  const page = async (rel, body) => {
    const res = await fetch(`${base}${rel}`, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json', 'x-airp-settings': '1' }, body: JSON.stringify(body) });
    const text = await res.text();
    seen.push(text);
    return { status: res.status, body: text.startsWith('{') ? JSON.parse(text) : text, headers: res.headers };
  };
  const signIn = async (user) => {
    await fs.writeFile(process.env.AIRP_REMOTE_CONFIG, JSON.stringify({
      auth: { provider: 'worldlines', issuer: env.id.base },
      session: { accessToken: user.token, refreshToken: user.refresh, expiresAt: Date.now() + 10 * 60_000, uid: user.id, email: null },
    }));
  };
  return { env, localRepo, base, page, seen, signIn };
}


const pathOf = (root, id) => path.join(root, id);
const readJson = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));
/** Touch a file as edited "later" (the sync stamp has a 2 s slack). */
let bump = 0;
async function edit(dir, rel, text) {
  await write(dir, rel, text);
  const later = new Date(Date.now() + 10_000 * ++bump);
  await fs.utimes(path.join(dir, rel), later, later);
}

test('local vs cloud: creation choice, badges, sync on demand, upload, pull, conflict keep-both', { skip }, async (t) => {
  const s = await stack(t);
  const alice = await s.env.newUser();
  const rootA = path.join(s.localRepo, 'worlds');
  const rootB = path.join(s.localRepo, 'device-b');
  await fs.mkdir(rootB, { recursive: true });
  const onA = () => { process.env.AIRP_WORLDS_ROOT = rootA; };
  const onB = () => { process.env.AIRP_WORLDS_ROOT = rootB; };

  // Device A: one world kept in the cloud, one kept here.
  onA();
  await madeWorld(pathOf(rootA, 'made-0000c10d'), { id: 'made-0000c10d', name: 'Cloud Harbour' });
  await madeWorld(pathOf(rootA, 'made-000010ca'), { id: 'made-000010ca', name: 'Home Harbour' });
  const cloudJson = path.join(rootA, 'made-0000c10d', 'world.json');
  await fs.writeFile(cloudJson, JSON.stringify({ ...(await readJson(cloudJson)), location: 'cloud' }));

  // Signed out: nothing moves; the cloud world is 「本机 · 未同步」.
  const signedOut = (await s.page('/api/remote/sync', {})).body;
  assert.equal(signedOut.signedIn, false);
  let shelf = await readWorldShelf(s.localRepo);
  const group = (id) => shelf.groups.find((g) => g.id === id);
  assert.deepEqual(group('made-0000c10d').place, { kind: 'cloud', pending: true, conflict: false });
  assert.deepEqual(group('made-000010ca').place, { kind: 'local', pending: false, conflict: false });
  assert.deepEqual(group('made-000010ca').saves[0].place, { location: 'local', pending: false, conflict: false });

  await s.signIn(alice);
  let status = (await s.page('/api/remote/sync', {})).body;
  assert.equal(status.signedIn, true);
  assert.deepEqual(status.worlds.map((w) => [w.id, w.state]), [['made-0000c10d', 'pushed']], 'only the 云端 world goes up');
  shelf = await readWorldShelf(s.localRepo);
  assert.deepEqual(group('made-0000c10d').place, { kind: 'cloud', pending: false, conflict: false });
  const pair = (await readJson(cloudJson)).remote;
  assert.equal(pair.revision, 1);
  assert.equal(typeof pair.stamp, 'number');
  // Nothing changed → the next pass uploads nothing.
  status = (await s.page('/api/remote/sync', {})).body;
  assert.deepEqual(status.worlds.map((w) => w.state), ['synced']);
  // An edit → 本机 · 未同步 → the pass uploads revision 2.
  await edit(pathOf(rootA, 'made-0000c10d'), 'world/README.md', '---\ntype: readme\nname: Root\n---\n\nThe hall, repainted.\n');
  shelf = await readWorldShelf(s.localRepo);
  assert.equal(group('made-0000c10d').place.pending, true);
  status = (await s.page('/api/remote/sync', {})).body;
  assert.deepEqual(status.worlds.map((w) => w.state), ['pushed']);
  assert.equal((await readJson(cloudJson)).remote.revision, 2);

  // 「上传到云端」 for the local world.
  status = (await s.page('/api/remote/sync/cloud', { worldPath: 'worlds/made-000010ca' })).body;
  assert.deepEqual(status.worlds.find((w) => w.id === 'made-000010ca')?.state, 'pushed');
  assert.equal((await readJson(path.join(rootA, 'made-000010ca', 'world.json'))).location, 'cloud');

  // Device B (same account): both cloud worlds come down as 云端, clean.
  onB();
  status = (await s.page('/api/remote/sync', {})).body;
  assert.deepEqual(status.worlds.map((w) => w.state).sort(), ['pulled', 'pulled']);
  const bJson = path.join(rootB, 'made-0000c10d', 'world.json');
  assert.equal((await readJson(bJson)).location, 'cloud');
  assert.match(await fs.readFile(path.join(rootB, 'made-0000c10d', 'world/README.md'), 'utf8'), /repainted/);
  shelf = await readWorldShelf(s.localRepo);
  assert.deepEqual(group('made-0000c10d').place, { kind: 'cloud', pending: false, conflict: false });
  // B edits and syncs (revision 3).
  await edit(pathOf(rootB, 'made-0000c10d'), 'world/README.md', '---\ntype: readme\nname: Root\n---\n\nB was here.\n');
  status = (await s.page('/api/remote/sync', {})).body;
  assert.equal(status.worlds.find((w) => w.id === 'made-0000c10d').state, 'pushed');

  // Device A, unchanged since revision 2 → the newer cloud revision comes down.
  onA();
  status = (await s.page('/api/remote/sync', {})).body;
  assert.equal(status.worlds.find((w) => w.id === 'made-0000c10d').state, 'pulled');
  assert.match(await fs.readFile(path.join(rootA, 'made-0000c10d', 'world/README.md'), 'utf8'), /B was here/);

  // Both change: B uploads first, A meets a conflict.
  onB();
  await edit(pathOf(rootB, 'made-0000c10d'), 'world/README.md', '---\ntype: readme\nname: Root\n---\n\nB again.\n');
  await s.page('/api/remote/sync', {});
  onA();
  await edit(pathOf(rootA, 'made-0000c10d'), 'world/README.md', '---\ntype: readme\nname: Root\n---\n\nA meanwhile.\n');
  status = (await s.page('/api/remote/sync', {})).body;
  assert.equal(status.worlds.find((w) => w.id === 'made-0000c10d').state, 'conflict');
  assert.match(await fs.readFile(path.join(rootA, 'made-0000c10d', 'world/README.md'), 'utf8'), /A meanwhile/, 'nothing overwritten');
  shelf = await readWorldShelf(s.localRepo);
  assert.deepEqual(group('made-0000c10d').place, { kind: 'cloud', pending: true, conflict: true });
  // Still a conflict on the next pass (no upload over the other device's work).
  status = (await s.page('/api/remote/sync', {})).body;
  assert.equal(status.worlds.find((w) => w.id === 'made-0000c10d').state, 'conflict');

  // 「两份都保留」: the cloud version comes down as a second 云端 world; A's version goes up as the next revision.
  const kept = await s.page('/api/remote/sync/keep-both', { worldPath: 'worlds/made-0000c10d' });
  assert.equal(kept.status, 200, JSON.stringify(kept.body));
  const copyDir = path.join(s.localRepo, kept.body.copyPath);
  const copy = await readJson(path.join(copyDir, 'world.json'));
  assert.match(copy.name, /（云端版本）$/);
  assert.equal(copy.location, 'cloud');
  assert.match(await fs.readFile(path.join(copyDir, 'world/README.md'), 'utf8'), /B again/);
  assert.match(await fs.readFile(path.join(rootA, 'made-0000c10d', 'world/README.md'), 'utf8'), /A meanwhile/);
  assert.equal(kept.body.worlds.find((w) => w.id === 'made-0000c10d').state, 'pushed');
  assert.equal(kept.body.worlds.find((w) => w.path === kept.body.copyPath).state, 'pushed', 'the kept copy is its own cloud world');
  shelf = await readWorldShelf(s.localRepo);
  assert.deepEqual(group('made-0000c10d').place, { kind: 'cloud', pending: false, conflict: false });
  const mine = (await s.page('/api/remote/worlds')).body.drafts.map((w) => w.id).sort();
  assert.equal(mine.length, 3, 'both versions are in the account');

  // A local copy moved to the trash is not brought back by the next pass.
  onB();
  await fs.mkdir(path.join(rootB, '.trash'), { recursive: true });
  await fs.rename(path.join(rootB, 'made-000010ca'), path.join(rootB, '.trash', 'made-000010ca-x'));
  status = (await s.page('/api/remote/sync', {})).body;
  assert.ok(!status.worlds.some((w) => w.id === 'made-000010ca'));
  await assert.rejects(fs.access(path.join(rootB, 'made-000010ca')));

  for (const text of s.seen) assert.ok(!text.includes(alice.token) && !text.includes(alice.refresh), 'no token reaches the page');
});

test('create: location is validated and written; a 云端 world is never part of its bundle', async () => {
  const { parseCreateWorldInput } = await import('../dist/world-workshop.js');
  const { stripPairing } = await import('../dist/sync/bundle.js');
  const base = { name: 'X', description: 'Y', locale: 'en', cover: { kind: 'upload', mimeType: 'image/png', dataB64: PNG.toString('base64') } };
  assert.equal(parseCreateWorldInput({ ...base, location: 'cloud' }).location, 'cloud');
  assert.equal(parseCreateWorldInput(base).location, undefined);
  assert.throws(() => parseCreateWorldInput({ ...base, location: 'moon' }), /location/);
  assert.deepEqual(stripPairing({ id: 'a', location: 'cloud', remote: {}, sync: {} }), { id: 'a' });
});

test('an official edition its owner downloaded to edit stays 官方 and is never auto-synced (feat/world-owner)', { skip }, async (t) => {
  const s = await stack(t);
  const owner = await s.env.newUser();
  const root = path.join(s.localRepo, 'worlds');
  process.env.AIRP_WORLDS_ROOT = root;
  const dir = path.join(root, 'whitechapel-zh');
  await madeWorld(dir, { id: 'whitechapel-zh', name: '白教堂' });
  const file = path.join(dir, 'world.json');
  const m = await readJson(file);
  // What 下载下来编辑 writes: workshop.official, a tenant pair — and even an explicit cloud location must not make it sync.
  await fs.writeFile(file, JSON.stringify({ ...m, location: 'cloud', workshop: { status: 'published', owner: 'local', createdAt: m.createdAt, official: true }, remote: { url: `${s.env.st.base}/`, id: 'whitechapel-zh', revision: 1, from: 'tenant' } }));
  await edit(dir, 'world/README.md', '---\ntype: readme\nname: Root\n---\n\nEdited by the owner.\n');
  const shelf = await readWorldShelf(s.localRepo);
  const group = shelf.groups.find((g) => g.id === 'whitechapel-zh');
  assert.deepEqual(group.place, { kind: 'official', pending: false, conflict: false });
  assert.deepEqual(group.saves[0].place, { location: 'official', pending: false, conflict: false });

  await s.signIn(owner);
  const status = (await s.page('/api/remote/sync', {})).body;
  assert.ok(!status.worlds.some((w) => w.id === 'whitechapel-zh'), 'not uploaded by the pass: only 「重新发布」 sends it');
  const uploaded = await s.env.st.json('GET', '/v1/objects/livingcanvas/world/whitechapel-zh/download-url', { token: owner.token });
  assert.notEqual(uploaded.status, 200, 'nothing reached storage');
  assert.equal((await s.page('/api/remote/sync/cloud', { worldPath: 'worlds/whitechapel-zh' })).status, 400, '「上传到云端」 refuses an official edition');
});
