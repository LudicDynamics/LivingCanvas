/**
 * World themes. What a world made in the workshop IS,
 * as data the writer, the create form and the intro popup all read:
 *
 *   - TYPE (类型): the headline choice — TRPG, infinite-flow, story, galgame,
 *     sim, companion life, blank. A type is a bundle: a default rule pack, the
 *     default structure flags, default declared states per panel, and one
 *     paragraph of writer rules. Picking a type presets everything; every part
 *     stays editable. It also names a default music track (`audioTheme`, a
 *     shared `assets/audio` key): trpg → tense (dark drone), infinite →
 *     guixiang (guzheng over a drone), story → divergence, galgame → firstsnow
 *     (emotional piano), sim → mandongbu (school-day loop), companion and
 *     blank → calm (piano loop).
 *   - RULE PACK (规则): pluggable, like Foundry VTT game systems — a dice
 *     convention, default state templates for the player and characters, and a
 *     writer paragraph. Ships `coc`, `dnd`, `narrative`.
 *   - STRUCTURE (结构): independent flags — has endings, hides core mysteries,
 *     runs against a clock, is gated by mechanism puzzles. world.json `mode` is
 *     DERIVED from them (no endings → open; endings → semi; + clock → closed).
 *
 * Any type × any pack × any flags combine. Adding a type, a pack or a flag is
 * adding one entry to its table; nothing else branches on ids.
 *
 * Owner decisions: chosen when a world is made in the
 * workshop (templates untouched); a world without `theme` is today's
 * behaviour (narrative dice, sandbox). The declared-state defaults below are
 * localized `StateDecl`s (rules/states.ts): `themeStateDecls` renders them in
 * the world's language, and the workshop writes them into the new world's
 * README frontmatter `states:` (apps/server/src/world-workshop.ts).
 *
 * Zero dependencies on purpose (like `rules/dice.ts`): the web bundle imports
 * it through `@airp/shared/themes` for the create form and the intro popup.
 */

export type ThemeLocale = 'en' | 'zh-CN' | 'ja' | 'ko';
export type Localized = Readonly<Record<ThemeLocale, string>>;

// ---------------------------------------------------------------------------
// Dice conventions
// ---------------------------------------------------------------------------

/** The four bands every search / declared outcome table uses. */
export type DiceGrade = 'failure' | 'setback' | 'success' | 'great';

export interface DiceBand {
  grade: DiceGrade;
  min: number;
  max: number;
}

export interface DiceConvention {
  id: string;
  /** `roll_dice.type`, e.g. `2d10`, `1d100`, `1d20+2`. */
  type: string;
  /** `roll_dice.expect` of the standard check, e.g. `>=11`. */
  expect: string;
  /** The four bands in ASCENDING `min` order; they partition [min, max] of the roll. */
  bands: readonly DiceBand[];
  /** One line for the player: how the dice work here. */
  summary: Localized;
}

const band = (grade: DiceGrade, min: number, max: number): DiceBand => ({ grade, min, max });

export const DICE_CONVENTIONS: Readonly<Record<string, DiceConvention>> = Object.freeze({
  /** The archive / narrative check: higher is better. */
  'standard-2d10': {
    id: 'standard-2d10',
    type: '2d10',
    expect: '>=11',
    bands: [band('failure', 2, 4), band('setback', 5, 10), band('success', 11, 17), band('great', 18, 20)],
    summary: {
      en: 'Chance is 2d10: 11 or more succeeds, 18–20 is a great success, 2–4 goes badly. The dice decide what happens next.',
      'zh-CN': '骰子是 2d10：11 点以上成功，18–20 大成功，2–4 失败。骰子决定接下来发生什么。',
      ja: 'ダイスは 2d10。11 以上で成功、18〜20 は大成功、2〜4 は失敗。その結果が次の展開を決めます。',
      ko: '주사위는 2d10입니다. 11 이상이면 성공, 18–20은 대성공, 2–4는 실패. 그 결과가 다음 전개를 정합니다.',
    },
  },
  /** Call of Cthulhu style: roll under a skill of 60; lower is better. */
  'percentile-d100': {
    id: 'percentile-d100',
    type: '1d100',
    expect: '<=60',
    bands: [band('great', 1, 12), band('success', 13, 60), band('setback', 61, 95), band('failure', 96, 100)],
    summary: {
      en: 'Checks are d100 under a skill (usually 60): lower is better. 1–12 is an extreme success; 96–100 a fumble.',
      'zh-CN': '检定是 d100 对技能值（通常 60）：掷出小于等于技能值即成功，越低越好。1–12 极难成功，96–100 大失败。',
      ja: '判定は d100 で技能値（通常 60）以下を目指します。低いほど良く、1〜12 はイクストリーム成功、96〜100 はファンブル。',
      ko: '판정은 d100으로 기능 수치(보통 60) 이하를 노립니다. 낮을수록 좋고, 1–12는 극단적 성공, 96–100은 대실패입니다.',
    },
  },
  /** DND style: d20 + an ability modifier against a DC; higher is better. */
  'd20-dc': {
    id: 'd20-dc',
    type: '1d20+2',
    expect: '>=12',
    bands: [band('failure', 3, 6), band('setback', 7, 11), band('success', 12, 19), band('great', 20, 22)],
    summary: {
      en: 'Checks are d20 + an ability modifier against a difficulty (DC, usually 12): meet or beat it. Higher is better.',
      'zh-CN': '检定是 d20 + 属性调整值，对抗难度等级（DC，通常 12）：达到或超过即成功，越高越好。',
      ja: '判定は d20 + 能力修正値で難易度（DC、通常 12）に挑みます。DC 以上で成功、高いほど良い。',
      ko: '판정은 d20 + 능력 수정치로 난이도(DC, 보통 12)에 도전합니다. DC 이상이면 성공, 높을수록 좋습니다.',
    },
  },
});

export const DEFAULT_DICE_CONVENTION = DICE_CONVENTIONS['standard-2d10'];

/** The convention a declared check belongs to, by its exact type + expect; null when none. */
export function diceConventionOf(type: unknown, expect: unknown): DiceConvention | null {
  const t = typeof type === 'string' ? type.trim().toLowerCase() : '';
  const e = typeof expect === 'string' ? expect.replace(/\s+/g, '') : '';
  return Object.values(DICE_CONVENTIONS).find((c) => c.type === t && c.expect === e) ?? null;
}

/** Which band a score falls in; null when it is outside the convention's range. */
export function diceGradeOf(convention: DiceConvention, score: number): DiceGrade | null {
  return convention.bands.find((b) => score >= b.min && score <= b.max)?.grade ?? null;
}

/** The roll's possible range: the lowest band's min to the highest band's max. */
export function diceRangeOf(convention: DiceConvention): { min: number; max: number } {
  return { min: convention.bands[0].min, max: convention.bands[convention.bands.length - 1].max };
}

// ---------------------------------------------------------------------------
// Declared-state templates
// ---------------------------------------------------------------------------

/** One prose band of a number state, in every theme language. */
export interface LocalizedStateBand {
  min?: number;
  max?: number;
  text: Localized;
}

/**
 * One default declared state: a `StateDecl` (rules/states.ts) whose displayed
 * strings are localized. `localizeState` picks the world's language and yields
 * a plain `StateDecl` for README frontmatter `states:`. Numbers the player
 * should not read as numbers (hp, sanity, wariness…) carry `shown_as` bands,
 * so the panel says them in prose; `hidden` is kept for states that must never
 * surface at all.
 */
export interface StateTemplate {
  id: string;
  label: Localized;
  type: 'number' | 'flag' | 'enum';
  initial: number | boolean | string;
  /** number only: inclusive [min, max]. */
  range?: readonly [number, number];
  /** enum only. */
  values?: readonly string[];
  /** number → ordered bands (first match wins); enum → value → text; flag → "true"/"false" → text. */
  shown_as?: readonly LocalizedStateBand[] | Readonly<Record<string, Localized>>;
  hidden?: boolean;
}

export interface StateDefaults {
  player: readonly StateTemplate[];
  character: readonly StateTemplate[];
  world: readonly StateTemplate[];
}

/** A localized `StateDecl` — structurally what `StateDeclSchema` accepts (kept zod-free here). */
export interface ThemeStateDecl {
  id: string;
  label: string;
  type: 'number' | 'flag' | 'enum';
  initial: number | boolean | string;
  range?: [number, number];
  values?: string[];
  shown_as?: Array<{ min?: number; max?: number; text: string }> | Record<string, string>;
  hidden?: boolean;
}

export interface ThemeStateDecls {
  player: ThemeStateDecl[];
  character: ThemeStateDecl[];
  world: ThemeStateDecl[];
}

const L = (en: string, zh: string, ja: string, ko: string): Localized => ({ en, 'zh-CN': zh, ja, ko });
/** A band: `{ min }` / `{ max }` bounds (or none, the catch-all last band) and its prose. */
const b = (bounds: { min?: number; max?: number }, en: string, zh: string, ja: string, ko: string): LocalizedStateBand => ({ ...bounds, text: L(en, zh, ja, ko) });

