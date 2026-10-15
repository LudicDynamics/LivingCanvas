// Creation-mode art: the `art` frontmatter schema,
// the lenient runtime read, and the slot list the 素材 panel shows.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { artErrors, artOf, artSlug, layerOfReadme, withArtField, withArtPrompt, withLandedArt, worldArtManifest } from '../dist/index.js';

const scene = { path: 'assets/scenes/hall.webp', prompt: 'a hall at night, no text' };

test('artErrors: absent or valid art is clean; bad shapes are named', () => {
  assert.deepEqual(artErrors({}), []);
  assert.deepEqual(artErrors({ art: { scene, map: { path: 'assets/maps/v.png', prompt: '' }, cg: [{ id: 'a', ...scene, when: 'first' }] } }), []);
  assert.ok(artErrors({ art: { scene: { path: 'world/x.png', prompt: 'p' } } }).some((e) => e.startsWith('art.scene.path')));
  assert.ok(artErrors({ art: { scene: { path: 'assets/../x.png', prompt: 'p' } } }).length > 0);
  assert.ok(artErrors({ art: { poster: scene } }).length > 0, 'unknown keys are strict');
  assert.ok(artErrors({ art: { cg: [{ id: 'a', ...scene }, { id: 'a', ...scene }] } }).some((e) => /duplicate/.test(e)));
});

test('artOf is lenient: a bad entry is dropped, the rest survive', () => {
  const art = artOf({ art: { scene, map: { path: 'nope', prompt: 'x' }, cg: [{ id: 'ok', ...scene }, { id: 'BAD ID', ...scene }, 'junk'] } });
  assert.deepEqual(art.scene, scene);
  assert.equal(art.map, undefined);
  assert.deepEqual(art.cg.map((c) => c.id), ['ok']);
  assert.deepEqual(artOf(null), {});
  assert.deepEqual(artOf({ art: 'x' }), {});
});

test('layer helpers', () => {
  assert.equal(layerOfReadme('world/README.md'), 'map');
  assert.equal(layerOfReadme('world/a/b/README.md'), 'world/a/b');
  assert.equal(layerOfReadme('world/a/card.md'), null);
  assert.equal(artSlug('map'), 'world');
  assert.equal(artSlug('world/a/b'), 'a-b');
});

const world = () => ({
  manifest: {
    name: 'Village',
    characters: [{ id: 'po', name: '秀莲婆', home: 'map', avatar: 'assets/characters/old.png' }, { id: 'ghost' }],
    endings: [{ id: 'returned', title: '名字归位', path: 'endings/returned/README.md' }],
    triggers: [{ id: 'first-name', label: 'First', kind: 'place', when: { layer: 'world/well' }, assets: [{ kind: 'cg', path: 'assets/cg/first.webp', prompt: 'the first name' }, { kind: 'background', path: 'bad/path.png', prompt: 'x' }] }],
  },
  docs: [
    { path: 'world/well/README.md', frontmatter: { title: '老井', art: { scene: { path: 'assets/scenes/well.webp', prompt: 'a well' } } } },
    { path: 'world/README.md', frontmatter: { name: 'Root', bg: 'assets/scenes/intro.png', map: { plan: { picture: 'assets/scenes/intro.png' } }, art: { scene, map: { path: 'assets/maps/village.webp', prompt: 'aerial' }, cg: [{ id: 'the-call', path: 'assets/cg/call.webp', prompt: 'the well calls', when: 'ending' }] } } },
    { path: 'world/well/xi-mei.md', frontmatter: { type: 'npc', name: '细妹', art: { portrait: { path: 'assets/characters/xi-mei.webp', prompt: 'a girl' } } } },
    { path: 'world/well/note.md', frontmatter: { type: 'note' } },
    { path: 'characters/po/README.md', frontmatter: { name: 'Po', avatar: 'assets/characters/old.png', art: { portrait: { path: 'assets/characters/po.webp', prompt: 'old woman', cutout: true } } } },
    { path: 'endings/returned/README.md', frontmatter: { title: 'R' } },
  ],
  exists: (p) => p === 'assets/scenes/intro.png' || p === 'assets/scenes/well.webp' || p === 'assets/characters/old.png',
});

