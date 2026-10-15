export type NanamiTtsDraft = {
  baseUrl?: string;
  voice?: string;
  timeoutSeconds?: string;
  apiKey?: string;
  characterVoices?: string;
};

export type NanamiValidationKey =
  | 'Enter a valid local TTS base URL without /v1/tts.'
  | 'Voice ID must use letters, numbers, underscores, or hyphens.'
  | 'Timeout must be between 1 and 120 seconds.';

export class NanamiSettingsValidationError extends Error {
  constructor(readonly key: NanamiValidationKey) {
    super(key);
  }
}

const VOICE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function timeoutSecondsFromConfig(value: unknown): string {
  const milliseconds = Number(value);
  return Number.isInteger(milliseconds) && milliseconds >= 1000 && milliseconds <= 120000
    ? String(milliseconds / 1000)
    : '30';
}

/** Only touched, meaningful fields are sent. An explicitly empty base URL is
 * kept because it disables the local route; other empty fields preserve the
 * server value. */
export function buildNanamiTtsPayload(draft: NanamiTtsDraft): Record<string, string> {
  const payload: Record<string, string> = {};
  if (draft.baseUrl !== undefined) {
    const baseUrl = draft.baseUrl.trim();
    if (baseUrl) {
      try {
        const parsed = new URL(baseUrl);
        if (!['http:', 'https:'].includes(parsed.protocol)
          || parsed.username || parsed.password || parsed.search || parsed.hash
          || /(?:^|\/)v1\/tts(?:\/|$)/i.test(parsed.pathname)) throw new Error('invalid');
      } catch {
        throw new NanamiSettingsValidationError('Enter a valid local TTS base URL without /v1/tts.');
      }
    }
    payload.AIRP_TTS_LOCAL_BASE_URL = baseUrl;
  }
  if (draft.voice !== undefined && draft.voice.trim()) {
    const voice = draft.voice.trim();
    if (!VOICE_RE.test(voice)) throw new NanamiSettingsValidationError('Voice ID must use letters, numbers, underscores, or hyphens.');
    payload.AIRP_TTS_LOCAL_VOICE = voice;
  }
  if (draft.timeoutSeconds !== undefined && draft.timeoutSeconds.trim()) {
    const seconds = Number(draft.timeoutSeconds);
    const milliseconds = seconds * 1000;
    if (!Number.isFinite(seconds) || seconds < 1 || seconds > 120 || !Number.isInteger(milliseconds)) {
      throw new NanamiSettingsValidationError('Timeout must be between 1 and 120 seconds.');
    }
    payload.AIRP_TTS_LOCAL_TIMEOUT_MS = String(milliseconds);
  }
  if (draft.apiKey !== undefined && draft.apiKey) payload.AIRP_TTS_LOCAL_API_KEY = draft.apiKey;
  if (draft.characterVoices !== undefined) payload.AIRP_TTS_CHARACTER_VOICES = draft.characterVoices;
  return payload;
}
