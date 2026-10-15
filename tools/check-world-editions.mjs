#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { diceConfigProblems, diceEnforced, parseEndingPassages, parseTriggerCondition, diceTierProblems, parseFrontmatter, parseSearchDeclarations, parseSheet, parseStateDecls, parseWorldCommand, runVariantsOf, searchFinds, worldIntroMachine, worldIntroProblems, worldRulesOf, WorldManifestSchema } from '../packages/shared/dist/index.js';
import { editionFamilies, editionId, editionLocales, isExperimentalWorld, shippedFamilies } from './world-editions.mjs';
import { filesUnder, mapText } from './localize-world-editions.mjs';
import { triggerProblems } from './trigger-problems.mjs';
import { livingProblems } from './living-problems.mjs';
import { loopProblems } from './loop-problems.mjs';
import { turnClockProblems } from './turn-clock-problems.mjs';
import { npcProblems } from './npc-problems.mjs';
import { ambientProblems } from './ambient-problems.mjs';
import { tickProblems } from './tick-problems.mjs';
import { artProblems } from './art-problems.mjs';
import { audioProblems } from './audio-problems.mjs';
import { duplicateChoiceProblems } from './choice-problems.mjs';
import { diceTextProblems } from './dice-text-problems.mjs';
import { hintProblems } from './hint-problems.mjs';
import { passiveProblems } from './passive-problems.mjs';
import YAML from '../packages/shared/node_modules/yaml/dist/index.js';

