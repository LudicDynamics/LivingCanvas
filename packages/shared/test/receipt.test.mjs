/**
 * doc 10 §10 T5b / T11 — the same-turn receipt (`commandReceiptText`).
 *
 * T5's other half is in `inject.test.mjs` (`excludeActor` hides a writer's own
 * command events, so the receipt is the only same-turn channel, 10 §3.9).
 *
 * Imports built `dist/` modules directly (not the barrel). Build first:
 *   npx tsc -p packages/shared/tsconfig.json
 *   node --test packages/shared/test/receipt.test.mjs
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { commandReceiptText, commandReceipts } from '../dist/commands/receipt.js';
import { renderEvent } from '../dist/render/events.js';

const PLAYER = { type: 'player' };

const createdEvent = {
  seq: 44,
  id: 'evt-44',
  projectId: 'p',
  type: 'entity_created',
  actor: PLAYER,
  layer: 'world/london-map',
  subject: 'world/london-map/note.md',
  turn: 't-7',
  detail: {
    path: 'world/london-map/note.md',
    name: '核心を記した覚え書き',
    kind: 'note',
    command: 'investigate-clue',
  },
  createdAt: '2026-09-15T00:00:00.000Z',
};

const RAN = {
  id: 'investigate-clue',
  name: 'Investigate the clue',
  settle: 'ran',
  effects: [{ action: 'give', ok: true, event: createdEvent }],
};

// ------------------------------------------------------------------- 10 §2.7

test('10 T5b: an empty receipt is the empty string (text stays byte-identical)', () => {
  assert.equal(commandReceiptText([]), '');
  assert.equal(commandReceiptText(null), '');
  assert.equal(commandReceiptText(undefined), '');
});

test('10 T5b: `ran` — headline, one line rendered by renderEvent, closing line', () => {
  const receipt = commandReceiptText([RAN]);
  // The returned block starts with the blank separator line (10 §8.2 item 3:
  // the action's own sentence comes first, the receipt after it).
  assert.match(receipt, /^\n\nThe world settled this for you, through "Investigate the clue":/);
  assert.match(receipt, /do not write, grant, or move any of it again\.$/);
  // The line IS the next turn's sentence: one wording, two places (10 §2.7).
  assert.ok(receipt.includes(renderEvent(createdEvent, { layerNames: {} })));
  assert.match(
    receipt,
    / {2}- The world, after the player acted, left a note: "核心を記した覚え書き" \(world\/london-map\/note\.md\)\./
  );
});

test('10 §3.8.1: every settle verb has its own wording, and there is no fifth', () => {
  const of = (settle) =>
    commandReceiptText([{ id: 'c', name: 'C', settle, effects: settle === 'reused' ? [] : RAN.effects }]);
  assert.match(of('ran'), /^\n\nThe world settled this for you, through "C":/);
  assert.match(of('resumed'), /^\n\nThe world finished settling this, through "C":/);
  assert.match(of('failed'), /^\n\nThe world could not settle this for you, through "C":/);
  // `failed` must not claim anything was granted.
  assert.match(of('failed'), /^[\s\S]*Nothing was granted\. Say what the player can still try\.$/);
  // `reused` is ONE sentence: no effect lines, no closing line (10 §3.8.1).
  assert.equal(
    of('reused'),
    '\n\nThe world had already settled this, through "C": nothing changed again.'
  );
});

test('10 T11: `reused` says "nothing changed again" and lists no effect', () => {
  const text = commandReceiptText([
    { id: 'investigate-clue', name: 'Investigate the clue', settle: 'reused', effects: [] },
  ]);
  assert.match(text, /nothing changed again\.$/);
  // One whole sentence: the leading separator is the only newline.
  assert.equal(text.replace(/^\n\n/, '').includes('\n'), false);
});

test('10 §7: degradation rows — missing event, missing name, unknown verb, failure', () => {
  // (a) An effect with no real event is SKIPPED, not invented.
  const noEvent = commandReceiptText([
    { id: 'c', name: 'C', settle: 'ran', effects: [{ action: 'give', ok: true }] },
  ]);
  assert.ok(noEvent.includes('The world settled this for you, through "C":'));
  assert.ok(!noEvent.includes('  - '), 'no line may be printed without a real event');

  // (b) A failure prints the action layer's own message, verbatim.
  const failed = commandReceiptText([
    {
      id: 'c',
      name: 'C',
      settle: 'failed',
      effects: [{ action: 'consume', ok: false, error: 'nothing was taken' }],
    },
  ]);
  assert.ok(failed.includes('nothing was taken'));

  // (c) A fifth verb falls back to `ran` — the conservative direction.
  const fifth = commandReceiptText([{ id: 'c', name: 'C', settle: 'invented', effects: [] }]);
  assert.match(fifth, /^\n\nThe world settled this for you, through "C":/);

  // (d) A missing `name` degrades to the id, never to a blank headline.
  const unnamed = commandReceiptText([{ id: 'c', name: '', settle: 'reused', effects: [] }]);
  assert.equal(unnamed, '\n\nThe world had already settled this, through "c": nothing changed again.');
});

test('10 §3.8.1: several commands keep their order, each with its own headline', () => {
  const text = commandReceiptText([
    { id: 'a', name: 'A', settle: 'reused', effects: [] },
    RAN,
  ]);
  assert.ok(text.indexOf('"A"') < text.indexOf('"Investigate the clue"'));
  // The receipt block is separated from the action's own sentence.
  assert.match(text, /^\n\n/);
});
