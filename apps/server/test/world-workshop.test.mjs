// The world workshop. Runs against built dist
//: `pnpm --filter @airp/server build` first.
//
// What is pinned here is the shape the team settled on 2026-09-26, not the file
// plumbing: a made world is a SAVE with a `made-` id and a written entry scene;
// a failed cover leaves nothing on the shelf; publishing is a snapshot into a
// shared root that the shelf shows like a template and the load route copies;
// and only the author's original — never a play copy, never another seat — can
// publish or unpublish.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  MADE_ID,
  createCoverPainter,
  createWorkshopWorld,
  isAuthoringWorld,
  isOfficialId,
  isSyncWorldId,
  parseCreateWorldInput,
  publishWorkshopWorld,
  unpublishWorkshopWorld,
  worldBuildingBrief,
  workshopOf,
} from '../dist/world-workshop.js';
import { publishedRoot, resolveWorldPath } from '../dist/engine/user-root.js';
import { readWorldShelf, worldCover } from '../dist/world-shelf.js';

// A 1×1 PNG: enough for "a real file with the declared type landed".
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const painter = async (prompt) => ({ ok: true, mimeType: 'image/png', dataB64: PNG_B64, prompt });
const failingPainter = async () => ({ ok: false, reason: 'provider_error', message: 'nope' });

async function sandbox() {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-workshop-'));
  await fs.mkdir(path.join(repo, 'templates'));
  process.env.AIRP_WORLDS_ROOT = path.join(repo, 'saves');
  process.env.AIRP_PUBLISHED_ROOT = path.join(repo, 'shared');
  delete process.env.AIRP_USER_ID;
  return repo;
}

const input = (cover = { kind: 'generate', prompt: 'a harbour at dusk' }) => parseCreateWorldInput({
  name: 'Fog Harbour', description: 'A town that forgets its ships.', locale: 'zh-CN', cover,
});

test('a made world is a save with a made- id, a cover, a written entry scene and a draft marker', async () => {
  const repo = await sandbox();
  const made = await createWorkshopWorld(repo, input(), painter);
  assert.match(made.id, MADE_ID);
  assert.equal(made.worldPath, `worlds/${made.id}`);
  const dir = path.join(repo, 'saves', made.id);
  const manifest = JSON.parse(await fs.readFile(path.join(dir, 'world.json'), 'utf8'));
  assert.equal(manifest.id, made.id);
  assert.equal(manifest.cover, 'assets/scenes/intro.png');
  assert.equal(manifest.locale, 'zh-CN');
  assert.deepEqual(manifest.characters, []);
  assert.equal(manifest.workshop.status, 'draft');
  assert.equal(manifest.workshop.owner, 'local');
  // Nobody speaks yet, so the narrator's line is the first act — in the world's language.
  assert.match(manifest.opening.greeting, /作家/);
  assert.equal((await fs.stat(path.join(dir, 'assets/scenes/intro.png'))).size, Buffer.from(PNG_B64, 'base64').length);
  const readme = await fs.readFile(path.join(dir, 'world/README.md'), 'utf8');
  assert.match(readme, /^---\ntype: readme\nname: "Fog Harbour"/);
  assert.match(readme, /bg: assets\/scenes\/intro\.png/);
  assert.match(readme, /A town that forgets its ships\./);
  // The entry is a WRITTEN layer: entering it must not fire the initialiser blind.
  assert.equal(workshopOf(manifest).status, 'draft');
  assert.equal(isAuthoringWorld(dir, manifest), true);
  assert.equal(isAuthoringWorld(path.join(repo, 'saves', `${made.id}-abcd1234`), manifest), false, 'a play copy is not an authoring session');
});

test('a failed or unavailable cover leaves no world behind; an upload is written with its own type', async () => {
  const repo = await sandbox();
  await assert.rejects(createWorkshopWorld(repo, input(), failingPainter), (err) => err.code === 'cover_failed' && err.status === 502);
  await assert.rejects(createWorkshopWorld(repo, input(), null), (err) => err.code === 'no_image_model' && err.status === 503);
  assert.deepEqual(await fs.readdir(path.join(repo, 'saves')).catch(() => []), []);
  const made = await createWorkshopWorld(repo, input({ kind: 'upload', mimeType: 'image/webp', dataB64: PNG_B64 }), null);
  const manifest = JSON.parse(await fs.readFile(path.join(repo, 'saves', made.id, 'world.json'), 'utf8'));
  assert.equal(manifest.cover, 'assets/scenes/intro.webp');
  await fs.access(path.join(repo, 'saves', made.id, 'assets/scenes/intro.webp'));
});

