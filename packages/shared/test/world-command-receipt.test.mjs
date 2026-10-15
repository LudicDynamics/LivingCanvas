/**
 * doc 10 §10 T5b — the SAME-TURN receipt on the real trigger path.
 *
 * The unit half lives in `receipt.test.mjs` (the renderer over a literal
 * `WorldCommandReceipt`). This file drives the REAL seam — a `roll_dice` call
 * through the action service — and asserts that the receipt reaches the model's
 * `text`, the only channel a writer-triggered command has (10 §3.9).
 *
 * Build first, then:
 *   node --test packages/shared/test/world-command-receipt.test.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { LocalWorldStore, createActionService } from '../dist/index.js';
import '../dist/actions/roll-dice.js';

const PLAYER = { type: 'player' };

async function world() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-receipt-e2e-'));
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

/** The card the player rolls: a dice check with one bound command. */
const CARD = [
  '---',
  'name: The rusty lock',
  'type: note',
  'roll_dice:',
  '  type: 1d100',
  '  desc: Pick the lock',
  '  expect: ">50"',
  'on:',
  '  roll_resolved:',
  '    - run: mark-lock',
  '---',
  '',
  'A lock, and a lack of patience.',
  '',
].join('\n');

const CMD = [
  'name: Mark the lock',
  'do:',
  '  - action: edit',
  '    with:',
  '      path: "{{ trigger.path }}"',
  '      append_body: "picked"',
  '',
].join('\n');

test('10 T5b: a roll that fires a command carries the receipt on its `text`', async () => {
  const { store, write } = await world();
  try {
    await write('command/mark-lock.yaml', CMD);
    await write('world/lock.md', CARD);
    const svc = createActionService(store, PLAYER, { turn: 'req:receipt-1' });
    const res = await svc.rollDice({ path: 'world/lock.md' });

    // The action's OWN sentence stays first (10 §8.2 item 3).
    assert.match(res.text, /^Rolled 1d100 for "Pick the lock"/);
    // The receipt follows, and only because a command actually ran. The headline
    // names the command by ID, not by its human `name:` — `runTriggeredCommands`
    // never surfaces the parsed spec's `name`, so this is 10 §2.7's documented
    // degradation to the id. Reported as a seam gap in the delivery notes.
    assert.match(res.text, /The world settled this for you, through "mark-lock":/);
    assert.ok(res.text.includes('do not write, grant, or move any of it again.'));
    assert.ok(res.details.commands, 'the structured receipt is still on `details`');
    assert.ok(res.text.includes('\n\n'), 'the receipt block is separated from the action sentence');
    // The per-effect line IS rendered. This test previously asserted the
    // OPPOSITE ("no event ⇒ no effect line") and documented it as 10 §7's
    // degradation row — but the effect DID have an event; the seam was dropping
    // it (`CommandEffectOutcome` kept only `seq`, and `summaryOf` rebuilt from
    // the persisted log, which stores only `evt-<n>`). The receipt therefore
    // lost every line and degraded to a bare verb sentence: the writer was told
    // "the world settled this" with no idea WHAT it settled.
    //
    // Asserting a symptom as a contract is how a bug gets enshrined. The line is
    // now required, and it must be `renderEvent` output (one renderer, §8.2).
    assert.ok(res.text.includes('  - '), 'the effect line must be rendered');
    assert.match(
      res.text,
      / {2}- The world, after the player acted, edited "The rusty lock" \(world\/lock\.md\)\./,
      'the subject names the WORLD as executor and keeps the actor as cause (10 §3.6)'
    );
    // The bare actor phrase would be `The player edited …` — that sentence is
    // what the reader saw before `detail.command` was written, and it credits
    // the player with a change the engine made.
    assert.ok(
      !res.text.includes('- The player '),
      'the subject must not say the player performed the effect'
    );
  } finally {
    store.close();
    await fs.rm(path.dirname(store.root ?? ''), { recursive: true, force: true }).catch(() => undefined);
  }
});

test('10 §8.2 item 3: no `on`, no command — the text is byte-identical to before', async () => {
  const { store, write } = await world();
  try {
    await write(
      'world/bare.md',
      [
        '---',
        'name: A plain card',
        'type: note',
        'roll_dice:',
        '  type: 1d100',
        '  desc: Try something',
        '  expect: ">50"',
        '---',
        '',
        'Nothing bound.',
        '',
      ].join('\n')
    );
    const svc = createActionService(store, PLAYER, { turn: 'req:receipt-2', rng: () => 0.99 });
    const res = await svc.rollDice({ path: 'world/bare.md' });
    // No receipt: `text` is exactly the roll's own sentence, and nothing else.
    assert.equal(res.text, 'Rolled 1d100 for "Try something" (world/bare.md): 100 — passed (>50).');
    assert.equal(res.details.commands, undefined);
  } finally {
    store.close();
    await fs.rm(path.dirname(store.root ?? ''), { recursive: true, force: true }).catch(() => undefined);
  }
});
