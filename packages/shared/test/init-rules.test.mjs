import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  characterIdOfPath,
  characterRootConfigOf,
  directChildrenOf,
  directChildDirsOf,
  dirOf,
  hasInitProduct,
  isLayerEmpty,
  isNookEmpty,
  isValidCharacterId,
  nookCardPaths,
  nookIdOf,
  w2SceneTemplate,
} from '../dist/index.js';

// --------------------------------------------------------------- character ids

test('isValidCharacterId accepts kebab-case, rejects the rest', () => {
  const good = ['watson', 'a', 'nanami', 'a1', '1a', 'sherlock-holmes'];
  const bad = ['', 'Watson', 'a_b', '-lead', 'a/b', 'a b', 'a..b', 'café', 'A'];
  for (const id of good) assert.equal(isValidCharacterId(id), true, `${id} should be valid`);
  for (const id of bad) assert.equal(isValidCharacterId(id), false, `${id} should be invalid`);
});

test('nookIdOf builds characters/<id> or null', () => {
  assert.equal(nookIdOf('watson'), 'characters/watson');
  assert.equal(nookIdOf('Bad'), null);
  assert.equal(nookIdOf('../../etc'), null);
});

test('characterIdOfPath extracts the id, refusing traversal', () => {
  assert.equal(characterIdOfPath('characters/watson'), 'watson');
  assert.equal(characterIdOfPath('characters/watson/README.md'), 'watson');
  assert.equal(characterIdOfPath('characters/watson/nested/deep.md'), 'watson');
  assert.equal(characterIdOfPath('world/baker-street/x.md'), null);
  assert.equal(characterIdOfPath('characters/'), null, 'empty id');
  assert.equal(characterIdOfPath('characters/a/../..'), 'a', 'id segment has no slash; the rest is irrelevant');
  assert.equal(characterIdOfPath('characters/Bad/x.md'), null, 'illegal id');
  assert.equal(characterIdOfPath('characters'), null, 'no trailing slash');
});

test('characterRootConfigOf only identifies root configuration files', () => {
  assert.equal(characterRootConfigOf('characters/watson/README.md'), 'README.md');
  assert.equal(characterRootConfigOf('characters/watson/identity.md'), 'identity.md');
  assert.equal(characterRootConfigOf('characters/watson/personality.md'), 'personality.md');
  assert.equal(characterRootConfigOf('characters/watson/memory.md'), 'memory.md');
  assert.equal(characterRootConfigOf('characters/watson/diary/memory.md'), null);
  assert.equal(characterRootConfigOf('world/watson/memory.md'), null);
});

// --------------------------------------------------------------- dirOf export

test('dirOf (now exported from layers) takes the directory part', () => {
  assert.equal(dirOf('a/b/c.md'), 'a/b');
  assert.equal(dirOf('a'), '');
  assert.equal(dirOf(''), '');
});

// ------------------------------------------------------------------ emptiness

test('isLayerEmpty: stub ⟺ no README.md among direct children (doc-11 §3.1)', () => {
  const dir = 'world/baker-street/crime-scene';
  assert.equal(isLayerEmpty([], dir), true, 'empty dir is a stub');
  assert.equal(isLayerEmpty([`${dir}/evening.md`], dir), true, 'content but no README is still a stub');
  assert.equal(isLayerEmpty([`${dir}/README.md`], dir), false);
  assert.equal(isLayerEmpty([`${dir}/readme.md`], dir), true, 'case-sensitive: lowercase is not README.md');
  assert.equal(
    isLayerEmpty([`${dir}/sub/README.md`], dir),
    true,
    'a README in a subdirectory does not count for the parent'
  );
  assert.equal(
    isLayerEmpty([`${dir}/README.md`, `world/baker-street/README.md`], dir),
    false,
    'sibling layers do not leak in'
  );
});

