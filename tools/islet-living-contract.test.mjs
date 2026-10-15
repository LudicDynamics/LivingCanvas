/**
 * 潮见岛 / Shiomi Isle — the first living world.
 * Plays a real copy of templates/islet through the real ActionService: the
 * daily loop repeats, the boat quest opens the outer islets, the field
 * harvests again and again, festivals land on their days with the square's
 * festival picture, the newcomer comes ashore even while nobody is looking,
 * and every edition carries the same living calendar.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  LocalWorldStore,
  createActionService,
  catchUpLivingWorld,
  initializeMissingCharacterPresence,
  parseFrontmatter,
  parseLivingWorld,
  passTime,
  readLivingNow,
  settleLivingWorld,
} from '../packages/shared/dist/index.js';

const repo = fileURLToPath(new URL('../', import.meta.url));
const DAY = 1440;

async function island(edition = 'islet') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-islet-'));
  await fs.cp(path.join(repo, 'templates', edition), root, { recursive: true });
  const store = new LocalWorldStore(root);
  await initializeMissingCharacterPresence(store, { turn: 'init' });
  const clock = { at: Date.parse('2026-10-08T09:00:00Z') };
  const now = () => new Date(clock.at).toISOString();
  const engine = () => ({ store, actor: { type: 'engine' }, turn: `t:${Math.random()}`, now });
  await catchUpLivingWorld(engine());
  const player = () => createActionService(store, { type: 'player' }, { now });
  const world = async () => parseFrontmatter(await store.readFile('world/README.md')).frontmatter;
  const states = async (rel) => parseFrontmatter(await store.readFile(rel)).frontmatter.status?.data ?? {};
  return { store, clock, engine, player, world, states };
}

test('every edition carries one living calendar (only the words differ)', async () => {
  const machine = async (id) => {
    const { living, errors } = parseLivingWorld(JSON.parse(await fs.readFile(path.join(repo, 'templates', id, 'world.json'), 'utf8')).living);
    assert.deepEqual(errors, [], id);
    return JSON.stringify({
      phases: living.phases.map((p) => [p.id, p.from]), seasons: living.seasons.map((s) => s.id), days: living.daysPerSeason,
      events: living.events.map((e) => [e.id, e.on, e.phases, e.at, e.gather]),
      residents: Object.fromEntries(Object.entries(living.residents).map(([id, r]) => [id, r.schedule.map((s) => [s.at, s.phases, s.weekdays, s.weather, s.if])])),
      variants: living.variants,
    });
  };
  const en = await machine('islet');
  for (const id of ['islet-zh', 'islet-jp', 'islet-ko']) assert.equal(await machine(id), en, id);
});

test('day one: the ferry is in, islanders are where their morning puts them', async () => {
  const { store } = await island();
  const r = await readLivingNow(store);
  assert.deepEqual([r.now.day, r.now.phase, r.now.season, r.now.weekday], [1, 'morning', 'spring', 'mon']);
  assert.ok(r.now.today.includes('ferry'));
  assert.equal(store.getPresenceOf('toma').layer, 'world/dock');
  assert.equal(store.getPresenceOf('suzu').layer, 'world/lighthouse');
  assert.equal(store.getPresenceOf('kai').layer, 'world/ferry', 'the traveller is still on the ferry');
  const events = await store.getEventsSince(0);
  assert.ok(events.some((e) => e.type === 'story_event' && e.detail?.title === 'Ferry day'));
});

test('the daily loop repeats: fishing twice fills the basket twice; selling empties it', async () => {
  const { player, states } = await island();
  await player().enterLayer({ layer: 'world/beach' });
  await player().chooseOption({ path: 'world/beach/README.md', choice: 'fish' });
  await player().chooseOption({ path: 'world/beach/README.md', choice: 'fish' });
  assert.equal((await states('player/README.md')).fish, 4);
  await player().enterLayer({ layer: 'world/store' });
  await player().chooseOption({ path: 'world/store/README.md', choice: 'sell-fish' });
  assert.equal((await states('player/README.md')).fish, 0);
  assert.equal((await states('characters/hana/README.md')).bond, 1);
});

test('the boat quest: three loads of driftwood launch the boat and open the outer islets', async () => {
  const { store, player, world } = await island();
  // The gate (checked by POST /api/enter-layer) asks for the tiller, which does not exist yet.
  for (const islet of ['kelp-islet', 'bird-rock']) {
    assert.deepEqual(parseFrontmatter(await store.readFile(`world/${islet}/README.md`)).frontmatter.requires, { items: ['player/boat-tiller.md'] });
  }
  assert.equal(await store.statKind('player/boat-tiller.md'), 'missing');
  await player().enterLayer({ layer: 'world/beach' });
  for (let i = 0; i < 3; i += 1) await player().chooseOption({ path: 'world/beach/README.md', choice: 'driftwood' });
  const fm = await world();
  assert.deepEqual([fm.status.data.boat_progress, fm.status.data.boat_fixed], [3, true]);
  assert.equal(await store.statKind('player/boat-tiller.md'), 'file');
  await player().enterLayer({ layer: 'world/ferry' });
  const r = await player().enterLayer({ layer: 'world/kelp-islet' });
  assert.equal(r.details.layer, 'world/kelp-islet');
});

test('the field harvests again and again; the first harvest leaves a keepsake once', async () => {
  const { store, player, world } = await island();
  await player().enterLayer({ layer: 'world/farm' });
  for (let i = 0; i < 4; i += 1) await player().chooseOption({ path: 'world/farm/README.md', choice: 'tend' });
  assert.equal(await store.statKind('player/first-turnip.md'), 'file');
  assert.equal((await world()).status.data.farm_growth, 1, 'harvested and sown again');
  for (let i = 0; i < 3; i += 1) await player().chooseOption({ path: 'world/farm/README.md', choice: 'tend' });
  const harvests = (await store.getEventsSince(0)).filter((e) => e.type === 'story_event' && e.detail?.title === 'Harvest');
  assert.equal(harvests.length, 2);
});

test('a festival lands on its day: the Lantern Festival gathers everyone and lights the square', async () => {
  const { store, engine } = await island();
  // Summer, day 5 = day 12; 19:00.
  await passTime(engine(), { minutes: 11 * DAY + 12 * 60 });
  const r = await settleLivingWorld(engine());
  assert.ok(r.fired.some((f) => f.id === 'lantern-festival'));
  for (const id of ['toma', 'nagi', 'hana', 'kenta', 'suzu', 'ren', 'mio']) assert.equal(store.getPresenceOf(id).layer, 'world/square', id);
  assert.equal(parseFrontmatter(await store.readFile('world/square/README.md')).frontmatter.bg, 'assets/scenes/square-festival.webp');
  assert.equal(parseFrontmatter(await store.readFile('world/farm/README.md')).frontmatter.bg, 'assets/scenes/farm-summer.webp', 'summer field');
});

test('while nobody looks: the newcomer comes ashore, and the return has its digest', async () => {
  const { store, clock, engine, world } = await island();
  // Away for twelve real days: the island lives three of them (maxDays), three times over.
  for (let i = 0; i < 3; i += 1) {
    clock.at += 4 * 86400000;
    await catchUpLivingWorld(engine());
  }
  const r = await readLivingNow(store);
  assert.equal(r.now.day, 10, 'three capped absences of three days each');
  assert.equal((await world()).status.data.kai_arrived, true);
  assert.notEqual(store.getPresenceOf('kai').layer, 'world/ferry');
  const state = (await world()).living;
  assert.ok(state.away.facts.length >= 3, JSON.stringify(state.away));
});

test('no forced costs: a week of sleeping lowers nothing the player or an islander earned', async () => {
  const { store, player, states } = await island();
  await player().enterLayer({ layer: 'world/dock' });
  await player().chooseOption({ path: 'world/dock/README.md', choice: 'keep-toma-company' });
  await player().chooseOption({ path: 'world/dock/README.md', choice: 'fish' });
  const before = { fish: (await states('player/README.md')).fish, bond: (await states('characters/toma/README.md')).bond };
  for (let i = 0; i < 7; i += 1) {
    await player().enterLayer({ layer: 'world/home' });
    await player().chooseOption({ path: 'world/home/README.md', choice: 'sleep' });
  }
  assert.equal((await states('player/README.md')).fish, before.fish);
  assert.equal((await states('characters/toma/README.md')).bond, before.bond);
  assert.ok(store.getPresence().length >= 8);
});
