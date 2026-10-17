#!/usr/bin/env node
/**
 * Retrofit character skills onto the official worlds.
 *
 * For each family in SPEC, in all four editions:
 *   - world.json gets `rules` (the rule system);
 *   - player/README.md (created when missing) and each listed companion's
 *     characters/<id>/README.md get a `sheet:` block, labels in the edition's
 *     language (standard skills from rules/skills.ts, custom ones from SPEC);
 *   - every declared search spot gets `skill:`; a pre-placed dice card gets a
 *     `skill_check:` block — authored checks keep the target they had (the
 *     skills they test sit at that value), so balance and endings are unchanged;
 *   - `roll.result` comparisons in roll conditions become `roll.rank` (1 fumble …
 *     4 great), so a later change of a skill value never shifts a band;
 *   - the world skill gains one "Skills and checks" paragraph.
 *
 * Text edits only (no YAML re-serialization of existing frontmatter), idempotent:
 * a file that already has the block is left alone.
 *
 * Run: node tools/experiences/skill-sheets.mjs [family …]   (default: every family in SPEC)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { editionFamilies, editionId } from '../world-editions.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(new URL('../../packages/shared/package.json', import.meta.url));
const YAML = require('yaml');
const shared = await import(new URL('../../packages/shared/dist/index.js', import.meta.url));
const { catalogSkill, diceConventionOf, diceGradeOf, parseFrontmatter } = shared;

const LOCALES = ['en', 'ja', 'zh-CN', 'ko'];
const L = (en, zh, ja, ko) => ({ en, 'zh-CN': zh, ja, ko });

/**
 * The per-world choices. `player` / `characters`: coc → [id, value, label?];
 * dnd → { abilities, skills: [id, proficient?, label?] }. `spots` maps
 * `<README path>#<spot id>` → skill; `cards` maps a pre-placed dice card → skill.
 */
