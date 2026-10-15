import React, { useEffect, useState } from 'react';
import { accountData, useAccountData } from '../../lib/account-data.js';
import { useLocale } from '../../lib/i18n.js';

const REASONS: Record<string, string> = {
  invalid_nickname: 'A nickname is 1–20 characters, without links, email addresses or control characters.',
  content_refused: 'That nickname is not allowed. Try another one.',
  rate_limited: 'Too many changes today. Try again tomorrow.',
  signed_out: 'Sign in to set a nickname.',
};

/**
 * The optional public nickname: comments are anonymous —
 * 「匿名玩家」 + a per-world tag — unless the player sets one here. Never the
 * account's own name. Empty + save = anonymous again.
 */
export function NicknameField() {
  const { t } = useLocale();
  const account = useAccountData();
  const [value, setValue] = useState(account.nickname ?? '');
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setValue(account.nickname ?? ''); }, [account.nickname]);
  if (account.sync !== 'synced') return null;
  const save = async (next: string) => {
    setBusy(true);
    const why = await accountData()?.setNickname(next);
    setBusy(false);
    setStatus(why ? { ok: false, text: t(REASONS[why] ?? REASONS.invalid_nickname) } : { ok: true, text: next.trim() ? t('Saved. Your comments show this name.') : t('Your comments are anonymous again.') });
  };
  return (
    <form className="account-panel__nickname" onSubmit={event => { event.preventDefault(); void save(value); }}>
      <label>
        <span className="account-panel__note">{t('Public nickname (optional)')}</span>
        <input value={value} maxLength={20} disabled={busy} placeholder={t('Anonymous player')} onChange={event => setValue(event.target.value)} />
      </label>
      <span className="account-panel__nickname-actions">
        <button type="submit" className="account-panel__action" disabled={busy}>{t('Save')}</button>
        {account.nickname && <button type="button" className="account-panel__action" disabled={busy} onClick={() => { setValue(''); void save(''); }}>{t('Clear')}</button>}
      </span>
      <small className="account-panel__note">{t('Without a nickname your comments show as an anonymous player. Your account name is never shown.')}</small>
      {status && <p className={`account-panel__status${status.ok ? '' : ' account-panel__status--error'}`} role={status.ok ? 'status' : 'alert'}>{status.text}</p>}
    </form>
  );
}
