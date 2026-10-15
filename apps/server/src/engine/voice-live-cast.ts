import {
  isValidCharacterId,
  parseFrontmatter,
  resolveVoiceFor,
  worldLanguageOf,
  type LocalWorldStore,
  type WorldLanguage,
} from '@airp/shared';
import { localTtsEnabled, readLocalTtsConfig, selectLocalVoice } from '../routes/local-tts.js';

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
  /** DashScope voice id (e.g. `Ethan`), exactly as normal TTS would send it. */
  voice?: string;
  /** The world's language as DashScope `language_type` (`Chinese` …). */
  language?: string;
}

const LANGUAGE_TYPE: Record<WorldLanguage, string> = { zh: 'Chinese', ja: 'Japanese', en: 'English', ko: 'Korean' };

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
  const declaredVoice = typeof declared.voice === 'string' ? declared.voice.trim() : undefined;
  if (localTtsEnabled() && readLocalTtsConfig().baseUrl && manifest && selectLocalVoice(manifest.id, characterId, language, declaredVoice)) {
    return cast;
  }
  // Always name a voice when the studio voice is not ours to use: leaving it
  // out would let voice-live's own default (possibly a Japanese studio voice)
  // read this world's language. Undeclared / unknown → the TTS default, cast
  // for this language, exactly as `POST /api/tts` falls back.
  const fallback = process.env.AIRP_TTS_DEFAULT_VOICE?.trim() || 'Cherry';
  cast.voice =
    (declaredVoice ? resolveVoiceFor(declaredVoice, language) : null) ??
    resolveVoiceFor(fallback, language) ??
    'Cherry';
  return cast;
}
