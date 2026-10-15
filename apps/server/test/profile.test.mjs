// The 个人页面's server half (profile-saves.ts, sync/profile-data.ts, routes/profile.ts;
// the design notes) against temp save roots and a FAKE chronicle + billing.
// Runs against built dist (`pnpm --filter @airp/server build`).
//
// Pinned:
//   - saves are read from files only: the ending this save reached (title), never the
//     titles of the others; the 复盘's unlocked count; the CGs shown; the declared gallery
//     counts only pictures that exist; workshop drafts; non-saves and hidden dirs skipped;
//   - /profile/cg serves a CG the save has SHOWN and nothing else (unseen, traversal → 404);
//   - /profile/account: signed out = "not available"; chronicle + billing mapped; billing
//     down = ledger null; more entries than one read = complete: false;
//   - /profile/ending: one batch (playthrough.ensure + ending.reached) with the account's
//     token; bad ids 400; localhost + header only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import express from 'express';

import { createProfileRouter } from '../dist/routes/profile.js';
import { readProfileSaves } from '../dist/profile-saves.js';

const TOKEN = 'tok-profile-0123456789';

async function write(file, body) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, body);
}

async function saveRoot(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-profile-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const prev = process.env.AIRP_WORLDS_ROOT;
  process.env.AIRP_WORLDS_ROOT = root;
  t.after(() => { if (prev === undefined) delete process.env.AIRP_WORLDS_ROOT; else process.env.AIRP_WORLDS_ROOT = prev; });
  // a closed world that ended, was debriefed and showed a CG
  const wc = path.join(root, 'whitechapel-zh-abc');
  await write(path.join(wc, 'world.json'), JSON.stringify({
    id: 'whitechapel-zh', name: '白教堂', locale: 'zh-CN', mode: 'closed',
    endings: [{ id: 'caught', title: '抓住了他', path: 'endings/caught.md' }, { id: 'dawn', title: '黎明的秘密', path: 'endings/dawn.md' }],
    mysteries: [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }],
  }));
  await write(path.join(wc, 'world/README.md'), [
    '---',
    'status:',
    '  data:',
    '    ending: caught',
    '    endingTurn: req-1',
    '    debrief:',
    '      answers: { m1: a }',
    '      evidence: []',
    '      unlocked: [m1, m2]',
    '      at: "2026-10-01T10:00:00.000Z"',
    'cg_log:',
    '  - path: assets/cg/fire.webp',
    '    caption: 客栈起火了',
    '    turn: req-0',
    '    at: "2026-10-01T09:00:00.000Z"',
    'art:',
    '  cg:',
    '    - { id: fire, path: assets/cg/fire.webp, prompt: x }',
    '    - { id: well, path: assets/cg/well.webp, prompt: y }',
    '    - { id: gone, path: assets/cg/not-made.webp, prompt: z }',
    '---',
    '# 白教堂',
  ].join('\n'));
  await write(path.join(wc, 'assets/cg/fire.webp'), 'RIFF....WEBPVP8 fake');
  await write(path.join(wc, 'assets/cg/well.webp'), 'RIFF....WEBPVP8 fake');
  // an open world, played, no ending
  await write(path.join(root, 'first-snow-1/world.json'), JSON.stringify({ id: 'first-snow', name: 'First Snow', locale: 'en' }));
  // a workshop draft
  await write(path.join(root, 'my-world/world.json'), JSON.stringify({ id: 'my-world', name: '我的世界', workshop: { status: 'draft', owner: 'local', createdAt: '2026-10-02T00:00:00.000Z' } }));
  // not saves
  await write(path.join(root, '.trash/x/world.json'), JSON.stringify({ id: 'x' }));
  await fs.mkdir(path.join(root, 'empty-dir'), { recursive: true });
  return root;
}

