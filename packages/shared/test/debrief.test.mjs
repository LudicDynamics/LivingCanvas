// The 复盘 / debrief: schema, the evidence rule,
// thresholds, what the page and the writer may see, and endings in `semi` worlds.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  WorldMysterySchema,
  WorldManifestSchema,
  scoreDebrief,
  debriefTier,
  debriefCluePaths,
  clueCandidates,
  normalizeDebriefAnswers,
  publicMysteries,
  debriefWriterNote,
  LocalWorldStore,
  createActionService,
  reachedEnding,
  modeHasEndings,
  endWorld,
  proofOf,
} from '../dist/index.js';

const M = (id, extra = {}) => ({
  id,
  question: `Q ${id}?`,
  options: [
    { id: 'plain', label: 'Plain truth', tier: 'surface', clues: [`world/${id}/find.md`], epilogue: `E ${id}` },
    { id: 'deep', label: 'Deeper truth', tier: 'hidden', clues: [`world/${id}/rare.md`], title: `Hidden ${id}`, epilogue: `H ${id}` },
    { id: 'no', label: 'Distractor', tier: 'wrong' },
  ],
  ...extra,
});
const MYSTERIES = ['a', 'b', 'c', 'd'].map((id) => WorldMysterySchema.parse(M(id)));
const RECKONING = { epilogues: { all: 'ALL', most: 'MOST', few: 'FEW' } };

test('schema: a mystery needs a surface and a wrong answer; right answers need clues and epilogues; hidden needs a title', () => {
  assert.ok(WorldMysterySchema.safeParse(M('a')).success);
  const bad = (options) => WorldMysterySchema.safeParse({ id: 'x', question: 'q', options }).success;
  const wrong = { id: 'w', label: 'w', tier: 'wrong' };
  const w2 = { id: 'w2', label: 'w', tier: 'wrong' };
  assert.equal(bad([wrong, w2, { id: 'h', label: 'h', tier: 'hidden', clues: ['world/x.md'], title: 't', epilogue: 'e' }]), false, 'no surface');
  assert.equal(bad([{ id: 's', label: 's', tier: 'surface', clues: ['world/x.md'], epilogue: 'e' }, { id: 's2', label: 's', tier: 'surface', clues: ['world/y.md'], epilogue: 'e' }, { id: 's3', label: 's', tier: 'surface', clues: ['world/z.md'], epilogue: 'e' }]), false, 'no wrong');
  assert.equal(bad([{ id: 's', label: 's', tier: 'surface', clues: [], epilogue: 'e' }, wrong, w2]), false, 'surface without clues');
  assert.equal(bad([{ id: 's', label: 's', tier: 'surface', clues: ['world/x.md'] }, wrong, w2]), false, 'surface without epilogue');
  assert.equal(bad([{ id: 's', label: 's', tier: 'surface', clues: ['world/x.md'], epilogue: 'e' }, { id: 'h', label: 'h', tier: 'hidden', clues: ['world/y.md'], epilogue: 'e' }, wrong]), false, 'hidden without title');
  assert.equal(bad([{ id: 's', label: 's', tier: 'surface', clues: ['world/x.md'], epilogue: 'e' }, wrong, { ...wrong }]), false, 'duplicate option id');
  assert.equal(bad([{ id: 's', label: 's', tier: 'surface', clues: ['world/../x.md'], epilogue: 'e' }, wrong, w2]), false, 'no ".." in a clue');
  assert.equal(bad([{ id: 's', label: 's', tier: 'surface', clues: ['world/x.md'], epilogue: 'e' }, wrong]), false, 'at least three options');
  const manifest = WorldManifestSchema.parse({ id: 'w', name: 'w', description: '', author: '', genre: 'g', createdAt: 'x', updatedAt: 'x', mysteries: [M('a'), M('b'), M('c')], reckoning: RECKONING });
  assert.equal(manifest.mysteries.length, 3);
  assert.equal(manifest.reckoning.epilogues.few, 'FEW');
});

test('evidence rule: right needs one of the answer’s clues in the save — in place or carried under the same name', () => {
  assert.deepEqual(clueCandidates('world/a/find.md'), ['world/a/find.md', 'player/find.md']);
  assert.deepEqual(clueCandidates('player/tea-bill.md'), ['player/tea-bill.md']);
  const answers = { a: 'plain', b: 'deep', c: 'plain', d: 'no' };
  const none = scoreDebrief(MYSTERIES, answers, new Set());
  assert.deepEqual(none.mysteries.map((m) => m.verdict), ['guessed', 'guessed', 'guessed', 'wrong']);
  assert.equal(none.unlocked, 0);
  assert.equal(none.mysteries[0].epilogue, undefined, 'a guess unlocks no epilogue');

  const present = new Set(['world/a/find.md', 'player/rare.md', 'world/c/rare.md']);
  const r = scoreDebrief(MYSTERIES, answers, present, RECKONING);
  assert.deepEqual(r.mysteries.map((m) => m.verdict), ['surface', 'hidden', 'guessed', 'wrong'], 'c: the plain answer needs ITS clue, not the hidden one’s');
  assert.equal(r.surface, 1);
  assert.equal(r.hidden, 1);
  assert.equal(r.unlocked, 2);
  assert.equal(r.tier, 'most');
  assert.equal(r.epilogue, 'MOST');
  assert.equal(r.mysteries[1].title, 'Hidden b');
  assert.equal(r.mysteries[1].epilogue, 'H b');
  assert.equal(r.mysteries[0].epilogue, 'E a');
  // The finale names the clue that proved each unlocked secret (§5.1); a guess or a wrong answer names none.
  assert.equal(r.mysteries[0].proof, 'world/a/find.md');
  assert.equal(r.mysteries[1].proof, 'player/rare.md');
  assert.equal(r.mysteries[2].proof, undefined);
  assert.equal(r.mysteries[3].proof, undefined);
  assert.equal(none.mysteries[0].proof, undefined);
});

