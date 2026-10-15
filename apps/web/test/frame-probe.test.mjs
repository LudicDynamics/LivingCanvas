import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false, tryNative: true });
const probe = await jiti.import('../src/lib/frame-probe.ts');

test('summarizeFrameGaps derives fps, percentiles and over-budget counts', () => {
  // 58 gaps of 16ms (smooth) + 2 gaps of 80ms (two bad frames) in 60.
  const gaps = [...Array(58).fill(16), 80, 80];
  const stats = probe.summarizeFrameGaps(gaps);
  assert.equal(stats.frames, 60);
  assert.equal(stats.gapP50, 16);
  assert.equal(stats.gapMax, 80);
  assert.equal(stats.framesOver33, 2);
  assert.equal(stats.framesOver50, 2);
  // avg = (58*16 + 160)/60 ≈ 18.1ms → ~55fps
  assert.equal(stats.fpsAvg, 55);
});

test('summarizeFrameGaps on an empty window is all zeros, never NaN', () => {
  const stats = probe.summarizeFrameGaps([]);
  assert.equal(stats.frames, 0);
  assert.equal(stats.fpsAvg, 0);
  assert.equal(stats.gapP50, 0);
  assert.equal(stats.gapP99, 0);
  assert.equal(stats.gapMax, 0);
});

test('pushCapped keeps the newest cap items, dropping the oldest', () => {
  const buffer = [];
  for (let i = 0; i < 10; i++) probe.pushCapped(buffer, i, 4);
  assert.deepEqual(buffer, [6, 7, 8, 9]);
});

test('the probe stays silent while off: no events, no counters in the snapshot', () => {
  probe.setFrameProbeEnabled(false);
  probe.probeCount('cameraFrame');
  probe.probeMark('cardFlip');
  const snapshot = probe.snapshotFrameProbe();
  assert.equal(snapshot.summary.counters.cameraFrame ?? 0, 0);
  assert.equal(snapshot.events.some(e => e.key === 'cardFlip'), false);
  assert.equal(snapshot.summary.frames, 0);
});