function fakeServices() {
  const state = { calls: [], batches: [], billingDown: false, morePages: false };
  const send = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    let raw = '';
    for await (const c of req) raw += c;
    state.calls.push({ method: req.method, path: url.pathname, search: url.search, auth: req.headers.authorization ?? null });
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(res, 401, { error: 'unauthorized' });
    if (url.pathname === '/v1/me/playthroughs') {
      return send(res, 200, { next_cursor: null, playthroughs: [
        { id: 'p1', product: 'livingcanvas', save_id: 'whitechapel-zh-abc', world_ref: 'livingcanvas/world/whitechapel-zh', status: 'active', started_at: '2026-10-01T08:00:00.000Z', last_played_at: '2026-10-01T10:00:00.000Z', last_turn_at: '2026-10-01T09:55:00.000Z', meta: { world_title: '白教堂' }, counts: { runs_committed: 31, play_seconds: 0 }, endings: [{ ending_id: 'caught', title: '抓住了他', kind: null, reached_at: '2026-10-01T09:58:00.000Z' }] },
        { id: 'p2', product: 'livingcanvas', save_id: 'other-device-save', world_ref: 'builtin:legacy', status: 'active', started_at: null, counts: { runs_committed: 2 }, endings: [] },
        { id: 'p3', product: 'livingcanvas', world_ref: 'livingcanvas/world/x' },
      ] });
    }
    if (url.pathname === '/v1/me/endings') return send(res, 200, { endings: [{ product: 'livingcanvas', world_ref: 'livingcanvas/world/whitechapel-zh', ending_id: 'caught', title: '抓住了他', first_reached_at: '2026-10-01T09:58:00.000Z', times: 2 }] });
    if (url.pathname === '/v1/me/summary') return send(res, 200, { products: [{ product: 'airp', playthroughs: 9 }, { product: 'livingcanvas', playthroughs: 2, runs: 40, turns: 33, play_seconds: 0, days_played: 2, endings: 1, first_played_at: '2026-10-01T08:00:00.000Z' }] });
    if (url.pathname === '/v1/me/history') {
      if (state.billingDown) return send(res, 503, { error: 'down' });
      const page = url.searchParams.get('cursor') ? Number(url.searchParams.get('cursor')) : 0;
      return send(res, 200, {
        entries: [
          { kind: 'spend', delta_mc: -1500, occurred_at: `2026-10-0${2 - Math.min(page, 1)}T03:00:00.000Z`, ref_type: 'request', ref_id: `req_${page}` },
          { kind: 'grant', delta_mc: 50000, occurred_at: '2026-10-01T00:00:00.000Z', ref_type: 'claim', ref_id: 'daily:2026-10-01' },
          { kind: 'spend', delta_mc: -1 },
        ],
        next_cursor: state.morePages ? String(page + 1) : null,
      });
    }
    if (url.pathname === '/v1/events:batch' && req.method === 'POST') { state.batches.push(JSON.parse(raw)); return send(res, 200, { results: [] }); }
    return send(res, 404, { error: 'not_found' });
  });
  return { server, state };
}