test('proofOf: the first present save path, declared order, in place before carried; null when none', () => {
  assert.equal(proofOf(['world/a/find.md'], new Set(['player/find.md'])), 'player/find.md');
  assert.equal(proofOf(['world/a/find.md'], new Set(['world/a/find.md', 'player/find.md'])), 'world/a/find.md');
  assert.equal(proofOf(['world/x.md', 'world/y.md'], new Set(['world/y.md'])), 'world/y.md');
  assert.equal(proofOf(['world/x.md'], new Set()), null);
});

test('unanswered mysteries count as not unlocked; thresholds all / most (≥ half) / few', () => {
  const r = scoreDebrief(MYSTERIES, { a: 'plain' }, new Set(['world/a/find.md']), RECKONING);
  assert.deepEqual(r.mysteries.map((m) => m.verdict), ['surface', 'unanswered', 'unanswered', 'unanswered']);
  assert.equal(r.tier, 'few');
  assert.equal(debriefTier(4, 4), 'all');
  assert.equal(debriefTier(2, 4), 'most');
  assert.equal(debriefTier(1, 4), 'few');
  assert.equal(debriefTier(2, 3), 'most');
  assert.equal(debriefTier(1, 3), 'few');
  assert.equal(debriefTier(0, 3), 'few');
  assert.equal(debriefTier(0, 0), 'few');
  assert.equal(scoreDebrief(MYSTERIES, {}, new Set()).epilogue, null, 'no reckoning, no tiered epilogue');
});

test('answers are validated against the world; the page and the writer never see the key', () => {
  assert.deepEqual(normalizeDebriefAnswers({ a: 'plain', b: '' }, MYSTERIES), { ok: true, answers: { a: 'plain' } });
  assert.equal(normalizeDebriefAnswers({ z: 'plain' }, MYSTERIES).ok, false);
  assert.equal(normalizeDebriefAnswers({ a: 'nope' }, MYSTERIES).ok, false);
  assert.equal(normalizeDebriefAnswers([], MYSTERIES).ok, false);
  const shown = JSON.stringify(publicMysteries(MYSTERIES));
  for (const secret of ['surface', 'hidden', 'wrong', 'find.md', 'E a', 'Hidden a']) assert.ok(!shown.includes(secret), secret);
  assert.ok(debriefCluePaths(MYSTERIES).includes('player/rare.md'));
  for (const locale of ['en', 'zh-CN', 'ja']) {
    const note = debriefWriterNote(MYSTERIES, locale);
    assert.ok(note.includes('Q a?'), 'the writer knows the questions');
    for (const secret of ['Plain truth', 'Deeper truth', 'E a', 'find.md']) assert.ok(!note.includes(secret), `${locale}: ${secret}`);
  }
  assert.equal(debriefWriterNote(undefined), '');
});

test('a semi world (endings, no clock) ends through `end` and then only conversation remains', async () => {
  assert.equal(modeHasEndings('semi'), true);
  assert.equal(modeHasEndings('closed'), true);
  assert.equal(modeHasEndings('open'), false);
  assert.equal(modeHasEndings(undefined), false);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'semi-'));
  const store = new LocalWorldStore(root);
  await store.writeFile('world.json', JSON.stringify({
    id: 'w', name: 'W', description: '', author: '', genre: 'g', characters: [], createdAt: 'x', updatedAt: 'x',
    mode: 'semi', endings: [{ id: 'caught', title: 'Caught', path: 'endings/caught/README.md' }],
  }));
  await store.writeFile('world/README.md', '---\nname: M\ntype: readme\n---\n');
  await store.writeFile('world/note.md', '---\ntype: note\ntitle: N\n---\n\nx\n');
  assert.equal(await reachedEnding(store), null);
  const { ending, fresh } = await endWorld({ store, actor: { type: 'god' }, turn: 'req:t' }, 'caught');
  assert.equal(ending.id, 'caught');
  assert.equal(fresh, true);
  assert.equal((await reachedEnding(store))?.id, 'caught');
  const svc = createActionService(store, { type: 'player' }, { turn: 'req:u' });
  await assert.rejects(svc.editEntity({ path: 'world/note.md', body: 'y' }), /ended/i);
});
