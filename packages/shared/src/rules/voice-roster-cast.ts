/**
 * Voice casting against worldlines-play's voice roster (the design notes; the roster lists voices of both providers —
 * Fish and qwen DashScope — and a cast is { provider, id }) — a PORT of worldlines-play
 * `core/voice-cast-core.ts` (that file is the reference; both run the same test vectors:
 * packages/shared/test/voice-roster-cast.test.mjs here, core/voice-cast-core.test.ts there).
 *
 * The roster (reference_ids, gender, age band, mood / timbre tags, six fallbacks, banned voices,
 * per-character assignments) is DATA from play; this file holds no reference_id. Rules:
 *   1. a character assigned in the roster (`assignedVoices`: family/character → { zh, ja, en, ko }, always all four)
 *      gets the one for the world language (unknown language = zh) and NEVER goes through 2–3. If that voice is
 *      not in the roster (an old snapshot / broken data) the cast is { voice: undefined, via: "assigned-unavailable" }
 *      and the caller must refuse, not substitute. Only a roster without `assignedVoices` reads `assignments` (zh);
 *   2. a declared reference_id in the roster, or an old effect alias (`wise-elder`) matched by
 *      gender × age band × mood inside the roster's cell;
 *   3. nothing declared / unknown / banned / the other sex than the character / too far in age →
 *      one of the six fallbacks (gender × young / middle / old, nearest band, older on a tie).
 * Pure, zero dependencies, browser-safe.
 */

export type RosterGender = "male" | "female";
/** play 声音库的四档：儿童少年 / 青年 / 中年 / 老年。 */
export type RosterAge = "child" | "young" | "middle" | "old";
export const ROSTER_AGES: readonly RosterAge[] = ["child", "young", "middle", "old"];
export const ROSTER_FALLBACK_AGES: readonly RosterAge[] = ["young", "middle", "old"];

export type VoiceProvider = "fish" | "dashscope";

/** 配音的四门语言：一个角色固定 4 个声音，每门一个。 */
export type CastLang = "zh" | "ja" | "en" | "ko";
export const CAST_LANGS: readonly CastLang[] = ["zh", "ja", "en", "ko"];
export type VoiceSet = Readonly<Record<CastLang, string>>;
export const VOICE_PROVIDERS: readonly VoiceProvider[] = ["fish", "dashscope"];

export interface RosterVoice {
  /** 供应商（：千问和 Fish 混用，按哪个更好来选）。 */
  readonly provider: VoiceProvider;
  /** 该供应商的声音 id：Fish reference_id，或 DashScope 声线名（`Cherry`、`Eldric Sage`）。两家不会撞名。 */
  readonly id: string;
  /**
   * 只会说的语言：一门写成字符串（`"ja"`），几门写成数组（`["en", "ko"]`）；没有 = 四语都行。千问的方言 / 美式声线；
   * Fish 没有 zh 标签的母语声音只说自己标了的那几门（：只用母语）。
   */
  readonly only?: CastLang | readonly CastLang[];
  /** 声音库里的 id（千问是 `qwen:Cherry`）；只用于对照。 */
  readonly key?: string;
  readonly title: string;
  readonly gender: RosterGender;
  readonly age: RosterAge;
  readonly mood: readonly string[];
  readonly timbre: readonly string[];
  readonly roles: readonly string[];
  /** picked = 人筛入选；candidate = 那一格还没人筛时的暂用候选。 */
  readonly status: "picked" | "candidate";
}

export interface VoiceRoster {
  readonly schema: "worldlines.voice-roster/2";
  readonly generatedAt: string;
  readonly voices: readonly RosterVoice[];
  /** `${gender}/${age}` → 声音 id，六格（age ∈ young / middle / old）；可以来自任一供应商。 */
  readonly fallback: Readonly<Record<string, string>>;
  /** 每门语言一套兜底：语言 → `${gender}/${age}` → 该语言的母语声音（zh = fallback）；缺格 = 那一格没有。旧清单没有。 */
  readonly fallbackByLang?: Readonly<Partial<Record<CastLang, Readonly<Record<string, string>>>>>;
  /** 封禁的声音 id（任一供应商）：永远不说话。 */
  readonly banned: readonly string[];
  /** 世界家族 → 角色 id → 中文声音 id：旧读者用；新代码读 assignedVoices。 */
  readonly assignments: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** 世界家族 → 角色 id → { zh, ja, en, ko }：配过音的角色就用这 4 个。旧清单没有这个字段。 */
  readonly assignedVoices?: Readonly<Record<string, Readonly<Record<string, VoiceSet>>>>;
}

