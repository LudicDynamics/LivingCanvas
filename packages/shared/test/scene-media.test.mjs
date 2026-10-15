/**
 * Scene media — the `show_cg` / `swap_background` command effects
 *.
 *
 * Every write goes through the real store and the real command runner, so the
 * files (README `bg:`, `cg_log`), the events and the rollback are the real ones.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  LocalWorldStore,
  createActionService,
  parseFrontmatter,
  parseWorldCommand,
  parseWorldTriggers,
  runEffect,
  readCgLog,
  readTriggerLog,
  sceneMediaPathProblem,
  layerReadmeOf,
  parseCgLog,
  renderEvent,
  EventDetailSchemas,
  WORLD_COMMAND_EFFECTS,
  WORLD_COMMAND_EFFECT_ARGS,
  WORLD_COMMAND_EFFECT_EVENTS,
  RESERVED_FRONTMATTER_KEYS,
} from '../dist/index.js';

const GOD = { type: 'god' };
const PLAYER = { type: 'player' };
const WRITER = { type: 'writer' };

async function world({ triggers = [], commands = {} } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-scene-media-'));
  const store = new LocalWorldStore(root);
  const write = (rel, text) => store.writeFile(rel, text);
  await write('world.json', JSON.stringify({
    id: 'w', name: 'W', description: '', author: '', genre: 'test', characters: [], mode: 'open',
    triggers,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  }));
  await write('world/README.md', '---\nname: Street\ntype: readme\nbg: assets/bg/street.webp\n---\n\n# Street\n');
  await write('world/inn/README.md', '---\nname: Inn\ntype: readme\nbg: assets/bg/inn.webp\nbgVideo: assets/bg/inn.mp4\n---\n\n# Inn\n');
  for (const f of ['assets/bg/street.webp', 'assets/bg/inn.webp', 'assets/bg/inn-burnt.webp', 'assets/cg/fire.webp', 'assets/cg/dawn.png']) await write(f, 'img');
  for (const [id, yaml] of Object.entries(commands)) await write(`command/${id}.yaml`, yaml);
  return { store, write, root };
}

const ctxOf = (store, actor = GOD, turn = 'req:t1') => createActionService(store, actor, { turn }).ctx;
const fmOf = async (store, p) => parseFrontmatter(await store.readFile(p)).frontmatter;
const eventsOf = async (store, type) => (await store.getEvents(100)).filter((e) => e.type === type);

test('the effect registry knows show_cg and swap_background (args, one event each)', () => {
  for (const name of ['show_cg', 'swap_background']) assert.ok(WORLD_COMMAND_EFFECTS.includes(name), name);
  assert.deepEqual(WORLD_COMMAND_EFFECT_ARGS.show_cg.required, ['path']);
  assert.deepEqual(WORLD_COMMAND_EFFECT_ARGS.swap_background.required, ['layer', 'path']);
  assert.equal(WORLD_COMMAND_EFFECT_EVENTS.show_cg, 1);
  assert.equal(WORLD_COMMAND_EFFECT_EVENTS.swap_background, 1);
  assert.ok(RESERVED_FRONTMATTER_KEYS.includes('cg_log'));
  assert.ok(EventDetailSchemas.cg_shown.safeParse({ path: 'assets/cg/a.webp', first: true }).success);
  assert.ok(EventDetailSchemas.background_swapped.safeParse({ layer: 'map', name: 'M', path: 'assets/bg/a.webp' }).success);
  // Write-time validation: required args, unknown args.
  assert.ok(parseWorldCommand('a', 'name: A\ndo:\n  - action: show_cg\n    with:\n      path: assets/cg/fire.webp\n      caption: 火\n      once: "false"\n').ok);
  assert.equal(parseWorldCommand('b', 'name: B\ndo:\n  - action: swap_background\n    with:\n      path: assets/bg/x.webp\n').ok, false);
  assert.equal(parseWorldCommand('c', 'name: C\ndo:\n  - action: show_cg\n    with:\n      path: assets/cg/fire.webp\n      size: big\n').ok, false);
});

test('path shape: only existing pictures under assets/ (cg: images; background: images or video)', () => {
  assert.equal(sceneMediaPathProblem('assets/cg/a.webp', 'cg'), null);
  assert.equal(sceneMediaPathProblem('.airpworld/assets/gen/a.png', 'cg'), null);
  assert.equal(sceneMediaPathProblem('assets/bg/a.mp4', 'background'), null);
  assert.match(sceneMediaPathProblem('assets/bg/a.mp4', 'cg'), /not an image/);
  assert.match(sceneMediaPathProblem('world/a.md', 'cg'), /under assets/);
  assert.match(sceneMediaPathProblem('assets/../world.json', 'cg'), /without "\.\."/);
  assert.match(sceneMediaPathProblem('', 'background'), /required/);
  assert.deepEqual(layerReadmeOf('map'), { layer: 'map', readme: 'world/README.md' });
  assert.deepEqual(layerReadmeOf('world/inn/'), { layer: 'world/inn', readme: 'world/inn/README.md' });
  assert.equal(layerReadmeOf('player'), null);
  assert.equal(layerReadmeOf('world/../x'), null);
});

test('show_cg: records the CG in cg_log, appends cg_shown, and once (default) skips a repeat', async () => {
  const { store } = await world();
  const ctx = ctxOf(store);
  const [first] = await runEffect(ctx, { action: 'show_cg', path: 'assets/cg/fire.webp', caption: '客栈起火了。' });
  assert.equal(first.ok, true);
  assert.equal(first.event.type, 'cg_shown');
  assert.deepEqual(first.event.detail, { path: 'assets/cg/fire.webp', caption: '客栈起火了。', first: true });
  const log = await readCgLog(store);
  assert.deepEqual(log.map((e) => [e.path, e.caption, e.turn]), [['assets/cg/fire.webp', '客栈起火了。', 'req:t1']]);
  // once (default true): a replay writes nothing and lands no event.
  const [again] = await runEffect(ctx, { action: 'show_cg', path: 'assets/cg/fire.webp' });
  assert.equal(again.ok, true);
  assert.equal(again.reused, true);
  assert.equal(again.event, undefined);
  assert.equal((await eventsOf(store, 'cg_shown')).length, 1);
  // once: "false" shows it again (a second event), without duplicating the log entry.
  const [forced] = await runEffect(ctx, { action: 'show_cg', path: 'assets/cg/fire.webp', once: 'false' });
  assert.equal(forced.event.detail.first, false);
  await runEffect(ctx, { action: 'show_cg', path: 'assets/cg/dawn.png' });
  assert.deepEqual((await readCgLog(store)).map((e) => e.path), ['assets/cg/fire.webp', 'assets/cg/dawn.png']);
  assert.equal((await eventsOf(store, 'cg_shown')).length, 3);
  // The writer reads the caption, never the file path.
  const said = renderEvent(first.event, { layerNames: {} });
  assert.match(said, /客栈起火了。/);
  assert.doesNotMatch(said, /assets\//);
});

test('show_cg refuses a missing picture, a non-asset path and a bad once — with the world untouched', async () => {
  const { store } = await world();
  const ctx = ctxOf(store);
  const before = await store.readFile('world/README.md');
  const [missing] = await runEffect(ctx, { action: 'show_cg', path: 'assets/cg/nope.webp' });
  assert.equal(missing.ok, false);
  assert.equal(missing.code, 'not_found');
  const [outside] = await runEffect(ctx, { action: 'show_cg', path: 'world/README.md' });
  assert.equal(outside.code, 'invalid_argument');
  const [badOnce] = await runEffect(ctx, { action: 'show_cg', path: 'assets/cg/fire.webp', once: 'maybe' });
  assert.equal(badOnce.code, 'invalid_argument');
  assert.equal(await store.readFile('world/README.md'), before);
  assert.equal((await eventsOf(store, 'cg_shown')).length, 0);
});

test('swap_background: writes the layer README bg (dropping the old bgVideo), appends background_swapped, reuses the same picture', async () => {
  const { store } = await world();
  const ctx = ctxOf(store);
  const [r] = await runEffect(ctx, { action: 'swap_background', layer: 'world/inn', path: 'assets/bg/inn-burnt.webp' });
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.path, 'world/inn/README.md');
  assert.deepEqual(r.event.detail, { layer: 'world/inn', name: 'Inn', path: 'assets/bg/inn-burnt.webp', from: 'assets/bg/inn.webp' });
  assert.equal(r.event.layer, 'world/inn');
  const fm = await fmOf(store, 'world/inn/README.md');
  assert.equal(fm.bg, 'assets/bg/inn-burnt.webp');
  assert.equal(fm.bgVideo, undefined);
  assert.equal(fm.name, 'Inn', 'the rest of the README is kept');
  const [same] = await runEffect(ctx, { action: 'swap_background', layer: 'world/inn', path: 'assets/bg/inn-burnt.webp' });
  assert.equal(same.reused, true);
  assert.equal((await eventsOf(store, 'background_swapped')).length, 1);
  // The root layer is `map` (world/README.md).
  const [root] = await runEffect(ctx, { action: 'swap_background', layer: 'map', path: 'assets/bg/inn.webp' });
  assert.equal(root.ok, true);
  assert.equal((await fmOf(store, 'world/README.md')).bg, 'assets/bg/inn.webp');
  assert.match(renderEvent(root.event, { layerNames: {} }), /Street changed/);
});

test('swap_background refuses an unknown layer, a missing picture and a non-layer target', async () => {
  const { store } = await world();
  const ctx = ctxOf(store);
  const [noLayer] = await runEffect(ctx, { action: 'swap_background', layer: 'world/cellar', path: 'assets/bg/inn.webp' });
  assert.equal(noLayer.code, 'not_found');
  const [noPic] = await runEffect(ctx, { action: 'swap_background', layer: 'world/inn', path: 'assets/bg/nope.webp' });
  assert.equal(noPic.code, 'not_found');
  const [player] = await runEffect(ctx, { action: 'swap_background', layer: 'player', path: 'assets/bg/inn.webp' });
  assert.equal(player.code, 'invalid_argument');
  assert.equal((await fmOf(store, 'world/inn/README.md')).bg, 'assets/bg/inn.webp');
});

test('persistence: a reload reads the new bg and the seen CGs back from the files; a rollback undoes both', async () => {
  const { store, root } = await world();
  const god = createActionService(store, GOD, { turn: 'req:snap' });
  const snap = await god.snapshotWorld({ reason: 'before the fire' });
  const ctx = ctxOf(store);
  await runEffect(ctx, { action: 'swap_background', layer: 'world/inn', path: 'assets/bg/inn-burnt.webp' });
  await runEffect(ctx, { action: 'show_cg', path: 'assets/cg/fire.webp' });
  // "Reload": a fresh store over the same directory.
  const reopened = new LocalWorldStore(root);
  assert.equal((await fmOf(reopened, 'world/inn/README.md')).bg, 'assets/bg/inn-burnt.webp');
  assert.deepEqual((await readCgLog(reopened)).map((e) => e.path), ['assets/cg/fire.webp']);
  await god.rollbackWorld({ snapshot: snap.details.snapshot });
  assert.equal((await fmOf(store, 'world/inn/README.md')).bg, 'assets/bg/inn.webp');
  assert.equal((await fmOf(store, 'world/inn/README.md')).bgVideo, 'assets/bg/inn.mp4');
  assert.deepEqual(await readCgLog(store), []);
  // After the rollback the CG is new again (once is answered from the file).
  const [again] = await runEffect(ctxOf(store, GOD, 'req:t2'), { action: 'show_cg', path: 'assets/cg/fire.webp' });
  assert.equal(again.event.detail.first, true);
});

test('cg_log is engine bookkeeping: commands cannot write it, agents cannot edit it; god can', async () => {
  const { store } = await world();
  const ctx = ctxOf(store);
  const [edit] = await runEffect(ctx, { action: 'edit', path: 'world/README.md', frontmatter: { cg_log: [] } });
  assert.equal(edit.code, 'invalid_argument');
  await assert.rejects(
    () => createActionService(store, WRITER, { turn: 'turn:w' }).editEntity({ path: 'world/README.md', frontmatter: { cg_log: [] } }),
    (e) => e.code === 'invalid_argument',
  );
  assert.deepEqual(parseCgLog([{ path: 'assets/cg/a.webp', at: 'x' }, { nope: 1 }, 'x']).map((e) => e.path), ['assets/cg/a.webp']);
});

test('from a trigger do: the command shows the CG and swaps the background, both reported as effects', async () => {
  const { store } = await world({
    triggers: [{ id: 'fire', kind: 'place', when: { layer: 'world/inn' }, do: 'fire',
      assets: [{ kind: 'cg', path: 'assets/cg/fire.webp', prompt: 'p' }, { kind: 'background', path: 'assets/bg/inn-burnt.webp', prompt: 'p' }] }],
    commands: {
      fire: 'name: Fire\ndo:\n  - action: show_cg\n    with:\n      path: assets/cg/fire.webp\n      caption: 起火了\n  - action: swap_background\n    with:\n      layer: world/inn\n      path: assets/bg/inn-burnt.webp\n',
    },
  });
  const r = await createActionService(store, PLAYER, { turn: 'req:p1' }).enterLayer({ layer: 'world/inn' });
  const [fired] = r.details.triggers;
  assert.equal(fired.settle, 'ran', fired.error);
  assert.equal(fired.effects, 2);
  assert.equal(fired.shown, undefined, 'with do, the command does the showing');
  assert.equal((await eventsOf(store, 'cg_shown')).length, 1);
  assert.equal((await fmOf(store, 'world/inn/README.md')).bg, 'assets/bg/inn-burnt.webp');
});

test('without do: a trigger\'s own cg / background assets are shown by the engine (background on the layer it is about)', async () => {
  const triggers = [
    { id: 'fire', kind: 'place', label: '火光', when: { layer: 'world/inn' },
      assets: [{ kind: 'cg', path: 'assets/cg/fire.webp', prompt: 'p' }, { kind: 'background', path: 'assets/bg/inn-burnt.webp', prompt: 'p' }, { kind: 'item', path: 'assets/cg/dawn.png', prompt: 'p' }] },
  ];
  assert.deepEqual(parseWorldTriggers(triggers).errors, [], 'assets alone are a consequence');
  assert.equal(parseWorldTriggers([{ id: 'x', kind: 'place', when: { layer: 'map' }, assets: [{ kind: 'item', path: 'assets/a.webp', prompt: 'p' }] }]).errors.length, 1, 'an item asset is not');
  const { store } = await world({ triggers });
  const r = await createActionService(store, PLAYER, { turn: 'req:p2' }).enterLayer({ layer: 'world/inn' });
  const [fired] = r.details.triggers;
  assert.equal(fired.settle, 'ran', fired.error);
  assert.deepEqual(fired.shown, [
    { kind: 'cg', path: 'assets/cg/fire.webp' },
    { kind: 'background', path: 'assets/bg/inn-burnt.webp', layer: 'world/inn' },
  ]);
  const [cg] = await eventsOf(store, 'cg_shown');
  assert.equal(cg.detail.caption, '火光', 'the caption is the trigger label');
  assert.equal((await fmOf(store, 'world/inn/README.md')).bg, 'assets/bg/inn-burnt.webp');
  assert.equal((await readTriggerLog(store)).fire.status, 'done');
});

test('without do: a missing asset marks the firing failed but the others still show', async () => {
  const { store } = await world({
    triggers: [{ id: 'dawn', kind: 'place', when: { layer: 'world/inn' },
      assets: [{ kind: 'cg', path: 'assets/cg/gone.webp', prompt: 'p' }, { kind: 'cg', path: 'assets/cg/dawn.png', prompt: 'p' }] }],
  });
  const r = await createActionService(store, PLAYER, { turn: 'req:p3' }).enterLayer({ layer: 'world/inn' });
  const [fired] = r.details.triggers;
  assert.equal(fired.settle, 'failed');
  assert.match(fired.error, /gone\.webp/);
  assert.deepEqual(fired.shown, [{ kind: 'cg', path: 'assets/cg/dawn.png' }]);
});
