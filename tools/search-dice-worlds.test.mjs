// Search → dice chalk → roll → item, on every shipped world that declares a
// search. Runs the real action layer and the
// server's roll shim on scratch copies of the templates:
//   - no find exists in the template, and none appears when the search starts;
//   - the search lands exactly one dice chalk (`search-<spot>.md`);
//   - the roll creates exactly the rolled band's finds, and nothing else;
//   - the three language editions declare the same spots.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { shippedOnly } from './shipped-worlds.mjs';
import { fileURLToPath } from 'node:url';
import {
  bandIndexOfGrade,
  LocalWorldStore, createActionService, parseFrontmatter, parseSearchDeclarations, searchFinds, reachedEnding,
} from '../packages/shared/dist/index.js';
import { runDeclaredChoice, runDeclaredRoll } from '../apps/server/dist/engine/declared-actions.js';

const REPO = fileURLToPath(new URL('../', import.meta.url));
// Only the worlds this copy carries (the open-source copy ships only some; shipped-worlds.mjs).
const EDITIONS = shippedOnly(['whitechapel', 'whitechapel-jp', 'whitechapel-zh', 'wuwu', 'wuwu-jp', 'wuwu-zh', 'last-train', 'last-train-jp', 'last-train-zh', 'guixiang', 'guixiang-jp', 'guixiang-zh']);

async function walk(dir, prefix = '') {
  const out = [];
  for (const e of await fs.readdir(path.join(dir, prefix), { withFileTypes: true })) {
    const rel = path.posix.join(prefix, e.name);
    if (e.isDirectory()) out.push(...await walk(dir, rel)); else out.push(rel);
  }
  return out;
}

/** Every `search:` spot of an edition, with the README that declares it. */
async function spotsOf(edition) {
  const root = path.join(REPO, 'templates', edition);
  const out = [];
  for (const file of (await walk(root, 'world')).filter((f) => f.endsWith('/README.md'))) {
    const fm = parseFrontmatter(await fs.readFile(path.join(root, file), 'utf8')).frontmatter;
    const { spots, errors } = parseSearchDeclarations(fm);
    assert.deepEqual(errors, [], `${edition}/${file}`);
    const layer = file === 'world/README.md' ? 'map' : path.posix.dirname(file);
    for (const spot of spots) out.push({ readme: file, layer, dir: path.posix.dirname(file), spot, fm });
  }
  return out;
}

/** A scratch copy without the (large, irrelevant) assets. */
async function scratch(edition) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `search-${edition}-`));
  await fs.cp(path.join(REPO, 'templates', edition), root, { recursive: true, filter: (src) => !src.includes(`${path.sep}assets`) });
  return root;
}

test('every converted world declares its searches and pre-places neither dice cards nor finds', async () => {
  for (const edition of EDITIONS) {
    const root = path.join(REPO, 'templates', edition);
    const files = await walk(root, 'world');
    assert.ok(!files.some((f) => f.endsWith('/04-investigation-dice.md') && f !== 'world/london-map/04-investigation-dice.md'),
      `${edition}: investigation dice cards are searches now`);
    const spots = await spotsOf(edition);
    // 末班车 cut the cab's key-board search in its three-act rework: three cars search there.
    assert.ok(spots.length >= (edition.startsWith('last-train') ? 3 : 4), `${edition}: declares its searches`);
    for (const { spot, dir } of spots) {
      assert.ok(!files.includes(`${dir}/search-${spot.id}.md`), `${edition}: ${spot.id} chalk is not pre-placed`);
      for (const find of searchFinds(spot)) assert.ok(!files.includes(find), `${edition}: ${find} exists only after the roll`);
    }
  }
});

test('the three language editions declare identical search spots', async () => {
  const machine = async (edition) => (await spotsOf(edition)).map(({ readme, spot }) => ({
    readme, id: spot.id, dice: spot.roll_dice.type + spot.roll_dice.expect,
    bands: (spot.dice_outcomes ?? []).map((b) => [b.min, b.max, (b.rewards ?? []).map((r) => r.path)]),
    on: JSON.stringify(spot.on ?? null),
  }));
  for (const base of ['whitechapel', 'wuwu']) {
    const en = await machine(base);
    for (const locale of ['jp', 'zh']) assert.deepEqual(await machine(`${base}-${locale}`), en, `${base}-${locale}`);
  }
});

