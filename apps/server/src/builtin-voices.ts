/**
 * The BUILT-IN voice fallback: used ONLY when worldlines-play cannot be asked — signed out, play unreachable,
 * and no earlier answer cached (play-voice.ts). Precise matching is play's job (POST /v1/voice/cast); this is a deliberately
 * tiny table so a line is still spoken: one default voice per provider × world language × sex × age band.
 *
 * - qwen (DashScope system voices) speaks ONLY its native language: Chinese cells use the Chinese voices,
 *   Japanese only Ono Anna, Korean only Sohee, English Jennifer / Aiden / Ryan. A cell qwen has no native voice for is left
 *   out — the caller then skips qwen (never a Chinese voice reading Japanese, never the other sex).
 * - Fish: public voices from worldlines-play's library (each language's fallback voices, 2026-10-18), all native speakers.
 * - OpenAI: its six voices (they read every language).
 * Keep it small; when this table and play disagree, play is right.
 */
import type { WorldLanguage } from '@airp/shared';

export type BuiltinProvider = 'fish' | 'dashscope' | 'openai';
type Sex = 'female' | 'male';
type Band = 'child' | 'young' | 'middle' | 'old';
type Cells = Partial<Record<Sex, Partial<Record<Band, string>>>>;

export const BUILTIN_VOICES: Readonly<Record<BuiltinProvider, Readonly<Partial<Record<WorldLanguage, Cells>>>>> = {
  dashscope: {
    zh: {
      female: { child: 'Bunny', young: 'Cherry', middle: 'Katerina', old: 'Katerina' },
      male: { child: 'Pip', young: 'Ethan', middle: 'Neil', old: 'Eldric Sage' },
    },
    ja: { female: { child: 'Ono Anna', young: 'Ono Anna', middle: 'Ono Anna', old: 'Ono Anna' } },
    ko: { female: { child: 'Sohee', young: 'Sohee', middle: 'Sohee', old: 'Sohee' } },
    en: {
      female: { child: 'Jennifer', young: 'Jennifer', middle: 'Jennifer', old: 'Jennifer' },
      male: { child: 'Aiden', young: 'Aiden', middle: 'Ryan', old: 'Ryan' },
    },
  },
  fish: {
    zh: {
      female: { child: 'f82e3885ac22468eb6c773b96f2c5752', young: 'a1417155aa234890aab4a18686d12849', middle: 'bf6c479f5a384b8d857310030035824b', old: '4c7cc6fc744b4999a05d40f265ee3237' },
      male: { child: '8ae19c06b5bc48968c4bf57bdeed5495', young: '12abd39fe3c04610ae842815513c03b0', middle: '21082ac382d945e29aea354e90380f11', old: 'ee18d36ee7bc4ab09f0533fa1e8e1ed0' },
    },
    ja: {
      female: { child: 'bf5634e34ee5489991fe687ad0d202c5', young: '5161d41404314212af1254556477c17d', middle: '6f5ccc8c93374f7c829915ffe6a1e544', old: '0698818725ef48728aeed6deb0bafb6b' },
      male: { child: 'ed07fac0ac144ba6b7f6b208d57ace05', young: '45c5d3723c9c42f598e4776dcfd5f02d', middle: '9600581739c44a9c8bd1401faae802ae', old: 'd537f8f7f83b48abb97f29dd3ea1e7ff' },
    },
    en: {
      female: { child: 'd8f3b4c1199f4568a767ec54112d2b17', young: '786025a7ea384284a18220bd4b9771f8', middle: 'f248b08382a244a087ab5ee5fda8f6c2', old: 'edb42faa2d0e4cd5aa6aa1ae67de2e86' },
      male: { child: '9dabfe7b1fb54a24bded803a7b1ff5b4', young: '802e3bc2b27e49c2995d23ef70e6ac89', middle: 'e686ae649ee44f219a108aacba206c1a', old: '65aa3aa0a3f94c10b7da7f1665e2fa4f' },
    },
    ko: {
      female: { child: 'e1b08ec6597d4770aff6fec0f1908572', young: '54f52a4d2b994612a30306b4a2a95758', middle: '2f06c7a428e9431fadd60af4dfe91763', old: '79dde601eeeb40fe8e6844a8fd48bb91' },
      male: { child: 'a5dfdc63eb0a46c5bfdf6546d96d48d7', young: '67ede89a20a0433fb4c8d3de046e03ae', middle: '29da56534ac84ccd81092be4359a1639', old: '7d6f923c1ae54f0fa65f0fafe1bb606f' },
    },
  },
  openai: Object.fromEntries((['zh', 'ja', 'en', 'ko'] as const).map((l) => [l, {
    female: { child: 'nova', young: 'nova', middle: 'shimmer', old: 'shimmer' },
    male: { child: 'echo', young: 'echo', middle: 'fable', old: 'onyx' },
  }])) as Partial<Record<WorldLanguage, Cells>>,
};

