// The lobby (no world loaded) must not call world-scoped endpoints (smoke test 2026-10-05: ~7 × 404
// `/api/world/run` and a 409 `/api/world-settings` in the console before any world was played).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const run = read('../src/lib/closed-run.ts');
const world = read('../src/state/useWorld.ts');
const app = read('../src/App.tsx');

test('useClosedRun: no read and no event listeners without a world key', () => {
  assert.match(app, /const runKey = manifest && loadingWorld === null \?/);
  const effect = run.slice(run.indexOf('export function useClosedRun'));
  const guard = effect.indexOf('if (!worldKey) return');
  assert.ok(guard > 0, 'early return when no world');
  assert.ok(guard < effect.indexOf('refresh();'), 'guard before the first read');
  assert.ok(guard < effect.indexOf('window.addEventListener'), 'guard before the DOM listeners');
});

test('useWorld: the mount read of world settings waits for a successful layer read', () => {
  assert.match(world, /void fetchLayer\(layerRef\.current\)\.then\(\(ok\) => \{ if \(ok\) void reloadSettings\(\); \}\);/);
  assert.doesNotMatch(world, /void fetchLayer\(layerRef\.current\);\s*void reloadSettings\(\);/);
});
