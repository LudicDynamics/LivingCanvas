// Two harmless notices that reached players: 「已进入，但场景没能同步」 on phones and
// the replay's 「Could not catch up…」 over the prologue's first scene. Source checks of state/useWorld.ts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';

const src = (p) => readFile(new URL(p, import.meta.url), 'utf8');

// 3(d) 「已进入，但场景没能同步」 on phones: a superseded layer read (the socket's reconnect read racing the prologue's
// first scene entry) answered `true` before the newer read had written state, so enterLayer's reconcile still saw
// the previous scene. A superseded read now waits for the newest read of that layer.
test('scene entry: a superseded layer read waits for the newest one (no spurious reconcile_failed)', async () => {
  const world = await src('../src/state/useWorld.ts');
  assert.match(world, /layerReadLatestRef\.current\.set\(target, \{ seq, read \}\)/);
  assert.match(world, /if \(layerReadRef\.current\.get\(target\) !== seq\) \{\s*const newer = layerReadLatestRef\.current\.get\(target\);\s*return newer && newer\.seq !== seq \? newer\.read : true;/);
  assert.match(world, /layerReadRef\.current\.clear\(\);\s*layerReadLatestRef\.current\.clear\(\);/, 'a world switch forgets the pending reads');
});

test('the replay catch-up notice is only for a save that was open when the socket connected (none over the prologue)', async () => {
  const world = await src('../src/state/useWorld.ts');
  assert.match(world, /const replayFor = agentActivityStore\.getActiveSavePath\(\);/);
  assert.match(world, /if \(!replayFor \|\| replayFor !== agentActivityStore\.getActiveSavePath\(\)\) return;\s*window\.dispatchEvent\(new CustomEvent\('airp:notice', \{\s*detail: 'Could not catch up on the last moments/);
});
