import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { ActionError, LocalWorldStore, createActionService } from '../dist/index.js';
import '../dist/actions/roll-dice.js';

const CHALK = [
  '---',
  'type: chalk',
  'title: The Cellar Door',
  'roll_dice:',
  '  type: 1d100',
  '  desc: Pick the rusted lock',
  '  expect: ">50"',
  'choice:',
  '  - "Force it"',
  'status:',
  '  data:',
  '    locked: true',
  '---',
  '',
  'A rusted padlock.',
  '',
].join('\n');

const WORLD_JSON = JSON.stringify({
  id: 'proj-1',
  name: 'T',
  description: '',
  author: '',
  genre: 'test',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

async function tempWorld(files = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-dice-'));
  await fs.mkdir(path.join(root, 'world/inn'), { recursive: true });
  await fs.writeFile(path.join(root, 'world.json'), WORLD_JSON, 'utf-8');
  await fs.writeFile(path.join(root, 'world/README.md'), '---\nname: Map\ntype: readme\n---\n\n# Map\n', 'utf-8');
  await fs.writeFile(
    path.join(root, 'world/inn/README.md'),
    '---\nname: Inn\ntype: readme\n---\n\n# Inn\n',
    'utf-8'
  );
  await fs.writeFile(path.join(root, 'world/inn/cellar-door.md'), CHALK, 'utf-8');
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, 'utf-8');
  }
  return root;
}
const seqRng = (values) => {
  let i = 0;
  return () => values[i++];
};

function service(store, actor = { type: 'player' }, rng) {
  return createActionService(store, actor, { turn: 'probe', rng });
}

test('rollDice: rolls, writes two lines, records a self-sufficient event (10.2 #1)', async () => {
  const store = new LocalWorldStore(await tempWorld());
  const svc = service(store, { type: 'player' }, seqRng([0.61]));
  const r = await svc.rollDice({ path: 'world/inn/cellar-door.md' });

  assert.equal(r.details.result, 62);
  assert.equal(r.details.passed, true);
  assert.deepEqual(r.details.rolls, [62]);
  assert.equal(r.details.crit, false);
  assert.equal(r.details.fumble, false);
  assert.equal(r.details.forged, false);
  assert.equal(r.details.name, 'The Cellar Door');
  assert.equal(r.details.layer, 'world/inn');
  assert.equal(r.details.dice, '1d100');
  assert.match(r.text, /Rolled 1d100 for "Pick the rusted lock" \(world\/inn\/cellar-door\.md\): 62 — passed \(>50\)\./);

  const after = await store.readFile('world/inn/cellar-door.md');
  const stripped = after.replace('  result: 62\n', '').replace('  passed: true\n', '');
  assert.equal(stripped, CHALK, 'only result/passed changed');

  const events = await store.getEvents(10);
  const ev = events.find((e) => e.type === 'roll_resolved');
  assert.ok(ev, 'roll_resolved was appended');
  assert.equal(ev.actor.type, 'player');
  assert.equal(ev.subject, 'world/inn/cellar-door.md');
  assert.equal(ev.layer, 'world/inn');
  assert.equal(ev.turn, 'probe');
  assert.deepEqual(ev.detail, {
    path: 'world/inn/cellar-door.md',
    name: 'The Cellar Door',
    dice: '1d100',
    desc: 'Pick the rusted lock',
    expect: '>50',
    result: 62,
    passed: true,
    // The shared tier.
    outcome: 'success',
  });
  assert.equal(r.details.outcome, 'success');
  store.close();
});

test('rollDice: refuses a re-roll and appends nothing (10.2 #2)', async () => {
  const store = new LocalWorldStore(await tempWorld());
  await service(store).rollDice({ path: 'world/inn/cellar-door.md' });
  const before = (await store.getEvents(100)).length;

  await assert.rejects(
    () => service(store).rollDice({ path: 'world/inn/cellar-door.md' }),
    (err) => err instanceof ActionError && err.code === 'dice_already_rolled' && err.httpStatus === 409
  );
  assert.equal((await store.getEvents(100)).length, before, 'failure appends no event');
  store.close();
});

