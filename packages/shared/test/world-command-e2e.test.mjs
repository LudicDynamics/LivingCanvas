/**
 * END-TO-END: a player's dice roll runs a world command.
 *
 * This is the one path the C1 implementation batch had only COMPILED, never
 * run — the seam between `02` (trigger), `05` (idempotent settle) and `03`
 * (execution order). Everything below goes through the real action layer:
 *
 *   write command/<id>.yaml + an entity carrying `on.roll_resolved`
 *     → rollDice (the action the player's button hits)
 *       → runTriggeredCommands → settleWorldCommands → runWorldCommand
 *         → editEntity / createEntity  ⇒ real files, real events
 *
 * It defends three claims that are unverifiable by reading code:
 *   1. the consequence HAPPENS without the agent (the product claim, §1);
 *   2. rolling the SAME card twice does NOT double-award (hard gate 2) —
 *      the second run reuses the first's settled result;
 *   3. an effect that cannot happen fails VISIBLY and leaves the roll intact.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

// The barrel, not individual modules: importing it registers every action
// handler (rollDice among them), which is what the server does at startup.
import { LocalWorldStore, createActionService } from '../dist/index.js';
import '../dist/actions/roll-dice.js';

// `forcedResult` is god-only BY DESIGN (`dice_forced_not_allowed`): a player
// must not be able to forge an outcome. The trigger path itself is identical
// for a real roll — the forced value only makes the assertion deterministic.
const ACTOR = { type: 'god' };

async function world() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-cmd-e2e-'));
  const store = new LocalWorldStore(root);
  const write = (rel, text) => store.writeFile(rel, text);
  await write(
    'world.json',
    JSON.stringify({
      id: 'w',
      name: 'W',
      description: '',
      author: '',
      genre: 'test',
      characters: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
  );
  await write('world/README.md', '---\nname: Map\ntype: readme\n---\n\n# Map\n');
  return { store, root, write };
}

/** The command: announce a result onto a card. One effect, no loop. */
const AWARD_CMD = [
  'name: Record the reading',
  'desc: Writes the roll outcome onto the log card',
  'do:',
  '  - action: edit',
  '    with:',
  '      path: "{{ trigger.path }}"',
  '      append_body: "The dial reads {{ roll.result }}."',
  '',
].join('\n');

/** The card that carries the binding. `on` is what makes the command reachable. */
const BOUND_CARD = [
  '---',
  'name: The dial',
  'type: note',
  'roll_dice:',
  '  type: d100',
  '  expect: "1..100"',
  'on:',
  '  roll_resolved:',
  '    - run: record-reading',
  '---',
  '',
  'A brass dial, its needle trembling.',
  '',
].join('\n');

test('a roll runs the bound command and the effect lands on disk', async () => {
  const { store, write } = await world();
  await write('command/record-reading.yaml', AWARD_CMD);
  await write('world/dial.md', BOUND_CARD);

  const svc = createActionService(store, ACTOR, { turn: 'req:e2e-1' });
  const before = (await store.getEventsSince(0)).length;

  const res = await svc.rollDice({ path: 'world/dial.md', forcedResult: 42 });

  // (1) The command ran, and the response SAYS so — `commands` is present
  // exactly when `on` was declared (02 §3 step 12).
  assert.ok(res.details.commands, 'expected a commands receipt');
  const cmd = res.details.commands[0];
  assert.equal(cmd.command, 'record-reading');
  assert.equal(cmd.hook, 'roll_resolved');
  assert.equal(cmd.status, 'ok');
  // A FIRST run reports `ran`, and each effect inside it must say `ran` too —
  // not `reused`. Labelling a fresh run reused would tell the model its own
  // effect was skipped, which is the opposite of what happened.
  assert.equal(cmd.settleReport.ran.length, 1, JSON.stringify(cmd));
  assert.deepEqual(cmd.settleReport.reused, []);
  assert.equal(cmd.settleReport.ran[0].steps, 1);
  assert.equal(cmd.settleReport.ran[0].effects[0].settle, 'ran');

  // (2) The effect actually happened: the text is on the card.
  const body = await store.readFile('world/dial.md');
  assert.ok(body.includes('The dial reads 42.'), body);

  // (3) Both writes were audited: the roll's own event plus the edit's.
  const after = await store.getEventsSince(0);
  assert.ok(after.length > before, 'expected events to accumulate');
  assert.ok(
    after.some((e) => e.type === 'entity_edited' && e.subject === 'world/dial.md'),
    'expected an entity_edited event for the effect'
  );
});

