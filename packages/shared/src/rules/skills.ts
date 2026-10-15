/**
 * Character skills and skill checks.
 *
 * A world picks ONE rule system in world.json `rules` — `coc` (d100 roll-under
 * a skill %, hard ½ / extreme ⅕, criticals and fumbles) or `dnd` (d20 + an
 * ability modifier + proficiency against a DC, advantage / disadvantage). The
 * protagonist's sheet lives in `player/README.md` frontmatter `sheet:`, a
 * companion's in `characters/<id>/README.md`. A skill check is an ordinary
 * dice chalk with a `skill_check:` block; this module decides its dice from the
 * sheet and, once rolled, its tier and its GRADE — the same four grades
 * (great / success / setback / failure) every search table already uses, so
 * declared outcomes, hidden hp and world commands plug in unchanged.
 *
 * Zero dependencies and no I/O on purpose (like `rules/dice.ts` and
 * `rules/themes.ts`): the web bundle imports it for the character sheet's
 * previews through `@airp/shared/skills`.
 */

export type SkillSystem = 'coc' | 'dnd';
export const SKILL_SYSTEMS: readonly SkillSystem[] = ['coc', 'dnd'];
export type SkillLocale = 'en' | 'zh-CN' | 'ja' | 'ko';
export type SkillLocalized = Readonly<Record<SkillLocale, string>>;

const L = (en: string, zh: string, ja: string, ko: string): SkillLocalized => ({ en, 'zh-CN': zh, ja, ko });

export const skillLocaleOf = (raw: unknown): SkillLocale => (raw === 'zh-CN' || raw === 'ja' || raw === 'ko' ? raw : 'en');

// ---------------------------------------------------------------------------
// World rules
// ---------------------------------------------------------------------------

