// the design notes — presence projection, settle window and navigation.
// Pure module: no DOM, no rAF, no React. jiti loads the TS directly.
import assert from 'node:assert/strict';
import { test } from 'node:test';

let mod = null;
try {
  const { createJiti } = await import('../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs');
  const jiti = createJiti(import.meta.url, { moduleCache: false, tryNative: true });
  mod = await jiti.import('../src/lib/presence.ts');
} catch (error) {
  console.error('jiti unavailable, skipping presence group:', error?.message ?? error);
}

const skip = mod ? false : 'jiti or pi-rp submodule unavailable';
const { projectPresence, createPresenceStabilizer, PRESENCE_SETTLE_MS } = mod ?? {};

const row = (id, presence) => ({ id, name: id, avatar: `${id}.png`, role: 'companion', presence });
const at = (characterId, x, y, following = false) => ({ characterId, x, y, following });

test('P1 three-state table: absent / elsewhere / in-scene', { skip }, () => {
  const characters = [
    row('a', null),
    row('b', { layer: 'world/y', following: false }),
    row('c', { layer: 'world/x', following: true }),
  ];
  const views = projectPresence({
    characters,
    layer: 'world/x',
    presence: [at('c', 100, 200, true)],
  });

  assert.equal(views[0].state, 'absent');
  assert.equal(views[0].layer, null);
  assert.equal(views[0].position, null);
  assert.equal(views[0].following, false);

  assert.equal(views[1].state, 'elsewhere');
  assert.equal(views[1].layer, 'world/y');
  assert.equal(views[1].position, null);

  assert.equal(views[2].state, 'in-scene');
  assert.deepEqual(views[2].position, { x: 100, y: 200 });
  assert.equal(views[2].following, true);
});

test('P2 presence === null means absent (never drawn, never following)', { skip }, () => {
  const views = projectPresence({
    characters: [row('c', null)],
    layer: 'L',
    presence: [at('c', 5, 6, true)],
  });
  assert.equal(views[0].state, 'absent');
  assert.equal(views[0].layer, null);
  assert.equal(views[0].position, null);
  assert.equal(views[0].following, false);
});

test('P3 position comes ONLY from /api/layer presence', { skip }, () => {
  const clean = projectPresence({
    characters: [row('c', { layer: 'L', following: false })],
    layer: 'L',
    presence: [at('c', 7, 9)],
  });
  assert.deepEqual(clean[0].position, { x: 7, y: 9 });

  // A coordinate smuggled onto the wrong source must be ignored.
  const poisoned = projectPresence({
    characters: [row('c', { layer: 'L', following: false, x: 999, y: 999 })],
    layer: 'L',
    presence: [at('c', 7, 9)],
  });
  assert.deepEqual(poisoned[0].position, { x: 7, y: 9 });
});

test('P4 characters-in-this-layer with no layer row converges to elsewhere', { skip }, () => {
  const views = projectPresence({
    characters: [row('c', { layer: 'L', following: false })],
    layer: 'L',
    presence: [],
  });
  assert.equal(views[0].state, 'elsewhere');
  assert.equal(views[0].position, null);
});

test('P4b a missing presence key does not throw (loose null check)', { skip }, () => {
  const source = { id: 'c', name: 'c' }; // no `presence` key at all
  const views = projectPresence({ characters: [source], layer: 'L', presence: [] });
  assert.equal(views[0].state, 'absent');
  assert.equal(views[0].layer, null);
  assert.equal(views[0].position, null);
  assert.equal(views[0].following, false);
});

test('P4c a missing presence array converges to elsewhere', { skip }, () => {
  const views = projectPresence({
    characters: [row('c', { layer: 'L', following: false })],
    layer: 'L',
    presence: undefined,
  });
  assert.equal(views[0].state, 'elsewhere');
  assert.equal(views[0].position, null);
});

