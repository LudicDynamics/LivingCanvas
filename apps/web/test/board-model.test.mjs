// The map of one layer, as data (apps/web/src/lib/board-model.ts, the design notes).
// Placement is where a silent bug would hurt: a place that moves between
// visits, two things on one tile, or a door drawn where nothing is.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const board = await jiti.import('../src/lib/board-model.ts');
const { buildBoard, boardKind, assignSlots, hashOf, BOARD_SIZE } = board;

// 雾坞镇's harbour: three doors out, three bits of narration, one letter.
const harbour = {
  worldId: 'wuwu-zh',
  layerId: 'world/harbor-chart',
  readme: { name: '港口地图', map: { kind: 'town' } },
  items: [
    { path: 'world/harbor-chart/01-opening.md', frontmatter: { type: 'chalk' }, body: '雨夜的港口。\n\n第二段。' },
    { path: 'world/harbor-chart/02-two-wakes.md', frontmatter: { type: 'chalk' }, body: '寻找另一艘船。' },
    { path: 'world/harbor-chart/seventh-berth/README.md', frontmatter: { type: 'gate', name: '7号码头', target: 'world/harbor-chart/seventh-berth' } },
    { path: 'world/harbor-chart/workshop/README.md', frontmatter: { type: 'gate', name: '工坊' } },
    { path: 'world/harbor-chart/old-lighthouse/README.md', frontmatter: { type: 'gate', name: '旧灯塔', requires: { items: ['player/lamp-oil.md'] } } },
    { path: 'world/harbor-chart/tide-table.md', frontmatter: { type: 'note', title: '潮汐表' } },
  ],
  characters: [{ id: 'silver-kite', name: '银鸢' }],
  parent: { id: 'map', name: '港务所' },
};

const pieces = (b, kind) => b.pieces.filter(piece => piece.kind === kind);

test('the files become things: doors are places, notes are pieces, chalk is the caption', () => {
  const b = buildBoard(harbour);
  assert.equal(b.kind, 'town');
  assert.deepEqual(pieces(b, 'place').map(p => p.label).sort(), ['7号码头', '工坊', '旧灯塔'].sort());
  assert.deepEqual(pieces(b, 'item').map(p => p.label), ['潮汐表']);
  assert.deepEqual(pieces(b, 'character').map(p => p.label), ['银鸢']);
  assert.equal(pieces(b, 'player').length, 1);
  assert.deepEqual(pieces(b, 'exit').map(p => [p.label, p.ref]), [['港务所', 'map']]);
  // Chalk is never a piece: the newest one's first paragraph is the caption.
  assert.equal(b.narration, '寻找另一艘船。');
});

test('a place leads where its door leads', () => {
  const b = buildBoard(harbour);
  const byLabel = Object.fromEntries(pieces(b, 'place').map(p => [p.label, p.ref]));
  assert.equal(byLabel['7号码头'], 'world/harbor-chart/seventh-berth', 'an explicit target wins');
  assert.equal(byLabel['工坊'], 'world/harbor-chart/workshop', 'else the directory the README belongs to');
});

test('a door that asks for something you do not carry is drawn locked, and opens once you do', () => {
  const locked = Object.fromEntries(pieces(buildBoard(harbour), 'place').map(p => [p.label, p.locked]));
  assert.equal(locked['旧灯塔'], true);
  assert.equal(locked['工坊'], false);
  const carrying = Object.fromEntries(pieces(buildBoard(harbour, new Set(['player/lamp-oil.md'])), 'place').map(p => [p.label, p.locked]));
  assert.equal(carrying['旧灯塔'], false);
});

test('the same layer is the same map every time, whatever order the files arrive in', () => {
  const a = buildBoard(harbour);
  const b = buildBoard({ ...harbour, items: [...harbour.items].reverse() });
  const where = board => Object.fromEntries(board.pieces.map(p => [p.id, [p.gx, p.gy]]));
  assert.deepEqual(where(a), where(b));
  assert.deepEqual(a.tiles, b.tiles);
});

test('adding a new place does not move the ones already on the map', () => {
  const before = buildBoard(harbour);
  const after = buildBoard({
    ...harbour,
    items: [...harbour.items, { path: 'world/harbor-chart/fish-market/README.md', frontmatter: { type: 'gate', name: '鱼市' } }],
  });
  const at = (b, label) => { const p = pieces(b, 'place').find(x => x.label === label); return [p.gx, p.gy]; };
  // Only a direct collision may move something; check that most stay put.
  const stayed = ['7号码头', '工坊', '旧灯塔'].filter(label => at(before, label).join() === at(after, label).join());
  assert.ok(stayed.length >= 2, `at most one existing place may shift, got ${3 - stayed.length}`);
  assert.equal(pieces(after, 'place').length, 4);
});

