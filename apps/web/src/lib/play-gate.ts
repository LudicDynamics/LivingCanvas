/**
 * entering a world — a launcher
 * brick's 开始 / 继续 / 进入, the saves dialog, 「做一个世界」 — asks a signed-out
 * player to sign in (or sign up: the first Google or email-code sign-in creates
 * the account) and then carries on into the world they picked.
 *
 *   - hosted: the seat gateway owns the session, and the 「账号」 panel signs a
 * guest in against it (components/chrome/useHostedSignIn.ts; the team
 *     2026-09-30：「账号那个 popup 不就很好？」). The world they picked is
 *     remembered for this tab: signing in reloads the page once (only a page
 *     load gets a seat) and the app enters it as it comes back. With no panel
 *     mounted the gateway's own `/login` page is the fallback.
 *   - local `pnpm dev`: the 「账号」 panel signs this computer in to the same
 *     account (components/chrome/AccountPanel.tsx). It opens with a 「登录后开始
 *     游玩」 line; once the sign-in lands (ACCOUNT_CHANGED_EVENT) the pick runs.
 *     The local edition (login on) asks only for a shared world or a hosted
 * feature (`sharedOnly`): the worlds on this computer play
 *     signed out with the player's own key.
 *   - no account system at all (an old local server without `/api/remote/*`,
 *     or `AIRP_PLAY_WITHOUT_ACCOUNT=1`): play is never blocked.
 */
import { useEffect, useState } from 'react';
import { ACCOUNT_CHANGED_EVENT, openAccountPanel, type AccountReason } from './account-open.js';

export type AccountMode =
  | { kind: 'hosted'; signedIn: boolean }
  /**
   * guestTrial: the trial world plays signed out here (lib/guest-trial.ts, the design notes).
   * sharedOnly: the local edition with login on — only the worlds shared through the Worldlines services
   * (`published/…`) and the account's hosted features ask for the account; this computer's worlds play with
   * the player's own key (server `playAccountScope`, sync/remote-client.ts).
   */
  | { kind: 'local'; signedIn: boolean; required: boolean; guestTrial?: boolean; sharedOnly?: boolean }
  | { kind: 'none' };

export type GateDecision = 'go' | 'sign-in-hosted' | 'sign-in-local';

/** A world shared through the Worldlines services (a published workshop world), not one on this computer. */
export const isSharedWorldPath = (worldPath: string | null | undefined): boolean => typeof worldPath === 'string' && /^published\//.test(worldPath);

/**
 * What the player is about to do: play a world on this computer (`local`: a template that ships with the
 * game, a save here, making a new world) or anything that needs the account (`account`: a shared world,
 * publishing, the cloud). Only the local edition with login on tells the two apart (`sharedOnly`).
 */
export type GateTarget = 'local' | 'account';
export const playTargetOf = (worldPath?: string | null): GateTarget => (isSharedWorldPath(worldPath) ? 'account' : 'local');

/** Pure: may this player go ahead, or where do they sign in first? */
export function gateDecision(mode: AccountMode, target: GateTarget = 'account'): GateDecision {
  if (mode.kind === 'hosted') return mode.signedIn ? 'go' : 'sign-in-hosted';
  if (mode.kind === 'local') return mode.signedIn || !mode.required || (mode.sharedOnly && target === 'local') ? 'go' : 'sign-in-local';
  return 'go';
}

/**
 * The lobby tile's lock for a shared world: the local edition with login on, signed out, marks
 * the tiles that only open with the account — a world shared through the Worldlines services (`published/…`) with
 * nothing of it on this computer (no original of the author's, no save). It asks the same `gateDecision` the click
 * does, so the mark and the sign-in prompt never disagree. Templates, saves, login off, the remote edition (its
 * own lock is the guest trial's, lib/guest-trial.ts) and a signed-in player: never.
 */
export function accountTileLocked(
  mode: AccountMode | null,
  group: { templatePath: string | null; workshop?: { editPath: string | null } | null; saves?: readonly unknown[] },
): boolean {
  if (!mode || mode.kind !== 'local' || !mode.sharedOnly) return false;
  if (group.workshop?.editPath || (group.saves?.length ?? 0) > 0) return false;
  if (playTargetOf(group.templatePath) !== 'account') return false;
  return gateDecision(mode, 'account') !== 'go';
}

/** Is `/auth/me` a gateway's answer (JSON with `signedIn`)? A dev server answers HTML or 404. */
export function hostedAnswer(status: number, contentType: string | null, body: unknown): { signedIn: boolean } | null {
  if (status !== 200 || !(contentType ?? '').includes('application/json')) return null;
  if (typeof body !== 'object' || body === null || typeof (body as { signedIn?: unknown }).signedIn !== 'boolean') return null;
  const b = body as { signedIn: boolean; uid?: unknown };
  return { signedIn: b.signedIn && typeof b.uid === 'string' && b.uid.length > 0 };
}

/** Local `/api/remote/settings` → the mode; a failure (403 on a seat, 404 on an old server) = no account system. */
export function localAnswer(settings: { signedIn?: unknown; playRequiresAccount?: unknown; playAccountScope?: unknown; guestTrial?: unknown } | null): AccountMode {
  if (!settings || typeof settings.signedIn !== 'boolean') return { kind: 'none' };
  const required = settings.playRequiresAccount !== false && settings.playAccountScope !== 'none';
  return {
    kind: 'local', signedIn: settings.signedIn, required,
    ...(settings.guestTrial === true ? { guestTrial: true } : {}),
    ...(required && settings.playAccountScope === 'shared' ? { sharedOnly: true } : {}),
  };
}

