/**
 * Loop reset — the engine half.
 *
 *   - `prepareLoop` takes the `loop-start` snapshot once;
 *   - `loop_reset` puts the world files back (cards, items, backgrounds,
 *     trigger_log, clock, character files), keeps the player's notes and board
 *     byte for byte, keeps the declared player states and files, bumps
 *     `player.loop`, forgets character threads and re-seats characters at home,
 *     and lands ONE `loop_reset` event that every reader starts from;
 *   - a reset fired by a trigger does not write the old loop's trigger_log back;
 *   - twice in one turn = once; ended / non-loop worlds refuse;
 *   - rollback keeps the notes in a loop world and is unchanged elsewhere;
 *   - the writer's `loop` section says which loop and what the player knows.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  LocalWorldStore,
  WRITER_SECTIONS,
  CHARACTER_SECTIONS,
  clockLeft,
  createActionService,
  endWorld,
  eventsThisLoop,
  sinceLoopStart,
  loopReset,
  parseFrontmatter,
  prepareLoop,
  readTriggerLog,
  renderEvent,
  runEffect,
  runWorldTriggers,
  updatePlayerBoard,
  writePlayerNote,
  writeState,
} from '../dist/index.js';
import { collectSections, makeSectionDeps } from '../dist/inject/collect.js';

const ENGINE = { type: 'engine' };

async function world({ loop = true } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-loop-'));
  const write = async (rel, text) => {
    await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await fs.writeFile(path.join(root, rel), text);
  };
  await write('world.json', JSON.stringify({
    id: 'loopy', name: 'Loopy', description: '', author: '', genre: 'test', createdAt: '', updatedAt: '',
    mode: 'closed',
    clock: { path: 'world/days.md', key: 'left', start: 3, label: 'hours' },
    endings: [{ id: 'out', title: 'Out', path: 'endings/out/README.md' }],
    ...(loop ? { loop: { persist: { notes: true, board: true, states: ['loop', 'known_*'] }, keep: ['player/message.md'] } } : {}),
    characters: [{ id: 'ann', name: 'Ann', home: 'world/inn' }],
    triggers: [
      { id: 'dusk', kind: 'clock', when: 'clock <= 2', do: 'dusk' },
      { id: 'fire', kind: 'clock', when: 'clock <= 0', do: 'fire' },
    ],
  }));
  await write('command/dusk.yaml', 'name: dusk\ndo:\n- action: set_state\n  with:\n    target: world\n    state: dusk\n    value: "true"\n');
  await write('command/fire.yaml', 'name: fire\ndo:\n- action: loop_reset\n  with: {}\n');
  await write('endings/out/README.md', '---\ntype: readme\ntitle: Out\n---\nOut.\n');
  await write('world/README.md', '---\ntype: readme\nname: Map\nstates:\n- id: dusk\n  label: Dusk\n  type: flag\n  initial: false\n---\n');
  await write('world/days.md', '---\ntype: chalk\ntitle: Days\nstatus:\n  data:\n    left: 3\n---\nDays.\n');
  await write('world/inn/README.md', '---\ntype: readme\nname: Inn\n---\n');
  await write('world/inn/ledger.md', '---\ntype: note\ntitle: Ledger\n---\nThe guest book.\n');
  await write('world/kitchen/README.md', '---\ntype: readme\nname: Kitchen\n---\n');
  await write('world/kitchen/key.md', '---\ntype: note\ntitle: Key\n---\nAn iron key.\n');
  await write('player/README.md', [
    '---', 'type: readme', 'title: You', 'states:',
    '- id: loop', '  label: Loop', '  type: number', '  initial: 1', '  range: [1, 99]', '  hidden: true',
    '- id: known_secret', '  label: The innkeeper secret', '  type: flag', '  initial: false', '  hidden: true',
    '- id: hp', '  label: Health', '  type: number', '  initial: 3', '  range: [0, 3]',
    '---', 'You.', '',
  ].join('\n'));
  await write('characters/ann/README.md', '---\ntype: readme\nname: Ann\n---\n');
  await write('characters/ann/memory.md', 'Ann has never met you.\n');
  await write('characters/ann/.pi/memory.json', '{"talk":"old"}');
  if (loop) assert.equal(await prepareLoop(root), true);
  const store = new LocalWorldStore(root);
  const svc = (actor = { type: 'player' }, turn = `req:${Math.random()}`) => createActionService(store, actor, { turn });
  return { root, store, svc, write };
}

const read = (root, rel) => fs.readFile(path.join(root, rel));
const exists = (root, rel) => fs.stat(path.join(root, rel)).then(() => true, () => false);

/** Play one loop: annotate, take the key, learn something, talk, let time run out. */
async function playOneLoop(w, turn = 'req:fire') {
  const { root, store, svc, write } = w;
  const player = svc();
  await writePlayerNote(player.ctx, { op: 'create', layer: 'world/inn', text: 'Ann flinched at the word "fire".' });
  await writePlayerNote(player.ctx, { op: 'create', layer: 'world/kitchen', text: 'The key was under the sink.' });
  await updatePlayerBoard(player.ctx, { op: 'link', from: 'world/inn/player-note-1.md', to: 'world/inn/ledger.md', label: 'name' });
  await updatePlayerBoard(player.ctx, { op: 'tag', path: 'world/kitchen/key.md', tag: 'suspect' });
  await svc({ type: 'god' }).moveEntity({ from: 'world/kitchen/key.md', to: 'player/key.md' });
  const engine = { store, actor: ENGINE, turn: 'req:learn' };
  await writeState(engine, { target: 'player', state: 'known_secret', value: true });
  await writeState(engine, { target: 'player', state: 'hp', value: 1 });
  await write('player/message.md', '---\ntype: letter\ntitle: Message\n---\nTell her about the oil.\n');
  await write('characters/ann/memory.md', 'Ann told you everything.\n');
  await write('.airpworld/sessions/char-ann.jsonl', '{"type":"session"}\n');
  await write('.airpworld/sessions/writer.jsonl', '{"type":"session"}\n');
  await store.deletePresence('ann').catch(() => {});
  await svc(ENGINE).moveCharacter({ character: 'ann', destination: 'world/kitchen' });

  const ctx = { store, actor: { type: 'player' }, turn };
  await runEffect(ctx, { action: 'tick', by: -1 });
  await runWorldTriggers(ctx, { kind: 'action', action: 'tick' });
  assert.equal((await readTriggerLog(store)).dusk?.status, 'done', 'dusk fired in loop 1');
  const before = {
    note1: await read(root, 'world/inn/player-note-1.md'),
    note2: await read(root, 'world/kitchen/player-note-1.md'),
    board: await read(root, 'player-board.json'),
  };
  await runEffect(ctx, { action: 'tick', by: -2 });
  await runWorldTriggers(ctx, { kind: 'action', action: 'tick' });
  return before;
}

