import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { translate, type Locale } from './translate.js';
import { ensureLocaleFonts } from './locale-fonts.js';
export { UI_COPY, type UiCopy } from './legacy-ui-copy.js';

export { translate, type Locale };
/** Every interface language, in the order the language pickers list them. */
export const LOCALES: readonly Locale[] = ['ja', 'zh-CN', 'ko', 'en'];
/** Each language's name in itself, for the pickers. */
export const LOCALE_NAMES: Readonly<Record<Locale, string>> = { ja: '日本語', 'zh-CN': '中文', ko: '한국어', en: 'English' };
export const LOCALE_KEY = 'airp-ui-locale';
export function validLocale(value: unknown): Locale {
  return value === 'zh-CN' || value === 'ja' || value === 'ko' ? value : 'en';
}
/** One language tag → the interface language it names, or null when we have none for it. */
function localeOfTag(raw: unknown): Locale | null {
  const tag = String(raw).trim().toLowerCase().replace(/_/g, '-');
  if (tag === 'ja' || tag === 'jp' || tag.startsWith('ja-')) return 'ja';
  if (tag === 'ko' || tag.startsWith('ko-')) return 'ko';
  if (tag === 'zh' || tag.startsWith('zh-')) return 'zh-CN';
  if (tag === 'en' || tag.startsWith('en-')) return 'en';
  return null;
}
/**
 * The browser's preferred languages (`navigator.languages`, the same list the
 * Accept-Language header carries) → the first one we have an interface for.
 * Only a SUGGESTION now: the first-run language page marks it,
 * but the interface stays in the default (English) until the player picks.
 * Any Chinese variant maps to our one Chinese (Simplified); anything we do not
 * speak falls through to English.
 */
export function detectLocale(languages: readonly string[] | null | undefined): Locale {
  for (const raw of languages ?? []) {
    const found = localeOfTag(raw);
    if (found) return found;
  }
  return 'en';
}
/** `?lang=en` / `ja` / `jp` / `ko` / `zh` / `zh-CN` / `zh-TW`… in a query string → that language; null when absent or unknown. */
export function langParam(search: string | null | undefined): Locale | null {
  try {
    const raw = new URLSearchParams(search ?? '').get('lang');
    return raw ? localeOfTag(raw) : null;
  } catch { return null; }
}
/** The `?lang=` value a link carries for each interface language (what `langParam` reads back). */
export const LANG_PARAM: Readonly<Record<Locale, string>> = { en: 'en', ja: 'ja', ko: 'ko', 'zh-CN': 'zh' };
/** The language nobody chose: English. */
export const DEFAULT_LOCALE: Locale = 'en';
export interface InitialLocale {
  locale: Locale;
  /** The player (or the link they followed) chose it: remembered, and a world's language never overrides it. */
  chosen: boolean;
}
/**
 * The interface language at page load, pure:
 * `?lang=` (every canvas link we hand out carries one, lib/canvas-link.ts) →
 * the language stored from an earlier pick → English. The browser's languages
 * are NOT consulted: a visitor without a flag gets English.
 * No redirect: the same URL serves every language. index.html's first inline
 * script applies the same rule before any bundle loads (test: locale-first-visit).
 */
export function initialLocale(input: { search?: string | null; stored?: string | null }): InitialLocale {
  const fromLink = langParam(input.search);
  if (fromLink) return { locale: fromLink, chosen: true };
  if (input.stored) return { locale: validLocale(input.stored), chosen: true };
  return { locale: DEFAULT_LOCALE, chosen: false };
}
/**
 * Should a world written in `worldLocale` switch the interface while it is open?
 * Only for a player who never picked a language themselves, and only to a
 * language their browser says they read (an English reader opening a Chinese
 * world keeps an English interface). The switch lasts while that world is open
 * and is never stored or synced.
 */
