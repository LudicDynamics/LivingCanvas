/**
 * doc 10 §10 acceptance — T2 / T3 / T4 / T7 / T10: the command-subject rendering,
 * the hardened merge key, and the two non-emptiness facts about merging.
 *
 * Imports built `dist/` modules directly (not the barrel), like
 * `render-events.test.mjs`. Build first:
 *   npx tsc -p packages/shared/tsconfig.json
 *   node --test packages/shared/test/events.test.mjs
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { commandOf, renderEvent, renderEventWindow } from '../dist/render/events.js';

const PLAYER = { type: 'player' };
const WRITER = { type: 'writer' };

let seq = 0;
function ev(type, detail, opts = {}) {
  seq += 1;
  return {
    seq: opts.seq ?? seq,
    id: `evt-${seq}`,
    projectId: 'p',
    type,
    actor: opts.actor ?? PLAYER,
    layer: opts.layer ?? 'world/london-map',
    subject: opts.subject ?? null,
    turn: opts.turn ?? 't-7',
    detail,
    createdAt: '2026-09-15T00:00:00.000Z',
  };
}

const windowOf = (events, opts = {}) =>
  renderEventWindow(
    { events, coldStart: false },
    { caps: opts.caps ?? 12, actor: opts.actor ?? WRITER, layerNames: opts.layerNames ?? {} }
  );

const note = (over = {}) => ({
  path: 'world/london-map/x.md',
  name: 'X',
  kind: 'note',
  ...over,
});

// ---------------------------------------------------------------- §2.2 commandOf

test('10 §2.2: commandOf reads detail.command and nothing else', () => {
  assert.equal(commandOf(ev('entity_created', note({ command: 'investigate-clue' }))), 'investigate-clue');
  assert.equal(commandOf(ev('entity_created', note())), null);
  // `detail.by` is NEVER consulted (it is `layer_initialized`'s closed enum).
  assert.equal(commandOf(ev('entity_created', note({ by: 'command' }))), null);
  // Illegal values degrade to "ordinary event"; they never throw (10 §7).
  assert.equal(commandOf(ev('entity_created', note({ command: '' }))), null);
  assert.equal(commandOf(ev('entity_created', note({ command: 'Bad Id' }))), null);
  assert.equal(commandOf(ev('entity_created', note({ command: 'x'.repeat(49) }))), null);
  assert.equal(commandOf(ev('entity_created', note({ command: 7 }))), null);
  assert.equal(commandOf({ ...ev('entity_created', note()), detail: undefined }), null);
});

// ------------------------------------------------------------------- §3.6 T2

test('10 T2: a command event names the world, keeps the actor as cause', () => {
  // Regression row FIRST: without `command` the sentence is byte-identical.
  assert.equal(
    renderEvent(ev('entity_created', note()), { layerNames: {} }),
    'The player left a note: "X" (world/london-map/x.md).'
  );
  assert.equal(
    renderEvent(ev('entity_created', note({ command: 'investigate-clue' })), { layerNames: {} }),
    'The world, after the player acted, left a note: "X" (world/london-map/x.md).'
  );
});

test('10 §2.5: subjectPhrase covers every actor arm', () => {
  const created = (actor) =>
    renderEvent(
      ev('entity_created', note({ command: 'c' }), { actor }),
      { layerNames: {} }
    );
  assert.match(created({ type: 'player' }), /^The world, after the player acted,/);
  assert.match(created({ type: 'writer' }), /^The world, after the narrator acted,/);
  assert.match(created({ type: 'god' }), /^The world, after the world itself acted,/);
  assert.match(created({ type: 'engine' }), /^The world, after the engine acted,/);
  // The `character` arm is already lower-case, so the assembly needs no
  // dedicated lowering helper beyond the first letter (10 §2.5's C-3d note).
  assert.equal(
    created({ type: 'character', id: 'watson' }),
    'The world, after the character "watson" acted, left a note: "X" (world/london-map/x.md).'
  );
  // Every arm keeps the actor as CAUSE, never as the executor (10 §3.6).
  for (const actor of [
    { type: 'player' },
    { type: 'writer' },
    { type: 'god' },
    { type: 'engine' },
    { type: 'functional' },
    { type: 'character', id: 'watson' },
  ]) {
    const line = created(actor);
    assert.ok(line.startsWith('The world, after '), `${actor.type}: world is the executor`);
    assert.ok(line.includes(' acted, left a note'), `${actor.type}: the actor is the cause`);
  }
});

// ------------------------------------------------------------------- §2.3 T3

test('10 T3: the merge key includes command — different sources never merge', () => {
  const w = windowOf([
    ev('entity_created', note({ path: 'world/london-map/hand.md' })),
    ev('entity_created', note({ path: 'world/london-map/by-command.md', command: 'investigate-clue' })),
  ]);
  // Before the fix these merged into one `count: 2` group, i.e. "the command
  // wrote 2 pages" when one of them was not the command's doing.
  assert.equal(w.events.length, 2);
  assert.equal(w.events[0].command, undefined);
  assert.equal(w.events[1].command, 'investigate-clue');
  assert.ok(!('command' in w.events[0]), 'ordinary events MUST NOT carry the key at all');
});

test('10 §2.3: groups whose members are all one command DO carry it, and merge', () => {
  const w = windowOf([
    ev('entity_created', note({ path: 'world/london-map/a.md', command: 'investigate-clue' })),
    ev('entity_created', note({ path: 'world/london-map/b.md', command: 'investigate-clue' })),
  ]);
  assert.equal(w.events.length, 1);
  assert.equal(w.events[0].count, 2);
  assert.equal(w.events[0].command, 'investigate-clue');
});

// ------------------------------------------------------------------- §3.5 T4

test('10 T4: five command effects of one type collapse into ONE world-voiced line', () => {
  const w = windowOf(
    ['a', 'b', 'c', 'd', 'e'].map((n) =>
      ev('entity_created', note({ path: `player/${n}.md`, command: 'investigate-clue' }))
    )
  );
  assert.equal(w.lines.length, 1);
  assert.match(w.lines[0], /^The world, after the player acted, created 5 things\.$/);
  assert.equal(w.events[0].count, 5);
});

// --------------------------------------------------- §3.0 T7 (contract §5.3 反证)

test('10 T7: roll_resolved and a command event stay TWO lines, and never print the turn', () => {
  const w = windowOf([
    ev('roll_resolved', {
      path: 'world/london-map/04.md',
      name: '霧の向こう',
      dice: '1d100',
      desc: 'Pick the lock',
      expect: '>60',
      result: 62,
      passed: true,
    }),
    ev('entity_created', note({ command: 'investigate-clue' }), { seq: 99 }),
  ]);
  assert.equal(w.lines.length, 2);
  assert.ok(!w.lines.some((l) => l.includes('t-7')), 'no sentence may print the turn');
  assert.equal(w.events[0].type, 'roll_resolved');
  assert.equal(w.events[1].type, 'entity_created');
});

// ------------------------------------------------------ §11 冲突 8 T10

test('10 T10: three `list-args` rewards collapse to one line and keep their command', () => {
  const w = windowOf([
    ev('roll_resolved', {
      path: 'world/london-map/04.md',
      name: '霧の向こう',
      dice: '1d100',
      desc: 'Pick the lock',
      expect: '>60',
      result: 62,
      passed: true,
    }),
    ...[1, 2, 3].map((n) =>
      ev('entity_created', note({ path: `player/reward-${n}.md`, command: 'investigate-clue' }), {
        seq: 100 + n,
      })
    ),
  ]);
  assert.equal(w.lines.length, 2);
  assert.match(w.lines[1], /created 3 things\.$/);
  assert.equal(w.events[1].count, 3);
  assert.equal(w.events[1].command, 'investigate-clue');
});