async function listen(server) {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${server.address().port}`;
}

async function stack(t, { token = async () => TOKEN } = {}) {
  const svc = fakeServices();
  const base = await listen(svc.server);
  t.after(() => svc.server.close());
  const ENVS = { AIRP_CHRONICLE_BASE: base, AIRP_BILLING_BASE: base, AIRP_DATA_BASE: base };
  const saved = Object.fromEntries(Object.keys(ENVS).map((k) => [k, process.env[k]]));
  Object.assign(process.env, ENVS);
  t.after(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
  const app = express();
  app.use(express.json());
  app.use('/api', createProfileRouter('/nonexistent-repo', { token }));
  const server = http.createServer(app);
  const local = await listen(server);
  t.after(() => server.close());
  const texts = [];
  const page = async (method, rel, body, headers = {}) => {
    const res = await fetch(`${local}/api${rel}`, { method, headers: body === undefined ? headers : { 'content-type': 'application/json', 'x-airp-settings': '1', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const buf = Buffer.from(await res.arrayBuffer());
    const text = buf.toString('utf8');
    texts.push(text);
    let json = null;
    try { json = JSON.parse(text); } catch { /* a file */ }
    return { status: res.status, body: json, text, type: res.headers.get('content-type') };
  };
  return { svc, page, texts };
}

test('saves: endings, 复盘, CGs and workshop read from files, without spoiling the other endings', async (t) => {
  await saveRoot(t);
  const saves = await readProfileSaves('/nonexistent-repo');
  assert.deepEqual(saves.map((s) => s.saveId).sort(), ['first-snow-1', 'my-world', 'whitechapel-zh-abc']);
  const wc = saves.find((s) => s.saveId === 'whitechapel-zh-abc');
  assert.equal(wc.manifestId, 'whitechapel-zh');
  assert.equal(wc.mode, 'closed');
  assert.equal(wc.endingsTotal, 2);
  assert.deepEqual([wc.ending.id, wc.ending.title], ['caught', '抓住了他']);
  assert.ok(wc.ending.at <= '2026-10-01T10:00:00.000Z', 'the ending is no later than the debrief');
  assert.deepEqual(wc.debrief, { unlocked: 2, total: 3, at: '2026-10-01T10:00:00.000Z' });
  assert.deepEqual(wc.cgs, [{ path: 'assets/cg/fire.webp', caption: '客栈起火了', at: '2026-10-01T09:00:00.000Z' }]);
  assert.equal(wc.cgTotal, 2, 'a declared CG whose picture was never made does not count');
  assert.ok(!JSON.stringify(saves).includes('黎明的秘密'), 'an ending not reached keeps its title');
  const fs1 = saves.find((s) => s.saveId === 'first-snow-1');
  assert.deepEqual([fs1.mode, fs1.ending, fs1.debrief, fs1.cgs, fs1.workshop], ['open', null, null, [], null]);
  assert.deepEqual(saves.find((s) => s.saveId === 'my-world').workshop, { status: 'draft', owner: 'local', createdAt: '2026-10-02T00:00:00.000Z', publishedAt: null });
});

test('/profile/cg serves only a CG the save has shown', async (t) => {
  await saveRoot(t);
  const s = await stack(t);
  const ok = await s.page('GET', '/profile/cg?save=whitechapel-zh-abc&path=assets/cg/fire.webp');
  assert.equal(ok.status, 200);
  assert.match(ok.type, /image\/webp/);
  for (const q of ['save=whitechapel-zh-abc&path=assets/cg/well.webp', 'save=whitechapel-zh-abc&path=../first-snow-1/world.json', 'save=../x&path=assets/cg/fire.webp', 'save=first-snow-1&path=assets/cg/fire.webp']) {
    assert.equal((await s.page('GET', `/profile/cg?${q}`)).status, 404, q);
  }
  const listed = await s.page('GET', '/profile/saves');
  assert.equal(listed.body.ok, true);
  assert.equal(listed.body.saves.length, 3);
});

test('/profile/account: signed out is "not available"; chronicle and the wallet mapped; billing down → no ledger', async (t) => {
  const out = await stack(t, { token: async () => null });
  assert.deepEqual((await out.page('GET', '/profile/account')).body, { ok: false, available: false, reason: 'signed_out' });

  const s = await stack(t);
  const a = (await s.page('GET', '/profile/account')).body;
  assert.equal(a.available, true);
  const acc = a.account;
  assert.equal(acc.playthroughs.length, 2, 'a playthrough without a save id is dropped');
  assert.deepEqual(acc.playthroughs[0], {
    saveId: 'whitechapel-zh-abc', worldRef: 'whitechapel-zh', worldTitle: '白教堂', startedAt: '2026-10-01T08:00:00.000Z', lastTurnAt: '2026-10-01T09:55:00.000Z', lastPlayedAt: '2026-10-01T10:00:00.000Z', turns: 31, playSeconds: 0,
    endings: [{ id: 'caught', title: '抓住了他', at: '2026-10-01T09:58:00.000Z' }],
  });
  assert.equal(acc.playthroughs[1].worldRef, null, 'a non-livingcanvas ref has no edition');
  assert.deepEqual(acc.endings, [{ worldRef: 'whitechapel-zh', id: 'caught', title: '抓住了他', firstAt: '2026-10-01T09:58:00.000Z', times: 2 }]);
  assert.deepEqual(acc.summary, { playthroughs: 2, turns: 33, playSeconds: 0, endings: 1, daysPlayed: 2, firstPlayedAt: '2026-10-01T08:00:00.000Z' });
  assert.deepEqual(acc.ledger, { complete: true, entries: [
    { at: '2026-10-02T03:00:00.000Z', credits: -1.5, kind: 'spend', ref: 'request:req_0' },
    { at: '2026-10-01T00:00:00.000Z', credits: 50, kind: 'grant', ref: 'claim:daily:2026-10-01' },
  ] });
  assert.ok(s.svc.state.calls.every((c) => c.auth === `Bearer ${TOKEN}`));
  assert.ok(s.svc.state.calls.some((c) => c.path === '/v1/me/history' && c.search.includes('product=livingcanvas')));
  assert.ok(!s.texts.join('').includes(TOKEN), 'the page never sees the token');

  s.svc.state.morePages = true;
  const more = (await s.page('GET', '/profile/account')).body.account.ledger;
  assert.equal(more.complete, false);
  assert.equal(more.entries.length, 10, 'five reads of the wallet at most');
  s.svc.state.billingDown = true;
  assert.equal((await s.page('GET', '/profile/account')).body.account.ledger, null);
});

test('/profile/ending: ensure + ending.reached in one batch; bad ids 400; localhost + header only', async (t) => {
  const s = await stack(t);
  const r = await s.page('POST', '/profile/ending', { saveId: 'whitechapel-zh-abc', worldRef: 'whitechapel-zh', worldName: '白教堂', endingId: 'caught', title: '抓住了他' });
  assert.deepEqual(r.body, { ok: true, available: true, reported: true });
  const [batch] = s.svc.state.batches;
  assert.equal(batch.product, 'livingcanvas');
  assert.deepEqual(batch.events.map((e) => e.type), ['playthrough.ensure', 'ending.reached']);
  assert.deepEqual([batch.events[0].world_ref, batch.events[0].meta.world_title, batch.events[1].ending_id, batch.events[1].title, batch.events[1].save_id], ['livingcanvas/world/whitechapel-zh', '白教堂', 'caught', '抓住了他', 'whitechapel-zh-abc']);
  assert.equal((await s.page('POST', '/profile/ending', { saveId: '../x', worldRef: 'w', endingId: 'e' })).status, 400);
  assert.equal((await s.page('POST', '/profile/ending', { saveId: 'a', worldRef: 'w' })).status, 400);
  const noHeader = await s.page('POST', '/profile/ending', undefined);
  assert.equal(noHeader.status, 403);
  const proxied = await s.page('GET', '/profile/account', undefined, { 'x-forwarded-for': '1.2.3.4' });
  assert.equal(proxied.status, 403);
});
