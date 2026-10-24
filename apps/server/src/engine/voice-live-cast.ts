import {
  ALIAS_DESCRIPTORS,
  LOCAL_VOICE_HOSTED_FALLBACK,
  inferVoiceProfile,
  isValidCharacterId,
  parseFrontmatter,
  resolveVoiceFor,
  voiceEntry,
  worldLanguageOf,
  type LocalWorldStore,
  type WorldLanguage,
  characterVoiceOf,
  worldFamilyOf,
} from '@airp/shared';
import { localTtsEnabled, readLocalTtsConfig, selectLocalVoice } from '../routes/local-tts.js';
import { castFromPlay } from '../play-voice.js';
import { builtinCandidates } from '../builtin-voices.js';

/**
 * Who a voice-live call is with, and which voice speaks them
 *
 *
 * voice-live has ONE configured TTS voice (`VOICE_LIVE_QWEN_VOICE`, a woman's
 * `Cherry` by default), and until now the proxy never told it which character
 * was on the call — so every character, men included, spoke in that one voice.
 * This resolves the voice the SAME way `POST /api/tts` does for the dialogue:
 * world language (`world.json#locale`) × declared `voice:` → `resolveVoiceFor`
 * → DashScope id, so a character sounds the same whether you read or call them,
 * and never in a voice bound to another language.
 *
 * A character the canvas routes to the local studio voice (see `tts.ts`) gets
 * NO voice here: voice-live keeps its own configured backend for them rather
 * than being pushed onto an online voice they never use elsewhere.
 */
export interface VoiceLiveCast {
  character?: string;
  /**
   * DashScope voice id (e.g. `Ethan`), exactly as normal TTS would send it — or, in the
   * cloud, a Fish `reference_id` (32 hex): voice-live then speaks the call with Fish, and
   * ai.worldlines.gg checks the id against the Worldlines voice roster before forwarding.
   */
  voice?: string;
  /** The world's language as DashScope `language_type` (`Chinese` …). */
  language?: string;
}

const LANGUAGE_TYPE: Record<WorldLanguage, string> = { zh: 'Chinese', ja: 'Japanese', en: 'English', ko: 'Korean' };

/** A Fish voice id as voice-live recognises one (voice_live/cast.py). */
export const FISH_VOICE_ID = /^[0-9a-f]{32}$/;

/** Where the call will be spoken, and who is asking play for its voice. */
export interface VoiceLiveCastOptions {
  /**
   * true when the call's voice-live speaks Fish: the AI service's voice channel (a ticketed
   * call, voice-live in the cloud) always does; a self-run voice-live does when told so
   * (`VOICE_LIVE_FISH=1`, it then has its own Fish key). false → DashScope voices only.
   */
  fish?: boolean;
  /** The signed-in account's access token, for play (null / absent = signed out: play is not asked). */
  token?: string | null;
  /** Tests: the fetch play is asked with. */
  request?: typeof fetch;
}

/** Whether a self-run voice-live (the proxied `/ws/voice-live` call) speaks Fish. */
export function proxiedVoiceLiveSpeaksFish(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.VOICE_LIVE_FISH ?? '').trim() === '1';
}

/**
 * The voice for this call, chosen the way the dialogue's TTS chooses it (routes/tts.ts step 6b,
 */19: worldlines-play decides): play's candidates for the providers this call's
 * voice-live can speak (Fish + DashScope on a ticketed call, DashScope alone on a self-run one) →
 * play's last answer (play-voice.ts cache) → the built-in table (builtin-voices.ts). Every source
 * gives native speakers only (只说母语). voice-live speaks one voice, so the first candidate wins.
 *
 * null = no source has a voice for this character on these providers: the caller keeps `legacy`,
 * because a call cannot refuse the way a line of TTS can.
 */
export async function castCallVoice(input: {
  worldId: string;
  characterId: string;
  language: WorldLanguage;
  declared?: string;
  description?: string;
  gender?: unknown;
  fish: boolean;
  token?: string | null;
  request?: typeof fetch;
}): Promise<{ voice: string; source: 'play' | 'cache' | 'builtin' } | null> {
  const providers: ('fish' | 'dashscope')[] = input.fish ? ['fish', 'dashscope'] : ['dashscope'];
  let profile = inferVoiceProfile(input.description ?? '', input.gender);
  // the author's declared voice tells sex × age where the text does not (wise-elder = an old man), as in TTS
  const aliasOf = (n: string) => voiceEntry(n)?.alias ?? voiceEntry(LOCAL_VOICE_HOSTED_FALLBACK[n] ?? '')?.alias ?? n;
  const descriptor = input.declared ? ALIAS_DESCRIPTORS[aliasOf(input.declared)] : undefined;
  profile = { ...profile, gender: profile.gender ?? descriptor?.gender, age: profile.age ?? descriptor?.age };
  const asked = await castFromPlay({
    family: input.worldId.replace(/-(?:zh|jp|ja|ko|en)$/, ''),
    character: input.characterId,
    lang: input.language,
    ...(input.description ? { description: input.description } : {}),
    traits: { ...(profile.gender ? { gender: profile.gender } : {}), ...(profile.age ? { age: profile.age } : {}) },
    providers,
  }, input.token ?? null, input.request);
  if (asked.source !== 'none') {
    const first = asked.candidates.find((c) => (providers as string[]).includes(c.provider) && c.voiceId);
    if (first) return { voice: first.voiceId, source: asked.source };
  }
  const builtinDeclared = input.declared && builtinCandidates({ providers, lang: input.language, gender: profile.gender, age: profile.age, declared: input.declared })
    .some((c) => c.voiceId === input.declared) ? input.declared : undefined;
  // the team's assigned voice (Fish calls only) beats the declaration, as in TTS
  const builtin = builtinCandidates({ providers, lang: input.language, gender: profile.gender, age: profile.age, declared: builtinDeclared, declaredFirst: Boolean(builtinDeclared), family: worldFamilyOf(input.worldId), character: input.characterId });
  return builtin[0] ? { voice: builtin[0].voiceId, source: 'builtin' } : null;
}

