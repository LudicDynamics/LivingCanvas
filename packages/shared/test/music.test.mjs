/**
 * `set_music` (actions/music.ts, the design notes): catalog validation,
 * the README / world.json writes, one `music_changed` event per real change.
 * Real store, imports the BUILT dist.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { EventDetailSchemas, LocalWorldStore, createActionService, parseFrontmatter, renderEvent } from '../dist/index.js';

const WRITER = { type: 'writer' };

async function world({ theme = { type: 'story' } } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-music-'));
  const store = new LocalWorldStore(root);
  await store.writeFile('world.json', JSON.stringify({
    id: 'w', name: 'W', description: '', author: '', genre: 'test', characters: [], mode: 'open',
    ...(theme ? { theme } : {}), audio: { theme: 'divergence' },
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  }));
  await store.writeFile('world/README.md', '---\nname: Street\ntype: readme\nambient: rain\n---\n\n# Street\n');
  await store.writeFile('world/inn/README.md', '---\nname: Inn\ntype: readme\n---\n\n# Inn\nBody stays.\n');
  return store;
}
const svc = (store, actor = WRITER) => createActionService(store, actor, { turn: 'turn:t:1' });
const fmOf = async (store, p) => parseFrontmatter(await store.readFile(p)).frontmatter;
const musicEvents = async (store) => (await store.getEvents(100)).filter((e) => e.type === 'music_changed');

test('a place: bgm / ambient written into the README frontmatter, body kept, one event', async () => {
  const store = await world();
  store.writeViewpoint({ layer: 'world/inn', focus: null, selected: [], bagCount: 0 });
  const r = await svc(store).setMusic({ track: 'tense', ambient: 'fireplace', reason: 'the stranger arrives' });
  assert.equal(r.details.layer, 'world/inn', '"current" = the player\'s place');
  assert.equal(r.details.changed, true);
  const fm = await fmOf(store, 'world/inn/README.md');
  assert.deepEqual([fm.bgm, fm.ambient, fm.name], ['tense', 'fireplace', 'Inn']);
  assert.match(await store.readFile('world/inn/README.md'), /Body stays\./);
  const [ev] = await musicEvents(store);
  assert.deepEqual(ev.detail, { scope: 'layer', layer: 'world/inn', name: 'Inn', music: 'tense', ambient: 'fireplace', reason: 'the stranger arrives' });
  assert.equal(ev.layer, 'world/inn');
  assert.ok(EventDetailSchemas.music_changed.safeParse(ev.detail).success);
  assert.equal(renderEvent(ev, { layerNames: {} }), 'The music of Inn changed.');
  // the same again: no write, no event
  const again = await svc(store).setMusic({ layer: 'world/inn', track: 'tense' });
  assert.equal(again.details.changed, false);
  assert.equal((await musicEvents(store)).length, 1);
});

test('silence / none / default: declared quiet, and default removes the declaration', async () => {
  const store = await world();
  await svc(store).setMusic({ layer: 'map', track: 'silence', ambient: 'none' });
  let fm = await fmOf(store, 'world/README.md');
  assert.deepEqual([fm.bgm, fm.ambient], ['silence', 'none']);
  await svc(store).setMusic({ layer: 'map', track: 'default', ambient: 'default' });
  fm = await fmOf(store, 'world/README.md');
  assert.ok(!('bgm' in fm) && !('ambient' in fm), 'default drops both keys (inherit / the world theme)');
});

test('the world theme: world.json audio.theme; default = the type\'s default theme', async () => {
  const store = await world();
  const r = await svc(store).setMusic({ layer: 'world', track: 'firstsnow', reason: 'grief' });
  assert.equal(r.details.scope, 'world');
  assert.equal((await store.getManifest()).audio.theme, 'firstsnow');
  const [ev] = await musicEvents(store);
  assert.deepEqual(ev.detail, { scope: 'world', name: 'W', music: 'firstsnow', reason: 'grief' });
  assert.equal(renderEvent(ev, { layerNames: {} }), "The world's theme music changed.");
  await svc(store).setMusic({ layer: 'world', track: 'default' });
  assert.equal((await store.getManifest()).audio.theme, 'divergence', 'story → divergence');
  await svc(store).setMusic({ layer: 'world', track: 'silence' });
  assert.equal((await store.getManifest()).audio.theme, 'silence');
});

test('refusals: made-up ids (with the valid list), ambient on the world, no type default, bad layer, characters', async () => {
  const store = await world({ theme: null });
  await assert.rejects(svc(store).setMusic({ track: 'epic-battle' }), (e) => e.code === 'invalid_argument' && /calm, tense/.test(e.message));
  await assert.rejects(svc(store).setMusic({ layer: 'map', track: 'calm', ambient: 'waterfall' }), /ambient "waterfall" is not in the ambient catalog/);
  await assert.rejects(svc(store).setMusic({ layer: 'world', track: 'calm', ambient: 'rain' }), /a world has no ambient bed/);
  await assert.rejects(svc(store).setMusic({ layer: 'world', track: 'default' }), /no type default theme/);
  await assert.rejects(svc(store).setMusic({ layer: '../etc', track: 'calm' }), /must be "current", "world"/);
  await assert.rejects(svc(store).setMusic({ layer: 'world/nowhere', track: 'calm' }), (e) => e.code === 'not_found');
  await assert.rejects(svc(store).setMusic({}), /name a `track`/);
  await assert.rejects(svc(store, { type: 'character', id: 'ann' }).setMusic({ track: 'calm' }), /characters do not choose the music/);
  assert.equal((await musicEvents(store)).length, 0);
  assert.deepEqual((await fmOf(store, 'world/README.md')).ambient, 'rain', 'nothing written');
});
