/**
 * T0.6 — concurrent-write revision guard.
 *
 * The world's write routes accept an OPTIONAL `expectedRevision` (the event
 * high-water mark, `store.getMaxSeq()`). A request that carries a stale one is
 * refused with 409 `stale` + the current revision, and lands NO event; a
 * matching or absent one proceeds and the reply carries the new revision.
 *
 * This file exists to fail BEFORE the guard (every stale write returned 200 and
 * appended), so it is the regression net for the replay bug T0.6 names:
 * "one key opens two locks".
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import test from 'node:test';
import express from '../node_modules/express/index.js';
import { LocalWorldStore } from '../../../packages/shared/dist/index.js';
import { createWorldRouter } from '../dist/routes/world.js';
import { EventBridge } from '../dist/engine/event-bridge.js';

const MANIFEST = JSON.stringify({
  id: 'proj-revision',
  name: 'Revision',
  description: '',
  author: '',
  genre: 'test',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

test('a stale expectedRevision is refused with 409 and lands no event', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-revision-'));
  const store = new LocalWorldStore(root);
  await store.writeFile('world.json', MANIFEST);
  await store.writeFile('world/README.md', '---\nname: Map\ntype: readme\n---\n\n# Map\n');
  await store.writeFile('world/inn/README.md', '---\nname: Inn\ntype: readme\n---\n\n# Inn\n');
  await store.writeFile(
    'world/inn/lock.md',
    '---\ntitle: Rusted Lock\ntype: note\nroll_dice:\n  type: 1d100\n  desc: Pick the lock\n  expect: ">50"\n---\n\nA rusted lock.\n'
  );
  await store.writeFile(
    'world/inn/piano.md',
    '---\ntitle: The Piano\ntype: chalk\nchoice:\n  prompt: What do you do?\n  options:\n    - id: open\n      label: Open the lid\n    - id: leave\n      label: Leave\n---\n\nThe piano.\n'
  );
  await store.writeFile('player/key.md', '---\ntitle: Copper Key\ntype: note\n---\n\nThe key.\n');

  const lifecycle = { stopAll: async () => {}, submitWriter: async () => {} };
  const app = express();
  app.use(express.json());
  app.use('/api', createWorldRouter(process.cwd(), lifecycle, new EventBridge(), () => store, () => {}));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const post = async (route, body) => {
    const res = await fetch(base + route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };

  try {
    // Genesis: no events yet.
    assert.equal(await store.getMaxSeq(), 0);

    // --- a stale revision is a 409 that changes nothing ------------------
    const stale = await post('/move', {
      from: 'player/key.md', to: 'world/inn', expectedRevision: 3,
    });
    assert.equal(stale.status, 409, JSON.stringify(stale.body));
    assert.equal(stale.body.code, 'stale', JSON.stringify(stale.body));
    assert.equal(stale.body.revision, 0, 'the refusal hands back the CURRENT revision');
    assert.equal(await store.getMaxSeq(), 0, 'a refused write lands no event');
    assert.equal(await store.statKind('player/key.md'), 'file', 'a refused write moves nothing');

    // --- a matching revision proceeds and the reply carries the new one ---
    const moved = await post('/move', {
      from: 'player/key.md', to: 'world/inn', expectedRevision: 0,
    });
    assert.equal(moved.status, 200, JSON.stringify(moved.body));
    assert.equal(moved.body.ok, true);
    assert.equal(typeof moved.body.revision, 'number', JSON.stringify(moved.body));
    assert.ok(moved.body.revision > 0, 'the write advanced the revision');
    const afterMove = moved.body.revision;

    // --- that advanced revision is now the one a replay must echo ---------
    const replay = await post('/move', {
      from: 'world/inn/key.md', to: 'player/key.md', expectedRevision: 0,
    });
    assert.equal(replay.status, 409, 'the superseded revision is refused');
    assert.equal(replay.body.revision, afterMove, JSON.stringify(replay.body));

    // --- a request WITHOUT expectedRevision stays unconditional -----------
    const unconditional = await post('/move', { from: 'world/inn/key.md', to: 'player/key.md' });
    assert.equal(unconditional.status, 200, JSON.stringify(unconditional.body));

    // --- the guard is uniform: dice and use-item refuse stale too ---------
    const diceStale = await post('/dice', { path: 'world/inn/lock.md', expectedRevision: 0 });
    assert.equal(diceStale.status, 409, JSON.stringify(diceStale.body));
    assert.equal(diceStale.body.code, 'stale');
    const eventsAfterDiceStale = await store.getEventsSince(0);
    assert.equal(
      eventsAfterDiceStale.some((e) => e.type === 'roll_resolved'), false,
      'a refused roll lands no roll_resolved'
    );

    const useStale = await post('/use-item', {
      item: 'player/key.md', target: 'world/inn/lock.md', expectedRevision: 0,
    });
    assert.equal(useStale.status, 409, JSON.stringify(useStale.body));
    assert.equal(useStale.body.code, 'stale');

    const choiceStale = await post('/choice', { path: 'world/inn/piano.md', choice: 1, expectedRevision: 0 });
    assert.equal(choiceStale.status, 409, JSON.stringify(choiceStale.body));
    assert.equal(choiceStale.body.code, 'stale');

    const godStale = await post('/god-action', {
      action: 'create', path: 'world/inn/coin.md', content: '---\ntitle: Coin\n---\n', expectedRevision: 0,
    });
    assert.equal(godStale.status, 409, JSON.stringify(godStale.body));
    assert.equal(await store.statKind('world/inn/coin.md'), 'missing', 'a refused god create writes nothing');

    // --- a malformed expectedRevision is a 400, not a silent pass ---------
    const bad = await post('/move', { from: 'player/key.md', to: 'world/inn', expectedRevision: 'nope' });
    assert.equal(bad.status, 400, JSON.stringify(bad.body));
    assert.equal(bad.body.code, 'invalid_argument');

    // --- the matching-revision happy paths still work end to end ----------
    const current = await store.getMaxSeq();
    const diceOk = await post('/dice', { path: 'world/inn/lock.md', expectedRevision: current });
    assert.equal(diceOk.status, 200, JSON.stringify(diceOk.body));
    assert.equal(typeof diceOk.body.revision, 'number');

    const choiceOk = await post('/choice', {
      path: 'world/inn/piano.md', choice: 1, expectedRevision: await store.getMaxSeq(),
    });
    assert.equal(choiceOk.status, 200, JSON.stringify(choiceOk.body));
    assert.equal(choiceOk.body.choice, 'Open the lid');
  } finally {
    server.close();
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
