/**
 * 新手礼包: 500 credits once per account, granted WITHOUT a click. A signed-in
 * player entering a scene or sending an action asks for it through the app server (accountData().claimNewcomer →
 * /api/account-data/claim-newcomer → billing POST /v1/claims/worldlines/newcomer with this page's device id), the same
 * path as the daily claim, so billing's free-claim caps per device / address apply; nothing about eligibility lives
 * here. When it arrives just now the page shows a toast (「新手礼包 500 积分已到账」, App.tsx).
 *
 * The daily 100 stays a click (DailyClaim / ClaimPrompt): this module never claims it (the auto daily claim of
 * 2026-10-05 morning was reverted).
 *
 * Once per page session: after created / already had it / a refusal (no gift, capped) nothing is asked again; a
 * failure (network, signed out) waits RETRY_MS. Never throws.
 */
import { accountData, type AccountData, type NewcomerGift } from './account-data.js';
import { deviceId } from './invite.js';
import { announceRewardsChanged } from './account-dot.js';

export type NewcomerGiftResult = 'granted' | 'already' | 'refused' | 'skipped' | 'failed';
type Data = Pick<AccountData, 'claimNewcomer'>;

export const RETRY_MS = 10 * 60_000;
/** billing's answers that will not change by asking again this session. */
const FINAL = new Set(['nothing_to_claim', 'claim_limited', 'account_deleted', 'unknown_product']);

let done = false;
let nextTry = 0;
let inflight: Promise<NewcomerGiftResult> | null = null;
const listeners = new Set<(g: NewcomerGift) => void>();

/** Tests: forget the session. */
export function resetNewcomerGift(): void { done = false; nextTry = 0; inflight = null; }

/** The toast: called with the gift when it arrived just now. → unsubscribe */
export function onNewcomerGift(fn: (g: NewcomerGift) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export async function autoNewcomerGift(opts: { data?: Data | null; device?: string | null; now?: () => number } = {}): Promise<NewcomerGiftResult> {
  const now = opts.now ?? Date.now;
  if (done || now() < nextTry) return 'skipped';
  if (inflight) return inflight;
  const data = opts.data === undefined ? accountData() : opts.data;
  if (!data) return 'skipped';
  inflight = (async (): Promise<NewcomerGiftResult> => {
    try {
      const r = await data.claimNewcomer(opts.device === undefined ? deviceId() : opts.device);
      if (!r.ok) {
        if (FINAL.has(r.code)) { done = true; return 'refused'; }
        nextTry = now() + RETRY_MS;
        return 'failed';
      }
      done = true;
      if (!r.gift.created) return 'already';
      try { announceRewardsChanged(); } catch { /* no window */ }
      for (const fn of listeners) {
        try { fn(r.gift); } catch { /* a listener's problem */ }
      }
      return 'granted';
    } catch {
      nextTry = now() + RETRY_MS;
      return 'failed';
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
