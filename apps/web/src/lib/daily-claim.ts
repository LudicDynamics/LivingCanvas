/**
 * the Worldlines free plan's daily allowance is claim-only —
 * billing grants nothing until the player claims it (POST /v1/claims/worldlines/daily). The account panel's
 * balance area shows today's status and the button (components/chrome/DailyClaim.tsx); when a model call is
 * refused with `claim_required` (only once billing enforces credits) a gentle prompt offers the same button.
 * Since it is 100 a day for everyone, still a click (never claimed automatically; the
 * one-time 500 newcomer gift is the automatic part, lib/newcomer-gift.ts). 0008's newcomer period (8 days × 100, then
 * 50) is switched off in billing but the copy stays for an admin who turns it back on: 「新手期 第 n/8 天：今日可领 100」.
 * Pure helpers here, so the node tests can read them.
 */
import type { DailyAllowance } from './account-data.js';

/** newcomer: { day, days } while the account is in its newcomer period (「新手期 第 n/8 天」), else null. */
export type Newcomer = { day: number; days: number } | null;
export type DailyClaimState =
  | { kind: 'claimable'; allowance: number; newcomer: Newcomer }
  | { kind: 'claimed'; claimed: number; resets: string | null; newcomer: Newcomer }
  | { kind: 'none' };

/** billing's tier → the newcomer day to show, only when it is a sane day n of days. */
export function newcomerOf(daily: DailyAllowance | null | undefined): Newcomer {
  if (!daily || daily.tier !== 'newcomer') return null;
  const { newcomerDay: day, newcomerDays: days } = daily;
  return Number.isInteger(day) && Number.isInteger(days) && (days as number) > 0 && (day as number) >= 1 && (day as number) <= (days as number) ? { day: day as number, days: days as number } : null;
}

/** billing's daily block → what the panel shows. No allowance (a paid plan, an older billing) → none. */
export function dailyClaimState(daily: DailyAllowance | null | undefined): DailyClaimState {
  if (!daily || !(daily.allowance > 0)) return { kind: 'none' };
  const newcomer = newcomerOf(daily);
  if (daily.claimable) return { kind: 'claimable', allowance: daily.allowance, newcomer };
  return { kind: 'claimed', claimed: daily.claimed, resets: resetLabel(daily.resetsAt), newcomer };
}

/** When today's allowance comes back, in Japan time (all player-facing times are JST): "21:00 JST". */
export function resetLabel(iso: string | null | undefined): string | null {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(iso)) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? `${new Date(ms + 9 * 3_600_000).toISOString().slice(11, 16)} JST` : null;
}

/** A refused claim → the English source string shown (translated through messages.json). */
export function claimError(code: string): string {
  switch (code) {
    case 'nothing_to_claim': return 'Your plan has no daily credits to claim.';
    case 'signed_out':
    case 'session_required':
    case 'unauthorized':
    case 'invalid_token': return "Sign in again to claim today's credits.";
    case 'rate_limited': return 'Too many attempts. Please try again later.';
    default: return "Could not claim today's credits right now. Please try again later.";
  }
}

/**
 * A model / media error that says the wallet needs today's claim (ai answers 402 insufficient_credits with
 * reason `claim_required` once billing enforces credits). Matches the raw text a writer turn surfaces.
 */
export const isClaimRequired = (text: unknown): boolean => /claim_required/.test(String(text ?? ''));
