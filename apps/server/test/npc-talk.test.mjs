// POST /api/npc/talk: one player line → one reply in
// the NPC's voice, recorded on the card; a give runs the card's declared option.
// Runs against a copy of the last-train template, so it also exercises the
// shipped NPC cards.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { test } from 'node:test';
import { LocalWorldStore, parseFrontmatter } from '@airp/shared';
import { createNpcRouter } from '../dist/routes/npc.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const TEMPLATE = path.join(REPO, 'templates/last-train-zh');

async function serve(answer) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-npc-'));
  await fs.cp(TEMPLATE, root, { recursive: true });
  const store = new LocalWorldStore(root);
  const prompts = [];
  const app = express();
  app.use(express.json());
  app.use('/api', createNpcRouter({
    getStore: () => store,
    askWriter: async (_root, prompt) => { prompts.push(prompt); return typeof answer === 'function' ? answer(prompt, prompts.length) : answer; },
  }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const talk = async (body) => {
    const res = await fetch(`${base}/npc/talk`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  const card = async (p) => parseFrontmatter(await store.readFile(p)).frontmatter;
  return { root, store, prompts, talk, card, close: () => new Promise((r) => server.close(r)) };
}

test('a line and its answer are recorded on the card and survive a fresh read', async () => {
  const s = await serve('老贺：「那桌是一位老先生和一个姑娘。」');
  try {
    const r = await s.talk({ path: 'world/dining-car/lao-he.md', message: '4号桌坐的是谁？' });
    assert.equal(r.status, 200);
    assert.equal(r.body.reply, '那桌是一位老先生和一个姑娘。');
    assert.deepEqual(r.body.dialogue.map((d) => d.by), ['player', 'npc']);
    // "Reload": a new store over the same directory reads the exchange back.
    const fm = parseFrontmatter(await new LocalWorldStore(s.root).readFile('world/dining-car/lao-he.md')).frontmatter;
    assert.deepEqual(fm.dialogue.map((d) => d.text), ['4号桌坐的是谁？', '那桌是一位老先生和一个姑娘。']);
    // The next brief carries the history.
    await s.talk({ path: 'world/dining-car/lao-he.md', message: '然后呢？' });
    assert.match(s.prompts[1], /Player: 4号桌坐的是谁？/);
  } finally { await s.close(); }
});

test('the brief holds only what the NPC knows — never the key in the coal bin', async () => {
  const s = await serve('我睡着了。');
  try {
    await s.talk({ path: 'world/dining-car/lao-he.md', message: '钥匙在哪？' });
    const brief = s.prompts[0];
    assert.match(brief, /白色细渣/, 'two-teacups.md is known');
    assert.doesNotMatch(brief, /煤斗/, 'the dice find is not');
    assert.match(brief, /Simplified Chinese/);
    assert.match(brief, /老贺 has nothing to hand over/);
  } finally { await s.close(); }
});

test('a witness knows his declared find before the roll, without it being created', async () => {
  const s = await serve('我没看清他的脸。');
  try {
    await s.talk({ path: 'world/seated-car/zhou-zihang.md', message: '你看见什么了？' });
    assert.match(s.prompts[0], /灰呢大衣/);
    assert.equal(await s.store.statKind('world/seated-car/witness-account.md'), 'missing');
  } finally { await s.close(); }
});

test('苏禾 can hand over her words through the declared option — and never the logbook', async () => {
  const s = await serve((_p, n) => (n === 1 ? '日志……给你。[give: logbook-page]' : '你拿着吧，我说的都在这儿。\n[give: take-testimony]'));
  try {
    const first = await s.talk({ path: 'world/freight-car/su-he.md', message: '日志页给我' });
    assert.equal(first.status, 200);
    assert.deepEqual(first.body.gives, []);
    assert.equal(await s.store.statKind('world/freight-car/logbook-page.md'), 'missing');
    assert.doesNotMatch(s.prompts[0], /红灯放行/);

    const second = await s.talk({ path: 'world/freight-car/su-he.md', message: '把你记得的告诉我' });
    assert.deepEqual(second.body.gives.map((g) => g.id), ['take-testimony']);
    assert.equal(await s.store.statKind('player/su-he-testimony.md'), 'file');
    assert.deepEqual((await s.card('world/freight-car/su-he.md')).given, ['take-testimony']);
    // Once given, never offered again; the moved card is still what she knows.
    await s.talk({ path: 'world/freight-car/su-he.md', message: '还有吗？' });
    assert.match(s.prompts[2], /苏禾 has nothing to hand over/);
    assert.match(s.prompts[2], /茶很苦/);
  } finally { await s.close(); }
});

test('bad requests and a silent writer', async () => {
  const s = await serve('   ');
  try {
    assert.equal((await s.talk({ path: 'world/dining-car/lao-he.md', message: '' })).status, 400);
    assert.equal((await s.talk({ path: 'world/nowhere.md', message: 'hi' })).status, 404);
    assert.equal((await s.talk({ path: 'world/dining-car/tea-bill.md', message: 'hi' })).status, 400);
    assert.equal((await s.talk({ path: '../etc/passwd', message: 'hi' })).status, 400);
    const silent = await s.talk({ path: 'world/cab/lao-qin.md', message: 'hi' });
    assert.equal(silent.status, 502);
    // The player's line was said, and is kept.
    assert.deepEqual((await s.card('world/cab/lao-qin.md')).dialogue.map((d) => d.by), ['player']);
  } finally { await s.close(); }
});

test('no world, no talk', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', createNpcRouter({ getStore: () => null, askWriter: async () => 'x' }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/npc/talk`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(res.status, 409);
  } finally { await new Promise((r) => server.close(r)); }
});