/**
 * the team's per-character voices (worldlines-assets voices/assignments.json, 2026-10-18): world family → character id → one
 * Fish voice per language. play answers with these first (via = assigned); this copy is so the SAME voices speak when play
 * cannot be asked (signed out, own Fish key, play down). Only a Fish route can honour them — on a qwen-only route the
 * character keeps the table's cell. Must equal the roster snapshot's `assignedVoices` (check:voices V9 compares them); to
 * change one, change assignments.json, re-sync the snapshot (tools/sync-voice-roster.mjs) and copy it here.
 */
export const BUILTIN_ASSIGNED: Readonly<Record<string, Readonly<Record<string, Readonly<Record<WorldLanguage, string>>>>>> = {
  'islet': {
    'nagi': { zh: 'f82e3885ac22468eb6c773b96f2c5752', ja: 'a1bc0dd7625243b4b402db009e293d91', en: '83c19893c4974594839bd2d101b1fd66', ko: '440ef7f28a7c47c2ad665e39d9177229' },
    'mio': { zh: '564dc2631c624222a21864b17f3c66a8', ja: '836e3a1873cf48c8a7761f8480fbfb69', en: 'd8f3b4c1199f4568a767ec54112d2b17', ko: 'e1b08ec6597d4770aff6fec0f1908572' },
    'kai': { zh: '12abd39fe3c04610ae842815513c03b0', ja: '45c5d3723c9c42f598e4776dcfd5f02d', en: '802e3bc2b27e49c2995d23ef70e6ac89', ko: 'd5fb36c677a742f5866126b5116fef2f' },
    'kenta': { zh: '21082ac382d945e29aea354e90380f11', ja: '9600581739c44a9c8bd1401faae802ae', en: '7a18a1851d2649108c48ec9f2c80eb2c', ko: '29da56534ac84ccd81092be4359a1639' },
  },
  'mandongbu': {
    'wataru': { zh: '8ae19c06b5bc48968c4bf57bdeed5495', ja: 'ed07fac0ac144ba6b7f6b208d57ace05', en: '9dabfe7b1fb54a24bded803a7b1ff5b4', ko: 'a5dfdc63eb0a46c5bfdf6546d96d48d7' },
    'xiazhi': { zh: '3ff6b61ebc224e139bc4eb4a2f23507d', ja: 'bf5634e34ee5489991fe687ad0d202c5', en: '83c19893c4974594839bd2d101b1fd66', ko: '92cc6d3ac2b94ad692deb3da68363d19' },
  },
  'lost-map': {
    'theo': { zh: '8adf850e94b548bc82f399524670d8c2', ja: '45c5d3723c9c42f598e4776dcfd5f02d', en: '078eaa5208ca42a1909d2e6fac9c93f7', ko: '67ede89a20a0433fb4c8d3de046e03ae' },
  },
  'last-train': {
    'xia-cheng': { zh: 'a1417155aa234890aab4a18686d12849', ja: '825c9e9870494118ad93b6853a22d5e7', en: 'd296ba634f164155abd7018f51454518', ko: 'ff2945cbfd274c85b440bd39d8cb3729' },
    'su-he': { zh: '5a88883c20a84f378db686ac6b0bba79', ja: '5161d41404314212af1254556477c17d', en: '786025a7ea384284a18220bd4b9771f8', ko: 'ff2945cbfd274c85b440bd39d8cb3729' },
    'zhong-huaili': { zh: '8bc02ac9d6ca4fb9b952a5c30aec4bab', ja: 'b53f531147d74735a9536e793dc7722b', en: '65aa3aa0a3f94c10b7da7f1665e2fa4f', ko: 'ea06d70f2e73475c84fbc5d44b01778b' },
  },
  'first-snow': {
    'nanami': { zh: 'e752df7d20cd4576af9a207520349a33', ja: '825c9e9870494118ad93b6853a22d5e7', en: 'd296ba634f164155abd7018f51454518', ko: '54f52a4d2b994612a30306b4a2a95758' },
  },
  'seven-days-inn': {
    'rin': { zh: '5a88883c20a84f378db686ac6b0bba79', ja: '5161d41404314212af1254556477c17d', en: '786025a7ea384284a18220bd4b9771f8', ko: 'f1cd6f519c7549679cdd0360ec8a86a8' },
    'genkai': { zh: 'ee18d36ee7bc4ab09f0533fa1e8e1ed0', ja: 'd537f8f7f83b48abb97f29dd3ea1e7ff', en: '990e585856914623a40b1f5aa216f4ad', ko: '7d6f923c1ae54f0fa65f0fafe1bb606f' },
    'seventh': { zh: 'd1618ef37b9c426c83d219c0abb33f96', ja: '9600581739c44a9c8bd1401faae802ae', en: 'e686ae649ee44f219a108aacba206c1a', ko: '87d3970929bf47e19cf38472eda5764d' },
  },
  'forger': {
    'martel': { zh: 'bf6c479f5a384b8d857310030035824b', ja: '6f5ccc8c93374f7c829915ffe6a1e544', en: 'f248b08382a244a087ab5ee5fda8f6c2', ko: '2f06c7a428e9431fadd60af4dfe91763' },
  },
  'guixiang': {
    'xiulian': { zh: 'a1417155aa234890aab4a18686d12849', ja: '5161d41404314212af1254556477c17d', en: '786025a7ea384284a18220bd4b9771f8', ko: 'ff2945cbfd274c85b440bd39d8cb3729' },
  },
};

