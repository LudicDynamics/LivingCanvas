// Character skills in the official worlds:
// every edition declares the family's rule system, its sheets parse, every skill
// resolves to the right band in that system, a declared search becomes the
// protagonist's check against the sheet, and a companion can roll for itself.
// Real templates copied to scratch directories; forced totals / injected rng only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  LocalWorldStore,
  createActionService,
  parseFrontmatter,
  parseSearchDeclarations,
  parseSheet,
  worldRulesOf,
  checkSpec,
  resolveCheck,
  dndSkillModifier,
} from '../packages/shared/dist/index.js';
import { editionFamilies, editionId, editionLocales, shippedFamilies } from './world-editions.mjs';
import { skipUnlessShipped } from './shipped-worlds.mjs';
import { filesUnder } from './localize-world-editions.mjs';

/** The rule system each family plays with. */
export const FAMILY_RULES = {
  whitechapel: { system: 'coc', sanity: false },
  guixiang: { system: 'coc', sanity: true },
  'last-train': { system: 'coc', sanity: false },
  'last-witness': { system: 'coc', sanity: false },
  wuwu: { system: 'coc', sanity: false },
  divergence: { system: 'coc', sanity: false },
  'magic-academy': { system: 'dnd', sanity: false },
  'moonlit-contract': { system: 'dnd', sanity: false },
  'unwritten-door': { system: 'dnd', sanity: false },
};

const templateOf = (id) => fileURLToPath(new URL(`../templates/${id}`, import.meta.url));
const fmOf = async (root, rel) => parseFrontmatter(await fs.readFile(path.join(root, rel), 'utf8')).frontmatter ?? {};

// 初雪电台 has no skills: no rules, no sheets, no skill checks.
test('first-snow plays without skills in every edition', { skip: skipUnlessShipped('first-snow') }, async () => {
  const family = editionFamilies.find((f) => f.base === 'firstsnow');
  for (const locale of editionLocales) {
    const root = templateOf(editionId(family, locale));
    const manifest = JSON.parse(await fs.readFile(path.join(root, 'world.json'), 'utf8'));
    assert.equal(worldRulesOf(manifest), null, `${editionId(family, locale)}: no rules`);
    for (const rel of (await filesUnder(root)).filter((f) => f.endsWith('README.md'))) {
      assert.equal((await fmOf(root, rel)).sheet, undefined, `${rel}: no sheet`);
    }
  }
});

