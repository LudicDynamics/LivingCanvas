/**
 * Character skills and skill checks:
 * the pure rules (`rules/skills.ts`) and the action path (`skillCheck` →
 * a check card → `rollDice` judges tier + grade). Imports the BUILT dist; no
 * model, forced totals and injected rng only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  LocalWorldStore,
  createActionService,
  parseFrontmatter,
  stringifyFrontmatter,
  worldRulesOf,
  parseSheet,
  checkSpec,
  resolveCheck,
  rollCheck,
  defaultSheet,
  dndSkillModifier,
  checkLine,
  sheetsWriterBlock,
  bandGradesOf,
  COC_SKILLS,
  DND_SKILLS,
} from '../dist/index.js';

test('worldRulesOf: rules first, theme.rules second, otherwise null', () => {
  assert.equal(worldRulesOf({}), null);
  assert.equal(worldRulesOf({ theme: { rules: 'narrative' } }), null);
  assert.deepEqual(worldRulesOf({ rules: { system: 'coc', sanity: true } }), { system: 'coc', sanity: true, characterChecks: true, proficiency: 2 });
  assert.equal(worldRulesOf({ theme: { rules: 'dnd' } }).system, 'dnd');
  assert.equal(worldRulesOf({ theme: { rules: 'cthulhu' } }).system, 'coc');
  assert.equal(worldRulesOf({ rules: { system: 'dnd', sanity: true } }).sanity, false, 'sanity is a coc thing');
  assert.equal(worldRulesOf({ rules: { system: 'gurps' } }), null);
});

test('catalogs carry four languages and unique ids', () => {
  for (const list of [COC_SKILLS, DND_SKILLS]) {
    assert.equal(new Set(list.map((s) => s.id)).size, list.length);
    for (const s of list) for (const l of ['en', 'zh-CN', 'ja', 'ko']) assert.ok(s.label[l], `${s.id} ${l}`);
  }
});

test('coc: skill 60 regular reproduces the percentile table 1–12 / 13–60 / 61–95 / 96–100', () => {
  const spec = checkSpec({ system: 'coc', value: 60 });
  assert.equal(spec.type, '1d100');
  assert.equal(spec.expect, '<=60');
  const g = (r) => resolveCheck(spec, r).grade;
  assert.deepEqual([1, 12, 13, 60, 61, 95, 96, 100].map(g), ['great', 'great', 'success', 'success', 'setback', 'setback', 'failure', 'failure']);
  assert.equal(resolveCheck(spec, 1).tier, 'critical');
  assert.equal(resolveCheck(spec, 12).tier, 'extreme');
  assert.equal(resolveCheck(spec, 30).tier, 'hard');
  assert.equal(resolveCheck(spec, 31).tier, 'regular');
  assert.equal(resolveCheck(spec, 61).tier, 'failure');
  assert.equal(resolveCheck(spec, 96).tier, 'fumble');
});

test('coc: hard and extreme difficulty halve and fifth the target', () => {
  const hard = checkSpec({ system: 'coc', value: 70, difficulty: 'hard' });
  assert.equal(hard.expect, '<=35');
  assert.equal(resolveCheck(hard, 35).passed, true);
  assert.equal(resolveCheck(hard, 36).passed, false);
  assert.equal(resolveCheck(hard, 36).grade, 'setback');
  assert.equal(resolveCheck(hard, 14).grade, 'great', 'extreme beats a hard requirement');
  const extreme = checkSpec({ system: 'coc', value: 70, difficulty: 'extreme' });
  assert.equal(extreme.expect, '<=14');
  assert.equal(resolveCheck(extreme, 14).grade, 'success');
  assert.equal(resolveCheck(extreme, 1).grade, 'great');
  assert.equal(checkSpec({ system: 'coc', value: 3, difficulty: 'extreme' }).target, 1, 'never below 1');
});

test('dnd: d20 + modifier vs DC, natural 20 / 1, advantage keeps the higher die', () => {
  const spec = checkSpec({ system: 'dnd', value: 2, difficulty: 12 });
  assert.equal(spec.type, '1d20+2');
  assert.equal(spec.expect, '>=12');
  const g = (n) => resolveCheck(spec, n).grade;
  assert.deepEqual([1, 2, 9, 10, 19, 20].map(g), ['failure', 'setback', 'setback', 'success', 'success', 'great']);
  assert.equal(resolveCheck(checkSpec({ system: 'dnd', value: 0, difficulty: 25 }), 20).passed, true, 'natural 20 passes');
  assert.equal(resolveCheck(checkSpec({ system: 'dnd', value: 10, difficulty: 5 }), 1).passed, false, 'natural 1 fails');
  assert.equal(resolveCheck(checkSpec({ system: 'dnd', value: 5, difficulty: 10 }), 15).grade, 'great', 'beat the DC by 10');
  assert.equal(checkSpec({ system: 'dnd', value: -1 }).type, '1d20-1');
  assert.equal(checkSpec({ system: 'dnd', value: 0, difficulty: 'hard' }).target, 15);
  const seq = [0.1, 0.9]; // faces 3 and 19
  const adv = rollCheck(checkSpec({ system: 'dnd', value: 0, advantage: 'advantage' }), () => seq.shift());
  assert.deepEqual(adv.rolls, [3, 19]);
  assert.equal(adv.natural, 19);
  const seq2 = [0.1, 0.9];
  assert.equal(rollCheck(checkSpec({ system: 'dnd', value: 0, advantage: 'disadvantage' }), () => seq2.shift()).natural, 3);
});

test('sheets parse fail-soft per system; default sheets parse in every language', () => {
  const coc = parseSheet({ sheet: { skills: [{ id: 'spot_hidden', value: 60 }, { id: 'bad id', value: 5 }, { id: 'radio', value: 70 }, { id: 'listen', value: 120 }] } }, 'coc', 'zh-CN');
  assert.equal(coc.sheet.skills.length, 1);
  assert.equal(coc.sheet.skills[0].label, '侦查', 'standard label filled in');
  assert.equal(coc.errors.length, 3);
  const dnd = parseSheet({ sheet: { abilities: { int: 3, dex: 2 }, skills: [{ id: 'arcana', proficient: true }, { id: 'stealth', expertise: true }] } }, 'dnd');
  assert.deepEqual(dnd.errors, []);
  assert.equal(dndSkillModifier(dnd.sheet, dnd.sheet.skills[0], 2), 5);
  assert.equal(dndSkillModifier(dnd.sheet, dnd.sheet.skills[1], 2), 6);
  for (const system of ['coc', 'dnd']) for (const role of ['player', 'character']) for (const l of ['en', 'zh-CN', 'ja', 'ko']) {
    const r = parseSheet({ sheet: defaultSheet(system, role, l) }, system, l);
    assert.deepEqual(r.errors, [], `${system} ${role} ${l}`);
    assert.ok(r.sheet.skills.length >= 4);
  }
  assert.equal(checkLine(checkSpec({ system: 'coc', value: 60 }), '侦查', 'zh-CN'), '侦查 60%');
  assert.equal(checkLine(checkSpec({ system: 'dnd', value: 5, difficulty: 15, advantage: 'advantage' }), 'Arcana', 'en'), 'Arcana +5 · DC 15 · advantage');
  assert.match(sheetsWriterBlock(worldRulesOf({ rules: { system: 'coc' } }), coc.sheet, []), /Protagonist: 侦查 \[spot_hidden\] 60%/);
  assert.equal(sheetsWriterBlock(null, null, []), '');
});

test('bandGradesOf reads authored tables by their base direction', () => {
  const four = (mins) => mins.map((m) => ({ min: m, max: m, text: 't', options: [] }));
  assert.deepEqual(bandGradesOf({ roll_dice: { type: '1d100', expect: '<=60' }, dice_outcomes: four([1, 13, 61, 96]) }), ['great', 'success', 'setback', 'failure']);
  assert.deepEqual(bandGradesOf({ roll_dice: { type: '2d10', expect: '>=11' }, dice_outcomes: four([2, 5, 11, 18]) }), ['failure', 'setback', 'success', 'great']);
  assert.deepEqual(bandGradesOf({ dice_base: { type: '1d100', expect: '<=60' }, roll_dice: { type: '1d100', expect: '<=45' }, dice_outcomes: four([1, 13, 61, 96]) }), ['great', 'success', 'setback', 'failure']);
});

// ---------------------------------------------------------------------------
// The action path
// ---------------------------------------------------------------------------

function tmpWorld({ rules = { system: 'coc', sanity: true }, playerSheet, companionSheet, search } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'airp-skills-'));
  fs.mkdirSync(path.join(root, 'world', 'study'), { recursive: true });
  fs.mkdirSync(path.join(root, 'player'), { recursive: true });
  fs.mkdirSync(path.join(root, 'characters', 'vera'), { recursive: true });
  fs.writeFileSync(path.join(root, 'world.json'), JSON.stringify({
    id: 'skill-world', name: 'Skills', version: '1.0.0', schema: 1, description: 'd', author: 'a', genre: 'mystery', locale: 'en', mode: 'semi',
    ...(rules ? { rules } : {}),
    characters: [{ id: 'vera', name: 'Vera', role: 'companion', home: 'map', description: 'Mechanic.' }],
    endings: [{ id: 'done', title: 'Done', path: 'endings/done/README.md' }],
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  }));
  fs.writeFileSync(path.join(root, 'world', 'README.md'), '---\ntype: readme\nname: Root\n---\n\nRoot.\n');
  fs.writeFileSync(path.join(root, 'world', 'study', 'README.md'), stringifyFrontmatter({ type: 'gate', name: 'Study', ...(search ? { search } : {}) }, 'A study.'));
  fs.writeFileSync(path.join(root, 'player', 'README.md'), stringifyFrontmatter({
    type: 'readme', title: 'You',
    states: [
      { id: 'hp', label: 'Wounds', type: 'number', initial: 10, range: [0, 10] },
      { id: 'sanity', label: 'Sanity', type: 'number', initial: 60, range: [0, 99] },
    ],
    sheet: playerSheet ?? { skills: [{ id: 'spot_hidden', label: 'Spot Hidden', value: 60 }, { id: 'stealth', label: 'Stealth', value: 40 }] },
  }, 'You.'));
  fs.writeFileSync(path.join(root, 'characters', 'vera', 'README.md'), stringifyFrontmatter({
    type: 'readme', name: 'Vera',
    sheet: companionSheet ?? { skills: [{ id: 'mechanical_repair', label: 'Mechanical Repair', value: 75 }] },
  }, 'Vera.'));
  return root;
}
const svc = (root, actor = { type: 'writer' }, opts = {}) => createActionService(new LocalWorldStore(root), actor, { turn: 'test:skills', ...opts });
const fmOf = async (root, p) => parseFrontmatter(fs.readFileSync(path.join(root, p), 'utf8')).frontmatter;

test('writer frames a protagonist check; only the player rolls it; tier, grade and outcome land', async () => {
  const root = tmpWorld();
  const framed = await svc(root).skillCheck({
    skill: 'spot_hidden', layer: 'world/study', title: 'Spot the loose floorboard',
    outcomes: {
      failure: { text: 'You put your foot through it.', harm: 'light' },
      setback: { text: 'Nothing.' },
      success: { text: 'A board is loose.', find: { title: 'Hidden key', body: 'A small brass key.' } },
      great: { text: 'A board is loose, and fresh scratches.', find: { title: 'Hidden key', body: 'A small brass key.' } },
    },
  });
  assert.equal(framed.details.path, 'world/study/check-1.md');
  assert.equal(framed.details.expect, '<=60');
  assert.equal(framed.details.roll, undefined, 'the player rolls the protagonist’s check');
  const card = await fmOf(root, framed.details.path);
  assert.equal(card.skill_check.skill, 'spot_hidden');
  assert.equal(card.dice_outcomes.length, 4);
  await assert.rejects(svc(root).rollDice({ path: framed.details.path }), /the player rolls it/);
  await assert.rejects(svc(root, { type: 'character', id: 'vera' }).rollDice({ path: framed.details.path }), /the player rolls it/);
  const rolled = await svc(root, { type: 'god' }).rollDice({ path: framed.details.path, forcedResult: 25 });
  assert.equal(rolled.details.passed, true);
  assert.equal(rolled.details.skill.tier, 'hard');
  assert.equal(rolled.details.skill.grade, 'success');
  assert.equal(rolled.details.skill.tierLabel, 'Hard success');
  assert.match(rolled.text, /Spot Hidden \(60%\): Hard success/);
  const player = await fmOf(root, 'player/README.md');
  assert.deepEqual(player.status.data.skill_marks, ['spot_hidden'], 'a coc success marks the skill');
});

test('the dice follow the CURRENT sheet at roll time', async () => {
  const root = tmpWorld();
  const framed = await svc(root).skillCheck({ skill: 'stealth', layer: 'world/study' });
  assert.equal(framed.details.expect, '<=40');
  const fm = await fmOf(root, 'player/README.md');
  fm.sheet.skills[1].value = 70;
  fs.writeFileSync(path.join(root, 'player/README.md'), stringifyFrontmatter(fm, 'You.'));
  const rolled = await svc(root, { type: 'player' }, { rng: () => 0.5 }).rollDice({ path: framed.details.path });
  assert.equal(rolled.details.expect, '<=70');
  assert.equal(rolled.details.result, 51);
  assert.equal(rolled.details.passed, true);
  const card = await fmOf(root, framed.details.path);
  assert.equal(card.roll_dice.expect, '<=70');
  assert.equal(card.skill_check.target, 70);
});

test('a fumble on the protagonist’s check applies its declared harm once (hidden hp)', async () => {
  const root = tmpWorld();
  const framed = await svc(root).skillCheck({
    skill: 'stealth', layer: 'world/study',
    outcomes: { failure: { text: 'Ouch.', harm: 'serious' }, setback: { text: 'No.' }, success: { text: 'Yes.' }, great: { text: 'Yes!' } },
  });
  const r = await svc(root, { type: 'god' }).rollDice({ path: framed.details.path, forcedResult: 99 });
  assert.equal(r.details.skill.grade, 'failure');
  assert.equal(r.details.harm?.severity, 'serious');
  const player = await fmOf(root, 'player/README.md');
  assert.ok(player.status.data.hp < 10);
});

test('sanity check costs its declared sanity', async () => {
  const root = tmpWorld();
  await assert.rejects(svc(root).skillCheck({ skill: 'sanity', layer: 'world/study' }), /sanity \{ pass, fail \}/);
  const framed = await svc(root).skillCheck({ skill: 'sanity', layer: 'world/study', title: 'The thing in the well', sanity: { pass: 1, fail: 5 } });
  assert.equal(framed.details.expect, '<=60');
  const r = await svc(root, { type: 'god' }).rollDice({ path: framed.details.path, forcedResult: 80 });
  assert.equal(r.details.skill.sanityLoss, 5);
  assert.equal((await fmOf(root, 'player/README.md')).status.data.sanity, 55);
  assert.equal((await fmOf(root, 'player/README.md')).status.data.skill_marks, undefined, 'sanity is never marked');
});

test('a character rolls its own check at once; it cannot frame the protagonist’s', async () => {
  const root = tmpWorld();
  const vera = svc(root, { type: 'character', id: 'vera' }, { rng: () => 0.2 });
  const r = await vera.skillCheck({ skill: 'mechanical_repair', actor: 'self', layer: 'world/study', title: 'Free the jammed clasp' });
  assert.equal(r.details.actor, 'vera');
  assert.equal(r.details.roll.result, 21);
  assert.equal(r.details.roll.skill.grade, 'success');
  assert.equal(r.details.roll.skill.actor, 'vera');
  await assert.rejects(vera.skillCheck({ skill: 'spot_hidden', layer: 'world/study' }), /only for itself/);
  assert.equal((await fmOf(root, 'player/README.md')).status?.data?.skill_marks, undefined, 'a character success marks nothing');
  const off = tmpWorld({ rules: { system: 'coc', characterChecks: false } });
  await assert.rejects(svc(off, { type: 'character', id: 'vera' }).skillCheck({ skill: 'mechanical_repair', actor: 'self', layer: 'world/study' }), /characterChecks is off/);
});

test('a world without rules refuses skill_check and keeps its plain dice', async () => {
  const root = tmpWorld({ rules: null });
  await assert.rejects(svc(root).skillCheck({ skill: 'spot_hidden', layer: 'world/study' }), /no skill rules/);
});

test('dnd: the check card carries d20 + modifier and resolves by natural faces', async () => {
  const root = tmpWorld({
    rules: { system: 'dnd', proficiency: 2 },
    playerSheet: { abilities: { int: 3 }, skills: [{ id: 'arcana', label: 'Arcana', ability: 'int', proficient: true }] },
  });
  const framed = await svc(root).skillCheck({ skill: 'arcana', layer: 'world/study', difficulty: 'hard', advantage: 'advantage' });
  assert.equal(framed.details.type, '1d20+5');
  assert.equal(framed.details.expect, '>=15');
  const seq = [0.05, 0.6]; // 2 and 13 → keep 13 → 18
  const r = await svc(root, { type: 'player' }, { rng: () => seq.shift() }).rollDice({ path: framed.details.path });
  assert.deepEqual(r.details.rolls, [2, 13]);
  assert.equal(r.details.result, 18);
  assert.equal(r.details.passed, true);
  assert.equal(r.details.skill.tier, 'success');
  const forced = await svc(root).skillCheck({ skill: 'arcana', layer: 'world/study' });
  const nat20 = await svc(root, { type: 'god' }).rollDice({ path: forced.details.path, forcedResult: 25 });
  assert.equal(nat20.details.skill.tier, 'critical');
  assert.equal(nat20.details.crit, true);
});

test('a declared search with skill: becomes the protagonist’s check and picks bands by grade', async () => {
  const bands = [[1, 12], [13, 60], [61, 95], [96, 100]].map(([min, max]) => ({
    min, max, text: `band ${min}`, options: [{ id: 'back', label: 'Back', action: { kind: 'enter', target: 'world/study' } }],
    ...(min === 13 ? { rewards: [{ path: 'world/study/note.md', title: 'A note', body: '…' }] } : {}),
  }));
  const root = tmpWorld({
    search: [{ id: 'desk', label: 'Search (roll)', title: 'The desk', roll_dice: { type: '1d100', desc: 'The desk', expect: '<=60' }, skill: 'stealth', dice_outcomes: bands }],
  });
  const res = await svc(root, { type: 'player' }).searchPlace({ layer: 'world/study', spot: 'desk' });
  const card = await fmOf(root, res.details.path);
  assert.equal(card.roll_dice.expect, '<=40', 'the sheet sets the target');
  assert.deepEqual(card.dice_base, { type: '1d100', expect: '<=60' });
  // 45 > 40: a setback for this investigator, though the authored base would call 45 a success.
  const r = await svc(root, { type: 'god' }).rollDice({ path: res.details.path, forcedResult: 45 });
  assert.equal(r.details.skill.grade, 'setback');
});