const num = (id: string, label: Localized, initial: number, range?: readonly [number, number], bands?: readonly LocalizedStateBand[]): StateTemplate =>
  ({ id, label, type: 'number', initial, ...(range ? { range } : {}), ...(bands ? { shown_as: bands } : {}) });
const flagState = (id: string, label: Localized, initial: boolean, shown?: Readonly<Record<string, Localized>>): StateTemplate =>
  ({ id, label, type: 'flag', initial, ...(shown ? { shown_as: shown } : {}) });
const enumState = (id: string, label: Localized, values: readonly string[], initial: string, shown?: Readonly<Record<string, Localized>>): StateTemplate =>
  ({ id, label, type: 'enum', initial, values, ...(shown ? { shown_as: shown } : {}) });

const NO_STATES: StateDefaults = Object.freeze({ player: [], character: [], world: [] });

/** A template in one language: a plain `StateDecl`. */
export function localizeState(t: StateTemplate, locale: ThemeLocale): ThemeStateDecl {
  const out: ThemeStateDecl = { id: t.id, label: t.label[locale], type: t.type, initial: t.initial };
  if (t.range) out.range = [t.range[0], t.range[1]];
  if (t.values) out.values = [...t.values];
  if (Array.isArray(t.shown_as)) {
    out.shown_as = (t.shown_as as readonly LocalizedStateBand[]).map((band) => ({
      ...(band.min !== undefined ? { min: band.min } : {}),
      ...(band.max !== undefined ? { max: band.max } : {}),
      text: band.text[locale],
    }));
  } else if (t.shown_as) {
    out.shown_as = Object.fromEntries(Object.entries(t.shown_as as Readonly<Record<string, Localized>>).map(([k, v]) => [k, v[locale]]));
  }
  if (t.hidden) out.hidden = true;
  return out;
}

const localizeAll = (list: readonly StateTemplate[], locale: ThemeLocale): ThemeStateDecl[] => list.map((t) => localizeState(t, locale));

// Shared prose for health-like numbers (higher is better).
const HEALTH_BANDS = (full: number, hurt: number, down: Localized = L('Barely alive', '奄奄一息', '瀕死', '숨이 간신히 붙어 있다')): LocalizedStateBand[] => [
  b({ min: full }, 'Unhurt', '毫发无伤', '無傷', '다친 곳 없음'),
  b({ min: hurt }, 'Hurt', '受了伤', '怪我をしている', '다쳤다'),
  b({ min: 1 }, 'Badly hurt', '伤得很重', '重傷', '크게 다쳤다'),
  { max: 0, text: down },
];

// ---------------------------------------------------------------------------
// Rule packs (FVTT-style game systems)
// ---------------------------------------------------------------------------

export interface RulePack {
  id: string;
  label: Localized;
  /** One short line for the create form. */
  blurb: Localized;
  /** Id in `DICE_CONVENTIONS`. */
  dice: string;
  /** Default state templates this system brings (rules/states.ts example packs are these, in Chinese). */
  states: StateDefaults;
  /** The writer's rules for this system, in English (the writer prompt's language). */
  writer: string;
}

export const RULE_PACKS: readonly RulePack[] = Object.freeze([
  {
    id: 'narrative',
    label: { en: 'Narrative', 'zh-CN': '普通叙事', ja: 'ナラティブ', ko: '내러티브' },
    blurb: {
      en: 'Story first. 2d10 checks decide consequences.',
      'zh-CN': '故事优先。2d10 检定决定后果。',
      ja: '物語が主役。2d10 の判定が結果を決める。',
      ko: '이야기가 먼저. 2d10 판정이 결과를 정한다.',
    },
    dice: 'standard-2d10',
    states: { player: [num('hp', L('Wounds', '伤势', '怪我', '부상'), 3, [0, 3], HEALTH_BANDS(3, 2))], character: [], world: [] },
    writer:
      'Rules: narrative. Chance speaks through 2d10 checks declared on chalks (roll_dice type "2d10", expect ">=11"): ' +
      '2–4 goes badly, 5–10 is a setback, 11–17 succeeds, 18–20 is a great success. The dice decide the consequence; ' +
      'narrate it plainly in the tone the world already has.',
  },
  {
    id: 'coc',
    label: { en: 'Call of Cthulhu', 'zh-CN': '克苏鲁（CoC）', ja: 'クトゥルフ（CoC）', ko: '크툴루의 부름(CoC)' },
    blurb: {
      en: 'Dread and the unknowable. d100 skill checks, lower is better.',
      'zh-CN': '恐惧与不可知。d100 技能检定，越低越好。',
      ja: '恐怖と不可知。d100 技能判定、低いほど良い。',
      ko: '공포와 불가지. d100 기능 판정, 낮을수록 좋다.',
    },
    dice: 'percentile-d100',
    states: {
      player: [
        num('hp', L('Hit points', '体力', '耐久力', '체력'), 10, [0, 10], HEALTH_BANDS(8, 4)),
        num('sanity', L('Sanity', '理智', '正気度', '이성'), 60, [0, 99], [
          b({ min: 50 }, 'Clear-headed', '神志清明', '正気を保っている', '정신이 또렷하다'),
          b({ min: 30 }, 'Uneasy', '心神不宁', '心がざわついている', '마음이 불안하다'),
          b({ min: 1 }, 'On the edge', '濒临崩溃', '崩れかけている', '무너지기 직전이다'),
          b({ max: 0 }, 'Lost to madness', '彻底疯狂', '狂気に呑まれた', '광기에 삼켜졌다'),
        ]),
        // Skill percentages live on the character sheet (README `sheet:`,
        // the design notes), not in declared states.
      ],
      character: [
        enumState('trust', L('Trust', '信任', '信頼', '신뢰'), ['hostile', 'wary', 'open'], 'wary', {
          hostile: L('Hostile to you', '敌视你', 'あなたに敵意を抱いている', '당신에게 적대적이다'),
          wary: L('Still wary of you', '还在提防你', 'まだあなたを警戒している', '아직 당신을 경계한다'),
          open: L('Willing to tell you the truth', '愿意对你说实话', '本当のことを話してくれる', '당신에게 사실을 말해 줄 생각이 있다'),
        }),
      ],
      world: [],
    },
    writer:
      'Rules: Call of Cthulhu. Every check is a d100 roll-under against a skill: declare roll_dice with type "1d100" and ' +
      'expect "<=N", where N is the skill value (40–70; 60 when unsure), and name the skill in desc (Spot Hidden, Library ' +
      'Use, Psychology, Listen, Stealth, Occult…). Lower is better: 1–12 of 60 is an extreme success, 96–100 a fumble. ' +
      'Tone: dread and the unknowable. The investigators are ordinary and fragile, every answer costs more than it ' +
      'explains, and the horror is shown at its edges, never explained in full. Sanity loss is written in prose — ' +
      'trembling hands, lost minutes, a sentence the character cannot finish — never as a number.',
  },
  {
    id: 'dnd',
    label: { en: 'D&D', 'zh-CN': 'DND', ja: 'D&D', ko: 'D&D' },
    blurb: {
      en: 'Adventure and heroics. d20 + modifier against a DC.',
      'zh-CN': '冒险与英雄气。d20 + 调整值 对抗 DC。',
      ja: '冒険と英雄譚。d20 + 修正値で DC に挑む。',
      ko: '모험과 영웅담. d20 + 수정치로 DC에 도전.',
    },
    dice: 'd20-dc',
    states: {
      player: [
        num('hp', L('Hit points', '生命', 'HP', '체력'), 12, [0, 12], HEALTH_BANDS(10, 5, L('Down', '倒地不起', '倒れている', '쓰러져 있다'))),
        // Ability modifiers live on the character sheet (README `sheet:`).
        flagState('inspired', L('Inspired', '激励', 'インスピレーション', '고양'), false, {
          true: L('Something in you burns to act', '你心中燃着一股劲', '胸の内に熱いものが燃えている', '가슴속에서 무언가가 뜨겁게 타오른다'),
        }),
      ],
      character: [],
      world: [
        enumState('alarm', L('Alarm', '警戒', '警戒', '경계'), ['calm', 'alert', 'hunt'], 'calm', {
          calm: L('All is quiet', '四下安静', '辺りは静かだ', '사방이 조용하다'),
          alert: L('The guards are suspicious', '守卫起了疑心', '衛兵が怪しんでいる', '경비병들이 수상히 여긴다'),
          hunt: L('The whole town is hunting you', '全城都在搜你', '町じゅうがあなたを探している', '온 마을이 당신을 찾고 있다'),
        }),
      ],
    },
    writer:
      'Rules: D&D (d20). Every check is a d20 plus an ability modifier against a difficulty class: declare roll_dice with ' +
      'type "1d20+M" (M from +0 to +5 for the relevant ability — STR, DEX, CON, INT, WIS, CHA; +2 when unsure) and expect ' +
      '">=DC" (10 easy, 12–13 moderate, 15 hard, 20 very hard), and name the ability in desc. Higher is better; a natural ' +
      '20 reads as a triumph, a natural 1 as a mishap. Combat and loot are written in prose — the blow, the wound, the ' +
      'weight of the purse — never as hit-point or gold numbers.',
  },
]);

