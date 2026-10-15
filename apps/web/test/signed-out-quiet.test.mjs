// Signed out on canvas.worldlines.gg (live 2026-10-11, canvas-20261011-0250): no voice request per line answered
// 401 → 502, no /api/viewpoint (or layer re-read) before a world is open — each was a red line in the console.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const src = (p) => readFile(new URL(p, import.meta.url), 'utf8');

test('a voice line refused for want of an account stops the voices for the session (one hint, no pause counter)', async () => {
  const req = await src('../src/lib/tts-request.ts');
  const refused = req.indexOf("data.code === 'tts_requires_account' || res.status === 401 || res.status === 403");
  assert.ok(refused > 0, 'tts_requires_account / 401 / 403 handled');
  assert.ok(refused < req.indexOf('invalidateTts(data.code'), 'before the generic failure path');
  assert.match(req.slice(refused, refused + 300), /noteTtsRequiresAccount\(\);[\s\S]*?return FAILED;/);
  const ready = await src('../src/lib/tts-readiness.ts');
  assert.match(ready, /if \(config\.requiresAccount\) noteTtsRequiresAccount\(\);\s*else warnTtsUnavailable\(\);/, 'readiness says no up front, with the account hint');
  const app = await src('../src/App.tsx');
  assert.match(app, /const onVoiceNeedsAccount = \(\) => notify\(t\("Sign in to hear the characters' voices\."\)\);/);
  const messages = JSON.parse(await src('../src/lib/messages.json'));
  assert.equal(messages["Sign in to hear the characters' voices."]['zh-CN'], '登录后可以听到角色的声音。');
});

test('no viewpoint report and no socket layer re-read while no world is open', async () => {
  const app = await src('../src/App.tsx');
  assert.match(app, /useViewpointReport\(\{ camera, layer, bagCount: handItems\.length, enabled: nookChar === null && activeWorldPath !== null \}\);/);
  const world = await src('../src/state/useWorld.ts');
  assert.match(world, /if \(agentActivityStore\.getActiveSavePath\(\) \|\| stateRef\.current\) void fetchLayer\(layerRef\.current\);/);
});
