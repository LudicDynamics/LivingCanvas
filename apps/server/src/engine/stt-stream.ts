import WebSocket, { type RawData } from 'ws';
import { readSttConfig, transcribe, type SttConfig } from '../routes/stt.js';
import { AiQuotaError, pcm16Wav } from '../ai-gateway.js';

/**
 * Live voice-input transcription relay.
 *
 * Browser ⇄ `/ws/stt` ⇄ OpenAI Realtime transcription session (GA API). The
 * key never leaves the server.
 *
 * - Browser → server: binary frames of 24kHz mono PCM16, and `{type:'stop'}`
 *   to flush the last utterance.
 * - Server → browser: `{type:'ready'}`, `{type:'delta', itemId, delta}`,
 *   `{type:'completed', itemId, transcript}`, `{type:'error', code}`.
 *
 * Transcripts are only draft text for the player; nothing here talks to the
 * writer or a character.
 *
 * Through the Worldlines AI service (no OpenAI key here, `readSttConfig().viaGateway`)
 * there is no Realtime socket: the PCM is kept until `stop` (or the cap), sent
 * as one wav to `/audio/transcriptions`, and comes back as a single
 * `completed`. `{type:'transcribing'}` tells the browser to wait for it.
 */

export const STT_STREAM_PATH = '/ws/stt';
/** Hard cap on one session; the browser already stops itself at 60s. */
const MAX_SESSION_MS = 90_000;
export const STREAM_SAMPLE_RATE = 24_000;

export function realtimeTranscriptionUrl(baseUrl: string): string {
  return `${baseUrl.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:')}/realtime?intent=transcription`;
}

function toBuffer(data: RawData): Buffer {
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.isBuffer(data) ? data : Buffer.from(data);
}

export function handleSttStream(client: WebSocket, WebSocketImpl: typeof WebSocket = WebSocket): void {
  const send = (message: Record<string, unknown>) => {
    if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(message));
  };
  const config = readSttConfig();
  if (!config.apiKey) {
    send({ type: 'error', code: 'stt_unavailable' });
    client.close();
    return;
  }

  if (config.viaGateway) { handleBatchStream(client, config, send); return; }

  const upstream = new WebSocketImpl(realtimeTranscriptionUrl(config.baseUrl), {
    headers: { Authorization: `Bearer ${config.apiKey}` },
  });
  const queued: string[] = [];
  let open = false;
  let finished = false;
  const toUpstream = (event: Record<string, unknown>) => {
    const payload = JSON.stringify(event);
    if (open) upstream.send(payload);
    else queued.push(payload);
  };
  const finish = (code?: string) => {
    if (finished) return;
    finished = true;
    clearTimeout(cap);
    if (code) send({ type: 'error', code });
    try { upstream.close(); } catch { /* already gone */ }
    try { client.close(); } catch { /* already gone */ }
  };
  const cap = setTimeout(() => finish(), MAX_SESSION_MS);

  upstream.on('open', () => {
    open = true;
    // No language: players often speak something other than the UI language.
    upstream.send(JSON.stringify({
      type: 'session.update',
      session: {
        type: 'transcription',
        audio: {
          input: {
            format: { type: 'audio/pcm', rate: STREAM_SAMPLE_RATE },
            transcription: { model: config.model },
            turn_detection: { type: 'server_vad', silence_duration_ms: 500 },
          },
        },
      },
    }));
    for (const payload of queued.splice(0)) upstream.send(payload);
    send({ type: 'ready' });
  });

  upstream.on('message', (raw) => {
    let event: Record<string, any>;
    try { event = JSON.parse(toBuffer(raw).toString()); } catch { return; }
    if (event.type === 'conversation.item.input_audio_transcription.delta') {
      send({ type: 'delta', itemId: String(event.item_id ?? ''), delta: String(event.delta ?? '') });
    } else if (event.type === 'conversation.item.input_audio_transcription.completed') {
      send({ type: 'completed', itemId: String(event.item_id ?? ''), transcript: String(event.transcript ?? '') });
    } else if (event.type === 'error') {
      const code = event.error?.code;
      // `stop` after server VAD already committed the last utterance: harmless.
      if (code === 'input_audio_buffer_commit_empty') return;
      console.warn(`[AIRP STT] Realtime transcription error (${code ?? 'unknown'}).`);
      send({ type: 'error', code: 'stt_failed' });
    }
  });
  // Status/name only: never log the key, the base URL or what was said.
  upstream.on('unexpected-response', (_req, res) => {
    console.warn(`[AIRP STT] Realtime transcription refused (${res.statusCode}).`);
    finish('stt_failed');
  });
  upstream.on('error', (err) => {
    console.warn(`[AIRP STT] Realtime transcription connection failed (${err.name}).`);
    finish('stt_failed');
  });
  upstream.on('close', () => finish());

  client.on('message', (data, isBinary) => {
    if (isBinary) {
      const audio = toBuffer(data);
      if (audio.length > 0) toUpstream({ type: 'input_audio_buffer.append', audio: audio.toString('base64') });
      return;
    }
    let message: Record<string, unknown> | null = null;
    try { message = JSON.parse(toBuffer(data).toString()); } catch { return; }
    if (message?.type === 'stop') toUpstream({ type: 'input_audio_buffer.commit' });
  });
  client.on('close', () => finish());
}

/** ~90 s of 24 kHz PCM16: the session cap, so a stuck client cannot grow the heap. */
const MAX_BATCH_BYTES = STREAM_SAMPLE_RATE * 2 * (MAX_SESSION_MS / 1000);

function handleBatchStream(client: WebSocket, config: SttConfig, send: (message: Record<string, unknown>) => void): void {
  const chunks: Buffer[] = [];
  let bytes = 0;
  let done = false;
  const finish = async () => {
    if (done) return;
    done = true;
    clearTimeout(cap);
    if (bytes > 0) {
      send({ type: 'transcribing' });
      try {
        const wav = pcm16Wav(Buffer.concat(chunks), STREAM_SAMPLE_RATE);
        const transcript = await transcribe(config, new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'speech.wav');
        send({ type: 'completed', itemId: 'batch-1', transcript });
      } catch (err) {
        // Status/name only: never log the base URL or what was said.
        if (err instanceof AiQuotaError) send({ type: 'error', code: err.code, message: err.message, ...(err.billingUrl ? { billingUrl: err.billingUrl } : {}) });
        else {
          console.warn(`[AIRP STT] Transcription request failed (${err instanceof Error ? err.message : 'Error'}).`);
          send({ type: 'error', code: 'stt_failed' });
        }
      }
    }
    try { client.close(); } catch { /* already gone */ }
  };
  const cap = setTimeout(() => void finish(), MAX_SESSION_MS);
  send({ type: 'ready' });
  client.on('message', (data, isBinary) => {
    if (done) return;
    if (isBinary) {
      const audio = toBuffer(data);
      if (bytes + audio.length > MAX_BATCH_BYTES) { void finish(); return; }
      chunks.push(audio);
      bytes += audio.length;
      return;
    }
    let message: Record<string, unknown> | null = null;
    try { message = JSON.parse(toBuffer(data).toString()); } catch { return; }
    if (message?.type === 'stop') void finish();
  });
  // The player left before stopping: nothing to fill, nothing to bill.
  client.on('close', () => { done = true; clearTimeout(cap); });
}
