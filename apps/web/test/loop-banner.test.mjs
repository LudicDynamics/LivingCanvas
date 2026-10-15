// 「第 N 轮」, web side: a `loop_reset` world event is
// relayed after the dice/CG gate, refreshes the bag, and opens the banner.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const src = (p) => readFile(new URL(`../src/${p}`, import.meta.url), 'utf8');
const [app, world, banner, messages] = await Promise.all([
  src('App.tsx'),
  src('state/useWorld.ts'),
  src('components/chrome/LoopBanner.tsx'),
  src('lib/messages.json').then(JSON.parse),
]);

test('useWorld relays loop_reset (after the reveal gate) and re-reads the bag', () => {
  assert.match(world, /\['loop_reset'\]\.includes\(ev\.type \?\? ''\)\) deferReveal\(\(\) => \{\s*if \(isFrameCurrent\(\)\) window\.dispatchEvent\(new CustomEvent\('airp:loop-reset'/);
  assert.match(world, /'music_changed',[\s\S]*?'loop_reset',\s*\]\.includes\(ev\?\.type/);
});

test('App mounts the banner; it listens for airp:loop-reset and says which loop', async () => {
  assert.match(app, /<LoopBanner \/>/);
  assert.match(banner, /addEventListener\('airp:loop-reset'/);
  assert.equal(messages['Loop {n}']['zh-CN'], '第 {n} 轮');
  assert.ok(messages['Back to the first morning. Only you remember.']['ja']);
  const { loopOf } = await jiti.import('../src/lib/loop-banner.ts');
  assert.deepEqual(loopOf({ id: 'evt-9', createdAt: new Date().toISOString(), detail: { loop: 3 } }), { id: 'evt-9', loop: 3 });
  assert.equal(loopOf({ id: 'evt-1', createdAt: '2020-01-01T00:00:00Z', detail: { loop: 2 } }), null, 'a replayed old reset is not re-shown');
  assert.equal(loopOf({ id: 'evt-2', detail: {} }), null);
});
