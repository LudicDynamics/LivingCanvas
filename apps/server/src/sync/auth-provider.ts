import { createHash, randomBytes } from 'node:crypto';
// Vendored from the Worldlines identity service (see vendor/worldlines-identity-client/VERSION).
// The same relative path resolves from src/sync and dist/sync.
import * as identity from '../../../../vendor/worldlines-identity-client/index.mjs';

/**
 * How the LOCAL server signs its owner in to their account
 * — the same account as the hosted login.
 *
 * Identity sits behind this small interface so the sync code never talks to a
 * particular vendor. Two adapters:
 *   - `worldlines`: the unified Worldlines identity service (auth.worldlines.gg,
 *     shared by hub, dev.worldlines.gg and this app). The remote advertises it
 *     at `/auth/config`; `AIRP_AUTH_PROVIDER=worldlines` + `AIRP_AUTH_URL`
 *     override. Sign-in returns to THIS server's loopback callback, which the
 *     service accepts on any port, so nothing has to be registered for it.
 *   - `supabase`: the direct Supabase login, kept for the transition.
 * Both name the user with the same uid (the Supabase user id). User ids are
 * opaque strings throughout.
 *
 * Every value an adapter is CONFIGURED with is public (a service URL; for
 * Supabase also its anon key — what every browser on the login page already
 * sees). What it RETURNS — `AuthSession` — is the secret, and only
 * remote-client.ts keeps it.
 */

export type AuthConfig = SupabaseAuthConfig | WorldlinesAuthConfig;

export interface SupabaseAuthConfig {
  provider: 'supabase';
  /** The auth service base, e.g. `https://<project>.supabase.co`. */
  url: string;
  /** Public client key (Supabase: the anon key). */
  anonKey: string;
}

export interface WorldlinesAuthConfig {
  provider: 'worldlines';
  /** The identity service base (its `iss`), e.g. `https://auth.worldlines.gg`. */
  issuer: string;
  /**
   * App login (like Claude Code / Codex): the app registered on the identity
   * service (`livingcanvas-local`: loopback redirects) and the scopes asked
   * for. The service shows its consent page and the tokens carry `client_id` +
   * `scope`. Absent = the plain sign-in (the static browser site).
   */
  clientId?: string;
  scopes?: string[];
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms after which `accessToken` is no longer accepted. */
  expiresAt: number;
  uid: string;
  email: string | null;
  /** App login only: the app and the scopes the user allowed (kept across refresh). */
  clientId?: string;
  scopes?: string[];
}

/** `account`: the identity service's own sign-in page (it lists every way in). */
export type LoginMethod = 'google' | 'email' | 'account';

/** The device code to show (RFC 8628): open `verificationUri`, enter `userCode`. */
export interface DeviceCode { userCode: string; verificationUri: string; verificationUriComplete: string | null; expiresIn: number }

export interface BeginLogin {
  method: LoginMethod;
  /** Where the provider sends the browser back (the local callback URL). */
  redirectTo: string;
  /** Email sign-in only. */
  email?: string;
  /** The page's device id (the one billing gets as X-Worldlines-Device): identity's per-device new-account limit. */
  device?: string;
}

/** What `beginLogin` hands back: a URL to open, or a mail that was sent. `verifier` stays on the server. */
export interface LoginStart { authorizeUrl?: string; sent?: boolean; verifier: string }

/** Whatever came back to the callback, or the code typed from the mail. */
export interface CompleteLogin {
  /** PKCE authorization code (`?code=`) + the verifier from `beginLogin`. */
  code?: string;
  verifier?: string;
  /** The callback URL `beginLogin` was given (Worldlines binds the code to it). */
  redirectTo?: string;
  /** Implicit-flow tokens the callback page read from the fragment. */
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  /** A one-time code from the sign-in email. */
  email?: string;
  otp?: string;
  /** Same device id as `BeginLogin.device` (X-Worldlines-Device on the code exchange / OTP verify). */
  device?: string;
}

export class AuthError extends Error {
  /** `rejected`: the provider said no (bad code, revoked refresh token) — sign in again. `unreachable`: try later. */
  constructor(public kind: 'rejected' | 'unreachable' | 'invalid', message: string) { super(message); }
}

