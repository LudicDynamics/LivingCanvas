import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { Router, type Request as ExpressRequest, type Response as ExpressResponse } from 'express';
import { remoteConfigFile } from './sync/remote-client.js';
import { WORLD_HEADER, gatewayWorld } from './gateway-world.js';
import { localTtsFlag, resolveImageModelId } from '@airp/shared';

/**
 * The Worldlines AI service (ai.worldlines.gg, OpenAI-compatible) as the
 * provider for chat, speech, transcription and images when this server holds
 * no provider key of its own — billed to the signed-in Worldlines account.
 *
 * Two ways it switches on:
 *   - `AIRP_AI_BASE` (e.g. `https://ai.worldlines.gg/v1`). The browser runtime
 *     sets it to the base chat uses (VITE_AIRP_MODEL_BASE); there the Worker's
 *     gateway fetch (apps/browser-runtime/src/platform/model-gateway.ts) also
 *     puts in the account's token. `AIRP_AI_KEY` instead names a personal
 *     access token for a host that is not signed in.
 *   - the local app (`pnpm dev`) signed in to the account (remote.json holds a
 *     session): `https://ai.worldlines.gg/v1` (`AIRP_AI_ACCOUNT_BASE`
 *     overrides), `AIRP_AI_ACCOUNT=0` turns it off. `gatewayFetch` sends the
 *     session's access token (refreshed by remote-client.ts),
 *     `X-Worldlines-Product: livingcanvas` and the open world
 *     (`X-Worldlines-World`, gateway-world.ts). The agents (separate processes,
 *     which must never hold the session) reach it through this server's
 *     loopback proxy (`createAiProxyRouter`), which adds the token.
 *
 * Precedence is always "own key first": a configured DASHSCOPE_API_KEY,
 * OPENAI_API_KEY or local TTS URL keeps its direct call exactly as before; the
 * service only fills in what is missing. Re-read per call, like every other
 * provider config here.
 */
export interface AiGateway {
  base: string;
  apiKey: string;
  /** Calls carry the signed-in account's token (gatewayFetch) instead of `apiKey`. */
  account: boolean;
}

export const PRODUCT = 'livingcanvas';
export const DEFAULT_AI_BASE = 'https://ai.worldlines.gg/v1';

/** Is this computer signed in to its Worldlines account (a session in remote.json)? Never reads a token out. */
export function accountSignedIn(): boolean {
  try {
    const stored = JSON.parse(fs.readFileSync(remoteConfigFile(), 'utf8')) as { session?: { accessToken?: unknown } };
    return typeof stored.session?.accessToken === 'string' && stored.session.accessToken !== '';
  } catch { return false; }
}

/**
 * A guest session on this computer (sync/guest-session.ts keeps `guest.json` beside remote.json) while the
 * guest trial is on (`AIRP_GUEST_TRIAL=1`). Read here by path, not imported, to keep this module free of the
 * sync layer. Never reads a token out.
 */
export function guestSessionHere(env: NodeJS.ProcessEnv = process.env): boolean {
  if ((env.AIRP_GUEST_TRIAL ?? '').trim() !== '1') return false;
  try {
    const g = JSON.parse(fs.readFileSync(path.join(path.dirname(remoteConfigFile()), 'guest.json'), 'utf8')) as { accessToken?: unknown };
    return typeof g.accessToken === 'string' && g.accessToken !== '';
  } catch { return false; }
}

/**
 * `guest`: also a trial guest's session (chat only — the agents, their proxy, "is a chat model there"). Voices,
 * pictures, transcription and the workshop's helpers leave it out: the service refuses guests those anyway, and
 * the page then reads them as simply unavailable, as before (no sign-in popup per line).
 */