export function worldLocaleFor(worldLocale: unknown, state: { chosen: boolean; languages: readonly string[] | null | undefined; current: Locale }): Locale | null {
  if (state.chosen) return null;
  const wanted = localeOfTag(worldLocale ?? '');
  if (!wanted || wanted === state.current) return null;
  return (state.languages ?? []).some(tag => localeOfTag(tag) === wanted) ? wanted : null;
}

const browserLanguages = (): readonly string[] => (typeof navigator === 'undefined' ? [] : navigator.languages ?? [navigator.language]);
/** The player's own language: their pick, the link's, or English. */
let preferred: Locale = 'en';
let chosen = false;
/** A world's language shown while that world is open (worldLocaleFor), or null. */
let worldOverride: Locale | null = null;
try {
  let stored: string | null = null;
  try { stored = localStorage.getItem(LOCALE_KEY); } catch { /* Storage may be unavailable. */ }
  const search = typeof location === 'undefined' ? '' : location.search;
  const first = initialLocale({ search, stored });
  preferred = first.locale;
  chosen = first.chosen;
  if (langParam(search)) {
    // Remember the link's language (a later pick then wins over it); dropLangParam takes it out of the address.
    try { localStorage.setItem(LOCALE_KEY, preferred); } catch { /* in memory only */ }
  }
} catch { /* No browser globals (tests): English. */ }
/**
 * Take `lang` out of the address bar (history.replaceState), so a later pick is not undone by a reload. main.tsx
 * calls it at start-up — except under the in-app browser guide, whose 「在 Safari 中打开」 opens this very address and
 * must keep the language (lib/inapp-browser.ts); there it runs after "try anyway".
 */
export function dropLangParam(): void {
  try {
    const url = new URL(location.href);
    if (!url.searchParams.has('lang')) return;
    url.searchParams.delete('lang');
    history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
  } catch { /* keep the address as it is */ }
}
const listeners = new Set<() => void>();
const current = (): Locale => worldOverride ?? preferred;
/** The player picks a language: stored, synced, and it ends any world-language switch. */
export function setLocale(value: Locale): void {
  preferred = validLocale(value);
  chosen = true;
  worldOverride = null;
  try { localStorage.setItem(LOCALE_KEY, preferred); } catch { /* Keep an in-memory preference. */ }
  listeners.forEach(listener => listener());
}
/**
 * The open world's language (null when none is open): switches the interface
 * only as worldLocaleFor allows, and only until that world closes or the player
 * picks a language. Since 2026-10-11 the browser's languages are not consulted
 * (the interface follows only `?lang=` and the player's pick), so this never
 * switches; worldLocaleFor stays the rule should a stated reading list return.
 */
export function followWorldLocale(worldLocale: string | null | undefined): void {
  const next = worldLocale ? worldLocaleFor(worldLocale, { chosen, languages: [], current: preferred }) : null;
  if (next === worldOverride) return;
  worldOverride = next;
  listeners.forEach(listener => listener());
}
/** The interface language now, and its changes. */
export const currentLocale = (): Locale => current();
/** The player's own language (never a world's temporary one): what lib/account-data.ts syncs across devices. */
export const preferredLocale = (): Locale => preferred;
/** Did the player (or a `?lang=` link) choose the interface language? (The first-run language screen asks only when not.) */
export const localeChosen = (): boolean => chosen;
/** The browser's languages → the interface it suggests (only marked on the first-run language page; never applied). */
export const suggestedLocale = (): Locale => detectLocale(browserLanguages());
export function subscribeLocale(listener: () => void): () => void {
  return subscribe(listener);
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function useLocale() {
  const locale = useSyncExternalStore(subscribe, current, () => 'en' as Locale);
  useEffect(() => { document.documentElement.lang = locale; ensureLocaleFonts(locale); }, [locale]);
  const t = useCallback((key: string, values?: Record<string, string | number>) => translate(locale, key, values), [locale]);
  return { locale, setLocale, t };
}
