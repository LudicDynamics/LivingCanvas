// Model calls on a static site go to the Worldlines model gateway
// (ai.worldlines.gg, OpenAI-compatible) with the signed-in account's token —
// no provider key ever reaches the tab. pi-ai is configured with the gateway
// as every provider's baseUrl and a placeholder key; this fetch wrapper, for
// URLs under the gateway only:
//   - puts the account's current access token in `authorization`, adds
//     `X-Worldlines-Product` and, while a world is open, `X-Worldlines-World`
//     (its bare id, apps/server/src/gateway-world.ts — billing counts play from
//     the calls it served), and drops every other header but content-type /
//     accept (the gateway's CORS preflight allows nothing else);
//   - on 401 gets a refreshed token once and retries; still 401 → tells the page
//     to open the sign-in panel and answers with a clear, non-retryable error;
//   - 429 quota_exceeded → a friendly message that pi's retry logic treats as a
//     hard limit ("quota exceeded"), not as a transient 429 (kind / billing_url kept);
//   - 402 insufficient_credits (the wallet gate, billing enforcing credits) → the
//     same: a friendly, non-retryable message naming the reason (claim_required /
//     insufficient_credits / debt_limit) and "billing", so pi never retries it
//     (pi-ai utils/retry.ts: "billing" / insufficient_quota are hard limits) and
//     the page's notice picks the claim prompt or the account card; code, reason,
//     kind and billing_url kept in the body. apps/server/src/ai-gateway.ts
//     billingStopResponse does the same on the Node path (keep the two in step);
//   - the same for speech, transcription and images (apps/server/src/ai-gateway.ts):
//     a FormData body passes through and fetch sets its multipart content-type;
//   - optionally renames the model (`map`: the id the server asks for → the
//     gateway's id);
// - the guest trial: signed out, `guestToken` signs calls for the trial world
//     (null for any other world). A guest's 402 (trial credits used up), 403 (guest_world_only /
//     guest_not_allowed) or 503 guest_trial_unavailable → onAuthRequired('trial') and one friendly,
//     non-retryable 402 ("billing") that says: sign in to keep playing, the progress stays;
//   - `x-airp-quiet: 1` (a background call: character tick v2) → never onAuthRequired; the header is dropped;
//   - a response stream cut mid-way (the gateway's host ends requests at 120 s)
//     surfaces as a "network error: stream cut" error, which pi retries.
export interface GatewayOptions {
  base: string;
  product: string;
  map?: Record<string, string>;
  /** The account's access token; `force` = the last one was refused. Null = signed out. */
  token: (force: boolean) => Promise<string | null>;
  /** The guest trial's token when nobody is signed in (null = no trial for this call: not the trial world, none started). */
  guestToken?: (force: boolean) => Promise<string | null>;
  /** `trial` = a guest ran out of trial credits / reached past the trial: the page asks them to sign in. */
  onAuthRequired: (reason?: 'trial') => void;
  /** The open world's bare id (X-Worldlines-World); null / not an id = the header is left out. */
  world?: () => string | null | undefined;
}

export const WORLD_HEADER = 'x-worldlines-world';
const WORLD_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const json = (status: number, message: string, code: string, type = 'invalid_request_error', extra: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ error: { message, type, code, ...extra } }), { status, headers: { 'content-type': 'application/json' } });

export const SIGN_IN_MESSAGE = 'Sign in to your Worldlines account to continue the story (auth required, 401).';
export const QUOTA_MESSAGE = "Your Worldlines plan's model quota is used up for now (quota exceeded). It resets on its own; the story waits here.";

export type CreditsReason = 'claim_required' | 'insufficient_credits' | 'debt_limit';
/** The message of a 402 per reason: the reason word (the page matches it) and "billing" (pi: never retried). */
export const CREDITS_MESSAGES: Record<CreditsReason, string> = {
  claim_required: "Today's free Worldlines credits are not claimed yet (claim_required; billing 402). Claim them to go on.",
  insufficient_credits: 'Not enough Worldlines credits to go on (insufficient_credits; billing 402). Redeem a code or upgrade your plan.',
  debt_limit: 'Your Worldlines balance is paused until it is topped up (insufficient_credits: debt_limit; billing 402).',
};
/** A guest's stop (trial credits used up, or past what the trial allows): "billing" so pi never retries it. */
export const TRIAL_MESSAGE = 'The guest trial is over for now (trial_used; billing 402). Sign in to keep playing: you get a 500-credit newcomer gift and your progress is kept.';
export const GUEST_MEDIA_MESSAGE = 'Voice and pictures need a Worldlines account (guest trial: story only).';
const GUEST_STOPS = new Set(['insufficient_credits', 'guest_world_only', 'guest_not_allowed', 'guest_trial_unavailable']);
/** Is this gateway answer to a guest call the end of the trial (→ sign in), not a transient failure? */
export async function isTrialStop(res: Response): Promise<boolean> {
  if (![402, 403, 503].includes(res.status)) return false;
  const p = await res.clone().json().catch(() => null) as { error?: { code?: unknown } } | null;
  return res.status === 402 || GUEST_STOPS.has(String(p?.error?.code ?? ''));
}

const creditsReason = (v: unknown): CreditsReason => (v === 'claim_required' || v === 'debt_limit' ? v : 'insufficient_credits');

