/**
 * Links to canvas.worldlines.gg always say which language they open in
 * The page reads `?lang=` before anything else (index.html's first
 * script, lib/i18n.ts), remembers it and takes it out of the address bar. the design notes §链接.
 *
 * Pure (no browser globals): tested in apps/web/test/locale-first-visit.test.mjs.
 */
import { LANG_PARAM } from './i18n.js';
import type { Locale } from './translate.js';

/** The browser version's one address (docs: canvas 单一域名). */
export const CANVAS_ORIGIN = 'https://canvas.worldlines.gg';

/**
 * `path` on canvas.worldlines.gg, opening in `lang`: `canvasLink('/?invite=WL-1', 'ja')` →
 * `https://canvas.worldlines.gg/?invite=WL-1&lang=ja`. Other parameters (src, invite, world…) and the hash are kept;
 * an existing `lang` is replaced. A full URL on another host is returned unchanged.
 */
export function canvasLink(path: string, lang: Locale, origin: string = CANVAS_ORIGIN): string {
  let url: URL;
  try { url = new URL(path || '/', origin); } catch { return path; }
  if (url.origin !== new URL(origin).origin) return path;
  url.searchParams.set('lang', LANG_PARAM[lang] ?? LANG_PARAM.en);
  return url.toString();
}

/**
 * A link the page got from elsewhere (billing's invite `share_url`, this page's own address): `lang` added when it
 * points at canvas (or at `sameOrigin`, the page's own origin — a preview / local build); anything else unchanged.
 */
export function withLang(href: string, lang: Locale, sameOrigin?: string | null): string {
  let url: URL;
  try { url = new URL(href); } catch { return href; }
  if (url.origin === CANVAS_ORIGIN) return canvasLink(href, lang);
  if (sameOrigin && url.origin === sameOrigin) return canvasLink(href, lang, sameOrigin);
  return href;
}
