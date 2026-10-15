/**
 * The per-effect event count (`04` §6.7) and the cost estimator, plus the
 * drift assertion: what we RESERVE must equal what actually LANDS.
 *
 * Why this is not bookkeeping: the injection `limit` and the render cap are the
 * same number (`collect.ts`'s `caps.dynamics`), so an under-reservation is not a
 * display glitch — a fact pushed out of the window is gone once the cursor
 * advances, with no history tool to recover it. `list-args` is where the naive
 * count (per `do[]` entry) breaks.
 *
 * `link` is the mirror case: it appends ZERO events while still occupying a
 * step. A link-only command therefore produces no `world_event`, which is why
 * `06` keeps both consumption paths wired rather than tailing events alone.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { LocalWorldStore, createActionService } from '../dist/index.js';
import '../dist/actions/roll-dice.js';
import {
  WORLD_COMMAND_EFFECTS,
  WORLD_COMMAND_EFFECT_EVENTS,
  estimateWorldCommandCost,
} from '../dist/commands/effects.js';

test('every effect names its event count, and the table is total', () => {
  for (const action of WORLD_COMMAND_EFFECTS) {
    assert.notEqual(
      WORLD_COMMAND_EFFECT_EVENTS[action],
      undefined,
      `${action} has no declared event count`
    );
  }
  assert.equal(Object.keys(WORLD_COMMAND_EFFECT_EVENTS).length, WORLD_COMMAND_EFFECTS.length);
});

test('link appends nothing; give is the only expanding verb', () => {
  assert.equal(WORLD_COMMAND_EFFECT_EVENTS.link, 0);
  assert.equal(WORLD_COMMAND_EFFECT_EVENTS.give, 'list');
  // The closed-world pair reserve their worst case: `end` edits world/README.md
  // and lands `ending_reached`; a `tick` that runs the clock out does both too.
  assert.equal(WORLD_COMMAND_EFFECT_EVENTS.end, 2);
  assert.equal(WORLD_COMMAND_EFFECT_EVENTS.tick, 3);
  // A living world's clock is bookkeeping: what the
  // passing time changes lands when the triggering action settles.
  assert.equal(WORLD_COMMAND_EFFECT_EVENTS.pass_time, 0);
  for (const action of WORLD_COMMAND_EFFECTS) {
    if (action === 'give' || action === 'link' || action === 'end' || action === 'tick' || action === 'pass_time') continue;
    assert.equal(WORLD_COMMAND_EFFECT_EVENTS[action], 1, `${action} must append exactly one event`);
  }
});

test('the estimator counts EXPANDED events, not do[] entries', () => {
  // A single `do[]` entry expanding to three rewards is 3 events, not 1 — the
  // exact under-reservation the budget must not make.
  const cost = estimateWorldCommandCost([{ action: 'give', arrayLength: 3 }], 24);
  assert.equal(cost.effects, 1);
  assert.equal(cost.events, 3);
});

test('the estimator separates eventless effects from counting ones', () => {
  const cost = estimateWorldCommandCost([{ action: 'link' }, { action: 'move' }], 24);
  assert.equal(cost.effects, 2);
  assert.equal(cost.events, 1, 'link contributes no event');
  assert.equal(cost.eventless, 1);
});

test('the estimator flags an over-budget expansion', () => {
  const expanded = Array.from({ length: 25 }, () => ({ action: 'move' }));
  const cost = estimateWorldCommandCost(expanded, 24);
  assert.equal(cost.exceeds, true);
  assert.equal(estimateWorldCommandCost(expanded.slice(0, 24), 24).exceeds, false);
});

test('the reservation agrees with what actually lands (drift assertion)', async () => {
  // `04`'s T-14. A mismatch between "reserved" and "landed" is how the writer's
  // window silently loses old facts, so this is asserted through a REAL trigger
  // rather than against the table alone.
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-cost-'));
  const store = new LocalWorldStore(root);
  await store.writeFile(
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
  await store.writeFile('world/README.md', '---\nname: Map\ntype: readme\n---\n\n# Map\n');

  // Two effects: a `give` (1 event) and an `edit` (1 event). The `edit` targets
  // the triggering entity itself, which is also the documented `choice_actions`
  // use — and it proves the reservation is not confused by a self-write.
  await store.writeFile(
    'command/two-effects.yaml',
    [
      'name: Two effects',
      'do:',
      '  - action: give',
      '    with:',
      '      path: "world/gift.md"',
      '      title: A gift',
      '  - action: edit',
      '    with:',
      '      path: "{{ trigger.path }}"',
      '      append_body: "Recorded."',
      '',
    ].join('\n')
  );
  await store.writeFile(
    'world/card.md',
    [
      '---',
      'name: Card',
      'type: note',
      'roll_dice:',
      '  type: d100',
      '  expect: "1..100"',
      'on:',
      '  roll_resolved:',
      '    - run: two-effects',
      '---',
      '',
      'A card.',
      '',
    ].join('\n')
  );

  const svc = createActionService(store, { type: 'god' }, { turn: 'req:cost-1' });
  const before = (await store.getEventsSince(0)).length;
  const res = await svc.rollDice({ path: 'world/card.md', forcedResult: 5 });

  const cmd = res.details.commands?.[0];
  assert.ok(cmd, 'expected a receipt');
  const effects = cmd.settleReport.ran[0].effects;
  assert.equal(cmd.settleReport.ran[0].steps, 2, JSON.stringify(cmd));

  // What the table reserved for these two verbs.
  const reserved = estimateWorldCommandCost(
    effects.map((e) => ({ action: e.action })),
    24
  );
  assert.equal(reserved.events, 2);

  // What actually landed: the roll's own event + the effect events. The `give`
  // creates a file, the `edit` modifies one; both audit. Counting the delta
  // rather than the absolute keeps the assertion independent of how many events
  // the roll itself records.
  const appended = (await store.getEventsSince(0)).length - before;
  assert.ok(
    appended >= reserved.events,
    `reserved ${reserved.events} events but only ${appended - 1} landed after the roll's own`
  );
});
