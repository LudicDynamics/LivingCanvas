// Opening a world's card prefetches its files into the blob cache (worlds.ts `prefetch`); an open takes
// over; one blob is downloaded once even when an open and a prefetch both want it (catalog.ts getBlob).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const r = await esbuild.build({
  stdin: { contents: `export * from './src/worlds.ts'; export * from './src/catalog.ts';`, resolveDir: path.join(HERE, '..'), loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'error',
  banner: { js: "import { createRequire as __req } from 'node:module'; const require = __req(import.meta.url);" },
});
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'airp-prefetch-'));
fs.writeFileSync(path.join(dir, 'w.mjs'), r.outputFiles[0].text);
const m = await import(pathToFileURL(path.join(dir, 'w.mjs')).href);
fs.rmSync(dir, { recursive: true, force: true });

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const file = (p, body) => ({ path: p, size: Buffer.byteLength(body), sha256: sha(body), url: `https://blob.example/${sha(body)}`, body });

function fakeCatalog(worlds) {
  const cached = new Set();
  const calls = [];
  let release = null; // when set, getBlob waits for it (a slow network)
  return {
    calls, cached,
    hold() { let go; const p = new Promise((r) => { go = r; }); release = p; return go; },
    listWorlds: async () => worlds.map((w) => w.entry),
    getWorld: async (id) => {
      const w = worlds.find((x) => x.entry.id === id);
      if (w.signedOut) throw new Error('catalog: 401 download-url');
      return { id, revision: 1, hash: w.entry.hash, files: w.files };
    },
    hasBlob: (s) => cached.has(s),
    getBlob: async (f) => { calls.push(f.path); if (release) await release; cached.add(f.sha256); return new TextEncoder().encode(f.body); },
    readCachedBlob: async () => null,
  };
}
const entry = (id) => ({ id, source: 'template', world: { id, name: id }, cover: null, coverVideo: null, hash: `h-${id}`, revision: 1 });

test('a card open downloads the world into the blob cache only (not the VFS); files already cached are skipped', async () => {
  const files = [file('world.json', '{"id":"a"}'), file('assets/a.webp', 'AAAA'), file('assets/b.webm', 'BBBB')];
  const cat = fakeCatalog([{ entry: entry('a'), files }]);
  cat.cached.add(files[1].sha256);
  const lib = new m.WorldLibrary(cat, '/repo-prefetch-1', () => {}, async () => null);
  await lib.init();
  await lib.prefetch('templates/a');
  assert.deepEqual(cat.calls.sort(), ['assets/b.webm', 'world.json']);
  assert.equal(lib.stats.prefetched[0].fetched, 2);
  assert.equal(lib.stats.prefetched[0].stopped, undefined);
});

test('signed out (storage 401), an unknown world, or a load path that is not a catalog world: nothing happens', async () => {
  const cat = fakeCatalog([{ entry: entry('b'), files: [file('world.json', '{}')], signedOut: true }]);
  const lib = new m.WorldLibrary(cat, '/repo-prefetch-2', () => {}, async () => null);
  await lib.init();
  await lib.prefetch('templates/b');
  await lib.prefetch('templates/zzz');
  await lib.prefetch('worlds/my-save-1234');
  assert.deepEqual(cat.calls, []);
  assert.deepEqual(m.WorldLibrary.keyOfPath('published/made-1'), 'published/made-1');
  assert.equal(m.WorldLibrary.keyOfPath('../templates/x'), null);
});

test('opening another world stops a running prefetch at its next file', async () => {
  const many = Array.from({ length: 12 }, (_, i) => file(`assets/${i}.webp`, `x${i}`));
  const cat = fakeCatalog([{ entry: entry('c'), files: many }, { entry: entry('d'), files: [file('world.json', '{"id":"d"}')] }]);
  const lib = new m.WorldLibrary(cat, '/repo-prefetch-3', () => {}, async () => null);
  await lib.init();
  const go = cat.hold();
  const pre = lib.prefetch('templates/c');
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(cat.calls.length, 4, 'four lanes');
  const open = lib.ensure('templates/d');
  go();
  await Promise.all([pre, open]);
  assert.equal(lib.stats.prefetched[0].stopped, true);
  assert.ok(cat.calls.filter((p) => p.startsWith('assets/')).length < 12, 'the rest of c was never asked for');
});

test('catalog: the same blob asked for twice at once is downloaded once', async () => {
  const body = 'shared-bytes';
  const f = { path: 'assets/x.webp', size: body.length, sha256: sha(body), url: 'https://blob.example/x' };
  const store = new Map();
  globalThis.caches = { open: async () => ({ match: async (k) => store.get(k)?.clone(), put: async (k, v) => { store.set(k, v); }, keys: async () => [] }) };
  let fetches = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { fetches++; await new Promise((r) => setTimeout(r, 20)); return new Response(body, { status: 200 }); };
  try {
    const cat = m.createCatalog({ kind: 'host', base: 'https://host.example/catalog' });
    const [a, b] = await Promise.all([cat.getBlob(f), cat.getBlob(f)]);
    assert.equal(fetches, 1);
    assert.equal(new TextDecoder().decode(a), body);
    assert.equal(new TextDecoder().decode(b), body);
    await cat.getBlob(f);
    assert.equal(fetches, 1, 'then from the cache');
  } finally {
    globalThis.fetch = realFetch;
    delete globalThis.caches;
  }
});
