/**
 * 「API key」 in the account panel
 * a signed-in player makes a personal key (`wl_pat_…`, identity
 * service POST /v1/pats, scope `api:use`) to use as the OpenAI API key against
 * the Worldlines model gateway. The same panel for the local app and the browser
 * version: both ask their own server (/api/remote/api-keys), which holds the
 * session. The value is shown ONCE, in this component's memory only — never in
 * browser storage, the VFS, a world or a log — and gone when the panel closes.
 */
import { useCallback, useEffect, useState } from 'react';
import { airpGateway, type ApiKey } from '../../lib/airp-gateway.js';
import { useLocale } from '../../lib/i18n.js';
import { remoteErrorText } from '../../lib/remote-sync.js';

export const MODEL_GATEWAY_BASE = 'https://ai.worldlines.gg/v1';
const EXPIRY_CHOICES: (number | null)[] = [30, 90, 365, null];

export function ApiKeys() {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const [name, setName] = useState('');
  const [days, setDays] = useState<number | null>(90);
  const [fresh, setFresh] = useState<{ id: string; token: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try { setKeys((await airpGateway.apiKeys()).keys); } catch (failure) { setKeys([]); setError(true); setMessage(remoteErrorText(failure, t('That did not work. Try again.'))); }
  }, [t]);
  useEffect(() => { if (open) void load(); }, [open, load]);
  // Closing the section forgets a key that was being shown.
  useEffect(() => { if (!open) { setFresh(null); setCopied(false); } }, [open]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true); setMessage(''); setError(false);
    try { await work(); } catch (failure) { setError(true); setMessage(remoteErrorText(failure, t('That did not work. Try again.'))); } finally { setBusy(false); }
  };
  const create = () => run(async () => {
    const made = await airpGateway.createApiKey(name.trim(), days);
    setFresh({ id: made.key.id, token: made.token });
    setCopied(false);
    setName('');
    await load();
  });
  const revoke = (key: ApiKey) => run(async () => {
    await airpGateway.revokeApiKey(key.id);
    if (fresh?.id === key.id) setFresh(null);
    setMessage(t('Key “{name}” revoked.', { name: key.name }));
    await load();
  });
  const copy = async () => {
    if (!fresh) return;
    try { await navigator.clipboard.writeText(fresh.token); setCopied(true); } catch { setCopied(false); }
  };
  const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : '—');
  const expiryLabel = (d: number | null) => (d === null ? t('Never expires') : t('{days} days', { days: String(d) }));

  return (
    <div className="api-keys">
      <button type="button" className="api-keys__toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{t('API key')}</button>
      {open && (
        <div className="api-keys__body">
          <p className="account-panel__note">{t('Use your account with other apps: make a key, then give it to any OpenAI-compatible client.')}</p>
          <ol className="api-keys__howto">
            <li>{t('Base URL')}: <code>{MODEL_GATEWAY_BASE}</code></li>
            <li>{t('API key: the wl_pat_… key you make here')}</li>
            <li>{t('Optional header')}: <code>X-Worldlines-Product: livingcanvas</code></li>
          </ol>
          {fresh && (
            <div className="api-keys__fresh" role="status">
              <p className="api-keys__warn">{t('Copy this key now. It is shown only once and this app does not keep it.')}</p>
              <code className="api-keys__value" data-testid="api-key-value">{fresh.token}</code>
              <div className="api-keys__row">
                <button type="button" className="account-panel__action" onClick={() => void copy()}>{copied ? t('Copied') : t('Copy')}</button>
                <button type="button" className="account-panel__secondary" onClick={() => { setFresh(null); setCopied(false); }}>{t('Done')}</button>
              </div>
            </div>
          )}
          <fieldset className="account-panel__form" disabled={busy} aria-busy={busy}>
            <label className="account-panel__field">{t('Key name')}
              <input aria-label={t('Key name')} maxLength={100} placeholder={t('e.g. my laptop')} value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="account-panel__field">{t('Expires')}
              <select aria-label={t('Expires')} value={days === null ? 'never' : String(days)} onChange={(e) => setDays(e.target.value === 'never' ? null : Number(e.target.value))}>
                {EXPIRY_CHOICES.map((d) => <option key={String(d)} value={d === null ? 'never' : String(d)}>{expiryLabel(d)}</option>)}
              </select>
            </label>
            <button type="button" className="account-panel__action" disabled={!name.trim()} onClick={() => void create()}>{t('Create API key')}</button>
          </fieldset>
          {keys === null ? <p className="account-panel__note">{t('Checking…')}</p> : keys.length === 0 ? <p className="account-panel__note">{t('No API keys yet.')}</p> : (
            <ul className="api-keys__list" aria-label={t('Your API keys')}>
              {keys.map((key) => (
                <li key={key.id} className="api-keys__item">
                  <span className="api-keys__name">{key.name} <code>…{(key.hint ?? '').slice(-4)}</code></span>
                  <span className="api-keys__meta">
                    {t('Created {date}', { date: date(key.createdAt) })} · {t('Last used {date}', { date: date(key.lastUsedAt) })}
                    {key.expiresAt ? ` · ${t('Expires {date}', { date: date(key.expiresAt) })}` : ''} · {key.scopes.join(', ')}
                  </span>
                  <button type="button" className="account-panel__secondary" disabled={busy} onClick={() => void revoke(key)}>{t('Revoke')}</button>
                </li>
              ))}
            </ul>
          )}
          {message && <p className={`account-panel__status${error ? ' account-panel__status--error' : ''}`} role={error ? 'alert' : 'status'}>{message}</p>}
        </div>
      )}
    </div>
  );
}