test('prepareLoop: one loop-start snapshot per save; nothing for a world without loop', async () => {
  const w = await world();
  try {
    assert.ok(await exists(w.root, '.airpworld/snapshots/loop-start.zip'));
    assert.equal(await prepareLoop(w.root), false, 'idempotent');
    const plain = await world({ loop: false });
    assert.equal(await prepareLoop(plain.root), false);
    assert.equal(await exists(plain.root, '.airpworld/snapshots/loop-start.zip'), false);
    plain.store.close();
  } finally {
    w.store.close();
  }
});

test('loop_reset: the world goes back, the player keeps notes, board, known_* and declared files; loop 2', async () => {
  const w = await world();
  const { root, store } = w;
  try {
    await store.writeCursor('writer', 0); // a writer that has read nothing yet
    const before = await playOneLoop(w);

    // notes and board, byte for byte
    assert.deepEqual(await read(root, 'world/inn/player-note-1.md'), before.note1);
    assert.deepEqual(await read(root, 'world/kitchen/player-note-1.md'), before.note2);
    assert.deepEqual(await read(root, 'player-board.json'), before.board);
    // world files restored
    assert.ok(await exists(root, 'world/kitchen/key.md'), 'the key is back in the kitchen');
    assert.equal(await exists(root, 'player/key.md'), false);
    assert.equal(await clockLeft(store), 3, 'the clock is back at its start');
    assert.equal(await read(root, 'characters/ann/memory.md').then(String), 'Ann has never met you.\n');
    assert.equal(await exists(root, 'characters/ann/.pi/memory.json'), false, 'a character\'s nested memory store goes');
    const worldFm = parseFrontmatter(await store.readFile('world/README.md')).frontmatter;
    assert.equal(worldFm.status?.data?.dusk, undefined, 'world states are the loop start\'s');
    assert.deepEqual(Object.keys(worldFm.trigger_log ?? {}), [], 'the restored trigger_log is not overwritten by the old loop\'s');
    // player: kept and bumped
    const player = parseFrontmatter(await store.readFile('player/README.md')).frontmatter.status.data;
    assert.equal(player.loop, 2);
    assert.equal(player.known_secret, true);
    assert.equal(player.hp, undefined, 'an undeclared-for-loop state goes back');
    assert.match(String(await read(root, 'player/message.md')), /Tell her about the oil/);
    // characters: no thread, at home
    assert.equal(await exists(root, '.airpworld/sessions/char-ann.jsonl'), false);
    assert.ok(await exists(root, '.airpworld/sessions/writer.jsonl'), 'the writer\'s thread is the server\'s to retire');
    assert.equal(store.getPresenceOf('ann')?.layer, 'world/inn');
    // one event, every reader starts from it
    const events = await store.getEventsSince(0);
    const resets = events.filter((e) => e.type === 'loop_reset');
    assert.equal(resets.length, 1);
    assert.equal(resets[0].detail.loop, 2);
    assert.deepEqual(resets[0].detail.kept, { notes: 2, links: 1, states: ['known_secret'], files: ['player/message.md'] });
    assert.equal(await store.readCursor('writer'), resets[0].seq, 'the old loop is behind every reader (same flush as a rollback)');
    assert.match(renderEvent(resets[0], { layerNames: {} }), /loop 2 begins/);

    // the next loop plays: dusk fires again
    const ctx = { store, actor: { type: 'player' }, turn: 'req:loop2' };
    await runEffect(ctx, { action: 'tick', by: -1 });
    await runWorldTriggers(ctx, { kind: 'action', action: 'tick' });
    assert.equal((await readTriggerLog(store)).dusk?.status, 'done', 'dusk re-armed in loop 2');
  } finally {
    store.close();
  }
});

