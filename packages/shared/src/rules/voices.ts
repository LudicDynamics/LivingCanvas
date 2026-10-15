/**
 * The voice palette.
 *
 * World content declares a voice by its **effect**, not by DashScope's proper
 * name: `voice: wise-elder`, never `voice: Eldric Sage`. Proper names are
 * unmemorable and typing one wrong mutes the character silently, which is
 * exactly the bug this table was written to kill:
 * `Eldric` and `Sage` are NOT voices — `Eldric Sage` is one voice, with a
 * space, and a hand-written name got both halves wrong.
 *
 * Zero dependencies on purpose (same discipline as `rules/characters.ts`): the
 * server route, `tools/check-voices.mjs` and a future voice picker all import
 * this, and none of them should pull in zod or the world store to do it.
 *
 * VERIFICATION: every entry below was synthesised for real against the
 * workspace endpoint on 2026-09-13. An id
 * that was NOT observed to return audio MUST NOT be added here — an allowlist
 * that admits unverified ids is what turned a typo into silence.
 */

/**
 * Gender of a palette voice. Language is the second axis (`native` below):
 * most qwen3-tts voices speak every world language natively, but some are
 * bound to one.
 */
export type VoiceGender = 'female' | 'male';

/**
 * The spoken language of a WORLD (not the UI): `zh-CN` editions → `zh`, `ja` →
 * `ja`, `ko` → `ko`, everything else (the base editions) → `en`.
 * `world.json#locale` is the source (`worldLanguageOf`).
 *
 * Korean (2026-10-03): qwen3-tts lists Korean in the ten-language set of every
 * palette voice without a `native` binding, so those voices speak `ko` as they
 * speak `ja`; the language-bound ones are re-cast exactly as for Japanese.
 */
export type WorldLanguage = 'zh' | 'ja' | 'en' | 'ko';
export const WORLD_LANGUAGES: readonly WorldLanguage[] = ['zh', 'ja', 'en', 'ko'];

/** `world.json#locale` (or a request's content language) → the world's spoken language. */
export function worldLanguageOf(locale: unknown): WorldLanguage {
  const value = typeof locale === 'string' ? locale.trim().toLowerCase() : '';
  if (value.startsWith('zh')) return 'zh';
  if (value === 'ja' || value.startsWith('ja-') || value === 'jp') return 'ja';
  if (value === 'ko' || value.startsWith('ko-') || value === 'kr') return 'ko';
  return 'en';
}

export interface VoiceEntry {
  /** kebab-case EFFECT name — the only vocabulary world content should use. */
  alias: string;
  /** The DashScope `voice` id that goes on the wire (never written by hand). */
  id: string;
  gender: VoiceGender;
  /** One line describing the SOUND, so a writer can pick without listening. */
  tone: string;
  /**
   * Set only when the voice is bound to ONE world language. Absent = it speaks
   * zh / en / ja natively. From Alibaba's own voice list (the design notes links it,
   * re-read 2026-09-27): the regional voices are Chinese-dialect voices, and
   * Jennifer / Aiden are described as American-English voices. Every other
   * palette voice is listed with the full ten-language set.
   */
  native?: WorldLanguage;
}

/**
 * The palette. Add an entry only after synthesising it (see header) — and note
 * that `alias` MUST stay kebab-case while `id` keeps DashScope's own casing.
 */
