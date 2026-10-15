/**
 * tts-request.ts — the ONE place the browser asks for a spoken line.
 *
 * There used to be exactly one caller (`CharacterModal.prefetchVoice`), so the
 * request lived inside the modal's pagination machinery. The companion dock
 * needs the same voice
 * and
 * a second `/api/tts` call site would mean two readiness gates, two fallback
 * warnings and two ways to drift. So the NETWORK half is extracted here and the
 * modal keeps its pagination half untouched (the design notes freezes the page
 * split, the per-page voice lifecycle and the advance gesture, not where the
 * `fetch` lexically sits).
 *
 * ⚠️ Gate constraint: `fetch('/api/tts'` must stay on one line with an inline
 * object-literal body — `tools/check-request-bodies.mjs` pins this file and the
 * key set `text, voice, language, characterId, emotion, savePath`.
 */
import { asWord, track } from './analytics.js';
import type { Emotion } from './audio.js';
import { canRequestTts, invalidateTts, noteTtsRequiresAccount, noteTtsSuccess, ttsEnabled, ttsLocalExperiment } from './tts-readiness.js';
import { isBillingStop } from './model-errors.js';

export interface VoiceRequest {
  /** Already run through `sanitiseTtsText`; empty text is a miss, not a request. */
  text: string;
  /** The character's DashScope voice; undefined → server default. */
  voice?: string;
  /** The world content language. */
  language: string;
  /** Canonical WorldLoadResult.path captured by the caller for this voice turn. */
  savePath: string;
  characterId: string;
  emotion: Emotion;
}

/**
 * `ready` carries a URL to play. `failed` means "no voice for this line" — the
 * caller decides whether that deserves a stinger. `stale` means the caller's
 * own guard said the turn moved on while a promise was in flight: nothing was
 * decided about this line, so nothing should be played or reported for it.
 */
export type VoiceOutcome =
  | { status: 'ready'; url: string }
  | { status: 'failed' }
  | { status: 'stale' };

type ResolvableVoiceOutcome = Exclude<VoiceOutcome, { status: 'stale' }>;

/** Recheck the caller's save/turn scope immediately before publishing a result. */
export function commitVoiceOutcomeIfCurrent(
  outcome: VoiceOutcome,
  stillValid: () => boolean,
  commit: (current: ResolvableVoiceOutcome) => void,
): boolean {
  if (outcome.status === 'stale' || !stillValid()) return false;
  commit(outcome);
  return true;
}

const FAILED: VoiceOutcome = { status: 'failed' };
const STALE: VoiceOutcome = { status: 'stale' };

/**
 * Ask for one line's audio.
 *
 * `stillValid` is re-asked after every await, which is what stops a voice
 * requested for the page (or character) the player has since left from being
 * handed back and played over the new one. It replaces the modal's inline
 * `token !== voiceTurnRef.current || text changed` checks with the same checks
 * supplied by the caller, so both callers get the invalidation for free.
 */
export async function fetchVoiceUrl(
  request: VoiceRequest,
  stillValid: () => boolean = () => true,
  /**
   * Aborted when the player stops the speaker or closes their dialogue. An
   * aborted line is `stale`, never `failed`: stopping a character on purpose
   * is not the voice service failing, so it never counts toward the pause.
   */
  signal?: AbortSignal,
): Promise<VoiceOutcome> {
  const { text, voice, language, savePath, characterId, emotion } = request;
  if (text === '') return FAILED;
  const live = (): boolean => stillValid() && signal?.aborted !== true;
  try {
    const ready = await canRequestTts();
    if (!live()) return STALE;
    if (!ready || !ttsEnabled()) return FAILED;
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(ttsLocalExperiment() ? { 'X-AIRP-TTS-Local': '1' } : {}) },
      body: JSON.stringify({ text, voice, language, characterId, emotion, savePath }),
      signal,
    });
    if (res.headers.get('X-AIRP-TTS-Fallback') === 'local-to-online') {
      console.warn('[AIRP TTS] Local voice failed; falling back to online TTS.');
    } else if (res.headers.get('X-AIRP-TTS-Fallback') === 'provider') {
      console.info('[AIRP TTS] The voice service used its fallback provider for this line.');
    }
    if (!live()) return STALE;
    const data = (await res.json()) as { ok?: boolean; url?: string; code?: string };
    if (!live()) return STALE;
    // The save this line belonged to is no longer open: nothing was decided about the voice service.
    if (data.code === 'world_changed') return STALE;
    // Voices need an account (signed out, a guest of the trial): stop asking for this session, one quiet hint.
    if (data.code === 'tts_requires_account' || res.status === 401 || res.status === 403) {
      noteTtsRequiresAccount();
      track('tts_failed', { reason: 'tts_requires_account' });
      return FAILED;
    }
    if (!res.ok || !data.ok || typeof data.url !== 'string' || data.url === '') {
      // The Worldlines plan is used up: say so once, like a writer turn does (model-errors.ts).
      if (isBillingStop(data.code)) window.dispatchEvent(new CustomEvent('airp:notice', { detail: data.code }));
      invalidateTts(data.code === 'tts_unconfigured');
      // 改进产品 (lib/analytics.ts): the failure code only.
      track('tts_failed', { reason: asWord(data.code) ?? `http_${res.status}` });
      return FAILED;
    }
    noteTtsSuccess();
    return { status: 'ready', url: data.url };
  } catch {
    if (!live()) return STALE;
    invalidateTts();
    track('tts_failed', { reason: 'network' });
    return FAILED;
  }
}
