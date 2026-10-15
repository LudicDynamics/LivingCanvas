/**
 * 「邀请好友」 in the account panel: the account's own invite code (WL-XXXXXX) and its link,
 * 复制链接, 生成分享图 (ShareCardDialog), how many friends came / played / what it earned, and the account's
 * rewards. Rewards come only from play billing served itself (anti-abuse): the inviter's 200
 * once the friend really played, the invitee's welcome credits after ≥ 20 turns in one world, the rest of the
 * welcome credits after the first turns. One still `pending_verification` shows 「玩一会儿后解锁」 with its
 * progress (n/20 回合, maybe 「再打出一个结局」), no button; a claimable one keeps 领取 (never automatic).
 * Signed out / no billing → nothing. The list itself: RewardList.tsx.
 */
import { track } from '../../lib/analytics.js';
import { useCallback, useEffect, useState } from 'react';
import { useLocale } from '../../lib/i18n.js';
import { accountData, type InviteInfo } from '../../lib/account-data.js';
import { inviteLinkFor } from '../../lib/invite.js';
import { ACCOUNT_CHANGED_EVENT } from '../../lib/account-open.js';
import { ShareCardDialog } from './ShareCardDialog.js';
import { RewardList, useRewardClaims } from './RewardList.js';
import './invite.css';

export function InviteFriends() {
  const { t, locale } = useLocale();
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [sharing, setSharing] = useState(false);
  const [copied, setCopied] = useState<{ text: string; error: boolean } | null>(null);
  const { rewards, busy, status: claimStatus, claim } = useRewardClaims();
  const status = claimStatus ?? copied;

  const load = useCallback(async () => {
    const data = accountData();
    setInfo(data ? await data.invite() : null);
  }, []);

  useEffect(() => {
    void load();
    const onChanged = () => void load();
    window.addEventListener(ACCOUNT_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(ACCOUNT_CHANGED_EVENT, onChanged);
  }, [load]);

  if (!info) return null;
  // The friend lands in the sharer's language (lib/canvas-link.ts).
  const shareUrl = inviteLinkFor(info, locale);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      track('invite_share', { channel: 'copy_link' });
      setCopied({ text: t('Link copied.'), error: false });
    } catch {
      setCopied({ text: shareUrl, error: false });
    }
  };

  return (
    <section className="invite-friends" data-testid="invite-friends" aria-label={t('Invite friends')}>
      <h3 className="invite-friends__title">{t('Invite friends')}</h3>
      <p className="account-panel__note">
        {t('Friends who sign up with your code get {credits} credits once they have played a bit. When a friend has really played, you can claim {reward} credits (up to {cap} friends a month).', {
          credits: info.inviteeCredits.toLocaleString(),
          reward: info.inviterCredits.toLocaleString(),
          cap: info.monthlyCap,
        })}
      </p>
      <div className="invite-friends__code" aria-label={t('Your invite code')}>
        <span className="invite-friends__label">{t('Your invite code')}</span>
        <code data-testid="invite-code">{info.code}</code>
      </div>
      <p className="invite-friends__link"><a href={shareUrl} target="_blank" rel="noopener">{shareUrl.replace(/^https?:\/\//, '')}</a></p>
      <div className="invite-friends__actions">
        <button type="button" className="account-panel__action" onClick={() => setSharing(true)} disabled={!info.enabled}>{t('Create share image')}</button>
        <button type="button" className="account-panel__secondary" onClick={() => void copy()}>{t('Copy link')}</button>
      </div>
      <p className="account-panel__note" data-testid="invite-stats">
        {t('Invited {invited} · played {played} · earned {credits} credits', { invited: info.stats.invited, played: info.stats.played, credits: info.stats.creditsEarned.toLocaleString() })}
      </p>
      {rewards.length > 0 && <RewardList rewards={rewards} busy={busy} onClaim={(r) => void claim(r)} />}
      {status && <p className={`account-panel__status${status.error ? ' account-panel__status--error' : ''}`} role={status.error ? 'alert' : 'status'}>{status.text}</p>}
      {sharing && (
        <ShareCardDialog
          kind="invite"
          code={info.code}
          url={shareUrl}
          credits={info.inviteeCredits}
          onClose={() => setSharing(false)}
        />
      )}
    </section>
  );
}
