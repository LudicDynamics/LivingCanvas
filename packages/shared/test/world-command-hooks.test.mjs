/**
 * END-TO-END: the other two trigger hooks.
 *
 * `roll_resolved` is covered in `world-command-e2e.test.mjs`. The C1 batch left
 * `choice_selected` and `use_item_on` with compile-level evidence only, and the
 * dice run proved that is not enough: two bugs (a template rendering to "" and a
 * fresh run reporting `reused`) survived `tsc` and every isolated test, and only
 * surfaced when a real action drove the seam.
 *
 * Each case here asserts the same three things, in the same order as the dice
 * one: the command RAN, the effect is VISIBLE on disk, and the receipt says
 * which verb it was.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { LocalWorldStore, createActionService } from '../dist/index.js';
import '../dist/actions/choose.js';
import '../dist/actions/use-item.js';
import '../dist/actions/roll-dice.js';

const ACTOR = { type: 'god' };

async function world() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-hooks-e2e-'));
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
  return { store, write };
}

/** Append a line whose text interpolates a §2.5 variable — the shape that broke once. */
const cmd = (line) =>
  [
    'name: Record what happened',
    'do:',
    '  - action: edit',
    '    with:',
    '      path: "{{ trigger.path }}"',
    `      append_body: "${line}"`,
    '',
  ].join('\n');

test('choice_selected: picking an option runs the bound command', async () => {
  const { store, write } = await world();
  await write('command/note-choice.yaml', cmd('Chosen: {{ choice.option }} (#{{ choice.index }}).'));
  await write(
    'world/board.md',
    [
      '---',
      'name: The board',
      'type: note',
      'choice:',
      '  - id: open_it',
      '    label: Open it',
      'on:',
      '  choice_selected:',
      '    - run: note-choice',
      '---',
      '',
      'Doors, and a choice.',
      '',
    ].join('\n')
  );

  const svc = createActionService(store, ACTOR, { turn: 'req:choose-1' });
  const res = await svc.chooseOption({ path: 'world/board.md', choice: 'open_it' });

  assert.ok(res.details.commands, 'expected a commands receipt');
  const report = res.details.commands[0].settleReport;
  assert.equal(report.ran.length, 1, JSON.stringify(report));
  assert.equal(report.ran[0].effects[0].settle, 'ran');

  const body = await store.readFile('world/board.md');
  // `choice.option` and `choice.index` are §2.5 members; a bare-root reference
  // resolving to "" is exactly the bug the dice run found.
  assert.ok(body.includes('Chosen: Open it (#1).'), body);
});

test('choice_selected: an option id that does not exist does not run anything', async () => {
  const { store, write } = await world();
  await write('command/note-choice.yaml', cmd('Chosen: {{ choice.option }}.'));
  await write(
    'world/board.md',
    [
      '---',
      'name: The board',
      'type: note',
      'choice:',
      '  - id: open_it',
      '    label: Open it',
      'on:',
      '  choice_selected:',
      '    - run: note-choice',
      '---',
      '',
      'Doors.',
      '',
    ].join('\n')
  );
  const svc = createActionService(store, ACTOR, { turn: 'req:choose-2' });
  const res = await svc.chooseOption({ path: 'world/board.md', choice: 'nope' }).catch((err) => err);
  // Either the resolution refuses the option, or it resolves to nothing; in both
  // cases the command MUST NOT have appended anything.
  const body = await store.readFile('world/board.md');
  assert.ok(!body.includes('Chosen:'), `nothing should have been appended:\n${body}`);
  if (!(res instanceof Error)) {
    assert.equal(res.details.commands, undefined, 'a refused choice runs no command');
  }
});

test('use_item_on: using an item on a target runs the bound command', async () => {
  const { store, write } = await world();
  await write(
    'command/note-use.yaml',
    [
      'name: Record the use',
      'do:',
      '  - action: edit',
      '    with:',
      '      path: "{{ trigger.path }}"',
      '      append_body: "Used {{ item.name }}."',
      '',
    ].join('\n')
  );
  await write(
    'items/key.md',
    ['---', 'name: Brass key', 'type: item', '---', '', 'A small key.', ''].join('\n')
  );
  await write(
    'world/lock.md',
    [
      '---',
      'name: The lock',
      'type: note',
      'on:',
      '  use_item_on:',
      '    - run: note-use',
      '---',
      '',
      'A stubborn lock.',
      '',
    ].join('\n')
  );

  const svc = createActionService(store, ACTOR, { turn: 'req:use-1' });
  const res = await svc.useItemOn({ item: 'items/key.md', target: 'world/lock.md' });

  assert.ok(res.details.commands, 'expected a commands receipt');
  const report = res.details.commands[0].settleReport;
  assert.equal(report.ran.length, 1, JSON.stringify(report));
  assert.equal(report.ran[0].effects[0].settle, 'ran');

  const body = await store.readFile('world/lock.md');
  // Whatever §2.5 names the item variable, the interpolation must NOT be empty:
  // an empty render is the silent failure this suite exists to catch.
  const appended = body.split(/\n---\n/).slice(1).join('\n---\n');
  assert.match(appended, /Used .+\./, body);
  assert.ok(!/Used \./.test(appended), `the item variable rendered EMPTY:\n${body}`);
});