/** Ids accepted from earlier drafts of the theme field. */
const PACK_ALIASES: Readonly<Record<string, string>> = Object.freeze({ cthulhu: 'coc' });

export const rulePackOf = (id: string | undefined): RulePack =>
  RULE_PACKS.find((r) => r.id === (id && PACK_ALIASES[id] ? PACK_ALIASES[id] : id)) ?? RULE_PACKS[0];
// ---------------------------------------------------------------------------
// Structure axis: flags, and named structures that preset them
// ---------------------------------------------------------------------------

export type StructureFlag = 'endings' | 'mysteries' | 'clock' | 'puzzles';
export type StructureFlags = Readonly<Record<StructureFlag, boolean>>;

export interface ThemeStructureFlag {
  id: StructureFlag;
  label: Localized;
  blurb: Localized;
  /** Only meaningful when this other flag is on (`clock` needs `endings`). */
  requires?: StructureFlag;
  /** Writer rules when ON; `writerOff` (if any) when OFF. */
  writer: string;
  writerOff?: string;
}

export const STRUCTURE_FLAGS: readonly ThemeStructureFlag[] = Object.freeze([
  {
    id: 'endings',
    label: { en: 'Has endings', 'zh-CN': '有结局', ja: 'エンディングあり', ko: '엔딩 있음' },
    blurb: {
      en: 'The story can end. Off means a sandbox with no final goal.',
      'zh-CN': '故事会走向结局。关掉就是没有终点的沙盒。',
      ja: '物語に結末がある。オフなら終わりのないサンドボックス。',
      ko: '이야기에 끝이 있다. 끄면 최종 목표가 없는 샌드박스.',
    },
    writer:
      'Endings: this world ends. Early on, settle two or three possible endings for yourself in prose (a workshop world ' +
      'has no ending screen yet), let consequences lean toward them, and when one is reached write it as a final chalk ' +
      'that says plainly the story has ended. After that only conversation remains.',
    writerOff:
      'No ending: this is a sandbox. The world enforces no final goal; keep offering places, people and hooks, and let ' +
      'the player choose their own aims (player/README.md holds what they said they want).',
  },
  {
    id: 'mysteries',
    label: { en: 'Hidden truths', 'zh-CN': '有谜底', ja: '謎の真相あり', ko: '숨은 진상' },
    blurb: {
      en: 'The world hides 3–4 core questions with real answers to uncover.',
      'zh-CN': '世界藏着 3–4 个有真实答案的核心谜题，等你揭开。',
      ja: '世界には答えのある核心の謎が 3〜4 つ隠されている。',
      ko: '세계에 정답이 있는 핵심 수수께끼 3–4개가 숨어 있다.',
    },
    writer:
      'Hidden truths: the world hides three or four core mysteries, kept machine-readable in world.json `mysteries` ' +
      '(WorldMysterySchema — the debrief scores it): [{"id":"kebab-id","question":"…","options":[' +
      '{"id":"a","label":"…","tier":"surface","clues":["world/…/find.md"],"epilogue":"…"},' +
      '{"id":"b","label":"…","tier":"hidden","clues":["player/…/proof.md"],"title":"…","epilogue":"…"},' +
      '{"id":"c","label":"…","tier":"wrong"}],"hint":"…"}] — three or four mysteries, three or four options each: at ' +
      'least one `surface` (the plain truth) and one `wrong`; an optional `hidden` (the deeper truth, with its own ' +
      'evidence and a `title` for its hidden-ending card). Surface and hidden options need `clues` (search finds or ' +
      'items the player gives/carries — a pre-placed item counts only as the carried `player/<name>`) and an `epilogue`. ' +
      'Also add `reckoning: { "epilogues": { "all": "…", "most": "…", "few": "…" } }`. Questions and labels in the world ' +
      'language. Players never see world.json. Keep each option\'s clues current as you place them. Never state an ' +
      'answer outright and never ask the player questions to advance play — the questions come only in the 复盘 after ' +
      'an ending, where a secret counts only when the chosen answer is backed by a clue the player actually found.',
  },
  {
    id: 'clock',
    label: { en: 'Time limit', 'zh-CN': '限时', ja: '制限時間', ko: '제한 시간' },
    blurb: {
      en: 'A deadline runs against the player. Needs endings.',
      'zh-CN': '有截止时间在倒数。需要开启结局。',
      ja: '締め切りが迫る。エンディングが必要。',
      ko: '마감 시간이 다가온다. 엔딩이 필요하다.',
    },
    requires: 'endings',
    writer:
      'Time limit: the story runs against a deadline. State it early in prose, let every significant action cost time, ' +
      'remind the player as it runs short, and when it runs out an ending arrives on its own. Track time in prose; there ' +
      'is no clock meter.',
  },
  {
    id: 'puzzles',
    label: { en: 'Mechanism puzzles', 'zh-CN': '机关谜题', ja: '仕掛けの謎', ko: '장치 퍼즐' },
    blurb: {
      en: 'Progress is gated by locks, codes and devices solved from clues.',
      'zh-CN': '推进靠机关、密码、装置，线索里有解法。',
      ja: '鍵・暗号・装置を手がかりから解いて先へ進む。',
      ko: '자물쇠·암호·장치를 단서로 풀어야 앞으로 나아간다.',
    },
    writer:
      'Puzzles: progress is gated by mechanisms — locks, codes, devices, riddles whose solutions are in the world. Each ' +
      'solution must be discoverable from things the player can find; a wrong attempt costs something (time, noise, a ' +
      'clue) but never makes progress impossible. Use declared choices and door `requires` for the locks.',
  },
]);

export interface ThemeStructure {
  id: string;
  label: Localized;
  blurb: Localized;
  flags: StructureFlags;
}

const flags = (on: StructureFlag[]): StructureFlags =>
  Object.freeze({ endings: on.includes('endings'), mysteries: on.includes('mysteries'), clock: on.includes('clock'), puzzles: on.includes('puzzles') });

/** Named structures: shortcuts that set the flags. */
export const THEME_STRUCTURES: readonly ThemeStructure[] = Object.freeze([
  {
    id: 'investigation',
    label: { en: 'Investigation', 'zh-CN': '探案', ja: '探索・捜査', ko: '수사' },
    blurb: {
      en: 'Uncover the truth before time runs out. Endings, hidden truths, a clock.',
      'zh-CN': '在时限内查明真相。有结局、有谜底、限时。',
      ja: '時間内に真相を暴く。エンディング・謎・制限時間あり。',
      ko: '시간 안에 진상을 밝힌다. 엔딩·숨은 진상·제한 시간.',
    },
    flags: flags(['endings', 'mysteries', 'clock']),
  },
  {
    id: 'semi-sandbox',
    label: { en: 'Semi-sandbox', 'zh-CN': '半沙盒', ja: 'セミサンドボックス', ko: '세미 샌드박스' },
    blurb: {
      en: 'A main line and endings, at your own pace.',
      'zh-CN': '有主线和结局，但不限时，按自己的节奏走。',
      ja: 'メインラインと結末あり、制限時間なし。',
      ko: '메인 줄기와 엔딩이 있고, 시간 제한 없이 내 속도로.',
    },
    flags: flags(['endings', 'mysteries']),
  },
  {
    id: 'sandbox',
    label: { en: 'Sandbox', 'zh-CN': '沙盒', ja: 'サンドボックス', ko: '샌드박스' },
    blurb: {
      en: 'No ending, free exploration. You set your own goals.',
      'zh-CN': '没有结局，自由探索，目标自己定。',
      ja: '結末なし、自由探索。目標は自分で決める。',
      ko: '엔딩 없이 자유 탐험. 목표는 스스로 정한다.',
    },
    flags: flags([]),
  },
  {
    id: 'puzzle',
    label: { en: 'Puzzle', 'zh-CN': '谜题', ja: 'パズル', ko: '퍼즐' },
    blurb: {
      en: 'Mechanisms and riddles drive progress toward an ending.',
      'zh-CN': '靠机关与谜题推进，走向结局。',
      ja: '仕掛けと謎解きで結末へ進む。',
      ko: '장치와 수수께끼를 풀며 엔딩으로 나아간다.',
    },
    flags: flags(['endings', 'puzzles']),
  },
]);
// ---------------------------------------------------------------------------
// World types: the headline choice, each a bundle over the axes above
// ---------------------------------------------------------------------------

/** How much the dice speak in a type. `none` means the writer never declares a check. */
export type DiceUse = 'full' | 'light' | 'rare' | 'none';

