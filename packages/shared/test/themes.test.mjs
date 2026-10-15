/**
 * World themes: the registry is data, every axis is
 * one table, types preset the axes, `mode` derives from the flags, and the
 * writer / intro text comes straight from the tables. Imports the BUILT dist.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DICE_CONVENTIONS,
  RULE_PACKS,
  STRUCTURE_FLAGS,
  WORLD_TYPES,
  LocalWorldStore,
  createActionService,
  diceConventionForTheme,
  diceConventionOf,
  diceGradeOf,
  modeOfTheme,
  parseDiceType,
  parseFrontmatter,
  parseTheme,
  resolveTheme,
  StateListSchema,
  mappedStates,
  mergeStateDecls,
  stateDefaultsOf,
  themeStateDecls,
  themeBuildingNote,
  themeFromType,
  themeWriterBlock,
  worldIntroOf,
  WORLD_CATEGORIES,
  categoryOfType,
  worldCategoryIdOf,
} from '../dist/index.js';

const LOCALES = ['en', 'zh-CN', 'ja'];

test('every registry entry is complete in three languages and points at real ids', () => {
  for (const pack of RULE_PACKS) {
    for (const l of LOCALES) { assert.ok(pack.label[l], `${pack.id} label ${l}`); assert.ok(pack.blurb[l], `${pack.id} blurb ${l}`); }
    assert.ok(DICE_CONVENTIONS[pack.dice], `${pack.id} dice`);
    assert.ok(pack.writer.length > 80);
  }
  for (const flag of STRUCTURE_FLAGS) for (const l of LOCALES) assert.ok(flag.label[l] && flag.blurb[l], `${flag.id} ${l}`);
  assert.deepEqual(WORLD_TYPES.map((t) => t.id), ['trpg', 'infinite', 'story', 'free', 'galgame', 'sim', 'companion', 'blank'], 'blank is last');
  for (const type of WORLD_TYPES) {
    for (const l of LOCALES) assert.ok(type.label[l] && type.blurb[l] && type.intro[l], `${type.id} ${l}`);
    assert.ok(RULE_PACKS.some((p) => p.id === type.rules), `${type.id} rules`);
  }
  assert.deepEqual(RULE_PACKS.map((p) => p.id).sort(), ['coc', 'dnd', 'narrative']);
});

test('every world type names a default music track that exists in the shared audio pool', () => {
  const audio = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../assets/audio');
  for (const type of WORLD_TYPES) {
    assert.match(type.audioTheme, /^[a-z0-9-]+$/, `${type.id} audioTheme is a bare key`);
    // Same lookup order as the server's theme resolution (routes/world.ts AUDIO_POOL.bgm).
    const found = [`bgm/${type.audioTheme}.mp3`, `themes/${type.audioTheme}.mp3`].some((rel) => fs.existsSync(path.join(audio, rel)));
    assert.ok(found, `${type.id} → ${type.audioTheme} is on disk`);
  }
  assert.equal(WORLD_TYPES.find((t) => t.id === 'infinite').audioTheme, 'guixiang');
});

test('each dice convention is a valid die whose four bands partition its whole range', () => {
  for (const c of Object.values(DICE_CONVENTIONS)) {
    const spec = parseDiceType(c.type);
    assert.ok(spec.ok, c.type);
    const { count, faces, modifier } = spec.value;
    assert.equal(c.bands[0].min, count + modifier, `${c.id} lowest roll`);
    assert.equal(c.bands.at(-1).max, count * faces + modifier, `${c.id} highest roll`);
    for (let i = 1; i < c.bands.length; i += 1) assert.equal(c.bands[i].min, c.bands[i - 1].max + 1, `${c.id} contiguous`);
    assert.deepEqual(c.bands.map((b) => b.grade).sort(), ['failure', 'great', 'setback', 'success']);
    assert.equal(diceConventionOf(c.type, c.expect), c);
  }
  assert.equal(diceGradeOf(DICE_CONVENTIONS['percentile-d100'], 5), 'great', 'CoC: low is good');
  assert.equal(diceGradeOf(DICE_CONVENTIONS['d20-dc'], 12), 'success');
  assert.equal(diceConventionOf('2d10', '>= 11'), DICE_CONVENTIONS['standard-2d10']);
  assert.equal(diceConventionOf('1d6', '>3'), null);
});

test('a type presets rules and flags; explicit fields override; mode derives from the flags', () => {
  const trpg = parseTheme({ type: 'trpg' });
  assert.equal(trpg.rules, 'coc');
  assert.equal(trpg.players, 'single');
  assert.equal(modeOfTheme(trpg), 'semi');
  const timed = parseTheme({ type: 'trpg', rules: 'dnd', structure: { endings: true, mysteries: true, clock: true } });
  assert.equal(timed.rules, 'dnd');
  assert.equal(modeOfTheme(timed), 'closed');
  assert.equal(modeOfTheme(parseTheme({ type: 'companion' })), 'open');
  // A clock without endings means nothing: it is switched off.
  assert.equal(parseTheme({ rules: 'narrative', structure: { clock: true } }).structure.clock, false);
  assert.equal(parseTheme({ rules: 'cthulhu' }).rules, 'coc', 'earlier alias');
  assert.deepEqual(parseTheme({ rules: 'coc', structure: 'investigation' }).structure, { endings: true, mysteries: true, clock: true, puzzles: false });
  assert.equal(parseTheme(undefined), null);
  assert.throws(() => parseTheme({ players: 'multi', type: 'trpg' }), /not available yet/);
  assert.throws(() => parseTheme({ type: 'moba' }), /not a known world type/);
  assert.throws(() => parseTheme({ rules: 'gurps' }), /theme.rules/);
  assert.throws(() => parseTheme({ rules: 'coc', structure: { boss: true } }), /not a known flag/);
  assert.equal(resolveTheme({ rules: 'gurps' }).rules, 'narrative', 'runtime reads fail soft');
  assert.equal(themeFromType('blank').structure.endings, false);
});

test('the writer block carries the type, the pack, the dice and the flags; no theme adds nothing', () => {
  assert.equal(themeWriterBlock(undefined), '');
  const coc = themeWriterBlock({ type: 'trpg', rules: 'coc', structure: { endings: true, mysteries: true, clock: true } });
  assert.match(coc, /^\[World Theme\] Tabletop RPG · Call of Cthulhu · Investigation \(mode closed\)/);
  assert.match(coc, /Type: TRPG/);
  assert.match(coc, /d100 roll-under/);
  assert.match(coc, /1d100, expect "<=60"/);
  assert.match(coc, /Time limit/);
  assert.match(coc, /world\.json has no `mysteries` yet/);
  assert.match(themeWriterBlock({ type: 'trpg' }, { mysteriesSeeded: true }), /already lists its mysteries/);
  const dnd = themeWriterBlock({ rules: 'dnd' });
  assert.match(dnd, /1d20\+2, expect ">=12"/);
  assert.match(dnd, /No ending: this is a sandbox/);
  const companion = themeWriterBlock({ type: 'companion' });
  assert.match(companion, /never declare roll_dice/);
  assert.doesNotMatch(companion, /Improvised searches use/);
  assert.match(themeBuildingNote({ type: 'trpg' }), /mysteries/);
  assert.equal(themeBuildingNote(undefined), '');
});

test('the intro is deterministic, localized and explains dice and ending', () => {
  const zh = worldIntroOf({ name: '雾港', description: '一座会忘记船的港口。', locale: 'zh-CN', theme: { type: 'trpg', structure: { endings: true, clock: true, mysteries: true } } });
  assert.equal(zh.title, '雾港');
  assert.equal(zh.kicker, '类跑团 · 克苏鲁（CoC） · 探案');
  assert.equal(zh.lines[0], '一座会忘记船的港口。');
  assert.ok(zh.lines.some((l) => /时限/.test(l)));
  assert.ok(zh.lines.some((l) => /d100/.test(l)));
  assert.ok(zh.lines.some((l) => /谜底/.test(l)));
  assert.deepEqual(worldIntroOf({ name: 'x', locale: 'ja', theme: { type: 'trpg' } }), worldIntroOf({ name: 'x', locale: 'ja', theme: { type: 'trpg' } }));
  const calm = worldIntroOf({ name: 'Snow', locale: 'en', theme: { type: 'companion' } });
  assert.ok(calm.lines.some((l) => /no dice/.test(l)));
  assert.ok(calm.lines.some((l) => /does not end/.test(l)));
});

test('declared-state defaults come from the pack and the type', () => {
  const coc = stateDefaultsOf({ type: 'trpg', rules: 'coc' });
  assert.ok(coc.player.some((s) => s.id === 'sanity' && Array.isArray(s.shown_as) && !s.hidden));
  assert.ok(coc.character.some((s) => s.id === 'wariness'));
  assert.ok(stateDefaultsOf({ type: 'galgame' }).character.some((s) => s.id === 'affection'));
  assert.ok(stateDefaultsOf({ type: 'companion' }).character.every((s) => Array.isArray(s.shown_as)), 'companion moods are prose bands');
  assert.equal(stateDefaultsOf({ type: 'companion', rules: 'coc' }).player.length, 0, 'no dice → no pack states');
  assert.deepEqual(stateDefaultsOf({ type: 'blank' }), { player: [], character: [], world: [] });
  // A type state replaces the pack's same-id state (galgame trust is a number, CoC trust an enum).
  const trust = stateDefaultsOf({ type: 'galgame', rules: 'coc' }).character.filter((s) => s.id === 'trust');
  assert.equal(trust.length, 1);
  assert.equal(trust[0].type, 'number');
});

test('every type × rule pack × language yields valid StateDecl lists', () => {
  const types = [...WORLD_TYPES.map((t) => t.id), undefined];
  let checked = 0;
  for (const type of types) {
    for (const pack of RULE_PACKS) {
      for (const locale of LOCALES) {
        const decls = themeStateDecls({ ...(type ? { type } : {}), rules: pack.id }, locale);
        for (const scope of ['player', 'character', 'world']) {
          const r = StateListSchema.safeParse(decls[scope]);
          assert.ok(r.success, `${type}/${pack.id}/${locale}/${scope}: ${JSON.stringify(r.error?.issues)}`);
          for (const d of decls[scope]) {
            assert.ok(!d.hidden, `${d.id} should surface as prose, not be hidden`);
            // Every number / enum says something at its initial value (a false flag may stay silent).
            const lines = mappedStates({ states: [d] });
            if (d.type !== 'flag') assert.equal(lines.length, 1, `${type}/${pack.id}/${locale}: ${d.id} says something at its initial value`);
            checked += 1;
          }
        }
      }
    }
  }
  assert.ok(checked > 100);
  const ja = themeStateDecls({ type: 'trpg', rules: 'coc' }, 'ja');
  assert.equal(ja.player.find((s) => s.id === 'sanity').label, '正気度');
  assert.equal(themeStateDecls({ type: 'trpg', rules: 'coc' }, 'fr').player[0].label, 'Hit points', 'unknown locale → English');
  // Bands that must read as prose at their extremes.
  const hp = themeStateDecls({ rules: 'narrative' }, 'zh-CN').player[0];
  assert.deepEqual([3, 2, 1, 0].map((v) => mappedStates({ states: [hp], status: { data: { hp: v } } })[0].text), ['毫发无伤', '受了伤', '伤得很重', '奄奄一息']);
});

test('mergeStateDecls appends missing ids and never touches existing entries', () => {
  const defaults = themeStateDecls({ type: 'galgame' }, 'en').character;
  const mine = [{ id: 'trust', label: 'Faith', type: 'number', initial: 7 }];
  const merged = mergeStateDecls(mine, defaults);
  assert.deepEqual(merged.map((s) => s.id), ['trust', 'affection']);
  assert.equal(merged[0], mine[0]);
  assert.equal(mergeStateDecls(merged, defaults), null, 'nothing to add');
  assert.equal(mergeStateDecls('oops', defaults), null, 'a malformed states value is left to the author');
  assert.equal(mergeStateDecls(undefined, defaults).length, 2);
});

function themedWorld(theme) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'airp-theme-'));
  fs.mkdirSync(path.join(root, 'world', 'study'), { recursive: true });
  fs.writeFileSync(path.join(root, 'world.json'), JSON.stringify({
    id: 'theme-world', name: 'T', version: '1.0.0', schema: 1, description: 'd', author: 'a', genre: 'Workshop',
    ...(theme ? { theme } : {}), createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  }));
  fs.writeFileSync(path.join(root, 'world', 'README.md'), '---\ntype: readme\nname: Root\n---\n\nRoot.\n');
  fs.writeFileSync(path.join(root, 'world', 'study', 'README.md'), '---\ntype: gate\nname: Study\n---\n\nA study.\n');
  return root;
}

const IMPROVISE = {
  title: 'Check the shelf',
  outcomes: {
    failure: { text: 'Dust.' },
    setback: { text: 'A loose page.' },
    success: { text: 'A note.', find: { title: 'Note', body: 'A torn note.' } },
    great: { text: 'A diary.', find: { title: 'Diary', body: 'A diary.' } },
  },
};

for (const [rules, type, expect, bands] of [
  [undefined, '2d10', '>=11', [[2, 4], [5, 10], [11, 17], [18, 20]]],
  ['coc', '1d100', '<=60', [[1, 12], [13, 60], [61, 95], [96, 100]]],
  ['dnd', '1d20+2', '>=12', [[3, 6], [7, 11], [12, 19], [20, 22]]],
]) {
  test(`an improvised search follows the theme's dice: ${rules ?? 'no theme'} → ${type}`, async () => {
    const root = themedWorld(rules ? { rules } : undefined);
    const store = new LocalWorldStore(root);
    const svc = createActionService(store, { type: 'writer' }, { turn: 'test:theme' });
    const res = await svc.searchPlace({ layer: 'world/study', improvise: IMPROVISE });
    const fm = parseFrontmatter(await store.readFile(res.details.path)).frontmatter;
    assert.deepEqual(fm.roll_dice, { type, desc: 'Check the shelf', expect });
    assert.deepEqual(fm.dice_outcomes.map((b) => [b.min, b.max]), bands);
    // Each band keeps its own grade's text, whatever order the dice put them in.
    const grade = diceConventionForTheme(rules ? { rules } : undefined).bands.map((b) => b.grade);
    fm.dice_outcomes.forEach((b, i) => assert.equal(b.text, IMPROVISE.outcomes[grade[i]].text));
    for (const find of res.details.finds) assert.equal(await store.statKind(find), 'missing', 'no item before the roll');
    store.close();
  });
}

test('three world categories: one table, every type folds into exactly one, the picker writes a live type', () => {
  assert.deepEqual(WORLD_CATEGORIES.map((c) => c.id), ['trpg', 'story', 'free']);
  for (const c of WORLD_CATEGORIES) {
    for (const l of ['en', 'zh-CN', 'ja', 'ko']) assert.ok(c.label[l] && c.line[l], `${c.id} ${l}`);
    const type = WORLD_TYPES.find((t) => t.id === c.type);
    assert.ok(type && !type.legacy && type.writer.length > 80, `${c.id} writes a live type with writer rules`);
  }
  for (const type of WORLD_TYPES) assert.equal(WORLD_CATEGORIES.filter((c) => c.types.includes(type.id)).length, 1, `${type.id} in one category`);
  assert.deepEqual(WORLD_TYPES.filter((t) => !t.legacy).map((t) => t.id), ['trpg', 'story', 'free']);
  // Old types keep working and land in their category.
  assert.equal(categoryOfType('infinite').id, 'trpg');
  assert.equal(categoryOfType('galgame').id, 'story');
  assert.equal(categoryOfType('companion').id, 'free');
  assert.equal(categoryOfType('blank').id, 'free');
  assert.equal(categoryOfType('nope'), null);
  assert.match(themeWriterBlock({ type: 'companion' }), /companion life/);
  // The merged guidance: trpg covers instance runs, story covers relationships.
  assert.match(themeWriterBlock({ type: 'trpg' }), /instances/);
  assert.match(themeWriterBlock({ type: 'story' }), /affection and trust/);
  assert.match(themeWriterBlock({ type: 'free' }), /free world/);
  // A world's category: the author's intro first, then its theme type.
  assert.equal(worldCategoryIdOf({ intro: { category: 'story' }, theme: { type: 'trpg' } }), 'story');
  assert.equal(worldCategoryIdOf({ theme: { type: 'sim' } }), 'free');
  assert.equal(worldCategoryIdOf({ intro: { category: 'bogus' } }), null);
  assert.equal(worldCategoryIdOf({}), null);
});