const repo = fileURLToPath(new URL('../', import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async f => JSON.parse(await fs.readFile(f, 'utf8'));
// World commands (`command/*.yaml`) carry prose too (`give` bodies, `append_body`),
// so they are compared structurally like cards: machine fields identical, text localized.
// A run variant's overlay (`variants/<id>/<option>/command/x.yaml`, the design notes)
// is a world command too, and so is a loop stage's (`loops/<name>/command/x.yaml`, the design notes).
const COMMAND_FILE = /^(?:variants\/[^/]+\/[^/]+\/|loops\/[^/]+\/)?command\/[^/]+\.yaml$/;
const isText = f => (/\.(md|json)$/.test(f) && !(f.startsWith('assets/') && f.endsWith('.json'))) || COMMAND_FILE.test(f);
const isCjk = s => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(s);
const isKana = s => /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(s);
const isHangul = s => /\p{Script=Hangul}/u.test(s);
/** Every character's `world-language` block opens with the edition's own language. */
const LANGUAGE_DIRECTIVE = { en: 'Speak English.', ja: '日本語で話す。', 'zh-CN': '说中文。', ko: '한국어로 말한다.' };
const readDoc = async (root, f) => {
  const text = await fs.readFile(path.join(root, f), 'utf8');
  if (f.endsWith('.json')) return JSON.parse(text);
  if (f.endsWith('.yaml')) return YAML.parse(text);
  const p = parseFrontmatter(text); assert.deepEqual(p.errors, [], `${root}/${f}`);
  return { fm: p.frontmatter ?? {}, body: p.body };
};
// Compare all executable data, ignoring only prose and edition metadata.
const structure = (f, input) => {
  const doc = mapText(structuredClone(input), () => '<localized>');
  if (f.endsWith('.md')) doc.body = '<localized>';
  // A tick prompt's deny words: how many depends on the language and the variant.
  if (f.endsWith('.md') && Array.isArray(doc.fm?.tick?.never_say)) doc.fm.tick.never_say = '<localized>';
  if (f.endsWith('/tick.md') && Array.isArray(doc.fm?.never_say)) doc.fm.never_say = '<localized>';
  if (f === 'world.json') { delete doc.id; delete doc.version; delete doc.locale; delete doc.tags; }
  if (f.endsWith('/preset.json')) delete doc.id;
  return doc;
};
async function media(root, value) {
  if (!value || typeof value !== 'object') return;
  for (const [k, v] of Object.entries(value)) {
    if (['bg', 'bgVideo', 'avatar', 'avatarVideo', 'image', 'cover', 'video', 'poster'].includes(k) && typeof v === 'string' && v.startsWith('assets/')) {
      assert.ok(!v.includes('..'), v); await fs.access(path.join(root, v));
    } else if (typeof v === 'object') await media(root, v);
  }
}

/** Paths a save can come to hold: pre-placed world files, plus every declared search find and command `give`. */
export async function reachablePaths(root) {
  const out = new Set();
  for (const f of await filesUnder(root)) {
    if (f.startsWith('world/') || f.startsWith('player/')) out.add(f);
    if (f.endsWith('.md') && f.startsWith('world/')) {
      const fm = parseFrontmatter(await fs.readFile(path.join(root, f), 'utf8')).frontmatter ?? {};
      if (fm.search !== undefined) for (const spot of parseSearchDeclarations(fm).spots) for (const find of searchFinds(spot)) out.add(find);
      for (const band of Array.isArray(fm.dice_outcomes) ? fm.dice_outcomes : []) for (const r of band?.rewards ?? []) if (typeof r?.path === 'string') out.add(r.path);
    }
    if (/^command\/[^/]+\.yaml$/.test(f)) {
      const doc = YAML.parse(await fs.readFile(path.join(root, f), 'utf8')) ?? {};
      for (const step of Array.isArray(doc.do) ? doc.do : []) if (step?.action === 'give' && typeof step.with?.path === 'string') out.add(step.with.path);
    }
  }
  return out;
}

/**
 * The debrief's authoring rules: 3–4 mysteries,
 * tiered epilogues, endings to follow, and clue paths that PROVE discovery —
 * a search find or command give under world/, or `player/<name>` for an item
 * that is pre-placed (its mere presence in the world proves nothing).
 */
export async function mysteryProblems(root, manifest) {
  const problems = [];
  if (!manifest.mysteries) return problems;
  if (manifest.mysteries.length < 3 || manifest.mysteries.length > 4) problems.push('a debrief asks 3–4 mysteries');
  if (!manifest.reckoning) problems.push('mysteries need reckoning.epilogues');
  if (!manifest.endings?.length) problems.push('a debrief follows an ending; declare endings');
  const preplaced = new Set((await filesUnder(root)).filter((f) => f.startsWith('world/') || f.startsWith('player/')));
  const reachable = await reachablePaths(root);
  const names = new Set([...reachable].map((p) => p.split('/').pop()));
  for (const m of manifest.mysteries) for (const o of m.options) for (const c of o.clues) {
    const where = `mystery ${m.id}/${o.id} clue ${c}`;
    if (c.startsWith('world/')) {
      if (preplaced.has(c)) problems.push(`${where} is pre-placed, so finding it proves nothing; reference the carried player/${c.split('/').pop()} instead`);
      else if (!reachable.has(c)) problems.push(`${where} is neither a search find nor a command give`);
    } else if (!names.has(c.split('/').pop())) {
      problems.push(`${where}: no item of that name exists or can be found in this world`);
    }
  }
  return problems;
}

/**
 * Character skills: a world with `rules` has a
 * protagonist sheet that parses cleanly; every search spot's `skill:` and every
 * pre-placed card's `skill_check.skill` is on that sheet (or is sanity, when the
 * world has sanity checks); companion sheets parse cleanly too.
 */
export async function skillProblems(root, manifest) {
  const rules = worldRulesOf(manifest);
  const problems = [];
  const files = (await filesUnder(root)).filter((f) => f.endsWith('.md'));
  const fmOf = async (f) => parseFrontmatter(await fs.readFile(path.join(root, f), 'utf8')).frontmatter ?? {};
  const used = [];
  for (const f of files.filter((x) => x.startsWith('world/'))) {
    const fm = await fmOf(f);
    for (const spot of parseSearchDeclarations(fm).spots) {
      if (spot.skill) used.push([`${f}#${spot.id}`, spot.skill]);
      // alt_skills: other sheet skills that also search this spot.
      for (const alt of spot.alt_skills ?? []) used.push([`${f}#${spot.id} alt_skills`, alt]);
    }
    if (fm.skill_check?.skill) used.push([f, fm.skill_check.skill]);
  }
  if (!rules) {
    if (used.length) problems.push(`skills are used (${used[0][0]}) but world.json declares no rules`);
    return problems;
  }
  const player = files.includes('player/README.md') ? parseSheet(await fmOf('player/README.md'), rules.system, manifest.locale) : { sheet: null, errors: [] };
  if (!player.sheet) problems.push('a world with rules needs a protagonist sheet (player/README.md sheet:)');
  problems.push(...player.errors.map((e) => `player/README.md: ${e}`));
  const ids = new Set((player.sheet?.skills ?? []).map((s) => s.id));
  for (const [where, skill] of used) {
    if (skill === 'sanity' ? !rules.sanity : !ids.has(skill)) problems.push(`${where}: skill "${skill}" is not on the protagonist's sheet`);
  }
  for (const c of manifest.characters ?? []) {
    const f = `characters/${c.id}/README.md`;
    if (!files.includes(f)) continue;
    const r = parseSheet(await fmOf(f), rules.system, manifest.locale);
    problems.push(...r.errors.map((e) => `${f}: ${e}`));
  }
  return problems;
}

/**
 * Run variants: every option's overlay replaces the
 * same set of files, each of which exists in the base world; the base IS the
 * first option (byte-identical), so every other gate reading the template sees
 * one complete variant; and an overlay differs from the base only in words
 * (the executable structure — ids, paths, dice, conditions, gives — is the
 * same), so what those gates prove of the base holds for every variant. A
 * variant's `state` is a declared enum in world/README.md over its options,
 * starting at the first.
 */
export async function variantProblems(root, manifest) {
  const { variants, errors } = runVariantsOf(manifest);
  const problems = [...errors];
  const files = await filesUnder(root);
  const overlays = files.filter((f) => f.startsWith('variants/'));
  if (!variants.length) {
    if (overlays.length) problems.push('variants/ exists but world.json declares no variants');
    return problems;
  }
  const declared = new Set(variants.flatMap((v) => v.options.map((o) => `variants/${v.id}/${o}/`)));
  for (const f of overlays) if (![...declared].some((d) => f.startsWith(d))) problems.push(`${f}: not under a declared variant option`);
  const readmeFm = files.includes('world/README.md') ? parseFrontmatter(await fs.readFile(path.join(root, 'world/README.md'), 'utf8')).frontmatter ?? {} : {};
  const states = parseStateDecls(readmeFm).states;
  if (readmeFm.run !== undefined) problems.push('world/README.md: `run` is written by the engine when a run starts; a template must not carry one');
  for (const v of variants) {
    const of = (o) => overlays.filter((f) => f.startsWith(`variants/${v.id}/${o}/`)).map((f) => f.slice(`variants/${v.id}/${o}/`.length)).sort();
    const first = of(v.options[0]);
    if (!first.length) problems.push(`variant ${v.id}: variants/${v.id}/${v.options[0]}/ is empty`);
    for (const o of v.options) {
      const list = of(o);
      if (JSON.stringify(list) !== JSON.stringify(first)) problems.push(`variant ${v.id}/${o}: overlays [${list.join(', ')}], but ${v.options[0]} overlays [${first.join(', ')}]; every option replaces the same files`);
      for (const rel of list) {
        const where = `variants/${v.id}/${o}/${rel}`;
        if (rel === 'world.json' || rel.startsWith('variants/')) { problems.push(`${where}: an overlay never replaces world.json or variants/`); continue; }
        if (!files.includes(rel)) { problems.push(`${where}: replaces nothing; the base world must hold ${rel} (as the first option)`); continue; }
        const [a, b] = await Promise.all([fs.readFile(path.join(root, where)), fs.readFile(path.join(root, rel))]);
        if (o === v.options[0] && sha(a) !== sha(b)) problems.push(`${rel}: the base must be byte-identical to the first option's ${where}`);
        if (isText(rel)) {
          const [x, y] = await Promise.all([readDoc(root, where), readDoc(root, rel)]);
          try { assert.deepEqual(structure(rel, x), structure(rel, y)); } catch { problems.push(`${where}: differs from ${rel} in more than words (ids, paths, dice, conditions must match)`); }
        }
      }
    }
    if (v.state) {
      const decl = states.find((st) => st.id === v.state);
      if (!decl || decl.type !== 'enum') problems.push(`variant ${v.id}: world/README.md declares no enum state "${v.state}"`);
      else {
        for (const o of v.options) if (!decl.values?.includes(o)) problems.push(`variant ${v.id}: state ${v.state} has no value "${o}"`);
        if (decl.initial !== v.options[0]) problems.push(`variant ${v.id}: state ${v.state} starts at "${decl.initial}", but the base world is the first option "${v.options[0]}"`);
      }
    }
  }
  return problems;
}

/**
 * `alt_skills` on a search spot, in every
 * template: a well-formed list, and each skill is on the protagonist's sheet —
 * a protagonist check with one of them in that place IS the spot's search, so a
 * skill nobody has would be a binding that can never happen.
 */
export async function altSkillProblems(root, manifest) {
  const problems = [];
  const files = (await filesUnder(root)).filter((f) => f.startsWith('world/') && f.endsWith('.md'));
  const rules = worldRulesOf(manifest);
  let ids = null;
  for (const f of files) {
    const fm = parseFrontmatter(await fs.readFile(path.join(root, f), 'utf8')).frontmatter ?? {};
    if (!Array.isArray(fm.search) || !fm.search.some((s) => s?.alt_skills !== undefined)) continue;
    const { spots, errors } = parseSearchDeclarations(fm);
    problems.push(...errors.filter((e) => e.includes('alt_skills')).map((e) => `${f}: ${e}`));
    if (!rules) { problems.push(`${f}: alt_skills needs a world with rules (world.json rules)`); continue; }
    if (ids === null) {
      const sheetFile = path.join(root, 'player/README.md');
      const sheetFm = await fs.readFile(sheetFile, 'utf8').then((t) => parseFrontmatter(t).frontmatter ?? {}, () => ({}));
      ids = new Set((parseSheet(sheetFm, rules.system, manifest.locale).sheet?.skills ?? []).map((s) => s.id));
    }
    for (const spot of spots) for (const alt of spot.alt_skills ?? []) if (!ids.has(alt)) problems.push(`${f}#${spot.id}: alt_skills "${alt}" is not on the protagonist's sheet`);
  }
  return problems;
}

/** World commands the engine would refuse to run (`parseWorldCommand`). */
export async function parseProblems(root) {
  const problems = [];
  for (const f of (await filesUnder(root)).filter((x) => COMMAND_FILE.test(x))) {
    const parsed = parseWorldCommand(path.basename(f, '.yaml'), await fs.readFile(path.join(root, f), 'utf8'));
    if (!parsed.ok) problems.push(`${f}: ${parsed.errors.map((e) => e.message).join('; ')}`);
  }
  return problems;
}

/**
 * The four tiers: every authored dice card —
 * a search spot, or a card with roll_dice and dice_outcomes / on.roll_resolved —
 * declares four tiers; a 失败 / 大失败 never hands over a key clue; in a 跑团
 * world a 大失败 costs and a 大成功 gives something a 成功 does not.
 */
export async function diceTierWorldProblems(root, manifest) {
  const problems = diceConfigProblems(manifest).map((p) => `world.json: ${p}`);
  const keys = new Set([
    ...(manifest.triggers ?? []).flatMap((t) => t.clues ?? []),
    ...(manifest.mysteries ?? []).flatMap((m) => (m.options ?? []).flatMap((o) => o.clues ?? [])),
  ]);
  const commands = new Map();
  for (const f of (await filesUnder(root)).filter((f) => /^command\/[^/]+\.yaml$/.test(f))) {
    const id = path.basename(f, '.yaml');
    const parsed = parseWorldCommand(id, await fs.readFile(path.join(root, f), 'utf8'));
    if (parsed.ok) commands.set(id, { steps: parsed.command.steps.map((s) => ({ action: s.action, when: s.when, args: s.args })) });
  }
  const enforced = diceEnforced(manifest);
  for (const f of (await filesUnder(root)).filter((f) => f.endsWith('.md'))) {
    const fm = parseFrontmatter(await fs.readFile(path.join(root, f), 'utf8')).frontmatter;
    if (!fm) continue;
    for (const spot of parseSearchDeclarations(fm).spots) {
      const raw = (fm.search ?? []).find((s) => s?.id === spot.id) ?? {};
      problems.push(...diceTierProblems(`${f}#${spot.id}`, { ...spot, dice_tiers: raw.dice_tiers }, keys, commands, enforced));
    }
    if (fm.roll_dice && (fm.dice_outcomes !== undefined || fm.on?.roll_resolved !== undefined)) {
      problems.push(...diceTierProblems(f, fm, keys, commands, enforced));
    }
  }
  return problems;
}

/** `only`: check just these family bases (a partial build); the full edition set is not asserted. */
export async function checkEditions({ staged = false, only = null } = {}) {
  const base = path.join(repo, staged ? '.artifacts/bilingual-worlds/editions' : 'templates');
  const sources = path.join(repo, staged ? '.artifacts/bilingual-worlds/sources' : 'templates');
  // The staged bilingual build predates the Chinese editions.
  const locales = staged ? ['en', 'ja'] : editionLocales;
  // The families this copy carries (the open-source copy ships only some worlds); every family in the full repository.
  const present = staged ? editionFamilies : shippedFamilies(base);
  const families = only ? editionFamilies.filter(f => only.includes(f.base)) : present;
  assert.equal(families.length, only?.length ?? present.length, `Unknown family in --only=${only}`);
  const expectedIds = families.flatMap(f => locales.map(l => editionId(f, l))).sort();
  const actualIds = [];
  // Experimental sandboxes carry `exp: true` and are deliberately outside the
  // edition set: the whole point of templates/fpal is that it is NOT a shipped
  // edition, so asserting `templates == 21` would only force its deletion.
  for (const d of await fs.readdir(base)) {
    if (!(await fs.access(path.join(base, d, 'world.json')).then(() => true).catch(() => false))) continue;
    if (isExperimentalWorld(base, d)) continue;
    actualIds.push(d);
  }
  if (only) for (const id of expectedIds) assert.ok(actualIds.includes(id), `Missing edition ${id}`);
  else assert.deepEqual(actualIds.sort(), expectedIds, `Exactly one edition per family and locale (${locales.join(', ')})`);
  const skills = new Set(); let files = 0; let dice = 0; let searches = 0;
  const digest = {};
  for (const family of families) {
    // Published checks use the canonical English edition as the executable
    // contract. Staged builds still compare against their snapshotted source.
    const sourceId = staged ? family.source : editionId(family, 'en');
    const source = path.join(sources, staged ? family.source : sourceId);
    const sourceFiles = await filesUnder(source);
    // A world skill's directory follows its edition id: `<id>-play`.
    const targetFile = (f, locale) => f.startsWith('skills/') ? f.replace(/^skills\/[^/]+/, `skills/${editionId(family, locale)}-play`) : f;
    for (const locale of locales) {
      const id = editionId(family, locale), root = path.join(base, id);
      assert.deepEqual((await filesUnder(root)).sort(), sourceFiles.map(f => targetFile(f, locale)).sort(), `${id}: no lost or extra content`);
      const manifest = WorldManifestSchema.parse(await json(path.join(root, 'world.json')));
      assert.equal(manifest.id, id); assert.equal(manifest.locale, locale);
      assert.doesNotMatch(manifest.name, /playtest|体験版/i);
      await media(root, manifest);
      // The debrief: 3–4 secrets, each answer's clue paths
      // must be reachable — pre-placed in the world, or a declared search find.
      assert.deepEqual(await mysteryProblems(root, manifest), [], `${id}: debrief mysteries`);
      assert.deepEqual(await skillProblems(root, manifest), [], `${id}: character skills`);
      assert.deepEqual(await diceTierWorldProblems(root, await json(path.join(root, 'world.json'))), [], `${id}: dice tiers`);
      assert.deepEqual(await variantProblems(root, await json(path.join(root, 'world.json'))), [], `${id}: run variants`);
      // Ambient life: an edition's barks are its own language, as plain lists.
      assert.deepEqual(await ambientProblems(root, { official: true }), [], `${id}: ambient life`);
      // The lobby card: every official edition carries an honest
      // `intro`, and its machine part (status, genres, time, mechanics, endings…) is the
      // same in every language — only the words are localized.
      const rawManifest = await json(path.join(root, 'world.json'));
      assert.deepEqual(worldIntroProblems(rawManifest), [], `${id}: world.json intro`);
      assert.deepEqual(worldIntroMachine(rawManifest.intro), worldIntroMachine((await json(path.join(source, 'world.json'))).intro), `${id}: intro must match the English edition's status, genres, time, mechanics and endings`);
      for (const f of sourceFiles) {
        const target = targetFile(f, locale), absolute = path.join(root, target);
        assert.match(target, /^[a-zA-Z0-9/_.-]+$/, `${id}: ASCII stable path`);
        digest[`${id}/${target}`] = sha(await fs.readFile(absolute)); files++;
        if (!isText(f)) { assert.equal(digest[`${id}/${target}`], sha(await fs.readFile(path.join(source, f))), `${id}/${f}: shared asset bytes`); continue; }
        const a = await readDoc(source, f), b = await readDoc(root, target);
        assert.deepEqual(structure(f, b), structure(f, a), `${id}/${f}: executable contract drift`);
        if (locale === 'en') mapText(b, text => { assert.ok(!isCjk(text), `${id}/${f}: untranslated text: ${text.slice(0, 70)}`); return text; });
        if (locale === 'zh-CN') mapText(b, text => { assert.ok(!isKana(text), `${id}/${f}: Japanese left in Chinese text: ${text.slice(0, 70)}`); return text; });
        if (locale === 'ko') mapText(b, text => { assert.ok(!isKana(text), `${id}/${f}: Japanese left in Korean text: ${text.slice(0, 70)}`); return text; });
        if (f.endsWith('.md')) {
          await media(root, b.fm);
          // An ending's conditional passages (shared/actions/ending-text.ts): well formed, every `when` parses.
          if (/^endings\/[^/]+\/README\.md$/.test(f) && b.fm.passages !== undefined) {
            const { passages, errors } = parseEndingPassages(b.fm);
            assert.deepEqual(errors, [], `${id}/${f}: ending passages`);
            const ids = (manifest.characters ?? []).map((c) => c.id);
            for (const p of passages) if (p.when) assert.ok(parseTriggerCondition(p.when, ids).ok, `${id}/${f}: passage when "${p.when}" does not parse`);
          }
          if (b.fm.roll_dice) { dice++; assert.ok(['1d10', '2d10', '1d100'].includes(b.fm.roll_dice.type), `${id}/${f}: supported dice`); }
          // Searches: a place declares what a search can
          // find; the finds are created by the roll, so none may exist beforehand, and
          // every locale shares the same spots, dice, bands and find paths.
          if (b.fm.search !== undefined) {
            const { spots, errors } = parseSearchDeclarations(b.fm);
            assert.deepEqual(errors, [], `${id}/${f}: search declaration`);
            for (const spot of spots) {
              searches++;
              assert.ok(['1d10', '2d10', '1d100'].includes(spot.roll_dice.type), `${id}/${f}: search "${spot.id}" uses supported dice`);
              for (const find of searchFinds(spot)) {
                assert.ok(!(await fs.access(path.join(root, find)).then(() => true, () => false)), `${id}/${f}: search "${spot.id}" find ${find} is pre-placed; finds exist only after the roll`);
              }
              await fs.access(path.join(root, path.dirname(f), `search-${spot.id}.md`)).then(
                () => assert.fail(`${id}/${f}: search-${spot.id}.md is pre-placed; the dice chalk appears only when the player searches`),
                () => {});
            }
            const machine = (fm) => parseSearchDeclarations(fm).spots.map((spot) => ({
              id: spot.id, dice: [spot.roll_dice.type, spot.roll_dice.expect], skill: spot.skill ?? null, alt_skills: spot.alt_skills ?? null, difficulty: spot.difficulty ?? null,
              bands: (spot.dice_outcomes ?? []).map((band) => [band.min, band.max, (band.rewards ?? []).map((r) => [r.path, r.portable ?? true]), (band.options ?? []).map((o) => o.id)]),
              on: JSON.stringify(spot.on ?? null),
            }));
            assert.deepEqual(machine(b.fm), machine(a.fm), `${id}/${f}: search spots, dice, bands and find paths must match the English edition`);
          }
          if (f.endsWith('/SKILL.md')) {
            assert.equal(b.fm.name, path.basename(path.dirname(target))); assert.ok(!skills.has(b.fm.name), `Duplicate skill ${b.fm.name}`); skills.add(b.fm.name);
            assert.ok(typeof b.fm.description === 'string' && b.fm.description.length > 0);
            if (locale === 'ko') assert.ok(isHangul(b.body), `${id}: Korean world skill`);
            else if (locale !== 'en') assert.ok(isCjk(b.body), `${id}: localized world skill`);
            if (locale === 'zh-CN') assert.ok(!isKana(b.body), `${id}: Chinese world skill`);
          }
        }
      }
      for (const c of manifest.characters) {
        // `home` is a LAYER ID (that is what `manifest.layers[c.home]` is keyed
        // by). Every layer's id equals its directory except the root, whose id
        // is `map` and whose directory is `world/` — the same alias the server
        // applies (`routes/world.ts`: layer === 'map' ? 'world/README.md' : …).
        // Before a character lived at the root layer, this line never saw it.
        await fs.access(path.join(root, c.home === 'map' ? 'world' : c.home, 'README.md'));
        for (const f of ['README.md', 'personality.md', 'memory.md', 'identity.md', 'relationships.md', 'diary.md', 'unspoken.md', 'likes-and-fears.md', 'near-term.md', 'long-term.md']) await fs.access(path.join(root, 'characters', c.id, f));
        const preset = await json(path.join(root, 'characters', c.id, 'preset.json'));
        const profile = preset.items.find(x => x.id === 'profile');
        assert.equal(profile.options.baseDir, `characters/${c.id}`);
        for (const f of profile.options.path) await fs.access(path.join(root, profile.options.baseDir, f));
        const language = preset.items.find(x => x.id === 'world-language').content;
        assert.ok(language.startsWith(LANGUAGE_DIRECTIVE[locale]), `${id}/${c.id}: world-language opens with ${LANGUAGE_DIRECTIVE[locale]}`);
      }
      console.log(`OK ${id}: ${sourceFiles.length} files, ${manifest.characters.length} characters`);
    }
  }
  // Triggers + declared states, in EVERY template —
  // experimental ones too, since that is where new closed worlds start.
  if (!staged) {
    for (const d of await fs.readdir(base)) {
      const file = path.join(base, d, 'world.json');
      if (!(await fs.access(file).then(() => true, () => false))) continue;
      assert.deepEqual(await triggerProblems(path.join(base, d), await json(file)), [], `${d}: triggers and declared states`);
      // A living world: calendar, residents, places, variant pictures.
      assert.deepEqual(await livingProblems(path.join(base, d), await json(file)), [], `${d}: living world`);
      // A looping world: the loop block, its keep-list, loop_reset placement.
      assert.deepEqual(await loopProblems(path.join(base, d), await json(file)), [], `${d}: looping world`);
      // A clock that moves with the player's turns (world.json clock.perTurns, actions/turn-clock.ts).
      assert.deepEqual(await turnClockProblems(path.join(base, d), await json(file)), [], `${d}: clock that moves by turns`);
      // NPC cards: schema, avatar, and what they may know.
      assert.deepEqual(await npcProblems(path.join(base, d)), [], `${d}: NPC cards`);
      // Ambient life: shape, ≤ 40-character barks, whose they are, variant-neutral.
      assert.deepEqual(await ambientProblems(path.join(base, d)), [], `${d}: ambient life`);
      // Character tick: closed menu, page-scoped targets, key clues protected, no direct costs.
      assert.deepEqual(await tickProblems(path.join(base, d), await json(file)), [], `${d}: character tick`);
      // Creation-mode art: strict only where a template declares `art:`.
      assert.deepEqual(await artProblems(path.join(base, d)), [], `${d}: art prompts`);
      // Music / sound beds: a catalog id, a keyword, or a world asset.
      assert.deepEqual(await audioProblems(path.join(base, d)), [], `${d}: music and ambient references`);
      // One option, one card per layer (tools/choice-problems.mjs): the layer README
      // owns the layer's options; an opening chalk that repeats them made the options
      // rail list 「221B · Stop the next incident」 twice.
      assert.deepEqual(await duplicateChoiceProblems(path.join(base, d)), [], `${d}: options declared by two cards on one layer`);
      // Every world command parses — in EVERY language. A translation that runs longer
      // than a field allows (a command's `desc` ≤ 200 characters) is still valid YAML
      // but is refused at play time, so the roll silently does nothing (found
      // 2026-10-02 in a zh→en edition; only commands a trigger names were parsed before).
      assert.deepEqual(await parseProblems(path.join(base, d)), [], `${d}: every world command parses`);
      // A search spot's alt_skills: well formed, on the sheet.
      assert.deepEqual(await altSkillProblems(path.join(base, d), await json(file)), [], `${d}: search spot alt_skills`);
      // A dice card's words name the die the player actually rolls (tools/dice-text-problems.mjs):
      // a coc skill card rolls 1d100 against the sheet over its 2d10 base, so its prose says
      // 1d100 with the sheet's value and bands; a card without a sheet skill rolls its own dice.
      assert.deepEqual(await diceTextProblems(path.join(base, d), await json(file)), [], `${d}: dice card text matches the roll`);
      // Option routing and companion hints: every `to` names someone real,
      // hints.json parses and suggests what exists, never reads a hidden state, never names a find before it is found.
      const hints = await hintProblems(path.join(base, d), await json(file));
      assert.deepEqual(hints.problems, [], `${d}: option routing and hints`);
      if (hints.warnings.length) console.warn(`WARN ${d}: ${hints.warnings.length} option(s) to migrate (docs/ux/27 §1.4) — first: ${hints.warnings[0]}`);
      // Passive checks, companion specialties, the inspiration roll:
      // a passive find is a detail (never pre-placed, never a key clue), its skill is someone's, the config is small.
      assert.deepEqual(await passiveProblems(path.join(base, d), await json(file)), [], `${d}: passive checks and inspiration`);
      // An experimental world's intro is optional, but when present it is as honest as an edition's.
      const raw = await json(file);
      if (raw.intro !== undefined) assert.deepEqual(worldIntroProblems(raw), [], `${d}: world.json intro`);
    }
  }
  const result = { editions: expectedIds.length, files, dice, searches, digest };
  if (staged) await fs.writeFile(path.join(repo, '.artifacts/bilingual-worlds/validated.json'), JSON.stringify(result, null, 2));
  console.log(`PASS: ${result.editions} editions; ${files} files; ${dice} dice cards; ${searches} searchable spots; executable data and graphics preserved.`);
  return result;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const only = process.argv.find(a => a.startsWith('--only='))?.slice('--only='.length).split(',').filter(Boolean) ?? null;
  await checkEditions({ staged: process.argv.includes('--staged'), only });
}
