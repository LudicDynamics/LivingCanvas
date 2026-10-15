// GET /api/world/run — what the page shows for a closed world
//: the clock, then the ending with its epilogue.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { test } from 'node:test';
import { LocalWorldStore, createActionService } from '@airp/shared';
import { createClosedRunRouter } from '../dist/routes/closed-run.js';

async function serve(store) {
  const app = express();
  app.use('/api', createClosedRunRouter(() => store));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const get = async () => (await fetch(`http://127.0.0.1:${port}/api/world/run`)).json();
  return { get, close: () => new Promise((r) => server.close(r)) };
}

async function world(extra) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-run-route-'));
  const store = new LocalWorldStore(root);
  await store.writeFile('world.json', JSON.stringify({
    id: 'w', name: 'W', description: '', author: '', genre: 't', characters: [],
    createdAt: 'x', updatedAt: 'x', ...extra,
  }));
  await store.writeFile('world/README.md', '---\nname: M\ntype: readme\n---\n');
  return store;
}

test('an open world reports open, with no clock and no ending', async () => {
  const s = await serve(await world({}));
  try {
    const { moments, ...rest } = await s.get();
    assert.deepEqual(rest, { ok: true, mode: 'open', clock: null, ending: null, summary: null, debrief: null, cgs: [] });
    // The presentation facts are there in every mode: the root is where the run starts.
    assert.deepEqual(moments, { scenes: [{ layer: 'world', name: 'M', video: null, poster: null }], items: [] });
  } finally { await s.close(); }
});

test('a closed world reports its clock, then its ending with the epilogue', async () => {
  const store = await world({
    mode: 'closed',
    clock: { path: 'world/tide.md', key: 'left', start: 1, label: 'Before the tide' },
    endings: [
      { id: 'lost', title: 'Lost', path: 'endings/lost/README.md', when: 'clock <= 0' },
      { id: 'exposed', title: 'Exposed', path: 'endings/exposed/README.md' },
    ],
  });
  await store.writeFile('world/berth/README.md', '---\nname: Berth 7\ntype: gate\n---\n');
  await store.writeFile('world/lighthouse/README.md', '---\nname: Lighthouse\ntype: gate\n---\n');
  await store.writeFile('player/ledger.md', '---\nname: Ledger page\ntype: note\nportable: true\n---\n');
  await store.writeFile('world/tide.md', '---\nname: Tide\ntype: note\nstatus:\n  data:\n    left: 1\n---\n');
  await store.writeFile('endings/lost/README.md', '---\ntype: ending\ntitle: Lost\nbg: assets/scenes/fog.webp\n---\n\nThe ship is gone.\n\nThe tide came in.\n');
  await store.writeFile('command/tide-step.yaml', 'name: T\ndesc: d\ndo:\n  - action: tick\n    with:\n      by: "-1"\n');
  await store.writeFile('world/dice.md', '---\nname: D\ntype: note\nroll_dice:\n  type: d100\n  expect: "1..100"\non:\n  roll_resolved:\n    - run: tide-step\n---\n\nx\n');
  const s = await serve(store);
  try {
    const before = await s.get();
    assert.deepEqual(before.clock, { label: 'Before the tide', left: 1, start: 1 });
    assert.equal(before.ending, null);
    assert.equal(before.summary, null, 'no settlement before the end');

    await createActionService(store, { type: 'god' }, { turn: 'req:r' }).rollDice({ path: 'world/dice.md', forcedResult: 5 });
    const after = await s.get();
    assert.equal(after.clock.left, 0);
    assert.deepEqual(after.ending, {
      id: 'lost',
      title: 'Lost',
      body: 'The ship is gone.\n\nThe tide came in.',
      bg: 'assets/scenes/fog.webp',
    });
    const sum = after.summary;
    assert.deepEqual(sum.steps, { used: 1, start: 1 });
    assert.equal(sum.rolls.length, 1);
    assert.equal(sum.rolls[0].result, 5);
    assert.deepEqual(sum.clues, [{ path: 'player/ledger.md', name: 'Ledger page' }]);
    // Places never entered and endings never reached come without a name.
    assert.deepEqual(sum.places, [
      { layer: 'world/berth', name: null, visited: false },
      { layer: 'world/lighthouse', name: null, visited: false },
    ]);
    assert.deepEqual(sum.endings, [
      { id: 'lost', title: 'Lost', reached: true },
      { id: 'exposed', title: null, reached: false },
    ]);
    assert.ok(sum.startedAt && sum.endedAt);
  } finally { await s.close(); }
});

