import type { ImageProvider } from './image-provider.js';

/** Keep diagnostic fields, never dump request bodies, credentials or gateway HTML. */
async function upstreamError(response: Response, secrets: string[], prompt: string): Promise<string> {
  const clean = (value: string) => {
    for (const secret of [...secrets, prompt].filter(Boolean)) value = value.split(secret).join('[redacted]');
    return value.replace(/Bearer\s+[^\s"']+/gi, 'Bearer [redacted]')
      .replace(/sk-[\w-]+/g, '[redacted]')
      .replace(/https?:\/\/[^\s"']+/g, '[url omitted]')
      .replace(/[\x00-\x1f]/g, ' ').slice(0, 700);
  };
  try {
    const body = await response.json();
    const error = body?.error ?? body;
    const fields = typeof error === 'string' ? [`message=${clean(error)}`] :
      ['code', 'type', 'param', 'reason', 'message'].flatMap(key => typeof error?.[key] === 'string' ? [`${key}=${clean(error[key])}`] : []);
    return fields.length ? `: ${fields.join('; ').slice(0, 1400)}` : '';
  } catch { return ' (upstream error body unavailable or non-JSON)'; }
}

/**
 * Key and base for one call. An own OPENAI_API_KEY wins; without one, the
 * Worldlines AI service (`AIRP_AI_BASE`, apps/server/src/ai-gateway.ts) — in
 * the browser runtime the Worker's gateway fetch puts the account's token in
 * place of the placeholder key.
 */
function endpointOf(env: NodeJS.ProcessEnv): { apiKey: string; base: string } | null {
  if (env.OPENAI_API_KEY) return { apiKey: env.OPENAI_API_KEY, base: env.AIRP_IMAGE_BASE_URL ?? env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1' };
  const gateway = (env.AIRP_AI_BASE ?? '').trim();
  if (gateway) return { apiKey: (env.AIRP_AI_KEY ?? '').trim() || 'worldlines-account', base: gateway };
  return null;
}

/**
 * gpt-image models accept exactly three sizes (plus `auto`); anything else is an
 * upstream 400. Snap the requested box to the nearest aspect bucket: clearly
 * wider than tall → landscape, clearly taller → portrait, otherwise square.
 */
export const OPENAI_IMAGE_SIZES = ['1024x1024', '1536x1024', '1024x1536'] as const;
export function normalizeOpenAIImageSize(width: number, height: number): (typeof OPENAI_IMAGE_SIZES)[number] {
  const w = Number(width), h = Number(height);
  if (!(w > 0) || !(h > 0)) return '1024x1024';
  const ratio = w / h;
  // Midpoints between 1:1 and 3:2 (and 2:3) in log space: sqrt(1.5) ≈ 1.2247.
  if (ratio >= Math.sqrt(1.5)) return '1536x1024';
  if (ratio <= 1 / (Math.sqrt(1.5))) return '1024x1536';
  return '1024x1024';
}

/** Default quality when AIRP_IMAGE_QUALITY is unset: matches the plans' "standard" tier. */
export const OPENAI_IMAGE_DEFAULT_QUALITY = 'medium';

/** The OpenRouter default (doc-tools/11 §4.3.3) — only when nothing points at OpenAI. */
export const OPENROUTER_DEFAULT_IMAGE_MODEL = 'openrouter/google/gemini-2.5-flash-image';
export const OPENAI_DEFAULT_IMAGE_MODEL = 'openai/gpt-image-1';

/**
 * The image model id generate_image (and the cover painter) will use: AIRP_IMAGE_MODEL when set; otherwise
 * OpenAI's gpt-image-1 whenever this machine can reach OpenAI's Images API — an own OPENAI_API_KEY without an
 * OPENROUTER_API_KEY, or the Worldlines AI service (AIRP_AI_BASE) — and the OpenRouter default only otherwise.
 * (Before: an own OpenAI key alone fell back to OpenRouter and failed with no_credentials.)
 */
export function resolveImageModelId(env: NodeJS.ProcessEnv = process.env): string {
  const set = (env.AIRP_IMAGE_MODEL ?? '').trim();
  if (set) return set;
  const has = (k: string) => Boolean((env[k] ?? '').trim());
  if (has('OPENROUTER_API_KEY')) return OPENROUTER_DEFAULT_IMAGE_MODEL;
  if (has('OPENAI_API_KEY') || has('AIRP_AI_BASE')) return OPENAI_DEFAULT_IMAGE_MODEL;
  return OPENROUTER_DEFAULT_IMAGE_MODEL;
}

/** Project-owned Images protocol adapter. No pi-rp registry or SDK dependency. */
export function createOpenAIImageProvider(model: string, env: NodeJS.ProcessEnv = process.env, request: typeof fetch = fetch): ImageProvider {
  return {
    id: 'openai', model, supportsReference: true,
    async generate(req, opts) {
      const endpoint = endpointOf(env);
      if (!endpoint) return { ok: false, reason: 'no_credentials', message: 'OPENAI_API_KEY is not set' };
      const quality = (env.AIRP_IMAGE_QUALITY ?? '').trim() || OPENAI_IMAGE_DEFAULT_QUALITY;
      if (!['auto', 'low', 'medium', 'high'].includes(quality)) return { ok: false, reason: 'provider_error', message: 'Invalid image quality' };
      const controller = new AbortController();
      let timedOut = false;
      const abort = () => controller.abort();
      opts.signal?.addEventListener('abort', abort, { once: true });
      if (opts.signal?.aborted) abort();
      const timer = setTimeout(() => { timedOut = true; abort(); }, opts.timeoutMs ?? 120_000);
      try {
        controller.signal.throwIfAborted();
        const params = { model, prompt: req.prompt, n: 1, output_format: 'png', size: normalizeOpenAIImageSize(req.width, req.height), quality };
        let body: string | FormData = JSON.stringify(params);
        const headers: Record<string, string> = { Authorization: `Bearer ${endpoint.apiKey}` };
        if (req.reference) {
          body = new FormData();
          for (const [key, value] of Object.entries(params)) body.set(key, String(value));
          body.set('image', new Blob([Buffer.from(req.reference.dataB64, 'base64')], { type: req.reference.mimeType }), 'reference.png');
        } else headers['Content-Type'] = 'application/json';
        if (opts.scene === 'in-progress') headers['X-Worldlines-Scene'] = 'in-progress';
        const base = endpoint.base.replace(/\/+$/, '');
        const response = await request(`${base}/images/${req.reference ? 'edits' : 'generations'}`, { method: 'POST', headers, body, signal: controller.signal, redirect: 'error' });
        if (!response.ok) return { ok: false, reason: 'provider_error', message: `Image endpoint returned HTTP ${response.status} [size=${params.size}, quality=${quality}, reference=${!!req.reference}]${await upstreamError(response, [endpoint.apiKey], req.prompt)}` };
        const data = await response.json() as { data?: { b64_json?: string }[] };
        const image = data.data?.find(item => typeof item.b64_json === 'string' && item.b64_json.length > 0);
        return image?.b64_json ? { ok: true, mimeType: 'image/png', dataB64: image.b64_json } : { ok: false, reason: 'no_image', message: 'Image endpoint returned no base64 image' };
      } catch {
        return { ok: false, reason: opts.signal?.aborted ? 'aborted' : timedOut ? 'timeout' : 'provider_error', message: opts.signal?.aborted ? 'Generation cancelled' : timedOut ? 'Image generation timed out' : 'Image request failed' };
      } finally {
        clearTimeout(timer);
        opts.signal?.removeEventListener('abort', abort);
      }
    },
  };
}
