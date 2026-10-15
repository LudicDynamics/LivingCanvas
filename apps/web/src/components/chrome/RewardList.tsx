/**
 * The account's rewards in 「邀请好友」 (InviteFriends.tsx). A claimable one has 领取; one still
 * `pending_verification` (billing waits for play it served itself — anti-abuse) says
 * 「玩一会儿后解锁」 with its progress (`n/20 回合`, and 「再打出一个结局」 while an ending is still needed) and
 * has no button.
 */
import { useCallback, useEffect, useState } from 'react';
import { useLocale } from '../../lib/i18n.js';
import { accountData, rewardState, type Reward, type RewardState } from '../../lib/account-data.js';
import { ACCOUNT_CHANGED_EVENT } from '../../lib/account-open.js';
import { announceRewardsChanged } from '../../lib/account-dot.js';
import { deviceId } from '../../lib/invite.js';

/**
 * The account's rewards + 领取 through this app's server (billing; never automatic). ONE copy for 「邀请好友」 and
 * the account popup's 奖励 tab; `states` picks which to list (the tab also lists the claimed ones).
 */
export function useRewardClaims(states: readonly RewardState[] = ['claimable', 'pending_verification']) {
  const { t } = useLocale();
  const [rewards, setRewards] = useState<Reward[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null);
  const key = states.join(',');
  const load = useCallback(async () => {
    const r = await accountData()?.rewards().catch(() => null);
    setRewards((r ?? []).filter((x) => states.includes(rewardState(x))));
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    void load();
    const again = () => void load();
    window.addEventListener(ACCOUNT_CHANGED_EVENT, again);
    return () => window.removeEventListener(ACCOUNT_CHANGED_EVENT, again);
  }, [load]);
  const claim = async (r: Reward) => {
    const data = accountData();
    if (!data || busy) return;
    setBusy(r.id);
    const done = await data.claimReward(r.id, deviceId());
    setBusy(null);
    if (done?.status === 'claimed') {
      setStatus({ text: t('Claimed {credits} credits.', { credits: r.credits.toLocaleString() }), error: false });
      announceRewardsChanged();
      void load();
    } else setStatus({ text: t('This reward could not be claimed right now.'), error: true });
  };
  return { rewards: rewards ?? [], loaded: rewards !== null, busy, status, claim, reload: load };
}

export function RewardList({ rewards, busy, onClaim }: { rewards: Reward[]; busy: string | null; onClaim: (r: Reward) => void }) {
  const { t } = useLocale();
  const label = (r: Reward) => {
    const credits = r.credits.toLocaleString();
    if (r.kind === 'invite') return t('Invite reward: {credits} credits', { credits });
    if (r.kind === 'invite_welcome') return t('Invite welcome gift: {credits} credits', { credits });
    if (r.kind === 'trial_rest') return t('Rest of your welcome credits: {credits} credits', { credits });
    return t('Reward: {credits} credits', { credits });
  };
  return (
    <div className="invite-friends__rewards">
      <p className="invite-friends__label">{t('Your rewards')}</p>
      <ul>
        {rewards.map((r) => rewardState(r) === 'pending_verification' ? (
          <li key={r.id} data-testid="reward-pending">
            <span>{label(r)}</span>
            <span className="invite-friends__unlock">
              <span>{t('Unlocks after you play a bit')}</span>
              {r.progress && r.progress.need > 0 && (
                <span data-testid="reward-progress">{t('{calls}/{need} turns', { calls: Math.min(r.progress.calls, r.progress.need), need: r.progress.need })}</span>
              )}
              {r.progress?.endingNeeded && !r.progress.ending && <span>{t('Then reach one ending')}</span>}
            </span>
          </li>
        ) : rewardState(r) === 'claimed' ? (
          <li key={r.id} data-testid="reward-claimed" className="invite-friends__claimed">
            <span>{label(r)}</span>
            <span className="invite-friends__unlock">{t('Claimed')}</span>
          </li>
        ) : (
          <li key={r.id}>
            <span>{label(r)}</span>
            <button type="button" className="account-panel__secondary" disabled={busy === r.id} onClick={() => onClaim(r)}>{busy === r.id ? t('Working…') : t('Claim')}</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