export interface AuthProvider {
  beginLogin(input: BeginLogin): Promise<LoginStart>;
  /**
   * Sign in without a browser on this computer (device code flow; app login
   * only). `onCode` gets the code to show; resolves once the user approved on
   * another device, rejects on deny / expiry / `signal`.
   */
  deviceLogin?(input: { onCode: (code: DeviceCode) => void; signal?: AbortSignal }): Promise<AuthSession>;
  completeLogin(input: CompleteLogin): Promise<AuthSession>;
  refresh(session: AuthSession): Promise<AuthSession>;
  logout(session: AuthSession): Promise<void>;
}

const b64url = (buf: Buffer) => buf.toString('base64url');

// ── Supabase (GoTrue) ───────────────────────────────────────────────────────

type Fetch = typeof fetch;

interface GoTrueSession { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown; expires_at?: unknown; user?: { id?: unknown; email?: unknown } }

export function supabaseProvider(config: SupabaseAuthConfig, request: Fetch = fetch): AuthProvider {
  const base = config.url.replace(/\/+$/, '');
  const headers = { apikey: config.anonKey, 'content-type': 'application/json', accept: 'application/json' };

  async function goTrue(path: string, init: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      response = await request(`${base}/auth/v1/${path}`, { ...init, redirect: 'error', signal: AbortSignal.timeout(15_000), headers: { ...headers, ...(init.headers as Record<string, string> | undefined) } });
    } catch (error) {
      throw new AuthError('unreachable', `The sign-in service could not be reached (${error instanceof Error ? error.name : 'network error'}).`);
    }
    const body = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok) {
      const said = [body?.error_description, body?.msg, body?.message, body?.error].find((v) => typeof v === 'string') as string | undefined;
      throw new AuthError(response.status >= 500 ? 'unreachable' : 'rejected', said ?? `The sign-in service answered HTTP ${response.status}.`);
    }
    return body;
  }

  /** A GoTrue token response → our session. The user's id is taken from the response, never guessed. */
  async function sessionOf(raw: unknown, fallback?: AuthSession): Promise<AuthSession> {
    const body = (raw ?? {}) as GoTrueSession;
    const accessToken = typeof body.access_token === 'string' ? body.access_token : '';
    const refreshToken = typeof body.refresh_token === 'string' ? body.refresh_token : '';
    if (!accessToken || !refreshToken) throw new AuthError('rejected', 'The sign-in service did not return a session.');
    let user = body.user;
    if (typeof user?.id !== 'string') user = await goTrue('user', { method: 'GET', headers: { authorization: `Bearer ${accessToken}` } }) as GoTrueSession['user'];
    const uid = typeof user?.id === 'string' ? user.id.toLowerCase() : fallback?.uid;
    if (!uid) throw new AuthError('rejected', 'The sign-in service did not say who you are.');
    const expiresAt = typeof body.expires_at === 'number' ? body.expires_at * 1000
      : Date.now() + (typeof body.expires_in === 'number' ? body.expires_in : 3600) * 1000;
    return { accessToken, refreshToken, expiresAt, uid, email: typeof user?.email === 'string' ? user.email : fallback?.email ?? null };
  }

  return {
    async beginLogin({ method, redirectTo, email }) {
      // PKCE: the verifier never leaves this server; the browser only ever
      // carries a one-time code that is useless without it.
      const verifier = b64url(randomBytes(32));
      const challenge = b64url(createHash('sha256').update(verifier).digest());
      if (method === 'google' || method === 'account') {
        const url = new URL(`${base}/auth/v1/authorize`);
        url.searchParams.set('provider', 'google');
        url.searchParams.set('redirect_to', redirectTo);
        url.searchParams.set('code_challenge', challenge);
        url.searchParams.set('code_challenge_method', 's256');
        return { authorizeUrl: url.toString(), verifier };
      }
      if (typeof email !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new AuthError('invalid', 'Enter an email address.');
      await goTrue(`otp?redirect_to=${encodeURIComponent(redirectTo)}`, {
        method: 'POST',
        body: JSON.stringify({ email, create_user: true, code_challenge: challenge, code_challenge_method: 's256' }),
      });
      return { sent: true, verifier };
    },

    async completeLogin(input) {
      if (input.code && input.verifier) {
        return sessionOf(await goTrue('token?grant_type=pkce', { method: 'POST', body: JSON.stringify({ auth_code: input.code, code_verifier: input.verifier }) }));
      }
      if (input.email && input.otp) {
        return sessionOf(await goTrue('verify', { method: 'POST', body: JSON.stringify({ type: 'email', email: input.email, token: input.otp }) }));
      }
      if (input.accessToken && input.refreshToken) {
        // Implicit flow: tokens came through the browser, so ask the provider
        // who they belong to (`user`) instead of believing the page.
        return sessionOf({ access_token: input.accessToken, refresh_token: input.refreshToken, expires_in: input.expiresIn });
      }
      throw new AuthError('invalid', 'Nothing to sign in with.');
    },

    async refresh(session) {
      return sessionOf(await goTrue('token?grant_type=refresh_token', { method: 'POST', body: JSON.stringify({ refresh_token: session.refreshToken }) }), session);
    },

    async logout(session) {
      await goTrue('logout?scope=local', { method: 'POST', headers: { authorization: `Bearer ${session.accessToken}` } }).catch(() => {});
    },
  };
}

