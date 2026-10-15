import { useState } from 'react';
import { useLocale } from '../../lib/i18n.js';
import './rotate-hint.css';

export const ROTATE_HINT_KEY = 'airp.rotate-hint.dismissed';
const session = (): Storage | null => { try { return sessionStorage; } catch { return null; } };
const dismissed = () => { try { return session()?.getItem(ROTATE_HINT_KEY) === '1'; } catch { return false; } };

/**
 * Phones held upright during play: a gentle "turn sideways" card. CSS alone decides when it shows (portrait, narrow,
 * touch — mobile.css media query), so rotating hides it at once; "OK" hides it for this tab session. The lobby,
 * account and menus are not wrapped by this (App renders it only while a world is open) and stay usable upright.
 */
export function RotateHint() {
  const { t } = useLocale();
  const [hidden, setHidden] = useState(dismissed);
  if (hidden) return null;
  const close = () => {
    try { session()?.setItem(ROTATE_HINT_KEY, '1'); } catch { /* blocked: hide for this mount only */ }
    setHidden(true);
  };
  return (
    <div className="rotate-hint" role="dialog" aria-labelledby="rotate-hint-title" onClick={close}>
      <div className="rotate-hint-card" onClick={e => e.stopPropagation()}>
        <svg className="rotate-hint-icon" viewBox="0 0 64 64" aria-hidden="true">
          <rect className="rotate-hint-phone" x="22" y="8" width="20" height="36" rx="4" fill="none" stroke="currentColor" strokeWidth="3" />
          <path d="M14 46 a 22 22 0 0 0 30 10" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          <path d="M40 50 L 45 56 L 38 59" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <h2 id="rotate-hint-title">{t('Turn your phone sideways')}</h2>
        <p>{t('The story plays best in landscape. Menus and your account work either way.')}</p>
        <button type="button" onClick={close}>{t('Keep playing upright')}</button>
      </div>
    </div>
  );
}
