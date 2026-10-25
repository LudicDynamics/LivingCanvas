/**
 * 托管方案: the Worldlines membership as the account
 * panel shows it — pricing v3 (the pricing plan). One
 * membership and one wallet across every Worldlines product.
 *
 * Nothing is bought in this app: every purchase goes through the billing site's
 * /subscribe page (it carries the legally required final confirmation), so the
 * panel only links there. The prices below are display copies of the platform's
 * the billing service's price list — change them together.
 */
export type PlanId = 'free' | 'story' | 'vivid';

/** Display prices (JPY written without 「税込」). */
export const PLAN_PRICES: Record<Exclude<PlanId, 'free'>, { month: { jpy: number; usd: number }; year: { jpy: number; usd: number } }> = {
  story: { month: { jpy: 980, usd: 6.99 }, year: { jpy: 9800, usd: 69 } },
  vivid: { month: { jpy: 2480, usd: 16.99 }, year: { jpy: 24800, usd: 169 } },
};

/**
 * The one credit pack on sale: the credit pack, ¥500 / US$3.49 → 2,000 結印 credits
 * (about 4 games at ~450–500 credits a game), valid 180 days from the purchase (資金決済法 ≤ 6 months).
 */
export const TOPUP = { jpy: 500, usd: 3.49, credits: 2000, games: 4, validDays: 180 };

export interface PlanLine {
  /** English source string; translated through messages.json. */
  key: string;
  vars?: Record<string, string>;
}
export interface PlanTier {
  id: PlanId;
  /** English tier name (translated). */
  name: string;
  lines: PlanLine[];
}

const n = (v: number) => v.toLocaleString('en-US');

/**
 * Voice Live (voice calls) works on canvas.worldlines.gg? false: every plan line that
 * sells the minutes says 「即将开放 / Coming soon」 (the minutes stay). Flip to true to remove every label at once —
 * the billing side has its own switch, VOICE_LIVE_AVAILABLE in services/billing (config.voiceLiveAvailable).
 * It is also what puts the call button in the tab: browser-mode.ts switches the in-tab server to voice-live
 * (tickets from the AI service) only when this is true.
 *
 * It is about the CLOUD Voice Live only (ai.worldlines.gg, minutes on a plan). The local edition's own
 * voice-live (voice.json on the player's computer, apps/server/src/engine/local-voice-live.ts, their own
 * keys) does not read it: there the call entry shows when that voice-live is configured / running,
 * whatever the plan. Plan copy never sells local calls as minutes.
 */
export const VOICE_LIVE_AVAILABLE = false;

/** The Voice Live minutes line of a plan: coming soon until VOICE_LIVE_AVAILABLE. */
export function voiceLiveLine(minutes: number, available: boolean = VOICE_LIVE_AVAILABLE): PlanLine {
  return available
    ? { key: 'Voice Live {minutes} min a month (experimental)', vars: { minutes: String(minutes) } }
    : { key: 'Voice calls (Voice Live) {minutes} min a month (coming soon)', vars: { minutes: String(minutes) } };
}

/** Per-plan contents: the v3 table (00-总览.md §4), the lines that tell the tiers apart (+ cloud storage, 2026-10-03:
 * display copies of the platform's the hosted service's configuration QUOTAS_FINAL / QUOTAS_STORY / QUOTAS_VIVID — change them together). */
export const PLAN_TIERS: PlanTier[] = [
  {
    id: 'free',
    name: 'Free',
    lines: [
      //: a 500-credit newcomer gift once, added automatically (valid 30 days), and 100 a
      // day for everyone to claim with a click (replaces 0008's 8 days × 100 then 50, and the 1,500 trial)
      { key: 'A {gift}-credit newcomer gift, added automatically (valid {days} days); {daily} credits to claim every day', vars: { gift: n(500), days: '30', daily: n(100) } },
      { key: '{count} live images within the trial', vars: { count: '3' } },
      { key: 'No Voice Live' },
      { key: '{saves} cloud saves · {gib} GiB cloud space', vars: { saves: '30', gib: '1' } },
    ],
  },
  {
    id: 'story',
    name: 'Traveler',
    lines: [
      { key: '{count} credits every month', vars: { count: n(5000) } },
      { key: '{count} small live images a month included', vars: { count: '40' } },
      voiceLiveLine(30),
      { key: '{saves} cloud saves · {gib} GiB cloud space', vars: { saves: '100', gib: '5' } },
    ],
  },
  {
    id: 'vivid',
    name: 'Voyager',
    lines: [
      { key: '{count} credits every month', vars: { count: n(8000) } },
      { key: '{count} live images a month included', vars: { count: '80' } },
      voiceLiveLine(120),
      { key: 'Unlimited cloud saves · {gib} GiB cloud space', vars: { gib: '20' } },
    ],
  },
];

