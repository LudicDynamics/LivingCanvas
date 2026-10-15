// The scene-entry presentation's facts:
// scenes in first-entry order, nothing counted.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { visitedScenes, WorldManifestSchema } from '../dist/index.js';

const L = (layer, name, extra = {}) => ({ layer, name, bg: null, video: null, ...extra });
const layers = [
  L('world', 'Baker Street', { bg: 'assets/bg/intro.webp', video: 'assets/motion/intro.webm' }),
  L('world/map', 'London', { bg: 'assets/bg/map.webp' }),
  L('world/map/morgue', 'Morgue', { video: 'assets/motion/morgue.webm' }),
];

test('a fresh run has entered only its start scene', () => {
  assert.deepEqual(visitedScenes({ layers, entered: [], start: 'map' }), [
    { layer: 'world', name: 'Baker Street', video: 'assets/motion/intro.webm', poster: 'assets/bg/intro.webp' },
  ]);
});

test('scenes come in first-entry order; revisits, `map` for the root and stubs add nothing', () => {
  const scenes = visitedScenes({
    layers,
    entered: ['world/map/morgue', 'world/map', 'world/map/morgue', 'map', 'world/map/unwritten'],
    start: 'map',
  });
  assert.deepEqual(scenes.map((s) => s.layer), ['world', 'world/map/morgue', 'world/map']);
  assert.equal(scenes[1].poster, null);
});

test('world.json gains no chapter or progress fields', () => {
  const shape = WorldManifestSchema.shape;
  assert.equal('chapters' in shape, false);
  assert.equal('keyItems' in shape, false);
});