export const VOICES: readonly VoiceEntry[] = [
  // ── female ────────────────────────────────────────────────────────────────
  { alias: 'warm-cheerful', id: 'Cherry', gender: 'female', tone: 'Sunny, warm, natural young woman — the friendly default.' },
  { alias: 'gentle-calm', id: 'Serena', gender: 'female', tone: 'Soft-spoken and gentle, quietly attentive.' },
  { alias: 'anime-girlfriend', id: 'Chelsie', gender: 'female', tone: 'Bright anime-style virtual-girlfriend voice.' },
  { alias: 'playful-teasing', id: 'Momo', gender: 'female', tone: 'Playful and teasing, a little mischievous.' },
  { alias: 'sassy-spunky', id: 'Vivian', gender: 'female', tone: 'Sassy and prickly-cute, quick to snap.' },
  { alias: 'refined-thoughtful', id: 'Maia', gender: 'female', tone: 'Composed and intellectual, with warmth underneath.' },
  { alias: 'mature-elegant', id: 'Katerina', gender: 'female', tone: 'Mature and elegant, richly cadenced.' },
  { alias: 'cinematic-american', id: 'Jennifer', gender: 'female', tone: 'Polished, cinematic American English.', native: 'en' },
  { alias: 'shy-sweet', id: 'Mia', gender: 'female', tone: 'Shy, sweet and yielding.' },
  { alias: 'moe-child', id: 'Bunny', gender: 'female', tone: 'High, hyper-cute cartoon-girl voice.' },
  { alias: 'bold-resonant', id: 'Bellona', gender: 'female', tone: 'Loud and clear; carries across a room.' },
  { alias: 'magical-girl', id: 'Stella', gender: 'female', tone: 'Sweet and dreamy until it turns heroic.' },
  { alias: 'girl-next-door', id: 'Nini', gender: 'female', tone: 'Sweet and affectionate, the girl next door.' },
  { alias: 'soothing-whisper', id: 'Seren', gender: 'female', tone: 'Slow and soothing — a sleep-aid voice.' },
  { alias: 'child-innocent', id: 'Bella', gender: 'female', tone: 'Small child: innocent and bright.' },
  { alias: 'spirited-girlfriend', id: 'Ono Anna', gender: 'female', tone: 'Wry, spirited childhood-friend voice.' },

  // ── male ──────────────────────────────────────────────────────────────────
  { alias: 'warm-energetic', id: 'Ethan', gender: 'male', tone: 'Sunny, warm, energetic young man.' },
  { alias: 'cool-composed', id: 'Moon', gender: 'male', tone: 'Cool and detached, effortlessly confident.' },
  { alias: 'soothing-smooth', id: 'Kai', gender: 'male', tone: 'Low and smooth — calm, relaxing read.' },
  { alias: 'casual-drawl', id: 'Nofish', gender: 'male', tone: 'Relaxed and casual, faintly mumbled.' },
  { alias: 'dramatic-theatrical', id: 'Ryan', gender: 'male', tone: 'Heightened and theatrical, full of tension.' },
  { alias: 'friendly-american', id: 'Aiden', gender: 'male', tone: 'Easygoing American young man.', native: 'en' },
  { alias: 'wise-elder', id: 'Eldric Sage', gender: 'male', tone: 'Old and steady, deeply experienced — calm authority.' },
  { alias: 'hoarse-weathered', id: 'Vincent', gender: 'male', tone: 'Hoarse and smoky, weathered by years.' },
  { alias: 'news-anchor', id: 'Neil', gender: 'male', tone: 'Flat and precise, a professional news-reader.' },
  { alias: 'scholarly-narrator', id: 'Elias', gender: 'male', tone: 'Measured lecturer: clear and instructive.' },
  { alias: 'rustic-storyteller', id: 'Arthur', gender: 'male', tone: 'Rustic elder, unhurried, telling old tales.' },
  { alias: 'precocious-child', id: 'Mochi', gender: 'male', tone: 'Clever child: small but unnervingly articulate.' },
  { alias: 'deep-magnetic', id: 'Andre', gender: 'male', tone: 'Deep and magnetic, comfortably steady.' },
  { alias: 'sportscaster', id: 'Radio Gol', gender: 'male', tone: 'Fast and excited sports-commentary delivery.' },

  // ── regional accents ──────────────────────────────────────────────────────
  { alias: 'shanghai-auntie', id: 'Jada', gender: 'female', tone: 'Shanghainese: brisk and no-nonsense.', native: 'zh' },
  { alias: 'sichuan-sweetheart', id: 'Sunny', gender: 'female', tone: 'Sichuan-accented, sweet and warm.', native: 'zh' },
  { alias: 'cantonese-sweetheart', id: 'Kiki', gender: 'female', tone: 'Cantonese: sweet and friendly.', native: 'zh' },
  { alias: 'beijing-youth', id: 'Dylan', gender: 'male', tone: 'Beijing-accented young man.', native: 'zh' },
  { alias: 'nanjing-uncle', id: 'Li', gender: 'male', tone: 'Nanjing-accented, patient and gentle.', native: 'zh' },
  { alias: 'shaanxi-elder', id: 'Marcus', gender: 'male', tone: 'Shaanxi-accented, terse and grounded.', native: 'zh' },
  { alias: 'minnan-uncle', id: 'Roy', gender: 'male', tone: 'Minnan-accented, wry and streetwise.', native: 'zh' },
  { alias: 'tianjin-comic', id: 'Peter', gender: 'male', tone: 'Tianjin-accented comic patter.', native: 'zh' },
  { alias: 'sichuan-local', id: 'Eric', gender: 'male', tone: 'Sichuan-accented, lively local man.', native: 'zh' },
  { alias: 'cantonese-uncle', id: 'Rocky', gender: 'male', tone: 'Cantonese: humorous and chatty.', native: 'zh' },
];