test('P5 output order = input order and the field set is exactly the contract', { skip }, () => {
  const characters = [
    row('z', { layer: 'L', following: false }),
    row('a', { layer: 'L', following: false }),
    row('m', { layer: 'L', following: false }),
  ];
  const views = projectPresence({
    characters,
    layer: 'L',
    presence: [at('z', 1, 1), at('a', 2, 2), at('m', 3, 3)],
  });
  assert.deepEqual(views.map((v) => v.id), ['z', 'a', 'm']);
  assert.deepEqual(Object.keys(views[0]).sort(), [
    'arrivedByFollow',
    'avatar',
    'following',
    'id',
    'layer',
    'name',
    'position',
    'role',
    'state',
  ]);
});

test('P6 arrivedByFollow is armed only for a follower marked as just arrived', { skip }, () => {
  const follower = row('c', { layer: 'L', following: true });
  const here = [at('c', 4, 5, true)];
  const armed = projectPresence({
    characters: [follower],
    layer: 'L',
    presence: here,
    arrivedByFollow: new Set(['c']),
  });
  assert.equal(armed[0].arrivedByFollow, true);

  const steady = projectPresence({ characters: [follower], layer: 'L', presence: here });
  assert.equal(steady[0].arrivedByFollow, false);

  const nonFollower = row('d', { layer: 'L', following: false });
  const plain = projectPresence({
    characters: [nonFollower],
    layer: 'L',
    presence: [at('d', 4, 5)],
    arrivedByFollow: new Set(['d']),
  });
  assert.equal(plain[0].arrivedByFollow, false);
});

test('S1 settle window replays the previous projection during the silence', { skip }, () => {
  const stabilizer = createPresenceStabilizer();
  const a = {
    characters: [row('c', { layer: 'A', following: false })],
    layer: 'A',
    presence: [at('c', 1, 1)],
  };
  const first = stabilizer.reduce({ ...a, now: 0 });
  assert.equal(first.settled, true);
  const r0 = projectPresence(first.input);
  assert.equal(r0[0].state, 'in-scene');

  const b = {
    characters: [row('c', { layer: 'B', following: false })],
    layer: 'B',
    presence: [],
  };
  const second = stabilizer.reduce({ ...b, now: 10 });
  assert.equal(second.settled, false);
  assert.deepEqual(projectPresence(second.input), r0);
});

test('S2 settle window releases once the hold elapses, and not before', { skip }, () => {
  const stabilizer = createPresenceStabilizer();
  stabilizer.reduce({
    characters: [row('c', { layer: 'A', following: false })],
    layer: 'A',
    presence: [at('c', 1, 1)],
    now: 0,
  });
  const b = { characters: [row('c', { layer: 'B', following: false })], layer: 'B', presence: [] };
  assert.equal(stabilizer.reduce({ ...b, now: 10 }).settled, false);
  assert.equal(stabilizer.reduce({ ...b, now: 229 }).settled, false);

  const released = stabilizer.reduce({ ...b, now: 10 + PRESENCE_SETTLE_MS });
  assert.equal(released.settled, true);
  const views = projectPresence(released.input);
  assert.equal(views[0].state, 'elsewhere');
});

test('S3 identical consecutive frames never restart the hold', { skip }, () => {
  const stabilizer = createPresenceStabilizer();
  const a = {
    characters: [row('c', { layer: 'A', following: false })],
    layer: 'A',
    presence: [at('c', 1, 1)],
  };
  assert.equal(stabilizer.reduce({ ...a, now: 0 }).settled, true);
  assert.equal(stabilizer.reduce({ ...a, now: 100 }).settled, true);
  assert.equal(stabilizer.reduce({ ...a, now: 200 }).settled, true);
});

test('S4 same-layer coordinate moves are not damped', { skip }, () => {
  const stabilizer = createPresenceStabilizer();
  const characters = [row('c', { layer: 'A', following: false })];
  stabilizer.reduce({ characters, layer: 'A', presence: [at('c', 1, 1)], now: 0 });
  const moved = stabilizer.reduce({ characters, layer: 'A', presence: [at('c', 2, 2)], now: 10 });
  assert.equal(moved.settled, true);
  assert.deepEqual(projectPresence(moved.input)[0].position, { x: 2, y: 2 });
});