test('rollDice: a non-god forcedResult is 403 with no file change and no event (10.2 #3)', async () => {
  const store = new LocalWorldStore(await tempWorld());
  await assert.rejects(
    () => service(store, { type: 'writer' }).rollDice({ path: 'world/inn/cellar-door.md', forcedResult: 7 }),
    (err) => err instanceof ActionError && err.code === 'dice_forced_not_allowed' && err.httpStatus === 403
  );
  assert.equal(await store.readFile('world/inn/cellar-door.md'), CHALK);
  assert.equal((await store.getEvents(100)).length, 0);
  store.close();
});

test('rollDice: god forges a result, the event actor is god (10.2 #4)', async () => {
  const store = new LocalWorldStore(await tempWorld());
  const r = await service(store, { type: 'god' }).rollDice({
    path: 'world/inn/cellar-door.md',
    forcedResult: 7,
  });
  assert.equal(r.details.result, 7);
  assert.equal(r.details.forged, true);
  assert.deepEqual(r.details.rolls, [7]);
  assert.match(r.text, /Forged 7 for/);
  const after = await store.readFile('world/inn/cellar-door.md');
  assert.ok(after.includes('  result: 7\n') && after.includes('  passed: false\n'));
  const ev = (await store.getEvents(1))[0];
  assert.equal(ev.actor.type, 'god');
  store.close();
});

test('rollDice: god may overwrite an existing result only with forcedResult (§3.3)', async () => {
  const store = new LocalWorldStore(await tempWorld());
  await service(store, { type: 'god' }, seqRng([0.61])).rollDice({ path: 'world/inn/cellar-door.md' });

  await assert.rejects(
    () => service(store, { type: 'god' }).rollDice({ path: 'world/inn/cellar-door.md' }),
    (err) => err instanceof ActionError && err.code === 'dice_already_rolled'
  );
  const r = await service(store, { type: 'god' }).rollDice({
    path: 'world/inn/cellar-door.md',
    forcedResult: 7,
  });
  assert.match(r.text, /Overwrote the previous result \(62\) with a forged 7 for "Pick the rusted lock"/);
  store.close();
});

test('rollDice: an out-of-range forcedResult is invalid_argument naming the range (10.2 #5)', async () => {
  const store = new LocalWorldStore(await tempWorld());
  await assert.rejects(
    () => service(store, { type: 'god' }).rollDice({ path: 'world/inn/cellar-door.md', forcedResult: 120 }),
    (err) =>
      err instanceof ActionError &&
      err.code === 'invalid_argument' &&
      err.httpStatus === 400 &&
      /forcedResult 120 is outside the range of 1d100 \(1\.\.100\)/.test(err.message)
  );
  await assert.rejects(
    () => service(store, { type: 'god' }).rollDice({ path: 'world/inn/cellar-door.md', forcedResult: 62.5 }),
    (err) => err instanceof ActionError && /must be an integer/.test(err.message)
  );
  assert.equal(await store.readFile('world/inn/cellar-door.md'), CHALK);
  store.close();
});

test('rollDice: not_interactive / malformed_entity / not_found / invalid_path (10.2 #6)', async () => {
  const store = new LocalWorldStore(
    await tempWorld({
      'world/inn/plain.md': '---\ntype: note\n---\nbody\n',
      'world/inn/broken.md': 'no frontmatter here\n',
    })
  );
  const expectCode = async (path, code, httpStatus) => {
    await assert.rejects(
      () => service(store).rollDice({ path }),
      (err) => err instanceof ActionError && err.code === code && err.httpStatus === httpStatus
    );
  };
  await expectCode('world/inn/plain.md', 'not_interactive', 422);
  await expectCode('world/inn/broken.md', 'malformed_entity', 422);
  await expectCode('world/inn/nope.md', 'not_found', 404);
  await expectCode('world/inn', 'not_found', 404);
  await expectCode('../etc/passwd', 'invalid_path', 400);
  await expectCode('', 'invalid_argument', 400);
  store.close();
});