/** alias → entry. Module-private; callers go through `resolveVoice`. */
const BY_ALIAS = new Map(VOICES.map((v) => [v.alias, v]));
/** id → entry (DashScope's own casing, spaces included). */
const BY_ID = new Map(VOICES.map((v) => [v.id, v]));

/** The palette size, for tests/gates that must not pass vacuously. */
export const VOICE_COUNT = VOICES.length;

/**
 * Resolve a declared voice to the wire id.
 *
 * Accepts BOTH vocabularies, because both flow through here:
 *   - an effect alias (`wise-elder`) → its DashScope id;
 *   - a raw id already in the palette (`Eldric Sage`) → itself, unchanged.
 *
 * Anything else returns `null` — that is the point. A near-miss (`Eldric`,
 * `Sage`, `cherry`) is NOT silently accepted: the caller warns, falls back to
 * the server default, and `tools/check-voices.mjs` fails the build so the
 * typo can never ship.
 */
export function resolveVoice(name: string): string | null {
  const alias = BY_ALIAS.get(name);
  if (alias) return alias.id;
  return BY_ID.has(name) ? name : null;
}

/** The palette entry behind a declared voice, alias or raw id (undefined if unknown). */
export function voiceEntry(name: string): VoiceEntry | undefined {
  return BY_ALIAS.get(name) ?? BY_ID.get(name);
}

// ── Per-language casting ──────────────────────────────────
//
// 「所有角色…是男性女性，匹配什么声音，都是根据这个语种和这个声线去匹配。」
// A character's voice is decided by TWO things: the world's language and the
// declared timbre (alias → gender + tone). A voice bound to another language is
// never used; its alias is re-cast on the nearest tone of the SAME gender that
// speaks the world's language. `check:voices` walks every edition × character
// and fails if a resolved voice is of the wrong language or gender.

/**
 * Nearest same-gender, all-language alias for each language-bound alias. Tone
 * is matched by the palette's own `tone` lines; gender is never crossed.
 */
const LANGUAGE_SUBSTITUTE: Readonly<Record<string, string>> = {
  // bound to English
  'cinematic-american': 'mature-elegant',     // polished, cinematic → mature and elegant
  'friendly-american': 'warm-energetic',      // easygoing young man → warm, energetic young man
  // bound to Chinese (dialect voices)
  'shanghai-auntie': 'bold-resonant',         // brisk, no-nonsense → loud and clear
  'sichuan-sweetheart': 'girl-next-door',     // sweet and warm → sweet and affectionate
  'cantonese-sweetheart': 'warm-cheerful',    // sweet and friendly → sunny, warm
  'beijing-youth': 'warm-energetic',          // young man → warm, energetic young man
  'nanjing-uncle': 'soothing-smooth',         // patient and gentle → low and smooth
  'shaanxi-elder': 'deep-magnetic',           // terse, grounded, deep → deep and steady
  'minnan-uncle': 'casual-drawl',             // wry, streetwise → relaxed and casual
  'tianjin-comic': 'dramatic-theatrical',     // comic patter → heightened, theatrical
  'sichuan-local': 'warm-energetic',          // lively local man → warm, energetic
  'cantonese-uncle': 'casual-drawl',          // humorous, chatty → relaxed and casual
};

/** Does this palette voice speak `language` natively? */
export function voiceSpeaks(entry: VoiceEntry, language: WorldLanguage): boolean {
  return entry.native === undefined || entry.native === language;
}

/**
 * The palette entry that actually speaks for a declared voice in a world of
 * `language`: the declaration itself when it speaks that language, otherwise
 * its same-gender, nearest-tone substitute. `undefined` for an unknown name.
 */
export function castVoice(name: string, language: WorldLanguage): VoiceEntry | undefined {
  const entry = voiceEntry(name) ?? voiceEntry(LOCAL_VOICE_HOSTED_FALLBACK[name] ?? '');
  if (!entry) return undefined;
  if (voiceSpeaks(entry, language)) return entry;
  const substitute = BY_ALIAS.get(LANGUAGE_SUBSTITUTE[entry.alias] ?? '');
  return substitute && substitute.gender === entry.gender && voiceSpeaks(substitute, language)
    ? substitute
    : undefined;
}

