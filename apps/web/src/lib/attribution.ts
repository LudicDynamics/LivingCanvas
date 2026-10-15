/**
 * 渠道 / 来源 on the page side:
 *   - a channel link `https://canvas.worldlines.gg/?src=<keyword>` (also `utm_source / utm_medium / utm_campaign /
 *     utm_content` and `ref=`) is remembered (localStorage) the moment the page opens and taken out of the address
 *     bar, like `?invite=` (lib/invite.ts), so it survives the sign-in round trip. An invite link may carry src too.
 *   - first touch (kept) + last touch (replaced by each new link), the time, the landing PATH, and the referrer's
 *     HOST only (never the full referrer URL, never our own host).
 *   - sent with the sign-in that may create the account (seat gateway → identity: `attribution` on the email-code
 *     verify, `att=` on the Google start); identity records it only for a NEW account (first touch wins) and never
 *     trusts it for anything but counting. Forgotten once the account is signed in (or after 30 days) — except the
 *     first-touch channel KEYWORD alone (`airp.channel`, 180 days, `rememberChannel`), so the usage events
 *     (lib/analytics.ts) keep their `src` after sign-in (chronicle also fills it server-side from identity).
 * No third-party tags or cookies: nothing here leaves for anyone but our own identity service.
 */

export const ATTRIBUTION_KEY = 'airp.attribution';
export const ATTRIBUTION_TTL_MS = 30 * 86_400_000;
export const CHANNEL_KEY = 'airp.channel';
export const CHANNEL_TTL_MS = 180 * 86_400_000; // = chronicle's usage-event retention
export const KEYWORD = /^[a-z0-9._-]{1,40}$/;
const PARAMS = ['src', 'ref', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content'] as const;

export interface Touch {
  src?: string;
  ref?: string;
  utm?: { source?: string; medium?: string; campaign?: string; content?: string };
  referrer_host?: string;
  landing?: string;
  at: number;
}
export interface Attribution { first: Touch; last: Touch }

type KV = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const store = (): KV | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

/** A keyword / utm value → lower-case [a-z0-9._-]{1,40} (spaces → "-"), or undefined. */
export function keyword(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const s = raw.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, '-');
  return KEYWORD.test(s) ? s : undefined;
}

/** document.referrer → its host, unless it is empty, unparsable, not http(s) or this site itself. */
export function referrerHost(referrer: string | null | undefined, selfHost: string): string | undefined {
  if (!referrer) return undefined;
  try {
    const u = new URL(referrer);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return undefined;
    const host = u.hostname.toLowerCase();
    return host && host !== selfHost.toLowerCase() && host.length <= 253 ? host : undefined;
  } catch {
    return undefined;
  }
}

/** The touch a URL carries (null = no channel parameter at all). */
export function touchFromUrl(url: URL, referrer: string | null | undefined, now: number): Touch | null {
  if (!PARAMS.some((p) => url.searchParams.has(p))) return null;
  const get = (p: string) => keyword(url.searchParams.get(p));
  const utm = { source: get('utm_source'), medium: get('utm_medium'), campaign: get('utm_campaign'), content: get('utm_content') };
  const t: Touch = { at: now };
  const src = get('src');
  const ref = get('ref');
  if (src) t.src = src;
  if (ref) t.ref = ref;
  if (utm.source || utm.medium || utm.campaign || utm.content) t.utm = Object.fromEntries(Object.entries(utm).filter(([, v]) => v)) as Touch['utm'];
  const host = referrerHost(referrer, url.hostname);
  if (host) t.referrer_host = host;
  const path = url.pathname.length <= 200 ? url.pathname : undefined;
  if (path) t.landing = path;
  return t.src || t.ref || t.utm ? t : null;
}