export interface WorldRules {
  system: SkillSystem;
  /** coc only: sanity checks against `player.sanity` are available. */
  sanity: boolean;
  /** Companions / core characters may roll for their own actions. */
  characterChecks: boolean;
  /** dnd only: the proficiency bonus (default 2). */
  proficiency: number;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The world's rules, fail-soft: world.json `rules` first; a workshop world that
 * only has `theme.rules` (coc / dnd) derives the same system. Anything else —
 * no rules, `narrative`, a malformed block — is null: today's behaviour.
 */
export function worldRulesOf(manifest: unknown): WorldRules | null {
  if (!isRecord(manifest)) return null;
  const raw = manifest.rules;
  let system: unknown;
  let block: Record<string, unknown> = {};
  if (isRecord(raw)) {
    system = raw.system;
    block = raw;
  } else if (isRecord(manifest.theme)) {
    const pack = manifest.theme.rules === 'cthulhu' ? 'coc' : manifest.theme.rules;
    system = pack;
  }
  if (system !== 'coc' && system !== 'dnd') return null;
  const proficiency = typeof block.proficiency === 'number' && Number.isInteger(block.proficiency) && block.proficiency >= 0 && block.proficiency <= 10 ? block.proficiency : 2;
  return {
    system,
    sanity: system === 'coc' && block.sanity === true,
    characterChecks: block.characterChecks !== false,
    proficiency,
  };
}

// ---------------------------------------------------------------------------
// Catalogs: abilities and standard skills, in every theme language
// ---------------------------------------------------------------------------

export type Ability = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';
export const ABILITIES: readonly Ability[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
export const ABILITY_LABELS: Readonly<Record<Ability, SkillLocalized>> = {
  str: L('STR', '力量', '筋力', '근력'),
  dex: L('DEX', '敏捷', '敏捷力', '민첩'),
  con: L('CON', '体质', '耐久力', '건강'),
  int: L('INT', '智力', '知力', '지능'),
  wis: L('WIS', '感知', '判断力', '지혜'),
  cha: L('CHA', '魅力', '魅力', '매력'),
};

export interface CatalogSkill {
  id: string;
  label: SkillLocalized;
  /** dnd only: the governing ability. */
  ability?: Ability;
}

const c = (id: string, label: SkillLocalized): CatalogSkill => ({ id, label });
const d = (id: string, ability: Ability, label: SkillLocalized): CatalogSkill => ({ id, ability, label });

/** CoC-style skills (percentages). `sanity` is the pseudo-skill of a sanity check. */
export const COC_SKILLS: readonly CatalogSkill[] = [
  c('spot_hidden', L('Spot Hidden', '侦查', '目星', '관찰력')),
  c('listen', L('Listen', '聆听', '聞き耳', '듣기')),
  c('library_use', L('Library Use', '图书馆使用', '図書館', '자료조사')),
  c('psychology', L('Psychology', '心理学', '心理学', '심리학')),
  c('persuade', L('Persuade', '说服', '説得', '설득')),
  c('fast_talk', L('Fast Talk', '话术', '言いくるめ', '말재주')),
  c('charm', L('Charm', '魅惑', '魅惑', '매혹')),
  c('intimidate', L('Intimidate', '恐吓', '威圧', '위협')),
  c('stealth', L('Stealth', '潜行', '隠密', '은밀행동')),
  c('climb', L('Climb', '攀爬', '登攀', '오르기')),
  c('jump', L('Jump', '跳跃', '跳躍', '도약')),
  c('dodge', L('Dodge', '闪避', '回避', '회피')),
  c('first_aid', L('First Aid', '急救', '応急手当', '응급처치')),
  c('medicine', L('Medicine', '医学', '医学', '의학')),
  c('occult', L('Occult', '神秘学', 'オカルト', '오컬트')),
  c('mechanical_repair', L('Mechanical Repair', '机械维修', '機械修理', '기계수리')),
  c('electrical_repair', L('Electrical Repair', '电气维修', '電気修理', '전기수리')),
  c('navigate', L('Navigate', '导航', 'ナビゲート', '항법')),
  c('science', L('Science', '科学', '科学', '과학')),
  c('disguise', L('Disguise', '乔装', '変装', '변장')),
  c('fighting', L('Fighting', '格斗', '近接戦闘', '근접전')),
  c('firearms', L('Firearms', '射击', '射撃', '사격')),
  c('locksmith', L('Locksmith', '锁匠', '鍵開け', '자물쇠 따기')),
  c('history', L('History', '历史', '歴史', '역사')),
  c('art_craft', L('Art/Craft', '技艺', '芸術・製作', '예술·공예')),
  c('language_other', L('Language (Other)', '外语', 'ほかの言語', '외국어')),
  c('natural_world', L('Natural World', '博物学', '博物学', '박물학')),
  c('sleight_of_hand', L('Sleight of Hand', '妙手', '手さばき', '손재주')),
  c('luck', L('Luck', '幸运', '幸運', '행운')),
  c('sanity', L('Sanity', '理智', '正気度', '이성')),
];

/** D&D-style skills and their abilities. */
export const DND_SKILLS: readonly CatalogSkill[] = [
  d('acrobatics', 'dex', L('Acrobatics', '杂技', '軽業', '곡예')),
  d('animal_handling', 'wis', L('Animal Handling', '驯兽', '動物使い', '동물 조련')),
  d('arcana', 'int', L('Arcana', '奥秘', '魔法学', '비전학')),
  d('athletics', 'str', L('Athletics', '运动', '運動', '운동')),
  d('deception', 'cha', L('Deception', '欺瞒', 'ペテン', '기만')),
  d('history', 'int', L('History', '历史', '歴史', '역사')),
  d('insight', 'wis', L('Insight', '洞悉', '看破', '통찰')),
  d('intimidation', 'cha', L('Intimidation', '威吓', '威圧', '위협')),
  d('investigation', 'int', L('Investigation', '调查', '捜査', '수사')),
  d('medicine', 'wis', L('Medicine', '医药', '医術', '의학')),
  d('nature', 'int', L('Nature', '自然', '自然', '자연')),
  d('perception', 'wis', L('Perception', '察觉', '知覚', '감지')),
  d('performance', 'cha', L('Performance', '表演', '芸能', '공연')),
  d('persuasion', 'cha', L('Persuasion', '游说', '説得', '설득')),
  d('religion', 'int', L('Religion', '宗教', '宗教', '종교')),
  d('sleight_of_hand', 'dex', L('Sleight of Hand', '巧手', '手先の早業', '손재주')),
  d('stealth', 'dex', L('Stealth', '隐匿', '隠密', '은신')),
  d('survival', 'wis', L('Survival', '求生', '生存', '생존')),
];

/**
 * What a standard skill is FOR, in one short line: the character
 * sheet shows it under the name when the sheet's own `desc` is absent, so a player can see what each
 * number buys. Shared ids (history, medicine, stealth, sleight_of_hand) mean the same thing in both systems.
 */
export const SKILL_USES: Readonly<Record<string, SkillLocalized>> = {
  spot_hidden: L('Notice what is hidden or out of place', '发现藏着的、不对劲的东西', '隠れたもの・おかしな点に気づく', '숨겨진 것, 이상한 점을 알아챈다'),
  listen: L('Catch sounds and voices — a breath, a step, a whisper', '听见声音和动静——呼吸、脚步、低语', '音や気配を聞き取る——息づかい、足音、ささやき', '소리와 기척을 듣는다 — 숨소리, 발소리, 속삭임'),
  library_use: L('Find it in papers, records, ledgers and books', '在文件、档案、账本和书里找到要找的', '書類・記録・帳簿・本から目当てを探し出す', '서류, 기록, 장부, 책에서 원하는 것을 찾는다'),
  psychology: L('Read a person: lies, fear, what they hold back', '看人：谎话、害怕、没说出口的事', '人を読む：嘘、怯え、言わずにいること', '사람을 읽는다: 거짓말, 두려움, 숨기는 것'),
  persuade: L('Talk someone round with reasons and time', '用道理和耐心说动一个人', '理屈と時間をかけて人を説き伏せる', '이치와 시간으로 사람을 설득한다'),
  fast_talk: L('Bluff past someone quickly', '三言两语把人糊弄过去', '口先でさっと人をごまかす', '말재주로 재빨리 넘어간다'),
  charm: L('Win someone over by liking', '让人对你有好感、愿意帮你', '好意で相手を味方につける', '호감으로 상대를 내 편으로 만든다'),
  intimidate: L('Make someone back down', '让人退让、害怕', '相手を怯ませて引かせる', '상대를 겁줘 물러서게 한다'),
  stealth: L('Move or act without being noticed', '不被发现地行动', '気づかれずに動く', '들키지 않고 움직인다'),
  climb: L('Climb walls, roofs, cars', '攀爬墙、屋顶、车厢', '壁・屋根・車両をよじ登る', '벽, 지붕, 차량을 오른다'),
  jump: L('Leap gaps and land safely', '跳过空隙、安全落地', '隙間を跳び越え、無事に着地する', '틈을 뛰어넘고 안전하게 착지한다'),
  dodge: L('Get out of harm’s way', '躲开危险', '危険をかわす', '위험을 피한다'),
  first_aid: L('Patch a wound on the spot', '当场处理伤口', 'その場で傷の手当てをする', '그 자리에서 상처를 처치한다'),
  medicine: L('Know illness, drugs and the body', '懂病、药和身体', '病気・薬・身体についての知識', '병, 약, 몸에 대해 안다'),
  occult: L('Know rites, charms and old beliefs; sense what is not natural', '懂仪式、符咒和旧信仰；察觉不自然的东西', '儀式・まじない・古い信仰の知識。尋常でないものを察する', '의식, 부적, 옛 믿음을 안다. 자연스럽지 않은 것을 감지한다'),
  mechanical_repair: L('Open, fix or jam machines', '修理、拆开或卡住机械', '機械を開ける・直す・止める', '기계를 열고 고치거나 멈춘다'),
  electrical_repair: L('Fix or rewire electrical things', '修电器、接线', '電気製品を直す・配線する', '전기 장치를 고치고 배선한다'),
  navigate: L('Find the way; never get lost', '认路、不迷路', '道を見つけ、迷わない', '길을 찾고 헤매지 않는다'),
  science: L('Apply a science to what you find', '用学科知识分析发现的东西', '見つけたものを科学の知識で調べる', '찾은 것을 과학 지식으로 분석한다'),
  disguise: L('Pass as someone else', '扮成别人', '別人になりすます', '다른 사람으로 변장한다'),
  fighting: L('Hold your own hand to hand', '近身扭打', '取っ組み合いで渡り合う', '맨손으로 맞붙는다'),
  firearms: L('Shoot straight', '开枪射击', '銃を撃つ', '총을 쏜다'),
  locksmith: L('Open locks without the key', '不用钥匙开锁', '鍵なしで錠を開ける', '열쇠 없이 자물쇠를 연다'),
  history: L('Know what happened here before', '知道这里从前发生过什么', 'ここで以前何があったかを知る', '이곳에서 예전에 무슨 일이 있었는지 안다'),
  art_craft: L('Make or judge a craft', '做或鉴别手艺活', '工芸を作る・見極める', '공예품을 만들거나 감정한다'),
  language_other: L('Read and speak another language', '读写说一门外语', 'ほかの言語を読み書きし話す', '다른 언어를 읽고 말한다'),
  natural_world: L('Know plants, animals, weather', '懂植物、动物、天气', '植物・動物・天気がわかる', '식물, 동물, 날씨를 안다'),
  sleight_of_hand: L('Take, palm or slip things unseen', '神不知鬼不觉地拿、藏、放东西', '気づかれずに物を取る・隠す・忍ばせる', '들키지 않고 물건을 집고 숨기고 넣는다'),
  luck: L('Chance is on your side', '运气站在你这边', '運が味方する', '운이 내 편이다'),
  acrobatics: L('Balance, tumble, land on your feet', '平衡、翻滚、稳稳落地', 'バランスを取り、転がり、着地する', '균형을 잡고 구르고 착지한다'),
  animal_handling: L('Calm or steer an animal', '安抚或驾驭动物', '動物をなだめ、扱う', '동물을 진정시키고 다룬다'),
  arcana: L('Know spells, sigils and magical things', '懂法术、符印和魔法造物', '呪文・紋章・魔法の品の知識', '주문, 인장, 마법 물품을 안다'),
  athletics: L('Climb, swim, push, hold on', '攀爬、游泳、推撞、抓牢', '登る・泳ぐ・押す・しがみつく', '오르고 헤엄치고 밀고 버틴다'),
  deception: L('Lie convincingly', '把谎说圆', 'もっともらしく嘘をつく', '그럴듯하게 거짓말한다'),
  insight: L('Read a person’s intent', '看穿一个人的意图', '人の意図を見抜く', '사람의 의도를 꿰뚫어 본다'),
  intimidation: L('Make someone back down', '让人退让、害怕', '相手を怯ませて引かせる', '상대를 겁줘 물러서게 한다'),
  investigation: L('Work out how it fits together from clues', '从线索里推出来龙去脉', '手がかりから筋道を導く', '단서에서 앞뒤를 추론한다'),
  nature: L('Know plants, beasts and land', '懂草木、野兽和地形', '草木・獣・地形がわかる', '초목, 짐승, 지형을 안다'),
  perception: L('Notice what is hidden or out of place', '发现藏着的、不对劲的东西', '隠れたもの・おかしな点に気づく', '숨겨진 것, 이상한 점을 알아챈다'),
  performance: L('Hold a crowd', '吸引一群人的注意', '人前で見せて引きつける', '사람들의 이목을 끈다'),
  persuasion: L('Talk someone round', '说动一个人', '人を説き伏せる', '사람을 설득한다'),
  religion: L('Know gods, rites and holy places', '懂神祇、仪式和圣地', '神々・儀式・聖地の知識', '신, 의식, 성지를 안다'),
  survival: L('Track, forage, find the way outdoors', '追踪、觅食、野外认路', '追跡し、食料を探し、野外で道を見つける', '추적하고 먹을 것을 찾고 야외에서 길을 찾는다'),
};

/** The line under a skill on the sheet: the sheet's own `desc`, else the catalog's, else nothing. */
export function skillUseOf(id: string, desc: string | undefined, locale: unknown): string | undefined {
  if (desc) return desc;
  return SKILL_USES[id]?.[skillLocaleOf(locale)];
}

export function catalogOf(system: SkillSystem): readonly CatalogSkill[] {
  return system === 'coc' ? COC_SKILLS : DND_SKILLS;
}

export function catalogSkill(system: SkillSystem, id: string): CatalogSkill | null {
  return catalogOf(system).find((s) => s.id === id) ?? null;
}

// ---------------------------------------------------------------------------
// Sheets
// ---------------------------------------------------------------------------

export const SKILL_ID_RE = /^[a-z][a-z0-9_]{0,31}$/;
export const MAX_SHEET_SKILLS = 16;

export interface SheetSkill {
  id: string;
  label: string;
  desc?: string;
  /** coc: the percentage, 1..99. */
  value?: number;
  /** dnd: the governing ability. */
  ability?: Ability;
  proficient?: boolean;
  expertise?: boolean;
  /**
   * A companion's specialty: while this character follows the
   * player (or stands on the player's page), it rolls this skill FOR the player when it is better at it —
   * the player's own check cards and the engine's passive checks alike.
   */
  assist?: boolean;
}

export interface CharacterSheet {
  /** dnd only: ability modifiers, -5..+10. */
  abilities?: Partial<Record<Ability, number>>;
  skills: SheetSkill[];
}

export interface SheetParse {
  sheet: CharacterSheet | null;
  errors: string[];
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/**
 * Read `frontmatter.sheet` for a system, fail-soft: a bad skill is dropped with
 * a message, the rest still parse. No `sheet:` at all → `{ sheet: null }`.
 */
export function parseSheet(frontmatter: Record<string, unknown> | null | undefined, system: SkillSystem, locale: unknown = 'en'): SheetParse {
  const raw = frontmatter?.sheet;
  if (raw === undefined || raw === null) return { sheet: null, errors: [] };
  if (!isRecord(raw)) return { sheet: null, errors: ['sheet must be a mapping'] };
  const errors: string[] = [];
  const lang = skillLocaleOf(locale);
  const sheet: CharacterSheet = { skills: [] };
  if (system === 'dnd') {
    const abilities: Partial<Record<Ability, number>> = {};
    if (raw.abilities !== undefined && !isRecord(raw.abilities)) errors.push('sheet.abilities must be a mapping of str/dex/con/int/wis/cha to modifiers');
    if (isRecord(raw.abilities)) {
      for (const [k, v] of Object.entries(raw.abilities)) {
        if (!(ABILITIES as readonly string[]).includes(k)) { errors.push(`sheet.abilities.${k} is not an ability (str, dex, con, int, wis, cha)`); continue; }
        if (!isInt(v) || v < -5 || v > 10) { errors.push(`sheet.abilities.${k} must be an integer modifier from -5 to +10`); continue; }
        abilities[k as Ability] = v;
      }
    }
    sheet.abilities = abilities;
  } else if (raw.abilities !== undefined) {
    errors.push('sheet.abilities is for a D&D-style world; a CoC-style sheet lists skill percentages');
  }
  const list = raw.skills;
  if (list !== undefined && !Array.isArray(list)) errors.push('sheet.skills must be a list');
  const seen = new Set<string>();
  (Array.isArray(list) ? list : []).forEach((entry, i) => {
    const where = `sheet.skills[${i}]`;
    if (!isRecord(entry)) return void errors.push(`${where} must be a mapping`);
    const id = entry.id;
    if (typeof id !== 'string' || !SKILL_ID_RE.test(id)) return void errors.push(`${where}.id must be lowercase ASCII letters, digits and "_"`);
    if (id === 'sanity') return void errors.push(`${where}: sanity is not a sheet skill; it is the player's sanity state`);
    if (seen.has(id)) return void errors.push(`${where}.id "${id}" is declared twice`);
    if (seen.size >= MAX_SHEET_SKILLS) return void errors.push(`${where}: a sheet lists at most ${MAX_SHEET_SKILLS} skills`);
    const catalog = catalogSkill(system, id);
    const label = typeof entry.label === 'string' && entry.label.trim() ? entry.label.trim().slice(0, 40) : catalog?.label[lang];
    if (!label) return void errors.push(`${where} "${id}" is not a standard skill, so it needs a label`);
    const skill: SheetSkill = { id, label };
    if (typeof entry.desc === 'string' && entry.desc.trim()) skill.desc = entry.desc.trim().slice(0, 120);
    if (entry.assist !== undefined && typeof entry.assist !== 'boolean') errors.push(`${where} "${id}": assist is true or false`);
    if (entry.assist === true) skill.assist = true;
    if (system === 'coc') {
      if (!isInt(entry.value) || entry.value < 1 || entry.value > 99) return void errors.push(`${where} "${id}": value must be a percentage from 1 to 99`);
      skill.value = entry.value;
      if (entry.ability !== undefined || entry.proficient !== undefined || entry.expertise !== undefined) errors.push(`${where} "${id}": ability / proficient / expertise are D&D-style fields`);
    } else {
      const ability = entry.ability ?? catalog?.ability;
      if (typeof ability !== 'string' || !(ABILITIES as readonly string[]).includes(ability)) return void errors.push(`${where} "${id}": ability must be one of str, dex, con, int, wis, cha`);
      skill.ability = ability as Ability;
      if (entry.proficient !== undefined && typeof entry.proficient !== 'boolean') errors.push(`${where} "${id}": proficient is true or false`);
      if (entry.expertise !== undefined && typeof entry.expertise !== 'boolean') errors.push(`${where} "${id}": expertise is true or false`);
      if (entry.proficient === true) skill.proficient = true;
      if (entry.expertise === true) skill.expertise = true;
      if (entry.value !== undefined) errors.push(`${where} "${id}": value is a CoC-style percentage; a D&D-style skill takes ability and proficient`);
    }
    seen.add(id);
    sheet.skills.push(skill);
  });
  return { sheet, errors };
}

/** dnd: a skill's modifier = ability modifier + proficiency (doubled with expertise). */
export function dndSkillModifier(sheet: CharacterSheet, skill: SheetSkill, proficiency: number): number {
  const base = skill.ability ? sheet.abilities?.[skill.ability] ?? 0 : 0;
  return base + (skill.expertise ? 2 * proficiency : skill.proficient ? proficiency : 0);
}

// ---------------------------------------------------------------------------
// Difficulty, dice and resolution
// ---------------------------------------------------------------------------

export type CocDifficulty = 'regular' | 'hard' | 'extreme';
export const COC_DIFFICULTIES: readonly CocDifficulty[] = ['regular', 'hard', 'extreme'];
/** Named DCs (D&D 5e-ish, with the registry's 12 as the everyday default). */
export const DND_DCS: Readonly<Record<string, number>> = { very_easy: 5, easy: 10, moderate: 12, hard: 15, very_hard: 20, nearly_impossible: 25 };
export const DEFAULT_DND_DC = 12;
export type Advantage = 'advantage' | 'disadvantage' | 'none';

export type CheckGrade = 'failure' | 'setback' | 'success' | 'great';
export const GRADE_RANK: Readonly<Record<CheckGrade, number>> = { failure: 1, setback: 2, success: 3, great: 4 };
export type CocTier = 'critical' | 'extreme' | 'hard' | 'regular' | 'failure' | 'fumble';
export type DndTier = 'critical' | 'success' | 'failure' | 'fumble';
export type CheckTier = CocTier | DndTier;

/** What a check needs before the roll: the dice, the pass condition, the number the player sees. */
export interface CheckSpec {
  system: SkillSystem;
  /** `roll_dice.type`: `1d100` or `1d20±M`. */
  type: string;
  /** `roll_dice.expect`: `<=T` or `>=DC`. */
  expect: string;
  /** coc: the number to roll under; dnd: the DC. */
  target: number;
  /** coc: the full skill %; dnd: the modifier. */
  value: number;
  /** coc: regular / hard / extreme; dnd: the DC as a string. */
  difficulty: string;
  advantage: Advantage;
}

export function parseCocDifficulty(raw: unknown): CocDifficulty {
  return raw === 'hard' || raw === 'extreme' ? raw : 'regular';
}

/** A DC from a number (1..40) or a name; anything else is the default 12. */
export function parseDndDc(raw: unknown): number {
  if (isInt(raw) && raw >= 1 && raw <= 40) return raw;
  if (typeof raw === 'string') {
    if (/^\d+$/.test(raw.trim())) return parseDndDc(Number(raw.trim()));
    const named = DND_DCS[raw.trim()];
    if (named !== undefined) return named;
  }
  return DEFAULT_DND_DC;
}

export function cocTarget(value: number, difficulty: CocDifficulty): number {
  const t = difficulty === 'extreme' ? Math.floor(value / 5) : difficulty === 'hard' ? Math.floor(value / 2) : value;
  return Math.max(1, t);
}

const dndType = (mod: number): string => (mod === 0 ? '1d20' : mod > 0 ? `1d20+${mod}` : `1d20${mod}`);

/** The check a coc skill % or a dnd modifier makes at this difficulty. */
export function checkSpec(input: { system: SkillSystem; value: number; difficulty?: unknown; advantage?: unknown }): CheckSpec {
  const advantage: Advantage = input.system === 'dnd' && (input.advantage === 'advantage' || input.advantage === 'disadvantage') ? input.advantage : 'none';
  if (input.system === 'coc') {
    const difficulty = parseCocDifficulty(input.difficulty);
    const value = Math.max(1, Math.min(99, Math.round(input.value)));
    const target = cocTarget(value, difficulty);
    return { system: 'coc', type: '1d100', expect: `<=${target}`, target, value, difficulty, advantage };
  }
  const dc = parseDndDc(input.difficulty);
  const value = Math.round(input.value);
  return { system: 'dnd', type: dndType(value), expect: `>=${dc}`, target: dc, value, difficulty: String(dc), advantage };
}

export interface CheckOutcome {
  /** The kept die face (d100 or d20). */
  natural: number;
  /** natural + modifier (coc: = natural). */
  total: number;
  passed: boolean;
  tier: CheckTier;
  grade: CheckGrade;
  rank: number;
  crit: boolean;
  fumble: boolean;
}

/**
 * Resolve a rolled check. coc: `natural` is the d100 face; 01 is a critical,
 * ≤⅕ extreme, ≤½ hard, ≤ value regular; 96–100 is always a fumble (the
 * simplified "CoC-like" rule the official worlds' 5% severe failure already
 * uses). dnd: `natural` is the kept d20; a natural 20 always passes, a natural
 * 1 always fails.
 */
export function resolveCheck(spec: CheckSpec, natural: number): CheckOutcome {
  if (spec.system === 'coc') {
    const v = spec.value;
    const r = natural;
    let tier: CocTier;
    if (r === 1) tier = 'critical';
    else if (r >= 96) tier = 'fumble';
    else if (r <= Math.max(1, Math.floor(v / 5))) tier = 'extreme';
    else if (r <= Math.max(1, Math.floor(v / 2))) tier = 'hard';
    else if (r <= v) tier = 'regular';
    else tier = 'failure';
    const need: Record<CocDifficulty, CocTier[]> = {
      regular: ['critical', 'extreme', 'hard', 'regular'],
      hard: ['critical', 'extreme', 'hard'],
      extreme: ['critical', 'extreme'],
    };
    const difficulty = parseCocDifficulty(spec.difficulty);
    const passed = need[difficulty].includes(tier);
    const grade: CheckGrade = tier === 'fumble'
      ? 'failure'
      : !passed
        ? 'setback'
        : tier === 'critical' || (tier === 'extreme' && difficulty !== 'extreme')
          ? 'great'
          : 'success';
    return { natural: r, total: r, passed, tier, grade, rank: GRADE_RANK[grade], crit: tier === 'critical' || grade === 'great', fumble: tier === 'fumble' };
  }
  const total = natural + spec.value;
  const dc = spec.target;
  const tier: DndTier = natural === 20 ? 'critical' : natural === 1 ? 'fumble' : total >= dc ? 'success' : 'failure';
  const passed = tier === 'critical' || tier === 'success';
  const grade: CheckGrade = tier === 'critical' || (passed && total >= dc + 10)
    ? 'great'
    : tier === 'fumble' || total <= dc - 10
      ? 'failure'
      : passed ? 'success' : 'setback';
  return { natural, total, passed, tier, grade, rank: GRADE_RANK[grade], crit: tier === 'critical', fumble: tier === 'fumble' };
}

/**
 * Roll a check with `rng` (0 ≤ x < 1). dnd advantage keeps the higher of two
 * d20s, disadvantage the lower; `rolls` lists every die thrown.
 */
export function rollCheck(spec: CheckSpec, rng: () => number = Math.random): CheckOutcome & { rolls: number[] } {
  const faces = spec.system === 'coc' ? 100 : 20;
  const die = () => Math.min(faces, Math.floor(rng() * faces) + 1);
  const first = die();
  if (spec.system === 'dnd' && spec.advantage !== 'none') {
    const second = die();
    const kept = spec.advantage === 'advantage' ? Math.max(first, second) : Math.min(first, second);
    return { ...resolveCheck(spec, kept), rolls: [first, second] };
  }
  return { ...resolveCheck(spec, first), rolls: [first] };
}

/**
 * The natural face a forced TOTAL means (god / tests force totals, like
 * `roll_dice`'s `forcedResult`): coc → the same number; dnd → total − modifier,
 * clamped to a die face.
 */
export function naturalOfTotal(spec: CheckSpec, total: number): number {
  if (spec.system === 'coc') return Math.max(1, Math.min(100, total));
  return Math.max(1, Math.min(20, total - spec.value));
}

/** Which grade each of a four-band `dice_outcomes` table stands for, in declared order. */
export const BAND_GRADES_ASCENDING: Readonly<Record<'high' | 'low', readonly CheckGrade[]>> = {
  /** Higher is better (2d10, d20): failure, setback, success, great. */
  high: ['failure', 'setback', 'success', 'great'],
  /** Roll-under (d100): great, success, setback, failure. */
  low: ['great', 'success', 'setback', 'failure'],
};

// ---------------------------------------------------------------------------
// Player-facing words
// ---------------------------------------------------------------------------

export const SYSTEM_LABELS: Readonly<Record<SkillSystem, SkillLocalized>> = {
  coc: L('CoC-like · d100 under your skill', '类 CoC · d100 低于技能值', 'CoC 風 · d100 で技能値以下', 'CoC 풍 · d100으로 기능 수치 이하'),
  dnd: L('D&D-like · d20 + modifier vs DC', '类 D&D · d20 + 调整值 对 DC', 'D&D 風 · d20 + 修正値 対 DC', 'D&D 풍 · d20 + 수정치 대 DC'),
};

export const TIER_LABELS: Readonly<Record<SkillSystem, Readonly<Record<string, SkillLocalized>>>> = {
  coc: {
    critical: L('Critical success', '大成功', 'クリティカル', '대성공'),
    extreme: L('Extreme success', '极难成功', 'イクストリーム成功', '극단적 성공'),
    hard: L('Hard success', '困难成功', 'ハード成功', '어려운 성공'),
    regular: L('Success', '成功', 'レギュラー成功', '성공'),
    failure: L('Failure', '失败', '失敗', '실패'),
    fumble: L('Fumble', '大失败', 'ファンブル', '대실패'),
  },
  dnd: {
    critical: L('Natural 20', '天然 20', 'クリティカル（出目 20）', '내추럴 20'),
    success: L('Success', '成功', '成功', '성공'),
    failure: L('Failure', '失败', '失敗', '실패'),
    fumble: L('Natural 1', '天然 1', 'ファンブル（出目 1）', '내추럴 1'),
  },
};

export const DIFFICULTY_LABELS: Readonly<Record<CocDifficulty, SkillLocalized>> = {
  regular: L('Regular', '普通', 'レギュラー', '보통'),
  hard: L('Hard', '困难', 'ハード', '어려움'),
  extreme: L('Extreme', '极难', 'イクストリーム', '극단적'),
};

export function tierLabel(system: SkillSystem, tier: string, locale: unknown): string {
  return TIER_LABELS[system][tier]?.[skillLocaleOf(locale)] ?? tier;
}

/** "Spot Hidden 60%" / "Arcana +5 · DC 15" — the line a check card shows instead of "Requires: <=60". */
export function checkLine(spec: Pick<CheckSpec, 'system' | 'target' | 'value' | 'difficulty' | 'advantage'>, label: string, locale: unknown): string {
  const lang = skillLocaleOf(locale);
  if (spec.system === 'coc') {
    const diff = parseCocDifficulty(spec.difficulty);
    return diff === 'regular' ? `${label} ${spec.target}%` : `${label} ${spec.target}% (${DIFFICULTY_LABELS[diff][lang]})`;
  }
  const mod = spec.value >= 0 ? `+${spec.value}` : String(spec.value);
  const adv = spec.advantage === 'advantage'
    ? L(' · advantage', ' · 优势', ' · 有利', ' · 이점')[lang]
    : spec.advantage === 'disadvantage' ? L(' · disadvantage', ' · 劣势', ' · 不利', ' · 불리')[lang] : '';
  return `${label} ${mod} · DC ${spec.target}${adv}`;
}

// ---------------------------------------------------------------------------
// Default sheets (the workshop writes these for a new TRPG world)
// ---------------------------------------------------------------------------

export type SheetRole = 'player' | 'character';

const DEFAULT_COC: Record<SheetRole, Array<[string, number]>> = {
  player: [['spot_hidden', 60], ['listen', 50], ['library_use', 50], ['psychology', 45], ['persuade', 45], ['stealth', 40], ['dodge', 40], ['first_aid', 40], ['occult', 15]],
  character: [['spot_hidden', 50], ['listen', 50], ['psychology', 40], ['persuade', 40], ['first_aid', 40], ['fighting', 45]],
};
const DEFAULT_DND: Record<SheetRole, { abilities: Record<Ability, number>; skills: Array<[string, boolean]> }> = {
  player: { abilities: { str: 0, dex: 2, con: 1, int: 1, wis: 1, cha: 2 }, skills: [['perception', true], ['investigation', true], ['persuasion', true], ['stealth', false], ['athletics', false], ['insight', false], ['arcana', false]] },
  character: { abilities: { str: 2, dex: 1, con: 2, int: 0, wis: 1, cha: 0 }, skills: [['athletics', true], ['perception', true], ['intimidation', true], ['insight', false]] },
};

/** A plain YAML-ready default sheet in the world's language. */
export function defaultSheet(system: SkillSystem, role: SheetRole, locale: unknown): Record<string, unknown> {
  const lang = skillLocaleOf(locale);
  if (system === 'coc') {
    return { skills: DEFAULT_COC[role].map(([id, value]) => ({ id, label: catalogSkill('coc', id)!.label[lang], value })) };
  }
  const preset = DEFAULT_DND[role];
  return {
    abilities: { ...preset.abilities },
    skills: preset.skills.map(([id, proficient]) => {
      const s = catalogSkill('dnd', id)!;
      return { id, label: s.label[lang], ability: s.ability, ...(proficient ? { proficient: true } : {}) };
    }),
  };
}

// ---------------------------------------------------------------------------
// The writer's view
// ---------------------------------------------------------------------------

function sheetLine(name: string, sheet: CharacterSheet, rules: WorldRules): string {
  const lends = (s: SheetSkill) => (s.assist ? ' (lends to the player while along)' : '');
  if (rules.system === 'coc') return `${name}: ${sheet.skills.map((s) => `${s.label} [${s.id}] ${s.value}%${lends(s)}`).join(', ')}`;
  const abil = ABILITIES.map((a) => `${a.toUpperCase()} ${(sheet.abilities?.[a] ?? 0) >= 0 ? '+' : ''}${sheet.abilities?.[a] ?? 0}`).join(' ');
  const skills = sheet.skills.map((s) => {
    const m = dndSkillModifier(sheet, s, rules.proficiency);
    return `${s.label} [${s.id}] ${m >= 0 ? '+' : ''}${m}${lends(s)}`;
  });
  return `${name}: ${abil}; ${skills.join(', ')}`;
}

/** The `[Character Sheets]` block at the end of the writer's state; '' when the world has no rules. */
export function sheetsWriterBlock(rules: WorldRules | null, player: CharacterSheet | null, characters: ReadonlyArray<{ id: string; name: string; sheet: CharacterSheet }>): string {
  if (!rules) return '';
  const lines = ['[Character Sheets]'];
  lines.push(rules.system === 'coc'
    ? 'Rules: CoC-like. A check is d100 under the skill %: regular = the skill, hard = half, extreme = a fifth. 01 is a critical, 96–100 a fumble.' + (rules.sanity ? ' Sanity checks use skill "sanity" (the player’s current sanity) with sanity { pass, fail } losses.' : '')
    : `Rules: D&D-like. A check is d20 + the skill modifier against a DC (easy 10, moderate 12, hard 15, very hard 20); proficiency +${rules.proficiency}; advantage / disadvantage roll two d20s. A natural 20 always succeeds, a natural 1 always fails.`);
  if (player) lines.push(sheetLine('Protagonist', player, rules));
  for (const c of characters) lines.push(sheetLine(`${c.name} (${c.id})`, c.sheet, rules));
  lines.push(
    'When the protagonist attempts something uncertain, call skill_check with the fitting skill id and a difficulty you can justify, then stop: the player rolls. ' +
      'Never decide such an outcome in prose, never roll for the player, and narrate only from the resolved tier.' +
      (rules.characterChecks ? ' A character with a sheet may roll for its own action with skill_check actor "self" (a character process) or actor "<id>" (the writer, for an NPC).' : ''),
  );
  if (characters.some((c) => c.sheet.skills.some((s) => s.assist))) {
    lines.push('A skill marked "lends" is rolled with that companion’s number while they are with the player (the engine decides; the check card names them). Passive checks and the player’s inspiration roll land as story events: never repeat, contradict or extend what they said.');
  }
  return lines.join('\n');
}
