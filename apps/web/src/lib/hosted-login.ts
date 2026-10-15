/**
 * Signing in on the HOSTED site from the in-app 「账号」 panel
 * The seat
 * gateway (deploy/vps/seat-gateway.mjs) answers these next to its HTML /login,
 * which stays as the fallback:
 *   - `GET  auth/config`        → which provider signs people in here
 *   - `POST auth/email/start`   → mails a code (Worldlines) or a link (Supabase)
 *   - `POST auth/email/verify`  → checks the code; the gateway sets the HttpOnly
 *                                 session cookies on success (the page never sees a token)
 *   - `GET  login/google?return=` → a full-page redirect (OAuth needs one)
 * The POSTs carry `X-AIRP-Auth: 1`, which a cross-site form cannot send.
 */
import { attributionParam, attributionPayload, settleAttribution } from './attribution.js';

/** The gateway's routes sit right under the app's base (COOKIE_PATH), whatever page this is. */
export const gatewayBase = (): string => ((import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/');
const at = (path: string): string => `${gatewayBase()}${path}`;

export type HostedMailMode = 'code' | 'link';

export class HostedLoginError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
  }
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
const defaultFetch: Fetch = (input, init) => fetch(input, init);

async function postJson(path: string, body: unknown, fetchImpl: Fetch): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetchImpl(at(path), {
      method: 'POST',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', accept: 'application/json', 'x-airp-auth': '1' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new HostedLoginError('unreachable', 0);
  }
  const data = await res.json().catch(() => null) as Record<string, unknown> | null;
  if (!res.ok || !data || data.ok !== true) throw new HostedLoginError(typeof data?.code === 'string' ? data.code : 'error', res.status);
  return data;
}

/** Does this gateway mail a code to type in (Worldlines) or a link to open (Supabase)? */
export async function hostedMailMode(fetchImpl: Fetch = defaultFetch): Promise<HostedMailMode> {
  try {
    const res = await fetchImpl(at('auth/config'), { headers: { accept: 'application/json' }, cache: 'no-store' });
    const body = await res.json().catch(() => null) as { provider?: unknown } | null;
    return body?.provider === 'supabase' ? 'link' : 'code';
  } catch {
    return 'code';
  }
}

/** Mail the sign-in code (or link). Resolves to which one was sent. */
export async function startHostedEmail(email: string, fetchImpl: Fetch = defaultFetch): Promise<HostedMailMode> {
  const data = await postJson('auth/email/start', { email: email.trim() }, fetchImpl);
  return data.mode === 'link' ? 'link' : 'code';
}

/** Check the code. On success the gateway has set the session cookies. */
export async function verifyHostedCode(email: string, code: string, fetchImpl: Fetch = defaultFetch): Promise<{ uid: string; email: string | null }> {
  // 渠道 / 来源 (lib/attribution.ts): rides along; identity records it only if this sign-in creates the account
  const data = await postJson('auth/email/verify', { email: email.trim(), code: code.replace(/\s+/g, ''), attribution: attributionPayload() }, fetchImpl);
  if (typeof data.uid !== 'string') throw new HostedLoginError('error', 200);
  settleAttribution();
  return { uid: data.uid, email: typeof data.email === 'string' ? data.email : null };
}

/**
 * The page to come back to after Google, relative to the app's base: only
 * plain path segments survive (the gateway applies the same rule).
 */
export function returnPathFrom(pathname: string, base: string): string {
  const rest = pathname.startsWith(base) ? pathname.slice(base.length) : '';
  return /^(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\/?)?$/.test(rest) ? rest : '';
}

/** Where the Google button sends this tab. */
export function hostedGoogleUrl(returnPath: string, att: string | undefined = attributionParam()): string {
  const q = new URLSearchParams();
  if (returnPath) q.set('return', returnPath);
  if (att) q.set('att', att); // 渠道 / 来源: the gateway hands it to identity's /v1/login/start
  const s = q.toString();
  return `${at('login/google')}${s ? `?${s}` : ''}`;
}

export type HostedFailure = 'invalid_code' | 'invalid_email' | 'send_failed' | 'unreachable' | 'account_refused' | 'other';

/** The gateway's error codes → what the panel says (useHostedSignIn words it). */
export function hostedFailure(error: unknown): HostedFailure {
  const code = error instanceof HostedLoginError ? error.code : '';
  if (code === 'invalid_code' || code === 'invalid_email' || code === 'send_failed' || code === 'account_refused') return code;
  if (code === 'identity_unreachable' || code === 'unreachable') return 'unreachable';
  return 'other';
}
