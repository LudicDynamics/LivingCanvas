/**
 * 邀请好友 on the page side (billing src/invite.mjs decides everything):
 *   - `?invite=WL-XXXXXX` is remembered (localStorage) the moment the page opens and taken out of the address bar,
 *     so it survives the sign-in round trip (Google / email code); after the first sign-in it is redeemed once,
 *     with a visible toast (InviteAutoRedeem). A refusal that can never change (own code, already used, too old,
 *     unknown) drops it; "not signed in yet" / offline / rate limited keep it for later.
 *   - a random device id for billing's per-device limit (billing only ever stores a keyed hash of it).
 *   - the share link: https://canvas.worldlines.gg/?invite=CODE&lang=<the sharer's language> (lib/canvas-link.ts)
 */
import type { AccountData, Redeemed } from './account-data.js';
import { withLang } from './canvas-link.js';
import type { Locale } from './translate.js';

export const INVITE_PARAM = 'invite';
export const PENDING_INVITE_KEY = 'airp.pendingInvite';
export const DEVICE_KEY = 'airp.deviceId';
export const SHARE_BASE = 'https://canvas.worldlines.gg/';
/** A remembered invite older than this is forgotten (the 7-day window would refuse it anyway). */
export const PENDING_TTL_MS = 30 * 86_400_000;
/** billing's answers after which retrying is pointless. */
export const FINAL_INVITE_ERRORS = new Set(['invalid_code', 'own_code', 'invite_already_used', 'invite_window_closed', 'invites_disabled', 'email_required', 'already_redeemed']);

type KV = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const store = (): KV | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
/** What someone typed or a link carried → "WL-XXXXXX", or null. Full-width letters and missing hyphens are fine. */
export function normalizeInvite(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.normalize('NFKC').toUpperCase().replace(/[\s_‐-―−ー-]+/g, '');
  const m = /^WL([A-Z0-9]{6})$/.exec(s);
  if (!m || [...m[1]].some((c) => !ALPHABET.includes(c))) return null;
  return `WL-${m[1]}`;
}

export function inviteShareUrl(code: string, base = SHARE_BASE, lang?: Locale): string {
  const u = new URL(base);
  u.searchParams.set(INVITE_PARAM, code);
  return lang ? withLang(u.toString(), lang) : u.toString();
}

/**
 * The invite link to show / copy / put on a share card: billing's `share_url` (or the fallback) with the sharer's
 * language, so a friend lands in the language the card is written in.
 */
export function inviteLinkFor(info: { code: string; shareUrl?: string | null }, lang: Locale): string {
  return withLang(info.shareUrl || inviteShareUrl(info.code), lang);
}

/** Read `?invite=` once at start-up: remember it, then remove it from the address bar. → the code or null */
export function captureInviteParam(
  loc: Pick<Location, 'href'> | null = typeof location === 'undefined' ? null : location,
  kv: KV | null = store(),
  hist: Pick<History, 'replaceState' | 'state'> | null = typeof history === 'undefined' ? null : history,
  now = Date.now(),
): string | null {
  if (!loc) return null;
  let url: URL;
  try {
    url = new URL(loc.href);
  } catch {
    return null;
  }
  const raw = url.searchParams.get(INVITE_PARAM);
  if (raw == null) return null;
  const code = normalizeInvite(raw);
  if (code) {
    try {
      kv?.setItem(PENDING_INVITE_KEY, JSON.stringify({ code, at: now }));
    } catch {
      /* storage full / blocked: the code still shows in the toast-less manual field */
    }
  }
  url.searchParams.delete(INVITE_PARAM);
  try {
    hist?.replaceState(hist.state, '', `${url.pathname}${url.search}${url.hash}`);
  } catch {
    /* not allowed (file://): leave the address bar */
  }
  return code;
}

export function pendingInvite(kv: KV | null = store(), now = Date.now()): string | null {
  try {
    const raw = kv?.getItem(PENDING_INVITE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { code?: unknown; at?: unknown };
    const code = normalizeInvite(v.code);
    if (!code || typeof v.at !== 'number' || now - v.at > PENDING_TTL_MS) {
      kv?.removeItem(PENDING_INVITE_KEY);
      return null;
    }
    return code;
  } catch {
    return null;
  }
}
export function clearPendingInvite(kv: KV | null = store()): void {
  try {
    kv?.removeItem(PENDING_INVITE_KEY);
  } catch {
    /* ignore */
  }
}

/** This browser's random id (billing: per-device invite limit). */
export function deviceId(kv: KV | null = store()): string | null {
  try {
    let id = kv?.getItem(DEVICE_KEY) ?? null;
    if (!id || !/^[A-Za-z0-9_-]{16,64}$/.test(id)) {
      const bytes = new Uint8Array(18);
      crypto.getRandomValues(bytes);
      id = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      kv?.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}

export type PendingResult =
  | { status: 'none' }
  | { status: 'later'; code: string; reason: string }
  | { status: 'redeemed'; code: string; redeemed: Redeemed }
  | { status: 'refused'; code: string; error: string };

let inFlight: Promise<PendingResult> | null = null;
/** Redeem the remembered invite once the account is signed in. Concurrent callers share one attempt. */
export function redeemPendingInvite(data: Pick<AccountData, 'redeem'> | null, locale: string, kv: KV | null = store()): Promise<PendingResult> {
  if (inFlight) return inFlight;
  const code = pendingInvite(kv);
  if (!code) return Promise.resolve({ status: 'none' });
  if (!data) return Promise.resolve({ status: 'later', code, reason: 'signed_out' });
  inFlight = (async (): Promise<PendingResult> => {
    const r = await data.redeem(code, locale, deviceId(kv));
    if (r.ok) {
      clearPendingInvite(kv);
      return { status: 'redeemed', code, redeemed: r.redeemed };
    }
    if (FINAL_INVITE_ERRORS.has(r.code)) {
      clearPendingInvite(kv);
      return { status: 'refused', code, error: r.code };
    }
    return { status: 'later', code, reason: r.code };
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}