/** A 402 from the gateway → the friendly, non-retryable billing stop (any other response unchanged). */
export async function billingStop(res: Response): Promise<Response> {
  if (res.status !== 402) return res;
  const payload = await res.clone().json().catch(() => null) as { error?: { code?: unknown; reason?: unknown; kind?: unknown; billing_url?: unknown; resets_at?: unknown } } | null;
  await res.body?.cancel().catch(() => {});
  const e = payload?.error ?? {};
  const reason = creditsReason(e.reason);
  const str = (k: string, v: unknown) => (typeof v === 'string' && v ? { [k]: v } : {});
  return json(402, CREDITS_MESSAGES[reason], 'insufficient_credits', 'insufficient_quota', { reason, ...str('kind', e.kind), ...str('billing_url', e.billing_url), ...str('resets_at', e.resets_at) });
}

/** A stream that errors as a retryable network error if its source breaks mid-way. */
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

function rewriteModel(body: BodyInit | null | undefined, map: Record<string, string> | undefined): BodyInit | null | undefined {
  if (!map || !Object.keys(map).length || typeof body !== 'string') return body;
  try {
    const parsed = JSON.parse(body);
    if (typeof parsed?.model === 'string' && map[parsed.model]) { parsed.model = map[parsed.model]; return JSON.stringify(parsed); }
  } catch { /* not JSON: leave it */ }
  return body;
}

export function createGatewayFetch(direct: typeof fetch, opts: GatewayOptions): typeof fetch {
  const base = opts.base.replace(/\/+$/, '');
  const under = (href: string) => href === base || href.startsWith(`${base}/`);
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!under(href)) return direct(input as RequestInfo, init);
    // pi-ai passes (url, init); a Request object is read into the same shape.
    let reqInit: RequestInit = init ?? {};
    if (input instanceof Request) {
      reqInit = { method: input.method, headers: input.headers, body: input.method === 'GET' || input.method === 'HEAD' ? undefined : await input.text(), signal: input.signal, ...init };
    }
    const body = rewriteModel(reqInit.body, opts.map);
    // A background call (character tick v2, apps/server/src/tick-model.ts) is quiet: a refusal never opens the
    // sign-in panel — the beat just goes on by the rules. The marker header is never forwarded.
    const quiet = new Headers(reqInit.headers).get('x-airp-quiet') === '1';
    const onAuthRequired: GatewayOptions['onAuthRequired'] = quiet ? () => {} : opts.onAuthRequired;
    const send = (token: string) => {
      // Only what the gateway's CORS allows (authorization, content-type,
      // x-worldlines-product, x-worldlines-scene, x-worldlines-world; accept is
      // safelisted): SDK
      // extras such as x-stainless-* would fail the preflight.
      const given = new Headers(reqInit.headers);
      const headers = new Headers();
      for (const k of ['content-type', 'accept', 'x-worldlines-scene']) { const v = given.get(k); if (v) headers.set(k, v); }
      headers.set('authorization', `Bearer ${token}`);
      headers.set('x-worldlines-product', opts.product);
      let world: unknown = null;
      try { world = opts.world?.(); } catch { /* no world */ }
      if (typeof world === 'string' && WORLD_ID.test(world)) headers.set(WORLD_HEADER, world);
      return direct(href, { ...reqInit, body, headers, credentials: 'omit' });
    };
    let token = await opts.token(false);
    // Signed out: the guest trial's token, for the trial world only (null otherwise).
    let tokenOf = opts.token;
    if (!token && opts.guestToken) {
      const t = await opts.guestToken(false);
      // A guest plays the story (chat) only: voice, pictures, transcription stay quiet for them, no sign-in popup each time.
      if (t && !/\/chat\/completions$/.test(new URL(href).pathname)) return json(403, GUEST_MEDIA_MESSAGE, 'guest_not_allowed', 'permission_error');
      if (t) { token = t; tokenOf = opts.guestToken; }
    }
    const guest = tokenOf !== opts.token;
    if (!token) { onAuthRequired(); return json(401, SIGN_IN_MESSAGE, 'auth_required', 'authentication_error'); }
    let res = await send(token);
    if (res.status === 401) {
      await res.body?.cancel().catch(() => {});
      token = await tokenOf(true);
      if (token) res = await send(token);
      if (!token || res.status === 401) { onAuthRequired(); return json(401, SIGN_IN_MESSAGE, 'auth_required', 'authentication_error'); }
    }
    if (guest && await isTrialStop(res)) {
      await res.body?.cancel().catch(() => {});
      onAuthRequired('trial');
      return json(402, TRIAL_MESSAGE, 'insufficient_credits', 'insufficient_quota', { reason: 'trial_used' });
    }
    if (res.status === 429) {
      const payload = await res.clone().json().catch(() => null) as { error?: { code?: string; kind?: unknown; billing_url?: unknown } } | null;
      if (payload?.error?.code === 'quota_exceeded') {
        await res.body?.cancel().catch(() => {});
        // kind (which allowance) and billing_url ride along for the speech / transcription / image callers.
        const { kind, billing_url } = payload.error;
        return json(429, QUOTA_MESSAGE, 'quota_exceeded', 'insufficient_quota', { ...(typeof kind === 'string' ? { kind } : {}), ...(typeof billing_url === 'string' ? { billing_url } : {}) });
      }
      return res; // concurrency / upstream rate limit: transient, pi retries
    }
    if (res.status === 402) return billingStop(res);
    if (!res.ok || !res.body) return res;
    return new Response(guardStream(res.body), { status: res.status, statusText: res.statusText, headers: res.headers });
  }) as typeof fetch;
}