export function rosterAllows(roster: VoiceRoster, id: string, provider?: VoiceProvider): boolean {
  return !roster.banned.includes(id) && roster.voices.some((v) => v.id === id && (!provider || v.provider === provider));
}

/** 世界语言能用这个声音吗（`only` 不含这门语言就不行；不知道语言 = zh，和配音一样）。 */
export function speaks(v: Pick<RosterVoice, "only">, language?: string): boolean {
  if (!v.only) return true;
  const l = language || "zh";
  return typeof v.only === "string" ? v.only === l : (v.only as readonly string[]).includes(l);
}

export function rosterVoice(roster: VoiceRoster, id: string, language?: string): RosterVoice | undefined {
  const v = rosterAllows(roster, id) ? roster.voices.find((x) => x.id === id) : undefined;
  return v && speaks(v, language) ? v : undefined;
}

// ── 旧的效果别名 → 描述（不含 ID；在清单里按描述挑）─────────────────────

export interface VoiceDescriptor {
  readonly gender: RosterGender;
  readonly age: RosterAge;
  readonly mood: readonly string[];
}

/** hackathon rules/voices.ts 的 40 个别名。DashScope 原 id（`Eldric Sage`）先由调用方换成别名。 */
export const ALIAS_DESCRIPTORS: Readonly<Record<string, VoiceDescriptor>> = {
  "warm-cheerful": { gender: "female", age: "young", mood: ["阳光", "活泼"] },
  "gentle-calm": { gender: "female", age: "young", mood: ["温柔", "冷静"] },
  "anime-girlfriend": { gender: "female", age: "child", mood: ["活泼", "阳光"] },
  "playful-teasing": { gender: "female", age: "young", mood: ["活泼", "狡黠"] },
  "sassy-spunky": { gender: "female", age: "child", mood: ["傲娇", "活泼"] },
  "refined-thoughtful": { gender: "female", age: "middle", mood: ["冷静", "温柔"] },
  "mature-elegant": { gender: "female", age: "middle", mood: ["沉稳", "妩媚"] },
  "cinematic-american": { gender: "female", age: "middle", mood: ["沉稳"] },
  "shy-sweet": { gender: "female", age: "child", mood: ["温柔"] },
  "moe-child": { gender: "female", age: "child", mood: ["活泼"] },
  "bold-resonant": { gender: "female", age: "middle", mood: ["威严"] },
  "magical-girl": { gender: "female", age: "child", mood: ["阳光", "热血"] },
  "girl-next-door": { gender: "female", age: "young", mood: ["温柔", "阳光"] },
  "soothing-whisper": { gender: "female", age: "young", mood: ["温柔", "慵懒"] },
  "child-innocent": { gender: "female", age: "child", mood: ["活泼", "阳光"] },
  "spirited-girlfriend": { gender: "female", age: "young", mood: ["活泼", "傲娇"] },
  "shanghai-auntie": { gender: "female", age: "middle", mood: ["狡黠", "严肃"] },
  "sichuan-sweetheart": { gender: "female", age: "young", mood: ["阳光", "温柔"] },
  "cantonese-sweetheart": { gender: "female", age: "young", mood: ["阳光"] },
  "warm-energetic": { gender: "male", age: "young", mood: ["阳光", "热血"] },
  "cool-composed": { gender: "male", age: "young", mood: ["冷静"] },
  "soothing-smooth": { gender: "male", age: "young", mood: ["温柔", "沉稳"] },
  "casual-drawl": { gender: "male", age: "young", mood: ["慵懒"] },
  "dramatic-theatrical": { gender: "male", age: "middle", mood: ["热血", "狡黠"] },
  "friendly-american": { gender: "male", age: "young", mood: ["阳光"] },
  "wise-elder": { gender: "male", age: "old", mood: ["慈祥", "沉稳"] },
  "hoarse-weathered": { gender: "male", age: "middle", mood: ["疲惫", "沉稳"] },
  "news-anchor": { gender: "male", age: "middle", mood: ["严肃"] },
  "scholarly-narrator": { gender: "male", age: "middle", mood: ["沉稳", "冷静"] },
  "rustic-storyteller": { gender: "male", age: "old", mood: ["慈祥", "憨厚"] },
  "precocious-child": { gender: "male", age: "child", mood: ["活泼"] },
  "deep-magnetic": { gender: "male", age: "middle", mood: ["沉稳", "神秘"] },
  sportscaster: { gender: "male", age: "young", mood: ["热血", "活泼"] },
  "beijing-youth": { gender: "male", age: "young", mood: ["阳光", "活泼"] },
  "nanjing-uncle": { gender: "male", age: "middle", mood: ["温柔", "憨厚"] },
  "shaanxi-elder": { gender: "male", age: "old", mood: ["严肃", "憨厚"] },
  "minnan-uncle": { gender: "male", age: "middle", mood: ["狡黠"] },
  "tianjin-comic": { gender: "male", age: "middle", mood: ["活泼"] },
  "sichuan-local": { gender: "male", age: "young", mood: ["阳光", "活泼"] },
  "cantonese-uncle": { gender: "male", age: "middle", mood: ["活泼", "憨厚"] },
};