export const SPEC = {
  whitechapel: {
    rules: { system: 'coc', characterChecks: true },
    player: [
      ['spot_hidden', 60], ['library_use', 60], ['psychology', 60], ['stealth', 60],
      ['science', 75, L('Science (Chemistry)', '科学（化学）', '科学（化学）', '과학(화학)')],
      ['disguise', 65], ['fighting', 55, L('Fighting (Boxing)', '格斗（拳击）', '近接戦闘（ボクシング）', '근접전(권투)')],
      ['listen', 55], ['fast_talk', 50], ['locksmith', 45], ['firearms', 40],
    ],
    characters: {
      watson: [
        ['medicine', 70], ['first_aid', 70], ['firearms', 50, L('Firearms (Service Revolver)', '射击（军用左轮）', '射撃（軍用リボルバー）', '사격(군용 리볼버)')],
        ['psychology', 45], ['spot_hidden', 45], ['persuade', 40],
      ],
    },
    spots: {
      'world/london-map/edith-room/README.md#scene': 'psychology',
      'world/london-map/morgue/README.md#scene': 'library_use',
      'world/london-map/print-shop/README.md#scene': 'spot_hidden',
      'world/london-map/print-shop/editor-office/README.md#scene': 'library_use',
      'world/london-map/print-shop/illustration-room/README.md#scene': 'psychology',
      'world/london-map/third-crime-scene/README.md#scene': 'spot_hidden',
      'world/london-map/unnamed-street/README.md#scene': 'stealth',
    },
    cards: {},
  },
  guixiang: {
    rules: { system: 'coc', sanity: true, characterChecks: true },
    player: [
      // The searches' own words name these two (「1d100（侦查）」), so the sheet keeps them.
      ['spot_hidden', 60, L('Investigate', '侦查', '捜索', '수색')], ['library_use', 60, L('Library Use', '图书馆使用', '図書館使用', '도서관 사용')],
      ['persuade', 60], ['listen', 50],
      ['language_other', 50, L('Hakka', '客家话', '客家語', '객가어')],
      ['psychology', 40], ['history', 35], ['dodge', 35], ['first_aid', 30], ['occult', 15],
    ],
    characters: {
      'xiulian': [
        ['language_other', 80, L('Hakka', '客家话', '客家語', '객가어')], ['history', 60, L('Clan Lore', '族中旧事', '一族の昔話', '집안 옛일')],
        ['persuade', 55], ['occult', 45], ['listen', 40], ['spot_hidden', 30],
      ],
    },
    // Removed from `states:`: the old skill numbers now live on the sheet.
    dropStates: ['spot_hidden', 'library_use', 'psychology'],
    spots: {
      'world/README.md#scene': 'library_use',
      'world/ah-di-1947/README.md#scene': 'spot_hidden',
      'world/ah-di-1947/granary/README.md#scene': 'spot_hidden',
      'world/ah-di-1947/kitchen/README.md#scene': 'spot_hidden',
      'world/shuisheng-1978/README.md#scene': 'library_use',
      'world/shuisheng-1978/sluice/README.md#scene': 'spot_hidden',
      'world/shuisheng-1978/tally-shed/README.md#scene': 'spot_hidden',
    },
    cards: {
      'world/ah-di-1947/back-well/04-at-the-well.md': 'persuade',
      'world/shuisheng-1978/sluice/04-gate-wheel.md': 'persuade',
    },
  },
  divergence: {
    rules: { system: 'coc', characterChecks: true },
    player: [
      ['electrical_repair', 70, L('Electronics Repair', '电器维修', '電子修理', '전자 수리')], ['spot_hidden', 55], ['mechanical_repair', 50],
      ['persuade', 50], ['listen', 50], ['library_use', 45], ['psychology', 45], ['stealth', 30],
    ],
    characters: {
      'young-ryo': [['listen', 60], ['charm', 60], ['spot_hidden', 55], ['stealth', 50], ['climb', 40]],
      master: [
        ['electrical_repair', 85, L('Electronics Repair', '电器维修', '電子修理', '전자 수리')], ['mechanical_repair', 75],
        ['psychology', 50], ['history', 50], ['persuade', 45],
      ],
    },
    spots: {},
    cards: {},
  },
  // firstsnow: no skills — 初雪电台 plays as a companion story, no checks.
  'magic-academy': {
    rules: { system: 'dnd', proficiency: 2, characterChecks: true },
    player: {
      abilities: { str: -1, dex: 1, con: 0, int: 3, wis: 2, cha: 1 },
      skills: [['arcana', true], ['investigation', true], ['insight', true], ['history'], ['perception'], ['persuasion'], ['sleight_of_hand']],
    },
    characters: {
      seraphina: {
        abilities: { str: 0, dex: 1, con: 0, int: 4, wis: 2, cha: 2 },
        skills: [['arcana', true], ['history', true], ['insight', true], ['persuasion', true], ['perception']],
      },
    },
    spots: {},
    cards: {},
  },
  'moonlit-contract': {
    rules: { system: 'dnd', proficiency: 2, characterChecks: true },
    player: {
      abilities: { str: 0, dex: 1, con: 1, int: 1, wis: 2, cha: 2 },
      skills: [['insight', true], ['arcana', true], ['perception', true], ['persuasion'], ['stealth'], ['history']],
    },
    characters: {
      lyra: {
        abilities: { str: 4, dex: 1, con: 3, int: 0, wis: 1, cha: 1 },
        skills: [['athletics', true], ['intimidation', true], ['perception', true], ['insight'], ['survival']],
      },
    },
    spots: {},
    cards: {},
  },
  'unwritten-door': {
    rules: { system: 'dnd', proficiency: 2, characterChecks: true },
    player: {
      abilities: { str: 0, dex: 1, con: 1, int: 1, wis: 2, cha: 1 },
      skills: [['perception', true], ['investigation', true], ['insight'], ['stealth'], ['athletics'], ['persuasion']],
    },
    characters: {
      iris: {
        abilities: { str: 0, dex: 2, con: 0, int: 2, wis: 2, cha: 1 },
        skills: [['insight', true], ['perception', true], ['survival', true], ['investigation'], ['stealth']],
      },
    },
    spots: {},
    cards: {},
  },
  'last-train': {
    rules: { system: 'coc', characterChecks: true },
    // Authored as 2d10 >=11: the READMEs keep that table as the base its four
    // bands are read against; the dice become d100 under the skill (60), and
    // the players' text is rewritten to say so (§6).
    from2d10: true,
    player: [
      ['spot_hidden', 60], ['persuade', 60], ['stealth', 60], ['fighting', 60, L('Fighting (Brawl)', '格斗（扭打）', '近接戦闘（組みつき）', '근접전(몸싸움)')],
      ['listen', 50], ['climb', 45], ['first_aid', 40], ['psychology', 40], ['mechanical_repair', 30],
    ],
    characters: {
      'xia-cheng': [['spot_hidden', 65], ['first_aid', 55], ['listen', 55], ['persuade', 50], ['psychology', 45], ['mechanical_repair', 40]],
    },
    spots: {
      'world/cab/README.md#scene': 'spot_hidden',
      'world/dining-car/README.md#scene': 'spot_hidden',
      'world/seated-car/README.md#scene': 'persuade',
      'world/sleeper/README.md#scene': 'stealth',
    },
    cards: { 'world/freight-car/04-confront-dice.md': 'fighting' },
  },
  wuwu: {
    rules: { system: 'coc', characterChecks: true },
    from2d10: true,
    player: [
      ['spot_hidden', 60], ['navigate', 60], ['stealth', 60], ['mechanical_repair', 60],
      ['listen', 50], ['persuade', 50], ['psychology', 45], ['climb', 40], ['first_aid', 35],
    ],
    characters: {
      vera: [['mechanical_repair', 75], ['fast_talk', 55], ['spot_hidden', 50], ['fighting', 50], ['electrical_repair', 45]],
    },
    spots: {
      'world/harbor-chart/README.md#fog': 'navigate',
      'world/harbor-chart/old-lighthouse/README.md#scene': 'spot_hidden',
      'world/harbor-chart/old-lighthouse/README.md#peek-logbook': 'stealth',
      'world/harbor-chart/seventh-berth/README.md#scene': 'stealth',
      'world/harbor-chart/workshop/README.md#scene': 'mechanical_repair',
    },
    cards: {},
  },
};

