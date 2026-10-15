// The lobby cards in the browser build: the public catalog's
// stub world.json gets its `intro` / rules / cast from intros.json, portrait placeholders
// are written so the server names their URLs, and /api/worlds/intro-avatar is answered
// from /world-intros/ until the world is opened.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const r = await esbuild.build({
  stdin: { contents: `export * from './src/worlds.ts'; export { fs as vfs } from './src/platform/fs.ts';`, resolveDir: path.join(HERE, '..'), loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'error',
  // memfs is CommonJS: give the ESM bundle a `require`.
  banner: { js: "import { createRequire as __req } from 'node:module'; const require = __req(import.meta.url);" },
});
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'airp-intros-')), 'w.mjs');
fs.writeFileSync(tmp, r.outputFiles[0].text);
const m = await import(pathToFileURL(tmp).href);

const ENTRY = {
  intro: { status: 'playable', category: 'trpg', hook: 'A hook.', characters: [{ id: 'vera', line: 'Partner.' }, { name: 'Old Qin', avatar: 'assets/characters/qin.webp', line: 'Driver.' }] },
  rules: { system: 'coc' },
  characters: [{ id: 'vera', name: 'Vera', home: 'map', avatar: 'assets/characters/vera.webp' }],
  avatars: { 'assets/characters/vera.webp': 'aaaa.webp', 'assets/characters/qin.webp': 'bbbb.webp' },
};

test('withIntro merges the shipped card into the stub, never over what the catalog sent', () => {
  const stub = { id: 'wuwu', name: 'Fogwharf', description: 'd' };
  const merged = m.withIntro(stub, ENTRY);
  assert.equal(merged.intro.hook, 'A hook.');
  assert.equal(merged.rules.system, 'coc');
  assert.equal(merged.characters[0].id, 'vera');
  const full = { ...stub, intro: { hook: 'own' }, rules: { system: 'dnd' } };
  assert.equal(m.withIntro(full, ENTRY), full);
  assert.equal(m.withIntro(stub, undefined), stub);
  assert.deepEqual(m.introCastPaths(merged), ['assets/characters/vera.webp', 'assets/characters/qin.webp']);
});

test('stubs carry the card and portrait placeholders; portraits are served from /world-intros/ until the world opens', async () => {
  const world = { id: 'wuwu', source: 'template', world: { id: 'wuwu', name: 'Fogwharf', description: 'd' }, cover: { path: 'assets/scenes/intro.webp', size: 0, sha256: '' }, coverVideo: null, hash: 'h1', revision: 1 };
  const catalog = { listWorlds: async () => [world] };
  const lib = new m.WorldLibrary(catalog, '/repo-intros', () => {}, async () => ({ index: { worlds: { wuwu: ENTRY } }, avatarBase: 'https://site.example/world-intros/' }));
  await lib.init();
  const stub = JSON.parse(m.vfs.readFileSync('/repo-intros/templates/wuwu/world.json', 'utf8'));
  assert.equal(stub.intro.status, 'playable');
  assert.equal(stub.intro.category, 'trpg', 'the stub carries the lobby category');
  assert.equal(m.vfs.statSync('/repo-intros/templates/wuwu/assets/characters/vera.webp').size, 0);
  assert.equal(m.vfs.statSync('/repo-intros/templates/wuwu/assets/characters/qin.webp').size, 0);
  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => { seen.push(String(url)); return new Response(new Uint8Array([1, 2, 3]), { status: 200 }); };
  try {
    const a = await lib.intercept({ method: 'GET', url: '/api/worlds/intro-avatar?id=wuwu&n=1' });
    assert.equal(a.status, 200);
    assert.equal(a.headers['content-type'], 'image/webp');
    assert.deepEqual([...a.body], [1, 2, 3]);
    assert.deepEqual(seen, ['https://site.example/world-intros/bbbb.webp']);
    assert.equal((await lib.intercept({ method: 'GET', url: '/api/worlds/intro-avatar?id=wuwu&n=5' })).status, 404);
    assert.equal(await lib.intercept({ method: 'GET', url: '/api/worlds/intro-avatar?id=other&n=0' }), null);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('no intros.json (the dev host): stubs stay as the catalog sent them', async () => {
  const world = { id: 'solo', source: 'template', world: { id: 'solo', name: 'Solo', description: 'd' }, cover: null, coverVideo: null, hash: 'h', revision: 1 };
  const lib = new m.WorldLibrary({ listWorlds: async () => [world] }, '/repo-nointros', () => {}, async () => { throw new Error('404'); });
  await lib.init();
  assert.equal(JSON.parse(m.vfs.readFileSync('/repo-nointros/templates/solo/world.json', 'utf8')).intro, undefined);
});
