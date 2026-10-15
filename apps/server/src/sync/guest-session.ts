import fs from 'node:fs/promises';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { GUEST_TRIAL_CREDITS, GUEST_TRIAL_LOW_CREDITS, isGuestTrialWorldId } from '@airp/shared';
import { worldsRoot } from '../engine/user-root.js';
import { worldKeyOfRoot } from '../world-shelf.js';
import { gatewayWorld } from '../gateway-world.js';
import { RemoteError, guestTrialOn, onSignedIn, readRemoteConfig, remoteConfigFile, servicesConfig } from './remote-client.js';
import { billingBase, CLAIM_WALLET, putSaveSummary } from './account-data.js';

/**
 * The guest trial: on the static site a signed-out player
 * may play the trial world (末班車 / last-train, its four editions) without an account.
 *
 *   - `startGuest(device)`: identity `POST /v1/guest` (X-Worldlines-Device) → an anonymous session, kept
 *     beside the account session (`guest.json`, same directory, same 0600 rule) — never in a world.
 *   - `guestTrial(device)`: billing `POST /v1/claims/worldlines/guest-trial` → the 200 trial credits the
 *     first time (one per device AND per network, billing decides), afterwards what is left.
 *   - `guestAccessToken()`: the guest's access token for the model gateway — only while nobody is signed in
 *     AND the open world is a trial world (ai.worldlines.gg refuses anything else anyway); refreshed
 *     (rotating) when nearly expired. Registered as `globalThis.__airpGuestToken` for the browser runtime.
 *   - On sign-in (`onSignedIn`): the trial saves on this device go to the account (their summaries are
 *     written to the account's save list, so 「继续」 and 我的记录 show them), and the guest session is dropped.
 *     The saves themselves never move: they are local files and stay where they are.
 *
 * Off unless `AIRP_GUEST_TRIAL=1` (the browser version sets it from VITE_AIRP_GUEST_TRIAL), and only where
 * every world asks for an account (`guestTrialOn`, remote-client.ts): the local edition's worlds are open anyway.
 */
export function guestTrialEnabled(): boolean {
  return guestTrialOn();
}

interface GuestSession { accessToken: string; refreshToken: string; expiresAt: number; uid: string; device: string; createdAt: string }
const EXPIRY_SLACK_MS = 60_000;
const TIMEOUT_MS = 15_000;
const DEVICE = /^[A-Za-z0-9_-]{8,128}$/;

export function guestFile(): string {
  return path.join(path.dirname(remoteConfigFile()), 'guest.json');
}

async function readGuest(): Promise<GuestSession | null> {
  try {
    const g = JSON.parse(await fs.readFile(guestFile(), 'utf8')) as Partial<GuestSession>;
    return typeof g.accessToken === 'string' && typeof g.refreshToken === 'string' && typeof g.uid === 'string' && typeof g.device === 'string'
      ? { accessToken: g.accessToken, refreshToken: g.refreshToken, expiresAt: Number(g.expiresAt) || 0, uid: g.uid, device: g.device, createdAt: String(g.createdAt ?? '') }
      : null;
  } catch {
    return null;
  }
}
async function writeGuest(g: GuestSession): Promise<void> {
  const file = guestFile();
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(g, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temp, file);
}
export async function dropGuest(): Promise<void> {
  await fs.rm(guestFile(), { force: true });
}

async function post(url: string, init: { body?: unknown; token?: string; device?: string }, request: typeof fetch): Promise<{ status: number; body: any }> {
  let res: Response;
  try {
    res = await request(url, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: 'application/json', 'content-type': 'application/json', ...(init.token ? { authorization: `Bearer ${init.token}` } : {}), ...(init.device ? { 'x-worldlines-device': init.device } : {}) },
      body: JSON.stringify(init.body ?? {}),
    });
  } catch (error) {
    throw new RemoteError(502, 'remote_unreachable', `The Worldlines services could not be reached (${error instanceof Error ? error.name : 'network error'}).`);
  }
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

function sessionFrom(body: any, device: string, createdAt: string): GuestSession {
  if (typeof body?.access_token !== 'string' || typeof body?.refresh_token !== 'string' || typeof body?.user?.id !== 'string') throw new RemoteError(502, 'guest_unavailable', 'The account service did not return a guest session.');
  if (body.user.anonymous !== true) throw new RemoteError(502, 'guest_unavailable', 'The account service returned an account, not a guest session.');
  const expiresIn = typeof body.expires_in === 'number' && body.expires_in > 0 ? body.expires_in : 900;
  return { accessToken: body.access_token, refreshToken: body.refresh_token, expiresAt: Date.now() + expiresIn * 1000, uid: body.user.id.toLowerCase(), device, createdAt };
}

