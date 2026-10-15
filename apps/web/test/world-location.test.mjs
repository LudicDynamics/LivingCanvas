// 本机 / 云端 on the page: the badge per kind, the
// creation choice in the request, and WHEN the 云端 worlds sync (leaving a
// world / page hidden, every 5 minutes, on demand). The server side (what a
// pass does, conflict → keep both) is apps/server/test/world-sync.test.mjs.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { test } from 'node:test';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false, tryNative: true });
const sync = await jiti.import('../src/lib/world-sync.ts');
const src = (rel) => fs.readFile(new URL(`../src/${rel}`, import.meta.url), 'utf8');

test('badges: 官方 / 云端 / 本机 / 本机 · 未同步 / 有冲突, one per kind', async () => {
  const g = (kind, pending = false, conflict = false) => sync.groupPlaceBadge({ kind, pending, conflict });
  assert.deepEqual(g('official'), { label: 'Official', tone: 'official' });
  assert.deepEqual(g('cloud'), { label: 'Cloud', tone: 'cloud' });
  assert.deepEqual(g('cloud', true), { label: 'On this device · not synced', tone: 'pending' });
  assert.deepEqual(g('cloud', true, true), { label: 'Conflict', tone: 'conflict' });
  assert.deepEqual(g('local'), { label: 'On this device', tone: 'local' });
  assert.equal(sync.groupPlaceBadge(undefined), null, 'an older server: no badge rather than a wrong one');
  // A save without a place (play copy, older server) is 本机.
  assert.equal(sync.savePlaceBadge(undefined).tone, 'local');
  assert.equal(sync.savePlaceBadge({ location: 'cloud', pending: false, conflict: false }).tone, 'cloud');
  // An official edition its owner downloaded to edit (feat/world-owner) is still 官方.
  assert.deepEqual(sync.savePlaceBadge({ location: 'official', pending: false, conflict: false }), { label: 'Official', tone: 'official' });
  // Every label is translated in all four locales.
  const messages = JSON.parse(await src('lib/messages.json'));
  for (const label of ['Official', 'Cloud', 'On this device', 'On this device · not synced', 'Conflict']) {
    for (const locale of ['zh-CN', 'ja', 'ko']) assert.ok(messages[label]?.[locale], `${label} / ${locale}`);
  }
  assert.equal(messages['On this device · not synced']['zh-CN'], '本机 · 未同步');
  assert.equal(messages.Official['zh-CN'], '官方');
  assert.equal(messages.Cloud['zh-CN'], '云端');
  assert.equal(messages['On this device']['zh-CN'], '本机');
});

test('the tile, the shelf entry and each save carry the badge; conflict and local originals get their actions', async () => {
  const launcher = await src('components/WorldLauncher.tsx');
  assert.match(launcher, /groupPlaceBadge\(world\.place\)/);
  assert.match(launcher, /data-place=\{place\.tone\}/);
  assert.match(launcher, /world\.place\?\.conflict && onKeepBoth/);
  assert.match(launcher, /t\('Keep both'\)/);
  assert.match(launcher, /world\.place\?\.kind === 'local' && onKeepInCloud/);
  assert.match(launcher, /t\('Upload to the cloud'\)/);
  const shelf = await src('components/WorldShelf.tsx');
  assert.match(shelf, /groupPlaceBadge\(entry\.place\)/);
  assert.match(shelf, /savePlaceBadge\(save\.place\)/);
});

test('creation asks where to keep it: 云端 by default when signed in, 本机 when not; the choice is sent', async () => {
  const dialog = await src('components/CreateWorldDialog.tsx');
  assert.match(dialog, /locationPicked \?\? \(signedIn \? 'cloud' : 'local'\)/);
  assert.match(dialog, /\.\.\.\(signedIn !== null \? \{ location \} : \{\}\)/, 'no account system on this server → nothing sent');
  // The gateway puts it in the body (and tools/check-request-bodies.mjs pins it).
  const gateway = await src('lib/airp-gateway.ts');
  assert.match(gateway, /'\/api\/worlds\/create', json\('POST', \{[^}]*location: body\.location \}\)/);
});

