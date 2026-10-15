import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildNookInitBrief, buildSceneInitBrief } from '../dist/index.js';

const manifest = {
  id: 'holmes-beckstreet',
  name: 'Fog Over Baker Street',
  genre: 'mystery',
  description: 'An open-ended mystery',
  material: 'parchment',
};

// ------------------------------------------------------------ scene brief

test('scene brief: emits virtual layer id and physical target path', () => {
  const b = buildSceneInitBrief({ layerId: 'map', targetPath: 'world', manifest });
  assert.match(b, /^\[Layer ID\] map$/m);
  assert.match(b, /^\[Target Path\] world$/m);
  assert.doesNotMatch(b, /map\/README\.md/);
});

test('scene brief: [Target Path] echoes the given directory', () => {
  const b = buildSceneInitBrief({
    layerId: 'world/baker-street/crime-scene',
    targetPath: 'world/baker-street/crime-scene',
    manifest,
  });
  assert.match(b, /^\[Target Path\] world\/baker-street\/crime-scene$/m);
});

test('scene brief: [Parent Path] follows [Parent Layer] when both are given', () => {
  const b = buildSceneInitBrief({
    layerId: 'world/a/b',
    targetPath: 'world/a/b',
    manifest,
    parentLayerName: 'A',
    parentLayerPath: 'world/a',
  });
  const lines = b.split('\n');
  const i = lines.indexOf('[Parent Layer] A');
  assert.notEqual(i, -1, 'has [Parent Layer]');
  assert.equal(lines[i + 1], '[Parent Path] world/a', '[Parent Path] immediately follows');
});

test('scene brief: no [Parent Layer]/[Parent Path] when neither is given', () => {
  const b = buildSceneInitBrief({ layerId: 'world/x', targetPath: 'world/x', manifest });
  assert.doesNotMatch(b, /\[Parent Layer\]/);
  assert.doesNotMatch(b, /\[Parent Path\]/);
});

test('scene brief: [Parent Path] omitted when only the name is known (independent ifs)', () => {
  const b = buildSceneInitBrief({ layerId: 'world/a/b', targetPath: 'world/a/b', manifest, parentLayerName: 'A' });
  assert.match(b, /\[Parent Layer\] A/);
  assert.doesNotMatch(b, /\[Parent Path\]/);
});

test('scene brief: player request and known clues are conditional', () => {
  const bare = buildSceneInitBrief({ layerId: 'world/x', targetPath: 'world/x', manifest });
  assert.doesNotMatch(bare, /\[Player Request\]/);
  assert.doesNotMatch(bare, /\[Known Clues\]/);

  const rich = buildSceneInitBrief({
    layerId: 'world/x',
    targetPath: 'world/x',
    manifest,
    userPrompt: 'a stormy night',
    knownClues: ['a key', 'a letter'],
  });
  assert.match(rich, /\[Player Request\] a stormy night/);
  assert.match(rich, /\[Known Clues\] a key \/ a letter/);
});

test('scene brief: deliverables say 1–3 objects, 1–2 openings, and defer the report to the prompt', () => {
  const b = buildSceneInitBrief({ layerId: 'world/x', targetPath: 'world/x', manifest });
  assert.match(b, /1–3 object markdown files/, 'count aligned to scene contract');
  assert.match(b, /1–2 opening narrations/, 'opening count aligned to scene contract');
  assert.match(b, /NN-opening\.md/);
  assert.match(b, /opening\.md is only the old W2 fallback/);
  assert.match(b, /Report in exactly the three lines the system prompt defines/);
  assert.doesNotMatch(b, /Three lines:/, 'old duplicated report spec is gone');
});

// ------------------------------------------------------------ nook brief

test('nook brief: [Target Path] uses the character id, not the display name', () => {
  const b = buildNookInitBrief({
    characterId: 'watson',
    displayName: 'Dr. Watson',
    manifest,
  });
  assert.match(b, /^\[Target Path\] characters\/watson$/m);
  assert.match(b, /\[Character\] Dr\. Watson$/m, 'display name shown without a role');
  assert.doesNotMatch(b, /Dr\. Watson\)/, 'no empty parentheses when roleDesc is absent');
});

test('nook brief: roleDesc appears in parentheses when present', () => {
  const b = buildNookInitBrief({
    characterId: 'watson',
    displayName: 'Dr. Watson',
    roleDesc: 'companion',
    manifest,
  });
  assert.match(b, /\[Character\] Dr\. Watson \(companion\)/);
});

test('nook brief: [Home] carries provenance, with role when present', () => {
  const withRole = buildNookInitBrief({
    characterId: 'watson',
    displayName: 'Dr. Watson',
    home: 'world/baker-street',
    role: 'companion',
    manifest,
  });
  assert.match(withRole, /^\[Home\] world\/baker-street \(role: companion\)$/m);

  const noRole = buildNookInitBrief({
    characterId: 'watson',
    displayName: 'Dr. Watson',
    home: 'world/baker-street',
    manifest,
  });
  assert.match(noRole, /^\[Home\] world\/baker-street$/m);

  const none = buildNookInitBrief({ characterId: 'w', displayName: 'W', manifest });
  assert.doesNotMatch(none, /\[Home\]/, 'no [Home] line when home is absent');
});

test('nook brief: [Missing Files] lists bare filenames, comma-separated', () => {
  const b = buildNookInitBrief({
    characterId: 'watson',
    displayName: 'Dr. Watson',
    manifest,
    missingFiles: ['identity.md', 'personality.md'],
  });
  assert.match(b, /^\[Missing Files\] identity\.md, personality\.md$/m);
});

test('nook brief: [Missing Files] absent when the list is empty or missing', () => {
  const empty = buildNookInitBrief({ characterId: 'w', displayName: 'W', manifest, missingFiles: [] });
  const none = buildNookInitBrief({ characterId: 'w', displayName: 'W', manifest });
  assert.doesNotMatch(empty, /\[Missing Files\]/);
  assert.doesNotMatch(none, /\[Missing Files\]/);
  assert.doesNotMatch(empty, /\(none\)/, 'never emits a placeholder');
});

test('nook brief: deliverables say 2–4', () => {
  const b = buildNookInitBrief({ characterId: 'w', displayName: 'W', manifest });
  assert.match(b, /2–4 markdown files/);
});