test('no two things share a tile, and everything is on the board', () => {
  for (const kind of ['region', 'town', 'interior', 'detail']) {
    const b = buildBoard({ ...harbour, readme: { map: { kind } } });
    const cells = new Map();
    for (const p of b.pieces) {
      for (let x = p.gx; x < p.gx + p.w; x += 1) for (let y = p.gy; y < p.gy + p.h; y += 1) {
        assert.ok(x >= 0 && y >= 0 && x < BOARD_SIZE && y < BOARD_SIZE, `${kind}: ${p.label || p.kind} is off the board`);
        const key = `${x},${y}`;
        assert.ok(!cells.has(key), `${kind}: ${p.kind} "${p.label}" overlaps ${cells.get(key)} at ${key}`);
        cells.set(key, `${p.kind} "${p.label}"`);
      }
    }
    assert.equal(b.tiles.length, BOARD_SIZE * BOARD_SIZE);
  }
});

test('the scale is declared by the author, and only guessed when it is not', () => {
  assert.equal(boardKind({ map: { kind: 'detail' } }, 5, 0), 'detail');
  assert.equal(boardKind({ map: { kind: 'nonsense' } }, 0, 3), 'interior', 'an unknown kind is ignored, not trusted');
  // 雾坞镇's root is a room even though a whole harbour lies below it — which
  // is why depth is never consulted: only what this layer holds.
  assert.equal(boardKind(null, 1, 2), 'interior', 'a room with a door and some things');
  assert.equal(boardKind(null, 3, 1), 'town', 'mostly doors');
  assert.equal(boardKind(undefined, 0, 0), 'interior');
});

test('slots are claimed by hash, not by list order', () => {
  const slots = ['a', 'b', 'c', 'd'];
  const one = assignSlots(['x', 'y', 'z'], slots, 's');
  const two = assignSlots(['z', 'x', 'y'], slots, 's');
  assert.deepEqual([...one.entries()].sort(), [...two.entries()].sort());
  assert.equal(new Set(one.values()).size, 3, 'three ids, three different slots');
  // More ids than slots: the extras are simply not placed, nothing crashes.
  assert.equal(assignSlots(['1', '2', '3', '4', '5'], ['a', 'b'], 's').size, 2);
  assert.equal(hashOf('x'), hashOf('x'));
  assert.notEqual(hashOf('x'), hashOf('y'));
});

test('regions differ from world to world, towns keep their plan', () => {
  const region = id => buildBoard({ ...harbour, worldId: id, readme: { map: { kind: 'region' } } }).tiles.join();
  const differ = ['w1', 'w2', 'w3', 'w4', 'w5'].map(region);
  assert.ok(new Set(differ).size > 1, 'the coast moves with the seed');
  const town = id => buildBoard({ ...harbour, worldId: id }).tiles.join();
  assert.equal(town('w1'), town('w2'));
});

test('the top of the world has no way out, and nobody is invented', () => {
  const top = buildBoard({ ...harbour, parent: null, characters: [] });
  assert.equal(pieces(top, 'exit').length, 0);
  assert.equal(pieces(top, 'character').length, 0);
});

// ── Pins on a real picture
//    ──────────────

const { pinMap, declaredPins } = board;
const harbourMap = {
  ...harbour,
  readme: { name: '港口地图', map: { pins: { 'old-lighthouse': [0.22, 0.24], 'seventh-berth': [0.42, 0.52], workshop: [0.64, 0.62], player: [0.17, 0.87] } } },
  characters: [
    { id: 'old-mo', name: '老莫', layer: 'world/harbor-chart/old-lighthouse', here: false },
    { id: 'silver-kite', name: '银鸢', layer: 'world/harbor-chart/seventh-berth', here: false },
    { id: 'vera', name: '薇拉', layer: 'map', here: false },
  ],
};

test('places sit exactly where the author pinned them on the picture', () => {
  const at = Object.fromEntries(pinMap(harbourMap).pins.filter(p => p.kind === 'place').map(p => [p.ref, [p.x, p.y]]));
  assert.deepEqual(at['world/harbor-chart/old-lighthouse'], [0.22, 0.24]);
  assert.deepEqual(at['world/harbor-chart/seventh-berth'], [0.42, 0.52]);
  assert.deepEqual(at['world/harbor-chart/workshop'], [0.64, 0.62]);
  const player = pinMap(harbourMap).pins.find(p => p.kind === 'player');
  assert.deepEqual([player.x, player.y], [0.17, 0.87]);
});

