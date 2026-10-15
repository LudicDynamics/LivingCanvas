// the design notes — source-contract assertions for `readLayerState`.
// Style mirrors apps/web/test/active-projection.test.mjs: read the file and
// assert with regexes, no React runtime.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const useWorld = await readFile(new URL('../src/state/useWorld.ts', import.meta.url), 'utf8');
const presence = await readFile(new URL('../src/lib/presence.ts', import.meta.url), 'utf8');

test('R1 readLayerState is part of the UseWorldApi shape', () => {
  assert.match(useWorld, /readLayerState\(\): LayerState \| null/);
});

test('R2 readLayerState is a read-only window onto stateRef', () => {
  const match = /readLayerState = useCallback\(\s*\(\): LayerState \| null => stateRef\.current/.exec(useWorld);
  assert.ok(match, 'readLayerState must be the sync stateRef reader');
  const body = useWorld.slice(match.index, useWorld.indexOf('\n', useWorld.indexOf('[]', match.index)));
  assert.doesNotMatch(body, /setState\(|stateRef\.current =/);
});

test('R3 readLayerState is exposed on the returned object', () => {
  const returned = useWorld.slice(useWorld.indexOf('readLayerState,'));
  assert.match(returned, /^readLayerState,/m);
});

test('R4 navigateToCharacter waits a frame and never writes camera memory', () => {
  assert.match(presence, /await nextFrame\(\)/);
  assert.match(presence, /enterLayer[\s\S]*?nextFrame[\s\S]*?flyTo/);
  assert.doesNotMatch(presence, /camera\.save\(|camera\.restore\(/);
});