/** 那一格里气质最接近的：重合标签多的优先，入选优先于候选，再按清单顺序。 */
export function bestInCell(roster: VoiceRoster, d: VoiceDescriptor, opts: { language?: string; provider?: VoiceProvider } = {}): RosterVoice | undefined {
  let best: RosterVoice | undefined;
  let bestScore = -1;
  for (const v of roster.voices) {
    if (v.gender !== d.gender || v.age !== d.age || roster.banned.includes(v.id) || !speaks(v, opts.language)) continue;
    if (opts.provider && v.provider !== opts.provider) continue;
    const tags = new Set([...v.mood, ...v.timbre]);
    const score = d.mood.filter((m) => tags.has(m)).length * 2 + (v.status === "picked" ? 1 : 0);
    if (score > bestScore) {
      best = v;
      bestScore = score;
    }
  }
  return best;
}

// ── 说话的人：从角色自己的文字推性别 × 年龄档 ─────────────────────────

export interface RosterProfile {
  gender?: RosterGender;
  age?: RosterAge;
  years?: number;
}

const ZH_DIGIT: Readonly<Record<string, number>> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
function zhNumber(s: string): number | undefined {
  let total = 0;
  let cur = 0;
  for (const ch of s.startsWith("十") ? `一${s}` : s) {
    if (ch === "十") {
      total += (cur || 1) * 10;
      cur = 0;
    } else if (ch in ZH_DIGIT) cur = ZH_DIGIT[ch]!;
    else return undefined;
  }
  return total + cur;
}
const EN_UNITS = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split(" ");
const EN_TENS: Readonly<Record<string, number>> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
function enNumber(s: string): number | undefined {
  let total = 0;
  for (const part of s.toLowerCase().split(/[- ]/)) {
    if (part in EN_TENS) total += EN_TENS[part]!;
    else if (EN_UNITS.includes(part)) total += EN_UNITS.indexOf(part);
    else return undefined;
  }
  return total || undefined;
}
const KO_TENS: Readonly<Record<string, number>> = { 열: 10, 스물: 20, 스무: 20, 서른: 30, 마흔: 40, 쉰: 50, 예순: 60, 일흔: 70, 여든: 80, 아흔: 90 };
const KO_UNITS: Readonly<Record<string, number>> = { 한: 1, 두: 2, 세: 3, 네: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9 };