test('the text a card carried becomes the pin’s hover panel', () => {
  const withText = { ...harbourMap, items: harbourMap.items.map(item => item.path.endsWith('old-lighthouse/README.md')
    ? { ...item, body: '岬角上的灯塔，昨夜熄了十二分钟。\n\n第二段。', frontmatter: { ...item.frontmatter, blocked: '需要灯油。' } }
    : item) };
  const lighthouse = pinMap(withText).pins.find(p => p.ref === 'world/harbor-chart/old-lighthouse');
  assert.equal(lighthouse.detail, '岬角上的灯塔，昨夜熄了十二分钟。', 'first paragraph only');
  assert.equal(lighthouse.locked, true);
  assert.equal(lighthouse.blocked, '需要灯油。', 'a locked door says what it needs');
  const note = pinMap(harbourMap).pins.find(p => p.kind === 'item');
  assert.equal(note.label, '潮汐表');
  // Narration is still the caption and the story panel — and now also a pin each.
  assert.deepEqual(pinMap(harbourMap).story.map(s => s.title), ['01-opening', '02-two-wakes']);
});

// ── New text is a thing on the map
//    ─────────────────────────

test('every piece of narration is its own note pin, not only the newest caption', () => {
  const notes = pinMap(harbourMap).pins.filter(p => p.kind === 'note');
  assert.deepEqual(notes.map(p => p.id).sort(), ['world/harbor-chart/01-opening.md', 'world/harbor-chart/02-two-wakes.md']);
  assert.ok(notes.every(p => p.portable === false), 'narration is read, never taken');
  assert.equal(notes.find(p => p.id.endsWith('01-opening.md')).detail, '雨夜的港口。');
  assert.equal(pinMap(harbourMap).narration, '寻找另一艘船。', 'the caption stays');
});

test('a chalk that asks for a roll is a dice pin', () => {
  const withDice = { ...harbourMap, items: [...harbourMap.items,
    { path: 'world/harbor-chart/04-investigation-dice.md', frontmatter: { type: 'chalk', title: '调查', roll_dice: { sides: 20, dc: 12 } }, body: '掷骰。' }] };
  const dice = pinMap(withDice).pins.find(p => p.id.endsWith('04-investigation-dice.md'));
  assert.equal(dice.kind, 'dice');
  assert.equal(dice.label, '调查');
});

test('a note sits where the author pinned its file stem, else on a free spot clear of every other pin', () => {
  const pinned = { ...harbourMap, readme: { map: { pins: { ...harbourMap.readme.map.pins, '02-two-wakes': [0.5, 0.3] } } } };
  const wake = pinMap(pinned).pins.find(p => p.id.endsWith('02-two-wakes.md'));
  assert.deepEqual([wake.x, wake.y], [0.5, 0.3]);
  const many = { ...harbourMap, items: [...harbourMap.items, ...Array.from({ length: 8 }, (_, i) => ({
    path: `world/harbor-chart/1${i}-more.md`, frontmatter: { type: 'chalk' }, body: `第${i}段。` }))] };
  const pins = pinMap(many).pins;
  const notes = pins.filter(p => p.kind === 'note');
  assert.equal(notes.length, 10);
  for (const note of notes) {
    for (const other of pins) {
      if (other === note) continue;
      assert.ok(Math.hypot(other.x - note.x, other.y - note.y) >= 0.069, `${note.id} clear of ${other.id}`);
    }
  }
  const again = pinMap({ ...many, items: [...many.items].reverse() }).pins.filter(p => p.kind === 'note').map(p => [p.id, p.x, p.y]).sort();
  assert.deepEqual(notes.map(p => [p.id, p.x, p.y]).sort(), again, 'the same spots every visit');
});

test('portraits, sprites and the readme never become pins', () => {
  const scenery = { ...harbourMap, items: [...harbourMap.items,
    { path: 'world/harbor-chart/mo.md', frontmatter: { type: 'sprite' } },
    { path: 'world/harbor-chart/poster.md', frontmatter: { type: 'portrait' } }] };
  const ids = pinMap(scenery).pins.map(p => p.id);
  assert.ok(!ids.includes('world/harbor-chart/mo.md') && !ids.includes('world/harbor-chart/poster.md'));
});

test('an item says whether it can be taken along', () => {
  const fixed = { ...harbourMap, items: [...harbourMap.items,
    { path: 'world/harbor-chart/anchor.md', frontmatter: { type: 'prop', title: '铁锚', portable: false } }] };
  const pins = pinMap(fixed).pins;
  assert.equal(pins.find(p => p.id.endsWith('anchor.md')).portable, false);
  assert.equal(pins.find(p => p.id.endsWith('tide-table.md')).portable, true);
});

