import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createActionService } from '../packages/shared/dist/index.js';

test('choose re-reads source and records actor, path and the exact authored choice', async () => {
  const events = [];
  let raw = '---\ntype: note\nchoice:\n  - Inspect the seal\n---\nLetter';
  const store = {
    readFile: async path => { assert.equal(path, 'world/letter.md'); return raw; },
    resolveLayer: async () => 'map',
    appendEvent: async event => { events.push(event); return event; },
  };
  const service = createActionService(store, { type: 'player' });
  await service.chooseOption({ path: 'world/letter.md', choice: 'Inspect the seal' });
  assert.equal(events[0].type, 'choice_selected');
  assert.deepEqual(events[0].actor, { type: 'player' });
  assert.equal(events[0].detail.path, 'world/letter.md');
  assert.equal(events[0].detail.choice, 'Inspect the seal');
  raw = '---\ntype: note\nchoice:\n  - Read the letter\n---\nLetter';
  await assert.rejects(service.chooseOption({ path: 'world/letter.md', choice: 'Inspect the seal' }), /does not match/);
  assert.equal(events.length, 1);
});
test('missing files and undeclared choices do not create events', async () => {
  const store = { readFile: async () => 'Plain text', appendEvent: async () => assert.fail('Must not record an invalid action') };
  const service = createActionService(store, { type: 'player' });
  await assert.rejects(service.chooseOption({ path: 'world/note.md', choice: 'Invented command' }));
  store.readFile = async () => { throw new Error('Missing file'); };
  await assert.rejects(service.chooseOption({ path: 'world/gone.md', choice: 'Read' }), /Missing file/);
});
