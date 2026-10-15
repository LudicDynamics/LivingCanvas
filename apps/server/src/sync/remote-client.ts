import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { LocalWorldStore } from '@airp/shared';
import { publishedRoot, userId, worldsRoot } from '../engine/user-root.js';
import { MADE_ID, isOfficialId, isSyncWorldId, workshopOf, type WorkshopMeta } from '../world-workshop.js';
import { BUNDLE_TYPE, BundleError, buildBundle, extractBundle, readManifestFile, stripPairing, trashDir, writeManifestFile } from './bundle.js';
import * as services from './services-remote.js';
import { serverMode } from '../deploy-mode.js';
import { contentStamp, manifestDigest, markSynced } from './stamp.js';
import { AuthError, authProviderFor, deviceIdOf, type AuthConfig, type AuthSession, type CompleteLogin, type DeviceCode, type LoginMethod } from './auth-provider.js';

/**
 * The LOCAL side of local ↔ remote: the
 * owner's `pnpm dev` talks to a hosted AIRP on their behalf, signed in to
 * THEIR ACCOUNT — the same account (and uid) as the hosted login, through the
 * auth provider (auth-provider.ts: the Worldlines identity service, or
 * Supabase during the transition — whichever the remote advertises).
 *
 * The session (access + refresh token) is kept by this server in a file
 * outside the repository and every world (`remoteConfigFile`) and never goes
 * to the browser: the page asks THIS server to sign in, push or pull, and
 * learns only "signed in as <email>". It never enters a bundle, a world.json,
 * a README or a log line. An expired access token is refreshed before a call,
 * and once more on a 401, then the call is retried once.
 *
 * Each synced world remembers its pair in world.json:
 * `remote: { url, id, revision, hash, from: 'tenant' | 'public', syncedAt }`.
 * `id` may differ from the local id (the remote renames on a collision), so
 * the next upload targets the remembered id, and a re-download finds the local
 * world it would replace.
 */

export interface RemoteConfig { url: string; custom: boolean; auth: AuthConfig | null; session: AuthSession | null }
export interface RemotePair { url: string; id: string; revision: number; hash: string | null; from: 'tenant' | 'public'; syncedAt: string }

export class RemoteError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

const TIMEOUT_MS = 10 * 60_000;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
/** Refresh this long before the access token actually expires. */
const EXPIRY_SLACK_MS = 60_000;

export const DEFAULT_ID_BASE = 'https://auth.worldlines.gg';
export const DEFAULT_STORAGE_BASE = 'https://storage.worldlines.gg';

/**
 * The Worldlines services — one remote for the browser version and the local
 * app alike:
 * the identity service owns who owns a world and whether it is public, the
 * storage service holds its files. `AIRP_ID_BASE` / `AIRP_STORAGE_BASE`
 * override the addresses (the browser version passes VITE_AIRP_ID_BASE /
 * VITE_AIRP_STORAGE_BASE through); an explicit `AIRP_AUTH_PROVIDER=worldlines`
 * + `AIRP_AUTH_URL` also names the identity service.
 */
export function servicesConfig(): { identity: string; storage: string } {
  const pick = (raw: string | undefined, fallback: string) => {
    const value = (raw ?? '').trim();
    if (value) { try { return normaliseBase(value, 'service address').replace(/\/+$/, ''); } catch { /* fall through */ } }
    return fallback;
  };
  const authUrl = (process.env.AIRP_AUTH_PROVIDER ?? '').trim() === 'worldlines' ? process.env.AIRP_AUTH_URL : undefined;
  return { identity: pick(process.env.AIRP_ID_BASE || authUrl, DEFAULT_ID_BASE), storage: pick(process.env.AIRP_STORAGE_BASE, DEFAULT_STORAGE_BASE) };
}
/** The remote address that means "the Worldlines services" (the storage base, ending in `/`). */
export const servicesUrl = () => `${servicesConfig().storage}/`;
/** Is `url` the Worldlines services (rather than a legacy AIRP sync API such as the VPS)? */
export const isServicesUrl = (url: string) => url === servicesUrl();

/**
 * Where the remote lives by default: the Worldlines services. `AIRP_REMOTE_URL`
 * points this computer at a legacy AIRP sync API instead (the VPS, until the
 * cut-over); 「高级」 can do the same per computer.
 */
export function defaultRemoteUrl(): string {
  const declared = (process.env.AIRP_REMOTE_URL ?? '').trim();
  if (declared) { try { return normaliseRemoteUrl(declared); } catch { /* fall through */ } }
  return servicesUrl();
}

/**
 * Where the session lives on this machine: OUTSIDE the repository and every
 * world root.
 * `~/.config/airp/remote.json`, mode 0600. The story agents cannot reach it:
 * their read fence refuses anything outside their world (and any `~` path),
 * and `AIRP_REMOTE_*` / `AIRP_AUTH_*` variables are withheld from their
 * environment (agent-env.ts). `AIRP_REMOTE_CONFIG` overrides the path (tests).
 */
export function remoteConfigFile(): string {
  const declared = (process.env.AIRP_REMOTE_CONFIG ?? '').trim();
  return declared ? path.resolve(declared) : path.join(os.homedir(), '.config', 'airp', 'remote.json');
}

/** An http(s) base URL normalised to end in `/`; plain http only for this machine. */
function normaliseBase(raw: unknown, what: string): string {
  if (typeof raw !== 'string' || !raw.trim()) throw new RemoteError(400, 'invalid_argument', `Enter the ${what}.`);
  let url: URL;
  try { url = new URL(raw.trim()); } catch { throw new RemoteError(400, 'invalid_argument', `The ${what} is not a URL.`); }
  if (url.username || url.password || url.search || url.hash) throw new RemoteError(400, 'invalid_argument', `The ${what} may not carry credentials, a query or a fragment.`);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK.has(url.hostname))) {
    throw new RemoteError(400, 'invalid_argument', 'Use https:// (plain http is only allowed for this computer).');
  }
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url.toString();
}
export const normaliseRemoteUrl = (raw: unknown) => normaliseBase(raw, 'remote address');

interface StoredConfig { url?: unknown; auth?: Partial<{ provider: string; url: string; anonKey: string; issuer: string }>; session?: Partial<Omit<AuthSession, 'scopes'>> & { scopes?: unknown[] }; savedAt?: string }

async function readStored(): Promise<StoredConfig> {
  try {
    const parsed = JSON.parse(await fs.readFile(remoteConfigFile(), 'utf8')) as unknown;
    return typeof parsed === 'object' && parsed !== null ? parsed as StoredConfig : {};
  } catch {
    return {};
  }
}

async function writeStored(next: StoredConfig): Promise<void> {
  const file = remoteConfigFile();
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(temp, JSON.stringify({ ...next, savedAt: new Date().toISOString() }, null, 2) + '\n', { mode: 0o600 });
  await fs.rename(temp, file);
}