/** Pure: the upstream socket URL with the cast as query parameters. */
export function voiceLiveSessionUrl(socketUrl: string, cast: VoiceLiveCast, options: { relayBrain?: boolean } = {}): string {
  const url = new URL(socketUrl);
  if (cast.character) url.searchParams.set('character', cast.character);
  // voice-live-brain.ts answers for the character over this same call.
  if (cast.character && options.relayBrain) url.searchParams.set('brain', 'relay');
  if (cast.voice) url.searchParams.set('voice', cast.voice);
  if (cast.language) url.searchParams.set('language', cast.language);
  return url.toString();
}

/** The `character` query parameter of a `/ws/voice-live?character=…` request, if it is a valid id. */
export function voiceLiveCharacterOf(requestUrl: string | undefined): string | undefined {
  const id = new URL(requestUrl ?? '/', 'http://localhost').searchParams.get('character') ?? '';
  return isValidCharacterId(id) ? id : undefined;
}

/** The captured canonical save root of a `/ws/voice-live` client. */
export function voiceLiveSavePathOf(requestUrl: string | undefined): string | null {
  return new URL(requestUrl ?? '/', 'http://localhost').searchParams.get('savePath');
}

/**
 * Resolve the cast for one call. Never throws: a missing README or an
 * undeclared voice degrade to the TTS default voice cast for the world's
 * language; no store at all degrades to voice-live's own default — never a
 * failed call.
 */
export async function resolveVoiceLiveCast(
  store: LocalWorldStore | null,
  characterId: string | undefined,
  options: VoiceLiveCastOptions = {},
): Promise<VoiceLiveCast> {
  if (!characterId) return {};
  const cast: VoiceLiveCast = { character: characterId };
  if (!store) return cast;
  let declared: Record<string, unknown> = {};
  try {
    declared = parseFrontmatter(await store.readFile(`characters/${characterId}/README.md`)).frontmatter ?? {};
  } catch {
    /* no README: cast on the world's default voice below, like TTS does */
  }
  let manifest: { id: string; locale?: unknown } | null = null;
  try { manifest = await store.getManifest(); } catch { /* language unknown → English, like TTS */ }
  const language = worldLanguageOf(manifest?.locale);
  cast.language = LANGUAGE_TYPE[language];
  const declaredVoice = characterVoiceOf(declared);
  if (localTtsEnabled() && readLocalTtsConfig().baseUrl && manifest && selectLocalVoice(manifest.id, characterId, language, declaredVoice)) {
    return cast;
  }
  // Always name a voice when the studio voice is not ours to use: leaving it
  // out would let voice-live's own default (possibly a Japanese studio voice)
  // read this world's language. Undeclared / unknown → the TTS default, cast
  // for this language, exactly as `POST /api/tts` falls back — then play / its
  // cache / the built-in table choose, as for the dialogue's TTS (castCallVoice).
  const fallback = process.env.AIRP_TTS_DEFAULT_VOICE?.trim() || 'Cherry';
  const legacy =
    (declaredVoice ? resolveVoiceFor(declaredVoice, language) : null) ??
    resolveVoiceFor(fallback, language) ??
    'Cherry';
  cast.voice = legacy;
  if (manifest) {
    try {
      const row = (manifest as { characters?: { id?: unknown; description?: unknown }[] }).characters?.find((c) => c?.id === characterId);
      const chosen = await castCallVoice({
        worldId: manifest.id, characterId, language, declared: declaredVoice,
        description: typeof row?.description === 'string' ? row.description : '', gender: declared.gender,
        fish: options.fish === true, token: options.token, request: options.request,
      });
      if (chosen) cast.voice = chosen.voice;
    } catch {
      cast.voice = legacy; // a casting bug costs the chosen voice, never the call
    }
  }
  return cast;
}
