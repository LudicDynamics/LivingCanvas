/**
 * community.ts — which community channel to show this player.
 *
 * The player already told us their language: the 日本語 / 中文 / English switch
 * in the launcher and the world header. That is an explicit choice, not a
 * guess, so it is what picks the list — `regionForLocale` and nothing else.
 *
 * Nothing here sniffs the environment. Reading the time zone or
 * `navigator.languages` would be guessing at something the player has already
 * stated, and an IP lookup would be worse still: either a third-party request
 * (the player's address leaves the machine so we can pick a link) or a bundled
 * GeoIP database (megabytes, stale the week after it ships). The question is
 * only "which list first", the switcher corrects it in one click, and the
 * answer is already on screen in the language buttons.
 *
 * Pure: every function here takes its inputs as arguments so the whole table and
 * the whole decision are unit-testable (`apps/web/test/community.test.mjs`).
 */
import type { Locale } from './i18n.js';

/**
 * The buckets, in the order the switcher lists them. Three of them are what a
 * language maps to; `greater-china` is reachable only by the player choosing
 * it, because the app has one Chinese button and a zh-TW player who wants
 * Discord first should be able to say so.
 */
export const REGIONS = ['mainland', 'greater-china', 'japan', 'international'] as const;
export type CommunityRegion = (typeof REGIONS)[number];

export type ChannelKind = 'wechat' | 'qq' | 'discord' | 'x' | 'email';

export interface CommunityChannel {
  kind: ChannelKind;
  /** i18n key, resolved with `t()` at render time — never a pre-translated string. */
  label: string;
  /** The id, invite URL or address the player copies. */
  value: string;
  /** Public path of a scannable image, for channels that are joined by scanning. */
  qr?: string;
  /** True while `value` is a placeholder: the panel labels it instead of pretending. */
  todo?: boolean;
  /**
   * A joining code that stops working on its own — a WeChat group QR expires
   * after a week and again once the group fills. The panel says so next to it,
   * because a silently dead QR reads as "this project is abandoned"; the way
   * out is the channel below it, which is why one non-expiring channel is
   * always listed in the same region.
   */
  expires?: boolean;
}

/**
 * Marker for a value not supplied yet. The panel shows the channel
 * greyed with a "coming soon" note rather than a broken link, and
 * `community.test.mjs` asserts every `TODO-` value carries `todo: true` — so a
 * placeholder can never quietly ship as if it were a real invite.
 */
export const TODO_PREFIX = 'TODO-value';

/**
 * The channel table. Ordered: the first entry of a region is the one the panel
 * leads with. To fill a value, replace the `TODO-value…` string and drop the
 * `todo: true` line; for WeChat/QQ also drop the image at the `qr` path
 * (`apps/web/public/community/README.md` says which sizes).
 */
export const COMMUNITY_CHANNELS: Record<CommunityRegion, CommunityChannel[]> = {
  // A Chinese-reading player may be anywhere, so Discord is listed — last, as
  // the alternative, after the two channels that work behind the firewall.
  // Group NAMES are deliberately absent: the panel shows how
  // to join, not what the room is called. WeChat is scan-only, so it carries no
  // `value` at all; QQ keeps the number because that is the other way in.
  mainland: [
    { kind: 'wechat', label: 'WeChat group', value: '', qr: 'community/wechat-qr.png', expires: true },
    { kind: 'qq', label: 'QQ group', value: '1090135789', qr: 'community/qq-qr.png' },
    { kind: 'discord', label: 'Discord', value: 'https://discord.gg/6KYtmZQhnR' },
    { kind: 'email', label: 'Email', value: 'hello@worldlines.gg', todo: true },
  ],
  'greater-china': [
    { kind: 'discord', label: 'Discord', value: 'https://discord.gg/6KYtmZQhnR' },
    { kind: 'wechat', label: 'WeChat group', value: '', qr: 'community/wechat-qr.png', expires: true },
    { kind: 'email', label: 'Email', value: 'hello@worldlines.gg', todo: true },
  ],
  japan: [
    { kind: 'discord', label: 'Discord', value: 'https://discord.gg/6KYtmZQhnR' },
    { kind: 'x', label: 'X', value: `${TODO_PREFIX}-x-handle`, todo: true },
    { kind: 'email', label: 'Email', value: 'hello@worldlines.gg', todo: true },
  ],
  international: [
    { kind: 'discord', label: 'Discord', value: 'https://discord.gg/6KYtmZQhnR' },
    { kind: 'x', label: 'X', value: `${TODO_PREFIX}-x-handle`, todo: true },
    { kind: 'email', label: 'Email', value: 'hello@worldlines.gg', todo: true },
  ],
};

/** Region display names, resolved through `t()` like every other string. */
export const REGION_LABELS: Record<CommunityRegion, string> = {
  mainland: 'Chinese mainland',
  'greater-china': 'Hong Kong · Macau · Taiwan',
  japan: 'Japan',
  international: 'Elsewhere',
};

export function isCommunityRegion(value: unknown): value is CommunityRegion {
  return typeof value === 'string' && (REGIONS as readonly string[]).includes(value);
}

/**
 * Pure: the list that opens by default, from the language the player chose.
 *
 * Total over `Locale`, so adding a fourth language to the app is a compile
 * error here rather than a silent fall-through to `international`.
 */
const LOCALE_REGIONS: Record<Locale, CommunityRegion> = {
  'zh-CN': 'mainland',
  ja: 'japan',
  // No Korean community channel yet: Korean players start on the international list.
  ko: 'international',
  en: 'international',
};

export function regionForLocale(locale: Locale): CommunityRegion {
  return LOCALE_REGIONS[locale] ?? 'international';
}

/** Player override for the region. Read through `readStoredRegion` only. */
export const REGION_STORAGE_KEY = 'airp.community-region';

/**
 * The player's own choice, or `null` when they have not made one.
 *
 * `null` rather than a default on purpose: the caller pairs it with the current
 * locale, so switching language moves the default list while leaving an
 * explicit choice alone. Never throws — private mode denies storage.
 */
export function readStoredRegion(): CommunityRegion | null {
  try {
    const stored = localStorage.getItem(REGION_STORAGE_KEY);
    return isCommunityRegion(stored) ? stored : null;
  } catch {
    return null;
  }
}

/** Persist the player's choice. Failure is survivable: the session still applies it. */
export function writeRegion(region: CommunityRegion): void {
  try {
    localStorage.setItem(REGION_STORAGE_KEY, region);
  } catch {
    /* private mode: the choice lives for this session only */
  }
}

/** The regions the switcher offers, current one first removed by the caller. */
export function otherRegions(current: CommunityRegion): CommunityRegion[] {
  return REGIONS.filter(region => region !== current);
}

/** A channel's value as something clickable, or null when it only gets copied. */
export function channelHref(channel: CommunityChannel): string | null {
  if (channel.todo) return null;
  if (channel.kind === 'email') return `mailto:${channel.value}`;
  if (channel.kind === 'discord') return channel.value.startsWith('http') ? channel.value : `https://discord.gg/${channel.value}`;
  if (channel.kind === 'x') return channel.value.startsWith('http') ? channel.value : `https://x.com/${channel.value.replace(/^@/, '')}`;
  // WeChat and QQ are joined by scanning or by pasting the id into the app —
  // a link would open nothing on desktop, so these stay copy-only.
  return null;
}
