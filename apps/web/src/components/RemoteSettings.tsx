/**
 * 「远端」 in the settings dialog. Signing in is
 * NOT here any more — it lives in the 「账号」 panel in the top bar
 *; this
 * section only points there and keeps the remote address under 「高级」.
 * Localhost only: on a hosted seat the routes answer 403 and this renders nothing.
 */
import { useEffect, useState } from 'react';
import { useLocale } from '../lib/i18n.js';
import { OpenAccountButton } from './chrome/AccountPanel.js';
import { useRemoteAccount } from './chrome/useRemoteAccount.js';

const inputStyle = { display: 'block', width: '100%', color: '#272321', background: '#f5efdf', padding: 8 } as const;

export function RemoteSettings({ onOpenAccount }: { onOpenAccount?: () => void }) {
  const { t } = useLocale();
  const account = useRemoteAccount();
  const { settings, busy } = account;
  const [url, setUrl] = useState('');
  useEffect(() => { if (settings) setUrl(settings.url); }, [settings?.url]);

  if (!settings) return null;

  return <section style={{ marginTop: 24 }} aria-labelledby="remote-settings-heading">
    <h3 id="remote-settings-heading">{t('Remote')}</h3>
    <p>
      {settings.signedIn ? `${t('Signed in as {email}.', { email: settings.email ?? settings.uid ?? '' })} ` : ''}
      {t('Account sign-in is under “Account” in the top bar.')}
    </p>
    <OpenAccountButton beforeOpen={onOpenAccount}>{t('Open account')}</OpenAccountButton>
    <details style={{ marginTop: 12 }}>
      <summary>{t('Advanced')}</summary>
      <fieldset disabled={busy} style={{ margin: '8px 0', display: 'grid', gap: 8, border: 0, padding: 0 }}>
        <label>{t('Remote address')}<input type="url" aria-label={t('Remote address')} placeholder={settings.defaultUrl} value={url} onChange={(e) => setUrl(e.target.value)} style={inputStyle} /></label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" disabled={url.trim() === settings.url} onClick={() => void account.saveUrl(url)}>{t('Save')}</button>
          {settings.custom && <button type="button" onClick={() => { setUrl(''); void account.saveUrl(''); }}>{t('Use the default')}</button>}
          {settings.signedIn && <button type="button" onClick={() => void account.test()}>{t('Test connection')}</button>}
        </div>
        <small>{t('Changing the address signs you out.')}</small>
      </fieldset>
    </details>
    <p role="status">{account.message}</p>
  </section>;
}
