// Is an option done?: the pure rule, and the
// save's answer that GET /api/layer and look_at share.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  LocalWorldStore,
  createActionService,
  buildInteractiveFields,
  optionDone,
  optionStatesOf,
  stringifyFrontmatter,
} from '../dist/index.js';

const SPOT = {
  id: 'drawer', label: 'Search the drawer', title: 'Rummage', body: 'Roll.',
  roll_dice: { type: '2d10', desc: 'Rummage', expect: '>=11' },
  dice_outcomes: [[2, 10], [11, 20]].map(([min, max]) => ({ min, max, text: `band ${min}` })),
};
const README = {
  type: 'gate', name: 'Study', search: [SPOT],
  choice: { options: [
    { id: 'take-letter', label: 'Take the letter' },
    { id: 'search', label: 'Search the drawer' },
    { id: 'go', label: 'Back to the hall' },
    { id: 'duel', label: 'Stop him (roll)' },
    { id: 'look', label: 'Look out of the window', once: true },
    { id: 'ask', label: 'Who wrote it?', to: 'hans' },
  ] },
  choice_actions: {
    'take-letter': { kind: 'take', paths: ['world/study/letter.md'] },
    search: { kind: 'search', spot: 'drawer' },
    go: { kind: 'enter', target: 'map' },
    duel: { kind: 'read', paths: ['world/study/duel.md'] },
  },
};

function tmpWorld() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'airp-option-state-'));
  fs.mkdirSync(path.join(root, 'world', 'study'), { recursive: true });
  fs.writeFileSync(path.join(root, 'world.json'), JSON.stringify({
    id: 'option-state', name: 'Options', version: '1.0.0', schema: 1, description: 'd', author: 'a', genre: 'mystery',
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  }));
  fs.writeFileSync(path.join(root, 'world', 'README.md'), '---\ntype: readme\nname: Root\n---\n\nRoot.\n');
  fs.writeFileSync(path.join(root, 'world', 'study', 'README.md'), stringifyFrontmatter(README, 'A study.'));
  fs.writeFileSync(path.join(root, 'world', 'study', 'letter.md'), stringifyFrontmatter({ type: 'note', title: 'A letter' }, 'Dear…'));
  fs.writeFileSync(path.join(root, 'world', 'study', 'duel.md'), stringifyFrontmatter({ type: 'chalk', title: 'Stop him', roll_dice: { type: '2d10', desc: 'Stop him', expect: '>=11' } }, 'Roll.'));
  return root;
}
const readmeCard = (store) => store.readFile('world/study/README.md').then(() => ({ path: 'world/study/README.md', frontmatter: README }));
const stateOf = async (store) => (await optionStatesOf(store, [await readmeCard(store)]))['world/study/README.md'] ?? { done: [], used: [] };

test('choice options keep once / repeat; both → repeat wins, with a note', () => {
  const errors = [];
  const choice = buildInteractiveFields({ choice: { options: [
    { id: 'a', label: 'A', once: true }, { id: 'b', label: 'B', repeat: true }, { id: 'c', label: 'C', once: true, repeat: true }, { id: 'd', label: 'D', once: 'yes' },
  ] } }, errors).choice;
  assert.deepEqual(choice.options.map((o) => [o.id, o.once ?? false, o.repeat ?? false]), [['a', true, false], ['b', false, true], ['c', false, true], ['d', false, false]]);
  assert.equal(errors.length, 2, errors.join('\n'));
});

test('optionDone (pure): take / search / read-a-dice-card / line / once / repeat; doors and talks never', () => {
  const facts = (over = {}) => ({ onDisk: () => true, rolled: () => false, chosen: () => false, ...over });
  const opt = (id) => buildInteractiveFields(README).choice.options.find((o) => o.id === id);
  const done = (id, f, fm = README) => optionDone('world/study/README.md', fm, opt(id), facts(f));
  assert.equal(done('take-letter', {}), null);
  assert.equal(done('take-letter', { onDisk: () => false }), 'taken');
  assert.equal(done('take-letter', { onDisk: () => null }), null, 'not known: it stays');
  assert.equal(done('search', { rolled: (p) => p === 'world/study/search-drawer.md' }), 'searched');
  assert.equal(done('duel', { rolled: (p) => p === 'world/study/duel.md' }), 'rolled');
  assert.equal(done('go', { chosen: () => true }), null, 'navigation is repeatable');
  assert.equal(done('look', { chosen: () => true }), 'once');
  assert.equal(done('ask', { chosen: () => true }), 'said');
  const repeat = { ...README, choice: { options: [{ id: 'take-letter', label: 'Take', repeat: true }] } };
  assert.equal(optionDone('world/study/README.md', repeat, { id: 'take-letter', label: 'Take', repeat: true }, facts({ onDisk: () => false })), null);
});

test('optionStatesOf: the save answers — taken, searched (rolled, then cleared away), a rolled dice card, once, used', async () => {
  const root = tmpWorld();
  const store = new LocalWorldStore(root);
  const svc = createActionService(store, { type: 'player' }, { turn: 'test:option-state' });
  assert.deepEqual(await stateOf(store), { done: [], used: [] });

  await svc.moveEntity({ from: 'world/study/letter.md', to: 'player/letter.md' });
  assert.deepEqual((await stateOf(store)).done, ['take-letter']);

  await svc.searchPlace({ layer: 'world/study', spot: 'drawer' });
  assert.ok(!(await stateOf(store)).done.includes('search'), 'the chalk stands unrolled: still on offer');
  await svc.rollDice({ path: 'world/study/search-drawer.md' });
  assert.ok((await stateOf(store)).done.includes('search'), 'rolled: done');
  fs.rmSync(path.join(root, 'world/study/search-drawer.md'));
  assert.ok((await stateOf(store)).done.includes('search'), 'searched this loop and cleared away: still done');

  await svc.rollDice({ path: 'world/study/duel.md' });
  assert.ok((await stateOf(store)).done.includes('duel'));

  await svc.chooseOption({ path: 'world/study/README.md', choice: 'look' });
  await svc.chooseOption({ path: 'world/study/README.md', choice: 'go' });
  const after = await stateOf(store);
  assert.ok(after.done.includes('look'), 'once: gone after one use');
  assert.ok(!after.done.includes('go') && after.used.includes('go'), 'a door stays, used');

  const seen = await svc.lookAt({ path: 'world/study/README.md' });
  assert.match(seen.text, /Take the letter \(done — no longer offered\)/, 'the writer sees what the page hides');
  assert.match(seen.text, /Back to the hall\n/, 'a door is never marked');
});
