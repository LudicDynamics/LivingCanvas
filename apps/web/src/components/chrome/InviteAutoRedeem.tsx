/**
 * An invite link (`?invite=WL-XXXXXX`, remembered by lib/invite.ts at start-up) is redeemed after the first
 * sign-in, with a visible toast — on start-up (the sign-in came back through a redirect), whenever an account
 * view says the account changed, and every 20 s while one is still waiting (the email-code sign-in finishes in
 * place). Renders nothing unless there is something to say.
 */
import { useEffect, useState } from 'react';
import { useLocale } from '../../lib/i18n.js';
import { accountData } from '../../lib/account-data.js';
import { ACCOUNT_CHANGED_EVENT, announceAccountChanged } from '../../lib/account-open.js';
import { pendingInvite, redeemPendingInvite } from '../../lib/invite.js';
import { redeemError } from '../../lib/plans.js';
import './invite.css';

const RETRY_MS = 20_000;
const TOAST_MS = 9_000;

export function InviteAutoRedeem() {
  const { t, locale } = useLocale();
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(null);

  useEffect(() => {
    if (!pendingInvite()) return;
    let live = true;
    const attempt = async () => {
      const r = await redeemPendingInvite(accountData(), locale);
      if (!live) return;
      if (r.status === 'redeemed') {
        const credits = r.redeemed.credits.toLocaleString();
        // billing grants the invitee's credits after real play (a pending reward in 邀请好友), not at redeem.
        const text = r.redeemed.pendingVerification
          ? t('Invite code applied: your {credits} credits unlock after you play a bit.', { credits })
          : t('Invite code applied: {credits} credits added.', { credits });
        setToast({ text, error: false });
        announceAccountChanged(); // the wallet in the account panel
      } else if (r.status === 'refused') {
        setToast({ text: `${t('The invite code was not applied.')} ${t(redeemError(r.error))}`, error: true });
      }
    };
    void attempt();
    const timer = window.setInterval(() => { if (pendingInvite()) void attempt(); else window.clearInterval(timer); }, RETRY_MS);
    const onChanged = () => void attempt();
    window.addEventListener(ACCOUNT_CHANGED_EVENT, onChanged);
    return () => { live = false; window.clearInterval(timer); window.removeEventListener(ACCOUNT_CHANGED_EVENT, onChanged); };
  }, [locale, t]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  if (!toast) return null;
  return (
    <div className={`invite-toast${toast.error ? ' invite-toast--error' : ''}`} role={toast.error ? 'alert' : 'status'} data-testid="invite-toast">
      <span>{toast.text}</span>
      <button type="button" aria-label={t('Close')} onClick={() => setToast(null)}>×</button>
    </div>
  );
}