test('S5 the settle threshold is the frozen 220ms', { skip }, () => {
  assert.equal(PRESENCE_SETTLE_MS, 220);
});


const view = (state, position = null, layer = null, id = 'c') => ({
  id,
  name: id,
  state,
  layer,
  following: false,
  position,
  arrivedByFollow: false,
});

test('N1 in-scene flies straight to the layer coordinate', { skip }, async () => {
  const flown = [];
  const calls = [];
  const outcome = await mod.navigateToCharacter({
    view: view('in-scene', { x: 12, y: 34 }),
    enterLayer: async () => { calls.push('enter'); return null; },
    readLayerState: () => null,
    camera: { flyTo: (x, y) => flown.push([x, y]) },
    notify: () => assert.fail('in-scene must not notify'),
    nextFrame: async () => { calls.push('frame'); },
  });
  assert.equal(outcome, 'navigated');
  assert.deepEqual(flown, [[12, 34]]);
  assert.deepEqual(calls, []);
});

test('N2 absent never navigates and is the sole notifier (P-20)', { skip }, async () => {
  const seen = [];
  const outcome = await mod.navigateToCharacter({
    view: view('absent'),
    enterLayer: async () => assert.fail('absent must not enter a layer'),
    readLayerState: () => assert.fail('absent must not read the layer'),
    camera: { flyTo: () => assert.fail('absent must not fly') },
    notify: (message) => seen.push(message),
    nextFrame: async () => assert.fail('absent must not wait a frame'),
  });
  assert.equal(outcome, 'absent');
  assert.deepEqual(seen, ['They are not here right now.']);
});

test('N3 elsewhere travels, waits a frame, then flies to the NEW layer row', { skip }, async () => {
  const order = [];
  const flown = [];
  const outcome = await mod.navigateToCharacter({
    view: view('elsewhere', null, 'world/z'),
    enterLayer: async (layer) => { order.push(`enter:${layer}`); return null; },
    readLayerState: () => {
      order.push('read');
      return { presence: [at('c', 77, 88)] };
    },
    camera: { flyTo: (x, y) => { order.push('fly'); flown.push([x, y]); } },
    notify: () => assert.fail('a landed navigation must not notify'),
    nextFrame: async () => { order.push('frame'); },
  });
  assert.equal(outcome, 'navigated');
  assert.deepEqual(order, ['enter:world/z', 'frame', 'read', 'fly']);
  assert.deepEqual(flown, [[77, 88]]);
});

test('N4 elsewhere failures notify and never fly', { skip }, async () => {
  const enterFailure = [];
  assert.equal(
    await mod.navigateToCharacter({
      view: view('elsewhere', null, 'world/z'),
      enterLayer: async () => { throw new Error('offline'); },
      readLayerState: () => assert.fail('a failed enterLayer must not read'),
      camera: { flyTo: () => assert.fail('a failed enterLayer must not fly') },
      notify: (message) => enterFailure.push(message),
      nextFrame: async () => assert.fail('a failed enterLayer must not wait'),
    }),
    'failed',
  );
  assert.deepEqual(enterFailure, ['We could not travel there right now.']);

  const missing = [];
  assert.equal(
    await mod.navigateToCharacter({
      view: view('elsewhere', null, 'world/z'),
      enterLayer: async () => null,
      readLayerState: () => ({ presence: [] }),
      camera: { flyTo: () => assert.fail('a missing row must not fly') },
      notify: (message) => missing.push(message),
      nextFrame: async () => {},
    }),
    'failed',
  );
  assert.deepEqual(missing, ['They moved before you arrived.']);

  const nullState = [];
  assert.equal(
    await mod.navigateToCharacter({
      view: view('elsewhere', null, 'world/z'),
      enterLayer: async () => null,
      readLayerState: () => null,
      camera: { flyTo: () => assert.fail('a null snapshot must not fly') },
      notify: (message) => nullState.push(message),
      nextFrame: async () => {},
    }),
    'failed',
  );
  assert.deepEqual(nullState, ['They moved before you arrived.']);
});