export function readAttribution(kv: KV | null = store(), now = Date.now()): Attribution | null {
  try {
    const raw = kv?.getItem(ATTRIBUTION_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Attribution>;
    if (!v?.first || typeof v.first.at !== 'number' || now - v.first.at > ATTRIBUTION_TTL_MS) {
      kv?.removeItem(ATTRIBUTION_KEY);
      return null;
    }
    return { first: v.first, last: v.last ?? v.first };
  } catch {
    return null;
  }
}

export function clearAttribution(kv: KV | null = store()): void {
  try {
    kv?.removeItem(ATTRIBUTION_KEY);
  } catch {
    /* ignore */
  }
}

/** A touch's effective channel keyword: src > ref > utm_source (identity's `src` column uses the same order). */
export function channelOf(t: Touch | null | undefined): string | undefined {
  return t?.src ?? t?.ref ?? t?.utm?.source;
}

/** The kept first-touch channel keyword (only the keyword + when), or undefined. */
export function readChannel(kv: KV | null = store(), now = Date.now()): string | undefined {
  try {
    const raw = kv?.getItem(CHANNEL_KEY);
    if (!raw) return undefined;
    const v = JSON.parse(raw) as { src?: unknown; at?: unknown };
    if (typeof v?.at !== 'number' || now - v.at > CHANNEL_TTL_MS || typeof v.src !== 'string' || !KEYWORD.test(v.src)) {
      kv?.removeItem(CHANNEL_KEY);
      return undefined;
    }
    return v.src;
  } catch {
    return undefined;
  }
}

/** Keep the first-touch channel keyword of what is remembered now (an older kept one wins: it was first). */
export function rememberChannel(kv: KV | null = store(), now = Date.now()): void {
  if (readChannel(kv, now)) return;
  const first = readAttribution(kv, now)?.first;
  const src = channelOf(first);
  if (!first || !src) return;
  try {
    kv?.setItem(CHANNEL_KEY, JSON.stringify({ src, at: first.at }));
  } catch {
    /* storage blocked */
  }
}

/** Signed in: the full record has done its job — keep only the channel keyword, forget the rest. */
export function settleAttribution(kv: KV | null = store(), now = Date.now()): void {
  rememberChannel(kv, now);
  clearAttribution(kv);
}

/** The usage events' `src`: the device's first-touch keyword (kept), else the record's first touch. */
export function analyticsSrc(kv: KV | null = store(), now = Date.now()): string | undefined {
  return readChannel(kv, now) ?? channelOf(readAttribution(kv, now)?.first);
}

/**
 * Read the channel parameters once at start-up: remember them (first touch kept, last touch replaced), then remove
 * them from the address bar (other parameters such as ?invite= stay for their own reader). → what is remembered now
 */
export function captureAttribution(
  loc: Pick<Location, 'href'> | null = typeof location === 'undefined' ? null : location,
  kv: KV | null = store(),
  hist: Pick<History, 'replaceState' | 'state'> | null = typeof history === 'undefined' ? null : history,
  referrer: string | null = typeof document === 'undefined' ? null : document.referrer,
  now = Date.now(),
): Attribution | null {
  if (!loc) return readAttribution(kv, now);
  let url: URL;
  try {
    url = new URL(loc.href);
  } catch {
    return readAttribution(kv, now);
  }
  if (!PARAMS.some((p) => url.searchParams.has(p))) return readAttribution(kv, now);
  const touch = touchFromUrl(url, referrer, now);
  let next = readAttribution(kv, now);
  if (touch) {
    next = { first: next?.first ?? touch, last: touch };
    try {
      kv?.setItem(ATTRIBUTION_KEY, JSON.stringify(next));
    } catch {
      /* storage full / blocked: this visit just is not attributed */
    }
    rememberChannel(kv, now);
  }
  for (const p of PARAMS) url.searchParams.delete(p);
  try {
    hist?.replaceState(hist.state, '', `${url.pathname}${url.search}${url.hash}`);
  } catch {
    /* not allowed (file://): leave the address bar */
  }
  return next;
}

/** What the sign-in carries (the gateway passes it to identity as is; identity sanitizes again). */
export function attributionPayload(kv: KV | null = store(), now = Date.now()): Attribution | undefined {
  return readAttribution(kv, now) ?? undefined;
}

/** The same, base64url JSON for a URL parameter (the Google start). */
export function attributionParam(kv: KV | null = store(), now = Date.now()): string | undefined {
  const a = readAttribution(kv, now);
  if (!a) return undefined;
  const bytes = new TextEncoder().encode(JSON.stringify(a));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