/**
 * `resolveVoice`, per world language — what every TTS path calls. Accepts an
 * alias or a raw id (a raw id is mapped back to its alias, so it is re-cast the
 * same way). `null` for an unknown name, exactly like `resolveVoice`.
 */
export function resolveVoiceFor(name: string, language: WorldLanguage): string | null {
  return castVoice(name, language)?.id ?? null;
}

/** The per-language table: alias → the DashScope id that speaks it in `language`. */
export function voiceTableFor(language: WorldLanguage): Readonly<Record<string, string>> {
  const table: Record<string, string> = {};
  for (const v of VOICES) {
    const cast = castVoice(v.alias, language);
    if (cast) table[v.alias] = cast.id;
  }
  return table;
}

/**
 * Local studio voices (the fine-tuned / self-hosted TTS behind
 * `AIRP_TTS_LOCAL_BASE_URL`). Each is ONE person's voice in ONE language, so
 * it may only speak for a character of its gender in a world of its language.
 * A local voice missing here is never used: its language is unknown.
 */
export const LOCAL_VOICES: Readonly<Record<string, { language: WorldLanguage; gender: VoiceGender }>> = {
  setsuna: { language: 'ja', gender: 'female' },
};

/**
 * The hosted palette alias that stands in for a local studio voice when local
 * TTS is hidden or a save
 * declares the studio voice id directly: same gender, nearest tone, and it
 * speaks every world language, so nobody falls silent.
 */
export const LOCAL_VOICE_HOSTED_FALLBACK: Readonly<Record<string, string>> = {
  setsuna: 'shy-sweet',
};

/**
 * A declared voice as a hosted palette id: a palette alias / id as is, a known
 * local studio voice as its hosted stand-in, anything else `null`. Unlike
 * `resolveVoice` (which content validation and the writer use, and which keeps
 * rejecting studio ids), this is for READING old saves without erroring.
 */
export function hostedVoiceOf(name: string): string | null {
  return resolveVoice(name) ?? resolveVoice(LOCAL_VOICE_HOSTED_FALLBACK[name] ?? '');
}

/**
 * Local studio TTS feature flag, default OFF: env
 * `AIRP_LOCAL_TTS=1` turns it on. Off = no studio voice is listed or used;
 * every character speaks with its hosted voice.
 */
export function localTtsFlag(env: Readonly<Record<string, string | undefined>>): boolean {
  return (env.AIRP_LOCAL_TTS ?? '').trim() === '1';
}

/**
 * May `localVoice` speak for a character declaring `declared` in a world of
 * `language`? Language must match; gender must match when the character
 * declares a palette voice (an undeclared character is judged on language).
 */
export function localVoiceFits(
  localVoice: string,
  language: WorldLanguage,
  declared: string | undefined,
  extra: Readonly<Record<string, { language: WorldLanguage; gender?: VoiceGender }>> = {},
): boolean {
  const known = LOCAL_VOICES[localVoice] ?? extra[localVoice];
  if (!known || known.language !== language) return false;
  const entry = declared ? voiceEntry(declared) : undefined;
  return !entry || !known.gender || entry.gender === known.gender;
}

// ── GPT-Live realtime-call voices ──────────────────
//
// The nook realtime call (third voice channel) speaks through OpenAI's
// `gpt-live-1`, whose voice vocabulary is NOT DashScope's. This block extends
// the ONE mapping table rather than opening a second one: a parallel alias
// table is exactly the "two truths" drift the header warns about.
//
// VERIFICATION: every name below returned HTTP 201 from
// `POST /v1/live/sessions` on 2026-09-14.
// An illegal name is a HARD 403, so a name that was not observed to open a
// session MUST NOT be added here — same discipline as the palette above.

/** The GPT-Live voices an AIRP character call may use (probe-verified). */
export const LIVE_VOICES: readonly string[] = [
  // OpenAI's own gpt-live-1 set (12).
  'quartz', 'ripple', 'vesper', 'willow', 'stone', 'gleam',
  'meridian', 'bossa', 'tempo', 'beacon', 'delta', 'cinder',
  // Realtime-era voices also accepted by gpt-live-1 (10).
  'marin', 'cedar', 'alloy', 'ash', 'ballad', 'coral',
  'echo', 'sage', 'shimmer', 'verse',
];

/** Voice used when a character declares none, or declares an unknown one. */
export const DEFAULT_LIVE_VOICE = 'marin';

const LIVE_VOICE_SET = new Set(LIVE_VOICES);

/** A Live voice's perceived gender. `neutral` is never cast for a gendered alias. */
export type LiveVoiceGender = VoiceGender | 'neutral';

