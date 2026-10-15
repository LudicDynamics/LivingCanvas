// the player's own provider keys, kept only in
// this browser (apps/web/src/lib/local-key.ts, localStorage), never in the VFS,
// a world file or anything synced. The page hands the current routes to this
// Worker in a message; they live here in memory only.
//
// pi-ai's models.json and the server's AIRP_AI_BASE keep pointing at the
// Worldlines gateway with a placeholder key (worker.ts writeModelConfig), so
// switching needs no respawn and no reload: this fetch wrapper sits in front of
// the gateway fetch and, per capability the player moved to a key, sends the
// request from this tab straight to their provider:
//   chat   <gateway>/chat/completions      (the agents, the world intro, the workshop)
//   image  <gateway>/images/generations|edits   (generate_image, covers; the image
//          compression pipeline runs on the result as before)
//   tts    <gateway>/audio/speech          (character voices — NOT the studio voice:
//          the `local-tts` model stays on Worldlines; when that fails or the player is
//          signed out, tts.ts falls back to the online voice, which comes here)
//   stt    <gateway>/audio/transcriptions  (voice input, whole recording)
// For each:
//   - the URL becomes `<provider base>/<same path>`;
//   - fresh headers: content-type / accept from the caller and
//     `authorization: Bearer <the player's key>` — the account token the server
//     put on the request, and SDK extras (x-stainless-*), are dropped;
//   - `model` becomes the player's model (JSON or multipart), the body is adapted
//     to the provider (DeepSeek-compat chat fields, voices, TTS extras);
//   - `credentials: 'omit'`, `redirect: 'error'`: the key cannot follow a redirect;
//   - 401 / 402 / 403 → a clear message naming the player's own key (never the
//     Worldlines sign-in panel); "billing" in it makes pi treat it as a hard stop.
// Everything else (Voice Live, the studio voice, any capability left on
// Worldlines, any other host) passes to the gateway fetch unchanged, with the
// account's token — the player's key never reaches ai.worldlines.gg, and the
// account token never reaches the provider.
import { VOICES, liveVoiceForAlias } from '../../../../packages/shared/src/rules/voices';

export type LocalKeyFlavor = 'deepseek' | 'openai' | 'openrouter' | 'custom';
export type LocalKeyCapability = 'chat' | 'image' | 'tts' | 'stt';
export interface LocalKeyRoute {
  /** OpenAI-compatible base, e.g. `https://api.deepseek.com` or `https://api.openai.com/v1`. */
  base: string;
  key: string;
  model: string;
  flavor: LocalKeyFlavor;
  /** tts: the voice when the character's voice has no provider equivalent. */
  voice?: string;
  /** chat: the model's context window when known (worker.ts writes it into models.json for new agents). */
  contextWindow?: number;
}
export type LocalKeyRoutes = Partial<Record<LocalKeyCapability, LocalKeyRoute>>;

const FLAVORS: readonly LocalKeyFlavor[] = ['deepseek', 'openai', 'openrouter', 'custom'];
export const CAPABILITIES: readonly LocalKeyCapability[] = ['chat', 'image', 'tts', 'stt'];
/** The Worldlines studio voice model (ai-gateway.ts aiModels().ttsLocal): never moved to a player's key. */
export const STUDIO_TTS_MODEL = /^local(-tts)?$/i;

/** A base the key may go to: https (or http on this machine), no credentials / query, never a Worldlines host. */
export function safeProviderBase(raw: string): string | null {
  let u: URL;
  try { u = new URL(String(raw ?? '').trim()); } catch { return null; }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return null;
  if (u.username || u.password || u.search || u.hash) return null;
  const host = u.hostname.toLowerCase();
  if (host === 'worldlines.gg' || host.endsWith('.worldlines.gg')) return null;
  return `${u.origin}${u.pathname}`.replace(/\/+$/, '');
}

function parseRoute(raw: unknown): LocalKeyRoute | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  const base = typeof c.base === 'string' ? safeProviderBase(c.base) : null;
  const key = typeof c.key === 'string' ? c.key.trim() : '';
  const model = typeof c.model === 'string' ? c.model.trim() : '';
  const flavor = FLAVORS.includes(c.flavor as LocalKeyFlavor) ? c.flavor as LocalKeyFlavor : 'custom';
  if (!base || !key || !model || key.length > 1024 || model.length > 200 || /\s/.test(key)) return null;
  const voice = typeof c.voice === 'string' && /^[A-Za-z0-9 _-]{1,40}$/.test(c.voice.trim()) ? c.voice.trim() : undefined;
  const cw = typeof c.contextWindow === 'number' && Number.isInteger(c.contextWindow) && c.contextWindow >= 4000 && c.contextWindow <= 10_000_000 ? c.contextWindow : undefined;
  return { base, key, model, flavor, ...(voice ? { voice } : {}), ...(cw ? { contextWindow: cw } : {}) };
}