export function readAiGateway(env: NodeJS.ProcessEnv = process.env, opts: { guest?: boolean } = {}): AiGateway | null {
  const base = (env.AIRP_AI_BASE ?? '').trim().replace(/\/+$/, '');
  if (base) {
    const key = (env.AIRP_AI_KEY ?? '').trim();
    return { base, apiKey: key || 'worldlines-account', account: !key };
  }
  // Signed in, or — signed out — a guest of the trial: the local app plays the trial
  // worlds (末班车 and its 5-minute prologue) on the guest's token the same way the browser version does.
  if ((env.AIRP_AI_ACCOUNT ?? '').trim() === '0' || !(accountSignedIn() || (opts.guest === true && guestSessionHere(env)))) return null;
  return { base: (env.AIRP_AI_ACCOUNT_BASE ?? '').trim().replace(/\/+$/, '') || DEFAULT_AI_BASE, apiKey: 'worldlines-account', account: true };
}

type TokenHook = (o: { force?: boolean }) => Promise<string | null>;
/**
 * The account's token, else the trial guest's (sync/guest-session.ts `__airpGuestToken`: null unless nobody is
 * signed in and the open world is a trial world — ai.worldlines.gg refuses a guest anything else anyway).
 */
const accountToken = async (force: boolean, chat: boolean): Promise<string | null> => {
  const hooks = globalThis as { __airpAccountToken?: TokenHook; __airpGuestToken?: TokenHook };
  const own = await hooks.__airpAccountToken?.({ force });
  if (own) return own;
  // A guest plays the story (chat) only — same rule as the browser runtime's gateway fetch.
  return chat ? (await hooks.__airpGuestToken?.({ force })) ?? null : null;
};
const isChatCall = (url: string) => { try { return /\/chat\/completions$/.test(new URL(url).pathname); } catch { return false; } };

const authRequired = () => new Response(JSON.stringify({ error: { code: 'auth_required', type: 'authentication_error', message: 'Sign in to your Worldlines account to use it here (auth required, 401).' } }), { status: 401, headers: { 'content-type': 'application/json' } });

/**
 * fetch for the service. Account mode: the session's access token (refreshed
 * when near expiry; on a 401 refreshed once more and retried once) and the
 * product header; never a redirect, so the token cannot follow one elsewhere.
 * Otherwise `apiKey` as sent by the caller. Either way the open world's id
 * (X-Worldlines-World) when there is one.
 */
export async function gatewayFetch(gateway: AiGateway, url: string, init: RequestInit = {}, request: typeof fetch = fetch): Promise<Response> {
  const world = gatewayWorld();
  const withWorld = (headers: Headers) => { headers.delete(WORLD_HEADER); if (world) headers.set(WORLD_HEADER, world); return headers; };
  if (!gateway.account) return billingStopResponse(await request(url, { ...init, headers: withWorld(new Headers(init.headers)) }));
  const send = (token: string) => {
    const headers = withWorld(new Headers(init.headers));
    headers.set('authorization', `Bearer ${token}`);
    headers.set('x-worldlines-product', PRODUCT);
    return request(url, { ...init, headers, redirect: 'error' });
  };
  const chat = isChatCall(url);
  let token = await accountToken(false, chat);
  if (!token) return authRequired();
  let res = await send(token);
  if (res.status !== 401) return billingStopResponse(res);
  await res.body?.cancel().catch(() => {});
  token = await accountToken(true, chat);
  if (!token) return authRequired();
  res = await send(token);
  return billingStopResponse(res);
}

/**
 * A 402 from the service (the wallet gate: `insufficient_credits`, reason
 * claim_required / insufficient_credits / debt_limit) → a friendly body whose
 * message names the reason (the page's notice picks the claim prompt or the
 * account card from it) and says "billing" (pi-ai utils/retry.ts: a hard
 * limit, never retried). Same text and shape as the browser runtime's
 * (apps/browser-runtime/src/platform/model-gateway.ts billingStop; keep in
 * step). Idempotent; anything but a 402 is returned unchanged.
 */
