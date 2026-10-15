/**
 * The account popup: ONE glass dialog with tabs, opened from the single
 * 「账号」 entry (lobby top bar / world header — components/chrome/AccountPanel.tsx) and from the 「账号」 line in the
 * player panel inside a world. Every screen that needs an account asks for it with `openAccountPanel()`.
 *
 *   账号      sign-in / out, plan · balance · 今日额度, 邀请好友, 兑换码, 卡面角色, community   (AccountTab)
 *   我的记录  overview, playthroughs + 「再玩一次」, credits used                              (RecordsTab)
 *   奖励      today's allowance, billing rewards, achievements                                 (RewardsTab)
 *   CG       gallery → large view + its share cards + 「生成分享卡」, 「我的分享卡」             (CgTab)
 *   设置      voice, connections, the browser version's own key, remote                        (VoiceSettingsBody)
 *             + 「改进产品：发送匿名使用数据」                                                    (UsageDataToggle, lib/analytics.ts)
 *
 * Desktop: a centred glass sheet; phone (≤ 640px): a full-height sheet. Esc closes (a nested large CG view or
 * share dialog first — each is a focus-coordinator surface above the popup, ./account-layer.ts), Tab stays
 * inside, focus returns to whatever opened it.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useLocale } from '../../lib/i18n.js';
import { useAccountDot } from '../../lib/account-dot.js';
import type { AccountReason } from '../../lib/account-open.js';
import type { FocusCoordinator } from '../../lib/focus-coordinator.js';
import { ACCOUNT_DIALOG_PRIORITY, AccountLayerContext } from './account-layer.js';
import { requestPlayWorld } from '../../lib/play-again.js';
import { AccountTab, type Who } from './AccountTab.js';
import { CgTab, RecordsTab, RewardsTab, useProfile } from '../profile/ProfileTabs.js';
import { VoiceSettingsBody } from '../TtsSettings.js';
import { UsageDataToggle } from '../chrome/UsageDataToggle.js';
import { buildModeLabel, loginEnabled } from '../../lib/build-mode.js';
import './account-dialog.css';

export type AccountTabId = 'account' | 'records' | 'rewards' | 'cg' | 'settings';
/** Order and names (message keys) of the tabs. */
export const ACCOUNT_TABS: readonly { id: AccountTabId; label: string }[] = [
  { id: 'account', label: 'Account' },
  { id: 'records', label: 'My records' },
  { id: 'rewards', label: 'Rewards' },
  { id: 'cg', label: 'CG' },
  { id: 'settings', label: 'Settings' },
];

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function AccountDialog({ who, reason, tab, onTab, onClose, focus }: { who: Who; reason: AccountReason; tab: AccountTabId; onTab: (tab: AccountTabId) => void; onClose: () => void; focus?: FocusCoordinator }) {
  const { t } = useLocale();
  const id = useId();
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<Partial<Record<AccountTabId, HTMLButtonElement | null>>>({});
  const profile = useProfile();
  const dot = useAccountDot('lobby');
  const [returnTo] = useState(() => (typeof document !== 'undefined' ? document.activeElement as HTMLElement | null : null));

  useEffect(() => {
    tabRefs.current[tab]?.focus();
    return () => { returnTo?.focus?.(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Join App's Escape router (App.tsx dispatchEscape → closeTopmostSurface): without this the router closed
  // whatever surface sat below the popup (or nothing) and swallowed the key, so Esc never closed it.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!focus) return;
    const lease = focus.registerSurface({
      key: 'account-dialog',
      owner: 'workspace',
      priority: ACCOUNT_DIALOG_PRIORITY,
      root: sheetRef.current,
      close: () => closeRef.current(),
    });
    return () => lease.unregister();
  }, [focus]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A share dialog above this one handles its own keys.
      if (document.querySelector('.share-card')) return;
      if (e.key === 'Escape') { if (!e.defaultPrevented) { e.preventDefault(); onClose(); } return; }
      if (e.key !== 'Tab' || !sheetRef.current) return;
      const list = [...sheetRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      const inside = sheetRef.current.contains(document.activeElement);
      if (e.shiftKey && (document.activeElement === first || !inside)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || !inside)) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const onTabKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const at = ACCOUNT_TABS.findIndex((x) => x.id === tab);
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (at + 1) % ACCOUNT_TABS.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (at - 1 + ACCOUNT_TABS.length) % ACCOUNT_TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = ACCOUNT_TABS.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const nextId = ACCOUNT_TABS[next].id;
    onTab(nextId);
    tabRefs.current[nextId]?.focus();
  };

  const signIn = () => onTab('account');
  const play = (path: string) => { onClose(); window.requestAnimationFrame(() => requestPlayWorld(path)); };

  return createPortal(
    <AccountLayerContext.Provider value={focus ?? null}>
    <div className="account-dialog" data-testid="account-dialog" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={sheetRef} className="account-dialog__sheet" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`}>
        <header className="account-dialog__head">
          <h2 id={`${id}-title`}>{t('Account')}</h2>
          <button type="button" className="account-dialog__close" aria-label={t('Close')} title={t('Close')} onClick={onClose}><X aria-hidden="true" /></button>
        </header>
        <div className="account-dialog__tabs" role="tablist" aria-label={t('Account')} onKeyDown={onTabKey}>
          {ACCOUNT_TABS.map((x) => (
            <button
              key={x.id}
              ref={(el) => { tabRefs.current[x.id] = el; }}
              type="button"
              role="tab"
              id={`${id}-tab-${x.id}`}
              aria-selected={tab === x.id}
              aria-controls={`${id}-panel`}
              tabIndex={tab === x.id ? 0 : -1}
              data-tab={x.id}
              className="account-dialog__tab"
              onClick={() => onTab(x.id)}
            >
              {t(x.label)}
              {x.id === 'rewards' && dot && <span className="account-dot" data-testid="account-dot" aria-label={t('Rewards to claim')} />}
            </button>
          ))}
        </div>
        <div className="account-dialog__body" role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${tab}`} data-tab={tab}>
          {tab === 'account' && (loginEnabled()
            ? <AccountTab who={who} reason={reason} />
            : <p className="account-dialog__login-off" data-testid="login-off">{t('Worldlines sign-in is off in this build. Your own model keys (Settings) power everything.')}</p>)}
          {tab === 'records' && <RecordsTab model={profile.model} announce={profile.announce} onSignIn={signIn} onPlay={play} />}
          {tab === 'rewards' && <RewardsTab model={profile.model} usage={profile.usage} onSignIn={signIn} />}
          {tab === 'cg' && <CgTab model={profile.model} />}
          {tab === 'settings' && <div className="account-dialog__settings settings-panel" data-testid="settings-tab"><VoiceSettingsBody onOpenAccount={signIn} /><UsageDataToggle /></div>}
        </div>
        {/* Build mode + version (lib/build-mode.ts; the same line as GET /api/health). */}
        <footer className="account-dialog__build" data-testid="build-mode">{buildModeLabel()}</footer>
      </div>
    </div>
    </AccountLayerContext.Provider>,
    document.body,
  );
}