/** What every plan shares (one wallet, how voice and images are paid, top-ups, checkout choices). */
export const PLAN_NOTES: PlanLine[] = [
  { key: 'One membership and one wallet for every Worldlines product.' },
  { key: 'Voice input (STT) is free; voices (TTS) and live images beyond the allowance use credits.' },
  { key: 'Top-up: {credits} credits for ¥{jpy} / US${usd} (about {games} games), valid {days} days from purchase; no refunds once bought.', vars: { credits: n(TOPUP.credits), jpy: n(TOPUP.jpy), usd: TOPUP.usd.toFixed(2), games: String(TOPUP.games), days: String(TOPUP.validDays) } },
  { key: 'Monthly or yearly, JPY or USD — chosen at checkout.' },
  // storage quotas by plan: worlds are never limited
  { key: 'Make as many worlds as you like. Published worlds do not use your cloud space.' },
];

/** ¥9,800 · US$6.99 */
export function formatPrice(p: { jpy: number; usd: number }): string {
  return `¥${n(p.jpy)} · US$${Number.isInteger(p.usd) ? n(p.usd) : p.usd.toFixed(2)}`;
}

/**
 * The account's plan as the AI service names it (`/v1/usage/me` → plan) → the
 * tier shown. Not signed in / unknown → free; the hidden `supporter` plan (old
 * hub $5) is billed as Vivid.
 */
export function planTier(plan: string | null | undefined): PlanId {
  if (plan === 'story') return 'story';
  if (plan === 'vivid' || plan === 'supporter') return 'vivid';
  return 'free';
}

export interface BillingLinks { subscribe: string; manage: string; legal: string; redeem: string }

// billing's pages speak ko too since 2026-10-03 (the Worldlines platform feat/korean); an older billing ignores the lang.
const BILLING_LANG: Record<string, string> = { 'zh-CN': 'zh', ja: 'ja', en: 'en', ko: 'ko' };
const httpUrl = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
};
const withLang = (href: string, locale?: string): string => {
  const lang = locale ? BILLING_LANG[locale] : undefined;
  if (!lang) return href;
  const u = new URL(href);
  u.searchParams.set('lang', lang);
  return u.href;
};

/**
 * Links to the billing site: `<billing>/v1/config` answers when present
 * ({subscribe_url, manage_url, legal_url, redeem_url}), otherwise `<billing>/subscribe`,
 * `/manage`, `/legal`, `/redeem`. Each page is opened in the player's language;
 * with `look` (lib/plan-look.ts) /subscribe and /manage also get the 卡面角色.
 */
/** 卡面角色 on the billing pages: ?look=m|f|r, d = 默认 (billing remembers it in its own cookie; d forgets it). */
const withLook = (href: string, look?: string): string => {
  if (look === undefined) return href;
  const u = new URL(href);
  u.searchParams.set('look', look === 'm' || look === 'f' || look === 'r' ? look : 'd');
  return u.href;
};

export function billingLinks(base: string, config: unknown = null, locale?: string, look?: string): BillingLinks {
  const root = base.replace(/\/+$/, '');
  const c = (config && typeof config === 'object' ? config : {}) as Record<string, unknown>;
  return {
    subscribe: withLook(withLang(httpUrl(c.subscribe_url) ?? `${root}/subscribe`, locale), look),
    manage: withLook(withLang(httpUrl(c.manage_url) ?? `${root}/manage`, locale), look),
    legal: withLang(httpUrl(c.legal_url) ?? `${root}/legal`, locale),
    redeem: withLang(httpUrl(c.redeem_url) ?? `${root}/redeem`, locale),
  };
}