export const CREDITS_MESSAGES = {
  claim_required: "Today's free Worldlines credits are not claimed yet (claim_required; billing 402). Claim them to go on.",
  insufficient_credits: 'Not enough Worldlines credits to go on (insufficient_credits; billing 402). Redeem a code or upgrade your plan.',
  debt_limit: 'Your Worldlines balance is paused until it is topped up (insufficient_credits: debt_limit; billing 402).',
} as const;
export async function billingStopResponse(res: Response): Promise<Response> {
  if (res.status !== 402) return res;
  const payload = await res.clone().json().catch(() => null) as { error?: { reason?: unknown; kind?: unknown; billing_url?: unknown; resets_at?: unknown } } | null;
  await res.body?.cancel().catch(() => {});
  const e = payload?.error ?? {};
  const reason = e.reason === 'claim_required' || e.reason === 'debt_limit' ? e.reason : 'insufficient_credits';
  const str = (k: string, v: unknown) => (typeof v === 'string' && v ? { [k]: v } : {});
  return new Response(JSON.stringify({ error: { message: CREDITS_MESSAGES[reason], type: 'insufficient_quota', code: 'insufficient_credits', reason, ...str('kind', e.kind), ...str('billing_url', e.billing_url), ...str('resets_at', e.resets_at) } }), { status: 402, headers: { 'content-type': 'application/json' } });
}

/** Model names the service routes on; operator-overridable, never sent to the browser. */
export function aiModels(env: NodeJS.ProcessEnv = process.env) {
  return {
    /** Online character voices (DashScope Qwen TTS behind the service). */
    tts: (env.AIRP_AI_TTS_MODEL ?? '').trim() || 'qwen3-tts-flash',
    /** The studio voice server (setsuna …) the service reaches over its tailnet. */
    ttsLocal: (env.AIRP_AI_TTS_LOCAL_MODEL ?? '').trim() || 'local-tts',
    stt: (env.AIRP_AI_STT_MODEL ?? '').trim() || 'gpt-4o-transcribe',
  };
}

/**
 * The codes a billing stop reaches the player with (an `airp:notice` detail):
 * `quota_exceeded` (429, the plan's fuse), `claim_required` (402, today's
 * claim-only allowance not claimed yet) and `insufficient_credits` (402, the
 * wallet cannot pay: redeem / top up / upgrade) and `debt_limit` (402
 * insufficient_credits whose reason is debt_limit: the balance is paused until
 * topped up).
 */
export type AiBillingStop = 'quota_exceeded' | 'claim_required' | 'insufficient_credits' | 'debt_limit';

/** The service refused the call for billing: plan used up (429) or wallet short (402). */
export class AiQuotaError extends Error {
  constructor(message: string, readonly billingUrl?: string, readonly kind?: string, readonly code: AiBillingStop = 'quota_exceeded') {
    super(message);
    this.name = 'AiQuotaError';
  }
}

export const QUOTA_TEXT = "Your Worldlines plan's quota is used up for now (quota exceeded).";
export const CREDITS_TEXT = 'Not enough credits for this call (insufficient_credits).';

/**
 * A billing stop in some error text (a tool error, a provider summary): the
 * most specific code it names, or null. `claim_required` wins because a 402
 * `insufficient_credits` whose reason is `claim_required` is fixed by claiming.
 */
export function billingStopOf(text: unknown): AiBillingStop | null {
  const s = String(text ?? '');
  if (/claim_required/.test(s)) return 'claim_required';
  if (/debt_limit/.test(s)) return 'debt_limit';
  if (/insufficient_credits/.test(s)) return 'insufficient_credits';
  if (/quota_exceeded/.test(s)) return 'quota_exceeded';
  return null;
}

/**
 * A 429 whose body says `quota_exceeded`, or a 402 `insufficient_credits`
 * (reason `claim_required` → that code) → AiQuotaError; anything else → null
 * (the caller keeps its own error mapping). Reads a clone, so the caller may
 * still consume the body.
 */
