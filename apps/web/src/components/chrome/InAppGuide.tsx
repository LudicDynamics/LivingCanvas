import { useEffect, useRef, useState } from 'react';
import { LOCALES, LOCALE_NAMES, translate, type Locale } from '../../lib/i18n.js';
import { addressWithLang, guideLink, type InApp } from '../../lib/inapp-browser.js';
import './inapp-guide.css';

type CopyState = 'idle' | 'copied' | 'manual';

/**
 * Full-screen "open in Safari / your browser" guide for in-app browsers (lib/inapp-browser.ts). Shown by main.tsx
 * BEFORE the runtime boots; "Try anyway" boots it regardless (remembered for this tab session).
 */
export function InAppGuide({ inApp, href, initialLocale, onContinue }: {
  inApp: InApp;
  href: string;
  initialLocale: Locale;
  /** "Try anyway", with the language the guide was showing (the interface keeps it). */
  onContinue: (locale: Locale) => void;
}) {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const [copy, setCopy] = useState<CopyState>('idle');
  const input = useRef<HTMLInputElement>(null);
  const link = guideLink(href, locale);
  const t = (key: string) => translate(locale, key);
  useEffect(() => {
    document.documentElement.lang = locale;
    // 「在 Safari 中打开」 opens the address bar's URL: it carries the guide's language (lib/inapp-browser.ts).
    try { history.replaceState(history.state, '', addressWithLang(location.href, locale)); } catch { /* keep it */ }
  }, [locale]);

  const selectLink = () => {
    const el = input.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(0, el.value.length);
  };
  const legacyCopy = (): boolean => {
    selectLink();
    try { return document.execCommand('copy'); } catch { return false; }
  };
  const copyLink = async () => {
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(link); ok = true; }
    } catch { /* not allowed in this web view: fall back */ }
    if (!ok) ok = legacyCopy();
    setCopy(ok ? 'copied' : 'manual');
    if (!ok) selectLink();
  };

  const ios = inApp.os === 'ios';
  return (
    <div className="inapp-guide" role="dialog" aria-modal="true" aria-labelledby="inapp-guide-title" data-inapp={inApp.app} data-os={inApp.os}>
      <svg className="inapp-guide-arrow" viewBox="0 0 120 120" aria-hidden="true">
        <path d="M18 108 C 30 60, 60 34, 100 18" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeDasharray="2 11" />
        <path d="M80 12 L 104 16 L 96 38" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="inapp-guide-dots" aria-hidden="true">···</div>

      <div className="inapp-guide-card">
        <img className="inapp-guide-logo" src="/brand/icon.svg" alt="" width={48} height={48} />
        <h1 id="inapp-guide-title">{ios ? t('Please open in Safari') : t('Please open in your browser')}</h1>
        <p className="inapp-guide-why">{t('This in-app browser can’t run LivingCanvas properly.')}</p>
        <ol className="inapp-guide-steps">
          <li>{ios ? t('Tap ··· at the top right → Open in Safari') : t('Tap ··· at the top right → Open in browser')}</li>
          <li>{ios ? t('Or copy the link and paste it into Safari') : t('Or copy the link and paste it into your browser')}</li>
        </ol>
        <div className="inapp-guide-copy">
          <input ref={input} readOnly value={link} aria-label={t('Link')} onFocus={selectLink} onClick={selectLink} />
          <button type="button" onClick={() => void copyLink()}>{copy === 'copied' ? t('Copied') : t('Copy link')}</button>
        </div>
        <p className="inapp-guide-status" role="status">
          {copy === 'manual' ? t('Couldn’t copy automatically — press and hold the link above to copy it.') : copy === 'copied' ? t('Link copied. Paste it into the browser’s address bar.') : ''}
        </p>
        <button type="button" className="inapp-guide-continue" onClick={() => onContinue(locale)}>{t('Try anyway')}</button>
        <div className="inapp-guide-langs" role="group" aria-label={t('Language')}>
          {LOCALES.map(l => (
            <button key={l} type="button" aria-pressed={l === locale} onClick={() => setLocale(l)}>{LOCALE_NAMES[l]}</button>
          ))}
        </div>
      </div>
    </div>
  );
}