// ---------------------------------------------------------------------------

/** "2d10: roll two ten-sided dice…" → the skill line, per edition language. */
const D100_HEADER = {
  en: (label, v) => `1d100 (${label} ${v}): roll at or under your skill; lower is better.`,
  'zh-CN': (label, v) => `1d100（${label} ${v}）：掷出小于等于技能值即成功，越低越好。`,
  ja: (label, v) => `1d100（${label} ${v}）：技能値以下で成功、低いほど良い。`,
  ko: (label, v) => `1d100(${label} ${v}): 기능 수치 이하면 성공, 낮을수록 좋다.`,
};
/** The four 2d10 band prefixes and their d100 (skill 60) equivalents, by grade. */
const BAND_LINES = [
  [/^(\s*)2([-–])4(\s*[（(])6%/m, '$196$2100$35%'],
  [/^(\s*)5([-–])10(\s*[（(])39%/m, '$161$295$335%'],
  [/^(\s*)11([-–])17(\s*[（(])49%/m, '$113$260$348%'],
  [/^(\s*)18([-–])20(\s*[（(])6%/m, '$11$212$312%'],
  [/^(\s*)11([-–])20(\s*[（(])55%/m, '$11$260$360%'],
];
/** The world skills' own 2d10 sentence, per edition language. */
const SKILL_DICE_LINES = [
  ['always 2d10, expect ">=11", with four bands 2–4 / 5–10 / 11–17 / 18–20', 'skill checks: d100 at or under the skill the place names (60), four bands 1–12 / 13–60 / 61–95 / 96–100'],
  ['一律 2d10，expect ">=11"，四档 2–4 / 5–10 / 11–17 / 18–20', '都是技能检定：d100 小于等于该处写明的技能值（60），四档 1–12 / 13–60 / 61–95 / 96–100'],
  ['一律 2d10、expect ">=11"、四段階 2–4 / 5–10 / 11–17 / 18–20', 'すべて技能判定：d100 でその場所が示す技能値（60）以下、四段階 1–12 / 13–60 / 61–95 / 96–100'],
  ['일괄 2d10, expect ">=11", 네 단계 2–4 / 5–10 / 11–17 / 18–20', '모두 기능 판정: d100으로 그 장소가 밝힌 기능 수치(60) 이하, 네 단계 1–12 / 13–60 / 61–95 / 96–100'],
  ["This game's investigation card is 2d10, success >= 11, split into four tiers 2-4/5-10/11-17/18-20.", "This game's investigation cards are skill checks: d100 at or under the skill the place names (60), four tiers 1-12/13-60/61-95/96-100."],
  ['本局的调查卡为2d10，成功>=11，分2–4/5–10/11–17/18–20四档。', '本局的调查卡都是技能检定：d100 小于等于该处写明的技能值（60），分1–12/13–60/61–95/96–100四档。'],
  ['本局の調査カードは2d10、成功>=11、2–4／5–10／11–17／18–20の四段階。', '本局の調査カードはすべて技能判定：d100 でその場所が示す技能値（60）以下、1–12／13–60／61–95／96–100の四段階。'],
  ['이번 판의 조사 카드는 2d10, 성공>=11, 2–4/5–10/11–17/18–20 네 단계로 나뉜다.', '이번 판의 조사 카드는 모두 기능 판정: d100으로 그 장소가 밝힌 기능 수치(60) 이하, 1–12/13–60/61–95/96–100 네 단계로 나뉜다.'],
];

/** Rewrite the player-facing 2d10 lines of one body block for a skill. */
function d100Text(text, label, value, locale) {
  let out = text.replace(/^(\s*)2d10[:：].*$/m, (_m, indent) => `${indent}${D100_HEADER[locale](label, value)}`);
  for (const [re, to] of BAND_LINES) out = out.replace(re, to);
  return out;
}

const SKILL_TEXT = {
  coc: {
    en: (sanity) => `## Skills and checks\nThis world uses CoC-like skills (world.json \`rules\`). The protagonist's sheet is \`sheet:\` in player/README.md; a companion's is in its character README. Every search names the skill it tests, and its dice follow the sheet: d100 at or under the skill, hard = half, extreme = a fifth, 01 a critical, 96–100 a fumble. For any other uncertain action of the protagonist, call skill_check with the fitting skill and a difficulty you can justify, then stop and let the player roll; narrate from the resolved tier. A companion may roll for its own action (skill_check, actor "self"). Never decide such an outcome in prose; feelings and consent are never checks.${sanity ? ' Sanity checks are skill "sanity" with sanity { pass, fail }.' : ''}`,
    ja: (sanity) => `## 技能と判定\nこの世界は CoC 風の技能を使う（world.json の \`rules\`）。主人公のキャラクターシートは player/README.md の \`sheet:\`、同行者のものはその人物の README にある。探索はどれも試す技能を名乗り、ダイスはシートに従う：d100 で技能値以下、ハードは半分、イクストリームは 5 分の 1、01 はクリティカル、96〜100 はファンブル。主人公のそれ以外の不確かな行動には、合う技能と説明できる難易度で skill_check を呼び、プレイヤーが振るのを待つ。結果の段階から語る。同行者は自分の行動に判定してよい（skill_check、actor "self"）。地の文で結果を決めない。気持ちと同意は判定しない。${sanity ? '正気度判定は技能 "sanity" と sanity { pass, fail } で行う。' : ''}`,
    'zh-CN': (sanity) => `## 技能与检定\n这个世界用类 CoC 的技能（world.json 的 \`rules\`）。主角的角色卡是 player/README.md 的 \`sheet:\`，同伴的在各自的角色 README 里。每个搜查都写明检定哪项技能，骰子按角色卡：d100 小于等于技能值，困难取一半，极难取五分之一，01 大成功，96–100 大失败。主角其他没有把握的行动，用合适的技能和说得出理由的难度调用 skill_check，然后停下等玩家掷；按结算出的档位叙述。同伴可以为自己的行动检定（skill_check，actor "self"）。不要在正文里替骰子决定结果；感情与同意从不检定。${sanity ? '理智检定用技能 "sanity" 并写 sanity { pass, fail }。' : ''}`,
    ko: (sanity) => `## 기능과 판정\n이 세계는 CoC 풍 기능을 쓴다(world.json의 \`rules\`). 주인공의 캐릭터 시트는 player/README.md의 \`sheet:\`, 동료의 시트는 그 인물의 README에 있다. 모든 탐색은 시험하는 기능을 밝히고, 주사위는 시트를 따른다: d100으로 기능 수치 이하, 어려움은 절반, 극단적은 5분의 1, 01은 대성공, 96–100은 대실패. 주인공의 그 밖의 불확실한 행동에는 알맞은 기능과 설명할 수 있는 난이도로 skill_check를 부르고, 플레이어가 굴릴 때까지 멈춘다. 판정된 단계에 따라 서술한다. 동료는 자기 행동에 판정할 수 있다(skill_check, actor "self"). 본문에서 결과를 정하지 않는다. 감정과 동의는 판정하지 않는다.${sanity ? ' 이성 판정은 기능 "sanity"와 sanity { pass, fail }로 한다.' : ''}`,
  },
  dnd: {
    en: () => `## Skills and checks\nThis world uses D&D-like skills (world.json \`rules\`). The protagonist's sheet is \`sheet:\` in player/README.md (ability modifiers and proficient skills); a companion's is in its character README. A check is d20 + the skill modifier against a DC (easy 10, moderate 12, hard 15, very hard 20), with advantage or disadvantage when the fiction gives it; a natural 20 always succeeds, a natural 1 always fails. When the protagonist attempts something uncertain, call skill_check with the fitting skill and DC, then stop and let the player roll; narrate from the resolved tier. A companion may roll for its own action (skill_check, actor "self"). Never decide such an outcome in prose; feelings, promises and consent are never checks.`,
    ja: () => `## 技能と判定\nこの世界は D&D 風の技能を使う（world.json の \`rules\`）。主人公のキャラクターシートは player/README.md の \`sheet:\`（能力修正値と習熟技能）、同行者のものはその人物の README にある。判定は d20 + 技能修正値で DC（易 10、普通 12、難 15、至難 20）に挑み、状況が与えるなら有利・不利で振る。出目 20 は必ず成功、出目 1 は必ず失敗。主人公が不確かなことを試みたら、合う技能と DC で skill_check を呼び、プレイヤーが振るのを待つ。結果の段階から語る。同行者は自分の行動に判定してよい（skill_check、actor "self"）。地の文で結果を決めない。気持ち・約束・同意は判定しない。`,
    'zh-CN': () => `## 技能与检定\n这个世界用类 D&D 的技能（world.json 的 \`rules\`）。主角的角色卡是 player/README.md 的 \`sheet:\`（属性调整值与熟练技能），同伴的在各自的角色 README 里。检定是 d20 + 技能调整值对抗 DC（简单 10、普通 12、困难 15、极难 20），情境给出时按优势或劣势掷；天然 20 必定成功，天然 1 必定失败。主角尝试没有把握的事时，用合适的技能和 DC 调用 skill_check，然后停下等玩家掷；按结算出的档位叙述。同伴可以为自己的行动检定（skill_check，actor "self"）。不要在正文里替骰子决定结果；感情、承诺与同意从不检定。`,
    ko: () => `## 기능과 판정\n이 세계는 D&D 풍 기능을 쓴다(world.json의 \`rules\`). 주인공의 캐릭터 시트는 player/README.md의 \`sheet:\`(능력 수정치와 숙련 기능), 동료의 시트는 그 인물의 README에 있다. 판정은 d20 + 기능 수정치로 DC(쉬움 10, 보통 12, 어려움 15, 매우 어려움 20)에 도전하고, 상황이 주면 이점이나 불리로 굴린다. 내추럴 20은 반드시 성공, 내추럴 1은 반드시 실패. 주인공이 불확실한 일을 시도하면 알맞은 기능과 DC로 skill_check를 부르고, 플레이어가 굴릴 때까지 멈춘다. 판정된 단계에 따라 서술한다. 동료는 자기 행동에 판정할 수 있다(skill_check, actor "self"). 본문에서 결과를 정하지 않는다. 감정, 약속, 동의는 판정하지 않는다.`,
  },
};
const SKILL_HEADINGS = ['## Skills and checks', '## 技能と判定', '## 技能与检定', '## 기능과 판정'];
const PLAYER_TITLE = { en: 'You', ja: 'あなた', 'zh-CN': '你', ko: '당신' };

function labelOf(system, entry, locale) {
  const custom = system === 'coc' ? entry[2] : entry[2];
  if (custom && typeof custom === 'object') return custom[locale];
  const s = catalogSkill(system, entry[0]);
  if (!s) throw new Error(`skill ${entry[0]} is not standard; give it labels`);
  return s.label[locale];
}

export function sheetFor(system, spec, locale) {
  if (system === 'coc') return { skills: spec.map((e) => ({ id: e[0], label: labelOf('coc', e, locale), value: e[1] })) };
  return {
    abilities: { ...spec.abilities },
    skills: spec.skills.map((e) => {
      const s = catalogSkill('dnd', e[0]);
      return { id: e[0], label: labelOf('dnd', e, locale), ability: e[3] ?? s.ability, ...(e[1] ? { proficient: true } : {}) };
    }),
  };
}

/** Insert a YAML block at the end of a frontmatter (before the closing ---). */
function appendToFrontmatter(raw, obj) {
  if (!raw.startsWith('---\n')) throw new Error('no frontmatter');
  const end = raw.indexOf('\n---', 4);
  const block = YAML.stringify(obj, { lineWidth: 0 });
  return `${raw.slice(0, end + 1)}${block}${raw.slice(end + 1)}`;
}

/** Remove whole `- id: <x>` entries from a top-level `states:` list (text edit). */
function dropStates(raw, ids) {
  const lines = raw.split('\n');
  const out = [];
  let inStates = false;
  let skipping = false;
  for (const line of lines) {
    if (/^states:\s*$/.test(line)) { inStates = true; out.push(line); continue; }
    if (inStates && /^\S/.test(line)) inStates = false;
    if (inStates) {
      const m = /^ {2}- id: (\S+)\s*$/.exec(line);
      if (m) skipping = ids.includes(m[1]);
      if (skipping) continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

/** Add `skill: <id>` right under a search spot's `- id: <spot>` line. */
function tagSpot(raw, spotId, skill) {
  const lines = raw.split('\n');
  let inSearch = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^search:\s*$/.test(lines[i])) { inSearch = true; continue; }
    if (inSearch && /^\S/.test(lines[i])) inSearch = false;
    if (inSearch && new RegExp(`^ {2}- id: ${spotId}\\s*$`).test(lines[i])) {
      if (/^ {4}skill: /.test(lines[i + 1] ?? '')) return raw;
      lines.splice(i + 1, 0, `    skill: ${skill}`);
      return lines.join('\n');
    }
  }
  throw new Error(`search spot ${spotId} not found`);
}

const RANK = { failure: 1, setback: 2, success: 3, great: 4 };
/** `roll.result <op> N` → `roll.rank <op'> k` under a convention whose bands N must align with. */
export function translateConditions(text, convention) {
  const grades = (op, n) => {
    const holds = (x) => (op === '>=' ? x >= n : op === '<=' ? x <= n : op === '>' ? x > n : op === '<' ? x < n : x === n);
    const set = new Set();
    for (const b of convention.bands) {
      const all = [];
      for (let x = b.min; x <= b.max; x++) all.push(holds(x));
      if (all.every(Boolean)) set.add(RANK[b.grade]);
      else if (all.some(Boolean)) throw new Error(`roll.result ${op} ${n} splits the ${b.grade} band of ${convention.type} ${convention.expect}`);
    }
    return [...set].sort((a, b) => a - b);
  };
  let out = text.replace(/roll\.result\s*(>=|<=|==|>|<)\s*(\d+)/g, (_m, op, n) => {
    const ranks = grades(op, Number(n));
    if (ranks.length === 0) throw new Error(`roll.result ${op} ${n} never holds`);
    const lo = ranks[0], hi = ranks[ranks.length - 1];
    if (hi - lo + 1 !== ranks.length) throw new Error(`roll.result ${op} ${n} is not contiguous in rank`);
    if (lo === hi) return `roll.rank == ${lo}`;
    if (lo === 1) return `roll.rank <= ${hi}`;
    if (hi === 4) return `roll.rank >= ${lo}`;
    throw new Error('middle range');
  });
  out = out.replace(/roll\.rank <= (\d) && roll\.rank >= \1/g, 'roll.rank == $1').replace(/roll\.rank >= (\d) && roll\.rank <= \1/g, 'roll.rank == $1');
  return out;
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

function retrofit(base) {
  const spec = SPEC[base];
  const family = editionFamilies.find((f) => f.base === base);
  if (!spec || !family) throw new Error(`unknown family ${base}`);
  const system = spec.rules.system;
  for (const locale of LOCALES) {
    const id = editionId(family, locale);
    const root = path.join(repo, 'templates', id);
    const changed = [];
    const write = (rel, text) => { fs.writeFileSync(path.join(root, rel), text); changed.push(rel); };
    // world.json — rules right after theme / mode, before the clock.
    const wj = JSON.parse(fs.readFileSync(path.join(root, 'world.json'), 'utf8'));
    if (!wj.rules) {
      const next = {};
      for (const [k, v] of Object.entries(wj)) {
        next[k] = v;
        if (k === 'entry') next.rules = spec.rules;
      }
      if (!next.rules) next.rules = spec.rules;
      write('world.json', `${JSON.stringify(next, null, 2)}\n`);
    }
    // player sheet
    const playerRel = 'player/README.md';
    const playerAbs = path.join(root, playerRel);
    if (!fs.existsSync(playerAbs)) {
      fs.mkdirSync(path.dirname(playerAbs), { recursive: true });
      write(playerRel, `---\n${YAML.stringify({ type: 'readme', title: PLAYER_TITLE[locale] }, { lineWidth: 0 })}---\n`);
    }
    let raw = fs.readFileSync(playerAbs, 'utf8');
    if (spec.dropStates) {
      const dropped = dropStates(raw, spec.dropStates);
      if (dropped !== raw) { raw = dropped; write(playerRel, raw); }
    }
    if (parseFrontmatter(raw).frontmatter?.sheet === undefined) write(playerRel, appendToFrontmatter(raw, { sheet: sheetFor(system, spec.player, locale) }));
    // character sheets
    for (const [cid, cspec] of Object.entries(spec.characters ?? {})) {
      const rel = `characters/${cid}/README.md`;
      const text = fs.readFileSync(path.join(root, rel), 'utf8');
      if (parseFrontmatter(text).frontmatter?.sheet === undefined) write(rel, appendToFrontmatter(text, { sheet: sheetFor(system, cspec, locale) }));
    }
    // search spots
    for (const [key, skill] of Object.entries(spec.spots ?? {})) {
      const [rel, spot] = key.split('#');
      const text = fs.readFileSync(path.join(root, rel), 'utf8');
      const next = tagSpot(text, spot, skill);
      if (next !== text) write(rel, next);
    }
    // pre-placed dice cards
    const sheetLabels = new Map(sheetFor(system, spec.player, locale).skills.map((s) => [s.id, s.label]));
    for (const [rel, skill] of Object.entries(spec.cards ?? {})) {
      const text = fs.readFileSync(path.join(root, rel), 'utf8');
      const fm = parseFrontmatter(text).frontmatter ?? {};
      if (fm.skill_check) continue;
      const entry = system === 'coc' ? spec.player.find((e) => e[0] === skill) : null;
      const target = system === 'coc' ? entry[1] : 12;
      write(rel, appendToFrontmatter(text, {
        skill_check: { skill, label: sheetLabels.get(skill), system, actor: 'player', difficulty: system === 'coc' ? 'regular' : '12', target, value: target },
      }));
    }
    // 2d10 families: the players' dice text becomes the skill's d100 (§6).
    if (spec.from2d10) {
      const labelOf2 = new Map(sheetFor(system, spec.player, locale).skills.map((s) => [s.id, s.label]));
      const valueOf2 = new Map(spec.player.map((e) => [e[0], e[1]]));
      const byFile = new Map();
      for (const [key, skill] of Object.entries(spec.spots ?? {})) {
        const [rel, spot] = key.split('#');
        if (!byFile.has(rel)) byFile.set(rel, []);
        byFile.get(rel).push([spot, skill]);
      }
      for (const [rel, list] of byFile) {
        let text = fs.readFileSync(path.join(root, rel), 'utf8');
        for (const [spot, skill] of list) {
          // The spot's block runs from its `- id:` line to the next spot or top-level key.
          const start = text.search(new RegExp(`^ {2}- id: ${spot}\\s*$`, 'm'));
          if (start < 0) throw new Error(`${rel}#${spot}`);
          const rest = text.slice(start + 1);
          const endRel = rest.search(/^( {2}- id: |\S)/m);
          const end = endRel < 0 ? text.length : start + 1 + endRel;
          text = text.slice(0, start) + d100Text(text.slice(start, end), labelOf2.get(skill), valueOf2.get(skill), locale) + text.slice(end);
        }
        write(rel, text);
      }
      for (const [rel, skill] of Object.entries(spec.cards ?? {})) {
        const text = fs.readFileSync(path.join(root, rel), 'utf8');
        const next = d100Text(text, labelOf2.get(skill), valueOf2.get(skill), locale);
        if (next !== text) write(rel, next);
      }
      const base2d10 = diceConventionOf('2d10', '>=11');
      for (const abs of walk(path.join(root, 'command')).filter((f) => f.endsWith('.yaml'))) {
        const text = fs.readFileSync(abs, 'utf8');
        if (/roll\.result\s*(>=|<=|==|>|<)\s*\d/.test(text)) write(path.relative(root, abs), translateConditions(text, base2d10));
      }
      const skillRel2 = `skills/${id}-play/SKILL.md`;
      let st = fs.readFileSync(path.join(root, skillRel2), 'utf8');
      const before = st;
      for (const [from, to] of SKILL_DICE_LINES) st = st.split(from).join(to);
      if (st !== before) write(skillRel2, st);
    }
    // roll conditions → rank
    for (const abs of walk(path.join(root, 'world')).filter((f) => f.endsWith('.md'))) {
      const text = fs.readFileSync(abs, 'utf8');
      if (!/roll\.result\s*(>=|<=|==|>|<)\s*\d/.test(text)) continue;
      const fm = parseFrontmatter(text).frontmatter ?? {};
      const dice = (Array.isArray(fm.search) ? fm.search.map((s) => s.roll_dice) : []).concat(fm.roll_dice ? [fm.roll_dice] : []);
      const conventions = [...new Set(dice.map((d) => diceConventionOf(d?.type, d?.expect)).filter(Boolean))];
      if (conventions.length !== 1) throw new Error(`${id}/${path.relative(root, abs)}: conditions over ${conventions.length} conventions`);
      write(path.relative(root, abs), translateConditions(text, conventions[0]));
    }
    // world skill paragraph
    const skillRel = `skills/${id}-play/SKILL.md`;
    const skillText = fs.readFileSync(path.join(root, skillRel), 'utf8');
    if (!SKILL_HEADINGS.some((h) => skillText.includes(h))) {
      write(skillRel, `${skillText.replace(/\s*$/, '')}\n\n${SKILL_TEXT[system][locale](spec.rules.sanity === true)}\n`);
    }
    console.log(`${id}: ${changed.length ? [...new Set(changed)].join(', ') : 'already done'}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const only = process.argv.slice(2);
  for (const base of only.length ? only : Object.keys(SPEC)) retrofit(base);
}

// Exposed for the contract test.
export { diceGradeOf };