/** The page's message → the routes this Worker will use ({} = everything on Worldlines). */
export function parseLocalKeyRoutes(raw: unknown): LocalKeyRoutes {
  const out: LocalKeyRoutes = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const cap of CAPABILITIES) {
    const r = parseRoute((raw as Record<string, unknown>)[cap]);
    if (r) out[cap] = r;
  }
  return out;
}

/** Which capability a gateway URL is, or null (left on Worldlines). */
export function capabilityOf(href: string, gatewayBase: string): LocalKeyCapability | null {
  const base = gatewayBase.replace(/\/+$/, '');
  const path = href.split('?')[0];
  if (!path.startsWith(`${base}/`)) return null;
  const rest = path.slice(base.length);
  if (rest === '/chat/completions') return 'chat';
  if (rest === '/images/generations' || rest === '/images/edits') return 'image';
  if (rest === '/audio/speech') return 'tts';
  if (rest === '/audio/transcriptions') return 'stt';
  return null;
}

/** OpenAI's reasoning models take `reasoning_effort`; the others refuse it. */
const openaiReasoning = (model: string) => /^(o\d|gpt-5)/i.test(model);

/** The agents' chat body (DeepSeek compat) → what this provider accepts, with the player's model. */
export function adaptChatBody(body: string, route: LocalKeyRoute): string {
  let p: any;
  try { p = JSON.parse(body); } catch { return body; }
  if (!p || typeof p !== 'object') return body;
  p.model = route.model;
  if (route.flavor !== 'deepseek') {
    delete p.thinking;
    if (Array.isArray(p.messages)) for (const m of p.messages) if (m && typeof m === 'object') delete m.reasoning_content;
  }
  if (route.flavor === 'openai') {
    if (p.max_tokens !== undefined && p.max_completion_tokens === undefined) p.max_completion_tokens = p.max_tokens;
    delete p.max_tokens;
    if (!openaiReasoning(route.model)) delete p.reasoning_effort;
  } else if (route.flavor === 'openrouter') {
    // OpenRouter normalises reasoning through its own object.
    if (typeof p.reasoning_effort === 'string') p.reasoning = { effort: p.reasoning_effort };
    delete p.reasoning_effort;
  } else if (route.flavor === 'custom') {
    delete p.reasoning_effort;
  }
  return JSON.stringify(p);
}

/** OpenAI speech voices; the character's DashScope voice is cast as for a Live call (voices.ts), unknown → the player's pick. */
const OPENAI_TTS_VOICES = new Set(['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse', 'marin', 'cedar']);

/** The server's speech body (DashScope voice, language_type, emotion) → the provider's. */
export function adaptSpeechBody(body: string, route: LocalKeyRoute): string {
  let p: any;
  try { p = JSON.parse(body); } catch { return body; }
  if (!p || typeof p !== 'object') return body;
  p.model = route.model;
  if (route.flavor === 'openai') {
    const given = typeof p.voice === 'string' ? p.voice : '';
    const entry = VOICES.find((v) => v.id === given || v.alias === given);
    const cast = OPENAI_TTS_VOICES.has(given.toLowerCase()) ? given.toLowerCase() : entry ? liveVoiceForAlias(entry.alias) : undefined;
    p.voice = cast && OPENAI_TTS_VOICES.has(cast) ? cast : route.voice ?? 'coral';
    delete p.language;
    delete p.emotion;
    if (/^tts-1/i.test(route.model)) delete p.instructions;
  } else {
    // A custom OpenAI-compatible speech endpoint (the player ticked 语音合成): OpenAI's shape, the player's voice.
    if (route.voice) p.voice = route.voice;
    delete p.emotion;
    if (route.flavor === 'custom') delete p.language;
  }
  return JSON.stringify(p);
}

