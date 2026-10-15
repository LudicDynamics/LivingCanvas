/**
 * Dice consequences: a declared band cost lands
 * at roll time; the writer pays a tier with dice_consequence (bounded); a
 * 大失败 / 大成功 left unpaid when the writer's turn ends gets the world's
 * default; story / free worlds are never enforced.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { LocalWorldStore, createActionService, parseFrontmatter, ActionError, clockLeft } from '../dist/index.js';

const GOD = { type: 'god' };
const WRITER = { type: 'writer' };

async function world({ category = 'trpg', clock = true, dice } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-tiers-'));
  const store = new LocalWorldStore(root);
  const write = (rel, text) => store.writeFile(rel, text);
  await write('world.json', JSON.stringify({
    id: 'w', name: 'W', description: '', author: '', genre: 'test', characters: [], locale: 'zh-CN',
    intro: { category },
    ...(clock ? { clock: { path: 'world/tide.md', key: 'left', start: 8, label: '潮水' } } : {}),
    ...(dice ? { dice } : {}),
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  }));
  await write('world/README.md', '---\nname: Harbour\ntype: readme\n---\n\n# Harbour\n');
  if (clock) await write('world/tide.md', '---\nname: Tide\ntype: note\nstatus:\n  data:\n    left: 6\n---\n\nLow water.\n');
  await write('player/README.md', [
    '---', 'type: readme', 'title: You', 'states:', '  - id: hp', '    label: 伤势', '    type: number', '    initial: 10', '    range: [0, 10]', '---', '', 'You.', '',
  ].join('\n'));
  await write('world/lock.md', '---\ntype: chalk\ntitle: The lock\nroll_dice:\n  type: 2d10\n  desc: Pick the lock\n  expect: ">=11"\n---\n\nA rusted lock.\n');
  await write('world/door.md', [
    '---', 'type: chalk', 'title: The door', 'roll_dice:', '  type: 2d10', '  desc: Force the door', '  expect: ">=11"',
    'dice_outcomes:',
    '  - { min: 2, max: 4, text: Snap., options: [{ id: n, label: n, action: { kind: writer, prompt: x } }], cost: { clock: -2 } }',
    '  - { min: 5, max: 10, text: Stuck., options: [{ id: n, label: n, action: { kind: writer, prompt: x } }], cost: { clock: -1 } }',
    '  - { min: 11, max: 17, text: Open., options: [{ id: n, label: n, action: { kind: writer, prompt: x } }] }',
    '  - { min: 18, max: 20, text: Fast., options: [{ id: n, label: n, action: { kind: writer, prompt: x } }], bonus: { clock: 1 } }',
    '---', '', 'A door.', '',
  ].join('\n'));
  return { store };
}

const fm = async (store, p) => parseFrontmatter(await store.readFile(p)).frontmatter;

test('a 大失败 roll records a pending cost; the writer pays it within bounds', async () => {
  const { store } = await world();
  const r = await createActionService(store, GOD).rollDice({ path: 'world/lock.md', forcedResult: 3 });
  assert.equal(r.details.outcome, 'crit_fail');
  assert.equal(r.details.consequence.status, 'pending');
  assert.deepEqual((await fm(store, 'world/lock.md')).dice_consequence, { outcome: 'crit_fail', due: 'cost', applied: [] });
  const writer = createActionService(store, WRITER);
  await assert.rejects(() => writer.diceConsequence({ path: 'world/lock.md', effect: { clock: 1 } }), (e) => e instanceof ActionError && /never a bonus/.test(e.message));
  const paid = await writer.diceConsequence({ path: 'world/lock.md', effect: { state: { target: 'player', id: 'hp', by: -2 } } });
  assert.equal(paid.details.status, 'applied');
  assert.equal(paid.details.applied[0].what, '伤势 −2');
  assert.equal((await fm(store, 'player/README.md')).status.data.hp, 8);
  // Paid: the turn-end settle leaves it alone.
  const settled = await createActionService(store, { type: 'engine' }).settleDiceConsequences({});
  assert.equal(settled.details.settled.length, 0);
  store.close();
});

test('the writer skips a 大失败 → the engine applies the world default (clock −1) and records by: default', async () => {
  const { store } = await world();
  await createActionService(store, GOD).rollDice({ path: 'world/lock.md', forcedResult: 2 });
  const s = await createActionService(store, { type: 'engine' }).settleDiceConsequences({});
  assert.equal(s.details.settled.length, 1);
  assert.equal(s.details.settled[0].applied.by, 'default');
  assert.equal(s.details.settled[0].applied.what, '潮水 −1');
  assert.equal(await clockLeft(store), 5);
  const rec = (await fm(store, 'world/lock.md')).dice_consequence;
  assert.equal(rec.applied[0].by, 'default');
  // Once paid, a second settle does nothing.
  assert.equal((await createActionService(store, { type: 'engine' }).settleDiceConsequences({})).details.settled.length, 0);
  store.close();
});

test('a 大成功 left unpaid gets the default bonus (clock +1, capped at start)', async () => {
  const { store } = await world();
  await createActionService(store, GOD).rollDice({ path: 'world/lock.md', forcedResult: 19 });
  const s = await createActionService(store, { type: 'engine' }).settleDiceConsequences({});
  assert.equal(s.details.settled[0].outcome, 'crit_success');
  assert.equal(await clockLeft(store), 7);
  store.close();
});

test('falls through the chain: no clock → light harm on hp', async () => {
  const { store } = await world({ clock: false });
  await createActionService(store, GOD).rollDice({ path: 'world/lock.md', forcedResult: 2 });
  await createActionService(store, { type: 'engine' }).settleDiceConsequences({});
  assert.ok((await fm(store, 'player/README.md')).status.data.hp < 10);
  store.close();
});

test('a player roll during the writer\'s turn waits for the next turn end', async () => {
  const { store } = await world();
  const before = (await store.getMaxSeq()) + 1;
  await createActionService(store, { type: 'player' }, { rng: () => 0 }).rollDice({ path: 'world/lock.md' }); // 1+1 = 2 → crit_fail
  const s = await createActionService(store, { type: 'engine' }).settleDiceConsequences({ rollsBeforeSeq: before });
  assert.equal(s.details.settled.length, 0);
  const next = await createActionService(store, { type: 'engine' }).settleDiceConsequences({ rollsBeforeSeq: (await store.getMaxSeq()) + 1 });
  assert.equal(next.details.settled.length, 1);
  store.close();
});

test('a band\'s declared cost / bonus lands at roll time and settles the tier', async () => {
  const { store } = await world();
  const r = await createActionService(store, GOD).rollDice({ path: 'world/door.md', forcedResult: 3 });
  assert.equal(r.details.consequence.status, 'applied');
  assert.equal(await clockLeft(store), 4);
  assert.equal((await createActionService(store, { type: 'engine' }).settleDiceConsequences({})).details.settled.length, 0);
  store.close();
  const w2 = await world();
  await createActionService(w2.store, GOD).rollDice({ path: 'world/door.md', forcedResult: 19 });
  assert.equal(await clockLeft(w2.store), 7);
  w2.store.close();
});

test('a story world shows the tier but owes nothing; dice_consequence is refused', async () => {
  const { store } = await world({ category: 'story', clock: false });
  const r = await createActionService(store, GOD).rollDice({ path: 'world/lock.md', forcedResult: 2 });
  assert.equal(r.details.outcome, 'crit_fail');
  assert.equal(r.details.consequence.status, 'none');
  assert.equal((await fm(store, 'world/lock.md')).dice_consequence, undefined);
  await assert.rejects(() => createActionService(store, WRITER).diceConsequence({ path: 'world/lock.md', effect: { complication: 'x' } }), (e) => e instanceof ActionError && e.code === 'unsupported');
  assert.equal((await createActionService(store, { type: 'engine' }).settleDiceConsequences({})).details.settled.length, 0);
  assert.equal((await fm(store, 'player/README.md')).status, undefined);
  store.close();
});

test('a success owes nothing: dice_consequence refuses it', async () => {
  const { store } = await world();
  await createActionService(store, GOD).rollDice({ path: 'world/lock.md', forcedResult: 12 });
  await assert.rejects(() => createActionService(store, WRITER).diceConsequence({ path: 'world/lock.md', effect: { clock: -1 } }), /owes no extra/);
  store.close();
});