test('isNookEmpty: empty ⟺ only *.json AND no direct subdirectory (doc-11 §4.1, N2 00 §5.4)', () => {
  const dir = 'characters/watson';
  const only = [dir];
  assert.equal(isNookEmpty([], dir, only), true, 'nothing at all is empty');
  assert.equal(isNookEmpty([`${dir}/preset.json`], dir, only), true, 'preset.json is configuration, not content');
  assert.equal(
    isNookEmpty([`${dir}/preset.json`, `${dir}/other.json`], dir, only),
    true,
    'any *.json does not count'
  );
  assert.equal(isNookEmpty([`${dir}/preset.json`, `${dir}/README.md`], dir, only), false);
  assert.equal(isNookEmpty([`${dir}/letter.md`], dir, only), false);

  // N2 00 §5.4 — a subdirectory is a room with a door card on this canvas, so it
  // IS content. The old rule ("content in a subdirectory does not fill the nook")
  // made `nook-init` re-furnish an already-decorated nook.
  assert.equal(
    isNookEmpty([`${dir}/sub/letter.md`], dir, [dir, `${dir}/sub`]),
    false,
    'a subdirectory is content even when its files are not direct children'
  );
  assert.equal(
    isNookEmpty([`${dir}/preset.json`], dir, [dir, `${dir}/office`]),
    false,
    'only a subdirectory (all writing lives in rooms) still fills the nook'
  );
  // `dirs` is a DIRECTORY walk: a completely empty room shows up there while it is
  // invisible to `files` (N2 00 §2.3.1 spike B) — the door card and this predicate
  // must agree.
  assert.equal(
    isNookEmpty([`${dir}/preset.json`], dir, [dir, `${dir}/empty-room`]),
    false,
    'an EMPTY subdirectory is a door, hence content (contract §4.3)'
  );
});

test('directChildDirsOf: direct subdirectory names, dot-dirs and deeper paths excluded', () => {
  const dir = 'characters/ryo';
  const dirs = [
    dir,
    `${dir}/office`,
    `${dir}/office/inner`,
    `${dir}/empty-room`,
    `${dir}/.pi`,
    `${dir}/.pi/agent`,
    'characters/elias/office',
    'world/inn',
  ];
  assert.deepEqual(directChildDirsOf(dirs, dir), ['empty-room', 'office']);
  assert.deepEqual(directChildDirsOf(dirs, `${dir}/office`), ['inner']);
  assert.deepEqual(directChildDirsOf([], dir), []);
  assert.deepEqual(directChildDirsOf(dirs, 'nope'), []);
});

test('hasInitProduct: completed ≠ wrote something (doc-11 §3.3)', () => {
  const scene = 'world/baker-street/crime-scene';
  assert.equal(hasInitProduct([], scene, 'scene', [scene]), false);
  assert.equal(
    hasInitProduct([`${scene}/evening.md`], scene, 'scene', [scene]),
    false,
    'no README → scene failed'
  );
  assert.equal(hasInitProduct([`${scene}/README.md`], scene, 'scene', [scene]), true);
  assert.equal(
    hasInitProduct([`${scene}/README.md`], scene, 'scene', [scene, `${scene}/sub`]),
    true,
    'scene ignores dirs'
  );

  const nook = 'characters/watson';
  const only = [nook];
  assert.equal(hasInitProduct([`${nook}/preset.json`], nook, 'nook', only), false, 'only json → nook failed');
  assert.equal(hasInitProduct([`${nook}/preset.json`, `${nook}/letter.md`], nook, 'nook', only), true);
  // Same bug as `isNookEmpty`, other half: a written room is a product.
  assert.equal(
    hasInitProduct([`${nook}/preset.json`], nook, 'nook', [nook, `${nook}/office`]),
    true,
    'a created subdirectory counts as an initialisation product (N2 00 §5.4)'
  );
});

// -------------------------------------------------------------- W2 templates
test('w2SceneTemplate writes a stub README and an empty opening', () => {
  const files = w2SceneTemplate('crime-scene');
  assert.deepEqual(Object.keys(files).sort(), ['README.md', 'opening.md']);
  assert.match(files['README.md'], /^---\ntype: readme\nname: crime-scene\nmaterial: stub\n---/);
  assert.match(files['README.md'], /crime-scene/);
  assert.match(files['opening.md'], /^---\ntype: chalk\n---/);
});


// ----------------------------------------------------- nook page membership

test('directChildrenOf keeps only direct children', () => {
  const files = ['a/x.md', 'a/y.json', 'a/sub/z.md', 'b/w.md', 'a'];
  assert.deepEqual(directChildrenOf(files, 'a'), ['x.md', 'y.json']);
  assert.deepEqual(directChildrenOf(files, 'a/sub'), ['z.md']);
  assert.deepEqual(directChildrenOf(files, 'b'), ['w.md']);
  assert.deepEqual(directChildrenOf(files, 'nope'), []);
});

test('nookCardPaths: direct-child .md minus all root configuration', () => {
  const dir = 'characters/ryo';
  const files = [
    `${dir}/README.md`,
    `${dir}/identity.md`,
    `${dir}/personality.md`,
    `${dir}/memory.md`,
    `${dir}/preset.json`,
    `${dir}/diary.md`,
    `${dir}/letter.md`,
    `${dir}/letters/unsent.md`,
    `${dir}/art.png`,
  ];
  assert.deepEqual(nookCardPaths(files, dir), [`${dir}/diary.md`, `${dir}/letter.md`]);
});