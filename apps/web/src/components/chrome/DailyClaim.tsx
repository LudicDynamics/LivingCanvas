/**
 * 「领取今日额度」 (lib/daily-claim.ts): today's free allowance in the account panel's balance area — 「今日可领 100 积分」
 * (100 a day for everyone, a click) + the button, or 「今日已领取 · 重置于 21:00 JST」 (0008's
 * 「新手期 第 n/8 天」 prefix only if an admin switches the newcomer period back on). The claim goes through this app's server
 * (accountData().claimDaily → /api/account-data/claim-daily → billing POST /v1/claims/worldlines/daily with the
 * account's token; the page never holds one). ClaimPrompt: the same button in a small card, shown only when a
 * model call was refused with `claim_required` (billing enforcing credits) — never on first look.
 */
import { useEffect, useState } from 'react';
import { useLocale } from '../../lib/i18n.js';
import { accountData, type DailyAllowance, type DailyClaimed } from '../../lib/account-data.js';
import { claimError, dailyClaimState, isClaimRequired } from '../../lib/daily-claim.js';
import { CREDITS_PAUSED, CREDITS_SHORT, creditsStopOf } from '../../lib/model-errors.js';
import { openAccountPanel } from '../../lib/account-open.js';
import { deviceId } from '../../lib/invite.js';
import { announceRewardsChanged } from '../../lib/account-dot.js';

export function DailyClaim({ daily, unit, onClaimed, forceButton = false }: { daily: DailyAllowance | null | undefined; unit: string; onClaimed?: (claimed: DailyClaimed) => void; forceButton?: boolean }) {
  const { t } = useLocale();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null);
  const state = dailyClaimState(daily);
  if (state.kind === 'none' && !status && !forceButton) return null;

  const claim = async () => {
    if (busy) return;
    const data = accountData();
    if (!data) { setStatus({ text: t(claimError('signed_out')), error: true }); return; }
    setBusy(true);
    setStatus(null);
    const r = await data.claimDaily(deviceId());
    setBusy(false);
    if (!r.ok) { setStatus({ text: t(claimError(r.code)), error: true }); return; }
    setStatus({
      text: r.claimed.duplicated
        ? t("Today's credits were already claimed.")
        : t('Claimed {count} {unit}.', { count: r.claimed.credits.toLocaleString(), unit }),
      error: false,
    });
    announceRewardsChanged();
    onClaimed?.(r.claimed);
  };

  return (
    <div className="daily-claim" data-testid="daily-claim">
      {(state.kind === 'claimable' || (state.kind === 'none' && forceButton && !status)) && (
        <p className="account-panel__note daily-claim__line">
          {state.kind === 'claimable' && (
            <>
              {state.newcomer
                ? t('Newcomer day {day}/{days}: {count} {unit} to claim today', { day: state.newcomer.day, days: state.newcomer.days, count: state.allowance.toLocaleString(), unit })
                : t("Today's free credits: {count} {unit} to claim", { count: state.allowance.toLocaleString(), unit })}{' '}
            </>
          )}
          <button type="button" className="account-panel__secondary daily-claim__button" disabled={busy} aria-busy={busy} onClick={() => void claim()}>
            {busy ? t('Working…') : t("Claim today's credits")}
          </button>
        </p>
      )}
      {state.kind === 'claimed' && (
        <p className="account-panel__note daily-claim__line" data-testid="daily-claimed">
          {state.newcomer && <>{t('Newcomer day {day}/{days}', { day: state.newcomer.day, days: state.newcomer.days })} · </>}
          {state.resets ? t('Claimed today · resets at {time}', { time: state.resets }) : t('Claimed today')}
        </p>
      )}
      {status && <p className={`account-panel__status${status.error ? ' account-panel__status--error' : ''}`} role={status.error ? 'alert' : 'status'}>{status.text}</p>}
    </div>
  );
}

/**
 * The gentle prompt: a model call said `claim_required` (an `airp:notice` whose text carries it). Shows today's
 * allowance with the claim button until claimed or closed; asks the account for the current status first.
 */
export function ClaimPrompt() {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  // 'short': the wallet cannot pay (402 insufficient_credits) — the card offers the account (redeem / plans) instead.
  // 'paused': 402 debt_limit — the balance is below the debt limit; the same account card, its own sentence.
  const [mode, setMode] = useState<'claim' | 'short' | 'paused'>('claim');
  const [daily, setDaily] = useState<DailyAllowance | null>(null);
  const [unit, setUnit] = useState<string | null>(null);
  useEffect(() => {
    const onNotice = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (!isClaimRequired(detail)) {
        const stop = creditsStopOf(detail);
        if (!stop) return;
        setMode(stop === 'debt_limit' ? 'paused' : 'short');
        setOpen(true);
        return;
      }
      setMode('claim');
      setOpen(true);
      void accountData()?.loadUsage().then((u) => {
        setDaily(u?.wallet?.daily ?? null);
        setUnit(u?.wallet?.pointName ?? null);
      });
    };
    window.addEventListener('airp:notice', onNotice);
    return () => window.removeEventListener('airp:notice', onNotice);
  }, []);
  if (!open) return null;
  if (mode !== 'claim') return (
    <aside className="daily-claim__prompt" role="dialog" aria-label={t('Open account')} data-testid="credits-prompt" data-reason={mode === 'paused' ? 'debt_limit' : 'insufficient_credits'}>
      <p className="daily-claim__prompt-text">{t(mode === 'paused' ? CREDITS_PAUSED : CREDITS_SHORT)}</p>
      <button type="button" className="daily-claim__button" onClick={() => { setOpen(false); openAccountPanel(); }}>{t('Open account')}</button>
      <button type="button" className="daily-claim__close" aria-label={t('Close')} onClick={() => setOpen(false)}>×</button>
    </aside>
  );
  return (
    <aside className="daily-claim__prompt" role="dialog" aria-label={t("Claim today's credits")} data-testid="claim-prompt">
      <p className="daily-claim__prompt-text">{t("Today's free credits are waiting. Claim them to go on.")}</p>
      <DailyClaim daily={daily} forceButton={!daily} unit={unit || t('credits')} onClaimed={() => window.setTimeout(() => setOpen(false), 1600)} />
      <button type="button" className="daily-claim__close" aria-label={t('Close')} onClick={() => setOpen(false)}>×</button>
    </aside>
  );
}