/** the team's Fish voice for this character in this language, if he assigned one. `family` = world id without -zh / -jp / -ko. */
export function assignedVoiceOf(family: string | undefined, character: string | undefined, lang: WorldLanguage): string | undefined {
  if (!family || !character) return undefined;
  return BUILTIN_ASSIGNED[family]?.[character]?.[lang];
}

export interface BuiltinCandidate { provider: BuiltinProvider; voiceId: string; via: 'builtin' | 'assigned' }

/** Is `voiceId` one of this provider's built-in voices for that language (and, when known, that sex)? */
function builtinHas(provider: BuiltinProvider, lang: WorldLanguage, voiceId: string, sex?: Sex): boolean {
  const cells = BUILTIN_VOICES[provider][lang] ?? {};
  return (sex ? [cells[sex]] : [cells.female, cells.male]).some((ages) => Object.values(ages ?? {}).includes(voiceId));
}

/**
 * The built-in candidates, one per listed provider in order
 * the author's declared voice when it is that provider's own
 * built-in voice for this language (and sex), else the table's cell for the character's sex × age band (age unknown =
 * young; sex unknown = female, then male). A provider without a native voice for that cell is skipped.
 */
export function builtinCandidates(opts: { providers: readonly BuiltinProvider[]; lang: WorldLanguage; gender?: Sex; age?: Band; declared?: string; declaredFirst?: boolean; family?: string; character?: string }): BuiltinCandidate[] {
  const out: BuiltinCandidate[] = [];
  // the team assigned this character a voice: on a Fish route it comes first and stands in for the Fish cell (it beats the
  // author's declaration, as in play); the other providers keep their cells after it
  const assigned = opts.providers.includes('fish') ? assignedVoiceOf(opts.family, opts.character, opts.lang) : undefined;
  if (assigned) {
    out.push({ provider: 'fish', voiceId: assigned, via: 'assigned' });
    return out.concat(builtinCandidates({ ...opts, providers: opts.providers.filter((p) => p !== 'fish'), family: undefined, character: undefined }));
  }
  // the provider whose own voice the author declared goes first (the author's choice wins where it is a built-in voice)
  // (only for a provider's own id as written — an effect alias such as wise-elder names no provider)
  const owns = (p: BuiltinProvider) => Boolean(opts.declaredFirst && opts.declared && builtinHas(p, opts.lang, opts.declared, opts.gender));
  for (const provider of [...opts.providers].sort((a, b) => Number(owns(b)) - Number(owns(a)))) {
    const cells = BUILTIN_VOICES[provider]?.[opts.lang];
    if (!cells) continue;
    const declared = opts.declared && builtinHas(provider, opts.lang, opts.declared, opts.gender) ? opts.declared : undefined;
    const sexes: Sex[] = opts.gender ? [opts.gender] : ['female', 'male'];
    const id = declared ?? sexes.map((s) => cells[s]?.[opts.age ?? 'young']).find(Boolean);
    if (id) out.push({ provider, voiceId: id, via: 'builtin' });
  }
  return out;
}
