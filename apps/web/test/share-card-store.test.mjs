// 「我的分享卡」 store (lib/share-card-store.ts; the design notes §分享卡): pinned on the in-memory backend —
// newest used first, per-CG filter, the same card saved again replaces the older copy, cap with least recently
// used dropped first, touch keeps a card alive, delete, change notifications.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false, tryNative: true });
const { createShareCardStore, memoryBackend, indexedDbBackend, SHARE_CARD_CAP } = await jiti.import('../src/lib/share-card-store.ts');

const meta = (over = {}) => ({ kind: 'result', format: 'portrait', locale: 'zh-CN', worldKey: 'whitechapel', worldTitle: '白教堂', endingTitle: '雾散', cgPath: 'cg/a.webp', ...over });
const blob = (n = 10) => new Blob([new Uint8Array(n)], { type: 'image/png' });
const clock = () => { let t = 1000; return () => (t += 10); };

test('save → list newest first, records carry blob and meta', async () => {
  const s = createShareCardStore(memoryBackend(), { now: clock() });
  const a = await s.save(blob(), meta({ cgPath: 'cg/a.webp' }));
  const b = await s.save(blob(), meta({ cgPath: 'cg/b.webp', kind: 'invite' }));
  const list = await s.list();
  assert.deepEqual(list.map((r) => r.id), [b.id, a.id]);
  assert.equal(list[0].kind, 'invite');
  assert.equal(list[1].blob.size, 10);
  assert.ok(list[0].createdAt > list[1].createdAt);
});

test('per-CG filter (cgPath + world)', async () => {
  const s = createShareCardStore(memoryBackend(), { now: clock() });
  await s.save(blob(), meta({ cgPath: 'cg/a.webp' }));
  await s.save(blob(), meta({ cgPath: 'cg/a.webp', worldKey: 'other' }));
  await s.save(blob(), meta({ cgPath: 'cg/b.webp' }));
  assert.equal((await s.list({ cgPath: 'cg/a.webp', worldKey: 'whitechapel' })).length, 1);
  assert.equal((await s.list({ cgPath: 'cg/a.webp' })).length, 2);
});

test('the same card saved again replaces the older copy', async () => {
  const s = createShareCardStore(memoryBackend(), { now: clock() });
  await s.save(blob(), meta());
  await s.save(blob(), meta());
  assert.equal((await s.list()).length, 1);
  await s.save(blob(), meta({ locale: 'ja' }));
  assert.equal((await s.list()).length, 2);
});

test('cap: least recently used dropped first; touch keeps a card', async () => {
  const s = createShareCardStore(memoryBackend(), { now: clock(), cap: 3 });
  const a = await s.save(blob(), meta({ cgPath: '1' }));
  const b = await s.save(blob(), meta({ cgPath: '2' }));
  await s.save(blob(), meta({ cgPath: '3' }));
  await s.touch(a.id);
  await s.save(blob(), meta({ cgPath: '4' }));
  const ids = (await s.list()).map((r) => r.id);
  assert.equal(ids.length, 3);
  assert.ok(ids.includes(a.id));
  assert.ok(!ids.includes(b.id));
  assert.equal(SHARE_CARD_CAP, 50);
});

test('remove + change notifications', async () => {
  let n = 0;
  const s = createShareCardStore(memoryBackend(), { now: clock(), onChange: () => n++ });
  const a = await s.save(blob(), meta());
  await s.remove(a.id);
  assert.equal((await s.list()).length, 0);
  assert.equal(n, 2);
});

test('no IndexedDB → null backend (default store falls back to memory)', () => {
  assert.equal(indexedDbBackend(undefined), null);
});
