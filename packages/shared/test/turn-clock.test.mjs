/**
 * A clock that moves with the player's turns (world.json `clock.perTurns`,
 * actions/turn-clock.ts):
 *
 *   - the player's own option / roll / item use is one turn (the action hook);
 *     the writer's, a character's, god's and a command's are not;
 *   - `countPlayerTurn` (the server's request / talk) counts the same way;
 *   - the `perTurns`-th turn puts the count back to 0, ticks the clock and runs
 *     the ordinary clock triggers; `clock.turns` is readable by state triggers;
 *   - the count is on the clock card (no event per turn), a world without
 *     `perTurns` never counts, an ended world never counts;
 *   - `loop_reset` starts the new loop's first step from 0, and `persist.files`
 *     patterns (`player/*.md`) keep the whole bag.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  LocalWorldStore,
  clockLeft,
  countPlayerTurn,
  createActionService,
  endWorld,
  loopFileMatches,
  loopConfigProblems,
  parseFrontmatter,
  prepareLoop,
  turnClockOf,
  turnsSpentOf,
  WorldManifestSchema,
} from '../dist/index.js';

async function world({ perTurns = 3, loop = false } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-turn-clock-'));
  const write = async (rel, text) => {
    await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await fs.writeFile(path.join(root, rel), text);
  };
  await write('world.json', JSON.stringify({
    id: 'turny', name: 'Turny', description: '', author: '', genre: 'test', createdAt: '', updatedAt: '',
    mode: 'closed',
    clock: { path: 'world/days.md', key: 'left', start: 3, label: 'hours', ...(perTurns ? { perTurns } : {}) },
    endings: [{ id: 'out', title: 'Out', path: 'endings/out/README.md' }],
    ...(loop ? { loop: { persist: { states: ['loop'], files: ['player/*.md'] } } } : {}),
    triggers: [
      { id: 'dusk', kind: 'clock', when: 'clock <= 2', do: 'dusk' },
      { id: 'last-step', kind: 'state', when: 'clock.left <= 1 && clock.turns >= 2', do: 'last-step' },
      ...(loop ? [{ id: 'fire', kind: 'clock', when: 'clock <= 0', do: 'fire' }] : []),
    ],
  }));
  await write('command/dusk.yaml', 'name: dusk\ndo:\n- action: set_state\n  with:\n    target: world\n    state: dusk\n    value: "true"\n');
  await write('command/last-step.yaml', 'name: last step\ndo:\n- action: set_state\n  with:\n    target: world\n    state: warned\n    value: "true"\n');
  await write('command/fire.yaml', 'name: fire\ndo:\n- action: loop_reset\n  with: {}\n');
  await write('endings/out/README.md', '---\ntype: readme\ntitle: Out\n---\nOut.\n');
  await write('world/README.md', [
    '---', 'type: readme', 'name: Map', 'states:',
    '- id: dusk', '  label: Dusk', '  type: flag', '  initial: false',
    '- id: warned', '  label: Warned', '  type: flag', '  initial: false',
    '---', '',
  ].join('\n'));
  await write('world/days.md', '---\ntype: chalk\ntitle: Days\nstatus:\n  data:\n    left: 3\n    turns: 0\n---\nDays.\n');
  await write('world/door.md', '---\ntype: chalk\ntitle: Door\nchoice:\n  options:\n  - id: knock\n    label: Knock\n---\nA door.\n');
  await write('world/kitchen/README.md', '---\ntype: readme\nname: Kitchen\n---\n');
  await write('world/kitchen/key.md', '---\ntype: note\ntitle: Key\n---\nAn iron key.\n');
  await write('player/README.md', '---\ntype: readme\ntitle: You\nstates:\n- id: loop\n  label: Loop\n  type: number\n  initial: 1\n  range: [1, 99]\n  hidden: true\n---\nYou.\n');
  if (loop) await prepareLoop(root);
  const store = new LocalWorldStore(root);
  let n = 0;
  const as = (actor) => createActionService(store, actor, { turn: `req:tc-${++n}` });
  const days = async () => parseFrontmatter(await store.readFile('world/days.md')).frontmatter.status.data;
  const worldState = async () => parseFrontmatter(await store.readFile('world/README.md')).frontmatter.status?.data ?? {};
  const knock = (actor = { type: 'player' }) => as(actor).chooseOption({ path: 'world/door.md', choice: 'knock' });
  return { root, store, as, days, worldState, knock };
}

test('turnClockOf / turnsSpentOf / the schema: perTurns is a whole number from 1 to 50', () => {
  assert.equal(turnClockOf({ clock: { path: 'world/days.md', key: 'left', start: 3, label: 'h' } }), null);
  assert.equal(turnClockOf({ clock: { path: 'world/days.md', key: 'left', start: 3, label: 'h', perTurns: 6 } }).perTurns, 6);
  assert.equal(turnsSpentOf({ turns: 4 }, 6), 4);
  assert.equal(turnsSpentOf({ turns: '2' }, 6), 2);
  assert.equal(turnsSpentOf({ turns: 9 }, 6), 5, 'clamped into the step');
  assert.equal(turnsSpentOf({}, 6), 0);
  const base = { id: 'x', name: 'x', description: '', author: '', genre: '', createdAt: '', updatedAt: '', layers: {}, characters: [] };
  const clock = (perTurns) => ({ ...base, clock: { path: 'world/days.md', key: 'left', start: 3, label: 'h', perTurns } });
  assert.equal(WorldManifestSchema.safeParse(clock(6)).success, true);
  assert.equal(WorldManifestSchema.safeParse(clock(0)).success, false);
  assert.equal(WorldManifestSchema.safeParse(clock(1.5)).success, false);
});

test('the player\'s own option is one turn; the writer\'s, god\'s and a world without perTurns are not', async () => {
  const { store, days, knock } = await world();
  try {
    const r = await knock();
    assert.deepEqual(r.details.turnClock, { turns: 1, perTurns: 3, ticked: false, left: 3 });
    assert.equal((await days()).turns, 1);
    await knock({ type: 'writer' });
    await knock({ type: 'god' });
    assert.equal((await days()).turns, 1, 'only the player\'s turns count');
    const edits = (await store.getEventsSince(0)).filter((e) => e.type === 'entity_edited' && e.subject === 'world/days.md');
    assert.equal(edits.length, 0, 'counting is bookkeeping: no event per turn');
  } finally {
    store.close();
  }
  const plain = await world({ perTurns: 0 });
  try {
    const r = await plain.knock();
    assert.equal(r.details.turnClock, undefined);
    assert.equal(await countPlayerTurn(plain.as({ type: 'player' }).ctx, 'request'), null);
    assert.equal((await plain.days()).turns, 0);
  } finally {
    plain.store.close();
  }
});

test('the perTurns-th turn ticks the clock, back to 0, and the clock triggers run', async () => {
  const { store, as, days, worldState, knock } = await world();
  try {
    await knock();
    await countPlayerTurn(as({ type: 'player' }).ctx, 'request');
    assert.equal(await clockLeft(store), 3);
    const third = await countPlayerTurn(as({ type: 'player' }).ctx, 'talk');
    assert.equal(third.ticked, true);
    assert.equal(third.left, 2);
    assert.deepEqual(third.triggers.map((t) => t.id), ['dusk']);
    assert.equal(await clockLeft(store), 2);
    assert.equal((await days()).turns, 0);
    assert.equal((await worldState()).dusk, true);
    const tick = (await store.getEventsSince(0)).filter((e) => e.type === 'entity_edited' && e.subject === 'world/days.md');
    assert.equal(tick.length, 1, 'the tick itself is one event');
    assert.equal(tick[0].actor.type, 'engine', 'the engine moved the clock, not the player');

    // clock.turns in a state trigger: the last step of the last hour.
    for (let i = 0; i < 3; i++) await knock(); // → left 1, turns 0
    assert.equal(await clockLeft(store), 1);
    await knock();
    assert.notEqual((await worldState()).warned, true);
    const last = await knock(); // turns 2 of 3
    assert.equal((await worldState()).warned, true, 'clock.turns >= 2 at the last hour');
    assert.ok(last.details.triggers.some((t) => t.id === 'last-step'));
  } finally {
    store.close();
  }
});

test('an ended world, or a clock at 0, does not count', async () => {
  const { store, as, days, knock } = await world();
  try {
    await endWorld(as({ type: 'engine' }).ctx, 'out');
    assert.equal(await countPlayerTurn(as({ type: 'player' }).ctx, 'request'), null);
    assert.equal((await days()).turns, 0);
    await assert.rejects(knock(), /ended/i);
  } finally {
    store.close();
  }
});

test('loop_reset: the first step starts from 0, and persist.files player/*.md keeps the whole bag', async () => {
  assert.equal(loopFileMatches(['player/*.md'], 'player/key.md'), true);
  assert.equal(loopFileMatches(['player/*.md'], 'player/README.md'), false);
  assert.equal(loopFileMatches(['player/shrine-*.md'], 'player/shrine-path-half.md'), true);
  assert.equal(loopFileMatches(['player/shrine-*.md'], 'player/key.md'), false);
  assert.equal(loopFileMatches(['player/key.md'], 'player/key.md'), true);
  assert.deepEqual(loopConfigProblems({ loop: { persist: { files: ['player/*.md', 'player/a-*.md'] } } }), []);
  assert.equal(loopConfigProblems({ loop: { persist: { files: ['world/*.md'] } } }).length, 1);

  const { root, store, as, days, knock } = await world({ loop: true });
  try {
    await as({ type: 'player' }).moveEntity({ from: 'world/kitchen/key.md', to: 'player/key.md' });
    await fs.writeFile(path.join(root, 'player/half-clue.md'), '---\ntype: note\ntitle: Half\n---\nThree cedars.\n');
    for (let i = 0; i < 8; i++) await knock(); // 3 × 3 − 1 turns: left 1, turns 2
    assert.equal(await clockLeft(store), 1);
    await knock(); // the ninth: left 0 → fire → loop_reset
    const p = parseFrontmatter(await store.readFile('player/README.md')).frontmatter.status.data;
    assert.equal(p.loop, 2);
    assert.equal(await clockLeft(store), 3, 'the first morning again');
    assert.equal((await days()).turns, 0, 'the count starts over');
    assert.ok(await store.readFile('player/key.md'), 'the key stays in the bag');
    assert.match(await store.readFile('player/half-clue.md'), /Three cedars/);
    const reset = (await store.getEventsSince(0)).filter((e) => e.type === 'loop_reset').at(-1);
    assert.deepEqual(reset.detail.kept.files.sort(), ['player/half-clue.md', 'player/key.md']);
  } finally {
    store.close();
  }
});