// ── Worldlines identity service ─────────────────────────────────────────────

/** The service's error → ours: 5xx / network = try later, 4xx = the service said no. */
function identityFailure(error: unknown): never {
  if (error instanceof identity.IdentityError) {
    if (error.status === 0 || error.status >= 500) throw new AuthError('unreachable', 'The Worldlines account service could not be reached.');
    if (error.status === 429) throw new AuthError('unreachable', 'Too many sign-in attempts. Wait a minute and try again.');
    throw new AuthError('rejected', error.message && error.message !== error.code ? error.message : `The Worldlines account service said no (${error.code}).`);
  }
  throw error;
}

/**
 * The device id for identity's sign-up guard (platform identity 0009, anti-abuse): the same random
 * per-browser id billing gets for invites / claims. Only to the Worldlines identity service — never to anyone else.
 */
export const DEVICE_ID = /^[A-Za-z0-9_-]{8,128}$/;
export function deviceIdOf(raw: unknown): string | undefined {
  return typeof raw === 'string' && DEVICE_ID.test(raw) ? raw : undefined;
}
function deviceHeaders(device?: string): Record<string, string> {
  return deviceIdOf(device) ? { 'x-worldlines-device': device as string } : {};
}
/** `/v1/login/start…` (and the app consent URL) + `device_id=` for the callback's new-account check. */
export function withDeviceParam(url: string, device?: string): string {
  if (!deviceIdOf(device)) return url;
  const u = new URL(url);
  u.searchParams.set('device_id', device as string);
  return u.toString();
}
function withDeviceFetch(request: Fetch, device?: string): Fetch {
  if (!deviceIdOf(device)) return request;
  return ((input: Parameters<Fetch>[0], init?: Parameters<Fetch>[1]) => {
    const headers = new Headers(init?.headers);
    headers.set('x-worldlines-device', device as string);
    return request(input, { ...init, headers });
  }) as Fetch;
}

/**
 * The Worldlines identity service (the Worldlines identity service, the design notes),
 * through the vendored client: PKCE + `/v1/login/start` for Google (the code
 * comes back to this server's loopback callback), `/v1/login/otp` for email,
 * rotating refresh. The access token is an ES256 JWT the remote gateway checks
 * against the service's keys; the uid is `user.id` (the Supabase user id).
 */
