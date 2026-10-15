import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { runDeclaredChoice, prepareMaterialReview } from '../apps/server/dist/engine/declared-actions.js';

const markdown = (frontmatter, body = '') => `---\n${frontmatter}\n---\n${body}`;
const revision = (text) => createHash('sha256').update(text).digest('hex');

function fixture() {
  const files = new Map([
    ['world/review.md', markdown('type: chalk\nchoice:\n  - id: review\n    label: Review\nchoice_actions:\n  review:\n    kind: stage\n    slots:\n      - id: evidence\n        title: Evidence\n        required: true\n        paths:\n          - player/evidence.md\n          - player/alternative.md\n      - id: plan\n        title: Plan\n        required: true\n        paths:\n          - player/plan.md', 'Review only.')],
    ['player/evidence.md', markdown('title: Evidence', 'A blue mark was observed.')],
    ['player/alternative.md', markdown('title: Alternative', 'A second record.')],
    ['player/plan.md', markdown('title: Plan', 'Wait at the courtyard.')],
  ]);
  let choices = 0;
  let moves = 0;
  const svc = {
    ctx: { store: {
      readFile: async (path) => {
        if (!files.has(path)) throw Object.assign(new Error('Missing file'), { code: 'ENOENT' });
        return files.get(path);
      },
      statKind: async (path) => files.has(path) ? 'file' : 'missing',
      getEventsSince: async () => [],
      getManifest: async () => ({ layers: { map: {} }, characters: [] }),
    } },
    chooseOption: async ({ path, choice }) => {
      choices++;
      return { text: 'chosen', details: { path, choice: String(choice) } };
    },
    moveEntity: async () => { moves++; return { details: {} }; },
  };
  return { files, svc, choices: () => choices, moves: () => moves };
}

async function stagedRequest(fixtureValue) {
  const staged = await runDeclaredChoice(fixtureValue.svc, 'world/review.md', 'Review');
  const action = staged.details.action;
  const selections = [
    { slot: 'evidence', path: 'player/evidence.md', revision: action.items.find((item) => item.path === 'player/evidence.md').revision },
    { slot: 'plan', path: 'player/plan.md', revision: action.items.find((item) => item.path === 'player/plan.md').revision },
  ];
  return { path: action.source, choice: action.choice, revision: action.revision, selections };
}

test('declared choice returns a validated action and records once', async () => {
  const f = fixture();
  const result = await runDeclaredChoice(f.svc, 'world/review.md', 'Review');
  assert.equal(result.details.action.kind, 'stage');
  assert.equal(result.details.action.source, 'world/review.md');
  assert.equal(f.choices(), 1);
  assert.equal(f.moves(), 0);
});

test('unsafe declared paths fail before choice accounting', async () => {
  const f = fixture();
  const source = markdown('type: chalk\nchoice:\n  - id: bad\n    label: Bad\nchoice_actions:\n  bad:\n    kind: read\n    paths:\n      - ../secrets.md');
  f.files.set('world/bad.md', source);
  await assert.rejects(() => runDeclaredChoice(f.svc, 'world/bad.md', 'Bad'), /world or player Markdown/);
  assert.equal(f.choices(), 0);
});

test('material review pins revisions, required slots, ownership and duplicates without side effects', async () => {
  const f = fixture();
  const request = await stagedRequest(f);
  const before = new Map(f.files);
  const reviewed = await prepareMaterialReview(f.svc, request);
  assert.match(reviewed.details.prompt, /A blue mark was observed/);
  assert.equal(reviewed.details.materials.length, 2);
  assert.equal(f.choices(), 1);
  assert.equal(f.moves(), 0);
  assert.deepEqual(f.files, before);

  await assert.rejects(() => prepareMaterialReview(f.svc, { ...request, revision: '0'.repeat(64) }), /declaration changed/);
  await assert.rejects(() => prepareMaterialReview(f.svc, { ...request, selections: [request.selections[0], request.selections[0]] }), /duplicated/);
  await assert.rejects(() => prepareMaterialReview(f.svc, { ...request, selections: [request.selections[0]] }), /required material slot/);
  await assert.rejects(() => prepareMaterialReview(f.svc, { ...request, selections: [{ ...request.selections[0], path: 'player/foreign.md' }, request.selections[1]] }), /duplicated/);
});

test('edited and oversized snapshots are rejected', async () => {
  const f = fixture();
  const request = await stagedRequest(f);
  f.files.set('player/evidence.md', markdown('title: Evidence', 'Changed evidence.'));
  await assert.rejects(() => prepareMaterialReview(f.svc, request), /Materials changed/);

  const huge = fixture();
  const hugeText = markdown('title: Evidence', 'x'.repeat(33000));
  huge.files.set('player/evidence.md', hugeText);
  const hugeRequest = await stagedRequest(huge);
  await assert.rejects(() => prepareMaterialReview(huge.svc, hugeRequest), /too long/);
});