test('the map opens the canvas card interactions, pans and zooms, and marks places for the tour', async () => {
  const { readFile: rf } = await import('node:fs/promises');
  const map = await rf(new URL('../src/components/board/PictureMap.tsx', import.meta.url), 'utf8');
  const panel = await rf(new URL('../src/components/board/MapCardPanel.tsx', import.meta.url), 'utf8');
  const entity = await rf(new URL('../src/components/narrative/EntityInteractions.tsx', import.meta.url), 'utf8');
  const app = await rf(new URL('../src/App.tsx', import.meta.url), 'utf8');
  // One implementation: the panel is EntityInteractions, anchored, not a copy.
  assert.match(panel, /<EntityInteractions\s+anchored\s+active/);
  assert.match(entity, /if \(anchored \|\| !active \|\| !ref\.current\) return;/);
  assert.match(map, /<MapCardPanel/);
  assert.match(map, /onEntityAction=\{props\.onEntityAction\}/);
  assert.match(app, /<Board[\s\S]*?onEntityAction=\{runEntityAction\}[\s\S]*?focus=\{focusCoordinator\}[\s\S]*?\/>/);
  // Pan / zoom: clamped, and a drag never lands as a click on a pin.
  assert.match(map, /MAP_MAX_ZOOM = 3/);
  assert.match(map, /MAP_DRAG_THRESHOLD/);
  assert.match(map, /onClickCapture=/);
  assert.match(map, /addEventListener\('wheel', onWheel, \{ passive: false \}\)/);
  // Hover panels wait before closing, so the pointer can reach their buttons.
  assert.match(map, /MAP_HOVER_CLOSE_MS/);
  // The tutorial points at places.
  assert.match(map, /data-guide-target=\{pin\.kind === 'place' \? 'enter' : undefined\}/);
});

test('people stand where they are: someone inside a place stands beside its pin', () => {
  const pins = pinMap(harbourMap).pins.filter(p => p.kind === 'character');
  const mo = pins.find(p => p.id === 'old-mo');
  const kite = pins.find(p => p.id === 'silver-kite');
  assert.ok(mo && kite, 'both are on the harbour map');
  assert.ok(Math.abs(mo.x - 0.22) < 0.1 && Math.abs(mo.y - 0.24) < 0.1, '老莫 beside the lighthouse');
  assert.ok(Math.abs(kite.x - 0.42) < 0.1 && Math.abs(kite.y - 0.52) < 0.1, '银鸢 beside the berth');
  assert.equal(mo.away, true);
  assert.equal(mo.detail, '旧灯塔', 'the panel says where they are');
  // Someone not inside any of this layer's places (薇拉, back at the office) is not on this map.
  assert.ok(!pins.some(p => p.id === 'vera'));
});

test('two people inside the same place do not stack', () => {
  const crowd = { ...harbourMap, characters: [
    { id: 'a', name: 'A', layer: 'world/harbor-chart/workshop', here: false },
    { id: 'b', name: 'B', layer: 'world/harbor-chart/workshop/back-room', here: false },
  ] };
  const [a, b] = pinMap(crowd).pins.filter(p => p.kind === 'character');
  assert.notDeepEqual([a.x, a.y], [b.x, b.y]);
});

test('an unpinned layer still works: places take fallback spots, the same every time', () => {
  const plain = { ...harbour, readme: {} };
  const one = pinMap(plain).pins.filter(p => p.kind === 'place').map(p => [p.ref, p.x, p.y]).sort();
  const two = pinMap({ ...plain, items: [...plain.items].reverse() }).pins.filter(p => p.kind === 'place').map(p => [p.ref, p.x, p.y]).sort();
  assert.deepEqual(one, two);
  assert.equal(one.length, 3);
});

test('a malformed pin is ignored, never trusted', () => {
  const pins = declaredPins({ map: { pins: { a: [0.5, 0.5], b: [1.4, 0.2], c: 'x', d: [0.1], e: [NaN, 0.3] } } });
  assert.deepEqual([...pins.keys()], ['a']);
  assert.equal(declaredPins(null).size, 0);
});

