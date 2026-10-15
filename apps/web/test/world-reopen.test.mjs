import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url);
const { createWorldReopener, REOPEN_COOLDOWN_MS } = await jiti.import('../src/lib/world-reopen.ts');
const read = (p) => fs.readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

test('nothing open: the shelf takes over', () => {
  assert.equal(createWorldReopener().take(), null);
});

test('the open save is reopened once, then not again within the cooldown', () => {
  let now = 1000;
  const r = createWorldReopener(() => now);
  r.opened('/repo/worlds/users/u1/guixiang-eb2067bb');
  assert.equal(r.take(), '/repo/worlds/users/u1/guixiang-eb2067bb');
  r.opened('/repo/worlds/users/u1/guixiang-eb2067bb'); // the reopen landed
  assert.equal(r.take(), null, 'gone again right away → no reload loop');
  now += REOPEN_COOLDOWN_MS;
  assert.equal(r.take(), '/repo/worlds/users/u1/guixiang-eb2067bb', 'a later loss may reopen again');
});

test('another save gets its own try; forget clears it', () => {
  const r = createWorldReopener(() => 0);
  r.opened('/a');
  assert.equal(r.take(), '/a');
  r.opened('/b');
  assert.equal(r.take(), '/b');
  r.forget();
  assert.equal(r.take(), null);
});

test('App reopens the resolved save path once on no_active_world, with a notice', () => {
  const app = read('App.tsx');
  assert.match(app, /worldReopener\.opened\(result\.path\);/);
  assert.match(app, /if \(reopenInFlight\.current\) return;\s*const reopen = worldReopener\.take\(\);/);
  assert.match(app, /notify\(t\('The world connection dropped\. Reopening it…'\)\);\s*void loadWorldRef\.current\(reopen\)/);
});

test('an NPC that cannot answer because the world is gone says so, not "try again"', () => {
  const npc = read('components/sidebar/NpcDialogue.tsx');
  assert.match(npc, /code === 'no_active_world'\) \{\s*setNotice\(\{ kind: 'error', text: t\('The world connection dropped\. Reopening it…'\) \}\);/);
  const messages = JSON.parse(read('lib/messages.json'));
  for (const key of ['The world connection dropped. Reopening it…', '{name} is still answering.']) {
    for (const locale of ['zh-CN', 'ja', 'ko']) assert.ok(messages[key]?.[locale], `${key} → ${locale}`);
  }
});

test('「继续这个故事」: the same save closes; a reloaded page adopts the server\'s save; another tab\'s save is entered', async () => {
  const { continueStoryAction } = await jiti.import('../src/lib/world-reopen.ts');
  assert.deepEqual(continueStoryAction('/w/a', '/w/a'), { kind: 'close' });
  assert.deepEqual(continueStoryAction(null, '/w/a'), { kind: 'adopt', path: '/w/a' }, 'after a reload nothing is selected: commands would carry no save');
  assert.deepEqual(continueStoryAction('/w/a', '/w/b'), { kind: 'enter', path: '/w/b' }, 'another tab opened another save: the world on screen is stale');
  assert.deepEqual(continueStoryAction('/w/a', null), { kind: 'close' }, 'no world open: the reopen path takes over');
  assert.deepEqual(continueStoryAction(null, undefined), { kind: 'close' }, 'could not ask: as before');
  // The launcher's button goes through it (App.tsx), not straight to closing.
  const app = read('App.tsx');
  assert.match(app, /onClose=\{manifest \? \(\) => \{ void continueStory\(\); \} : undefined\}/);
  assert.match(app, /continueStoryAction\(activeWorldPath, open\)/);
});
