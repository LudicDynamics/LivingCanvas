/**
 * Closed worlds: a clock that runs down, endings
 * reached through the command engine, and "only conversation remains" after.
 *
 * Everything goes through the real action layer — rollDice / chooseOption →
 * runTriggeredCommands → `tick` / `end` → real files and real events — because
 * what matters is that the player's own clicks end the story, with no agent.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { LocalWorldStore, createActionService, reachedEnding, clockLeft, clockEndingHolds } from '../dist/index.js';
import '../dist/actions/roll-dice.js';
import '../dist/actions/choose.js';

const GOD = { type: 'god' };

async function world({ mode = 'closed', start = 3 } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-closed-'));
  const store = new LocalWorldStore(root);
  const write = (rel, text) => store.writeFile(rel, text);
  await write('world.json', JSON.stringify({
    id: 'w', name: 'W', description: '', author: '', genre: 'test', characters: [],
    mode,
    clock: { path: 'world/tide.md', key: 'left', start, label: 'Before the tide' },
    endings: [
      { id: 'exposed', title: 'Exposed', path: 'endings/exposed/README.md' },
      { id: 'lost', title: 'Lost', path: 'endings/lost/README.md', when: 'clock <= 0' },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }));
  await write('world/README.md', '---\nname: Harbour\ntype: readme\n---\n\n# Harbour\n');
  await write('world/tide.md', `---\nname: Tide\ntype: note\nstatus:\n  data:\n    left: ${start}\n---\n\nThe water is still low.\n`);
  await write('endings/exposed/README.md', '---\ntype: ending\ntitle: Exposed\n---\n\nThe decoy is named.\n');
  await write('endings/lost/README.md', '---\ntype: ending\ntitle: Lost\n---\n\nThe second ship is gone.\n');
  await write('command/tide-step.yaml', 'name: Tide rises\ndesc: One step of the clock\ndo:\n  - action: tick\n    with:\n      by: "-1"\n');
  await write('command/accuse.yaml', [
    'name: Accuse',
    'desc: Ends the story when the evidence is carried',
    'do:',
    '  - action: end',
    '    when: \'has("player/ledger.md")\'',
    '    with:',
    '      ending: exposed',
    '',
  ].join('\n'));
  for (let i = 1; i <= 5; i++) await write(`world/dice-${i}.md`, diceCard(i));
  await write('world/chart.md', [
    '---', 'name: Chart', 'type: note',
    'choice:', '  options:', '    - id: accuse', '      label: Accuse',
    'on:', '  choice_selected:', '    - run: accuse', '---', '', 'The harbour chart.', '',
  ].join('\n'));
  return { store, write };
}

function diceCard(i) {
  return [
    '---', `name: Search ${i}`, 'type: note',
    'roll_dice:', '  type: d100', '  expect: "1..100"',
    'on:', '  roll_resolved:', '    - run: tide-step',
    '---', '', 'Look around.', '',
  ].join('\n');
}

test('every roll moves the clock one step, and the card shows it', async () => {
  const { store } = await world({ start: 3 });
  const svc = createActionService(store, GOD, { turn: 'req:c1' });
  await svc.rollDice({ path: 'world/dice-1.md', forcedResult: 50 });
  assert.equal(await clockLeft(store), 2);
  assert.match(await store.readFile('world/tide.md'), /left: 2/);
  assert.equal(await reachedEnding(store), null);
});

test('running the clock out reaches the clock ending — once', async () => {
  const { store } = await world({ start: 2 });
  const svc = createActionService(store, GOD, { turn: 'req:c2' });
  await svc.rollDice({ path: 'world/dice-1.md', forcedResult: 50 });
  await svc.rollDice({ path: 'world/dice-2.md', forcedResult: 50 });
  assert.equal(await clockLeft(store), 0);
  assert.equal((await reachedEnding(store))?.id, 'lost');
  const events = await store.getEventsSince(0);
  const endings = events.filter((e) => e.type === 'ending_reached');
  assert.equal(endings.length, 1);
  assert.deepEqual(endings[0].detail, { ending: 'lost', title: 'Lost', path: 'endings/lost/README.md' });
});

test('after the ending only reading and talking remain', async () => {
  const { store } = await world({ start: 1 });
  const svc = createActionService(store, GOD, { turn: 'req:c3' });
  await svc.rollDice({ path: 'world/dice-1.md', forcedResult: 50 });
  assert.equal((await reachedEnding(store))?.id, 'lost');

  // The request that reached the ending may still finish its own bookkeeping
  // (a dice card writes its receipt and rewards after the roll returns).
  await svc.editEntity({ path: 'world/tide.md', frontmatter: { receipt: 'the roll that ended it' } });

  const later = createActionService(store, GOD, { turn: 'req:c3-later' });
  const refused = await later.rollDice({ path: 'world/dice-2.md', forcedResult: 50 }).catch((e) => e);
  assert.equal(refused.code, 'game_ended');
  assert.equal(refused.details.ending, 'lost');
  const edit = await later.editEntity({ path: 'world/tide.md', body: 'rewritten' }).catch((e) => e);
  assert.equal(edit.code, 'game_ended', 'the writer cannot keep playing either');
  // Reading still works.
  await later.lookAt({ path: 'world/tide.md' });
  // The clock did not move after the end.
  assert.equal(await clockLeft(store), 0);
});

test('the accusation ends the story only when the evidence is carried', async () => {
  const { store, write } = await world({ start: 5 });
  const svc = createActionService(store, GOD, { turn: 'req:c4' });
  const early = await svc.chooseOption({ path: 'world/chart.md', choice: 'accuse' });
  assert.equal(early.details.commands[0].status, 'ok');
  assert.equal(await reachedEnding(store), null, 'no evidence, no ending');
  // Same choice, same evidence: the first run is reused — a double click is not a second attempt.
  const again = await svc.chooseOption({ path: 'world/chart.md', choice: 'accuse' });
  assert.equal(again.details.commands[0].settleReport.reused.length, 1);

  await write('player/ledger.md', '---\nname: Ledger page\ntype: note\nportable: true\n---\n\nFigures.\n');
  const svc2 = createActionService(store, GOD, { turn: 'req:c4b' });
  await svc2.chooseOption({ path: 'world/chart.md', choice: 'accuse' });
  assert.equal((await reachedEnding(store))?.id, 'exposed');
});

test('an open world is never locked, and has no ending to reach', async () => {
  const { store } = await world({ mode: 'open', start: 1 });
  const svc = createActionService(store, GOD, { turn: 'req:c5' });
  await svc.rollDice({ path: 'world/dice-1.md', forcedResult: 50 });
  const r = await svc.rollDice({ path: 'world/dice-2.md', forcedResult: 50 });
  assert.equal(r.details.commands[0].status, 'ok', 'the clock still counts');
  assert.equal(await clockLeft(store), 0);
  assert.equal(await reachedEnding(store), null);
});

test('clock endings: the only grammar is `clock <op> <integer>`', () => {
  assert.equal(clockEndingHolds('clock <= 0', 0), true);
  assert.equal(clockEndingHolds('clock <= 0', 1), false);
  assert.equal(clockEndingHolds('clock == 3', 3), true);
  assert.equal(clockEndingHolds('clock > 2', 3), true);
  assert.equal(clockEndingHolds('time.day >= 7', 9), false, 'anything else never holds');
});

test('the clock as story time: steps spread evenly over the span, across midnight too', async () => {
  const { clockTimeOf } = await import('../dist/index.js');
  const train = { path: 'x', key: 'left', start: 9, label: 'Departure', time: { start: '01:10', end: '05:00' } };
  assert.deepEqual(clockTimeOf(train, 9), { now: '01:10', deadline: '05:00', remainingMinutes: 230, elapsedMinutes: 0 });
  assert.deepEqual(clockTimeOf(train, 0), { now: '05:00', deadline: '05:00', remainingMinutes: 0, elapsedMinutes: 230 });
  assert.equal(clockTimeOf(train, 8).now, '01:36', 'one step ≈ 25.6 minutes, rounded');
  const tide = { path: 'x', key: 'left', start: 8, label: 'Tide', time: { start: '23:00', end: '01:00' } };
  assert.deepEqual(clockTimeOf(tide, 4), { now: '00:00', deadline: '01:00', remainingMinutes: 60, elapsedMinutes: 60 });
  assert.equal(clockTimeOf({ ...tide, time: undefined }, 4), null, 'no span, no story time: the step count stays');
});