test('雾坞镇 pins every place, thing and person on its pictures, in all three editions', async () => {
  const { readFile: rf } = await import('node:fs/promises');
  const { createJiti: cj } = await import('../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs');
  const shared = await cj(import.meta.url).import('../../../packages/shared/src/schemas/frontmatter.ts');
  const layers = ['world', 'world/harbor-chart', 'world/harbor-chart/seventh-berth', 'world/harbor-chart/workshop', 'world/harbor-chart/old-lighthouse'];
  const pinsOf = async (edition, layer) =>
    JSON.stringify(shared.parseFrontmatter(await rf(new URL(`../../../templates/${edition}/${layer}/README.md`, import.meta.url), 'utf8')).frontmatter.map);
  for (const layer of layers) {
    const en = await pinsOf('wuwu', layer);
    assert.ok(en && en.includes('pins'), `${layer} has pins`);
    assert.equal(await pinsOf('wuwu-zh', layer), en, `${layer}: zh matches en`);
    assert.equal(await pinsOf('wuwu-jp', layer), en, `${layer}: jp matches en`);
  }
});

// ── A drawn map per layer
//    The plan names a picture that may not exist yet. ────────────────

const { mapPlan } = board;

test('a planned map brings its own pins, and leaves the scene pins for the scene', () => {
  const readme = { name: 'x', map: {
    pins: { workshop: [0.64, 0.62] },
    plan: { picture: 'assets/maps/harbor-chart.webp', pins: { workshop: [0.72, 0.62] } },
  } };
  const plan = mapPlan(readme);
  assert.equal(plan.picture, 'assets/maps/harbor-chart.webp');
  assert.deepEqual(declaredPins(plan.readme).get('workshop'), [0.72, 0.62], 'on the map, the map’s pins');
  assert.deepEqual(declaredPins(readme).get('workshop'), [0.64, 0.62], 'on the scene picture, the scene’s pins');
  assert.equal(readme.map.pins.workshop[0], 0.64, 'the author’s readme is not mutated');
});

test('a plan that points anywhere but the world’s own assets is not a plan', () => {
  for (const picture of ['../secrets.png', 'https://example.com/a.png', 'assets/../../x.webp', 'assets/maps/a.gif', 42]) {
    assert.equal(mapPlan({ map: { plan: { picture, pins: {} } } }), null, String(picture));
  }
  assert.equal(mapPlan({ map: { pins: {} } }), null);
  assert.equal(mapPlan(null), null);
});

test('the board shows the drawn map only once it has loaded, else the scene picture', async () => {
  const { readFile: rf } = await import('node:fs/promises');
  const src = await rf(new URL('../src/components/board/Board.tsx', import.meta.url), 'utf8');
  assert.match(src, /probe\.onload = \(\) => \{ if \(live\) setPlanReady\(planUrl\); \};/);
  assert.match(src, /if \(plan && planReady\) return <PictureMap \{\.\.\.props\} readme=\{plan\.readme\} image=\{planReady\} \/>;/);
  assert.match(src, /return props\.image \? <PictureMap/);
});

test('set-map-plan writes one plan into every edition and can be run twice', async () => {
  const { mkdtemp, mkdir, writeFile, readFile: rf, cp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { execFileSync } = await import('node:child_process');
  // Run the real tool against a throwaway repo copy of just what it touches.
  const root = await mkdtemp(join(tmpdir(), 'map-plan-'));
  await mkdir(join(root, 'tools'));
  await cp(new URL('../../../tools/set-map-plan.mjs', import.meta.url), join(root, 'tools/set-map-plan.mjs'));
  const readme = '---\ntype: gate\nname: X\nmap:\n  pins:\n    a: [0.1, 0.2]\nintent: keep me\n---\nBody.\n';
  for (const id of ['fam', 'fam-zh']) {
    await mkdir(join(root, 'templates', id, 'world'), { recursive: true });
    await writeFile(join(root, 'templates', id, 'world.json'), '{}');
    await writeFile(join(root, 'templates', id, 'world', 'README.md'), readme);
  }
  const spec = join(root, 'spec.json');
  await writeFile(spec, JSON.stringify({ family: 'fam', layers: { world: { picture: 'assets/maps/w.webp', pins: { a: [0.3, 0.4] } } } }));
  execFileSync('node', [join(root, 'tools/set-map-plan.mjs'), spec]);
  execFileSync('node', [join(root, 'tools/set-map-plan.mjs'), spec]);
  const out = await rf(join(root, 'templates/fam-zh/world/README.md'), 'utf8');
  assert.equal(out.match(/plan:/g).length, 1, 'idempotent');
  assert.match(out, /map:\n  pins:\n    a: \[0\.1, 0\.2\]\n  plan:\n    picture: assets\/maps\/w\.webp\n    pins:\n      a: \[0\.3, 0\.4\]\nintent: keep me\n---\nBody\.\n$/);
});
