/**
 * Fish Audio provider for the online character voice.
 *
 * `POST {base}/v1/tts` with `Authorization: Bearer <FISH_AUDIO_API_KEY>`, the
 * model in the `model` HEADER (default `s2.1-pro`; `s1` retires 2026-12-31),
 * `{ text, reference_id, format: 'wav' }` in the body; the response body IS the
 * audio (chunked), no second download hop. We ask for wav so the existing
 * content-addressed cache, its magic-byte gate and `/api/tts/audio/*.wav` stay
 * exactly as they are.
 *
 * This is the OPTIONAL bring-your-own-key path (an open-source player with their
 * own Fish account). A signed-in player never uses it: their voices go through
 * the Worldlines AI service, which holds the Fish key (routes/tts.ts step 6b).
 * Which provider a keyed install uses (`ttsProviderOf`): `AIRP_TTS_PROVIDER=fish|dashscope`
 * wins; unset = Fish when `FISH_AUDIO_API_KEY` (or `FISH_API_KEY`) is set, otherwise
 * DashScope. The key is read from env on every request and never logged, echoed or
 * put in a URL. Voices: worldlines-play's voice roster only (rules/voice-roster.ts).
 */

export interface FishTtsConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
}

export const FISH_DEFAULTS = {
  baseUrl: 'https://api.fish.audio',
  model: 's2.1-pro',
  timeoutMs: 20000,
} as const;

/** Models the Fish API accepts in the `model` header (docs.fish.audio, 2026-10-15). */
export const FISH_MODELS: readonly string[] = ['s2.1-pro', 's2.1-pro-free', 's2-pro', 's1', 'drama-3'];

export function readFishTtsConfig(env: NodeJS.ProcessEnv = process.env): FishTtsConfig {
  const timeoutRaw = Number(env.AIRP_FISH_TTS_TIMEOUT_MS ?? env.AIRP_TTS_TIMEOUT_MS);
  const model = (env.AIRP_FISH_TTS_MODEL ?? '').trim();
  return {
    apiKey: (env.FISH_AUDIO_API_KEY || env.FISH_API_KEY || '').trim(),
    baseUrl: ((env.AIRP_FISH_TTS_BASE_URL ?? '').trim() || FISH_DEFAULTS.baseUrl).replace(/\/+$/, ''),
    model: FISH_MODELS.includes(model) ? model : FISH_DEFAULTS.model,
    timeoutMs: Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : FISH_DEFAULTS.timeoutMs,
  };
}

export type TtsProvider = 'fish' | 'dashscope';

/** The online provider for this request (see header). Pure over `env`. */
export function ttsProviderOf(env: NodeJS.ProcessEnv = process.env): TtsProvider {
  const forced = (env.AIRP_TTS_PROVIDER ?? '').trim().toLowerCase();
  if (forced === 'fish' || forced === 'fish-audio') return 'fish';
  if (forced === 'dashscope' || forced === 'qwen') return 'dashscope';
  return (env.FISH_AUDIO_API_KEY || env.FISH_API_KEY || '').trim() ? 'fish' : 'dashscope';
}

/** Through the Worldlines AI service, a `fish-…` model id means the voice is a Fish reference_id. */
export function isFishGatewayModel(model: string): boolean {
  return /^fish(?:-|$)/.test(model);
}

export class FishTtsError extends Error {
  constructor(readonly kind: 'timeout' | 'upstream', message: string, readonly status?: number) {
    super(message);
    this.name = 'FishTtsError';
  }
}

function isWav(buf: Buffer): boolean {
  return buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WAVE';
}

/** One page of text → wav bytes. One AbortSignal covers the whole request (it is a single hop). */
export async function synthesiseFish(opts: {
  text: string;
  referenceId: string;
  config: FishTtsConfig;
  fetchImpl?: typeof fetch;
}): Promise<Buffer> {
  const doFetch = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${opts.config.baseUrl}/v1/tts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.config.apiKey}`,
        'Content-Type': 'application/json',
        model: opts.config.model,
      },
      body: JSON.stringify({
        text: opts.text,
        reference_id: opts.referenceId,
        format: 'wav',
        latency: 'normal',
        normalize: true,
      }),
      signal: AbortSignal.timeout(opts.config.timeoutMs),
    });
  } catch (err) {
    if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
      throw new FishTtsError('timeout', `Fish Audio request timed out after ${opts.config.timeoutMs}ms`);
    }
    throw err;
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw new FishTtsError('upstream', `Fish Audio HTTP ${res.status}`, res.status);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (!isWav(buf)) throw new FishTtsError('upstream', 'Fish Audio response is not a RIFF/WAVE file');
  return buf;
}