test('loop_reset: once per turn; refused when ended or without loop; missing snapshot is an error', async () => {
  const w = await world();
  try {
    const ctx = { store: w.store, actor: ENGINE, turn: 'req:same' };
    const first = await loopReset(ctx);
    const again = await runEffect(ctx, { action: 'loop_reset' });
    assert.equal(first.loop, 2);
    assert.equal(again[0].reused, true);
    const player = parseFrontmatter(await w.store.readFile('player/README.md')).frontmatter.status.data;
    assert.equal(player.loop, 2, 'the same turn does not loop twice');
    assert.equal((await w.store.getEventsSince(0)).filter((e) => e.type === 'loop_reset').length, 1);

    await endWorld({ store: w.store, actor: ENGINE, turn: 'req:end' }, 'out');
    const ended = await runEffect({ store: w.store, actor: ENGINE, turn: 'req:after' }, { action: 'loop_reset' });
    assert.equal(ended[0].ok, false);
    assert.equal(ended[0].code, 'game_ended');
  } finally {
    w.store.close();
  }
  const plain = await world({ loop: false });
  try {
    const r = await runEffect({ store: plain.store, actor: ENGINE, turn: 'req:x' }, { action: 'loop_reset' });
    assert.equal(r[0].code, 'unsupported');
  } finally {
    plain.store.close();
  }
  const bare = await world();
  try {
    await fs.rm(path.join(bare.root, '.airpworld/snapshots/loop-start.zip'));
    const r = await runEffect({ store: bare.store, actor: ENGINE, turn: 'req:y' }, { action: 'loop_reset' });
    assert.equal(r[0].code, 'not_found');
  } finally {
    bare.store.close();
  }
});

test('a note on a layer that did not survive the reset moves to the root layer', async () => {
  const w = await world();
  try {
    await w.write('world/attic/README.md', '---\ntype: readme\nname: Attic\n---\n');
    await writePlayerNote(w.svc().ctx, { op: 'create', layer: 'world/attic', text: 'The attic was never here.' });
    const r = await loopReset({ store: w.store, actor: ENGINE, turn: 'req:attic' });
    assert.equal(await exists(w.root, 'world/attic'), false);
    assert.match(String(await read(w.root, 'world/player-note-1.md')), /never here/);
    assert.deepEqual(r.dropped, ['world/attic/player-note-1.md → world/player-note-1.md']);
  } finally {
    w.store.close();
  }
});

