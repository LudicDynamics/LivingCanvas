/**
 * The guest trial on the page. Signed out on
 * canvas.worldlines.gg, ONE world plays: 末班车 (last-train, any edition), shipped with the site and the
 * newcomer tutorial at the same time. Everything else in the lobby is locked behind signing in.
 *
 *   - the lobby: the trial tile says 「免登录试玩」, every other tile shows a lock and 「登录后解锁全部世界」;
 *   - entering: the trial world (its template or a save of it) starts a guest session + the trial credits
 *     (`/api/remote/guest`), any other world opens the sign-in (reason `unlock`);
 *   - sign-in prompts, each with 「登录送新手礼包 500 积分，进度会保留」: trial credits nearly used
 *     (`trial-low`) or used up (`trial`), saving to the cloud (`cloud`), opening another world (`unlock`),
 *     reaching an ending (`ending`);
 *   - signing in keeps the progress: the save stays in this browser and joins the account (the server
 *     migrates it, apps/server sync/guest-session.ts), and the newcomer gift follows as for any new account.
 */
import { useEffect, useState } from 'react';
// The subpath, not the barrel: the barrel pulls node-only modules into the page.
import { isGuestTrialTemplatePath, isGuestTrialWorldId } from '@airp/shared/guest-trial';
import { airpGateway, type GuestTrialView, type WorldShelf } from './airp-gateway.js';
import { ACCOUNT_CHANGED_EVENT, openAccountPanel, type AccountReason } from './account-open.js';

export type { GuestTrialView };
/** Why a guest is asked to sign in (the account panel's line). */
export type GuestReason = 'trial' | 'trial-low' | 'unlock' | 'cloud' | 'ending';
export const GUEST_REASONS: readonly GuestReason[] = ['trial', 'trial-low', 'unlock', 'cloud', 'ending'];
export const isGuestReason = (r: AccountReason): r is GuestReason => typeof r === 'string' && (GUEST_REASONS as readonly string[]).includes(r);

/** Broadcast when the trial's state changed (started, credits re-read). */
export const GUEST_TRIAL_EVENT = 'airp:guest-trial';

type Group = NonNullable<WorldShelf['groups']>[number];

/** The shelf group of a trial world that `worldPath` opens (its template or one of its saves), else null. */
export function trialGroupOf(shelf: WorldShelf | null | undefined, worldPath: string): Group | null {
  for (const g of shelf?.groups ?? []) {
    if (!isGuestTrialWorldId(g.id) || g.workshop) continue;
    if (g.templatePath === worldPath || g.saves.some((s) => s.path === worldPath)) return g;
  }
  return null;
}

/** May a guest open this world? Only the trial world: its templates, or saves of it. */
export function isTrialWorldPath(shelf: WorldShelf | null | undefined, worldPath: string): boolean {
  return isGuestTrialTemplatePath(worldPath) || trialGroupOf(shelf, worldPath) !== null;
}

/** The lobby tile's guest mark: `trial` (免登录试玩), `locked` (登录后解锁), or null (signed in / no trial here). */
export function guestTileMark(group: { id: string; workshop?: unknown }, guestMode: boolean): 'trial' | 'locked' | null {
  if (!guestMode) return null;
  return isGuestTrialWorldId(group.id) && !group.workshop ? 'trial' : 'locked';
}

/** Is the guest view of the lobby on (the trial is on here and nobody is signed in)? */
export const guestModeOf = (v: Pick<GuestTrialView, 'enabled' | 'signedIn'> | null | undefined) => !!v?.enabled && !v.signedIn;

let current: GuestTrialView | null = null;
function publish(v: GuestTrialView | null) {
  current = v;
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(GUEST_TRIAL_EVENT));
}
/** The last known state (null before the first read). */
export const guestTrialNow = () => current;

/** Read the trial's state from this tab's server. A server without the route = no trial. */
export async function readGuestTrial(): Promise<GuestTrialView | null> {
  try { const v = await airpGateway.guestTrial(); publish(v); return v; } catch { publish(null); return null; }
}

/** Start (or re-read) the trial: a guest session + the trial credits. Null when the server has no trial. */
export async function startGuestTrial(): Promise<GuestTrialView | null> {
  try { const v = await airpGateway.startGuestTrial(); publish(v); return v; } catch { return null; }
}

/** React: the trial's state, re-read on sign-in / sign-out and whenever it changes. */
export function useGuestTrial(): GuestTrialView | null {
  const [v, setV] = useState<GuestTrialView | null>(current);
  useEffect(() => {
    const sync = () => setV(guestTrialNow());
    const reread = () => { void readGuestTrial(); };
    window.addEventListener(GUEST_TRIAL_EVENT, sync);
    window.addEventListener(ACCOUNT_CHANGED_EVENT, reread);
    if (!current) reread();
    return () => { window.removeEventListener(GUEST_TRIAL_EVENT, sync); window.removeEventListener(ACCOUNT_CHANGED_EVENT, reread); };
  }, []);
  return v;
}

// ── the sign-in prompts ─────────────────────────────────────────────────────────

/**
 * Should this guest be asked now? `trial-low` and `ending` once per page load (they come back on their own);
 * `unlock`, `cloud` and `trial` follow a click or a stopped story, so every time.
 */
export function shouldAsk(reason: GuestReason, asked: ReadonlySet<GuestReason>): boolean {
  return reason === 'trial-low' || reason === 'ending' ? !asked.has(reason) : true;
}
const asked = new Set<GuestReason>();
/** The ending prompt waits this long, so the ending card is seen first. */
export const GUEST_ENDING_PROMPT_MS = 6_000;
/** Ask a guest to sign in (the account panel with this reason's line). No-op when signed in / no trial. → asked? */
export function askGuestToSignIn(reason: GuestReason, view: GuestTrialView | null = current): boolean {
  if (!guestModeOf(view) || !shouldAsk(reason, asked)) return false;
  asked.add(reason);
  return openAccountPanel(reason);
}

/** After a turn while a guest plays: re-read the credits; nearly used → the `trial-low` prompt (once). */
export async function afterGuestTurn(): Promise<void> {
  if (!guestModeOf(current) || !current?.active) return;
  const v = await startGuestTrial();
  if (v?.active && v.low) askGuestToSignIn('trial-low', v);
}