const authOf = (raw: StoredConfig['auth']): AuthConfig | null => {
  if (raw?.provider === 'worldlines' && typeof raw.issuer === 'string' && raw.issuer) return { provider: 'worldlines', issuer: raw.issuer };
  if (raw?.provider === 'supabase' && typeof raw.url === 'string' && typeof raw.anonKey === 'string' && raw.url && raw.anonKey) return { provider: 'supabase', url: raw.url, anonKey: raw.anonKey };
  return null;
};
const sessionOf = (raw: StoredConfig['session']): AuthSession | null =>
  typeof raw?.accessToken === 'string' && typeof raw.refreshToken === 'string' && typeof raw.uid === 'string' && raw.accessToken && raw.refreshToken
    ? {
      accessToken: raw.accessToken, refreshToken: raw.refreshToken, expiresAt: typeof raw.expiresAt === 'number' ? raw.expiresAt : 0, uid: raw.uid, email: typeof raw.email === 'string' ? raw.email : null,
      ...(typeof raw.clientId === 'string' && raw.clientId ? { clientId: raw.clientId } : {}),
      ...(Array.isArray(raw.scopes) && raw.scopes.every((v) => typeof v === 'string') ? { scopes: raw.scopes } : {}),
    }
    : null;

/**
 * App login (like Claude Code / Codex, identity spec §2.4): this computer signs
 * in as the registered app `livingcanvas-local` — loopback redirect, the
 * service's consent page, tokens scoped to what the app needs. Only for a
 * loopback callback (`pnpm dev`); the static browser site keeps the plain
 * sign-in. `AIRP_LOGIN_CLIENT_ID=none` turns it off; `AIRP_LOGIN_SCOPES`
 * (space- or comma-separated) narrows or widens the request, which must stay
 * within the app's registered scopes or the service refuses it (invalid_scope).
 */
export const APP_CLIENT_ID = 'livingcanvas-local';
// data:* — settings / favorites / likes / comments / save summaries; chronicle:* — this player's playthroughs
// (play counts) (sync/account-data.ts). identity lets livingcanvas-local ask for them from its migrations
// 0007 / 0008 on (the Worldlines platform), so those run first.
export const APP_SCOPES = ['profile:read', 'api:use', 'sync:read', 'sync:write', 'resources:read', 'resources:write', 'storage:read', 'storage:write', 'data:read', 'data:write', 'chronicle:read', 'chronicle:write'];
export function appLogin(): { clientId: string; scopes: string[] } | null {
  const id = (process.env.AIRP_LOGIN_CLIENT_ID ?? '').trim() || APP_CLIENT_ID;
  if (id === 'none') return null;
  const scopes = (process.env.AIRP_LOGIN_SCOPES ?? '').split(/[\s,]+/).filter(Boolean);
  return { clientId: id, scopes: scopes.length ? scopes : APP_SCOPES };
}
/** The auth config with the app login added, when it applies (Worldlines identity, loopback callback). */
function withAppLogin(auth: AuthConfig, loopback: boolean): AuthConfig {
  const app = appLogin();
  return auth.provider === 'worldlines' && loopback && app ? { ...auth, ...app } : auth;
}

export async function readRemoteConfig(_repoRoot?: string): Promise<RemoteConfig> {
  const stored = await readStored();
  let url = defaultRemoteUrl();
  let custom = false;
  if (typeof stored.url === 'string' && stored.url) { try { url = normaliseRemoteUrl(stored.url); custom = url !== defaultRemoteUrl(); } catch { /* keep the default */ } }
  const auth = authOf(stored.auth);
  return { url, custom, auth, session: auth ? sessionOf(stored.session) : null };
}

/** What the settings panel may see: who is signed in, never a token. */
export async function remoteSettingsView(_repoRoot?: string) {
  const config = await readRemoteConfig();
  sweepPending();
  return {
    url: config.url,
    defaultUrl: defaultRemoteUrl(),
    custom: config.custom,
    // Which kind of remote: the Worldlines services (identity + storage) or a legacy AIRP sync API.
    backend: isServicesUrl(config.url) ? 'services' as const : 'sync' as const,
    signedIn: Boolean(config.session),
    email: config.session?.email ?? null,
    uid: config.session?.uid ?? null,
    // App login: which app this computer is signed in as, and what it may do (never a token).
    app: config.session?.clientId ? { clientId: config.session.clientId, scopes: config.session.scopes ?? [] } : null,
    pending: pending.size > 0,
    device: deviceView(),
    playRequiresAccount: playRequiresAccount(),
    // Which worlds ask for it: `all` (the hosted site), `shared` (local login on: only worlds shared through
    // the Worldlines services; the worlds on this computer play with the player's own key), `none`.
    playAccountScope: playAccountScope(),
    // The guest trial (guest-session.ts): signed out, the trial world still plays.
    guestTrial: guestTrialOn(),
  };
}

/**
 * Which worlds ask a signed-out player to sign in before they play:
 *
 *   - `all`: the hosted site (AIRP_DEPLOY=remote, canvas.worldlines.gg) — its models are the account's
 * (「点击游玩就有登录 注册」). Also any server that never read a build mode.
 * - `shared`: the local edition with WORLDLINES_LOGIN=on. The account is for the worlds
 *     other players share through the Worldlines services (`published/…`) and the account's hosted features
 *     (cloud saves, publishing, the account's models and voices). The worlds that ship with this copy and
 *     the saves on this computer play signed out with the player's own key, and signing in never takes the
 *     player's own key away.
 *   - `none`: WORLDLINES_LOGIN=off (no sign-in exists here, so nothing may stand in front of a world), or
 *     `AIRP_PLAY_WITHOUT_ACCOUNT=1` (offline work, automated probes; the remote's own rules do not change).
 */
export type PlayAccountScope = 'all' | 'shared' | 'none';
export function playAccountScope(): PlayAccountScope {
  const mode = serverMode()?.mode;
  if (mode?.login === 'off') return 'none';
  if ((process.env.AIRP_PLAY_WITHOUT_ACCOUNT ?? '').trim() === '1') return 'none';
  return mode?.deploy === 'local' ? 'shared' : 'all';
}
/** Does anything here ask for an account before play (`playAccountScope` is not `none`)? */
export function playRequiresAccount(): boolean {
  return playAccountScope() !== 'none';
}
/**
 * The guest trial (sync/guest-session.ts, `AIRP_GUEST_TRIAL=1`) lets a signed-out player into the one world
 * that is otherwise locked. It only means something where every world is locked (`all`): with `shared` the
 * local worlds are open anyway, and with `none` there is no account to try.
 */
export function guestTrialOn(): boolean {
  return (process.env.AIRP_GUEST_TRIAL ?? '').trim() === '1' && playAccountScope() === 'all';
}

/**
 * 「高级」: point this computer at another remote. A different remote may use a
 * different account system, so changing the address signs out. Blank = default.
 */
