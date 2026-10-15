/**
 * In-app browsers (WeChat, QQ, Weibo, Douyin/TikTok, Xiaohongshu, LINE, Instagram/Facebook, WeCom): their web views
 * cannot run the in-tab runtime properly (Web Worker + Service Worker + COEP require-corp; WeChat's X5 / WKWebView),
 * so before booting we show a guide to open the page in Safari / the system browser (components/chrome/InAppGuide.tsx).
 *
 * Pure helpers here (UA → app + OS, the link to copy (with the guide's language), the per-session "try anyway").
 */
import type { Locale } from './translate.js';
import { withLang } from './canvas-link.js';

export type InAppName =
  | 'wxwork' | 'wechat' | 'qq' | 'weibo' | 'douyin' | 'tiktok' | 'xiaohongshu' | 'line' | 'instagram' | 'facebook';
export type InAppOs = 'ios' | 'android' | 'other';
export interface InApp { app: InAppName; os: InAppOs }

// Order matters: WeCom's UA also carries MicroMessenger; Instagram's may carry FBAV.
const APPS: ReadonlyArray<[InAppName, RegExp]> = [
  ['wxwork', /\bwxwork\//i],
  ['wechat', /\bMicroMessenger\//i],
  ['qq', /\sQQ\/\d/i], // the QQ app; the standalone "MQQBrowser" is a real browser and is not matched
  ['weibo', /\bWeibo\b|__weibo__/i],
  ['xiaohongshu', /\bxhsdiscover\b/i],
  ['douyin', /aweme|\bDouyin\b/i],
  ['tiktok', /\bmusical_ly\b|\bTikTok\b|\bBytedanceWebview\b/i],
  ['line', /\bLine\/\d/i],
  ['instagram', /\bInstagram\b/i],
  ['facebook', /\bFBAN\/|\bFBAV\/|\bFB_IAB\b/i],
];

export function inAppOs(ua: string, maxTouchPoints = 0): InAppOs {
  if (/\b(iPhone|iPad|iPod)\b/.test(ua) || (/\bMacintosh\b/.test(ua) && maxTouchPoints > 1)) return 'ios';
  if (/\bAndroid\b/i.test(ua)) return 'android';
  return 'other';
}

/** The in-app browser this UA belongs to, or null for a real browser. */
export function detectInApp(ua: string | null | undefined, maxTouchPoints = 0): InApp | null {
  const s = String(ua ?? '');
  for (const [app, re] of APPS) if (re.test(s)) return { app, os: inAppOs(s, maxTouchPoints) };
  return null;
}

// Guide language: the interface language like everywhere else (`?lang=` → stored pick → English, lib/i18n.ts;
//). It used to guess Chinese for WeChat / QQ / Weibo / Douyin / Xiaohongshu and the browser's
// language otherwise; posts in those apps now link with `?lang=zh`.

/**
 * The link to copy: this very URL (with `?src=` / `?invite=` intact — they are only stripped after "continue") and
 * `lang` set to the guide's language, so Safari / the system browser (its own storage) opens in that language too.
 */
export function guideLink(href: string, lang?: Locale): string {
  try {
    const url = new URL(lang ? withLang(href, lang, new URL(href).origin) : href);
    url.hash = '';
    return url.toString();
  } catch {
    return href;
  }
}

/**
 * The guide's language changed: put it in the address bar too, because 「··· → 在 Safari 中打开」 opens the address
 * bar's URL, not the copied one.
 */
export function addressWithLang(href: string, lang: Locale): string {
  try {
    const url = new URL(withLang(href, lang, new URL(href).origin));
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return href;
  }
}

/** "Try anyway" is remembered for this tab session only. */
export const INAPP_CONTINUE_KEY = 'airp.inapp.continue';
type SessionKV = Pick<Storage, 'getItem' | 'setItem'>;
export function inAppContinued(kv: SessionKV | null): boolean {
  try { return kv?.getItem(INAPP_CONTINUE_KEY) === '1'; } catch { return false; }
}
export function rememberInAppContinue(kv: SessionKV | null): void {
  try { kv?.setItem(INAPP_CONTINUE_KEY, '1'); } catch { /* storage blocked: ask again next load */ }
}

/** Show the guide? In-app, and not yet "continued" this session. `?inapp=0` skips it (support / testing). */
export function shouldShowInAppGuide(ua: string, search: string, kv: SessionKV | null, maxTouchPoints = 0): InApp | null {
  if (new URLSearchParams(search).get('inapp') === '0') return null;
  const hit = detectInApp(ua, maxTouchPoints);
  if (!hit || inAppContinued(kv)) return null;
  return hit;
}
