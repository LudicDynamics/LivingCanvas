// The ending card's conditional passages (src/actions/ending-text.ts), the hint that points only at done options
// (src/rules/hints.ts spentHintIds), and the tick prompt's style-only voice (src/rules/tick-model.ts) —
// the 末班车 playtest fixes of 2026-10-13.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { LocalWorldStore, composeEndingText, endingTextOf, parseEndingPassages, parseHintTable, planHint, spentHintIds, buildTickModelRequest } from '../dist/index.js';

test('passages: body first, then each that holds; a group reads only its first match; no `when` = always / fallback', () => {
  const { passages, errors } = parseEndingPassages({
    passages: [
      { group: 'a', when: 'A', text: 'a1' },
      { group: 'a', when: 'B', text: 'a2' },
      { group: 'a', text: 'a-else' },
      { text: 'always' },
      { when: 'B', text: 'b-only' },
    ],
  });
  assert.deepEqual(errors, []);
  assert.equal(composeEndingText('Body.', passages, (w) => w === 'B'), 'Body.\n\na2\n\nalways\n\nb-only');
  assert.equal(composeEndingText('Body.', passages, () => false), 'Body.\n\na-else\n\nalways');
  assert.equal(composeEndingText('Body.', passages, () => true), 'Body.\n\na1\n\nalways\n\nb-only');
  assert.deepEqual(parseEndingPassages({ passages: [{ text: '' }, { text: 'x', group: 'Bad Id' }, 'no'] }).errors.length, 3);
  assert.deepEqual(parseEndingPassages({}).passages, []);
});

test('endingTextOf: conditions read the save (has(), player.x); a malformed `when` hides its passage', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ending-text-'));
  await fs.mkdir(path.join(root, 'endings', 'found'), { recursive: true });
  await fs.mkdir(path.join(root, 'player'), { recursive: true });
  await fs.writeFile(path.join(root, 'world.json'), JSON.stringify({ id: 'e', name: 'E', version: '1.0.0', schema: 1, mode: 'closed' }));
  await fs.writeFile(path.join(root, 'player', 'README.md'), '---\ntype: player\nstates:\n  - id: hp\n    type: number\n    initial: 3\n    hidden: true\n---\n\nYou.\n');
  await fs.writeFile(path.join(root, 'endings', 'found', 'README.md'), [
    '---', 'type: ending', 'title: Found', 'bg: assets/x.webp', 'passages:',
    '  - group: log', '    when: \'has("player/page.md")\'', '    text: With the page.',
    '  - group: log', '    text: Without the page.',
    '  - when: \'player.hp <= 0\'', '    text: Hurt.',
    '  - when: \'has(\'', '    text: Never.',
    '---', '', 'They called back.', '',
  ].join('\n'));
  const store = new LocalWorldStore(root);
  assert.deepEqual(await endingTextOf(store, 'endings/found/README.md'), { body: 'They called back.\n\nWithout the page.', bg: 'assets/x.webp' });
  await fs.writeFile(path.join(root, 'player', 'page.md'), '---\ntype: note\n---\n\nThe page.\n');
  assert.equal((await endingTextOf(store, 'endings/found/README.md')).body, 'They called back.\n\nWith the page.');
  assert.deepEqual(await endingTextOf(store, 'endings/missing/README.md'), { body: '', bg: null });
});

test('hints: one whose suggestions are all done is passed over (not used up); `enter` slips are never spent', () => {
  const { table } = parseHintTable({
    hints: [
      { id: 'coat', when: { layer: 'world/sleeper' }, say: 'Look at the coat?', suggest: [{ card: 'world/sleeper/README.md', option: 'read-coat' }], priority: 60 },
      { id: 'go', when: { layer: 'world/sleeper' }, say: 'Move on?', suggest: [{ enter: 'map', label: 'Back' }], priority: 50 },
    ],
  });
  const spent = spentHintIds(table, (card, option) => card === 'world/sleeper/README.md' && option === 'read-coat');
  assert.deepEqual([...spent], ['coat']);
  const state = { page: 'world/sleeper', values: new Map(), paths: new Map(), characterIds: [] };
  const prior = { beat: 0, used: {}, since: {}, seen: [] };
  assert.equal(planHint(table, state, prior).hint.id, 'coat');
  const plan = planHint(table, state, prior, { spent });
  assert.equal(plan.hint.id, 'go');
  assert.equal(plan.log.used.coat, undefined, 'a spent hint is not marked as said');
});

test('tick prompt: voice samples are style only; the place and the person\'s own earlier lines are named', () => {
  const req = buildTickModelRequest('seed', {
    kind: 'chatter', beat: 3, locale: 'zh-CN', actor: 'xia-cheng', name: '夏澄', about: '列车员',
    prompt: { goal: 'g', temper: 't', voice: ['我拿手电往过道里照照。'], prefer: [], avoid: [], may: ['say'], neverSay: [], prompt: '' },
    page: 'Place: 1车 · 驾驶室', recent: [], said: ['我拿手电往过道里照照。'],
    options: [{ id: 'chat', verb: 'speak', about: '', label: 'say one line' }],
    allow: { say: true, note: false, invite: false }, allowedNames: [], knownNames: [], peopleNames: [], deny: [],
  });
  assert.match(req.user, /^How you talk: 「我拿手电往过道里照照。」$/m, 'the samples line keeps its shape (stub and tests read it)');
  assert.match(req.user, /Style examples only/);
  assert.match(req.user, /## You already said[^\n]*\n- 我拿手电往过道里照照。/);
  assert.match(req.system, /fit the place/);
});