export interface WorldType {
  id: string;
  label: Localized;
  blurb: Localized;
  /** Default rule pack; `rulesSelectable` types show the pack picker prominently. */
  rules: string;
  rulesSelectable: boolean;
  dice: DiceUse;
  structure: StructureFlags;
  /** Default declared states per panel, on top of the rule pack's (a same-id type state replaces the pack's). */
  states: StateDefaults;
  /** The writer's rules for this type, in English. Empty for `blank`. */
  writer: string;
  /** Two or three sentences for the first-entry popup: what you do in this kind of world. */
  intro: Localized;
  /** Shipped templates that play like this type (for the doc and the form's hint). */
  examples: readonly string[];
  /**
   * Default world music: a shared `assets/audio` key (`themes/<key>.mp3` or
   * `bgm/<key>.mp3`) that the workshop writes as world.json `audio.theme` when a
   * world is made with this type, so a new world is not silent. The author can
   * change it later. Every key must exist on disk (packages/shared/test/themes.test.mjs).
   */
  audioTheme: string;
  /**
   * A type from before the three categories: still read for
   * worlds that store it — its preset, writer rules and music are unchanged —
   * but the workshop's picker no longer offers it. Its category is in
   * `WORLD_CATEGORIES[].types`.
   */
  legacy?: boolean;
}