for (const family of shippedFamilies().filter((f) => FAMILY_RULES[f.base])) {
  const expected = FAMILY_RULES[family.base];
  for (const locale of editionLocales) {
    const id = editionId(family, locale);
    const root = templateOf(id);

    test(`${id}: ${expected.system} rules, clean sheets, every skill bands correctly`, async () => {
      const manifest = JSON.parse(await fs.readFile(path.join(root, 'world.json'), 'utf8'));
      const rules = worldRulesOf(manifest);
      assert.ok(rules, 'world.json declares rules');
      assert.equal(rules.system, expected.system);
      assert.equal(rules.sanity, expected.sanity);
      const player = parseSheet(await fmOf(root, 'player/README.md'), rules.system, manifest.locale);
      assert.deepEqual(player.errors, []);
      assert.ok(player.sheet.skills.length >= 4, 'a protagonist has a real sheet');
      const sheets = [player.sheet];
      for (const c of manifest.characters.filter((x) => x.role === 'companion')) {
        const r = parseSheet(await fmOf(root, `characters/${c.id}/README.md`), rules.system, manifest.locale);
        assert.deepEqual(r.errors, [], c.id);
        assert.ok(r.sheet, `companion ${c.id} has a sheet`);
        sheets.push(r.sheet);
      }
      for (const sheet of sheets) for (const skill of sheet.skills) {
        assert.ok(skill.label && !/^[a-z_]+$/.test(skill.label) || locale === 'en', `${skill.id} is labelled in the edition language`);
        if (rules.system === 'coc') {
          const v = skill.value;
          const spec = checkSpec({ system: 'coc', value: v });
          assert.equal(spec.expect, `<=${v}`);
          assert.equal(resolveCheck(spec, 1).grade, 'great');
          assert.equal(resolveCheck(spec, Math.max(1, Math.floor(v / 5))).grade, 'great');
          assert.equal(resolveCheck(spec, v).grade, v <= Math.floor(v / 5) ? 'great' : 'success');
          if (v < 95) assert.equal(resolveCheck(spec, v + 1).grade, 'setback');
          assert.equal(resolveCheck(spec, 96).grade, 'failure');
          assert.equal(resolveCheck(checkSpec({ system: 'coc', value: v, difficulty: 'hard' }), Math.floor(v / 2) + 1).passed, false);
        } else {
          const m = dndSkillModifier(sheet, skill, rules.proficiency);
          const spec = checkSpec({ system: 'dnd', value: m, difficulty: 12 });
          assert.equal(resolveCheck(spec, 1).grade, 'failure');
          assert.equal(resolveCheck(spec, 20).grade, 'great');
          const need = 12 - m;
          if (need > 1 && need < 20) {
            assert.equal(resolveCheck(spec, need).passed, true);
            assert.equal(resolveCheck(spec, need - 1).passed, false);
          }
        }
      }
    });

    test(`${id}: a declared search is the protagonist's check against the sheet`, async () => {
      const scratch = await fs.mkdtemp(path.join(os.tmpdir(), `skills-${id}-`));
      await fs.cp(root, scratch, { recursive: true });
      const store = new LocalWorldStore(scratch);
      const manifest = JSON.parse(await fs.readFile(path.join(scratch, 'world.json'), 'utf8'));
      const rules = worldRulesOf(manifest);
      const player = parseSheet(await fmOf(scratch, 'player/README.md'), rules.system, manifest.locale).sheet;
      const valueOf = (skill) => player.skills.find((s) => s.id === skill).value;
      let n = 0;
      let checked = 0;
      for (const rel of (await filesUnder(scratch)).filter((f) => f.startsWith('world/') && f.endsWith('README.md'))) {
        for (const spot of parseSearchDeclarations(await fmOf(scratch, rel)).spots) {
          assert.ok(spot.skill, `${rel}#${spot.id} names its skill`);
          const layer = rel === 'world/README.md' ? 'map' : path.dirname(rel);
          const res = await createActionService(store, { type: 'player' }, { turn: `req:s-${++n}` }).searchPlace({ layer, spot: spot.id });
          const card = await fmOf(scratch, res.details.path);
          assert.equal(card.skill_check.skill, spot.skill);
          if (rules.system === 'coc') {
            const v = valueOf(spot.skill);
            assert.equal(card.roll_dice.expect, `<=${v}`);
            await assert.rejects(createActionService(store, { type: 'writer' }, { turn: `req:w-${n}` }).rollDice({ path: res.details.path }), /the player rolls/);
            const r = await createActionService(store, { type: 'god' }, { turn: `req:g-${n}` }).rollDice({ path: res.details.path, forcedResult: v });
            assert.equal(r.details.skill.id, spot.skill);
            assert.equal(r.details.skill.grade, 'success');
          }
          checked += 1;
        }
      }
      if (family.base === 'whitechapel' || family.base === 'guixiang') assert.ok(checked >= 7);
    });

    test(`${id}: a companion rolls its own check at once`, async () => {
      const scratch = await fs.mkdtemp(path.join(os.tmpdir(), `skills-c-${id}-`));
      await fs.cp(root, scratch, { recursive: true });
      const manifest = JSON.parse(await fs.readFile(path.join(scratch, 'world.json'), 'utf8'));
      const rules = worldRulesOf(manifest);
      const companion = manifest.characters.find((c) => c.role === 'companion');
      const sheet = parseSheet(await fmOf(scratch, `characters/${companion.id}/README.md`), rules.system, manifest.locale).sheet;
      const svc = createActionService(new LocalWorldStore(scratch), { type: 'character', id: companion.id }, { turn: 'req:c', rng: () => 0 });
      const r = await svc.skillCheck({ skill: sheet.skills[0].id, actor: 'self', title: 'test' });
      assert.equal(r.details.actor, companion.id);
      assert.equal(r.details.roll.skill.actor, companion.id);
      assert.equal(r.details.roll.rolls[0], 1);
      assert.equal(r.details.roll.skill.grade, rules.system === 'coc' ? 'great' : 'failure', 'a 1 is a critical under d100, a natural 1 under d20');
    });
  }
}