/**
 * The perceived gender of each Live voice we are willing to CAST
 *
 *
 * Only the ten Realtime-era voices are here, because OpenAI publishes their
 * character: cedar / ash / ballad / echo / verse read male, marin / coral /
 * sage / shimmer read female, and alloy is androgynous — which is exactly why
 * it must never be cast for a male (or female) character. The twelve
 * gpt-live-1 names (quartz … cinder) stay WHITELISTED, so a session using one
 * still opens, but they are deliberately absent from this table: nobody has
 * listened to them, and an unheard voice is how 'ballad' ended up voicing
 * girls. Add one only after a listening check.
 */
export const LIVE_VOICE_GENDER: Readonly<Record<string, LiveVoiceGender>> = {
  cedar: 'male',
  ash: 'male',
  ballad: 'male',
  echo: 'male',
  verse: 'male',
  marin: 'female',
  coral: 'female',
  sage: 'female',
  shimmer: 'female',
  alloy: 'neutral',
};

/**
 * alias → GPT-Live voice. Written out per alias on purpose (the design notes
 * L-C1) so the cast can differ within a gender. Every row MUST land on a voice
 * of the alias's own gender in `LIVE_VOICE_GENDER` — `check:live-voices` (L4)
 * and `apps/server/test/live-voice-gender.test.mjs` enforce it. With only
 * five male and four female castable voices, reuse is unavoidable.
 */
const LIVE_BY_ALIAS: Readonly<Record<string, string>> = {
  // ── female: marin (warm, natural) · sage (calm, soft) · coral (playful) · shimmer (bright) ──
  'warm-cheerful': 'marin',
  'gentle-calm': 'sage',
  'anime-girlfriend': 'shimmer',
  'playful-teasing': 'coral',
  'sassy-spunky': 'shimmer',
  'refined-thoughtful': 'sage',
  'mature-elegant': 'sage',
  'cinematic-american': 'marin',
  'shy-sweet': 'coral',
  'moe-child': 'shimmer',
  'bold-resonant': 'marin',
  'magical-girl': 'shimmer',
  'girl-next-door': 'coral',
  'soothing-whisper': 'sage',
  'child-innocent': 'shimmer',
  'spirited-girlfriend': 'coral',
  'shanghai-auntie': 'marin',
  'sichuan-sweetheart': 'coral',
  'cantonese-sweetheart': 'shimmer',

  // ── male: cedar (warm, young) · ash (low, smooth) · ballad (measured, older) · echo (casual) · verse (dramatic) ──
  'warm-energetic': 'cedar',
  'cool-composed': 'ash',
  'soothing-smooth': 'ash',
  'casual-drawl': 'echo',
  'dramatic-theatrical': 'verse',
  'friendly-american': 'cedar',
  'wise-elder': 'ballad',
  'hoarse-weathered': 'verse',
  'news-anchor': 'echo',
  'scholarly-narrator': 'ballad',
  'rustic-storyteller': 'ballad',
  'precocious-child': 'echo',
  'deep-magnetic': 'ash',
  'sportscaster': 'verse',
  'beijing-youth': 'cedar',
  'nanjing-uncle': 'ash',
  'shaanxi-elder': 'ballad',
  'minnan-uncle': 'echo',
  'tianjin-comic': 'verse',
  'sichuan-local': 'cedar',
  'cantonese-uncle': 'echo',
};

/** The Live voice each palette alias is cast as (for gates and tests). */
export function liveVoiceForAlias(alias: string): string | undefined {
  return LIVE_BY_ALIAS[alias];
}

/**
 * Resolve a character's declared `voice` to a GPT-Live voice name.
 *
 * Accepts the same two vocabularies as `resolveVoice` (an effect alias or a
 * raw DashScope id), because both flow through `characters/<id>/README.md`.
 * Anything missing or unknown falls back to `DEFAULT_LIVE_VOICE` — unlike
 * `resolveVoice`, this NEVER returns null: the call has to pick a voice, and a
 * missing one is normal (some characters declare none).
 */
export function resolveLiveVoice(name: string | undefined): string {
  if (!name) return DEFAULT_LIVE_VOICE;
  const entry = voiceEntry(name) ?? voiceEntry(LOCAL_VOICE_HOSTED_FALLBACK[name] ?? '');
  const mapped = entry ? LIVE_BY_ALIAS[entry.alias] : undefined;
  return mapped !== undefined && LIVE_VOICE_SET.has(mapped) ? mapped : DEFAULT_LIVE_VOICE;
}