export async function quotaErrorOf(response: Response): Promise<AiQuotaError | null> {
  if (response.status !== 429 && response.status !== 402) return null;
  const body = await response.clone().json().catch(() => null) as
    { error?: { code?: unknown; message?: unknown; kind?: unknown; reason?: unknown; billing_url?: unknown } } | null;
  const error = body?.error;
  const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
  if (response.status === 429) {
    if (error?.code !== 'quota_exceeded') return null;
    return new AiQuotaError(str(error.message) ?? QUOTA_TEXT, str(error.billing_url), str(error.kind));
  }
  if (error?.code !== 'insufficient_credits') return null;
  const code: AiBillingStop = error.reason === 'claim_required' || error.reason === 'debt_limit' ? error.reason : 'insufficient_credits';
  return new AiQuotaError(str(error.message) ?? CREDITS_TEXT, str(error.billing_url), str(error.kind), code);
}

/** The HTTP status our routes answer a billing stop with (the service's own). */
export const quotaStatus = (error: AiQuotaError): 402 | 429 => (error.code === 'quota_exceeded' ? 429 : 402);

/** The `{ ok:false }` body our routes answer a billing stop with. */
export function quotaBody(error: AiQuotaError) {
  return {
    ok: false as const,
    code: error.code,
    error: error.message,
    ...(error.billingUrl ? { billingUrl: error.billingUrl } : {}),
    ...(error.kind ? { kind: error.kind } : {}),
  };
}

/** A minimal RIFF/WAVE container around mono PCM16 (the transcription upload). */
export function pcm16Wav(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'latin1');
  header.write('fmt ', 12, 'latin1');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'latin1');
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/**
 * The server's own small text jobs (一键补完 in the workshop and the intro):
 * DeepSeek with an own key, else the service. → null when neither.
 */
export function textModelEndpoint(env: NodeJS.ProcessEnv = process.env, request: typeof fetch = fetch): { baseUrl: string; apiKey: string; request: typeof fetch } | null {
  const apiKey = env.DEEPSEEK_API_KEY?.trim() ?? '';
  if (apiKey) return { baseUrl: (env.DEEPSEEK_BASE_URL?.trim() || 'https://api.deepseek.com').replace(/\/+$/, ''), apiKey, request };
  const gateway = readAiGateway(env);
  if (!gateway) return null;
  return { baseUrl: gateway.base, apiKey: gateway.apiKey, request: (url, init) => gatewayFetch(gateway, String(url), init, request) };
}

// ── the agents' way in: a loopback proxy that adds the account token ────────

/**
 * One secret per server process, in the proxy's PATH: the agents get it in
 * their model config / env; a web page on another origin cannot guess it, so
 * it cannot spend the account through `localhost` (CSRF). Not a credential
 * for the service — the session never leaves this process.
 */
const PROXY_SECRET = randomBytes(18).toString('base64url');
export const AI_PROXY_PATH = '/api/ai-proxy';

/** Where an agent on this computer reaches the service (OpenAI-compatible, ends in /v1). */
export function localAiProxyBase(env: NodeJS.ProcessEnv = process.env): string {
  const port = Number(env.PORT) || 3001;
  return `http://127.0.0.1:${port}${AI_PROXY_PATH}/${PROXY_SECRET}/v1`;
}

const LOOPBACK_PEERS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * `ANY /api/ai-proxy/<secret>/v1/*` → `<account base>/*` with the session
 * token. Loopback peers only, the per-process secret, account mode only. The
 * body is passed through untouched (JSON, multipart) except an optional model
 * rename (`AIRP_AI_MODEL_MAP`, JSON); the answer streams back as it comes.
 * Mounted BEFORE express.json() so the raw body is still unread.
 */
