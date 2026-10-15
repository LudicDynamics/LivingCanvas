/**
 * Signing in lives in ONE place: the 「账号」 panel in the top bar / launcher
 * (components/chrome/AccountPanel.tsx;：「为什么是从 语音与连接
 * 进入远端以及用账号登录？」). Everything else that needs an account — the
 * remote shelf, 「上传到我的远端草稿」, the settings dialog — asks for that panel
 * through `openAccountPanel()` instead of pointing at settings.
 *
 * Several panels can be mounted at once (world header + launcher). The one the
 * player can actually see and press wins; when none can be (a modal over the
 * header, an inert or hidden header) the most recent one opens floating.
 */

/**
 * Why the panel was opened for the player: shown as one line above the sign-in (null = they opened it).
 * The guest trial's own (lib/guest-trial.ts): trial / trial-low (credits used up / nearly), unlock (another
 * world), cloud (saving to the cloud), ending (a trial ending reached).
 */
export type AccountReason = 'play' | 'publish' | 'trial' | 'trial-low' | 'unlock' | 'cloud' | 'ending' | null;

/** A mounted account panel, as the opener sees it. */
export interface AccountOpener {
  /** Can the player see and press this panel's trigger right now? */
  reachable: () => boolean;
  /** Open the sheet; `floating` = pinned to the viewport, not under the trigger. */
  open: (floating: boolean, reason?: AccountReason) => void;
}

/** Local sign-in / sign-out / remote address changed: listeners re-read the account. */
export const ACCOUNT_CHANGED_EVENT = 'airp:account-changed';

const openers: AccountOpener[] = [];

export function registerAccountOpener(opener: AccountOpener): () => void {
  openers.push(opener);
  return () => {
    const at = openers.indexOf(opener);
    if (at >= 0) openers.splice(at, 1);
  };
}

/** Which panel to open, and how: the newest reachable one anchored, else the newest floating. */
export function pickAccountOpener<T extends Pick<AccountOpener, 'reachable'>>(list: readonly T[]): { opener: T; floating: boolean } | null {
  for (let i = list.length - 1; i >= 0; i -= 1) if (list[i].reachable()) return { opener: list[i], floating: false };
  const last = list[list.length - 1];
  return last ? { opener: last, floating: true } : null;
}

/** Open the account panel (optionally saying why). False when none is mounted. */
export function openAccountPanel(reason: AccountReason = null): boolean {
  const pick = pickAccountOpener(openers);
  if (!pick) return false;
  pick.opener.open(pick.floating, reason);
  return true;
}

/** Tell every account view (panels, remote shelf, settings) to re-read who is signed in. */
export function announceAccountChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(ACCOUNT_CHANGED_EVENT));
}

/** Is this trigger on screen and the topmost thing at its centre (no modal over it, not inert)? */
export function isTriggerReachable(el: HTMLElement | null): boolean {
  if (!el || !el.isConnected || el.closest('[inert],[hidden]')) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return false;
  const hit = document.elementFromPoint(x, y);
  return !!hit && (hit === el || el.contains(hit));
}

/** What the local sign-in is doing, for the one status line under the form. */
export type LocalAccountState =
  | { kind: 'unavailable' }
  | { kind: 'signed-out'; pending: boolean }
  | { kind: 'signed-in'; who: string };

/** The local server's remote settings → the account panel's state. Null settings = no local sign-in (hosted seat / old server). */
export function localAccountState(settings: { signedIn: boolean; email: string | null; uid: string | null; pending?: boolean } | null): LocalAccountState {
  if (!settings) return { kind: 'unavailable' };
  if (settings.signedIn) return { kind: 'signed-in', who: settings.email ?? settings.uid ?? '' };
  return { kind: 'signed-out', pending: !!settings.pending };
}