/** 文字里第一次写明的年龄（中日英韩）。 */
export function statedAge(text: string): number | undefined {
  let m = /(\d{1,3})\s*(?:岁|歳|살|才|-year-old|\s+years?\s+old)/.exec(text);
  if (m) return Number(m[1]);
  m = /([零一二两三四五六七八九十]{1,4})\s*(?:岁|歳)/.exec(text);
  if (m) {
    const n = zhNumber(m[1]!);
    if (n) return n;
  }
  m = /([二三四五六七八九])十(?:出头|多|来|余|上下|左右)/.exec(text);
  if (m) return ZH_DIGIT[m[1]!]! * 10 + 3;
  m = /([二三四五六七八九])十(?:を少し過ぎ|を過ぎ|代)/.exec(text);
  if (m) return ZH_DIGIT[m[1]!]! * 10 + 3;
  m = /([2-9])0\s*(?:代|대)/.exec(text);
  if (m) return Number(m[1]) * 10 + 3;
  m = /(스물|서른|마흔|쉰|예순|일흔|여든|아흔)을?\s*(?:갓\s*)?넘(?:긴|은)/.exec(text);
  if (m) return KO_TENS[m[1]!]! + 2;
  m = /\b((?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)[- ]years?[- ]old/i.exec(text);
  if (m) {
    const n = enNumber(m[1]!);
    if (n) return n;
  }
  m = new RegExp(String.raw`(?:\b(?:girl|boy|man|woman|lady|youth|child|kid)\s+of|\baged)\s+(?:about\s+|around\s+|some\s+)?(\d{1,3}|(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)\b`, "i").exec(text);
  if (m) {
    const n = /^\d/.test(m[1]!) ? Number(m[1]) : enNumber(m[1]!);
    if (n) return n;
  }
  m = /in (?:his|her|their) (early |late |mid-)?(twenties|thirties|forties|fifties|sixties|seventies|eighties)/i.exec(text);
  if (m) {
    const decade = ({ twenties: 20, thirties: 30, forties: 40, fifties: 50, sixties: 60, seventies: 70, eighties: 80 } as Record<string, number>)[m[2]!.toLowerCase()]!;
    const part = (m[1] ?? "").trim().toLowerCase();
    return decade + (part === "early" ? 2 : part === "late" ? 8 : 5);
  }
  m = /(스물|스무|서른|마흔|쉰|예순|일흔|여든|아흔|열)\s*(한|두|세|네|다섯|여섯|일곱|여덟|아홉)?\s*살/.exec(text);
  if (m) return KO_TENS[m[1]!]! + (m[2] ? KO_UNITS[m[2]]! : 0);
  return undefined;
}

/** 声音库的四档：≤17 儿童少年 · 18–34 青年 · 35–54 中年 · 55+ 老年。 */
export function ageOfYears(years: number): RosterAge {
  if (years <= 17) return "child";
  if (years <= 34) return "young";
  if (years <= 54) return "middle";
  return "old";
}

const AGE_WORDS: ReadonlyArray<readonly [RosterAge, RegExp]> = [
  ["old", /老人|老婆婆|老太|老妪|婆婆|奶奶|外婆|爷爷|外公|老爷子|老头|老者|老汉|老翁|阿婆|阿公|长老|年迈|老妇|老僧|老(?:领导|站长|师傅|船长|看守|渔夫|猎人|管家|医生|教授|臣|住户|警官)|白发苍苍|elderly|\bold (?:man|woman|lady|monk|priest|sailor)|grandmother|grandfather|granny|grandpa|grandma|crone|老婆さん|お婆|おばあ|お爺|おじい|老人|할머니|할아버지|노인/i],
  ["child", /小孩|孩子|孩童|儿童|小女孩|小男孩|幼女|童子|女童|男童|少女|少年|高中生|中学生|高[一二三]|初[一二三]|学妹|学弟|\bkid\b|\bchild\b|little (?:girl|boy)|teenage|teenager|schoolgirl|schoolboy|high[- ]school|子ども|子供|幼い|女子高生|高校生|어린아이|꼬마|소녀|소년|고등학생/i],
  ["middle", /中年|大叔|大婶|大妈|阿姨|叔叔|伯伯|婶子|middle-aged|おじさん|おばさん|중년|아저씨|아주머니/i],
  ["young", /年轻|青年|姑娘|小伙|学姐|学长|young (?:man|woman)|若い|젊은/i],
];
const FEMALE = /她|女|婆|娘|妻|姐|妹|母|妈|夫人|小姐|姑娘|奶奶|姨|婶|嫂|公主|女王|新娘|女仆|修女|彼女|\bshe\b|\bher\b|\bwoman\b|\bgirl\b|\blady\b|\bmother\b|\bwife\b|\bsister\b|\bdaughter\b|\bqueen\b|\bprincess\b|\bwidow\b|\bmaid\b|\bmrs\.?\b|그녀|여자|소녀|할머니|어머니|엄마|아내|언니|누나|여동생|부인/gi;
const MALE = /他(?!们)|男|爷|父|爸|兄|哥|弟|少爷|少年|叔|伯|僧|和尚|王子|国王|丈夫|老头|彼(?!女)|\bhe\b|\bhis\b|\bhim\b|\bman\b|\bboy\b|\bfather\b|\bhusband\b|\bbrother\b|\bson\b|\bking\b|\bprince\b|\bmonk\b|\bmr\.?\b|그는|남자|소년|할아버지|아버지|오빠|남편/gi;

/** 性别 × 年龄档：写明的 gender 优先；否则性别词要明显多数（2:1 且至少 2 个）；年龄先认数字再认称谓。 */
export function inferVoiceProfile(text: string, declaredGender?: unknown): RosterProfile {
  const t = typeof text === "string" ? text : "";
  const out: RosterProfile = {};
  if (declaredGender === "female" || declaredGender === "male") out.gender = declaredGender;
  else {
    const f = (t.match(FEMALE) ?? []).length;
    const m = (t.match(MALE) ?? []).length;
    if (f >= 2 && f >= m * 2) out.gender = "female";
    else if (m >= 2 && m >= f * 2) out.gender = "male";
    else if (f === 1 && m === 0) out.gender = "female";
    else if (m === 1 && f === 0) out.gender = "male";
  }
  const years = statedAge(t);
  if (years !== undefined) {
    out.years = years;
    out.age = ageOfYears(years);
  } else
    for (const [band, re] of AGE_WORDS)
      if (re.test(t)) {
        out.age = band;
        break;
      }
  return out;
}

const INDEX: Readonly<Record<RosterAge, number>> = { child: 0, young: 1, middle: 2, old: 3 };

/** 世界语言（不认识 / 不知道 = zh）。 */
export function castLang(language?: string): CastLang {
  return (CAST_LANGS as readonly string[]).includes(language ?? "") ? (language as CastLang) : "zh";
}

/** 兜底之一（世界语言那一套；旧清单是六个）：同性别优先（不明 = 女），年龄档最近（不明 = 青年），平手取年长。 */
export function rosterFallback(roster: VoiceRoster, profile: RosterProfile = {}, language?: string): RosterVoice | undefined {
  const l = castLang(language);
  const genders: RosterGender[] = profile.gender === "male" ? ["male", "female"] : profile.gender === "female" ? ["female", "male"] : ["female", "male"];
  const want = INDEX[profile.age ?? "young"];
  for (const g of genders) {
    const ages = [...ROSTER_FALLBACK_AGES].sort((a, b) => {
      const da = INDEX[a] - want;
      const db = INDEX[b] - want;
      return Math.abs(da) * 2 + (da < 0 ? 1 : 0) - (Math.abs(db) * 2 + (db < 0 ? 1 : 0));
    });
    for (const a of ages) {
      const v = rosterVoice(roster, roster.fallbackByLang?.[l]?.[`${g}/${a}`] ?? roster.fallback[`${g}/${a}`] ?? "", l);
      if (v) return v;
    }
  }
  return undefined;
}

/** 声明的声音离角色年龄太远：差两档，或角色是老人 / 声音是孩子而对不上。 */
export function ageMismatch(voiceAge: RosterAge, characterAge: RosterAge | undefined): boolean {
  if (!characterAge) return false;
  if (Math.abs(INDEX[voiceAge] - INDEX[characterAge]) >= 2) return true;
  return (characterAge === "old" || voiceAge === "child") && voiceAge !== characterAge;
}

export interface RosterCast {
  voice: RosterVoice | undefined;
  via: "assigned" | "assigned-unavailable" | "declared" | "fallback-undeclared" | "fallback-unknown" | "fallback-gender" | "fallback-age";
}

/**
 * 唯一的选声规则。`declared` = 角色的 voice 声明（reference_id 或旧别名）；`profile` = 角色文字推出来的；
 * `who` = 「世界家族/角色 id」，在清单的 assignments 里有就直接用。
 */
export function castRosterVoice(roster: VoiceRoster, opts: { declared?: string; profile?: RosterProfile; family?: string; character?: string; language?: string } = {}): RosterCast {
  const profile = opts.profile ?? {};
  const lang = opts.language;
  const who = opts.family && opts.character ? ([opts.family, opts.character] as const) : undefined;
  const set = who ? roster.assignedVoices?.[who[0]]?.[who[1]] : undefined;
  if (set) {
    const l: CastLang = (CAST_LANGS as readonly string[]).includes(lang ?? "") ? (lang as CastLang) : "zh";
    const v = rosterAllows(roster, set[l]) ? roster.voices.find((x) => x.id === set[l]) : undefined;
    return { voice: v, via: v ? "assigned" : "assigned-unavailable" };
  }
  const assigned = who && !roster.assignedVoices ? roster.assignments[who[0]]?.[who[1]] : undefined;
  const assignedVoice = assigned ? rosterVoice(roster, assigned, lang) : undefined;
  if (assignedVoice) return { voice: assignedVoice, via: "assigned" };
  const name = typeof opts.declared === "string" ? opts.declared.trim() : "";
  if (!name) return { voice: rosterFallback(roster, profile, lang), via: "fallback-undeclared" };
  const descriptor = ALIAS_DESCRIPTORS[name];
  const own = rosterVoice(roster, name, lang) ?? (descriptor ? bestInCell(roster, descriptor, { language: lang }) : undefined);
  if (!own) return { voice: rosterFallback(roster, profile, lang), via: "fallback-unknown" };
  if (profile.gender && own.gender !== profile.gender) return { voice: rosterFallback(roster, profile, lang), via: "fallback-gender" };
  if (ageMismatch(own.age, profile.age)) return { voice: rosterFallback(roster, { ...profile, gender: profile.gender ?? own.gender }, lang), via: "fallback-age" };
  return { voice: own, via: "declared" };
}

/**
 * 同一个声音在另一家里最像的：同性别、年龄档最近、mood / timbre 重合最多（入选优先）。用在跨供应商回退
 * （Fish 不可用 → 千问，或反过来）：绝不把一家的 id 发给另一家。
 */
export function nearestInProvider(roster: VoiceRoster, voice: Pick<RosterVoice, "gender" | "age" | "mood" | "timbre">, provider: VoiceProvider, language?: string): RosterVoice | undefined {
  const want = new Set([...voice.mood, ...voice.timbre]);
  let best: RosterVoice | undefined;
  let bestScore = -Infinity;
  for (const v of roster.voices) {
    if (v.provider !== provider || roster.banned.includes(v.id) || !speaks(v, language)) continue;
    const d = INDEX[v.age] - INDEX[voice.age];
    const overlap = [...v.mood, ...v.timbre].filter((t) => want.has(t)).length;
    const score = (v.gender === voice.gender ? 100 : 0) - (Math.abs(d) * 2 + (d < 0 ? 1 : 0)) * 10 + overlap * 2 + (v.status === "picked" ? 1 : 0);
    if (score > bestScore) {
      best = v;
      bestScore = score;
    }
  }
  return best;
}

/** 文字 + 声明一步到位（play 选角用）。 */
export function castRosterTtsVoice(roster: VoiceRoster, opts: { declared?: string; text: string; gender?: unknown; family?: string; character?: string; language?: string }): RosterCast {
  return castRosterVoice(roster, { declared: opts.declared, profile: inferVoiceProfile(opts.text, opts.gender), family: opts.family, character: opts.character, language: opts.language });
}