const signedIn = async () => Boolean((await readRemoteConfig()).session);

/** A guest session for this device: the one kept here, else a new one from identity. */
export async function startGuest(deviceRaw: unknown, request: typeof fetch = fetch): Promise<GuestSession> {
  if (!guestTrialEnabled()) throw new RemoteError(404, 'guest_trial_off', 'There is no guest trial here.');
  if (await signedIn()) throw new RemoteError(409, 'signed_in', 'You are signed in: every world is open.');
  const kept = await readGuest();
  if (kept) return kept;
  const device = typeof deviceRaw === 'string' && DEVICE.test(deviceRaw) ? deviceRaw : null;
  if (!device) throw new RemoteError(400, 'device_required', 'This browser has no device id.');
  const a = await post(`${servicesConfig().identity}/v1/guest`, { device }, request);
  if (a.status !== 200) {
    // Only identity's own cap is 「used here」; its per-IP request limiter (429 rate_limited) is a busy service, not a used trial.
    const limited = a.status === 429 && a.body?.error === 'guest_limited';
    throw new RemoteError(limited ? 429 : a.status === 404 ? 404 : 503, limited ? 'guest_limited' : 'guest_unavailable', typeof a.body?.message === 'string' ? a.body.message : 'Guest play is not available right now. Sign in to play.');
  }
  const g = sessionFrom(a.body, device, new Date().toISOString());
  await writeGuest(g);
  return g;
}

let refreshing: Promise<GuestSession | null> | null = null;
async function refreshGuest(g: GuestSession, request: typeof fetch): Promise<GuestSession | null> {
  refreshing ??= (async () => {
    const latest = await readGuest();
    if (latest && latest.refreshToken !== g.refreshToken && latest.expiresAt - EXPIRY_SLACK_MS > Date.now()) return latest;
    const a = await post(`${servicesConfig().identity}/v1/token/refresh`, { body: { refresh_token: (latest ?? g).refreshToken } }, request);
    if (a.status === 400 || a.status === 401) { await dropGuest(); return null; } // the guest session is gone: a new one next time
    if (a.status !== 200) return null;
    const next = sessionFrom(a.body, g.device, g.createdAt);
    await writeGuest(next);
    return next;
  })().finally(() => { refreshing = null; });
  return refreshing;
}

/**
 * The guest's access token for a model call: null unless the trial is on, nobody is signed in, a guest
 * session exists and the open world is a trial world. `force` = the last one was refused.
 */
export async function guestAccessToken(opts: { force?: boolean; fetch?: typeof fetch; world?: string | null } = {}): Promise<string | null> {
  try {
    if (!guestTrialEnabled() || await signedIn()) return null;
    const world = opts.world !== undefined ? opts.world : gatewayWorld();
    if (!isGuestTrialWorldId(world)) return null;
    const g = await readGuest();
    if (!g) return null;
    if (!opts.force && g.expiresAt - EXPIRY_SLACK_MS > Date.now()) return g.accessToken;
    return (await refreshGuest(g, opts.fetch ?? fetch))?.accessToken ?? null;
  } catch {
    return null;
  }
}
(globalThis as { __airpGuestToken?: typeof guestAccessToken }).__airpGuestToken = guestAccessToken;

/**
 * The guest's access token for a 「报告问题 / 卡住了」 report (data's bug-report takes guests, manifest v12): any world,
 * but only while the trial is on, nobody is signed in and this device already has a guest session (never starts one).
 */
export async function guestFeedbackToken(opts: { force?: boolean; fetch?: typeof fetch } = {}): Promise<string | null> {
  try {
    if (!guestTrialEnabled() || await signedIn()) return null;
    const g = await readGuest();
    if (!g) return null;
    if (!opts.force && g.expiresAt - EXPIRY_SLACK_MS > Date.now()) return g.accessToken;
    return (await refreshGuest(g, opts.fetch ?? fetch))?.accessToken ?? null;
  } catch {
    return null;
  }
}

export interface GuestTrialView {
  enabled: boolean;
  signedIn: boolean;
  active: boolean;
  /** Credits the trial gave / has left (null = billing did not say). */
  credits: number;
  remaining: number | null;
  low: boolean;
  /** Why there is no trial on this device / network (billing claim_limited, identity guest_limited …), else null. */
  refused: string | null;
  /**
   * Where the trial was already used, for the page's line (「这台设备 / 这个网络已经试玩过了」): billing's guest-trial
   * cap names it (one per device, one per network); identity's guest cap does not (`device-or-network`). Null otherwise.
   */
  refusedBy: GuestRefusedBy | null;
}
export type GuestRefusedBy = 'device' | 'network' | 'device-or-network';