export async function saveRemoteUrl(_repoRoot: string, input: unknown): Promise<void> {
  const raw = (typeof input === 'object' && input !== null ? input : {}) as { url?: unknown };
  const url = typeof raw.url === 'string' && raw.url.trim() ? normaliseRemoteUrl(raw.url) : defaultRemoteUrl();
  const current = await readRemoteConfig();
  if (url === current.url) return;
  await writeStored(url === defaultRemoteUrl() ? {} : { url });
}

/**
 * Where to sign in. In order:
 *   1. the local env, when it says so: `AIRP_AUTH_PROVIDER=worldlines` +
 *      `AIRP_AUTH_URL` (the identity service), or `AIRP_AUTH_URL` +
 *      `AIRP_AUTH_ANON_KEY` (Supabase);
 *   2. what the remote itself publishes at `GET <remote>/auth/config` (the
 *      seat gateway: `worldlines` + its issuer, or a Supabase project);
 *   3. `SUPABASE_URL` + `SUPABASE_ANON_KEY`.
 * `AIRP_AUTH_PROVIDER` also pins which kind the remote's answer must be.
 * All public values.
 */
export async function resolveAuthConfig(url: string, request: typeof fetch = fetch): Promise<AuthConfig> {
  const pinned = (process.env.AIRP_AUTH_PROVIDER ?? '').trim();
  if (pinned && pinned !== 'supabase' && pinned !== 'worldlines') throw new RemoteError(503, 'auth_not_configured', `Unknown auth provider ${pinned}.`);
  // The Worldlines services sign in at their own identity service; nothing to ask.
  if (isServicesUrl(url)) return { provider: 'worldlines', issuer: servicesConfig().identity };
  const base = (u: string) => normaliseBase(u, 'auth address').replace(/\/+$/, '');
  const supabaseFrom = (u?: string, k?: string): AuthConfig | null => (pinned !== 'worldlines' && u?.trim() && k?.trim() ? { provider: 'supabase', url: base(u), anonKey: k.trim() } : null);
  const declaredUrl = process.env.AIRP_AUTH_URL?.trim();
  if (pinned === 'worldlines' && declaredUrl) return { provider: 'worldlines', issuer: base(declaredUrl) };
  const explicit = supabaseFrom(declaredUrl, process.env.AIRP_AUTH_ANON_KEY);
  if (explicit) return explicit;
  try {
    const response = await request(new URL('auth/config', url), { redirect: 'error', headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
    if (response.ok) {
      const body = await response.json() as { provider?: unknown; url?: unknown; anonKey?: unknown; issuer?: unknown };
      if (body.provider === 'worldlines' && pinned !== 'supabase' && typeof body.issuer === 'string' && body.issuer) {
        return { provider: 'worldlines', issuer: base(body.issuer) };
      }
      if (body.provider === 'supabase' && typeof body.url === 'string' && typeof body.anonKey === 'string') {
        const advertised = supabaseFrom(body.url, body.anonKey);
        if (advertised) return advertised;
      }
    }
  } catch { /* fall back to the local env */ }
  const fallback = supabaseFrom(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  if (fallback) return fallback;
  throw new RemoteError(503, 'auth_not_configured', 'Could not find where to sign in: the remote did not answer /auth/config and AIRP_AUTH_URL is not set.');
}

// ── sign-in ─────────────────────────────────────────────────────────────────

/**
 * Sign-ins in progress, by `state` — a random value that is part of the
 * callback PATH, so only the browser this server sent to the provider can
 * complete it (a forged callback names no pending state). Memory only: a
 * restart simply means clicking 「用账号登录」 again.
 */
interface PendingLogin { method: LoginMethod; verifier: string; auth: AuthConfig; url: string; redirectTo: string; email?: string; device?: string; createdAt: number }
const pending = new Map<string, PendingLogin>();
const PENDING_MS = 15 * 60_000;
const PENDING_MAX = 8;
function sweepPending(now = Date.now()) {
  for (const [state, login] of pending) if (now - login.createdAt > PENDING_MS) pending.delete(state);
  while (pending.size > PENDING_MAX) pending.delete(pending.keys().next().value!);
}
export const LOGIN_STATE = /^[A-Za-z0-9_-]{32}$/;

/**
 * The page's own origin, which must be this computer: the callback comes back
 * to it. Browser mode on a static site runs this server INSIDE the page's tab,
 * so that page's origin is "this computer": the page declares it once at boot
 * (`AIRP_LOGIN_ORIGIN`, exact https origin) and only it is accepted besides loopback.
 */
function localOrigin(raw: unknown): string {
  let url: URL;
  try { url = new URL(String(raw)); } catch { throw new RemoteError(400, 'invalid_argument', 'Expected the page origin.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new RemoteError(400, 'invalid_argument', 'Sign-in can only return to this computer.');
  if (!LOOPBACK.has(url.hostname) && url.origin !== declaredLoginOrigin()) throw new RemoteError(400, 'invalid_argument', 'Sign-in can only return to this computer.');
  return url.origin;
}
function declaredLoginOrigin(): string | null {
  const raw = (process.env.AIRP_LOGIN_ORIGIN ?? '').trim();
  if (!raw) return null;
  try { const u = new URL(raw); return u.protocol === 'https:' && u.origin === raw.replace(/\/$/, '') ? u.origin : null; } catch { return null; }
}

const authFailure = (error: unknown): never => {
  if (error instanceof AuthError) {
    if (error.kind === 'unreachable') throw new RemoteError(502, 'auth_unreachable', error.message);
    throw new RemoteError(error.kind === 'invalid' ? 400 : 401, error.kind === 'invalid' ? 'invalid_argument' : 'auth_rejected', error.message);
  }
  throw error;
};

/** 「用账号登录」: Google opens a URL; email sends a mail (link or code). */
export async function startLogin(_repoRoot: string, input: unknown, deps: RemoteDeps = {}): Promise<{ ok: true; authorizeUrl?: string; sent?: boolean }> {
  const body = (typeof input === 'object' && input !== null ? input : {}) as { method?: unknown; email?: unknown; origin?: unknown; device?: unknown };
  const method: LoginMethod = body.method === 'email' || body.method === 'google' || body.method === 'account' ? body.method : (() => { throw new RemoteError(400, 'invalid_argument', 'Choose Google or email.'); })();
  const origin = localOrigin(body.origin);
  const config = await readRemoteConfig();
  // The sign-in mail keeps the plain session: the app login has no email-code step of its own.
  const auth = withAppLogin(await resolveAuthConfig(config.url, deps.fetch), method !== 'email' && LOOPBACK.has(new URL(origin).hostname));
  const state = randomBytes(24).toString('base64url');
  const redirectTo = `${origin}/api/remote/login/callback/${state}`;
  const email = typeof body.email === 'string' ? body.email.trim() : undefined;
  const device = deviceIdOf(body.device); // identity's per-device new-account limit (same id billing gets)
  const started = await authProviderFor(auth, deps.fetch).beginLogin({ method, redirectTo, email, device }).catch(authFailure);
  sweepPending();
  pending.set(state, { method, verifier: started.verifier, auth, url: config.url, redirectTo, email, device, createdAt: Date.now() });
  return { ok: true, ...(started.authorizeUrl ? { authorizeUrl: started.authorizeUrl } : {}), ...(started.sent ? { sent: true } : {}) };
}

/**
 * Listeners for a completed sign-in on this device (not a refresh): the guest trial moves its saves to the
 * account (guest-session.ts). Awaited, but a listener's failure never fails the sign-in.
 */
const signedInListeners: (() => Promise<void>)[] = [];
export function onSignedIn(listener: () => Promise<void>): void { signedInListeners.push(listener); }
async function signedInNow(): Promise<void> {
  for (const l of signedInListeners) await l().catch((error) => console.warn('[Remote] after sign-in:', error instanceof Error ? error.message : String(error)));
}

async function saveSession(url: string, auth: AuthConfig, session: AuthSession): Promise<void> {
  // Where to refresh is all the file needs; the app login's client + scopes ride on the session.
  const stored = auth.provider === 'worldlines' ? { provider: auth.provider, issuer: auth.issuer } : auth;
  await writeStored({ ...(url === defaultRemoteUrl() ? {} : { url }), auth: stored, session });
}

/** The browser came back to `/api/remote/login/callback/<state>` (code, or implicit tokens posted by the page). */
export async function finishLogin(_repoRoot: string, state: unknown, input: CompleteLogin, deps: RemoteDeps = {}): Promise<{ email: string | null }> {
  sweepPending();
  const login = typeof state === 'string' && LOGIN_STATE.test(state) ? pending.get(state) : undefined;
  if (!login) throw new RemoteError(400, 'login_expired', 'This sign-in link has expired or was already used. Start again from Settings → Remote.');
  pending.delete(state as string);
  const session = await authProviderFor(login.auth, deps.fetch).completeLogin({ ...input, verifier: login.verifier, redirectTo: login.redirectTo, device: login.device }).catch(authFailure);
  await saveSession(login.url, login.auth, session);
  await signedInNow();
  return { email: session.email };
}

/** The one-time code from the sign-in email, typed into Settings. */
export async function verifyEmailCode(_repoRoot: string, input: unknown, deps: RemoteDeps = {}): Promise<void> {
  const body = (typeof input === 'object' && input !== null ? input : {}) as { email?: unknown; code?: unknown };
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const code = typeof body.code === 'string' ? body.code.replace(/\s+/g, '') : '';
  if (!email || !/^\d{6,10}$/.test(code)) throw new RemoteError(400, 'invalid_argument', 'Enter the code from the email.');
  sweepPending();
  const entry = [...pending].reverse().find(([, login]) => login.method === 'email' && login.email === email);
  if (!entry) throw new RemoteError(400, 'login_expired', 'Send a new sign-in email first.');
  const [state, login] = entry;
  const session = await authProviderFor(login.auth, deps.fetch).completeLogin({ email, otp: code, device: login.device }).catch(authFailure);
  pending.delete(state);
  await saveSession(login.url, login.auth, session);
  await signedInNow();
}

// ── sign-in with a code (no browser on this computer) ───────────────────────

/**
 * The device code flow (RFC 8628) of the app login: this server asks for a
 * code, the page shows it, the owner approves on any device, and this server
 * polls until the tokens arrive. One at a time; memory only.
 */
interface DeviceLogin { code: DeviceCode | null; status: 'waiting' | 'done' | 'failed'; error?: string; abort: AbortController; startedAt: number }
let device: DeviceLogin | null = null;
function deviceView() {
  if (!device) return null;
  if (device.status === 'waiting' && device.code && Date.now() - device.startedAt > device.code.expiresIn * 1000) { device.abort.abort(); device = null; return null; }
  return { status: device.status, ...(device.code ? { userCode: device.code.userCode, verificationUri: device.code.verificationUri, verificationUriComplete: device.code.verificationUriComplete } : {}), ...(device.error ? { error: device.error } : {}) };
}

export async function startDeviceLogin(_repoRoot: string, deps: RemoteDeps = {}): Promise<{ ok: true; userCode: string; verificationUri: string; verificationUriComplete: string | null; expiresIn: number }> {
  const config = await readRemoteConfig();
  const auth = withAppLogin(await resolveAuthConfig(config.url, deps.fetch), true);
  const provider = authProviderFor(auth, deps.fetch);
  if (auth.provider !== 'worldlines' || !auth.clientId || !provider.deviceLogin) throw new RemoteError(400, 'invalid_argument', 'Signing in with a code needs the Worldlines account service.');
  device?.abort.abort();
  const entry: DeviceLogin = { code: null, status: 'waiting', abort: new AbortController(), startedAt: Date.now() };
  device = entry;
  const shown = new Promise<DeviceCode>((resolve, reject) => {
    void provider.deviceLogin!({ onCode: (code) => { entry.code = code; resolve(code); }, signal: entry.abort.signal })
      .then(async (session) => {
        if (device !== entry) return;
        await saveSession(config.url, auth, session);
        await signedInNow();
        entry.status = 'done';
      })
      .catch((error: unknown) => {
        reject(error);
        if (device !== entry) return;
        entry.status = 'failed';
        entry.error = error instanceof Error ? error.message : String(error);
      });
  });
  const code = await shown.catch(authFailure);
  return { ok: true, ...code };
}

export function cancelDeviceLogin(): void {
  device?.abort.abort();
  device = null;
}

/** 退出登录: end the session at the provider (best effort) and delete the local file. */
export async function logoutRemote(_repoRoot: string, deps: RemoteDeps = {}): Promise<void> {
  const config = await readRemoteConfig();
  if (config.auth && config.session) await authProviderFor(config.auth, deps.fetch).logout(config.session).catch(() => {});
  await fs.rm(remoteConfigFile(), { force: true });
}

// ── calls to the remote ─────────────────────────────────────────────────────

export interface Signed { url: string; auth: AuthConfig; session: AuthSession }

export async function requireSession(): Promise<Signed> {
  const config = await readRemoteConfig();
  if (!config.auth || !config.session) throw new RemoteError(409, 'not_connected', 'Sign in with your account in Settings → Remote first.');
  if (isServicesUrl(config.url) && config.auth.provider !== 'worldlines') throw new RemoteError(409, 'not_connected', 'Sign in again with your Worldlines account in Settings → Remote.');
  return { url: config.url, auth: config.auth, session: config.session };
}

/**
 * One refresh at a time: refresh tokens rotate, and two parallel refreshes
 * with the same one would have the provider revoke the whole session.
 */
let refreshing: Promise<AuthSession> | null = null;
async function refreshSession(signed: Signed, request?: typeof fetch): Promise<AuthSession> {
  if (!refreshing) {
    refreshing = (async () => {
      // Another call may have refreshed already: use the newer session on disk.
      const latest = (await readRemoteConfig()).session;
      if (latest && latest.refreshToken !== signed.session.refreshToken && latest.expiresAt - EXPIRY_SLACK_MS > Date.now()) return latest;
      try {
        const next = await authProviderFor(signed.auth, request).refresh(latest ?? signed.session);
        await saveSession(signed.url, signed.auth, next);
        return next;
      } catch (error) {
        if (error instanceof AuthError && error.kind === 'rejected') {
          // The refresh token is dead (revoked, signed out elsewhere, expired): only a new sign-in helps.
          await writeStored(signed.url === defaultRemoteUrl() ? {} : { url: signed.url });
          throw new RemoteError(401, 'signed_out', 'Your sign-in has expired. Sign in again in Settings → Remote.');
        }
        return authFailure(error);
      }
    })().finally(() => { refreshing = null; });
  }
  return refreshing;
}

/**
 * One call to the remote with the account's access token. Refreshed first
 * when (nearly) expired; on a 401 refreshed once more and retried once.
 * Redirects are refused so the token never follows one somewhere else.
 */
export async function call(signed: Signed, rel: string, init: RequestInit = {}, request: typeof fetch = fetch): Promise<Response> {
  let session = signed.session;
  if (session.expiresAt - EXPIRY_SLACK_MS <= Date.now()) session = await refreshSession(signed, request);
  const once = async (token: string) => {
    try {
      return await request(new URL(rel, signed.url), {
        ...init,
        redirect: 'error',
        headers: { accept: 'application/json', ...(init.headers as Record<string, string> | undefined), authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new RemoteError(502, 'remote_unreachable', `The remote could not be reached (${error instanceof Error ? error.name : 'network error'}).`);
    }
  };
  let response = await once(session.accessToken);
  if (response.status === 401) {
    await response.body?.cancel().catch(() => {});
    session = await refreshSession({ ...signed, session }, request);
    response = await once(session.accessToken);
    if (response.status === 401) throw new RemoteError(401, 'signed_out', 'The remote did not accept your sign-in. Sign in again in Settings → Remote.');
  }
  if (response.ok) return response;
  throw await remoteFailure(response);
}

/**
 * A remote's refusal → RemoteError. Two shapes: the AIRP sync API's
 * `{ code, error: <message> }` and the Worldlines services' `{ error: <code>,
 * message? }`. Quota and rate answers become sentences a player can act on.
 */
export async function remoteFailure(response: Response): Promise<RemoteError> {
  const payload = await response.json().catch(() => null) as { code?: unknown; error?: unknown; message?: unknown; quota?: unknown } | null;
  let code = 'remote_error';
  let message = `The remote answered HTTP ${response.status}.`;
  if (typeof payload?.code === 'string') {
    code = payload.code;
    if (typeof payload.error === 'string') message = payload.error;
  } else if (typeof payload?.error === 'string') {
    code = payload.error;
    message = typeof payload.message === 'string' ? payload.message : message;
  }
  const friendly = FRIENDLY[code];
  if (friendly) message = friendly;
  else if (response.status === 429) { code = 'rate_limited'; message = FRIENDLY.rate_limited; }
  // The remote's own 4xx are the caller's to see (not found, too large, busy…); anything else is a bad gateway.
  return new RemoteError(response.status >= 400 && response.status < 500 ? response.status : 502, code, message);
}

const FRIENDLY: Record<string, string> = {
  // Storage quotas by plan: worlds are unlimited; cloud saves and total space depend on the plan,
  // published worlds do not count. A refusal only stops the cloud copy — this computer keeps everything.
  quota_bytes_exceeded: 'Your cloud space for this plan is full, so this was not uploaded. Everything stays on this device and keeps working. Remove an older cloud draft, or upgrade your plan for more space.',
  quota_count_exceeded: 'You already keep as many cloud saves as your plan allows, so this was not uploaded. Everything stays on this device and keeps working. Remove an older cloud save, or upgrade your plan.',
  publish_rate_limited: 'You have reached today’s limit for publishing new worlds. This world stays a draft; try again later.',
  rate_limited: 'Too many requests to the remote just now. Wait a minute and try again.',
  busy: 'Another upload or publish of this world is still running. Try again when it has finished.',
  lease_invalid: 'This upload took too long and lost its turn. Try again.',
  unknown_user: 'Sign in to your Worldlines account once on the web, then try again.',
  anonymous_forbidden: 'Guest accounts cannot keep worlds on the remote. Sign in with Google or email.',
  identity_unavailable: 'The account service cannot be reached right now. Try again later.',
  identity_misconfigured: 'The remote is misconfigured right now. Try again later.',
  too_many_tokens: 'You have as many API keys as an account may keep. Revoke one you no longer use, then try again.',
};

export interface RemoteDeps { fetch?: typeof fetch; activeStore?: () => LocalWorldStore | null }

/**
 * The signed-in account's access token, refreshed when (nearly) expired or when
 * `force` (the caller just got a 401 with it). Null when nobody is signed in or
 * the session is gone. For in-process callers only: a Worldlines service call that
 * accepts the same token (the voice ticket at ai.worldlines.gg, voice-live-ticket.ts),
 * and browser mode's runtime (model gateway, world downloads) through
 * `globalThis.__airpAccountToken`. No HTTP route ever returns a token.
 */
export async function accountAccessToken(opts: { force?: boolean; fetch?: typeof fetch } = {}): Promise<string | null> {
  try {
    const config = await readRemoteConfig();
    if (!config.auth || !config.session) return null;
    const signed: Signed = { url: config.url, auth: config.auth, session: config.session };
    if (!opts.force && config.session.expiresAt - EXPIRY_SLACK_MS > Date.now()) return config.session.accessToken;
    return (await refreshSession(signed, opts.fetch)).accessToken;
  } catch {
    return null;
  }
}
(globalThis as { __airpAccountToken?: typeof accountAccessToken }).__airpAccountToken = accountAccessToken;

export async function remoteWhoami(_repoRoot: string, deps: RemoteDeps = {}): Promise<{ ok: true; uid: string; email: string | null; url: string }> {
  const config = await requireSession();
  if (isServicesUrl(config.url)) return services.whoami(config, deps);
  const body = await (await call(config, 'api/sync/whoami', {}, deps.fetch)).json() as { uid?: unknown };
  if (typeof body.uid !== 'string') throw new RemoteError(502, 'remote_error', 'The remote did not say who you are.');
  return { ok: true, uid: body.uid, email: config.session.email, url: config.url };
}

export function pairOf(manifest: Record<string, unknown> | null | undefined): RemotePair | null {
  const raw = manifest?.remote as Partial<RemotePair> | undefined;
  if (!raw || typeof raw.url !== 'string' || typeof raw.id !== 'string') return null;
  return {
    url: raw.url,
    id: raw.id,
    revision: typeof raw.revision === 'number' ? raw.revision : 0,
    hash: typeof raw.hash === 'string' ? raw.hash : null,
    from: raw.from === 'public' ? 'public' : 'tenant',
    syncedAt: typeof raw.syncedAt === 'string' ? raw.syncedAt : '',
  };
}

/** Local workshop worlds under `root` paired with `(url, id)`. */
export async function pairedLocal(root: string, url: string): Promise<Map<string, { localId: string; pair: RemotePair }>> {
  const out = new Map<string, { localId: string; pair: RemotePair }>();
  const dirs = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of dirs) {
    if (!entry.isDirectory() || !isSyncWorldId(entry.name)) continue;
    const manifest = await readManifestFile(path.join(root, entry.name));
    const pair = pairOf(manifest);
    if (manifest?.id !== entry.name || !pair || pair.url !== url) continue;
    out.set(pair.id, { localId: entry.name, pair });
  }
  return out;
}

export interface RemoteWorld { id: string; revision: number; cover?: unknown; coverUrl?: string | null; [key: string]: unknown }

const COVER_HASH = /^[0-9a-f]{32}$/;
const COVER_TYPE = /^image\/(?:webp|png|jpeg|avif)$/;
/** Largest cover the local server relays to the page. */
export const MAX_REMOTE_COVER_BYTES = 8 * 1024 * 1024;

/**
 * The page's URL for a remote world's cover: this
 * local server relays it, so the page never holds the account session. The
 * hash makes the URL immutable (the media Service Worker keeps it).
 */
export function remoteCoverUrl(id: string, from: 'tenant' | 'public', cover: unknown): string | null {
  const hash = (cover as { hash?: unknown } | null | undefined)?.hash;
  if (!isSyncWorldId(id) || typeof hash !== 'string' || !COVER_HASH.test(hash)) return null;
  return `/api/remote/cover?id=${encodeURIComponent(id)}&from=${from}&h=${hash}`;
}

/** Fetch one remote cover with the account session; the bytes, their type, and whether they match `h`. */
export async function remoteCover(_repoRoot: string, input: { id?: unknown; from?: unknown; h?: unknown; rev?: unknown }, deps: RemoteDeps = {}): Promise<{ bytes: Buffer; type: string; pinned: boolean }> {
  const config = await requireSession();
  const id = isSyncWorldId(input.id) ? input.id : null;
  if (!id) throw new RemoteError(400, 'invalid_argument', 'Expected a world id (made-xxxxxxxx).');
  const from = input.from === 'public' ? 'public' : 'tenant';
  const h = typeof input.h === 'string' && COVER_HASH.test(input.h) ? input.h : null;
  if (isServicesUrl(config.url)) {
    const rev = typeof input.rev === 'string' && /^\d{1,10}$/.test(input.rev) ? Number(input.rev) : null;
    return services.cover(config, { id, from, rev }, deps);
  }
  const response = await call(config, `api/sync/worlds/${encodeURIComponent(id)}/cover?from=${from}${h ? `&h=${h}` : ''}`, { headers: { accept: 'image/*' } }, deps.fetch);
  const type = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (!COVER_TYPE.test(type)) throw new RemoteError(502, 'remote_error', 'The remote did not send a picture.');
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > MAX_REMOTE_COVER_BYTES) throw new RemoteError(502, 'remote_error', 'The remote cover is too large.');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_REMOTE_COVER_BYTES) throw new RemoteError(502, 'remote_error', 'The remote cover is too large.');
  const pinned = h !== null && createHash('sha256').update(bytes).digest('hex').slice(0, 32) === h;
  return { bytes, type, pinned };
}

/** The remote list, each world annotated with the local world it is paired with. */
export async function remoteWorlds(repoRoot: string, deps: RemoteDeps = {}) {
  const config = await requireSession();
  const body = isServicesUrl(config.url)
    ? await services.list(config, deps)
    : await (await call(config, 'api/sync/worlds', {}, deps.fetch)).json() as { uid?: string; admin?: unknown; drafts?: RemoteWorld[]; public?: RemoteWorld[] };
  const [drafts, shared] = await Promise.all([pairedLocal(worldsRoot(repoRoot), config.url), pairedLocal(publishedRoot(repoRoot), config.url)]);
  // An uploaded local draft is paired as `tenant`; after publishing it is the same pair, now public.
  const local = (id: string, scope: 'tenant' | 'public') => {
    const hit = scope === 'tenant' ? drafts.get(id) : shared.get(id) ?? drafts.get(id);
    if (!hit) return null;
    const root = scope === 'public' && shared.has(id) ? 'published' : 'worlds';
    return { path: `${root}/${hit.localId}`, revision: hit.pair.revision };
  };
  return {
    ok: true as const,
    url: config.url,
    uid: body.uid ?? null,
    email: config.session.email,
    // Seam for the admin tools: whatever the remote says about this account, passed through (false when it says nothing).
    admin: body.admin === true,
    drafts: (body.drafts ?? []).map((w) => ({ ...w, local: local(w.id, 'tenant'), coverUrl: 'coverUrl' in w ? w.coverUrl : remoteCoverUrl(w.id, 'tenant', w.cover) })),
    public: (body.public ?? []).map((w) => ({ ...w, local: local(w.id, 'public'), coverUrl: 'coverUrl' in w ? w.coverUrl : remoteCoverUrl(w.id, 'public', w.cover) })),
  };
}

/** The local author's own original behind `worlds/made-…` (or an official edition's owner copy, `worlds/<edition id>`), or a 4xx. */
export async function localOriginal(repoRoot: string, worldPath: unknown) {
  if (typeof worldPath !== 'string' || !worldPath.startsWith('worlds/') || !isSyncWorldId(worldPath.slice('worlds/'.length))) throw new RemoteError(400, 'invalid_argument', 'Expected the save path of a world made in the workshop.');
  const root = await fs.realpath(worldsRoot(repoRoot)).catch(() => null);
  const dir = root ? path.join(root, worldPath.slice('worlds/'.length)) : null;
  const real = dir ? await fs.realpath(dir).catch(() => null) : null;
  if (!root || !real || real !== dir) throw new RemoteError(404, 'not_found', 'Save not found.');
  const manifest = await readManifestFile(real);
  const meta = workshopOf(manifest);
  if (!manifest || !meta || manifest.id !== path.basename(real)) throw new RemoteError(404, 'not_found', 'Only the original of a workshop world can be uploaded.');
  if (meta.owner !== userId()) throw new RemoteError(403, 'not_owner', 'Only a world you made here can be uploaded.');
  return { dir: real, manifest };
}

/** 「上传到我的远端草稿」: bundle the local draft and upload it into the caller's remote tenant. */
export async function pushToRemote(repoRoot: string, worldPath: unknown, deps: RemoteDeps = {}) {
  const config = await requireSession();
  const { dir, manifest } = await localOriginal(repoRoot, worldPath);
  const active = deps.activeStore?.() ?? null;
  // What this upload carries, taken BEFORE it: an edit made while it is on the wire still counts as unsynced.
  const stamp = await contentStamp(dir);
  const digest = manifestDigest(manifest);
  if (isServicesUrl(config.url)) {
    const done = await services.push(config, { dir, manifest, store: active && path.resolve(active.worldRoot) === dir ? active : null }, deps);
    await markSynced(dir, stamp, digest);
    return done;
  }
  const built = await buildBundle(dir, { store: active && path.resolve(active.worldRoot) === dir ? active : null });
  const pair = pairOf(manifest);
  const target = pair && pair.url === config.url ? pair.id : String(manifest.id);
  const response = await call(config, `api/sync/worlds?id=${encodeURIComponent(target)}`, {
    method: 'POST',
    headers: { 'content-type': BUNDLE_TYPE },
    body: new Uint8Array(built.bundle),
  }, deps.fetch);
  const result = await response.json() as { id: string; revision: number; hash: string; renamed?: boolean; replaced?: boolean };
  const next: RemotePair = { url: config.url, id: result.id, revision: result.revision, hash: result.hash, from: 'tenant', syncedAt: new Date().toISOString() };
  // Re-read: the world may have changed while the bundle was on the wire; only the pair is written.
  const fresh = await readManifestFile(dir) ?? manifest;
  await writeManifestFile(dir, { ...fresh, remote: next });
  await markSynced(dir, stamp, digest);
  return { ok: true as const, id: result.id, revision: result.revision, hash: result.hash, replaced: result.replaced === true, renamed: result.renamed === true, files: built.files, bytes: built.bytes, skipped: built.skipped };
}

/** 在远端发布: the remote moves the draft out of the tenant into its public area. */
export async function publishOnRemote(repoRoot: string, id: unknown, deps: RemoteDeps = {}) {
  const config = await requireSession();
  if (!isSyncWorldId(id)) throw new RemoteError(400, 'invalid_argument', 'Expected a world id (made-xxxxxxxx).');
  // An official edition is republished on the Worldlines services only (the legacy VPS never held them).
  if (isServicesUrl(config.url)) return services.publish(config, id, deps);
  if (!MADE_ID.test(id)) throw new RemoteError(400, 'invalid_argument', 'Expected a world id (made-xxxxxxxx).');
  const result = await (await call(config, `api/sync/worlds/${id}/publish`, { method: 'POST' }, deps.fetch)).json() as Record<string, unknown>;
  return { ok: true as const, ...result };
}

/**
 * 撤回发布: the remote moves the caller's public world back into their tenant
 * as a draft. Named by remote id, or by a local original's save path (its
 * remembered pair). A world that is not public there (never published, or
 * already withdrawn) answers `not_public`, which the local 「撤回发布」 treats
 * as nothing left to withdraw.
 */
export async function unpublishOnRemote(repoRoot: string, input: unknown, deps: RemoteDeps = {}) {
  const config = await requireSession();
  const body = (typeof input === 'object' && input !== null ? input : {}) as { id?: unknown; worldPath?: unknown };
  let id = body.id;
  if (id === undefined && body.worldPath !== undefined) {
    const { manifest } = await localOriginal(repoRoot, body.worldPath);
    const pair = pairOf(manifest);
    if (!pair || pair.url !== config.url) throw new RemoteError(404, 'not_public', 'This world was never published to this remote.');
    id = pair.id;
  }
  // The official worlds stay in the lobby.
  if (isOfficialId(id)) throw new RemoteError(400, 'official_world', 'Official worlds stay public. Republish to update one.');
  if (typeof id !== 'string' || !MADE_ID.test(id)) throw new RemoteError(400, 'invalid_argument', 'Expected a world id (made-xxxxxxxx).');
  if (isServicesUrl(config.url)) return services.unpublish(config, id, deps);
  try {
    const result = await (await call(config, `api/sync/worlds/${id}/unpublish`, { method: 'POST' }, deps.fetch)).json() as Record<string, unknown>;
    return { ok: true as const, id, ...result };
  } catch (error) {
    if (error instanceof RemoteError && error.status === 404) throw new RemoteError(404, 'not_public', 'This world is not public on the remote.');
    throw error;
  }
}

/**
 * 强制撤回 (admins only; the remote decides and answers 403 `not_admin`
 * otherwise): another author's public world goes back to THEIR remote drafts.
 */
export async function forceUnpublishOnRemote(_repoRoot: string, input: unknown, deps: RemoteDeps = {}) {
  const config = await requireSession();
  const body = (typeof input === 'object' && input !== null ? input : {}) as { id?: unknown; reason?: unknown };
  if (typeof body.id !== 'string' || !MADE_ID.test(body.id)) throw new RemoteError(400, 'invalid_argument', 'Expected a world id (made-xxxxxxxx).');
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : '';
  // The identity service has no admin override on another owner's resource yet: only the legacy sync API can take a world down.
  if (isServicesUrl(config.url)) throw new RemoteError(501, 'not_supported', 'Taking down another author\'s world is not available on the Worldlines services yet.');
  const result = await (await call(config, `api/sync/worlds/${body.id}/force-unpublish`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(reason ? { reason } : {}),
  }, deps.fetch)).json() as Record<string, unknown>;
  return { ok: true as const, id: body.id, ...result };
}

/**
 * 「下载到本地」. One of the caller's remote drafts becomes a local DRAFT the
 * local author can keep building (owner rewritten to this machine's user); a
 * public world is INSTALLED into the local published root, where it plays as a
 * fresh copy like any published world. An existing local world paired with
 * the same remote world is replaced — for a draft only when `replace` is set,
 * because the local copy may hold edits the remote does not have.
 */
export async function pullFromRemote(repoRoot: string, input: unknown, deps: RemoteDeps = {}) {
  const config = await requireSession();
  const body = (typeof input === 'object' && input !== null ? input : {}) as { id?: unknown; from?: unknown; replace?: unknown; asCopy?: unknown };
  const id = body.id;
  // 「两份都保留」: the remote world lands as a NEW local world with its own id and no pair.
  const asCopy = body.asCopy === true;
  if (!isSyncWorldId(id)) throw new RemoteError(400, 'invalid_argument', 'Expected a world id (made-xxxxxxxx).');
  // An official edition comes down only as its OWNER's editable copy (`worlds/<edition id>`; the storage service
  // refuses anyone else's draft download): to play one, every player opens it from the lobby.
  const official = isOfficialId(id);
  if (official && asCopy) throw new RemoteError(400, 'official_world', 'An official world is never copied: its owner republishes it.');
  if (official && (body.from === 'public' || !isServicesUrl(config.url))) throw new RemoteError(400, 'official_world', 'Official worlds open from the lobby. Only their owner downloads one, to edit it.');
  // Its files are public (the lobby plays them), so storage would hand anyone the published revision: ask identity.
  if (official && !(await services.owns(config, id, deps))) throw new RemoteError(403, 'not_owner', 'Only the owner of this official world can download it to edit.');
  const from = body.from === 'public' ? 'public' : 'tenant';
  const root = from === 'public' ? publishedRoot(repoRoot) : worldsRoot(repoRoot);
  await fs.mkdir(root, { recursive: true });

  const paired = asCopy ? undefined : (await pairedLocal(root, config.url)).get(id);
  // The owner copy of an edition always sits at worlds/<edition id> (the shelf files it under that edition).
  const occupied = official && !paired && await fs.lstat(path.join(root, id)).then(() => true, () => false);
  if ((paired || occupied) && from === 'tenant' && body.replace !== true) {
    throw new RemoteError(409, 'exists_local', 'This world is already on this computer. Replace the local copy with the remote one?');
  }
  const active = deps.activeStore?.() ?? null;
  const existing = paired?.localId ?? (occupied ? id : null);
  if (existing && active && path.resolve(active.worldRoot) === path.join(root, existing)) {
    throw new RemoteError(409, 'active_world', 'Open another world before replacing this one.');
  }

  let revision: number;
  let extracted: Awaited<ReturnType<typeof extractBundle>>;
  if (isServicesUrl(config.url)) {
    ({ revision, extracted } = await services.download(config, { id, from, root }, deps));
  } else {
    const response = await call(config, `api/sync/worlds/${id}/bundle?from=${from}`, { headers: { accept: BUNDLE_TYPE } }, deps.fetch);
    const bundle = Buffer.from(await response.arrayBuffer());
    revision = Number(response.headers.get('x-airp-revision')) || 0;
    extracted = await extractBundle(bundle, root);
  }
  try {
    let localId = paired?.localId ?? id;
    if (!paired && !official) {
      while (await fs.lstat(path.join(root, localId)).then(() => true, () => false)) localId = `made-${randomUUID().replace(/-/g, '').slice(0, 8)}`;
    }
    const pair: RemotePair = { url: config.url, id, revision, hash: extracted.hash, from, syncedAt: new Date().toISOString() };
    let workshop: WorkshopMeta;
    if (official) {
      // The edition stays public while its owner edits; 「重新发布」 uploads and publishes the new revision.
      workshop = { status: 'published', owner: userId(), createdAt: new Date().toISOString(), official: true };
    } else {
      const meta = workshopOf(extracted.manifest)!;
      const { publishedAt: _dropped, ...draftMeta } = meta;
      // A draft is the local author's to keep building; a public world stays its author's.
      workshop = from === 'tenant' ? { ...draftMeta, status: 'draft', owner: userId() } : { ...meta, status: 'published' };
    }
    await writeManifestFile(extracted.dir, {
      ...stripPairing(extracted.manifest),
      id: localId,
      workshop,
      ...(asCopy ? {} : { remote: pair }),
    });
    const replaced = paired || occupied ? await trashDir(root, localId) : false;
    await fs.rename(extracted.dir, path.join(root, localId));
    // A draft that now matches its cloud copy: not 「未同步」.
    if (from === 'tenant' && !asCopy) {
      const dir = path.join(root, localId);
      const fresh = await readManifestFile(dir);
      if (fresh) await markSynced(dir, await contentStamp(dir), manifestDigest(fresh));
    }
    return { ok: true as const, id: localId, worldPath: `${from === 'public' ? 'published' : 'worlds'}/${localId}`, from, revision, replaced };
  } finally {
    await fs.rm(extracted.dir, { recursive: true, force: true });
  }
}

export { BundleError };

// ── API keys (personal access tokens) ───────────────────────────────────────
//
// a signed-in player
// mints a `wl_pat_…` at the identity service (POST /v1/pats) to use as the
// OpenAI API key against the Worldlines model gateway. This server relays with
// the account session (the browser version: the in-tab server, straight to the
// identity service). The value comes back ONCE in the create answer and is never
// written anywhere by this app — not in remote.json, not in a world, not in a log.

export interface PatView { id: string; name: string; hint: string | null; scopes: string[]; createdAt: string; expiresAt: string | null; lastUsedAt: string | null }
const PAT_SCOPE = /^[a-z]+:[a-z]+(?::[a-z0-9-]+)?$/;
export const DEFAULT_PAT_SCOPES = ['api:use'];

async function identityOf(): Promise<{ signed: Signed; issuer: string }> {
  const signed = await requireSession();
  if (signed.auth.provider !== 'worldlines') throw new RemoteError(409, 'not_connected', 'Sign in again with your Worldlines account first.');
  return { signed, issuer: signed.auth.issuer.replace(/\/+$/, '') };
}
const patView = (raw: Record<string, unknown>): PatView => ({
  id: String(raw.id ?? ''),
  name: String(raw.name ?? ''),
  hint: typeof raw.hint === 'string' ? raw.hint : null,
  scopes: Array.isArray(raw.scopes) ? raw.scopes.map(String) : [],
  createdAt: String(raw.created_at ?? ''),
  expiresAt: typeof raw.expires_at === 'string' ? raw.expires_at : null,
  lastUsedAt: typeof raw.last_used_at === 'string' ? raw.last_used_at : null,
});

export async function listApiKeys(_repoRoot: string, deps: RemoteDeps = {}): Promise<{ ok: true; keys: PatView[] }> {
  const { signed, issuer } = await identityOf();
  const body = await (await call(signed, `${issuer}/v1/pats`, {}, deps.fetch)).json() as { pats?: Record<string, unknown>[] };
  return { ok: true, keys: (body.pats ?? []).map(patView) };
}

/** → the key's record and its value, which the caller shows once and forgets. */
export async function createApiKey(_repoRoot: string, input: unknown, deps: RemoteDeps = {}): Promise<{ ok: true; key: PatView; token: string }> {
  const body = (typeof input === 'object' && input !== null ? input : {}) as { name?: unknown; expiresInDays?: unknown; scopes?: unknown };
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 100) : '';
  if (!name) throw new RemoteError(400, 'invalid_argument', 'Give the key a name.');
  const days = body.expiresInDays === null || body.expiresInDays === undefined ? null : Number(body.expiresInDays);
  if (days !== null && (!Number.isInteger(days) || days < 1 || days > 365)) throw new RemoteError(400, 'invalid_argument', 'Choose how long the key lasts.');
  const scopes = Array.isArray(body.scopes) && body.scopes.length ? [...new Set(body.scopes.map(String))] : DEFAULT_PAT_SCOPES;
  if (!scopes.every((s) => PAT_SCOPE.test(s))) throw new RemoteError(400, 'invalid_argument', 'Unknown key permission.');
  const { signed, issuer } = await identityOf();
  const response = await call(signed, `${issuer}/v1/pats`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, scopes, ...(days !== null ? { expires_in_days: days } : {}) }),
  }, deps.fetch);
  const created = await response.json() as Record<string, unknown>;
  if (typeof created.token !== 'string' || !created.token.startsWith('wl_pat_')) throw new RemoteError(502, 'remote_error', 'The account service did not return a key.');
  return { ok: true, key: patView(created), token: created.token };
}

export async function revokeApiKey(_repoRoot: string, id: unknown, deps: RemoteDeps = {}): Promise<{ ok: true; id: string }> {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new RemoteError(400, 'invalid_argument', 'Expected a key id.');
  const { signed, issuer } = await identityOf();
  await call(signed, `${issuer}/v1/pats/${encodeURIComponent(id)}`, { method: 'DELETE' }, deps.fetch);
  return { ok: true, id };
}