export function worldlinesProvider(config: WorldlinesAuthConfig, request: Fetch = fetch): AuthProvider {
  const issuer = config.issuer.replace(/\/+$/, '');

  async function post(path: string, body: unknown, device?: string): Promise<unknown> {
    let response: Response;
    try {
      response = await request(`${issuer}${path}`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000), headers: { 'content-type': 'application/json', accept: 'application/json', ...deviceHeaders(device) }, body: JSON.stringify(body) });
    } catch (error) {
      throw new AuthError('unreachable', `The Worldlines account service could not be reached (${error instanceof Error ? error.name : 'network error'}).`);
    }
    const data = await response.json().catch(() => null) as { error?: unknown; message?: unknown } | null;
    if (!response.ok) {
      const said = typeof data?.message === 'string' ? data.message : typeof data?.error === 'string' ? data.error : `HTTP ${response.status}`;
      throw new AuthError(response.status >= 500 || response.status === 429 ? 'unreachable' : 'rejected', said);
    }
    return data;
  }

  function sessionOf(raw: unknown): AuthSession {
    const t = (raw ?? {}) as Partial<identity.TokensResponse>;
    if (typeof t.access_token !== 'string' || typeof t.refresh_token !== 'string' || !t.access_token || !t.refresh_token) throw new AuthError('rejected', 'The Worldlines account service did not return a session.');
    const uid = typeof t.user?.id === 'string' ? t.user.id.toLowerCase() : '';
    if (!uid) throw new AuthError('rejected', 'The Worldlines account service did not say who you are.');
    // A guest cannot own worlds (spec §2.1); only a real account may sync.
    if (t.user?.anonymous === true) throw new AuthError('rejected', 'Guest accounts cannot sync. Sign in with Google or email.');
    const expiresIn = typeof t.expires_in === 'number' && t.expires_in > 0 ? t.expires_in : 900;
    const scopes = typeof t.scope === 'string' && t.scope.trim() ? t.scope.trim().split(/\s+/) : undefined;
    return {
      accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: Date.now() + expiresIn * 1000, uid,
      email: typeof t.user?.email === 'string' ? t.user.email : null,
      ...(typeof t.client_id === 'string' && t.client_id ? { clientId: t.client_id } : {}),
      ...(scopes ? { scopes } : {}),
    };
  }

  return {
    async beginLogin({ method, redirectTo, email, device }) {
      if (method === 'google' || method === 'account') {
        const pkce = identity.createPkce();
        // `state` rides along for the service to echo; ours is the callback path.
        const state = redirectTo.slice(redirectTo.lastIndexOf('/') + 1);
        // App login: client_id + scope → the service's consent page. Without a
        // provider it first shows its own sign-in page (every way in).
        const app = config.clientId ? { clientId: config.clientId, scopes: config.scopes ?? null } : {};
        const provider = method === 'google' || !config.clientId ? 'google' : null;
        return { authorizeUrl: withDeviceParam(identity.loginUrl({ issuer, provider, redirect: redirectTo, codeChallenge: pkce.challenge, state, ...app }), device), verifier: pkce.verifier };
      }
      if (typeof email !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new AuthError('invalid', 'Enter an email address.');
      await post('/v1/login/otp', { email }, device);
      // No verifier for a code by mail; the pending entry still needs one.
      return { sent: true, verifier: randomBytes(16).toString('base64url') };
    },

    async completeLogin(input) {
      if (input.code && input.verifier) {
        if (!input.redirectTo) throw new AuthError('invalid', 'Sign-in lost its callback address. Start again.');
        return sessionOf(await identity.exchangeCode({ issuer, code: input.code, codeVerifier: input.verifier, redirect: input.redirectTo, fetchImpl: withDeviceFetch(request, input.device) }).catch(identityFailure));
      }
      if (input.email && input.otp) return sessionOf(await post('/v1/login/otp/verify', { email: input.email, token: input.otp }, input.device));
      throw new AuthError('invalid', 'Nothing to sign in with.');
    },

    async deviceLogin({ onCode, signal }) {
      if (!config.clientId) throw new AuthError('invalid', 'Signing in with a code needs the app login.');
      const tokens = await identity.deviceLogin({
        issuer, clientId: config.clientId, scopes: config.scopes ?? null, fetchImpl: request, signal: signal ?? null,
        onCode: (c) => onCode({ userCode: c.user_code, verificationUri: c.verification_uri, verificationUriComplete: c.verification_uri_complete ?? null, expiresIn: c.expires_in }),
      }).catch(identityFailure);
      return sessionOf(tokens);
    },

    async refresh(session) {
      // Rotating: the old refresh token is dead after this. remote-client.ts
      // runs one refresh at a time, so two never race with the same token.
      // An app login's client_id + scope survive the refresh (the service keeps them).
      const next = sessionOf(await identity.refreshTokens({ issuer, refreshToken: session.refreshToken, fetchImpl: request }).catch(identityFailure));
      return { ...next, email: next.email ?? session.email, ...(next.clientId || !session.clientId ? {} : { clientId: session.clientId, scopes: session.scopes }) };
    },

    async logout(session) {
      await identity.logout({ issuer, accessToken: session.accessToken, refreshToken: session.refreshToken, fetchImpl: request }).catch(() => {});
    },
  };
}

/** The adapter for a config. */
export function authProviderFor(config: AuthConfig, request: Fetch = fetch): AuthProvider {
  if (config.provider === 'worldlines') return worldlinesProvider(config, request);
  if (config.provider === 'supabase') return supabaseProvider(config, request);
  throw new AuthError('invalid', `Unknown auth provider ${String((config as { provider?: unknown }).provider)}.`);
}

/**
 * Is the identity client really in this build (the static import above)? A login-on build without it can sign
 * in by e-mail code but never refresh a token — production 2026-10-07. Checked at server start (index.ts) and by
 * the browser build gate (deploy/canvas/build-browser.sh); the answer never switches login off by itself.
 */
export function identityClientBundled(): boolean {
  const client = identity as unknown as Record<string, unknown>;
  return typeof client.refreshTokens === 'function' && typeof client.IdentityError === 'function';
}