export const WORLD_TYPES: readonly WorldType[] = Object.freeze([
  {
    id: 'trpg',
    label: { en: 'Tabletop RPG', 'zh-CN': '类跑团', ja: 'TRPG風', ko: 'TRPG풍' },
    blurb: {
      en: 'A game master runs an investigation or a confrontation; checks, clues, a debrief.',
      'zh-CN': '像有主持人在带团：调查或对抗，检定、线索、复盘。',
      ja: 'GM が導く探索や対決。判定、手がかり、振り返り。',
      ko: '진행자가 이끄는 조사나 대결. 판정, 단서, 복기.',
    },
    rules: 'coc',
    rulesSelectable: true,
    dice: 'full',
    structure: flags(['endings', 'mysteries']),
    states: {
      player: [],
      character: [
        num('wariness', L('Wariness', '戒心', '警戒心', '경계심'), 30, [0, 100], [
          b({ min: 70 }, 'Deeply wary of you', '对你满怀戒备', 'あなたをひどく警戒している', '당신을 몹시 경계한다'),
          b({ min: 40 }, 'Guarded with you', '对你有所提防', 'あなたを警戒している', '당신을 경계한다'),
          b({ min: 15 }, 'A little reserved', '对你还有些保留', '少し距離を置いている', '아직 조금 거리를 둔다'),
          b({}, 'At ease with you', '对你放下了戒心', 'あなたに気を許している', '당신에게 마음을 놓았다'),
        ]),
        num('stance', L('Stance', '立场', '立場', '입장'), 0, [-3, 3], [
          b({ min: 2 }, 'On your side', '站在你这边', 'あなたの味方だ', '당신 편이다'),
          b({ min: 1 }, 'Leaning your way', '倾向于你', 'あなたに傾いている', '당신 쪽으로 기울었다'),
          b({ min: 0 }, 'Undecided', '立场未定', '態度を決めかねている', '아직 정하지 못했다'),
          b({ min: -1 }, 'Unconvinced by you', '对你不以为然', 'あなたに懐疑的だ', '당신을 미덥지 않게 여긴다'),
          b({}, 'Against you', '与你为敌', 'あなたと敵対している', '당신과 적대한다'),
        ]),
      ],
      world: [],
    },
    writer:
      'Type: TRPG. You are the game master of an investigation or a confrontation: every uncertain action is a declared ' +
      'check, clues are earned, NPCs keep their own wariness and stance toward the player and act on it. Keep the ' +
      'scene fair — information the player needs is findable — and when the story closes, write a short debrief of ' +
      'what was found, missed and decided. A run may also be one of a series of instances from a safe hub, each with ' +
      'its own danger and endings; then what carries across is only what the player holds and what they learned.',
    intro: {
      en: 'This world plays like a tabletop session: you investigate or confront, uncertain actions are dice checks, and every clue is earned.',
      'zh-CN': '这个世界像一场跑团：你调查、交涉或对抗，没有把握的行动都要掷骰检定，每条线索都得自己挣来。',
      ja: 'この世界は TRPG のセッションのように進みます。調べ、交渉し、対決し、不確かな行動はダイス判定。手がかりは自分でつかむもの。',
      ko: '이 세계는 TRPG 세션처럼 진행됩니다. 조사하고, 협상하고, 맞서며, 확신이 없는 행동은 주사위로 판정합니다. 단서는 스스로 손에 넣어야 합니다.',
    },
    examples: ['last-train', 'wuwu-tide', 'whitechapel'],
    audioTheme: 'tense',
  },
  {
    id: 'infinite',
    legacy: true,
    label: { en: 'Hub & instances', 'zh-CN': '类无限流', ja: '無限流', ko: '무한류' },
    blurb: {
      en: 'A hub and a series of instances, each with its own endings and rewards.',
      'zh-CN': '一个主神空间 + 一个个副本，副本各有结局与奖励，积分道具可带走。',
      ja: '拠点と連続するインスタンス。各回に結末と報酬、ポイントと道具は持ち越し。',
      ko: '거점과 이어지는 인스턴스. 회차마다 엔딩과 보상, 포인트와 아이템은 가져간다.',
    },
    rules: 'narrative',
    rulesSelectable: true,
    dice: 'full',
    structure: flags(['endings']),
    states: {
      player: [
        // Points are currency the player spends: shown as the number itself.
        num('points', L('Points', '积分', 'ポイント', '포인트'), 0),
        num('injury', L('Injury', '伤势', '負傷', '부상'), 0, [0, 5], [
          b({ max: 0 }, 'Unhurt', '毫发无伤', '無傷', '다친 곳 없음'),
          b({ max: 2 }, 'Hurt', '受了伤', '怪我をしている', '다쳤다'),
          b({ max: 4 }, 'Badly hurt', '伤得很重', '重傷', '크게 다쳤다'),
          b({}, 'Barely alive', '命悬一线', '瀕死', '숨이 간신히 붙어 있다'),
        ]),
      ],
      character: [],
      world: [],
    },
    writer:
      'Type: infinite flow. The world is a hub (a safe place between runs) and a series of instances. Each instance is ' +
      'its own layer subtree with its own premise, danger and two or three endings; clearing one grants points and ' +
      'items that carry back to the hub, where the next instance is offered. Keep instances self-contained; what ' +
      'carries across is only what the player holds and what they learned.',
    intro: {
      en: 'You start in a hub between worlds. Each instance you enter has its own danger and endings; what you earn and carry comes back with you.',
      'zh-CN': '你从一个中转空间出发，每次进入一个副本：副本有自己的危险和结局，挣到的积分和道具会跟你回来。',
      ja: '世界と世界のあいだの拠点から出発します。入るインスタンスごとに危険と結末があり、得たものは持ち帰れます。',
      ko: '세계와 세계 사이의 거점에서 출발합니다. 들어가는 인스턴스마다 저마다의 위험과 엔딩이 있고, 얻은 것은 가지고 돌아옵니다.',
    },
    examples: [],
    audioTheme: 'guixiang',
  },
  {
    id: 'story',
    label: { en: 'Story', 'zh-CN': '类剧情', ja: 'ストーリー', ko: '스토리' },
    blurb: {
      en: 'Authored plot lines and branches; your choices move the story.',
      'zh-CN': '有写好的剧情线和分支，你的选择推动故事。',
      ja: '用意された筋と分岐。選択が物語を動かす。',
      ko: '준비된 줄거리와 분기. 선택이 이야기를 움직인다.',
    },
    rules: 'narrative',
    rulesSelectable: false,
    dice: 'light',
    structure: flags(['endings']),
    states: {
      player: [],
      character: [],
      world: [
        num('progress', L('Plot progress', '剧情进度', '物語の進行', '이야기 진행'), 0, [0, 10], [
          b({ max: 0 }, 'The story has just begun', '故事刚刚开始', '物語は始まったばかり', '이야기가 막 시작되었다'),
          b({ max: 3 }, 'The story is unfolding', '故事徐徐展开', '物語が動き出した', '이야기가 움직이기 시작했다'),
          b({ max: 6 }, 'Deep into the story', '故事渐入佳境', '物語は佳境に入った', '이야기가 무르익었다'),
          b({ max: 9 }, 'Nearing the end', '故事接近尾声', '物語は終わりに近づいている', '이야기가 끝을 향해 간다'),
          b({}, 'The final chapter', '终章', '最終章', '마지막 장'),
        ]),
      ],
    },
    writer:
      'Type: story. The world follows authored plot lines with real branches: move the plot forward scene by scene, let ' +
      'the player\'s choices pick the branch, and keep track of how far the plot has come. Dice are rare — use a check ' +
      'only where chance itself is the drama. When the story is about the people in it, let affection and trust move ' +
      'with what the player says and does, show them through behaviour, and open a character\'s ending only when the ' +
      'relationship has earned it.',
    intro: {
      en: 'This is a story with a plot to follow. Your choices pick the branches, and the branches lead to different endings.',
      'zh-CN': '这是一个有剧情主线的故事。你的选择决定走哪条分支，分支通向不同的结局。',
      ja: '筋のある物語です。選択が分岐を選び、分岐はそれぞれ別の結末へ続きます。',
      ko: '따라갈 줄거리가 있는 이야기입니다. 선택이 분기를 고르고, 분기마다 다른 엔딩으로 이어집니다.',
    },
    examples: ['divergence', 'unwritten-door'],
    audioTheme: 'divergence',
  },
  {
    id: 'free',
    label: { en: 'Free world', 'zh-CN': '自由世界', ja: '自由な世界', ko: '자유 세계' },
    blurb: {
      en: 'No quest and no fixed ending: live in the world, grow, and spend time with its people.',
      'zh-CN': '没有主线、没有固定结局：在世界里生活、成长，和这里的人相处。',
      ja: '目的も決まった結末もない。世界で暮らし、成長し、人々と過ごす。',
      ko: '정해진 목표도 결말도 없다. 세계에서 살고, 성장하고, 사람들과 지낸다.',
    },
    rules: 'narrative',
    rulesSelectable: false,
    dice: 'light',
    structure: flags([]),
    states: {
      player: [],
      character: [
        num('closeness', L('Closeness', '亲近', '親しさ', '친밀도'), 0, [0, 10], [
          b({ min: 8 }, 'Inseparable', '亲密无间', 'かけがえのない仲', '둘도 없는 사이'),
          b({ min: 5 }, 'Close', '很亲近', '親しい', '가깝다'),
          b({ min: 2 }, 'Getting to know you', '渐渐熟络', '打ち解けてきた', '조금씩 친해지고 있다'),
          b({}, 'Just met', '刚刚认识', '知り合ったばかり', '막 알게 됐다'),
        ]),
      ],
      world: [],
    },
    writer:
      'Type: free world. There is no quest and no fixed ending: the player lives here. Let time pass in prose (keep a ' +
      'calendar when the world has days or terms, and fire events on dates), let what the player practises grow, and ' +
      'let the characters remember the player and have moods and a relationship with them that you describe only in ' +
      'prose. Checks are light — only for performances, tests or real risk — and do not call search unless the player ' +
      'asks to search something. Small, daily moments matter as much as big ones.',
    intro: {
      en: 'Nothing needs to be solved here. Live in this world at your own pace: grow, wander, and spend time with the people here; they will remember you.',
      'zh-CN': '这里没有非解决不可的事。按自己的节奏在这个世界里生活：成长、闲逛、和这里的人相处，他们会记得你。',
      ja: 'ここには解くべきものはありません。自分のペースでこの世界に暮らし、成長し、歩き回り、人々と過ごしてください。彼らはあなたを覚えています。',
      ko: '여기에는 꼭 풀어야 할 것이 없습니다. 내 속도로 이 세계에서 살아가세요. 성장하고, 돌아다니고, 이곳 사람들과 시간을 보내면 그들은 당신을 기억합니다.',
    },
    examples: ['mandongbu', 'fpal'],
    audioTheme: 'calm',
  },
  {
    id: 'galgame',
    legacy: true,
    label: { en: 'Dating sim', 'zh-CN': '类Galgame', ja: 'ギャルゲー風', ko: '미연시풍' },
    blurb: {
      en: 'Relationships first: one route per character, each with its own ending.',
      'zh-CN': '关系为主：每个角色一条路线，各有结局。',
      ja: '関係性が主役。キャラごとのルートと結末。',
      ko: '관계가 주인공. 캐릭터마다 루트와 엔딩.',
    },
    rules: 'narrative',
    rulesSelectable: false,
    dice: 'rare',
    structure: flags(['endings']),
    states: {
      player: [],
      character: [
        num('affection', L('Affection', '好感', '好感度', '호감도'), 0, [0, 100], [
          b({ min: 80 }, 'Cares for you deeply', '深深在意你', 'あなたを深く想っている', '당신을 깊이 아낀다'),
          b({ min: 50 }, 'Fond of you', '对你有好感', 'あなたに好意を抱いている', '당신에게 호감이 있다'),
          b({ min: 20 }, 'Warming to you', '开始留意你', 'あなたが気になり始めている', '당신이 신경 쓰이기 시작했다'),
          b({}, 'Barely knows you', '和你还不熟', 'まだあなたをよく知らない', '아직 당신을 잘 모른다'),
        ]),
        num('trust', L('Trust', '信任', '信頼', '신뢰'), 0, [0, 100], [
          b({ min: 80 }, 'Trusts you completely', '毫无保留地信任你', 'あなたを心から信頼している', '당신을 온전히 믿는다'),
          b({ min: 50 }, 'Trusts you', '信任你', 'あなたを信頼している', '당신을 믿는다'),
          b({ min: 20 }, 'Beginning to trust you', '开始信任你', 'あなたを信じ始めている', '당신을 믿기 시작했다'),
          b({}, 'Does not trust you yet', '还不信任你', 'まだあなたを信用していない', '아직 당신을 믿지 않는다'),
        ]),
      ],
      world: [],
    },
    writer:
      'Type: galgame. The heart of the world is the player\'s relationships: each main character has a route of their ' +
      'own and an ending at its close. Let affection and trust move with what the player says and does, show them ' +
      'through the characters\' behaviour, and open a route\'s ending only when the relationship has earned it. Dice ' +
      'almost never.',
    intro: {
      en: 'This world is about the people in it. Get close to someone and their route opens; each route ends in its own way.',
      'zh-CN': '这个世界讲的是人和人之间。和谁走得近，谁的路线就会打开；每条路线都有自己的结局。',
      ja: 'この世界の主役は人との関係です。誰かと親しくなるとその人のルートが開き、ルートごとに結末があります。',
      ko: '이 세계의 주인공은 사람 사이의 관계입니다. 누군가와 가까워지면 그 사람의 루트가 열리고, 루트마다 엔딩이 있습니다.',
    },
    examples: ['moonlit-contract'],
    audioTheme: 'calm',
  },
  {
    id: 'sim',
    legacy: true,
    label: { en: 'Life sim', 'zh-CN': '类模拟/养成', ja: 'シミュレーション・育成', ko: '시뮬레이션·육성' },
    blurb: {
      en: 'A schedule, growth and time-driven events; wrap up per term or season.',
      'zh-CN': '日程、成长、随时间发生的事件；按学期或季节收束。',
      ja: '予定、成長、時間で起きるイベント。学期や季節ごとに区切り。',
      ko: '일정, 성장, 시간에 따라 일어나는 사건. 학기나 계절마다 정리.',
    },
    rules: 'narrative',
    rulesSelectable: false,
    dice: 'light',
    structure: flags([]),
    states: {
      player: [
        num('skill', L('Skill', '能力', '能力', '실력'), 1, [0, 10], [
          b({ min: 9 }, 'Masterful', '炉火纯青', '達人の域', '경지에 올랐다'),
          b({ min: 6 }, 'Accomplished', '得心应手', '腕が上がった', '손에 익었다'),
          b({ min: 3 }, 'Getting the hang of it', '小有所成', 'だいぶ慣れてきた', '제법 익숙해졌다'),
          b({ min: 1 }, 'A beginner', '初窥门径', '駆け出し', '초보'),
          b({}, 'Untrained', '一窍不通', 'まったくの素人', '완전 초짜'),
        ]),
        num('stamina', L('Stamina', '体力', 'スタミナ', '기력'), 5, [0, 10], [
          b({ min: 8 }, 'Full of energy', '精力充沛', '元気いっぱい', '기운이 넘친다'),
          b({ min: 4 }, 'Holding up', '还撑得住', 'まだ大丈夫', '아직 버틸 만하다'),
          b({ min: 1 }, 'Worn out', '疲惫不堪', 'くたくた', '녹초가 됐다'),
          b({}, 'Exhausted', '筋疲力尽', '力尽きている', '기진맥진했다'),
        ]),
      ],
      character: [],
      // The calendar is a plain count the player reads ("Day 3").
      world: [num('day', L('Day', '天数', '日数', '일차'), 1)],
    },
    writer:
      'Type: sim / raising. Time drives the world: keep a calendar in prose, let the player plan how each day is spent, ' +
      'let practice grow their abilities, and fire events on dates. Wrap up at the end of each term or season with a ' +
      'short summary of what grew and what changed. Checks are light and only for performances and tests.',
    intro: {
      en: 'Days pass here. Plan how you spend them, grow what you practice, and see where each term or season leaves you.',
      'zh-CN': '这里的日子一天天过去。安排怎么度过每一天，练什么长什么，看每个学期或季节结束时你走到了哪里。',
      ja: 'ここでは日々が過ぎていきます。一日の使い方を決め、鍛えたものが伸び、学期や季節の終わりに成果が見えます。',
      ko: '이곳에서는 하루하루가 흘러갑니다. 하루를 어떻게 보낼지 정하고, 연습한 만큼 성장하며, 학기나 계절이 끝날 때 어디에 와 있는지 확인하세요.',
    },
    examples: ['mandongbu'],
    audioTheme: 'mandongbu',
  },
  {
    id: 'companion',
    legacy: true,
    label: { en: 'Companion life', 'zh-CN': '生活陪伴', ja: '暮らしと寄り添い', ko: '함께하는 일상' },
    blurb: {
      en: 'Living alongside the characters. No dice, no ending.',
      'zh-CN': '和角色们一起生活。没有骰子，没有结局。',
      ja: 'キャラクターと共に暮らす。ダイスも結末もなし。',
      ko: '캐릭터와 함께 살아간다. 주사위도 엔딩도 없다.',
    },
    rules: 'narrative',
    rulesSelectable: false,
    dice: 'none',
    structure: flags([]),
    states: {
      player: [],
      character: [
        num('mood', L('Mood', '心情', '気分', '기분'), 0, [-2, 2], [
          b({ min: 2 }, 'In high spirits', '心情很好', '上機嫌', '기분이 아주 좋다'),
          b({ min: 1 }, 'In a good mood', '心情不错', '機嫌がいい', '기분이 좋다'),
          b({ min: 0 }, 'Calm', '心情平静', '落ち着いている', '차분하다'),
          b({ min: -1 }, 'A little down', '有些低落', '少し沈んでいる', '조금 가라앉았다'),
          b({}, 'Gloomy', '闷闷不乐', 'ふさぎ込んでいる', '울적하다'),
        ]),
        num('closeness', L('Closeness', '亲近', '親しさ', '친밀도'), 0, [0, 10], [
          b({ min: 8 }, 'Inseparable', '亲密无间', 'かけがえのない仲', '둘도 없는 사이'),
          b({ min: 5 }, 'Close', '很亲近', '親しい', '가깝다'),
          b({ min: 2 }, 'Getting to know you', '渐渐熟络', '打ち解けてきた', '조금씩 친해지고 있다'),
          b({}, 'Just met', '刚刚认识', '知り合ったばかり', '막 알게 됐다'),
        ]),
      ],
      world: [],
    },
    writer:
      'Type: companion life. There is no quest and no ending: the characters live here, remember the player, and have ' +
      'moods and a relationship with them that you describe only in prose. Never declare a dice check, and do not call ' +
      'search unless the player explicitly asks to search something. Small, daily, warm moments matter most.',
    intro: {
      en: 'Nothing needs to be solved here. Spend time with the people who live in this world; they will remember you.',
      'zh-CN': '这里没有要解决的事。和住在这里的人一起过日子，他们会记得你。',
      ja: 'ここには解くべきものはありません。この世界に暮らす人たちと過ごしてください。彼らはあなたを覚えています。',
      ko: '여기에는 풀어야 할 것이 없습니다. 이 세계에 사는 사람들과 시간을 보내세요. 그들은 당신을 기억할 겁니다.',
    },
    examples: ['first-snow', 'fpal'],
    audioTheme: 'calm',
  },
  {
    id: 'blank',
    legacy: true,
    label: { en: 'Blank (custom)', 'zh-CN': '空白（自定义）', ja: '空白（カスタム）', ko: '빈 세계(사용자 설정)' },
    blurb: {
      en: 'No presets: you set everything up before publishing.',
      'zh-CN': '什么都不预设，发布前由你自己配置。',
      ja: '何も既定しない。公開前にすべて自分で設定。',
      ko: '아무것도 미리 정하지 않는다. 공개 전에 모두 직접 설정.',
    },
    rules: 'narrative',
    rulesSelectable: false,
    dice: 'full',
    structure: flags([]),
    states: NO_STATES,
    writer: '',
    intro: {
      en: 'This world starts blank: what it becomes is up to you and the Writer.',
      'zh-CN': '这个世界从一张白纸开始：它会变成什么，由你和作家决定。',
      ja: 'この世界は白紙から始まります。どうなるかはあなたと作家次第です。',
      ko: '이 세계는 백지에서 시작합니다. 무엇이 될지는 당신과 작가에게 달려 있습니다.',
    },
    examples: [],
    audioTheme: 'calm',
  },
]);

