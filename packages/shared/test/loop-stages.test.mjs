/**
 * Loop stages — what a new loop brings.
 *
 *   - `prepareLoop` moves the template's `loops/` out of the store's reach;
 *   - a reset lays every stage with from <= N <= until (and `when` true over
 *     the player's kept states) over the restored start, in declaration order:
 *     cumulative, ordered, conditional;
 *   - command/ and assets/ files a stage added are taken back before the next
 *     loop's stages; `stage.json` adds triggers and characters by id;
 *   - files an overlay may not touch are skipped (the player's, the root READMEs);
 *   - applying is idempotent; a world without stages / without loop is unchanged.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  LocalWorldStore,
  activeLoopStages,
  applyLoopStages,
  loopOverlayPathProblem,
  loopReset,
  mergeStageManifest,

  parseLoopConfig,
  prepareLoop,
  writeState,
} from '../dist/index.js';

const ENGINE = { type: 'engine' };

const STAGES = [
  { from: 2, overlay: 'loops/second' },
  { from: 2, until: 2, overlay: 'loops/only-two' },
  { from: 3, overlay: 'loops/third' },
  { from: 2, when: 'player.known_secret == true', overlay: 'loops/secret' },
];

async function world({ stages = STAGES, loop = true } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-loop-stages-'));
  const write = async (rel, text) => {
    await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await fs.writeFile(path.join(root, rel), text);
  };
  await write('world.json', JSON.stringify({
    id: 'loopy', name: 'Loopy', description: '', author: '', genre: 'test', createdAt: '', updatedAt: '',
    mode: 'closed',
    ...(loop ? { loop: { persist: { states: ['loop', 'known_*'] }, keep: ['player/message.md'], ...(stages ? { stages } : {}) } } : {}),
    characters: [{ id: 'ann', name: 'Ann', home: 'world/inn' }],
    triggers: [{ id: 'fire', kind: 'clock', when: 'clock <= 0', do: 'fire' }],
  }));
  await write('command/fire.yaml', 'name: fire\ndo:\n- action: loop_reset\n  with: {}\n');
  await write('world/README.md', '---\ntype: readme\nname: Map\n---\n');
  await write('world/inn/README.md', '---\ntype: readme\nname: Inn\n---\n');
  await write('world/inn/sign.md', '---\ntype: note\ntitle: Sign\n---\nA blank board.\n');
  await write('player/README.md', [
    '---', 'type: readme', 'title: You', 'states:',
    '- id: loop', '  label: Loop', '  type: number', '  initial: 1', '  range: [1, 99]', '  hidden: true',
    '- id: known_secret', '  label: The secret', '  type: flag', '  initial: false', '  hidden: true',
    '---', 'You.', '',
  ].join('\n'));
  await write('characters/ann/README.md', '---\ntype: readme\nname: Ann\n---\n');
  // loop 2+: the sign changes; a forbidden file rides along and must be skipped
  await write('loops/second/world/inn/sign.md', '---\ntype: note\ntitle: Sign\n---\nSomeone carved one notch.\n');
  await write('loops/second/player/README.md', '---\ntype: readme\ntitle: Forged\n---\n');
  await write('loops/second/player/message.md', 'forged\n');
  await write('loops/second/world/README.md', '---\ntype: readme\nname: Forged\n---\n');
  // loop 2 only: a command and a new guest (stage.json)
  await write('loops/only-two/command/early-guest.yaml', 'name: early guest\ndo:\n- action: tick\n  with:\n    by: \'-1\'\n');
  await write('loops/only-two/characters/bo/README.md', '---\ntype: readme\nname: Bo\n---\n');
  await write('loops/only-two/stage.json', JSON.stringify({
    characters: [{ id: 'bo', name: 'Bo', home: 'world/inn' }],
    triggers: [{ id: 'early', kind: 'place', when: { layer: 'world/inn' }, do: 'early-guest' }],
  }));
  // loop 3+: a later stage overrides an earlier one's file, and a room appears
  await write('loops/third/world/inn/sign.md', '---\ntype: note\ntitle: Sign\n---\nTwo notches now.\n');
  await write('loops/third/world/attic/README.md', '---\ntype: readme\nname: Attic\n---\n');
  // gated by what the player learned
  await write('loops/secret/world/inn/hidden-door.md', '---\ntype: note\ntitle: A door\n---\nBehind the shelf.\n');
  if (loop) assert.equal(await prepareLoop(root), true);
  const store = new LocalWorldStore(root);
  return { root, store, write };
}

const exists = (root, rel) => fs.stat(path.join(root, rel)).then(() => true, () => false);
const text = (root, rel) => fs.readFile(path.join(root, rel), 'utf8');
const reset = (store, turn) => loopReset({ store, actor: ENGINE, turn });

test('prepareLoop moves loops/ out of the store\'s reach', async () => {
  const { root, store } = await world();
  try {
    assert.equal(await exists(root, 'loops'), false);
    assert.ok(await exists(root, '.airpworld/loops/second/world/inn/sign.md'));
    await assert.rejects(store.readFile('.airpworld/loops/second/world/inn/sign.md'), /reserved directory/);
    assert.equal(await prepareLoop(root), false, 'idempotent');
    assert.ok(await exists(root, '.airpworld/loops/third/world/attic/README.md'));
    // the loop-start snapshot is the template's loop 1: nothing of the stages in it
    assert.match(await text(root, 'world/inn/sign.md'), /A blank board/);
  } finally {
    store.close();
  }
});

test('stages: ordered, cumulative, until, and taken back; stage.json adds a guest and a trigger', async () => {
  const { root, store } = await world();
  try {
    const two = await reset(store, 'req:2');
    assert.equal(two.loop, 2);
    assert.deepEqual(two.stages, ['loops/second', 'loops/only-two']);
    assert.match(await text(root, 'world/inn/sign.md'), /one notch/);
    assert.equal(await exists(root, 'world/attic/README.md'), false, 'loop 3 content is not in loop 2');
    assert.ok(await exists(root, 'command/early-guest.yaml'));
    const m2 = JSON.parse(await text(root, 'world.json'));
    assert.deepEqual(m2.characters.map((c) => c.id), ['ann', 'bo']);
    assert.deepEqual(m2.triggers.map((t) => t.id), ['fire', 'early']);
    assert.equal(store.getPresenceOf('bo')?.layer, 'world/inn', 'a stage\'s new character is seated at home');
    // forbidden files were skipped: the player's things and the root READMEs
    assert.match(await text(root, 'player/README.md'), /title: You/);
    assert.match(await text(root, 'world/README.md'), /name: Map/);
    assert.equal(await exists(root, 'player/message.md'), false);
    const event = (await store.getEventsSince(0)).find((e) => e.type === 'loop_reset');
    assert.deepEqual(event.detail.stages, ['loops/second', 'loops/only-two']);

    const three = await reset(store, 'req:3');
    assert.deepEqual(three.stages, ['loops/second', 'loops/third']);
    assert.match(await text(root, 'world/inn/sign.md'), /Two notches/, 'a later stage wins over an earlier one');
    assert.ok(await exists(root, 'world/attic/README.md'));
    assert.equal(await exists(root, 'command/early-guest.yaml'), false, 'an added command is taken back when its stage ends');
    assert.equal(await exists(root, 'characters/bo/README.md'), false);
    const m3 = JSON.parse(await text(root, 'world.json'));
    assert.deepEqual(m3.characters.map((c) => c.id), ['ann']);
    assert.deepEqual(m3.triggers.map((t) => t.id), ['fire']);
    assert.equal(store.getPresenceOf('bo') ?? null, null, 'the loop-2-only guest is gone');
  } finally {
    store.close();
  }
});

test('stages: `when` unlocks by what the player kept, not only by the count', async () => {
  const { root, store } = await world();
  try {
    await reset(store, 'req:2');
    assert.equal(await exists(root, 'world/inn/hidden-door.md'), false, 'not known yet');
    await writeState({ store, actor: ENGINE, turn: 'req:learn' }, { target: 'player', state: 'known_secret', value: true });
    const three = await reset(store, 'req:3');
    assert.deepEqual(three.stages, ['loops/second', 'loops/third', 'loops/secret']);
    assert.ok(await exists(root, 'world/inn/hidden-door.md'));
  } finally {
    store.close();
  }
});

test('stages: idempotent — same turn reused, a second application writes the same bytes', async () => {
  const { root, store } = await world();
  try {
    await reset(store, 'req:2');
    const snap = async () => Promise.all(['world.json', 'world/inn/sign.md', 'command/early-guest.yaml'].map((f) => text(root, f)));
    const before = await snap();
    const again = await reset(store, 'req:2');
    assert.equal(again.reused, true);
    assert.deepEqual(again.stages, ['loops/second', 'loops/only-two']);
    const loop = parseLoopConfig(JSON.parse(await text(root, 'world.json')));
    await applyLoopStages(store, loop, 2);
    assert.deepEqual(await snap(), before);
  } finally {
    store.close();
  }
});

test('a world without stages, or without loop, is unchanged', async () => {
  const plain = await world({ stages: null });
  try {
    const r = await reset(plain.store, 'req:2');
    assert.deepEqual(r.stages, []);
    assert.match(await text(plain.root, 'world/inn/sign.md'), /A blank board/);
    assert.equal((await plain.store.getEventsSince(0)).find((e) => e.type === 'loop_reset').detail.stages, undefined);
  } finally {
    plain.store.close();
  }
  const none = await world({ loop: false });
  try {
    assert.equal(await prepareLoop(none.root), false);
    assert.ok(await exists(none.root, 'loops/second/world/inn/sign.md'), 'prepareLoop leaves a non-loop world alone');
  } finally {
    none.store.close();
  }
});

test('pure parts: stage selection, path rules, manifest merge', () => {
  const values = new Map([['player.known_secret', false], ['player.loop', 4]]);
  assert.deepEqual(activeLoopStages({ stages: STAGES }, 1, values), []);
  assert.deepEqual(activeLoopStages({ stages: STAGES }, 4, values).map((s) => s.overlay), ['loops/second', 'loops/third']);
  values.set('player.known_secret', true);
  assert.deepEqual(activeLoopStages({ stages: STAGES }, 4, values).map((s) => s.overlay), ['loops/second', 'loops/third', 'loops/secret']);
  assert.deepEqual(activeLoopStages({ stages: [{ from: 2, when: 'player.nope == true', overlay: 'loops/x' }] }, 2, values), [], 'unresolved = not this loop');

  const loop = { files: ['player/message.md'] };
  assert.equal(loopOverlayPathProblem('world/inn/x.md', loop), null);
  assert.equal(loopOverlayPathProblem('stage.json', loop), null);
  assert.equal(loopOverlayPathProblem('command/a.yaml', loop), null);
  for (const bad of ['world.json', 'world/README.md', 'player/README.md', 'player/message.md', 'world/inn/player-note-1.md', 'variants/a/b/x.md', 'skills/x.md', 'world/.pi/x', 'command/A.txt']) {
    assert.ok(loopOverlayPathProblem(bad, loop), bad);
  }

  const merged = mergeStageManifest({ triggers: [{ id: 'a', x: 1 }, { id: 'b' }] }, { triggers: [{ id: 'a', x: 2 }, { id: 'c' }], characters: [{ id: 'z' }] });
  assert.deepEqual(merged, { triggers: [{ id: 'a', x: 2 }, { id: 'b' }, { id: 'c' }], characters: [{ id: 'z' }] });

  assert.equal(parseLoopConfig({ loop: { stages: [{ from: 1, overlay: 'loops/a' }] } }), null, 'from 1 is the template itself');
  assert.equal(parseLoopConfig({ loop: { stages: [{ from: 2, overlay: 'world/a' }] } }), null);
  assert.equal(parseLoopConfig({ loop: { stages: [{ from: 2, when: 'world.x == 1', overlay: 'loops/a' }] } }), null, 'only player.* is read');
  assert.equal(parseLoopConfig({ loop: { stages: [{ from: 3, until: 2, overlay: 'loops/a' }] } }), null);
  assert.deepEqual(parseLoopConfig({ loop: {} }).stages, []);

});
