import express, { Router } from 'express';
import { AiQuotaError, aiModels, gatewayFetch, quotaBody, quotaErrorOf, quotaStatus, readAiGateway, type AiGateway } from '../ai-gateway.js';

/**
 * Speech-to-text for the player's own voice input.
 *
 * `POST /api/stt` takes one short recording as the raw request body and returns
 * its transcript. The browser only fills the draft with it; nothing is sent to
 * the writer or a character until the player presses Send. `GET /api/stt/config`
 * tells the UI whether the feature is usable without exposing any credential.
 *
 * Like TTS, config is re-read per request (no module-level client), so an
 * operator can set or rotate `OPENAI_API_KEY` / `OPENAI_BASE_URL` from the
 * connection settings without restarting, and tests can point it at a stub.
 */

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-transcribe';
/** A minute of Opus is well under 1MB; the cap only stops accidental floods. */
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 30_000;
/** ISO-639-1 hints the UI can send; anything else lets the model auto-detect. */
const LANGUAGES = new Set(['en', 'ja', 'zh', 'ko']);

export interface SttConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  /**
   * True when there is no OpenAI key and the Worldlines AI service stands in
   * (ai-gateway.ts): `apiKey`/`baseUrl` are then the service's, and it only
   * offers whole-file transcription, not the Realtime socket.
   */
  viaGateway: boolean;
  gateway?: AiGateway;
}

export function readSttConfig(): SttConfig {
  const apiKey = (process.env.OPENAI_API_KEY ?? '').trim();
  const gateway = apiKey ? null : readAiGateway();
  if (gateway) return { apiKey: gateway.apiKey, baseUrl: gateway.base, model: (process.env.AIRP_STT_MODEL || aiModels().stt).trim(), viaGateway: true, gateway };
  return {
    apiKey,
    baseUrl: (process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL).trim().replace(/\/+$/, ''),
    model: (process.env.AIRP_STT_MODEL || DEFAULT_MODEL).trim(),
    viaGateway: false,
  };
}

/**
 * One recording → its transcript (`POST <base>/audio/transcriptions`). Throws
 * AiQuotaError on a plan stop, a plain Error (status only) otherwise.
 */
export async function transcribe(config: SttConfig, audio: Blob, filename: string, language?: string): Promise<string> {
  const form = new FormData();
  form.append('file', audio, filename);
  form.append('model', config.model);
  form.append('response_format', 'json');
  if (language) form.append('language', language);
  const init = { method: 'POST', headers: { Authorization: `Bearer ${config.apiKey}` }, body: form, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) };
  const url = `${config.baseUrl}/audio/transcriptions`;
  const upstream = config.gateway ? await gatewayFetch(config.gateway, url, init) : await fetch(url, init);
  const quota = await quotaErrorOf(upstream);
  if (quota) throw quota;
  if (!upstream.ok) throw new Error(`HTTP ${upstream.status}`);
  const data = (await upstream.json()) as { text?: unknown };
  return typeof data.text === 'string' ? data.text.trim() : '';
}

/** Upload filename extension; the transcription API infers the codec from it. */
export function audioExtension(contentType: string): string | null {
  if (contentType.includes('webm')) return 'webm';
  if (contentType.includes('ogg')) return 'ogg';
  if (contentType.includes('mp4') || contentType.includes('m4a') || contentType.includes('aac')) return 'mp4';
  if (contentType.includes('wav')) return 'wav';
  if (contentType.includes('mpeg') || contentType.includes('mp3')) return 'mp3';
  return null;
}

export function createSttRouter(): Router {
  const router = Router();

  router.get('/stt/config', (_req, res) => {
    const config = readSttConfig();
    res.json({ available: config.apiKey !== '', model: config.model });
  });

  router.post(
    '/stt',
    express.raw({ type: ['audio/*', 'application/octet-stream'], limit: MAX_AUDIO_BYTES }),
    async (req, res) => {
      const config = readSttConfig();
      if (!config.apiKey) {
        return res.status(503).json({ ok: false, code: 'stt_unavailable', error: 'Voice input is not configured on this server.' });
      }
      const contentType = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
      const extension = audioExtension(contentType);
      const audio: unknown = req.body;
      if (!extension || !Buffer.isBuffer(audio) || audio.length === 0) {
        return res.status(400).json({ ok: false, code: 'invalid_audio', error: 'Send a non-empty audio recording.' });
      }
      const language = typeof req.query.language === 'string' && LANGUAGES.has(req.query.language)
        ? req.query.language
        : undefined;

      try {
        const text = await transcribe(config, new Blob([new Uint8Array(audio)], { type: contentType }), `speech.${extension}`, language);
        return res.json({ ok: true, text });
      } catch (err) {
        if (err instanceof AiQuotaError) return res.status(quotaStatus(err)).json(quotaBody(err));
        // Status only: never log the key, the base URL or what was said.
        const reason = err instanceof Error ? (err.message.startsWith('HTTP ') ? err.message : err.name) : 'Error';
        console.warn(`[AIRP STT] Transcription request failed (${reason}).`);
        return res.status(502).json({ ok: false, code: 'stt_failed', error: 'Could not transcribe the recording.' });
      }
    }
  );

  return router;
}