export function createAiProxyRouter(deps: { fetch?: typeof fetch } = {}): Router {
  const router = Router();
  router.all(`${AI_PROXY_PATH}/:secret/v1/*`, async (req: ExpressRequest<{ secret: string }>, res: ExpressResponse) => {
    if (!LOOPBACK_PEERS.has(req.socket.remoteAddress ?? '') || req.params.secret !== PROXY_SECRET) return res.status(403).json({ error: { code: 'forbidden', message: 'AI proxy: not allowed' } });
    const gateway = readAiGateway(process.env, { guest: true });
    if (!gateway?.account) return res.status(503).json({ error: { code: 'auth_required', message: 'Sign in to your Worldlines account (Settings → Account) to use the Worldlines AI service.' } });
    const marker = `${AI_PROXY_PATH}/${PROXY_SECRET}/v1/`;
    const rest = req.originalUrl.slice(req.originalUrl.indexOf(marker) + marker.length);
    if (/(^|\/)\.\.(\/|$)|%2e%2e|%2f|%5c/i.test(rest)) return res.status(403).json({ error: { code: 'forbidden', message: 'AI proxy: bad path' } });
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    let body: Uint8Array | string | undefined = ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks);
    const type = req.get('content-type') ?? '';
    if (body && type.includes('json')) body = renameModel(Buffer.from(body).toString('utf8'));
    const headers: Record<string, string> = { accept: req.get('accept') ?? '*/*' };
    if (type) headers['content-type'] = type;
    let upstream: globalThis.Response;
    try {
      upstream = await gatewayFetch(gateway, `${gateway.base}/${rest}`, { method: req.method, headers, body: body as BodyInit | undefined }, deps.fetch);
    } catch (error) {
      return res.status(502).json({ error: { code: 'unreachable', message: `The Worldlines AI service could not be reached (${error instanceof Error ? error.name : 'error'}).` } });
    }
    res.status(upstream.status);
    for (const name of ['content-type', 'x-worldlines-tts-provider', 'x-worldlines-tts-fallback']) {
      const value = upstream.headers.get(name);
      if (value) res.setHeader(name, value);
    }
    if (!upstream.body) return res.end();
    try { for await (const chunk of upstream.body as unknown as AsyncIterable<Uint8Array>) res.write(chunk); } catch { /* the stream was cut: the agent sees a short answer and retries */ }
    res.end();
  });
  return router;
}

function renameModel(body: string): string {
  let map: Record<string, string> = {};
  try { map = JSON.parse(process.env.AIRP_AI_MODEL_MAP || '{}'); } catch { return body; }
  if (!Object.keys(map).length) return body;
  try {
    const parsed = JSON.parse(body);
    if (typeof parsed?.model === 'string' && typeof map[parsed.model] === 'string') { parsed.model = map[parsed.model]; return JSON.stringify(parsed); }
  } catch { /* not JSON */ }
  return body;
}

// ── which way each capability goes (the connection panel) ─────────────────

export type AiPath = 'own' | 'local' | 'account' | 'service' | 'none';

/**
 * Per capability: `own` = this computer's provider key, `local` = its own
 * local TTS server, `account` = the signed-in Worldlines account through
 * ai.worldlines.gg, `service` = the service with a configured key / base
 * (AIRP_AI_BASE + AIRP_AI_KEY, or the browser runtime), `none` = unavailable.
 * Names and paths only — never a key or the session.
 */
export function aiRoutes(env: NodeJS.ProcessEnv = process.env) {
  const has = (k: string) => Boolean((env[k] ?? '').trim());
  const gateway = readAiGateway(env);
  const via: AiPath = gateway ? (gateway.account ? 'account' : 'service') : 'none';
  const pick = (own: boolean): AiPath => (own ? 'own' : via);
  // the model generate_image will actually use (resolveImageModelId), and whether THIS machine holds its key
  const image = resolveImageModelId(env);
  const imageOwn = image.startsWith('openrouter/') ? has('OPENROUTER_API_KEY') : image.startsWith('openai/') ? has('OPENAI_API_KEY') : false;
  // without its own key the image goes through the account / service (launch.ts points it at gpt-image-1 there);
  // with neither it is unavailable — never reported as "own"
  const imagePath: AiPath = imageOwn ? 'own' : via;
  return {
    chat: { deepseek: pick(has('DEEPSEEK_API_KEY')), openai: pick(has('OPENAI_API_KEY')) },
    tts: has('DASHSCOPE_API_KEY') ? 'own' as AiPath : has('AIRP_TTS_LOCAL_BASE_URL') && localTtsFlag(env) && !gateway ? 'local' as AiPath : via,
    stt: pick(has('OPENAI_API_KEY')),
    image: imagePath,
    signedIn: accountSignedIn(),
  };
}
