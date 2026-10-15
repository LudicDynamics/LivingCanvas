import { test } from 'node:test';
import assert from 'node:assert/strict';
import { md } from './experiences/common.mjs';
import { runDeclaredChoice, prepareMaterialReview } from '../apps/server/dist/engine/declared-actions.js';

function fixture() {
  const files = new Map([
    ['world/review.md', md({ type: 'chalk', choice: { options: [{ id: 'review', label: 'Review materials' }] }, choice_actions: { review: { kind: 'stage', slots: [
      { id: 'evidence', title: 'Evidence', required: true, paths: ['player/evidence.md', 'player/alternative.md'] },
      { id: 'plan', title: 'Plan', required: true, paths: ['player/plan.md'] },
    ] } } }, 'Prepare materials; this does not execute the plan.')],
    ['player/evidence.md', md({ title: 'Evidence' }, 'A blue mark was observed.')],
    ['player/alternative.md', md({ title: 'Alternative' }, 'A second record.')],
    ['player/plan.md', md({ title: 'Plan' }, 'Wait at the courtyard.')],
  ]);
  let choices = 0;
  const svc = { ctx: { store: {
    readFile: async p => { if (!files.has(p)) throw new Error('Missing file'); return files.get(p); },
    statKind: async p => files.has(p) ? 'file' : 'missing', getEventsSince: async () => [],
  } }, chooseOption: async () => { choices++; return { details: {} }; } };
  return { files, svc, choices: () => choices };
}
async function requestFor(f) {
  const { details: { action } } = await runDeclaredChoice(f.svc, 'world/review.md', 'review');
  return { path: action.source, choice: action.choice, revision: action.revision,
    selections: [['evidence', 'player/evidence.md'], ['plan', 'player/plan.md']].map(([slot, path]) => ({ slot, path, revision: action.items.find(i => i.path === path).revision })) };
}

test('multi-slot staging and review do not execute or move; draft pins exact material bodies', async () => {
  const f = fixture(); const request = await requestFor(f); const before = new Map(f.files);
  const result = await prepareMaterialReview(f.svc, request);
  assert.match(result.details.prompt, /A blue mark was observed/);
  assert.match(result.details.prompt, /Do not move or consume items/);
  assert.equal(result.details.materials.length, 2);
  assert.equal(f.choices(), 1, 'draft validation does not record a second selection');
  assert.deepEqual(f.files, before);
});
test('missing required slot is rejected; material selection does not judge reasoning', async () => {
  const f = fixture(); const request = await requestFor(f); request.selections.pop();
  await assert.rejects(() => prepareMaterialReview(f.svc, request), /required material slot/);
});
test('a material edited after the panel opened is rejected', async () => {
  const f = fixture(); const request = await requestFor(f); f.files.set('player/evidence.md', 'Changed evidence');
  await assert.rejects(() => prepareMaterialReview(f.svc, request), /Materials changed/);
});
test('deleted materials and foreign paths cannot enter a review', async () => {
  const f = fixture(); const request = await requestFor(f); f.files.delete('player/plan.md');
  await assert.rejects(() => prepareMaterialReview(f.svc, request), /Materials changed/);
  request.selections[0].path = 'characters/private/README.md';
  await assert.rejects(() => prepareMaterialReview(f.svc, request), /Materials changed/);
});
test('changed source declaration invalidates the panel', async () => {
  const f = fixture(); const request = await requestFor(f); f.files.set('world/review.md', f.files.get('world/review.md') + '\nChanged rules');
  await assert.rejects(() => prepareMaterialReview(f.svc, request), /declaration changed/);
});
test('duplicate slots cannot bypass required material validation', async () => {
  const f = fixture(); const request = await requestFor(f); request.selections = [request.selections[0], request.selections[0]];
  await assert.rejects(() => prepareMaterialReview(f.svc, request), /duplicated/);
});
test('an allowed alternative is accepted with its own version', async () => {
  const f = fixture(); const request = await requestFor(f);
  const result = await runDeclaredChoice(f.svc, request.path, request.choice, true);
  const item = result.details.action.items.find(i => i.path === 'player/alternative.md');
  request.selections[0] = { slot: 'evidence', path: item.path, revision: item.revision };
  assert.match((await prepareMaterialReview(f.svc, request)).details.prompt, /A second record/);
});
test('one evidence slot accepts multiple files alongside an independent plan slot', async () => {
  const f = fixture(); const request = await requestFor(f); const before = new Map(f.files);
  const { details: { action } } = await runDeclaredChoice(f.svc, request.path, request.choice, true);
  const item = action.items.find(i => i.path === 'player/alternative.md');
  request.selections.push({ slot: 'evidence', path: item.path, revision: item.revision });
  const result = await prepareMaterialReview(f.svc, request);
  assert.equal(result.details.materials.length, 3);
  assert.equal(result.details.materials.filter(i => i.slot === 'evidence').length, 2);
  assert.match(result.details.prompt, /A blue mark/);
  assert.match(result.details.prompt, /A second record/);
  assert.deepEqual(f.files, before);
});
test('explicit single-item capacity is still enforced', async () => {
  const f = fixture();
  f.files.set('world/review.md', md({ type: 'chalk', choice: { options: [{ id: 'review', label: 'Review' }] }, choice_actions: { review: { kind: 'stage', slots: [{ id: 'evidence', title: 'Evidence', maxItems: 1, paths: ['player/evidence.md', 'player/alternative.md'] }] } } }, 'Review'));
  const { details: { action } } = await runDeclaredChoice(f.svc, 'world/review.md', 'review');
  await assert.rejects(() => prepareMaterialReview(f.svc, { path: action.source, choice: action.choice, revision: action.revision,
    selections: action.items.map(i => ({ slot: 'evidence', path: i.path, revision: i.revision })) }), /Too many materials/);
});
