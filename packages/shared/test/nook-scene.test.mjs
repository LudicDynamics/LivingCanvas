/**
 * Nook sub-scenes — the shared derivation layer.
 *
 * The fixtures are HAND-BUILT, not read off `templates/fpal`: that directory was
 * rewritten three times in one afternoon (N2 00 §1 / RB6), so any assertion
 * pinned to its shape would drift. The tree here is a frozen world we construct.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  deriveNookLayers,
  dirOf,
  isNookSceneId,
  isValidNookScenePath,
  isValidNookSegment,
  LocalWorldStore,
  nookSceneCards,
  nookSceneDoors,
  nookSceneOfPath,
  nookSceneParent,
  nookScenePathOf,
} from '../dist/index.js';

// ------------------------------------------------------------- scene-id shape

test('isValidNookSegment: same kebab-case rule as a character id', () => {
  for (const seg of ['office', 'a1', 'parallel-timeline']) {
    assert.equal(isValidNookSegment(seg), true, `${seg} should be a valid segment`);
  }
  for (const seg of ['', '.pi', '..', 'Office', 'a_b', 'a b']) {
    assert.equal(isValidNookSegment(seg), false, `${seg} should be invalid`);
  }
});

test('isValidNookScenePath: ""/null/undefined are the legal root; trailing slash is not', () => {
  assert.equal(isValidNookScenePath(''), true);
  assert.equal(isValidNookScenePath(null), true);
  assert.equal(isValidNookScenePath(undefined), true);
  assert.equal(isValidNookScenePath('office'), true);
  assert.equal(isValidNookScenePath('a/b/c'), true);
  // No normalise: a leading slash, a doubled slash and a trailing slash are
  // three different strings and all three are illegal.
  for (const bad of ['a//b', 'office/', '/office', '//office', '../x', 'a/./b', 'Office']) {
    assert.equal(isValidNookScenePath(bad), false, `${bad} should be invalid`);
  }
});

test('isNookSceneId: characters/<id>[/<seg>]*, no trailing slash', () => {
  for (const good of ['characters/elias', 'characters/elias/office', 'characters/elias/a/b/c']) {
    assert.equal(isNookSceneId(good), true, `${good} should be valid`);
  }
  for (const bad of [
    '',
    'characters',
    'characters/elias/',
    'characters/Bad',
    'characters/elias/Office',
    'world/inn',
    'characters/elias/.pi',
  ]) {
    assert.equal(isNookSceneId(bad), false, `${bad} should be invalid`);
  }
});

test('nookSceneParent: root has no parent, illegal input has no parent', () => {
  assert.equal(nookSceneParent('characters/elias'), null);
  assert.equal(nookSceneParent('characters/elias/office'), 'characters/elias');
  assert.equal(nookSceneParent('characters/elias/a/b'), 'characters/elias/a');
  assert.equal(nookSceneParent('characters/ryo'), null);
  assert.equal(nookSceneParent('x'), null);
});

test('nookScenePathOf: "" is the legal root, null is out of bounds', () => {
  assert.equal(nookScenePathOf('characters/elias/office', 'characters/elias'), 'office');
  // The two must not be merged (N2 00 §5.1 C1): '' is legal, null is a miss.
  assert.equal(nookScenePathOf('characters/elias', 'characters/elias'), '');
  assert.equal(nookScenePathOf('characters/elias/a/b', 'characters/elias'), 'a/b');
  assert.equal(nookScenePathOf('characters/ryo/office', 'characters/elias'), null);
  assert.equal(nookScenePathOf('x', 'characters/elias'), null);
  assert.equal(nookScenePathOf('world/inn', 'characters/elias'), null);
  assert.equal(nookScenePathOf('characters/Bad/x', 'characters/elias'), null);
});

// -------------------------------------------------------------- scene tree

// Frozen, hand-built world. `empty-room` is COMPLETELY empty (no files at all),
// `ryo`/`world` are out of subtree and must be filtered out.
const DIRS = [
  'characters/elias',
  'characters/elias/balcony',
  'characters/elias/living-room',
  'characters/elias/office',
  'characters/elias/parallel-timeline',
  'characters/elias/writing',
  'characters/elias/empty-room',
  'characters/ryo',
  'characters/ryo/other',
  'world/inn',
];

const readFm = (d) => (d === 'characters/elias/office' ? { name: '办公室 · 工作日' } : null);

test('deriveNookLayers: keeps only the nookId subtree, empty dirs included', () => {
  const tree = deriveNookLayers('characters/elias', DIRS, readFm);
  assert.deepEqual(Object.keys(tree).sort(), [
    'characters/elias',
    'characters/elias/balcony',
    'characters/elias/empty-room',
    'characters/elias/living-room',
    'characters/elias/office',
    'characters/elias/parallel-timeline',
    'characters/elias/writing',
  ]);
  for (const k of Object.keys(tree)) {
    assert.ok(k === 'characters/elias' || k.startsWith('characters/elias/'), `${k} is out of subtree`);
  }
});

test('deriveNookLayers: parent chain, root is parentless', () => {
  const tree = deriveNookLayers('characters/elias', DIRS, readFm);
  assert.equal(tree['characters/elias'].parent, null);
  assert.equal(tree['characters/elias/office'].parent, 'characters/elias');
  for (const [k, v] of Object.entries(tree)) {
    if (v.parent === null) continue;
    assert.ok(k.startsWith(`${v.parent}/`), `${k} parent ${v.parent} must be a shorter scene id`);
    assert.ok(Object.hasOwn(tree, v.parent), `${v.parent} must exist in the tree`);
  }
});

test('deriveNookLayers: arbitrary depth resolves to the immediate parent', () => {
  const tree = deriveNookLayers(
    'characters/elias',
    [...DIRS, 'characters/elias/a', 'characters/elias/a/b', 'characters/elias/a/b/c'],
    readFm
  );
  assert.equal(tree['characters/elias/a/b/c'].parent, 'characters/elias/a/b');
});

test('deriveNookLayers: name from README frontmatter, stub without one', () => {
  const tree = deriveNookLayers('characters/elias', DIRS, readFm);
  assert.equal(tree['characters/elias/office'].name, '办公室 · 工作日');
  assert.equal(tree['characters/elias/writing'].stub, true);
});

test('deriveNookLayers: empty dirs and unknown nookId give an empty tree', () => {
  assert.deepEqual(deriveNookLayers('characters/elias', [], () => null), {});
  assert.deepEqual(deriveNookLayers('characters/ghost', DIRS, () => null), {});
});

// ------------------------------------------------------------------- doors

test('nookSceneDoors: DIRECT children only — empty dirs still get a door', () => {
  // `empty-room` has no files at all. A door for it can only come from a
  // DIRECTORY walk (`listDirs`); deriving the set from `listFiles` would drop
  // it, which is exactly the defect this proves absent (N2 00 §2.3).
  const tree = deriveNookLayers('characters/elias', DIRS, readFm);
  assert.deepEqual(nookSceneDoors('characters/elias', tree), [
    'characters/elias/balcony',
    'characters/elias/empty-room',
    'characters/elias/living-room',
    'characters/elias/office',
    'characters/elias/parallel-timeline',
    'characters/elias/writing',
  ]);
});

test('nookSceneDoors: leaf scene has none; grandchildren do not leak up', () => {
  const tree = deriveNookLayers(
    'characters/elias',
    [...DIRS, 'characters/elias/a', 'characters/elias/a/b', 'characters/elias/a/b/c'],
    readFm
  );
  assert.deepEqual(nookSceneDoors('characters/elias/office', tree), []);
  // `a/b` and `a/b/c` are NOT doors of the root: nesting never flattens.
  assert.deepEqual(nookSceneDoors('characters/elias/a', tree), ['characters/elias/a/b']);
  assert.deepEqual(nookSceneDoors('characters/elias', tree).includes('characters/elias/a/b'), false);
});

// ----------------------------------------------------------------- ownership

test('nookSceneOfPath: longest prefix inside the subtree', () => {
  const tree = deriveNookLayers('characters/elias', DIRS, readFm);
  assert.equal(nookSceneOfPath('characters/elias/office/desk.md', tree), 'characters/elias/office');
  assert.equal(nookSceneOfPath('characters/elias/unspoken.md', tree), 'characters/elias');
  assert.equal(nookSceneOfPath('characters/elias/office', tree), 'characters/elias/office');
});

test('nookSceneOfPath: out of subtree is null, never the "map" fallback', () => {
  // The guard in `arrangeCards` is `nookSceneOfPath(p, tree) === layer`; if a
  // stray path returned 'map' the guard would pass a write it exists to block
  // (N2 00 §5.3.1). These three are the mechanical check of that.
  const tree = deriveNookLayers('characters/elias', DIRS, readFm);
  for (const p of ['characters/ryo/other.md', 'world/inn/a.md', 'player/bag/item.md', '']) {
    assert.equal(nookSceneOfPath(p, tree), null, `${p} must not belong to this tree`);
  }
  assert.equal(nookSceneOfPath('characters/elias/unspoken.md', {}), null);
});

test('nookSceneOfPath: result is null or a tree key — never anything else', () => {
  const tree = deriveNookLayers('characters/elias', DIRS, readFm);
  for (const p of [
    'characters/elias/office/desk.md',
    'characters/elias/unspoken.md',
    'characters/ryo/other.md',
    'map',
  ]) {
    const r = nookSceneOfPath(p, tree);
    assert.ok(r === null || Object.hasOwn(tree, r), `${p} → ${r} is neither null nor a tree key`);
  }
});

// -------------------------------------------------------------------- cards

const FILES = [
  'characters/elias/README.md',
  'characters/elias/identity.md',
  'characters/elias/personality.md',
  'characters/elias/memory.md',
  'characters/elias/preset.json',
  'characters/elias/unspoken.md',
  'characters/elias/office/README.md',
  'characters/elias/office/desk.md',
  'characters/elias/meta/agent_selfframework.md',
];

test('nookSceneCards: root drops the four config files and every sub-scene card', () => {
  assert.deepEqual(nookSceneCards('characters/elias', FILES), ['characters/elias/unspoken.md']);
});

test('nookSceneCards: sub-scene drops its own README, keeps its cards', () => {
  assert.deepEqual(nookSceneCards('characters/elias/office', FILES), ['characters/elias/office/desk.md']);
  assert.deepEqual(nookSceneCards('characters/elias/meta', FILES), [
    'characters/elias/meta/agent_selfframework.md',
  ]);
});

test('nookSceneCards: never yields the scene README, never reaches into children', () => {
  for (const sceneId of ['characters/elias', 'characters/elias/office']) {
    assert.equal(nookSceneCards(sceneId, FILES).includes(`${sceneId}/README.md`), false);
  }
  for (const p of nookSceneCards('characters/elias', FILES)) {
    assert.equal(dirOf(p), 'characters/elias');
  }
});

// ------------------------------------------------- fix-before-failure proof

test('listDirs(prefix): a DIRECTORY walk, so a fileless sub-scene survives', async () => {
  // The defect: doors derived from `listFiles` — a FILE walk — lose a
  // completely empty subdirectory, so its door card can never be built.
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-nook-scene-'));
  const store = new LocalWorldStore(root);
  try {
    await fs.mkdir(path.join(root, 'characters/ryo/empty-room'), { recursive: true });
    await fs.mkdir(path.join(root, 'characters/ryo/has-file'), { recursive: true });
    await fs.writeFile(path.join(root, 'characters/ryo/README.md'), '# Ryo\n');
    await fs.writeFile(path.join(root, 'characters/ryo/has-file/a.md'), 'a\n');
    await fs.mkdir(path.join(root, 'characters/ryo/node_modules/junk'), { recursive: true });
    await fs.mkdir(path.join(root, 'characters/ryo/.pi'), { recursive: true });

    const dirs = await store.listDirs('characters/ryo');
    assert.deepEqual(dirs, ['characters/ryo', 'characters/ryo/empty-room', 'characters/ryo/has-file']);

    const files = await store.listFiles('characters/ryo');
    assert.equal(files.some((f) => f.startsWith('characters/ryo/empty-room')), false);

    const tree = deriveNookLayers(
      'characters/ryo',
      dirs,
      (d) => (d === 'characters/ryo' ? { name: 'Ryo' } : null)
    );
    // The empty room is a door here while `listFiles` cannot see it at all.
    assert.deepEqual(nookSceneDoors('characters/ryo', tree), [
      'characters/ryo/empty-room',
      'characters/ryo/has-file',
    ]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('listDirs() with no argument still walks world/ — the layer tree is unchanged', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-nook-scene-'));
  const store = new LocalWorldStore(root);
  try {
    await fs.mkdir(path.join(root, 'world/inn'), { recursive: true });
    await fs.mkdir(path.join(root, 'world/totally-empty'), { recursive: true });
    await fs.mkdir(path.join(root, 'characters/ryo'), { recursive: true });
    assert.deepEqual(await store.listDirs(), ['world', 'world/inn', 'world/totally-empty']);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