/** Which cap refused: billing / identity say it in `by` when they do, else in their message. */
export function refusedByOf(code: string | null, body: any): GuestRefusedBy | null {
  if (code !== 'claim_limited' && code !== 'guest_limited') return null;
  const by = typeof body?.by === 'string' ? body.by : '';
  if (by === 'device' || by === 'device_kind') return 'device';
  if (by === 'ip' || by === 'network') return 'network';
  const message = typeof body?.message === 'string' ? body.message : '';
  const device = /\bdevice\b/i.test(message);
  const network = /\b(network|address|ip)\b/i.test(message);
  return device && !network ? 'device' : network && !device ? 'network' : 'device-or-network';
}

/** The trial's state; with `device`, starts the guest session and asks billing for the credits (idempotent). */
export async function guestTrial(deviceRaw: unknown, opts: { start?: boolean; fetch?: typeof fetch } = {}): Promise<GuestTrialView> {
  const request = opts.fetch ?? fetch;
  const base: GuestTrialView = { enabled: guestTrialEnabled(), signedIn: await signedIn(), active: false, credits: GUEST_TRIAL_CREDITS, remaining: null, low: false, refused: null, refusedBy: null };
  if (!base.enabled || base.signedIn) return base;
  let g = await readGuest();
  if (!g && !opts.start) return base;
  try {
    g ??= await startGuest(deviceRaw, request);
  } catch (error) {
    if (error instanceof RemoteError && ['guest_limited', 'guest_unavailable', 'device_required', 'remote_unreachable'].includes(error.code)) {
      return { ...base, refused: error.code, refusedBy: refusedByOf(error.code, { message: error.message }) };
    }
    throw error;
  }
  if (g.expiresAt - EXPIRY_SLACK_MS <= Date.now()) g = await refreshGuest(g, request) ?? g;
  const a = await post(`${billingBase()}/v1/claims/${CLAIM_WALLET}/guest-trial`, { token: g.accessToken, device: g.device }, request);
  if (a.status === 200 || a.status === 201) {
    const remaining = typeof a.body?.remaining_mc === 'number' ? Math.max(0, Math.floor(a.body.remaining_mc / 1000)) : null;
    const credits = typeof a.body?.amount_mc === 'number' ? Math.round(a.body.amount_mc / 1000) : GUEST_TRIAL_CREDITS;
    return { ...base, active: true, credits, remaining, low: remaining !== null && remaining <= GUEST_TRIAL_LOW_CREDITS };
  }
  const code = typeof a.body?.error === 'string' ? a.body.error : `http_${a.status}`;
  return { ...base, active: false, remaining: 0, low: true, refused: code, refusedBy: refusedByOf(code, a.body) };
}

// ── sign-in: the trial saves go to the account ─────────────────────────────────

/** Saves on this device whose world is a trial world → [{ saveId, worldId, worldName }]. */
export function localTrialSaves(repoRoot: string): { saveId: string; worldId: string; worldName: string | null }[] {
  const root = worldsRoot(repoRoot);
  if (!existsSync(root)) return [];
  const out: { saveId: string; worldId: string; worldName: string | null }[] = [];
  for (const e of readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'users' || e.name === 'published') continue;
    const dir = path.join(root, e.name);
    const key = worldKeyOfRoot(repoRoot, dir);
    if (!isGuestTrialWorldId(key)) continue;
    let name: string | null = null;
    try { const n = (JSON.parse(readFileSync(path.join(dir, 'world.json'), 'utf8')) as { name?: unknown }).name; name = typeof n === 'string' ? n : null; } catch { /* no name */ }
    out.push({ saveId: e.name, worldId: key!, worldName: name });
  }
  return out;
}

/**
 * After a sign-in on this device: the guest's trial saves join the account (save summaries in the account's
 * list), then the guest session is dropped. Best effort per save; never fails the sign-in.
 */
export async function migrateGuestToAccount(repoRoot: string, deps: { fetch?: typeof fetch } = {}): Promise<{ migrated: string[] }> {
  const g = await readGuest();
  if (!g) return { migrated: [] };
  const migrated: string[] = [];
  for (const s of localTrialSaves(repoRoot)) {
    try {
      await putSaveSummary(s.saveId, { worldId: s.worldId, worldName: s.worldName }, deps.fetch ? { fetch: deps.fetch } : {});
      migrated.push(s.saveId);
    } catch { /* the page's next turn writes it again */ }
  }
  await dropGuest();
  return { migrated };
}

let repoForMigration: string | null = null;
/** index.ts: where the saves are; from then on every sign-in migrates the guest's trial saves. */
export function installGuestMigration(repoRoot: string): void {
  if (repoForMigration) { repoForMigration = repoRoot; return; }
  repoForMigration = repoRoot;
  onSignedIn(() => migrateGuestToAccount(repoForMigration!).then(() => undefined));
}