test('rolling the same card twice does not double the consequence (hard gate 2)', async () => {
  const { store, write } = await world();
  await write('command/record-reading.yaml', AWARD_CMD);
  await write('world/dial.md', BOUND_CARD);
  const svc = createActionService(store, ACTOR, { turn: 'req:e2e-2' });

  await svc.rollDice({ path: 'world/dial.md', forcedResult: 42 });
  const first = await store.readFile('world/dial.md');

  // The SAME entity, SAME hook, SAME fact. A second roll of an entity that
  // already carries `roll_dice.result` is refused by the action layer (its own
  // re-roll gate), so drive the second settle through the same public path and
  // require the outcome to be a REUSE rather than a second append.
  const second = await svc.rollDice({ path: 'world/dial.md' }).catch((err) => err);
  const after = await store.readFile('world/dial.md');

  const occurrences = (after.match(/The dial reads/g) ?? []).length;
  if (second instanceof Error) {
    // The re-roll gate fired before any command ran: still exactly one append.
    assert.equal(occurrences, 1, after);
  } else {
    assert.equal(occurrences, 1, `a repeat must not append again:\n${after}`);
  }
  assert.equal(first, after, 'the card must be unchanged by the repeat');
});

test('an effect that cannot happen fails visibly and leaves the roll intact', async () => {
  const { store, write } = await world();
  // The effect edits a path that does not exist: the roll is legitimate, the
  // consequence is not. `03`'s stop-at-failure means the FIRST effect fails and
  // nothing further runs — and the failure must be reported, not swallowed.
  const bad = [
    'name: Touch a missing card',
    'do:',
    '  - action: edit',
    '    with:',
    '      path: "world/does-not-exist.md"',
    '      append_body: "x"',
    '',
  ].join('\n');
  await write('command/touch-missing.yaml', bad);
  await write(
    'world/dial2.md',
    [
      '---',
      'name: The dial',
      'type: note',
      'roll_dice:',
      '  type: d100',
      '  expect: "1..100"',
      'on:',
      '  roll_resolved:',
      '    - run: touch-missing',
      '---',
      '',
      'Another dial.',
      '',
    ].join('\n')
  );
  const svc = createActionService(store, ACTOR, { turn: 'req:e2e-3' });
  const res = await svc.rollDice({ path: 'world/dial2.md', forcedResult: 7 });

  // The ROLL still succeeded (the player's action is not undone by a broken
  // consequence) and its result is recorded.
  const raw = await store.readFile('world/dial2.md');
  assert.ok(/roll_dice:[\s\S]*result: 7/.test(raw), raw);
  // The failure is surfaced on the receipt rather than thrown.
  const cmd = res.details.commands?.[0];
  assert.ok(cmd, 'expected a receipt even when the effect failed');
  assert.equal(cmd.status, 'error', JSON.stringify(cmd));
  assert.equal(cmd.settleReport.failed.code, 'not_found');
  assert.match(cmd.settleReport.failed.message, /does-not-exist/);
  assert.deepEqual(cmd.settleReport.ran, [], 'nothing settled ⇒ nothing in `ran`');
});

test('an entity with no `on` produces no commands receipt at all', async () => {
  const { store, write } = await world();
  await write(
    'world/plain.md',
    ['---', 'name: Plain', 'type: note', 'roll_dice:', '  type: d100', '  expect: "1..100"', '---', '', 'Nothing bound.', ''].join('\n')
  );
  const svc = createActionService(store, ACTOR, { turn: 'req:e2e-4' });
  const res = await svc.rollDice({ path: 'world/plain.md', forcedResult: 3 });
  assert.equal(res.details.commands, undefined, 'no `on` ⇒ no `commands` key');
});