// the design notes: the epilogue's gallery reads the CGs the save has seen.
test('after an ending the run lists the CGs this save has shown (cg_log), and none before it', async () => {
  const { runEffect } = await import('@airp/shared');
  const store = await world({
    mode: 'semi',
    endings: [{ id: 'dawn', title: 'Dawn', path: 'endings/dawn/README.md' }],
  });
  await store.writeFile('endings/dawn/README.md', '---\ntype: ending\ntitle: Dawn\n---\n\nMorning.\n');
  await store.writeFile('assets/cg/fire.webp', 'x');
  await store.writeFile('assets/cg/dawn.webp', 'x');
  const ctx = createActionService(store, { type: 'god' }, { turn: 'req:cg' }).ctx;
  await runEffect(ctx, { action: 'show_cg', path: 'assets/cg/fire.webp', caption: 'Fire' });
  await runEffect(ctx, { action: 'show_cg', path: 'assets/cg/dawn.webp' });
  const s = await serve(store);
  try {
    assert.deepEqual((await s.get()).cgs, []);
    await runEffect(ctx, { action: 'end', ending: 'dawn' });
    assert.deepEqual((await s.get()).cgs, [{ path: 'assets/cg/fire.webp', caption: 'Fire' }, { path: 'assets/cg/dawn.webp' }]);
  } finally { await s.close(); }
});

// the design notes: the two presentations read these facts back from the save.
test('moments: scenes in first-entry order with their pictures, stubs skipped, revisits once; the bag with art and a summary', async () => {
  const store = await world({});
  await store.writeFile('world/morgue/README.md', '---\nname: Morgue\ntype: gate\nbg: assets/bg/morgue.webp\nbgVideo: assets/motion/morgue.webm\n---\n');
  await store.writeFile('world/press/README.md', '---\nname: Press\ntype: gate\nbg: assets/motion/press.mp4\n---\n');
  const svc = createActionService(store, { type: 'player' }, { turn: 'req:p' });
  const s = await serve(store);
  try {
    await svc.enterLayer({ layer: 'world/press' });
    await svc.enterLayer({ layer: 'world/ghost' }); // a stub: not a scene yet
    await svc.enterLayer({ layer: 'world/morgue' });
    await svc.enterLayer({ layer: 'world/press' });
    await store.writeFile('player/receipt.md', '---\ntitle: Delivery receipt\ntype: note\nimage: assets/items/receipt.webp\nsecret: x\n---\n\n# Receipt\n\nThe picture reached   the shop at 5:40.\n\nMore.\n');
    const { moments } = await s.get();
    assert.deepEqual(moments.scenes, [
      { layer: 'world', name: 'M', video: null, poster: null },
      { layer: 'world/press', name: 'Press', video: 'assets/motion/press.mp4', poster: null },
      { layer: 'world/morgue', name: 'Morgue', video: 'assets/motion/morgue.webm', poster: 'assets/bg/morgue.webp' },
    ]);
    assert.deepEqual(moments.items, [{
      path: 'player/receipt.md',
      filename: 'receipt.md',
      name: 'Delivery receipt',
      frontmatter: { image: 'assets/items/receipt.webp', type: 'note' },
      summary: 'The picture reached the shop at 5:40.',
    }]);
    assert.equal(JSON.stringify(moments).includes('count'), false);
  } finally { await s.close(); }
});
