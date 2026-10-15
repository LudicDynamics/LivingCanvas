/**
 * 「输入兑换码」 in the account panel's plans area. Signed in: a field + 兑换
 * that goes through this app's server to billing (`POST /v1/me/redeem` with the account's token — the page
 * never holds one) and says what happened (trial until …, credits added, an invite's credits unlocking after
 * play) or why not, in the player's
 * language. Signed out: a link to the billing site's /redeem page (`redeem_url` from `/v1/config`, else
 * `<billing>/redeem`). billing decides everything; nothing is bought here. Invite codes (WL-XXXXXX) go through the
 * same field (billing routes them to the invite rules).
 */
import { asWord, track } from '../../lib/analytics.js';
import { useEffect, useState, type FormEvent } from 'react';
import { useLocale } from '../../lib/i18n.js';
import { accountData } from '../../lib/account-data.js';
import { browserDeployment } from '../../lib/browser-mode.js';
import { deviceId } from '../../lib/invite.js';
import { PLAN_TIERS, billingLinks, fetchBillingConfig, planTier, redeemError, trialDay } from '../../lib/plans.js';

export function RedeemCode({ signedIn, onRedeemed }: { signedIn: boolean; onRedeemed?: () => void }) {
  const { t, locale } = useLocale();
  const base = browserDeployment.billing;
  const [href, setHref] = useState(() => billingLinks(base, null, locale).redeem);
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null);
  useEffect(() => {
    let live = true;
    setHref(billingLinks(base, null, locale).redeem);
    void fetchBillingConfig(base).then((config) => { if (live && config) setHref(billingLinks(base, config, locale).redeem); });
    return () => { live = false; };
  }, [base, locale]);

  if (!signedIn) {
    return (
      <p className="account-panel__note plans-preview__redeem" data-testid="redeem-link">
        <a href={href} target="_blank" rel="noopener">{t('Have a redemption code? Redeem it on the billing site')}</a>
      </p>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const value = code.trim();
    if (!value) { setStatus({ text: t('Enter a redemption code.'), error: true }); return; }
    const data = accountData();
    if (!data) { track('redeem_attempt', { result: 'signed_out' }); setStatus({ text: t(redeemError('signed_out')), error: true }); return; }
    setBusy(true);
    setStatus(null);
    const r = await data.redeem(value, locale, deviceId());
    setBusy(false);
    // 改进产品 (lib/analytics.ts): the outcome code only, never the code typed.
    track('redeem_attempt', { result: asWord(r.ok ? r.redeemed.outcome : r.code) ?? (r.ok ? 'ok' : 'failed') });
    if (!r.ok) { setStatus({ text: t(redeemError(r.code)), error: true }); return; }
    const x = r.redeemed;
    const credits = x.credits > 0 ? t('{count} credits added.', { count: x.credits.toLocaleString() }) : '';
    let text: string;
    if (x.outcome === 'invite') {
      // billing grants the invitee's credits only after real play (a pending reward in 邀请好友), not at redeem.
      text = x.pendingVerification
        ? t('Invite code applied: your {credits} credits unlock after you play a bit.', { credits: x.credits.toLocaleString() })
        : t('Invite code applied: {credits} credits added.', { credits: x.credits.toLocaleString() });
    } else if (x.outcome === 'trial_started') {
      const name = PLAN_TIERS.find((p) => p.id === planTier(x.plan))!.name;
      text = [t('Trial membership ({plan}) is on until {date}.', { plan: t(name), date: trialDay(x.endsAt) ?? '' }), credits].filter(Boolean).join(' ');
    } else text = x.alreadyMember ? t('You are already a member, so your plan stays; {count} credits added.', { count: x.credits.toLocaleString() }) : credits || t('Code redeemed.');
    setStatus({ text, error: false });
    setCode('');
    onRedeemed?.();
  };

  return (
    <div className="plans-preview__redeem" data-testid="redeem-code">
      {!open && (
        <button type="button" className="plans-preview__toggle" aria-expanded={false} onClick={() => setOpen(true)}>{t('Enter a redemption code')}</button>
      )}
      {open && (
        <form className="account-panel__form" onSubmit={(e) => void submit(e)} aria-busy={busy}>
          <label className="account-panel__field">{t('Redemption code')}
            <input
              aria-label={t('Redemption code')}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={80}
              placeholder="PLAYTEST-XXXX-XXXX · WL-XXXXXX"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </label>
          <button type="submit" className="account-panel__action">{busy ? t('Working…') : t('Redeem')}</button>
        </form>
      )}
      {status && <p className={`account-panel__status${status.error ? ' account-panel__status--error' : ''}`} role={status.error ? 'alert' : 'status'}>{status.text}</p>}
    </div>
  );
}