test('rollback: a loop world keeps the player\'s notes; elsewhere notes go back with the snapshot', async () => {
  for (const loop of [true, false]) {
    const w = await world({ loop });
    try {
      const god = w.svc({ type: 'god' }, 'req:snap');
      const snap = await god.snapshotWorld({ reason: 'before notes' });
      await writePlayerNote(w.svc().ctx, { op: 'create', layer: 'world/inn', text: 'written after the snapshot' });
      const back = await god.rollbackWorld({ snapshot: snap.details.snapshot });
      assert.equal(await exists(w.root, 'world/inn/player-note-1.md'), loop, `loop=${loop}`);
      assert.deepEqual(back.details.kept, loop ? ['world/inn/player-note-1.md'] : []);
      if (!loop) {
        // the explicit option works in any world
        await writePlayerNote(w.svc().ctx, { op: 'create', layer: 'world/inn', text: 'again' });
        await god.rollbackWorld({ snapshot: snap.details.snapshot, keep: 'player-annotations' });
        assert.ok(await exists(w.root, 'world/inn/player-note-1.md'));
      }
      // the loop-start snapshot is a rollback target too (loop worlds)
      if (loop) {
        await god.rollbackWorld({ snapshot: 'loop-start' });
        assert.ok(await exists(w.root, 'world/inn/player-note-1.md'));
      }
    } finally {
      w.store.close();
    }
  }
});

test('writer section `loop`: which loop and what the player knows; none for characters or loop 1 with nothing known', async () => {
  const w = await world();
  try {
    const sections = async (specs, actor, reader) => collectSections(await makeSectionDeps({ store: w.store, actor, reader, specs }));
    assert.ok(!(await sections(WRITER_SECTIONS, { type: 'writer' }, 'writer')).some((s) => s.key === 'loop'));
    await writeState({ store: w.store, actor: ENGINE, turn: 't' }, { target: 'player', state: 'known_secret', value: true });
    await loopReset({ store: w.store, actor: ENGINE, turn: 'req:recap' });
    const loop = (await sections(WRITER_SECTIONS, { type: 'writer' }, 'writer')).find((s) => s.key === 'loop');
    assert.ok(loop);
    assert.match(loop.text, /^Loop 2: /);
    assert.match(loop.text, /The innkeeper secret/);
    assert.ok(!(await sections(CHARACTER_SECTIONS, { type: 'character', id: 'ann' }, 'character:ann')).some((s) => s.key === 'loop'));
  } finally {
    w.store.close();
  }
});

test('eventsThisLoop: rules that read "already done" from the log read the current loop only', async () => {
  const ev = (seq, type) => ({ seq, type });
  assert.deepEqual(sinceLoopStart([ev(1, 'entity_created'), ev(2, 'entity_moved')]).map((e) => e.seq), [1, 2], 'never looped: the whole log');
  assert.deepEqual(sinceLoopStart([ev(1, 'entity_created'), ev(2, 'loop_reset'), ev(3, 'entity_moved'), ev(4, 'loop_reset'), ev(5, 'roll_resolved')]).map((e) => e.seq), [5]);
  assert.deepEqual(sinceLoopStart([ev(1, 'entity_created'), ev(2, 'world_rolled_back'), ev(3, 'entity_moved')]).map((e) => e.seq), [1, 2, 3], 'a rollback is not a boundary');
  const w = await world();
  try {
    await w.svc({ type: 'god' }).createEntity({ path: 'world/inn/found.md', frontmatter: { type: 'note' }, body: 'found' });
    assert.ok((await eventsThisLoop(w.store)).some((e) => e.type === 'entity_created'));
    await loopReset({ store: w.store, actor: ENGINE, turn: 'req:history' });
    assert.ok(!(await eventsThisLoop(w.store)).some((e) => e.type === 'entity_created'), 'the find of loop 1 is not this loop\'s');
  } finally {
    w.store.close();
  }
});
