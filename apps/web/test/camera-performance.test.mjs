import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false, tryNative: true });
const camera = await jiti.import('../src/lib/camera.ts');

test('high zoom enters compact at the 1.3 threshold', () => {
  assert.equal(camera.HIGH_ZOOM_RENDER_THRESHOLD, 1.3);
  assert.equal(camera.compactPaintFor(camera.Z_MAX, false), true);
  assert.equal(camera.compactPaintFor(camera.HIGH_ZOOM_RENDER_THRESHOLD, false), true);
  assert.equal(camera.compactPaintFor(camera.HIGH_ZOOM_RENDER_THRESHOLD - 0.001, false), false);
});

test('the compact profile releases with hysteresis, not at the entry threshold', () => {
  assert.equal(camera.HIGH_ZOOM_RELEASE_THRESHOLD, 1.2);
  // Between the thresholds the current profile is held either way.
  assert.equal(camera.compactPaintFor(camera.HIGH_ZOOM_RELEASE_THRESHOLD, true), true);
  assert.equal(camera.compactPaintFor(camera.HIGH_ZOOM_RELEASE_THRESHOLD, false), false);
  assert.equal(camera.compactPaintFor(camera.HIGH_ZOOM_RENDER_THRESHOLD - 0.001, true), true);
  // Below the release threshold compact turns off.
  assert.equal(camera.compactPaintFor(camera.HIGH_ZOOM_RELEASE_THRESHOLD - 0.001, true), false);
});

test('non-finite zoom never changes the compact profile', () => {
  assert.equal(camera.compactPaintFor(Number.NaN, true), true);
  assert.equal(camera.compactPaintFor(Number.NaN, false), false);
  assert.equal(camera.compactPaintFor(Number.POSITIVE_INFINITY, false), false);
});