/** A JSON body with the player's model, or a multipart body rebuilt with it. */
async function withModel(body: BodyInit | null | undefined, model: string): Promise<BodyInit | null | undefined> {
  if (typeof body === 'string') {
    try { const p = JSON.parse(body); if (p && typeof p === 'object') { p.model = model; return JSON.stringify(p); } } catch { /* not JSON */ }
    return body;
  }
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    const form = new FormData();
    for (const [k, v] of body.entries()) if (k !== 'model') form.append(k, v as any);
    form.append('model', model);
    return form;
  }
  return body;
}

export const LOCAL_KEY_REFUSED = 'Your own API key was refused by the model provider (local key, {status}). Check the key, its billing balance and the model name in the account panel, or switch back to Worldlines credits.';

const refused = (status: number, detail: string) => new Response(JSON.stringify({
  error: { message: `${LOCAL_KEY_REFUSED.replace('{status}', String(status))}${detail ? ` — ${detail.slice(0, 300)}` : ''}`, type: 'authentication_error', code: 'local_key_refused' },
}), { status, headers: { 'content-type': 'application/json' } });

/** A stream that errors as a retryable network error if its source breaks mid-way (same as the gateway's). */
function guardStream(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) controller.close(); else controller.enqueue(value);
      } catch (e) {
        controller.error(new Error(`network error: the model stream was cut (${(e as Error)?.message ?? e}); retrying is safe`));
      }
    },
    cancel(reason) { return reader.cancel(reason); },
  });
}

export interface LocalKeyFetchOptions {
  /** The Worldlines gateway base the agents and the server are configured with (`https://ai.worldlines.gg/v1`). */
  gatewayBase: string;
  /** The current routes, read per request ({} = everything on Worldlines). */
  current: () => LocalKeyRoutes;
}

/**
 * `next` = the gateway fetch (account token), `direct` = the plain fetch.
 * Only the four capability URLs under the gateway are ever redirected, and only
 * those the player moved to a key.
 */
export function createLocalKeyFetch(next: typeof fetch, direct: typeof fetch, opts: LocalKeyFetchOptions): typeof fetch {
  const gatewayBase = opts.gatewayBase.replace(/\/+$/, '');
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const cap = capabilityOf(href, gatewayBase);
    const route = cap ? opts.current()[cap] : undefined;
    if (!cap || !route) return next(input as RequestInfo, init);
    let reqInit: RequestInit = init ?? {};
    if (input instanceof Request) {
      const isForm = (input.headers.get('content-type') ?? '').includes('multipart/form-data');
      const body = input.method === 'GET' || input.method === 'HEAD' ? undefined : isForm ? await input.formData() : await input.text();
      reqInit = { method: input.method, headers: input.headers, body, signal: input.signal, ...init };
    }
    // The studio voice is ours alone: it stays on Worldlines (and falls back to the online voice → here).
    if (cap === 'tts' && typeof reqInit.body === 'string') {
      try { if (STUDIO_TTS_MODEL.test(String(JSON.parse(reqInit.body)?.model ?? ''))) return next(input as RequestInfo, init); } catch { /* not JSON */ }
    }
    const given = new Headers(reqInit.headers);
    const headers = new Headers();
    let body: BodyInit | null | undefined = reqInit.body;
    if (cap === 'chat' && typeof body === 'string') body = adaptChatBody(body, route);
    else if (cap === 'tts' && typeof body === 'string') body = adaptSpeechBody(body, route);
    else body = await withModel(body, route.model);
    // A rebuilt multipart body sets its own boundary: never copy the old content-type onto it.
    const multipart = typeof FormData !== 'undefined' && body instanceof FormData;
    for (const k of multipart ? ['accept'] : ['content-type', 'accept']) { const v = given.get(k); if (v) headers.set(k, v); }
    headers.set('authorization', `Bearer ${route.key}`);
    const url = `${route.base}${href.split('?')[0].slice(gatewayBase.length)}`;
    const res = await direct(url, {
      method: reqInit.method ?? 'POST', body, headers, signal: reqInit.signal, credentials: 'omit', redirect: 'error',
    });
    if (res.status === 401 || res.status === 402 || res.status === 403) {
      const detail = await res.text().catch(() => '');
      return refused(res.status, detail);
    }
    if (cap !== 'chat' || !res.ok || !res.body) return res;
    return new Response(guardStream(res.body), { status: res.status, statusText: res.statusText, headers: res.headers });
  }) as typeof fetch;
}