export const worldTypeOf = (id: string | undefined): WorldType | null => WORLD_TYPES.find((t) => t.id === id) ?? null;

// ---------------------------------------------------------------------------
// World categories (the lobby filter and the workshop picker)
// ---------------------------------------------------------------------------

/**
 * The three kinds of world a player chooses between
 * — the ONE table for the lobby's filter chips, its
 * explanation strip, the tile / intro-card badge and the workshop's 「新建世界」
 * picker. `type` is the world type the picker writes; `types` are every type
 * filed under the category (the older seven fold in, so a world that stores
 * one still lands in the right place). Official worlds name theirs in
 * world.json `intro.category`; a workshop world's comes from its `theme.type`.
 * 「实验」 is a separate flag (`intro.experimental`), not a category.
 */
export interface WorldCategory {
  id: string;
  label: Localized;
  /** One line for the lobby's strip and the intro card: what playing this kind of world is like. */
  line: Localized;
  type: string;
  types: readonly string[];
}

export const WORLD_CATEGORY_IDS = ['trpg', 'story', 'free'] as const;
export type WorldCategoryId = (typeof WORLD_CATEGORY_IDS)[number];

export const WORLD_CATEGORIES: readonly WorldCategory[] = Object.freeze([
  {
    id: 'trpg',
    label: { en: 'Tabletop worlds', 'zh-CN': '跑团世界', ja: 'TRPGの世界', ko: 'TRPG 세계' },
    line: {
      en: 'A case to crack: dice checks, clues, a clock and several endings.',
      'zh-CN': '破一桩案子：掷骰检定、找线索、和时间赛跑，走向不同结局。',
      ja: '事件を解く：ダイス判定、手がかり、時間制限、複数の結末。',
      ko: '사건을 푼다: 주사위 판정, 단서, 시간 제한, 여러 결말.',
    },
    type: 'trpg',
    types: ['trpg', 'infinite'],
  },
  {
    id: 'story',
    label: { en: 'Story worlds', 'zh-CN': '剧情世界', ja: '物語の世界', ko: '스토리 세계' },
    line: {
      en: 'A story driven by people: relationships, choices and turning points in time.',
      'zh-CN': '由人推动的故事：关系、选择，和改变时间的转折。',
      ja: '人が動かす物語：関係、選択、そして時間の分岐点。',
      ko: '사람이 움직이는 이야기: 관계, 선택, 그리고 시간의 갈림길.',
    },
    type: 'story',
    types: ['story', 'galgame'],
  },
  {
    id: 'free',
    label: { en: 'Free worlds', 'zh-CN': '自由世界', ja: '自由な世界', ko: '자유 세계' },
    line: {
      en: 'No fixed goal: live there, grow, and spend time with the people.',
      'zh-CN': '没有固定目标：在那里生活、成长，和人们相处。',
      ja: '決まった目的はない：そこで暮らし、成長し、人々と過ごす。',
      ko: '정해진 목표 없이: 그곳에서 살고, 성장하고, 사람들과 지낸다.',
    },
    type: 'free',
    types: ['free', 'sim', 'companion', 'blank'],
  },
]);

export const worldCategoryOf = (id: string | null | undefined): WorldCategory | null => WORLD_CATEGORIES.find((c) => c.id === id) ?? null;

/** The category a world type is filed under (old types included), or null for none / unknown. */
export const categoryOfType = (typeId: string | null | undefined): WorldCategory | null =>
  (typeId ? WORLD_CATEGORIES.find((c) => c.types.includes(typeId)) : undefined) ?? null;

/**
 * A world's category: the author's `intro.category` when it names one, else
 * the one its `theme.type` falls under; null when neither says.
 */
export function worldCategoryIdOf(manifest: { intro?: unknown; theme?: unknown } | null | undefined): WorldCategoryId | null {
  const intro = manifest?.intro as { category?: unknown } | undefined;
  const own = typeof intro?.category === 'string' ? worldCategoryOf(intro.category) : null;
  const theme = manifest?.theme as { type?: unknown } | undefined;
  const found = own ?? categoryOfType(typeof theme?.type === 'string' ? theme.type : null);
  return (found?.id as WorldCategoryId | undefined) ?? null;
}

/**
 * May a PLAYER (not the author in authoring mode) put world facts on the canvas
 * — a new scene, an NPC, a clue, a chalk line — straight from the right-click
 * radial? Free and story worlds:
 * yes, that is part of playing them. TRPG worlds: no — a player-made clue or
 * NPC breaks the case and the dice; there the radial carries the player's own
 * tools (便签 / 线索板) and creation stays with authoring mode. A world with no
 * category plays as free.
 */
export function playersMayCreate(category: WorldCategoryId | null | undefined): boolean {
  return category !== 'trpg';
}

/** Single player only for now; multiplayer is shown on the form as coming soon. */
export const PLAYER_MODES = ['single', 'multi'] as const;
export type PlayerMode = (typeof PLAYER_MODES)[number];
export const AVAILABLE_PLAYER_MODES: readonly PlayerMode[] = ['single'];

