import { createHash } from 'node:crypto';
import { Agent } from 'undici';
import { localTtsFlag, localVoiceFits, type WorldLanguage } from '@airp/shared';

export function parseCharacterVoices(value: string): Record<string, string> {
  if (!value.trim()) return {};
  const entries = value.split(',').map(pair => pair.trim().split('='));
  if (entries.length > 100 || entries.some(pair => pair.length !== 2 || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(pair[0]) || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(pair[1]))) throw new Error('Invalid character voice mapping');
  return Object.fromEntries(entries);
}

/**
 * Character IDs are deployment-wide. Only an explicit `AIRP_TTS_CHARACTER_VOICES`
 * entry routes a character to the local service: the local voice is ONE
 * person's voice (setsuna), so handing it to every female character made the
 * whole cast speak alike. Everyone else keeps their declared online voice.
 * `_declaredVoice` / `_gender` stay in the signature for the route's call site.
 */
export function characterLocalVoice(characterId: string, _declaredVoice?: unknown, _gender?: unknown): string | null {
  let overrides: Record<string, string> = {};
  try { overrides = parseCharacterVoices(process.env.AIRP_TTS_CHARACTER_VOICES ?? ''); } catch { /* Ignore malformed external configuration. */ }
  if (Object.hasOwn(overrides, characterId)) return overrides[characterId] === 'online' ? null : overrides[characterId];
  return null;
}

/**
 * Local voices the operator declares Japanese beyond the built-in registry
 * (`LOCAL_VOICES` in packages/shared/src/rules/voices.ts). Gender unknown, so
 * only language is checked for them.
 */
function operatorLocalVoices(): Record<string, { language: WorldLanguage }> {
  const list = (process.env.AIRP_TTS_JA_LOCAL_VOICES ?? '').split(',').map(v => v.trim()).filter(Boolean);
  return Object.fromEntries(list.map(voice => [voice, { language: 'ja' as const }]));
}

/**
 * The local studio voice for this character in this world, or null for the
 * online voice. A candidate comes from an explicit
 * `AIRP_TTS_CHARACTER_VOICES` entry or the built-in Nanami routing, and is then
 * used ONLY if it speaks the world's language and matches the character's
 * declared gender (`localVoiceFits`). `vera=setsuna` therefore still gives Vera
 * setsuna in the Japanese edition, and her own online voice everywhere else.
 */
export function selectLocalVoice(
  worldId: string,
  characterId: string,
  language: WorldLanguage,
  declaredVoice: string | undefined,
): string | null {
  let overrides: Record<string, string> = {};
  try { overrides = parseCharacterVoices(process.env.AIRP_TTS_CHARACTER_VOICES ?? ''); } catch { /* Ignore malformed external configuration. */ }
  let candidate: string | null = null;
  if (Object.hasOwn(overrides, characterId)) {
    candidate = overrides[characterId] === 'online' ? null : overrides[characterId];
  } else if (isLocalTtsCharacter(worldId, characterId)) {
    candidate = readLocalTtsConfig().voice;
  }
  return candidate && localVoiceFits(candidate, language, declaredVoice, operatorLocalVoices()) ? candidate : null;
}

/**
 * Local studio TTS is hidden by default.
 * On only with `AIRP_LOCAL_TTS=1`, or for one request from a browser whose
 * own local-TTS toggle is on (`X-AIRP-TTS-Local: 1`, sent only then — see
 * apps/web/src/lib/tts-readiness.ts). Off: every character uses its hosted voice.
 */
export function localTtsEnabled(header?: string | null): boolean {
  return localTtsFlag(process.env) || header === '1';
}

/** Messages contain only our own diagnostics, never upstream bodies or secrets. */
export class LocalTtsError extends Error {}

/** Deployment-only routing; character content retains its online fallback voice. */
export function readLocalTtsConfig() {
  const timeout = Number(process.env.AIRP_TTS_LOCAL_TIMEOUT_MS);
  return {
    baseUrl: (process.env.AIRP_TTS_LOCAL_BASE_URL ?? '').trim().replace(/\/+$/, ''),
    voice: process.env.AIRP_TTS_LOCAL_VOICE?.trim() || 'setsuna',
    apiKey: process.env.AIRP_TTS_LOCAL_API_KEY?.trim() || '',
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : LOCAL_TTS_TIMEOUT_MS,
  };
}

/**
 * One budget for the whole local request. It also
 * bounds the TCP connect: Node's fetch (undici) gives up connecting after 10 s
 * by default and reports a bare "fetch failed", which is what the connection
 * self-test showed at 10.5 s against a Tailscale host that was still waking —
 * so the dispatcher's connect timeout is raised to the same 20 s.
 */
export const LOCAL_TTS_TIMEOUT_MS = 20_000;
const dispatchers = new Map<number, Agent>();
function dispatcherFor(timeoutMs: number): Agent {
  let agent = dispatchers.get(timeoutMs);
  if (!agent) {
    agent = new Agent({ connect: { timeout: timeoutMs }, headersTimeout: timeoutMs, bodyTimeout: timeoutMs });
    dispatchers.set(timeoutMs, agent);
  }
  return agent;
}

export function isLocalTtsCharacter(worldId: string, characterId: unknown): boolean {
  return characterId === 'nanami' && /^(?:first-snow|firstsnow|sakura-academy)(?:-|$)/.test(worldId);
}

const EMOTIONS: Record<string, string> = {
  normal: 'neutral', smile: 'happy', sad: 'sad', angry: 'angry',
  shock: 'neutral', thinking: 'neutral',
};

export function localTtsEmotion(emotion: unknown): string {
  return typeof emotion === 'string' ? (EMOTIONS[emotion] ?? 'neutral') : 'neutral';
}

export function localTtsHash(config: ReturnType<typeof readLocalTtsConfig>, text: string, language: string, emotion: string): string {
  return createHash('sha256').update(JSON.stringify([
    'fish-tts-v1', config.baseUrl, config.voice, language, emotion, text,
  ])).digest('hex').slice(0, 20);
}

export async function synthesiseLocal(config: ReturnType<typeof readLocalTtsConfig>, text: string, language: string, emotion: string): Promise<Buffer> {
  const response = await fetch(`${config.baseUrl}/v1/tts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify({ text, voice: config.voice, language, emotion }),
    signal: AbortSignal.timeout(config.timeoutMs),
    // `dispatcher` is undici's fetch extension; TS's DOM RequestInit lacks it.
    ...({ dispatcher: dispatcherFor(config.timeoutMs) } as object),
  });
  if (!response.ok) throw new LocalTtsError(`HTTP ${response.status}`);
  const wav = Buffer.from(await response.arrayBuffer());
  if (wav.length < 12 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') {
    throw new LocalTtsError('invalid WAV');
  }
  return wav;
}