test('a scene button search opens the dice chalk; the finds appear only after the roll, by band', async () => {
  for (const edition of EDITIONS) {
    const spots = await spotsOf(edition);
    const bandCount = Math.max(...spots.map(({ spot }) => spot.dice_outcomes?.length ?? 1));
    for (let band = 0; band < bandCount; band++) {
      const root = await scratch(edition);
      const store = new LocalWorldStore(root);
      let n = 0;
      const player = () => createActionService(store, { type: 'player' }, { turn: `req:search-${++n}` });
      const god = () => createActionService(store, { type: 'god' }, { turn: `req:search-${++n}` });
      for (const { readme, layer, dir, spot, fm } of spots) {
        if (await reachedEnding(store)) break; // a closed world may end mid-sweep (wuwu, guixiang)
        const chalk = `${dir}/search-${spot.id}.md`;
        const finds = searchFinds(spot);
        // Prefer the scene's own button when it names this spot, else search directly.
        const buttonId = Object.entries(fm.choice_actions ?? {}).find(([, a]) => a.kind === 'search' && a.spot === spot.id && !a.layer)?.[0];
        if (buttonId && (fm.choice?.options ?? []).some((o) => o.id === buttonId)) {
          const chosen = await runDeclaredChoice(player(), readme, buttonId);
          assert.equal(chosen.details.action.kind, 'search', `${edition}:${readme}`);
          assert.equal(chosen.details.action.chalk, chalk);
          assert.equal(chosen.details.action.items[0].path, chalk, 'the dialog opens the dice chalk');
          assert.ok(chosen.details.action.items[0].frontmatter.roll_dice, 'with its roll button');
        } else {
          await player().searchPlace({ layer, spot: spot.id });
        }
        assert.equal(await store.statKind(chalk), 'file', `${edition}: ${chalk} spawned`);
        for (const find of finds) assert.equal(await store.statKind(find), 'missing', `${edition}: ${find} before the roll`);

        const bands = spot.dice_outcomes ?? [];
        const target = bands.length ? bands[Math.min(band, bands.length - 1)] : null;
        const score = target ? target.min : 11;
        const before = new Set(await walk(root, 'world'));
        await runDeclaredRoll(god(), chalk, score);
        const created = (await walk(root, 'world')).filter((f) => !before.has(f) && f.endsWith('.md'));
        // A skill search picks its band by the check's GRADE, not by the forced
        // total: read the band the roll chose.
        const rolledFm = parseFrontmatter(await fs.readFile(path.join(root, chalk), 'utf8')).frontmatter;
        const grade = rolledFm.dice_receipt?.skill?.grade;
        const chosen = rolledFm.skill_check && grade ? bands[bandIndexOfGrade(rolledFm, grade)] : target;
        const expected = (chosen?.rewards ?? []).map((r) => r.path);
        assert.deepEqual([...new Set(created)].sort(), [...new Set(expected)].sort(), `${edition}: ${chalk} @${score} creates exactly its band's finds`);
        for (const p of expected) {
          const item = parseFrontmatter(await fs.readFile(path.join(root, p), 'utf8')).frontmatter;
          assert.equal(item.dice_reward.source, chalk, `${p} records the roll that made it`);
        }
        // A second press replays the stored roll: same score, nothing new created.
        const settled = new Set(await walk(root, 'world'));
        const again = await runDeclaredRoll(player(), chalk).catch((e) => e);
        if (!(again instanceof Error)) assert.equal(again.details.result, score, 'a search is rolled once');
        assert.deepEqual((await walk(root, 'world')).filter((f) => !settled.has(f)), [], 'replaying creates nothing');
      }
      await fs.rm(root, { recursive: true, force: true });
    }
  }
});

test('Holmes: a success yields the place key clue; a failure only its half clue and time', async () => {
  // Bands in order: great, success, setback (失败), failure (大失败). The key clue
  // is what a success and a great success yield; a great success may add evidence
  // on top (margin-note, returned-proofs, asked-the-way). A failure yields the
  // half clue (`partial: true`) and costs a step of the noon clock, a critical
  // failure two.
  for (const edition of ['whitechapel', 'whitechapel-jp', 'whitechapel-zh', 'whitechapel-ko']) {
    for (const { spot, dir } of await spotsOf(edition)) {
      const [great, success, setback, failure] = spot.dice_outcomes;
      const full = (band) => band.rewards.filter((r) => !r.partial).map((r) => r.path);
      for (const [name, band, clock] of [['setback', setback, -1], ['failure', failure, -2]]) {
        const halves = band.rewards.filter((r) => r.partial === true && r.path.endsWith('-half.md'));
        assert.equal(halves.length, 1, `${edition}: ${dir} ${name} gives a half clue`);
        const key = halves[0].path.replace(/-half\.md$/, '.md');
        assert.ok(full(success).includes(key) && full(great).includes(key), `${edition}: ${dir} a success yields ${key}`);
        assert.ok(!full(band).includes(key), `${edition}: ${dir} ${name} holds back the key clue`);
        assert.deepEqual(band.cost, { clock }, `${edition}: ${dir} ${name} costs time`);
      }
    }
  }
});