// ---------------------------------------------------------------------------
// The stored theme (world.json `theme`)
// ---------------------------------------------------------------------------

/** What world.json stores. The flags and `rules` are the truth; `type` names the bundle they came from. */
export interface WorldTheme {
  players: PlayerMode;
  /** A `WORLD_TYPES` id; absent in a theme written before types existed. */
  type?: string;
  rules: string;
  structure: StructureFlags;
}

export const DEFAULT_THEME: WorldTheme = Object.freeze({ players: 'single', rules: 'narrative', structure: flags([]) });

export const themeStructureOf = (id: string | undefined): ThemeStructure | null =>
  THEME_STRUCTURES.find((s) => s.id === id) ?? null;

/** Enforce `requires`: a flag whose prerequisite is off is off. */
export function normalizeFlags(raw: Partial<Record<StructureFlag, unknown>> | null | undefined): StructureFlags {
  const out: Record<StructureFlag, boolean> = { endings: false, mysteries: false, clock: false, puzzles: false };
  for (const flag of STRUCTURE_FLAGS) out[flag.id] = raw?.[flag.id] === true;
  for (const flag of STRUCTURE_FLAGS) if (flag.requires && !out[flag.requires]) out[flag.id] = false;
  return Object.freeze(out);
}

/** A type → the theme it presets (the form starts here, then the author edits). */
export function themeFromType(id: string): WorldTheme | null {
  const type = worldTypeOf(id);
  if (!type) return null;
  return { players: 'single', type: type.id, rules: type.rules, structure: type.structure };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Validate a theme from a request body or world.json. Returns null when absent;
 * throws a plain Error with a readable message when present but malformed.
 * A `type` alone expands to its preset; `rules` / `structure` override it.
 * `structure` may be flags or a named structure id.
 */
export function parseTheme(raw: unknown): WorldTheme | null {
  if (raw === undefined || raw === null) return null;
  if (!isRecord(raw)) throw new Error('theme must be an object');
  const players = raw.players === undefined ? 'single' : raw.players;
  if (!(PLAYER_MODES as readonly unknown[]).includes(players)) throw new Error(`theme.players must be one of ${PLAYER_MODES.join(', ')}`);
  if (!(AVAILABLE_PLAYER_MODES as readonly unknown[]).includes(players)) throw new Error('Multiplayer worlds are not available yet.');
  const typeId = typeof raw.type === 'string' && raw.type ? raw.type : undefined;
  if (typeId && !worldTypeOf(typeId)) throw new Error(`theme.type "${typeId}" is not a known world type`);
  const base = typeId ? themeFromType(typeId) : null;
  const rawRules = raw.rules === undefined ? base?.rules ?? 'narrative' : raw.rules;
  const rulesId = typeof rawRules === 'string' ? (PACK_ALIASES[rawRules] ?? rawRules) : '';
  if (!RULE_PACKS.some((r) => r.id === rulesId)) throw new Error(`theme.rules must be one of ${RULE_PACKS.map((r) => r.id).join(', ')}`);
  let structure: StructureFlags;
  if (raw.structure === undefined) {
    structure = base?.structure ?? DEFAULT_THEME.structure;
  } else if (typeof raw.structure === 'string') {
    const named = themeStructureOf(raw.structure);
    if (!named) throw new Error(`theme.structure "${raw.structure}" is not a known structure`);
    structure = named.flags;
  } else if (isRecord(raw.structure)) {
    for (const [key, value] of Object.entries(raw.structure)) {
      if (!STRUCTURE_FLAGS.some((f) => f.id === key)) throw new Error(`theme.structure.${key} is not a known flag`);
      if (typeof value !== 'boolean') throw new Error(`theme.structure.${key} must be true or false`);
    }
    structure = normalizeFlags(raw.structure as Partial<Record<StructureFlag, unknown>>);
  } else {
    throw new Error('theme.structure must be flags or a structure id');
  }
  return { players: players as PlayerMode, ...(typeId ? { type: typeId } : {}), rules: rulesId, structure };
}

/** Fail-soft read for runtime consumers: a malformed or absent theme is the default. */
export function resolveTheme(raw: unknown): WorldTheme {
  try {
    return parseTheme(raw) ?? DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/** world.json `mode` from the flags: no endings → open; endings → semi; endings + clock → closed. */
export function modeOfTheme(theme: WorldTheme): 'open' | 'semi' | 'closed' {
  if (!theme.structure.endings) return 'open';
  return theme.structure.clock ? 'closed' : 'semi';
}

/** The named structure whose flags match exactly, or null for a custom mix. */
export function structureNameOf(flagsIn: StructureFlags): ThemeStructure | null {
  return THEME_STRUCTURES.find((s) => STRUCTURE_FLAGS.every((f) => s.flags[f.id] === flagsIn[f.id])) ?? null;
}

/** The dice convention a world's searches and checks use. */
/**
 * The character-skill rules a theme implies:
 * a coc / dnd rule pack on a type that rolls dice. coc sanity is on (the pack
 * declares a sanity state). Null for narrative packs and dice-free types.
 */
export function themeSkillRules(raw: unknown): { system: 'coc' | 'dnd'; sanity?: boolean; characterChecks: boolean } | null {
  const theme = resolveTheme(raw);
  const pack = rulePackOf(theme.rules);
  if (pack.id !== 'coc' && pack.id !== 'dnd') return null;
  if ((worldTypeOf(theme.type)?.dice ?? 'full') === 'none') return null;
  return pack.id === 'coc' ? { system: 'coc', sanity: true, characterChecks: true } : { system: 'dnd', characterChecks: true };
}

export function diceConventionForTheme(raw: unknown): DiceConvention {
  return DICE_CONVENTIONS[rulePackOf(resolveTheme(raw).rules).dice] ?? DEFAULT_DICE_CONVENTION;
}

/** Pack states then type states; a type state with the same id replaces the pack's (the type is more specific). */
const mergeTemplates = (pack: readonly StateTemplate[], type: readonly StateTemplate[]): StateTemplate[] =>
  [...pack.filter((p) => !type.some((t) => t.id === p.id)), ...type];

/**
 * The declared-state defaults a theme brings: its rule pack's (unless the type
 * uses no dice), then its type's. A `blank` type brings none.
 */
export function stateDefaultsOf(raw: unknown): StateDefaults {
  const theme = resolveTheme(raw);
  const type = worldTypeOf(theme.type);
  if (type?.id === 'blank') return NO_STATES;
  const pack = rulePackOf(theme.rules);
  const usesDice = (type?.dice ?? 'full') !== 'none';
  const scope = (key: keyof StateDefaults) => mergeTemplates(usesDice ? pack.states[key] : [], type?.states[key] ?? []);
  return { player: scope('player'), character: scope('character'), world: scope('world') };
}

/** A world locale → the theme language (anything unknown is English). */
export const themeLocaleOf = (raw: unknown): ThemeLocale => (raw === 'zh-CN' || raw === 'ja' || raw === 'ko' ? raw : 'en');

/**
 * The theme's default states as `StateDecl`s in the world's language, ready for
 * README frontmatter `states:` (player/README.md, world/README.md, and each
 * characters/<id>/README.md). Every entry passes `StateDeclSchema`.
 */
export function themeStateDecls(raw: unknown, locale: unknown): ThemeStateDecls {
  const defaults = stateDefaultsOf(raw);
  const lang = themeLocaleOf(locale);
  return { player: localizeAll(defaults.player, lang), character: localizeAll(defaults.character, lang), world: localizeAll(defaults.world, lang) };
}

/** One rule pack's states in one language (rules/states.ts example packs are these in zh-CN). */
export function rulePackStateDecls(id: string, locale: ThemeLocale): ThemeStateDecls {
  const pack = rulePackOf(id);
  return { player: localizeAll(pack.states.player, locale), character: localizeAll(pack.states.character, locale), world: localizeAll(pack.states.world, locale) };
}

/**
 * Merge default states into a README frontmatter's `states:` by id: existing
 * entries (and their order) are kept untouched, defaults whose id is not yet
 * declared are appended. Returns the new list, or null when nothing changes.
 */
export function mergeStateDecls(existing: unknown, defaults: readonly ThemeStateDecl[]): unknown[] | null {
  const current = Array.isArray(existing) ? existing : [];
  const ids = new Set(current.map((s) => (isRecord(s) && typeof s.id === 'string' ? s.id : '')));
  const added = defaults.filter((d) => !ids.has(d.id));
  if (!added.length) return null;
  if (existing !== undefined && existing !== null && !Array.isArray(existing)) return null; // malformed: leave it for the author
  return [...current, ...added];
}

// ---------------------------------------------------------------------------
// The writer's view
// ---------------------------------------------------------------------------

const DICE_USE_WRITER: Record<DiceUse, string> = {
  full: '',
  light: 'Dice are light in this world: declare a check only when failure would be interesting.',
  rare: 'Dice are rare in this world: almost never declare a check.',
  none: 'No dice in this world: never declare roll_dice.',
};

/** "TRPG · Call of Cthulhu · Investigation" — for logs and the writer block. */
export function themeTitle(theme: WorldTheme, locale: ThemeLocale = 'en'): string {
  const type = worldTypeOf(theme.type);
  const structure = structureNameOf(theme.structure);
  const custom: Localized = { en: 'Custom structure', 'zh-CN': '自定义结构', ja: 'カスタム構成', ko: '사용자 구성' };
  const usesDice = (type?.dice ?? 'full') !== 'none';
  return [type?.label[locale], usesDice ? rulePackOf(theme.rules).label[locale] : null, (structure?.label ?? custom)[locale]]
    .filter(Boolean)
    .join(' · ');
}

/**
 * The per-turn theme block for the writer. Empty for a world with no `theme`
 * (today's worlds keep exactly the context they had). `mysteriesSeeded` says
 * whether world.json already lists `mysteries`, so the first turn is told to seed them.
 */
export function themeWriterBlock(raw: unknown, opts: { mysteriesSeeded?: boolean } = {}): string {
  if (raw === undefined || raw === null) return '';
  const theme = resolveTheme(raw);
  const type = worldTypeOf(theme.type);
  const dice = diceConventionForTheme(theme);
  const diceUse = type?.dice ?? 'full';
  const lines = [`[World Theme] ${themeTitle(theme)} (mode ${modeOfTheme(theme)}).`];
  if (type?.writer) lines.push(type.writer);
  if (diceUse !== 'none') {
    lines.push(rulePackOf(theme.rules).writer);
    lines.push(`Improvised searches use this world's dice: ${dice.type}, expect "${dice.expect}" (the search tool sets them; you only write the four bands).`);
  }
  if (DICE_USE_WRITER[diceUse]) lines.push(DICE_USE_WRITER[diceUse]);
  for (const flag of STRUCTURE_FLAGS) {
    const on = theme.structure[flag.id];
    if (on) lines.push(flag.writer);
    else if (flag.writerOff && !flag.requires) lines.push(flag.writerOff);
  }
  if (theme.structure.mysteries) {
    lines.push(opts.mysteriesSeeded
      ? 'world.json already lists its mysteries: keep their clues lists current and never reveal an answer outright.'
      : 'world.json has no `mysteries` yet: add them this turn with edit (keep every other key of world.json intact), before narrating.');
  }
  lines.push('Declared states (health, sanity, wariness…) live in README frontmatter `states:` and the panels say them through their `shown_as` prose: never write them as numbers either, describe them in prose. What the player wants is in player/README.md.');
  return lines.join('\n');
}

/** The note appended to the workshop building brief: build the world to fit its theme. */
export function themeBuildingNote(raw: unknown): string {
  if (raw === undefined || raw === null) return '';
  const theme = resolveTheme(raw);
  const type = worldTypeOf(theme.type);
  const dice = diceConventionForTheme(theme);
  const parts = [`- Theme: ${themeTitle(theme)}.${type?.writer ? ` ${type.writer}` : ''}`];
  if ((type?.dice ?? 'full') !== 'none') {
    parts.push(`- Declared checks and search: spots use ${dice.type} with expect "${dice.expect}" and the four bands ${dice.bands.map((b) => `${b.min}–${b.max}`).join(' / ')}.`);
  }
  const states = stateDefaultsOf(theme);
  if (states.player.length || states.world.length || states.character.length) {
    parts.push('- Declared states: the theme\'s default `states:` are already in player/README.md and world/README.md frontmatter, and create_char declares the character ones on each new character. Keep them (edit labels or bands if the world needs), and let triggers and consequences move them; the panels say them as prose.');
  }
  if (theme.structure.endings) parts.push('- Endings: settle two or three endings in prose inside the entry scene README body (an author-only paragraph is fine); no ending UI is authored yet.');
  if (theme.structure.mysteries) parts.push('- Hidden truths: add world.json `mysteries` (three or four, the shape the theme rules give) and place every clue they list.');
  if (theme.structure.puzzles) parts.push('- Puzzles: gate two or three places behind mechanisms whose solutions are findable in the world.');
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// The first-entry intro popup (deterministic: registry + the world's own lines)
// ---------------------------------------------------------------------------

const localeOf = themeLocaleOf;

const ENDING_COPY: Record<'clock' | 'endings' | 'open', Localized> = {
  clock: {
    en: 'It ends: reach an ending before the time runs out.',
    'zh-CN': '故事会结束：要在时限之内走到一个结局。',
    ja: '物語には終わりがあります。時間切れになる前に結末へ。',
    ko: '이야기에는 끝이 있습니다. 시간이 다 되기 전에 엔딩에 도달하세요.',
  },
  endings: {
    en: 'It ends: your choices lead to one of several endings, at your own pace.',
    'zh-CN': '故事会结束：你的选择会通向几个结局之一，不限时。',
    ja: '物語には終わりがあります。選択がいくつかの結末のどれかへ導きます。時間制限はありません。',
    ko: '이야기에는 끝이 있습니다. 선택이 여러 엔딩 중 하나로 이끕니다. 시간 제한은 없습니다.',
  },
  open: {
    en: 'It does not end: there is no set goal — decide what you want here.',
    'zh-CN': '故事不会结束：没有既定目标，你想做什么由你决定。',
    ja: '物語に終わりはありません。決まった目標はなく、何をするかはあなた次第です。',
    ko: '이야기에 끝은 없습니다. 정해진 목표가 없으니, 무엇을 할지는 당신이 정하세요.',
  },
};

const FLAG_COPY: Partial<Record<StructureFlag, Localized>> = {
  mysteries: {
    en: 'The world hides three or four core truths. Clues point at them; at the end you will be asked what you uncovered.',
    'zh-CN': '世界藏着三四个核心谜底。线索会指向它们；结尾时会问你揭开了多少。',
    ja: '世界には 3〜4 つの核心の真相が隠されています。手がかりを集めれば、最後にどこまで暴けたかを問われます。',
    ko: '세계에는 핵심 진상이 서너 개 숨어 있습니다. 단서를 모으면, 마지막에 어디까지 밝혀냈는지 묻습니다.',
  },
  puzzles: {
    en: 'Some ways forward are locked behind mechanisms; their solutions are somewhere in the world.',
    'zh-CN': '有些路被机关锁住，解法就藏在这个世界的某处。',
    ja: 'いくつかの道は仕掛けで閉ざされています。解き方は世界のどこかにあります。',
    ko: '어떤 길은 장치로 잠겨 있습니다. 푸는 법은 세계 어딘가에 있습니다.',
  },
};

const NO_DICE_COPY: Localized = {
  en: 'There are no dice here: what happens follows from what you say and do.',
  'zh-CN': '这里不掷骰：发生什么，取决于你说了什么、做了什么。',
  ja: 'ここにダイスはありません。起きることは、あなたの言葉と行動しだいです。',
  ko: '여기에는 주사위가 없습니다. 무슨 일이 일어날지는 당신의 말과 행동에 달려 있습니다.',
};

const HOW_COPY: Localized = {
  en: 'Say what you do; searching a place rolls the dice, and what you find comes after the roll.',
  'zh-CN': '说出你要做什么；搜查某处会掷骰，找到的东西在掷骰之后才出现。',
  ja: 'やりたいことを伝えてください。探索するとダイスを振り、見つかる物は振った後に現れます。',
  ko: '하고 싶은 일을 말하세요. 어딘가를 수색하면 주사위를 굴리고, 찾은 물건은 굴린 뒤에 나타납니다.',
};

export interface WorldIntro {
  title: string;
  /** Type · rules · structure, e.g. "类跑团 · 克苏鲁（CoC） · 探案". */
  kicker: string;
  lines: string[];
}

/** The intro popup's text for a world. Pure and deterministic. */
export function worldIntroOf(input: { name?: string; description?: string; locale?: unknown; theme?: unknown }): WorldIntro {
  const locale = localeOf(input.locale);
  const theme = resolveTheme(input.theme);
  const type = worldTypeOf(theme.type);
  const usesDice = (type?.dice ?? 'full') !== 'none';
  const ending = !theme.structure.endings ? ENDING_COPY.open : theme.structure.clock ? ENDING_COPY.clock : ENDING_COPY.endings;
  const lines = [
    ...(input.description?.trim() ? [input.description.trim()] : []),
    ...(type ? [type.intro[locale]] : []),
    ending[locale],
    ...STRUCTURE_FLAGS.flatMap((f) => (theme.structure[f.id] && FLAG_COPY[f.id] ? [FLAG_COPY[f.id]![locale]] : [])),
    ...(usesDice ? [diceConventionForTheme(theme).summary[locale], HOW_COPY[locale]] : [NO_DICE_COPY[locale]]),
  ];
  return { title: input.name?.trim() || '', kicker: themeTitle(theme, locale), lines };
}

/** The setup fields the intro asks for; stored in player/README.md frontmatter. */
export const WORLD_INTRO_FIELDS = ['identity', 'goal', 'first'] as const;
export type WorldIntroField = (typeof WORLD_INTRO_FIELDS)[number];
