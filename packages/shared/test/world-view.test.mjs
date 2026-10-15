// `world.json` `view`: optional, backward compatible.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorldManifestSchema, worldDefaultView, WORLD_VIEW_MODES, DEFAULT_WORLD_VIEW } from '../dist/index.js';

const base = { id: 'x', name: 'X', description: '', author: 'a', genre: 'g', createdAt: '', updatedAt: '' };

test('view is optional; absent means the canvas every world had before', () => {
  assert.deepEqual(WORLD_VIEW_MODES, ['canvas', 'map']);
  assert.equal(DEFAULT_WORLD_VIEW, 'canvas');
  const m = WorldManifestSchema.parse(base);
  assert.equal(m.view, undefined);
  assert.equal(worldDefaultView(m), 'canvas');
});

test('view.default is map or canvas; anything else is refused', () => {
  assert.equal(worldDefaultView(WorldManifestSchema.parse({ ...base, view: { default: 'map' } })), 'map');
  assert.deepEqual(WorldManifestSchema.parse({ ...base, view: {} }).view, { default: 'canvas' });
  assert.equal(WorldManifestSchema.safeParse({ ...base, view: { default: 'globe' } }).success, false);
  assert.equal(WorldManifestSchema.safeParse({ ...base, view: 'map' }).success, false, 'an object, not a bare string');
  assert.equal(WorldManifestSchema.safeParse({ ...base, view: { default: 'map', zoom: 2 } }).success, false, 'no unknown keys');
});

test('worldDefaultView is fail-soft on raw manifests', () => {
  assert.equal(worldDefaultView(null), 'canvas');
  assert.equal(worldDefaultView({ view: { default: 'globe' } }), 'canvas');
  assert.equal(worldDefaultView({ view: { default: 'map' } }), 'map');
});