test('rollDice: a bad expect is invalid_field_value naming the raw expression (10.2 #7)', async () => {
  const store = new LocalWorldStore(
    await tempWorld({
      'world/inn/bad.md': CHALK.replace('expect: ">50"', 'expect: ">abc"'),
    })
  );
  await assert.rejects(
    () => service(store).rollDice({ path: 'world/inn/bad.md' }),
    (err) =>
      err instanceof ActionError &&
      err.code === 'invalid_field_value' &&
      err.message.includes('">abc"') &&
      err.message.includes('is not evaluable')
  );
  assert.equal((await store.getEvents(100)).length, 0);
  store.close();
});

test('rollDice: an unparsable type is invalid_field_value (10.2 #8)', async () => {
  const store = new LocalWorldStore(
    await tempWorld({ 'world/inn/bad.md': CHALK.replace('type: 1d100', 'type: 1d100x') })
  );
  await assert.rejects(
    () => service(store).rollDice({ path: 'world/inn/bad.md' }),
    (err) => err instanceof ActionError && err.code === 'invalid_field_value' && /1d100x/.test(err.message)
  );
  store.close();
});

test('rollDice: a write failure leaves the original bytes alone (10.2 #8)', async () => {
  const store = new LocalWorldStore(await tempWorld());
  const original = store.writeFileAtomic.bind(store);
  store.writeFileAtomic = async () => {
    throw new Error('disk full');
  };
  await assert.rejects(
    () => service(store).rollDice({ path: 'world/inn/cellar-door.md' }),
    (err) => err instanceof ActionError && err.code === 'write_failed' && err.httpStatus === 500
  );
  store.writeFileAtomic = original;
  assert.equal(await store.readFile('world/inn/cellar-door.md'), CHALK, 'original untouched');
  assert.equal((await store.getEvents(100)).length, 0);
  store.close();
});

test('rollDice: an appendEvent failure reports event_failed without undo (10.2 #9)', async () => {
  const store = new LocalWorldStore(await tempWorld());
  store.appendEvent = async () => {
    throw new Error('db locked');
  };
  await assert.rejects(
    () => service(store, { type: 'player' }, seqRng([0.61])).rollDice({ path: 'world/inn/cellar-door.md' }),
    (err) =>
      err instanceof ActionError &&
      err.code === 'event_failed' &&
      /File "world\/inn\/cellar-door\.md" was updated with result 62/.test(err.message)
  );
  const after = await store.readFile('world/inn/cellar-door.md');
  assert.ok(after.includes('  result: 62\n'), 'the file write is NOT rolled back (01 §3.6)');
  store.close();
});

test('rollDice: multi-die and modifier produce a sum and a breakdown line', async () => {
  const store = new LocalWorldStore(
    await tempWorld({
      'world/inn/line.md': CHALK.replace('type: 1d100', 'type: 2d6+2').replace('expect: ">50"', 'expect: ">=12"'),
    })
  );
  const r = await service(store, { type: 'player' }, seqRng([0.4, 0.4])).rollDice({
    path: 'world/inn/line.md',
  });
  assert.equal(r.details.result, 8);
  assert.deepEqual(r.details.rolls, [3, 3]);
  assert.equal(r.details.passed, false);
  assert.match(r.text, /3\+3\+2 = 8/);
  store.close();
});

test('rollDice is reachable through the registered action service (single entry point)', async () => {
  const store = new LocalWorldStore(await tempWorld());
  const r = await service(store, { type: 'player' }, seqRng([0.61])).rollDice({
    path: 'world/inn/cellar-door.md',
  });
  assert.equal(r.details.result, 62);
  store.close();
});
