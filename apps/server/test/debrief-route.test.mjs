// POST /api/world/debrief: the 复盘 after an ending.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { test } from 'node:test';
import { LocalWorldStore } from '@airp/shared';
import { createClosedRunRouter } from '../dist/routes/closed-run.js';

const mystery = (id) => ({
  id,
  question: `Who ${id}?`,
  options: [
    { id: 'right', label: 'Right', tier: 'surface', clues: [`world/${id}.md`], epilogue: `after ${id}` },
    { id: 'deeper', label: 'Deeper', tier: 'hidden', clues: [`world/${id}-rare.md`], title: `Secret ${id}`, epilogue: `hidden ${id}` },
    { id: 'wrong', label: 'Wrong', tier: 'wrong' },
  ],
});

async function serve(ended) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-debrief-'));
  const store = new LocalWorldStore(root);
  await store.writeFile('world.json', JSON.stringify({
    id: 'w', name: 'W', description: '', author: '', genre: 't', characters: [], createdAt: 'x', updatedAt: 'x',
    mode: 'semi',
    endings: [{ id: 'caught', title: 'Caught', path: 'endings/caught/README.md' }],
    mysteries: [mystery('a'), mystery('b'), mystery('c')],
    reckoning: { epilogues: { all: 'ALL', most: 'MOST', few: 'FEW' } },
  }));
  await store.writeFile('world/README.md', `---\nname: M\ntype: readme\n${ended ? 'status:\n  data:\n    ending: caught\n' : ''}---\n\nHello.\n`);
  await store.writeFile('endings/caught/README.md', '---\ntype: ending\ntitle: Caught\n---\n\nDone.\n');
  const app = express();
  app.use(express.json());
  app.use('/api', createClosedRunRouter(() => store));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const post = async (body) => {
    const res = await fetch(`${base}/world/debrief`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  const get = async () => (await fetch(`${base}/world/run`)).json();
  return { store, post, get, close: () => new Promise((r) => server.close(r)) };
}

test('no debrief before the ending', async () => {
  const s = await serve(false);
  try {
    assert.equal((await s.get()).debrief, null);
    const r = await s.post({ answers: { a: 'right' } });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'not_ended');
  } finally { await s.close(); }
});

test('after the ending: answer once, scored by the evidence rule, stored in the save', async () => {
  const s = await serve(true);
  try {
    const before = await s.get();
    assert.equal(before.ending.id, 'caught');
    assert.deepEqual(before.debrief.mysteries[0], { id: 'a', question: 'Who a?', options: [{ id: 'right', label: 'Right' }, { id: 'deeper', label: 'Deeper' }, { id: 'wrong', label: 'Wrong' }] });
    assert.equal(before.debrief.result, null);

    assert.equal((await s.post({ answers: { z: 'right' } })).status, 400);
    assert.equal((await s.post({ answers: 'a' })).status, 400);

    await s.store.writeFile('player/a-rare.md', '---\ntype: note\ntitle: rare\n---\n\nx\n');
    await s.store.writeFile('world/c.md', '---\ntype: note\ntitle: c\n---\n\nx\n');
    const r = await s.post({ answers: { a: 'deeper', b: 'right', c: 'right' } });
    assert.equal(r.status, 200);
    const result = r.body.debrief.result;
    assert.deepEqual(result.mysteries.map((m) => m.verdict), ['hidden', 'guessed', 'surface']);
    assert.equal(result.unlocked, 2);
    assert.equal(result.hidden, 1);
    assert.equal(result.tier, 'most');
    assert.equal(result.epilogue, 'MOST');
    assert.equal(r.body.ending.id, 'caught', 'the ending is untouched');

    // Evidence is fixed at submission: a clue appearing later changes nothing.
    await s.store.writeFile('world/b.md', '---\ntype: note\ntitle: b\n---\n\nx\n');
    assert.deepEqual((await s.get()).debrief.result, result);
    const again = await s.post({ answers: { a: 'right' } });
    assert.equal(again.status, 409);
    assert.equal(again.body.code, 'already_answered');
    assert.match(await s.store.readFile('world/README.md'), /debrief:/);
    assert.match(await s.store.readFile('world/README.md'), /Hello\./, 'the page body survives');
  } finally { await s.close(); }
});

test('the finale (§5.1): each unlocked secret names the clue that proved it; the summary counts the player’s moves', async () => {
  const s = await serve(true);
  try {
    // Two player moves, one writer move, then the ending; a move after the ending does not count.
    const move = (layer, type = 'player') => ({ type: 'layer_entered', actor: { type }, detail: { layer, name: layer, first: true } });
    await s.store.appendEvent(move('world/x'));
    await s.store.appendEvent(move('world/y', 'writer'));
    await s.store.appendEvent(move('world/y'));
    await s.store.appendEvent({ type: 'ending_reached', actor: { type: 'engine' }, detail: { ending: 'caught', title: 'Caught', path: 'endings/caught/README.md' } });
    await s.store.appendEvent(move('world/z'));
    assert.equal((await s.get()).summary.turns, 2);

    await s.store.writeFile('player/a-rare.md', '---\ntype: note\nname: The rare page\n---\n\nx\n');
    await s.store.writeFile('world/c.md', '---\ntype: note\n---\n\nx\n');
    const r = await s.post({ answers: { a: 'deeper', b: 'right', c: 'right' } });
    const [a, b, c] = r.body.debrief.result.mysteries;
    assert.equal(a.proof, 'player/a-rare.md', 'carried: the bag copy proved it');
    assert.equal(a.proofName, 'The rare page');
    assert.equal(b.proof, undefined, 'a guess has no proof');
    assert.equal(b.proofName, undefined);
    assert.equal(c.proof, 'world/c.md');
    assert.equal(c.proofName, 'c', 'a card without a name falls back to its file name');
    assert.deepEqual((await s.get()).debrief.result, r.body.debrief.result, 'the read names the same proofs');
  } finally { await s.close(); }
});