/**
 * The guest trial's part of the gate (pure): a signed-out player where the trial is on enters the trial world
 * as a guest (`guest`) and is asked to sign in for any other (`unlock`); null = the gate as before.
 */
export function guestDecision(mode: AccountMode, trialWorld: boolean): 'guest' | 'unlock' | null {
  if (mode.kind !== 'local' || !mode.guestTrial || mode.signedIn || !mode.required || mode.sharedOnly) return null;
  return trialWorld ? 'guest' : 'unlock';
}
/** In the guest view, the panel's line says what signing in unlocks: another world / the cloud. */
export function guestReasonFor(mode: AccountMode, reason: AccountReason): AccountReason {
  if (mode.kind !== 'local' || !mode.guestTrial || mode.signedIn) return reason;
  return reason === 'play' ? 'unlock' : reason === 'publish' ? 'cloud' : reason;
}

const baseOf = () => ((import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/');

/** Once `/auth/me` has answered 404, this page is not behind a seat gateway: stop asking (one console line, not one per check). */
let noGateway = false;

/** Ask the deployment who this is. Never throws. */
export async function detectAccountMode(): Promise<AccountMode> {
  if (!noGateway) try {
    const res = await fetch(`${baseOf()}auth/me`, { headers: { accept: 'application/json' }, cache: 'no-store' });
    if (res.status === 404) noGateway = true;
    const type = res.headers.get('content-type');
    const body = res.ok && (type ?? '').includes('application/json') ? await res.json().catch(() => null) : null;
    const hosted = hostedAnswer(res.status, type, body);
    if (hosted) return { kind: 'hosted', signedIn: hosted.signedIn };
  } catch { /* not a gateway */ }
  try {
    const res = await fetch('/api/remote/settings', { headers: { accept: 'application/json' }, cache: 'no-store' });
    if (!res.ok) return { kind: 'none' };
    return localAnswer(await res.json().catch(() => null));
  } catch {
    return { kind: 'none' };
  }
}

/** The last mode `useAccountMode` read (null before the first read). */
let modeNow: AccountMode | null = null;
/** React: the account mode, read once and again on every sign-in / sign-out. Null until the first answer. */
export function useAccountMode(): AccountMode | null {
  const [mode, setMode] = useState<AccountMode | null>(modeNow);
  useEffect(() => {
    let live = true;
    const reread = () => { void detectAccountMode().then((m) => { modeNow = m; if (live) setMode(m); }); };
    window.addEventListener(ACCOUNT_CHANGED_EVENT, reread);
    reread();
    return () => { live = false; window.removeEventListener(ACCOUNT_CHANGED_EVENT, reread); };
  }, []);
  return mode;
}

// ── the pick waiting for a sign-in ──────────────────────────────────────────

const PENDING_KEY = 'airp:pending-play';
/** A pick older than this is forgotten: the player has moved on. */
export const PENDING_MS = 15 * 60_000;

let waiting: { run: () => void; at: number; target: GateTarget } | null = null;
let listening = false;

function listen(): void {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener(ACCOUNT_CHANGED_EVENT, () => {
    if (!waiting) return;
    const pick = waiting;
    if (Date.now() - pick.at > PENDING_MS) { waiting = null; return; }
    void detectAccountMode().then((mode) => {
      if (waiting !== pick || gateDecision(mode, pick.target) !== 'go') return;
      waiting = null;
      pick.run();
    });
  });
}

/**
 * Run `proceed` once the player has an account (at once when they do, or when
 * none is needed). `resumePath` is the world to enter after a hosted sign-in,
 * which reloads the page (so `proceed` itself is not kept). `target`: what the
 * action needs (`gateDecision`); the default asks for the account wherever one exists.
 * Resolves to what happened.
 */
export async function withAccount(reasonAsked: AccountReason, proceed: () => void, resumePath?: string, target: GateTarget = 'account'): Promise<GateDecision> {
  const mode = await detectAccountMode();
  const decision = gateDecision(mode, target);
  const reason = guestReasonFor(mode, reasonAsked);
  if (decision === 'go') { waiting = null; proceed(); return decision; }
  if (decision === 'sign-in-hosted') {
    try { if (resumePath) sessionStorage.setItem(PENDING_KEY, JSON.stringify({ path: resumePath, at: Date.now() })); } catch { /* storage blocked: they pick again */ }
    waiting = null;
    if (!openAccountPanel(reason)) window.location.href = `${baseOf()}login`;
    return decision;
  }
  // The newest pick wins; an older one waiting for the same sign-in is dropped.
  waiting = { run: proceed, at: Date.now(), target };
  listen();
  openAccountPanel(reason);
  return decision;
}

/** The world picked before a hosted sign-in, once, if still fresh. */
export function takeResumePath(now = Date.now()): string | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    sessionStorage.removeItem(PENDING_KEY);
    const parsed = raw ? JSON.parse(raw) as { path?: unknown; at?: unknown } : null;
    if (!parsed || typeof parsed.path !== 'string' || typeof parsed.at !== 'number' || now - parsed.at > PENDING_MS) return null;
    return /^(?:worlds|templates|published)\/[A-Za-z0-9][A-Za-z0-9_-]*$/.test(parsed.path) ? parsed.path : null;
  } catch {
    return null;
  }
}
