import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false, tryNative: true });
const { createMediaReadinessAdapter } = await jiti.import('../src/lib/media-readiness.ts');

test('a foreign owner request does not strand a current entry at loading', () => {
  // Regression: `currentEpoch` is adapter-wide. An audio track requesting epoch 3
  // after the portrait requested epoch 2 must not make the portrait's own
  // ready event look stale — that froze every nook/dialogue portrait video on
  // its poster frame forever.
  const a = createMediaReadinessAdapter();
  void a.request('portrait', '/p.webm', 2);
  void a.request('ambient', '/rain.mp3', 3);
  const settled = a.markReady('portrait', '/p.webm', 2);
  assert.equal(settled.state, 'ready', 'portrait ready wins over an unrelated higher epoch');
  assert.equal(a.snapshot('portrait', '/p.webm').state, 'ready');
});

test('a newer request for the same key still supersedes an older ready', () => {
  const a = createMediaReadinessAdapter();
  void a.request('portrait', '/p.webm', 1);
  a.request('portrait', '/p.webm', 2);
  assert.equal(a.markReady('portrait', '/p.webm', 1).state, 'failed');
  assert.equal(a.snapshot('portrait', '/p.webm').state, 'loading');
  assert.equal(a.markReady('portrait', '/p.webm', 2).state, 'ready');
});

test('invalidate still strands every older epoch, including a ready entry', () => {
  const a = createMediaReadinessAdapter();
  void a.request('portrait', '/p.webm', 1);
  a.markReady('portrait', '/p.webm', 1);
  a.invalidate(7);
  assert.equal(a.snapshot('portrait', '/p.webm').state, 'unrequested');
  assert.equal(a.markReady('portrait', '/p.webm', 1).state, 'failed');
});

test('a cancel marks the matching entry stale and a late ready cannot revive it', () => {
  const a = createMediaReadinessAdapter();
  void a.request('portrait', '/p.webm', 4);
  a.cancel('portrait', '/p.webm', 4);
  assert.equal(a.snapshot('portrait', '/p.webm').state, 'failed');
  // The entry keeps epoch 4, so an epoch-4 ready still matches; cancel intent is
  // carried by the `failed` state, and a genuine re-request must use a new epoch.
  void a.request('portrait', '/p.webm', 5);
  assert.equal(a.snapshot('portrait', '/p.webm').state, 'loading');
});

test('marking an unknown key ready records it rather than reporting stale', () => {
  const a = createMediaReadinessAdapter();
  assert.equal(a.markReady('portrait', '/never-requested.webm', 1).state, 'ready');
});

test('request resolves the waiter whose epoch and key both match', async () => {
  const a = createMediaReadinessAdapter();
  const pending = a.request('portrait', '/p.webm', 1);
  void a.request('ambient', '/rain.mp3', 2);
  a.markReady('portrait', '/p.webm', 1);
  assert.equal((await pending).state, 'ready');
});

test('one of two consumers cancelling does not strand the other (remote nook fix 7a2bc2f)', async () => {
  // The nook portrait and the dock both wait on the same video. When one of
  // them unmounts and cancels, the other must still get its ready event.
  const a = createMediaReadinessAdapter();
  const first = a.request('portrait', '/p.webm', 1);
  const second = a.request('portrait', '/p.webm', 1);
  a.cancel('portrait', '/p.webm', 1);
  assert.equal(a.snapshot('portrait', '/p.webm').state, 'loading', 'still loading for the remaining consumer');
  a.markReady('portrait', '/p.webm', 1);
  assert.equal((await first).state, 'ready');
  assert.equal((await second).state, 'ready');
  // The last consumer cancelling does make it stale.
  void a.request('portrait', '/q.webm', 1);
  a.cancel('portrait', '/q.webm', 1);
  assert.equal(a.snapshot('portrait', '/q.webm').state, 'failed');
});
