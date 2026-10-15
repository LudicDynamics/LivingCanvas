/**
 * Story events (actions/story-event.ts): a roll's consequence told in words and
 * landed on a character, an item or a place — through the real action layer,
 * rollDice → on.roll_resolved → the `event` effect.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { LocalWorldStore, createActionService } from '../dist/index.js';
import '../dist/actions/roll-dice.js';

const GOD = { type: 'god' };

async function world() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-story-event-'));
  const store = new LocalWorldStore(root);
  const write = (rel, text) => store.writeFile(rel, text);
  await write('world.json', JSON.stringify({
    id: 'w', name: 'W', description: '', author: '', genre: 'test',
    characters: [{ id: 'old-mo', name: 'Old Mo', home: 'world/lighthouse' }],
    createdAt: 'x', updatedAt: 'x',
  }));
  await write('world/README.md', '---\nname: Harbour\ntype: readme\n---\n');
  await write('world/lighthouse/README.md', '---\nname: The lighthouse\ntype: gate\n---\n');
  await write('world/lighthouse/logbook.md', '---\nname: Logbook\ntype: note\n---\n\nTimes of the lamp.\n');
  await write('characters/old-mo/README.md', '---\nname: Old Mo\n---\n');
  return { store, write };
}

/** A card that rolls once and runs `cmd` on any result. */
const card = (cmd) => ['---', 'name: Peek', 'type: note', 'roll_dice:', '  type: d100', '  expect: "1..100"',
  'on:', '  roll_resolved:', `    - run: ${cmd}`, '---', '', 'Peek at it.', ''].join('\n');

const eventCmd = (target, title, text) => [
  'name: Something happens', 'desc: A story event', 'do:', '  - action: event', '    with:',
  `      target: ${target}`, `      title: "${title}"`, `      text: "${text}"`, ''].join('\n');

test('an event on a character lands where they stand, so they read it next turn', async () => {
  const { store, write } = await world();
  await write('command/caught.yaml', eventCmd('characters/old-mo', 'Caught reading', 'He saw you open his logbook.'));
  await write('world/lighthouse/peek.md', card('caught'));
  const res = await createActionService(store, GOD, { turn: 'req:e1' }).rollDice({ path: 'world/lighthouse/peek.md', forcedResult: 40 });
  assert.equal(res.details.commands[0].status, 'ok', JSON.stringify(res.details.commands));

  const events = (await store.getEventsSince(0)).filter((e) => e.type === 'story_event');
  assert.equal(events.length, 1);
  const [e] = events;
  assert.equal(e.layer, 'world/lighthouse', 'recorded in the layer the character is in (their home here)');
  assert.deepEqual(e.detail, {
    target: 'characters/old-mo', kind: 'character', name: 'Old Mo',
    title: 'Caught reading', text: 'He saw you open his logbook.',
  });
  // What a character standing in that layer reads on its next turn.
  const theirSlice = await store.getEventsSince(0, { layer: 'world/lighthouse' });
  assert.ok(theirSlice.some((x) => x.type === 'story_event'));
});

test('an event on an item or a place is named and placed by its path', async () => {
  const { store, write } = await world();
  await write('command/torn.yaml', eventCmd('world/lighthouse/logbook.md', 'A page tears', 'A corner comes away in your hand.'));
  await write('command/tide.yaml', eventCmd('world/lighthouse', 'Water at the door', 'The tide reaches the first step.'));
  await write('world/lighthouse/a.md', card('torn'));
  await write('world/lighthouse/b.md', card('tide'));
  const svc = createActionService(store, GOD, { turn: 'req:e2' });
  await svc.rollDice({ path: 'world/lighthouse/a.md', forcedResult: 10 });
  await svc.rollDice({ path: 'world/lighthouse/b.md', forcedResult: 10 });
  const [item, place] = (await store.getEventsSince(0)).filter((e) => e.type === 'story_event');
  assert.equal(item.detail.kind, 'item');
  assert.equal(item.detail.name, 'Logbook');
  assert.equal(item.layer, 'world/lighthouse');
  assert.equal(place.detail.kind, 'place');
  assert.equal(place.detail.name, 'The lighthouse');
  assert.equal(place.layer, 'world/lighthouse');
});

test('an event on something that does not exist fails visibly, and the roll still stands', async () => {
  const { store, write } = await world();
  await write('command/ghost.yaml', eventCmd('characters/nobody', 'Hm', 'Nothing.'));
  await write('world/lighthouse/c.md', card('ghost'));
  const res = await createActionService(store, GOD, { turn: 'req:e3' }).rollDice({ path: 'world/lighthouse/c.md', forcedResult: 5 });
  assert.equal(res.details.commands[0].status, 'error');
  assert.match(res.details.commands[0].message, /No character "nobody"/);
  assert.ok((await store.getEventsSince(0)).some((e) => e.type === 'roll_resolved'), 'the roll itself is kept');
});

test('the character an event landed on reads it as something that happened to them', async () => {
  const { renderEventWindow } = await import('../dist/index.js');
  const event = {
    seq: 9, id: 'evt-9', projectId: 'w', type: 'story_event', actor: { type: 'player' },
    layer: 'world/lighthouse', subject: 'characters/old-mo', turn: 'req:x',
    detail: { target: 'characters/old-mo', kind: 'character', name: 'Old Mo', title: 'Caught reading', text: 'He saw you open his logbook.' },
    createdAt: '2026-09-26T00:00:00.000Z',
  };
  const read = (actor) => renderEventWindow({ events: [event], coldStart: false }, { caps: 8, actor, layerNames: {} }).events[0].text;
  const his = read({ type: 'character', id: 'old-mo' });
  assert.match(his, /^This just happened to YOU — Caught reading: He saw you open his logbook\./);
  assert.match(his, /let it show/);
  // Anyone else — another character, the writer — reads the plain line.
  assert.match(read({ type: 'character', id: 'vera' }), /^Something happened to Old Mo/);
  assert.match(read({ type: 'writer' }), /^Something happened to Old Mo/);
});