test('worldArtManifest: every picture, in panel order, with existence and what is wired now', () => {
  const slots = worldArtManifest(world());
  assert.deepEqual(slots.map((s) => s.id), [
    'layer:map:scene', 'layer:map:map', 'layer:world/well:scene', 'layer:world/well:map',
    'character:po:portrait', 'npc:world/well/xi-mei.md:portrait',
    'cg:the-call', 'trigger:first-name:0',
    'ending:returned:scene',
  ]);
  const byId = Object.fromEntries(slots.map((s) => [s.id, s]));
  assert.equal(byId['layer:map:scene'].exists, false);
  assert.equal(byId['layer:map:scene'].inUse, 'assets/scenes/intro.png');
  assert.equal(byId['layer:map:scene'].inUseExists, true);
  assert.equal(byId['layer:map:scene'].label, 'Root');
  assert.equal(byId['layer:world/well:scene'].exists, true);
  assert.equal(byId['layer:world/well:scene'].label, '老井');
  // Undeclared: a suggested path and an empty prompt, never a wired one.
  assert.equal(byId['layer:world/well:map'].declared, false);
  assert.equal(byId['layer:world/well:map'].path, 'assets/maps/well.png');
  assert.equal(byId['layer:world/well:map'].prompt, '');
  assert.equal(byId['character:po:portrait'].cutout, true);
  assert.equal(byId['character:po:portrait'].label, '秀莲婆');
  assert.equal(byId['character:po:portrait'].layer, 'map');
  assert.equal(byId['npc:world/well/xi-mei.md:portrait'].layer, 'world/well');
  assert.equal(byId['cg:the-call'].when, 'ending');
  assert.equal(byId['trigger:first-name:0'].ownerPath, 'world.json');
  assert.equal(byId['ending:returned:scene'].path, 'assets/endings/returned.png');
  for (const s of slots) assert.equal(typeof s.exists, 'boolean');
});

test('withArtPrompt declares a missing slot and edits a declared one; CGs by id', () => {
  const fm = { title: 'x' };
  const next = withArtPrompt(fm, { id: 'layer:world/a:map', owner: 'layer', kind: 'map', path: 'assets/maps/a.png' }, 'aerial');
  assert.deepEqual(next.art, { map: { path: 'assets/maps/a.png', prompt: 'aerial' } });
  assert.equal(fm.art, undefined, 'pure');
  const kept = withArtPrompt({ art: { map: { path: 'assets/maps/b.webp', prompt: 'old' } } }, { id: 'layer:world/a:map', owner: 'layer', kind: 'map', path: 'assets/maps/a.png' }, 'new');
  assert.deepEqual(kept.art.map, { path: 'assets/maps/b.webp', prompt: 'new' });
  const cg = withArtPrompt({ art: { cg: [{ id: 'c', path: 'assets/cg/c.png', prompt: 'old' }] } }, { id: 'cg:c', owner: 'cg', kind: 'cg', path: 'assets/cg/c.png' }, 'new');
  assert.equal(cg.art.cg[0].prompt, 'new');
  assert.equal(withArtPrompt({}, { id: 'cg:missing', owner: 'cg', kind: 'cg', path: 'assets/cg/c.png' }, 'x'), null);
  const cut = withArtField({}, { id: 'character:po:portrait', owner: 'character', kind: 'portrait', path: 'assets/characters/po.png', prompt: 'p' }, 'cutout', true);
  assert.deepEqual(cut.art.portrait, { path: 'assets/characters/po.png', prompt: 'p', cutout: true });
});

test('withLandedArt wires scene → bg, map → map.plan.picture, portrait → avatar, nothing else', () => {
  assert.equal(withLandedArt({}, { owner: 'layer', kind: 'scene' }, 'assets/scenes/a.png').bg, 'assets/scenes/a.png');
  const map = withLandedArt({ map: { plan: { pins: { a: [0.1, 0.2] } } } }, { owner: 'layer', kind: 'map' }, 'assets/maps/a.png');
  assert.deepEqual(map.map.plan, { pins: { a: [0.1, 0.2] }, picture: 'assets/maps/a.png' });
  assert.equal(withLandedArt({}, { owner: 'npc', kind: 'portrait' }, 'assets/characters/a.png').avatar, 'assets/characters/a.png');
  assert.deepEqual(withLandedArt({ title: 't' }, { owner: 'ending', kind: 'scene' }, 'assets/endings/a.png'), { title: 't' });
});