test('the request body is validated before anything is painted', () => {
  assert.throws(() => parseCreateWorldInput({ name: '', description: 'x', cover: { kind: 'generate', prompt: 'p' } }), /name is required/);
  assert.throws(() => parseCreateWorldInput({ name: 'x', description: 'y' }), /cover is required/);
  assert.throws(() => parseCreateWorldInput({ name: 'x', description: 'y', cover: { kind: 'upload', mimeType: 'image/gif', dataB64: 'AAAA' } }), /PNG, JPEG or WebP/);
  assert.throws(() => parseCreateWorldInput({ name: 'x', description: 'y', cover: { kind: 'upload', mimeType: 'image/png', dataB64: 'A'.repeat(12 * 1024 * 1024) } }), (err) => err.status === 413);
  // An unknown locale falls back to English rather than failing the whole form.
  assert.equal(parseCreateWorldInput({ name: 'x', description: 'y', locale: 'fr', cover: { kind: 'generate', prompt: 'p' } }).locale, 'en');
});

test('the view a world opens in is chosen at creation and lands in world.json (map-first TRPG worlds)', async () => {
  const body = (view) => ({ name: 'x', description: 'y', cover: { kind: 'generate', prompt: 'p' }, ...(view === undefined ? {} : { view }) });
  assert.equal(parseCreateWorldInput(body('map')).view, 'map');
  assert.equal(parseCreateWorldInput(body('canvas')).view, 'canvas');
  assert.equal(parseCreateWorldInput(body(undefined)).view, undefined, 'absent stays absent: the canvas');
  assert.throws(() => parseCreateWorldInput(body('globe')), (err) => err.status === 400 && /view must be one of/.test(err.message));

  const repo = await sandbox();
  const map = await createWorkshopWorld(repo, parseCreateWorldInput({ ...body('map'), name: 'Mapped' }), painter);
  const mapped = JSON.parse(await fs.readFile(path.join(repo, 'saves', map.id, 'world.json'), 'utf8'));
  assert.deepEqual(mapped.view, { default: 'map' });
  const open = await createWorkshopWorld(repo, input(), painter);
  const plain = JSON.parse(await fs.readFile(path.join(repo, 'saves', open.id, 'world.json'), 'utf8'));
  assert.equal(plain.view, undefined, 'no choice, no field: older clients keep making canvas worlds');
});

test('publishing snapshots the original into the shared root; the shelf shows it like a template; the load path copies it', async () => {
  const repo = await sandbox();
  const made = await createWorkshopWorld(repo, input(), painter);
  const dir = path.join(repo, 'saves', made.id);
  // Runtime state must never travel with the snapshot — but the pictures the
  // writer painted into `.airpworld/assets/gen` must, or the READMEs' `bg:` and
  // `map.plan.picture` point at nothing in the published copy.
  await fs.mkdir(path.join(dir, '.airpworld/assets/gen'), { recursive: true });
  await fs.writeFile(path.join(dir, '.airpworld/history.db'), 'x');
  await fs.writeFile(path.join(dir, '.airpworld/assets/gen/harbour-map-abc.png'), 'png');
  await fs.mkdir(path.join(dir, '.pi'));
  await fs.writeFile(path.join(dir, '.pi/session.json'), '{}');

  const before = await readWorldShelf(repo);
  const draft = before.groups.find(g => g.id === made.id);
  assert.ok(draft, 'the draft has its own brick');
  assert.equal(draft.templatePath, null);
  // Cover URLs carry the file's content hash.
  assert.match(draft.cover, new RegExp(`^/api/worlds/cover\\?save=${made.id}&h=[0-9a-f]{32}$`));
  assert.deepEqual({ status: draft.workshop.status, mine: draft.workshop.mine, editPath: draft.workshop.editPath }, { status: 'draft', mine: true, editPath: `worlds/${made.id}` });
  assert.ok(await worldCover(repo, made.id, 'image', 'save'));

  const published = await publishWorkshopWorld(repo, made.worldPath);
  assert.equal(published.publishedPath, `published/${made.id}`);
  const snapshot = path.join(publishedRoot(repo), made.id);
  assert.equal(resolveWorldPath(repo, published.publishedPath), snapshot);
  await fs.access(path.join(snapshot, 'assets/scenes/intro.png'));
  await fs.access(path.join(snapshot, '.airpworld/assets/gen/harbour-map-abc.png'));
  await assert.rejects(fs.access(path.join(snapshot, '.airpworld/history.db')));
  await assert.rejects(fs.access(path.join(snapshot, '.pi')));
  assert.equal(JSON.parse(await fs.readFile(path.join(snapshot, 'world.json'), 'utf8')).workshop.status, 'published');
  assert.equal(JSON.parse(await fs.readFile(path.join(dir, 'world.json'), 'utf8')).workshop.status, 'published', 'the original remembers it is published');

  const after = await readWorldShelf(repo);
  const group = after.groups.find(g => g.id === made.id);
  assert.equal(group.templatePath, `published/${made.id}`, 'others start games from the snapshot');
  assert.match(group.cover, new RegExp(`^/api/worlds/cover\\?published=${made.id}&h=[0-9a-f]{32}$`));
  assert.equal(group.workshop.editPath, `worlds/${made.id}`, 'the author still opens the original');
  assert.equal(group.saves.length, 1);
  assert.ok(await worldCover(repo, made.id, 'image', 'published'));

  // Republishing replaces the snapshot and keeps the old one recoverable.
  await publishWorkshopWorld(repo, made.worldPath);
  assert.equal((await fs.readdir(path.join(publishedRoot(repo), '.trash'))).length, 1);

  await unpublishWorkshopWorld(repo, made.worldPath);
  await assert.rejects(fs.access(snapshot));
  const manifest = JSON.parse(await fs.readFile(path.join(dir, 'world.json'), 'utf8'));
  assert.equal(manifest.workshop.status, 'draft');
  assert.equal(manifest.workshop.publishedAt, undefined);
  assert.equal((await readWorldShelf(repo)).groups.find(g => g.id === made.id).templatePath, null);
});

