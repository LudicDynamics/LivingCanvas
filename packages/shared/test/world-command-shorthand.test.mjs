/**
 * The parameter shorthand: `{{ grade }}` MUST resolve exactly like
 * `{{ params.grade }}`.
 *
 * `01` §2.8 says the two are equivalent, and the write-time checker accepts
 * both — so the evaluator must too. It did not: only the prefixed form was
 * registered, so every command using the shorthand was ACCEPTED at write time
 * and then failed at trigger time with `"grade" is not a readable reference
 * here`. That split (valid on write, broken on trigger) is the exact failure
 * shape this module is built to prevent — and it was found by running a real
 * migrated command, not by reading the tables.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { LocalWorldStore, createActionService } from '../dist/index.js';
import '../dist/actions/roll-dice.js';
import { parseWorldCommand } from '../dist/commands/world-command.js';

async function world() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-shorthand-'));
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
  return store;
}

/** One command writing the SAME parameter value through one spelling. */
const commandUsing = (spelling) =>
  [
    'name: Record the reading',
    'params:',
    '  grade: { type: string }',
    'do:',
    '  - action: edit',
    '    with:',
    '      path: "{{ trigger.path }}"',
    `      append_body: "grade=${spelling}"`,
    '',
  ].join('\n');

const cardWith = (command) =>
  [
    '---',
    'name: Card',
    'type: note',
    'roll_dice:',
    '  type: d100',
    '  expect: "1..100"',
    'on:',
    '  roll_resolved:',
    `    - run: ${command}`,
    '      with:',
    '        grade: great',
    '---',
    '',
    'A card.',
    '',
  ].join('\n');

async function run(store, command, spelling, turn) {
  await store.writeFile(`command/${command}.yaml`, commandUsing(spelling));
  await store.writeFile(`world/card.md`, cardWith(command));
  const svc = createActionService(store, { type: 'god' }, { turn });
  const res = await svc.rollDice({ path: 'world/card.md', forcedResult: 7 });
  return { res, body: await store.readFile('world/card.md') };
}

test('the write-time checker accepts BOTH spellings', () => {
  for (const spelling of ['{{ grade }}', '{{ params.grade }}']) {
    const r = parseWorldCommand('spelling', commandUsing(spelling));
    assert.ok(r.ok, `${spelling}: ${JSON.stringify(r.ok ? [] : r.errors)}`);
  }
});

test('`{{ grade }}` resolves to the value, exactly like `{{ params.grade }}`', async () => {
  const bare = await run(await world(), 'bare', '{{ grade }}', 'req:bare');
  const prefixed = await run(await world(), 'prefixed', '{{ params.grade }}', 'req:pref');

  // Neither may fail: an empty render here is the bug, and it is SILENT —
  // `append_body` would happily write "grade=" and report success.
  assert.ok(bare.body.includes('grade=great'), `bare spelling rendered nothing:\n${bare.body}`);
  assert.ok(prefixed.body.includes('grade=great'), prefixed.body);

  // And they must agree byte for byte, which is what "equivalent" means.
  const bareLine = bare.body.split('\n').find((l) => l.startsWith('grade='));
  const prefixedLine = prefixed.body.split('\n').find((l) => l.startsWith('grade='));
  assert.equal(bareLine, prefixedLine);

  assert.equal(bare.res.details.commands[0].settleReport.ran.length, 1);
});

test('a parameter name cannot shadow a reserved root, so the alias cannot clobber one', () => {
  // This is why registering the bare name is safe: `01` refuses a param whose
  // name equals a reserved root, so there is no way for `{{ actor }}` to mean
  // "my parameter" in one command and "the triggering actor" in another.
  const src = [
    'name: x',
    'params:',
    '  trigger: { type: string }',
    'do:',
    '  - action: edit',
    '    with:',
    '      path: "a.md"',
    '',
  ].join('\n');
  const r = parseWorldCommand('shadow', src);
  assert.equal(r.ok, false);
  assert.ok(
    r.errors.some((e) => e.code === 'reserved_param_name'),
    JSON.stringify(r.ok ? [] : r.errors)
  );
});
