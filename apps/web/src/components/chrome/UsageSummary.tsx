import React, { useEffect, useState } from 'react';
import { accountData, type AccountUsage } from '../../lib/account-data.js';
import { useLocale } from '../../lib/i18n.js';
import { DailyClaim } from './DailyClaim.js';

const tokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

/**
 * The signed-in account's AI use (ai.worldlines.gg /v1/usage/me) and wallet
 * (billing.worldlines.gg /v1/me/balance), as two quiet lines in the account
 * panel — asked for when the panel opens, nothing when either is unavailable.
 * Under the balance: today's claim-only free allowance and 「领取今日额度」 (DailyClaim.tsx).
 */
export function UsageSummary() {
  const { t } = useLocale();
  const [usage, setUsage] = useState<AccountUsage | null>(null);
  useEffect(() => {
    let alive = true;
    void accountData()?.loadUsage().then(u => { if (alive) setUsage(u); });
    return () => { alive = false; };
  }, []);
  if (!usage || (!usage.today && !usage.wallet)) return null;
  const w = usage.wallet;
  const unit = w?.pointName || t('credits');
  return (
    <div className="account-panel__usage">
      {usage.today && usage.month && (
        <p className="account-panel__note">
          {t('AI today: {today} tokens · this month: {month} tokens', { today: tokens(usage.today.tokens), month: tokens(usage.month.tokens) })}
        </p>
      )}
      {w && w.available !== null && (
        <p className="account-panel__note">
          {t('Balance: {available} {unit}', { available: w.available.toLocaleString(), unit })}
          {w.usedToday !== null ? ` · ${t('used today: {used}', { used: w.usedToday.toLocaleString() })}` : ''}
        </p>
      )}
      {w && <DailyClaim daily={w.daily} unit={unit} onClaimed={(c) => setUsage((u) => (u?.wallet ? { ...u, wallet: { ...u.wallet, available: c.available ?? u.wallet.available, daily: c.daily ?? u.wallet.daily } } : u))} />}
    </div>
  );
}
