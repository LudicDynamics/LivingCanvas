/**
 * Hangul faces, loaded only when Korean is on screen (2026-10-03).
 *
 * The page's own families (index.html: Manrope, LXGW WenKai, Caveat, DM Mono)
 * carry no Hangul, so a Korean interface or a `-ko` edition would otherwise
 * fall back to whatever the system has (a Gothic face inside the Kai stacks).
 * The token stacks in index.css already name `Noto Sans KR` (UI) and `Gowun
 * Batang` (human / hand text) right after the Latin + CJK families; this adds
 * their stylesheet the first time the interface turns Korean, so the other
 * languages never pay for it. Google Fonts serves the faces as unicode-range
 * slices, so only the Hangul actually drawn is downloaded.
 *
 * Cross-origin isolation (deploy/canvas/README.md): the page runs under
 * `COEP: require-corp`, so the stylesheet is a CORS request (`crossorigin`);
 * fonts.googleapis.com and fonts.gstatic.com answer with
 * `Access-Control-Allow-Origin: *`, and font files are always fetched in CORS
 * mode. Fail-soft: without the network the system Hangul font still renders.
 */
export const KOREAN_FONTS_HREF = 'https://fonts.googleapis.com/css2?family=Gowun+Batang:wght@400;700&family=Noto+Sans+KR:wght@400;500;600;700&display=swap';
const LINK_ID = 'airp-korean-fonts';

export function ensureLocaleFonts(locale: string, doc: Document | undefined = typeof document === 'undefined' ? undefined : document): boolean {
  if (locale !== 'ko' || !doc?.head || doc.getElementById(LINK_ID)) return false;
  const link = doc.createElement('link');
  link.id = LINK_ID;
  link.rel = 'stylesheet';
  link.crossOrigin = 'anonymous';
  link.href = KOREAN_FONTS_HREF;
  doc.head.appendChild(link);
  return true;
}
