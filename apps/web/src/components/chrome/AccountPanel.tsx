/**
 * The ONE account entry: the 「账号」 pill in the lobby top bar
 * (`variant="launcher"`) and the account icon in the world header. Both open the same tabbed glass popup
 * (components/account/AccountDialog.tsx: 账号 · 我的记录 · 奖励 · CG · 设置); the player panel inside a world
 * opens it too, through `openAccountPanel()` — as does every other screen that needs an account (play / publish
 * gate, remote shelf, settings).
 *
 * A small dot on the entry when something can be claimed (lib/account-dot.ts). The world header is closed when a
 * world is first seen, so the dot is never part of that first look.
 */
import { track } from '../../lib/analytics.js';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { UserRound } from 'lucide-react';
import { useLocale } from '../../lib/i18n.js';
import { isTriggerReachable, openAccountPanel, registerAccountOpener, type AccountReason } from '../../lib/account-open.js';
import { useAccountDot } from '../../lib/account-dot.js';
import { guestModeOf, guestTrialNow } from '../../lib/guest-trial.js';
import { AccountDialog, type AccountTabId } from '../account/AccountDialog.js';
import { useWho } from '../account/AccountTab.js';
import type { FocusCoordinator } from '../../lib/focus-coordinator.js';
import './contact-panel.css';
import './account-panel.css';

export function AccountPanel({ variant = 'header', focus }: { variant?: 'header' | 'launcher'; focus?: FocusCoordinator }) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<AccountTabId>('account');
  /** Opened by the play / publish gate (lib/play-gate.ts): say why, above the sign-in. */
  const [reason, setReason] = useState<AccountReason>(null);
  const who = useWho();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dot = useAccountDot(variant === 'launcher' ? 'lobby' : 'world-header');

  // Other screens ask for the popup (openAccountPanel): it opens on the 账号 tab.
  useEffect(() => registerAccountOpener({
    reachable: () => isTriggerReachable(triggerRef.current),
    open: (_floating, why) => { setReason(why ?? null); setTab('account'); setOpen(true); },
  }), []);

  // 改进产品 (lib/analytics.ts): which account tab was looked at.
  useEffect(() => { if (open) track('account_open', { tab }); }, [open, tab]);
  const close = useCallback(() => { setOpen(false); setReason(null); }, []);
  const label = t('Account');

  return (
    <div className="contact-panel account-panel" data-variant={variant}>
      <button
        ref={triggerRef}
        type="button"
        className={`contact-panel__trigger account-panel__trigger ${variant === 'launcher' ? 'world-launcher__pill' : 'contact-panel__icon'}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={variant === 'launcher' ? undefined : label}
        title={variant === 'launcher' ? undefined : label}
        data-testid="account-entry"
        onClick={() => { setReason(null); setTab('account'); setOpen((value) => !value); }}
      >
        {variant === 'launcher' ? label : <UserRound aria-hidden="true" />}
        {dot && <span className="account-dot" data-testid="account-dot" aria-label={t('Rewards to claim')} />}
      </button>
      {open && <AccountDialog who={who} reason={reason} tab={tab} onTab={setTab} onClose={close} focus={focus} />}
    </div>
  );
}

/**
 * 「用账号登录」 for screens that need an account (remote shelf, remote upload,
 * settings): opens the account panel instead of pointing somewhere else.
 */
export function OpenAccountButton({ className, beforeOpen, children, cloud = false }: { className?: string; beforeOpen?: () => void; children?: ReactNode; /** A cloud action: a guest (trial) sees 「登录后保存到云端」 + the gift line. */ cloud?: boolean }) {
  const { t } = useLocale();
  return (
    <button
      type="button"
      className={className}
      data-testid="open-account-panel"
      onClick={() => {
        beforeOpen?.();
        // Let a closing dialog leave the screen first, so the anchored panel is the one reachable.
        window.requestAnimationFrame(() => { openAccountPanel(cloud && guestModeOf(guestTrialNow()) ? 'cloud' : null); });
      }}
    >
      {children ?? t('Sign in / Sign up')}
    </button>
  );
}