test('only the author, and only the original, can publish', async () => {
  const repo = await sandbox();
  const made = await createWorkshopWorld(repo, input(), painter);
  await assert.rejects(publishWorkshopWorld(repo, 'worlds/wuwu-default'), (err) => err.status === 400);
  await assert.rejects(publishWorkshopWorld(repo, 'worlds/made-00000000'), (err) => err.status === 404);
  // A play copy carries the same manifest id under a suffixed directory.
  await fs.cp(path.join(repo, 'saves', made.id), path.join(repo, 'saves', `${made.id}-abcd1234`), { recursive: true });
  await assert.rejects(publishWorkshopWorld(repo, `worlds/${made.id}-abcd1234`), (err) => err.status === 400, 'a copy is not even a made-id path');
  // With a shared save root (as this sandbox has), another seat reaches the
  // same directory and is stopped by the owner check; with per-user roots it
  // would not even find the save (404). Either way, nobody else publishes it.
  process.env.AIRP_USER_ID = 'someone-else';
  await assert.rejects(publishWorkshopWorld(repo, made.worldPath), (err) => err.status === 403 && err.code === 'not_owner');
  delete process.env.AIRP_USER_ID;
});

test('the building brief is long while the world is empty and a reminder once it has people', () => {
  const empty = { locale: 'ja', characters: [] };
  assert.match(worldBuildingBrief(empty), /create_char/);
  assert.match(worldBuildingBrief(empty), /world-workshop skill/);
  assert.match(worldBuildingBrief(empty), /map\.plan\.picture/);
  assert.match(worldBuildingBrief(empty), /\(ja\)/);
  const peopled = { locale: 'en', characters: [{ id: 'a' }] };
  assert.doesNotMatch(worldBuildingBrief(peopled), /create_char/);
  assert.match(worldBuildingBrief(peopled), /AUTHOR/);
  assert.match(worldBuildingBrief(peopled), /world-workshop skill/);
});

test('the server paints only through an openai/ model; anything else means upload', () => {
  assert.equal(createCoverPainter({}), null);
  assert.equal(createCoverPainter({ AIRP_IMAGE_MODEL: 'openrouter/google/gemini-2.5-flash-image' }), null);
  assert.equal(typeof createCoverPainter({ AIRP_IMAGE_MODEL: 'openai/gpt-image-1' }), 'function');
});