/** GET `<billing>/v1/config`; anything unexpected → null (the fallback links are used). */
export async function fetchBillingConfig(base: string, fetcher: typeof fetch = fetch): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetcher(`${base.replace(/\/+$/, '')}/v1/config`, { headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** `/api/plans` → whether to show the plans section (AIRP_PLANS_PREVIEW=0 hides it). Anything unexpected → hidden. */
export function parsePlansFlag(body: unknown): boolean {
  return Boolean(body && typeof body === 'object' && (body as { plansPreview?: unknown }).plansPreview === true);
}

export async function fetchPlansFlag(fetcher: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetcher('/api/plans', { headers: { accept: 'application/json' }, cache: 'no-store' });
    if (!res.ok) return false;
    return parsePlansFlag(await res.json());
  } catch {
    return false;
  }
}

/**
 * A 体验会员's end as the panel shows it: the day in Japan time, `YYYY-MM-DD JST`
 *
 * Japan has no DST: UTC+9 always. Anything else → null.
 */
export function trialDay(iso: string | null | undefined): string | null {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(iso)) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? `${new Date(ms + 9 * 3_600_000).toISOString().slice(0, 10)} JST` : null;
}

/**
 * Whole days left of a 体验会员 (rounded up: 3 h left = 1 day), or null when the date is unusable or already past
 * (billing then stops sending trial_ends_at anyway).
 */
export function trialDaysLeft(iso: string | null | undefined, now = Date.now()): number | null {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(iso)) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms) || ms <= now) return null;
  return Math.ceil((ms - now) / 86_400_000);
}

/**
 * The account panel's trial line: 「体验会员 · 还剩 N 天 · 到期 YYYY-MM-DD JST」; null when there is
 * no running trial. `t` = useLocale().t (the keys are literal here so check:i18n sees them).
 */
export function trialNote(t: (key: string, vars?: Record<string, string | number>) => string, iso: string | null | undefined, now = Date.now()): string | null {
  const date = trialDay(iso);
  const days = trialDaysLeft(iso, now);
  if (!date || days === null) return null;
  return days === 1 ? t('Trial member · 1 day left · ends {date}', { date }) : t('Trial member · {days} days left · ends {date}', { days, date });
}

/**
 * A canceled paid subscription:
 * 「将于 YYYY-MM-DD JST 结束」 after the plan name; null when it renews, the date is unusable or already past.
 */
export function endingNote(t: (key: string, vars?: Record<string, string | number>) => string, iso: string | null | undefined, now = Date.now()): string | null {
  const date = trialDay(iso);
  if (!date || Date.parse(iso as string) <= now) return null;
  return t('Ends {date}', { date });
}

/** billing's refusal of a redemption code → the English source string the panel shows (translated through messages.json). */
export function redeemError(code: string): string {
  switch (code) {
    case 'invalid_code': return 'This code is not valid, has expired or has been used up.';
    case 'already_redeemed': return 'You have already redeemed this code.';
    case 'already_member': return 'You are already a member; this code only starts a trial membership.';
    case 'trial_active': return 'Your trial membership is still running; use a new code after it ends.';
    case 'rate_limited': return 'Too many attempts. Please try again later.';
    // invite codes (WL-XXXXXX, billing src/invite.mjs)
    case 'own_code': return 'You cannot use your own invite code.';
    case 'invite_already_used': return 'This account has already used an invite code (one per account).';
    case 'invite_window_closed': return 'Invite codes are for new accounts only (within the first days after signing up).';
    case 'email_required': return 'Sign in with an email-verified account to use an invite code.';
    case 'invite_limited': return 'Too many invite codes from this network or device; try again later.';
    case 'invites_disabled': return 'Invites are paused right now.';
    case 'signed_out':
    case 'session_required':
    case 'unauthorized':
    case 'invalid_token': return 'Sign in again to redeem a code.';
    default: return 'Could not redeem the code right now. Please try again later.';
  }
}
