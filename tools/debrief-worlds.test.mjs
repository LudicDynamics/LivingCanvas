// The 复盘 / debrief on the real worlds: every world
// that declares `mysteries` is played end to end on a scratch copy through the
// server's own debrief code —
//   - no debrief before an ending; the questions reach the page without answers;
//   - right answers WITH their clues unlock every secret (hidden ones counted
//     apart) → the `all` epilogue; the ending never changes;
//   - right answers WITHOUT the clues unlock nothing (guessed) → `few`;
//   - half right with evidence → `most`; a run is debriefed once;
//   - locale editions share one structure (ids, tiers, clues).
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { LocalWorldStore, WorldManifestSchema, parseFrontmatter, reachedEnding, stringifyFrontmatter } from '../packages/shared/dist/index.js';
import { closedRunState, submitDebrief, DebriefError } from '../apps/server/dist/routes/closed-run.js';
import { mysteryProblems } from './check-world-editions.mjs';
import { shippedOnly } from './shipped-worlds.mjs';

const TEMPLATES = fileURLToPath(new URL('../templates/', import.meta.url));
// Only the worlds this copy carries (the open-source copy ships only some; shipped-worlds.mjs).
const WORLDS = shippedOnly(['whitechapel', 'whitechapel-zh', 'whitechapel-jp', 'wuwu', 'wuwu-zh', 'wuwu-jp', 'last-train', 'last-train-jp', 'last-train-zh', 'guixiang', 'guixiang-jp', 'guixiang-zh']);

const manifestOf = async (id) => WorldManifestSchema.parse(JSON.parse(await fs.readFile(path.join(TEMPLATES, id, 'world.json'), 'utf8')));

async function scratch(id) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `debrief-${id}-`));
  await fs.cp(path.join(TEMPLATES, id), root, { recursive: true, filter: (src) => !/[/\\]\.(airpworld|pi)([/\\]|$)/.test(src) });
  return new LocalWorldStore(root);
}

/** Reach an ending the way `end` records it (the story's own triggers are covered by each world's ending contract). */
async function endStory(store, endingId) {
  const page = parseFrontmatter(await store.readFile('world/README.md'));
  const fm = page.frontmatter ?? {};
  const status = fm.status ?? {};
  await store.writeFile('world/README.md', stringifyFrontmatter({ ...fm, status: { ...status, data: { ...(status.data ?? {}), ending: endingId, endingTurn: 'test' } } }, page.body));
}

/** Put a clue into the save: a find where the search drops it, or carried in the bag. */
async function plant(store, clue) {
  await store.writeFile(clue, `---\ntype: note\ntitle: ${path.basename(clue, '.md')}\nportable: true\n---\n\nevidence\n`);
}

const best = (m) => m.options.find((o) => o.tier === 'hidden') ?? m.options.find((o) => o.tier === 'surface');
const wrong = (m) => m.options.find((o) => o.tier === 'wrong');

for (const id of WORLDS) {
  test(`${id}: declares a well-formed debrief whose clues prove discovery`, async () => {
    const manifest = await manifestOf(id);
    assert.ok(manifest.mysteries?.length, `${id} declares mysteries`);
    assert.ok(manifest.mode === 'closed' || manifest.mode === 'semi', `${id} has endings`);
    assert.deepEqual(await mysteryProblems(path.join(TEMPLATES, id), manifest), []);
  });

  test(`${id}: after the ending, right answers with clues unlock every secret; the ending stays`, async () => {
    const manifest = await manifestOf(id);
    const store = await scratch(id);
    await assert.rejects(submitDebrief(store, {}), (e) => e instanceof DebriefError && e.code === 'not_ended');
    assert.equal((await closedRunState(store)).debrief, null, 'no questions before an ending');

    const endingId = manifest.endings.at(-1).id;
    await endStory(store, endingId);
    const open = await closedRunState(store);
    assert.equal(open.debrief.result, null);
    assert.equal(open.debrief.mysteries.length, manifest.mysteries.length);
    for (const m of open.debrief.mysteries) for (const o of m.options) {
      assert.deepEqual(Object.keys(o).sort(), ['id', 'label'], 'the page never sees tiers, clues or epilogues');
    }

    const answers = {};
    for (const m of manifest.mysteries) {
      const o = best(m);
      answers[m.id] = o.id;
      await plant(store, o.clues[0]);
    }
    const after = await submitDebrief(store, answers);
    const r = after.debrief.result;
    assert.equal(r.unlocked, manifest.mysteries.length);
    assert.equal(r.hidden, manifest.mysteries.filter((m) => best(m).tier === 'hidden').length);
    assert.equal(r.tier, 'all');
    assert.equal(r.epilogue, manifest.reckoning.epilogues.all);
    for (const m of r.mysteries) assert.ok(m.epilogue, `${m.id} unlocks its epilogue`);
    for (const m of r.mysteries.filter((x) => x.verdict === 'hidden')) assert.ok(m.title, 'a hidden answer shows a hidden-ending card');
    assert.equal((await reachedEnding(store))?.id, endingId, 'the debrief never changes the ending');
    assert.equal(after.ending.id, endingId);
    assert.deepEqual((await closedRunState(store)).debrief.result, r, 'the result is stored in the save');
    await assert.rejects(submitDebrief(store, answers), (e) => e instanceof DebriefError && e.code === 'already_answered');
  });

  test(`${id}: right answers without the clues are guesses; half with evidence is "most"`, async () => {
    const manifest = await manifestOf(id);
    const guess = await scratch(id);
    await endStory(guess, manifest.endings[0].id);
    const answers = Object.fromEntries(manifest.mysteries.map((m) => [m.id, best(m).id]));
    const g = (await submitDebrief(guess, answers)).debrief.result;
    assert.equal(g.unlocked, 0, 'guessing right without evidence unlocks nothing');
    assert.ok(g.mysteries.every((m) => m.verdict === 'guessed'));
    assert.equal(g.tier, 'few');

    const half = await scratch(id);
    await endStory(half, manifest.endings[0].id);
    const n = Math.ceil(manifest.mysteries.length / 2);
    const mixed = {};
    for (const [i, m] of manifest.mysteries.entries()) {
      if (i < n) {
        const o = m.options.find((x) => x.tier === 'surface');
        mixed[m.id] = o.id;
        await plant(half, o.clues.at(-1));
      } else {
        mixed[m.id] = wrong(m).id;
      }
    }
    const h = (await submitDebrief(half, mixed)).debrief.result;
    assert.equal(h.unlocked, n);
    assert.equal(h.surface, n);
    assert.equal(h.tier, 'most');
    assert.equal(h.epilogue, manifest.reckoning.epilogues.most);
    assert.deepEqual(h.mysteries.filter((m) => m.verdict === 'wrong').length, manifest.mysteries.length - n);
  });
}

test('locale editions share one debrief structure (ids, tiers, clues)', async () => {
  const shape = (m) => (m.mysteries ?? []).map((x) => ({ id: x.id, options: x.options.map((o) => [o.id, o.tier, o.clues, Boolean(o.title), Boolean(o.epilogue)]) }));
  for (const base of ['whitechapel', 'wuwu']) {
    const en = shape(await manifestOf(base));
    for (const suffix of ['-zh', '-jp']) assert.deepEqual(shape(await manifestOf(base + suffix)), en, `${base}${suffix}`);
  }
});