function fakeEnv(answers = {}) {
  const calls = [];
  const listeners = new Map();
  const timers = [];
  const doc = {
    visibilityState: 'visible',
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type) => listeners.delete(type),
  };
  let changed = 0;
  const status = (over = {}) => ({ ok: true, signedIn: true, running: false, lastRunAt: '2026-10-08T03:00:00.000Z', lastError: null, worlds: [], ...over });
  const env = {
    api: {
      worldSync: async () => { calls.push(['status']); if (answers.fail) throw answers.fail; return status(answers.status); },
      syncWorlds: async (worldPath, opts) => { calls.push(['sync', worldPath ?? null, Boolean(opts?.keepalive)]); if (answers.fail) throw answers.fail; return status(answers.pass); },
    },
    onChanged: () => { changed++; },
    setInterval: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearInterval: () => {},
    doc,
  };
  return { env, calls, listeners, timers, doc, changed: () => changed };
}

test('sync on exit: the page going hidden runs a keepalive pass; a pass that changed something re-reads the shelf', async () => {
  const f = fakeEnv({ pass: { worlds: [{ path: 'worlds/made-0000c10d', id: 'made-0000c10d', name: 'X', state: 'pushed' }] } });
  const s = sync.createWorldSync(f.env);
  const stop = s.start();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(f.calls, [['status']], 'starting only reads the last pass');
  f.doc.visibilityState = 'hidden';
  f.listeners.get('visibilitychange')();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(f.calls.at(-1), ['sync', null, true], 'keepalive: the local server finishes it after the tab is gone');
  assert.equal(f.changed(), 1, 'uploaded → the shelf (badges) is read again');
  // Leaving a world (App: launcher opens after a world) runs the same pass.
  await s.run('exit');
  assert.deepEqual(f.calls.at(-1), ['sync', null, true]);
  stop();
  assert.equal(f.listeners.has('visibilitychange'), false);
});

test('every 5 minutes while visible; on demand; nothing while signed out; an old server is left alone', async () => {
  const f = fakeEnv();
  const s = sync.createWorldSync(f.env);
  s.start();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(f.timers[0].ms, 5 * 60_000);
  f.timers[0].fn();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(f.calls.at(-1), ['sync', null, false]);
  f.doc.visibilityState = 'hidden';
  const before = f.calls.length;
  f.timers[0].fn();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(f.calls.length, before, 'a hidden page does not tick');
  assert.equal(f.changed(), 0, 'nothing changed → the shelf is not re-read');
  // 「立即同步」
  await s.run('manual');
  assert.deepEqual(f.calls.at(-1), ['sync', null, false]);

  const out = fakeEnv({ status: { signedIn: false } });
  const signedOut = sync.createWorldSync(out.env);
  await signedOut.refresh();
  await signedOut.run('timer');
  await signedOut.run('exit');
  assert.deepEqual(out.calls, [['status']], 'signed out: the timer and the exit trigger send nothing');
  await signedOut.run('manual');
  assert.equal(out.calls.at(-1)[0], 'sync', 'on demand still asks (the account may have just signed in)');

  const old = fakeEnv({ fail: Object.assign(new Error('GET /api/remote/sync -> 404'), { status: 404 }) });
  const legacy = sync.createWorldSync(old.env);
  await legacy.refresh();
  await legacy.run('manual');
  assert.deepEqual(old.calls, [['status']], 'no /api/remote/sync → stop asking');
});

test('the app wires it: a pass on leaving a world and on sign-in; the account panel shows the status and Sync now', async () => {
  const app = await src('App.tsx');
  assert.match(app, /if \(launcherOpen && wasInWorld\.current\) void worldSync\(\)\?\.run\('exit'\)/);
  assert.match(app, /window\.addEventListener\(ACCOUNT_CHANGED_EVENT, onAccount\)/);
  assert.match(app, /onKeepInCloud=\{keepInCloud\}/);
  assert.match(app, /airpGateway\.keepBoth\(worldPath\)/);
  const tab = await src('components/account/AccountTab.tsx');
  assert.match(tab, /who\.kind === 'local' && <WorldSyncBlock \/>/);
  assert.match(tab, /t\('Sync now'\)/);
  assert.match(tab, /Conflict: \{name\}/);
});