test('一键补完 keeps what the author typed, fills the rest, and fails loud on a broken answer', async () => {
  const { parseSuggestFormInput, suggestFormPrompt, suggestWorldForm } = await import('../dist/world-workshop.js');
  const input = parseSuggestFormInput({ locale: 'zh-CN', name: '雾港' });
  const prompt = suggestFormPrompt(input);
  assert.match(prompt, /Simplified Chinese/);
  assert.match(prompt, /- name: 雾港/);
  assert.match(prompt, /no text, no people/, 'the cover prompt rule from the skill');
  const calls = [];
  const fake = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ name: 'IGNORED', description: '一座会忘记自己船只的港口小镇。', playerName: '港务调查员', coverPrompt: 'Muted watercolour, dusk light. A fog-bound harbour seen from the quay, one lit window, no text, no people' }) } }] }), { status: 200 });
  };
  const filled = await suggestWorldForm(input, { DEEPSEEK_API_KEY: 'k' }, fake);
  assert.equal(filled.name, '雾港', 'typed fields are never overwritten');
  assert.equal(filled.playerName, '港务调查员');
  assert.match(filled.coverPrompt, /no text, no people/);
  assert.equal(calls[0].url, 'https://api.deepseek.com/chat/completions');
  assert.equal(calls[0].body.response_format.type, 'json_object');
  assert.deepEqual(calls[0].body.thinking, { type: 'disabled' });
  await assert.rejects(suggestWorldForm(input, {}, fake), (err) => err.code === 'no_text_model');
  await assert.rejects(suggestWorldForm(input, { DEEPSEEK_API_KEY: 'k' }, async () => new Response('nope', { status: 500 })), (err) => err.code === 'suggest_failed');
  await assert.rejects(suggestWorldForm(input, { DEEPSEEK_API_KEY: 'k' }, async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"name":"x"}' } }] }), { status: 200 })), (err) => /incomplete/.test(err.message));
});

//: the owner of an official edition edits a downloaded copy at worlds/<edition id>.
test('an official edition\'s owner copy is the edition\'s brick, theirs to keep building and republish (never into the local published root)', async () => {
  for (const id of ['wuwu', 'wuwu-jp', 'last-train-ko', 'fpal']) assert.ok(isOfficialId(id) && isSyncWorldId(id), id);
  for (const id of ['made-0000abcd', 'Wuwu', '../x', 'a/b', '', 'wuwu-', '-x', 'x'.repeat(65)]) assert.equal(isOfficialId(id), false, id);
  assert.ok(isSyncWorldId('made-0000abcd'));
  const repo = await sandbox();
  const manifest = { id: 'wuwu', name: 'Wuwu', locale: 'en', cover: 'assets/cover.png', createdAt: 'x', updatedAt: 'x' };
  await fs.mkdir(path.join(repo, 'templates', 'wuwu', 'assets'), { recursive: true });
  await fs.writeFile(path.join(repo, 'templates', 'wuwu', 'world.json'), JSON.stringify(manifest));
  await fs.writeFile(path.join(repo, 'templates', 'wuwu', 'assets', 'cover.png'), Buffer.from(PNG_B64, 'base64'));
  const copy = path.join(repo, 'saves', 'wuwu');
  await fs.mkdir(copy, { recursive: true });
  const owned = { ...manifest, workshop: { status: 'published', owner: 'local', createdAt: 'x', official: true } };
  await fs.writeFile(path.join(copy, 'world.json'), JSON.stringify(owned));
  assert.deepEqual(workshopOf(owned), { status: 'published', owner: 'local', createdAt: 'x', official: true });
  assert.equal(isAuthoringWorld(copy, owned), true, 'the writer builds in it');

  const group = (await readWorldShelf(repo)).groups.find(g => g.id === 'wuwu');
  assert.equal(group.templatePath, 'templates/wuwu', 'still the edition: new games start from the template');
  assert.deepEqual([group.workshop.official, group.workshop.mine, group.workshop.status, group.workshop.editPath], [true, true, 'published', 'worlds/wuwu']);
  await assert.rejects(publishWorkshopWorld(repo, 'worlds/wuwu'), (err) => err.code === 'invalid_argument', 'republished on the remote only');
  await assert.rejects(unpublishWorkshopWorld(repo, 'worlds/wuwu'), (err) => err.code === 'invalid_argument');

  // On another seat (not its owner) the same files are only a template copy's neighbour: no workshop actions.
  process.env.AIRP_USER_ID = 'bob';
  try {
    const other = (await readWorldShelf(repo)).groups.find(g => g.id === 'wuwu');
    assert.equal(other?.workshop?.mine ?? false, false);
  } finally {
    delete process.env.AIRP_USER_ID;
  }
});
