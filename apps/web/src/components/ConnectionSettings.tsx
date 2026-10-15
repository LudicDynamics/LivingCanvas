import { useEffect, useState } from 'react';
import { useLocale } from '../lib/i18n.js';

const services = [
  ['DashScope TTS', 'DASHSCOPE_API_KEY', 'AIRP_TTS_BASE_URL'],
  ['OpenAI official', 'OPENAI_API_KEY', null],
  ['OpenAI-compatible', 'AIRP_CUSTOM_OPENAI_PENDING_API_KEY', 'AIRP_CUSTOM_OPENAI_PENDING_BASE_URL'],
  ['Flow media proxy', 'FLOW_API_KEY', 'FLOW_API_BASE'],
  ['DeepSeek V4.1 Flash', 'DEEPSEEK_API_KEY', null],
] as const;

type StatusKey =
  | 'Open this page on localhost to configure server connections.'
  | 'Could not save connections. Check the service URLs and server permissions.'
  | 'OpenAI model catalog discovery is in progress.'
  | 'Connections saved. TTS applies immediately; refresh OpenAI-compatible models to activate the pending connection.'
  | 'OpenAI model catalog refresh is waiting for agents to become idle.'
  | 'OpenAI model catalog is activating.'
  | 'OpenAI model catalog refreshed: {count} models are available.'
  | 'OpenAI model catalog refresh failed: {reason}'
  | 'OpenAI model catalog refresh was cancelled.';

/** Which way a capability goes (server ai-gateway.ts `aiRoutes`): never a key. */
type AiPath = 'own' | 'local' | 'account' | 'service' | 'none';
const REFRESH_ERROR_COPY: Record<string, string> = {
  'missing-credentials': 'Configure and save a custom OpenAI URL and key first.',
  'invalid-url': 'The configured endpoint URL is invalid.',
  timeout: 'The endpoint timed out. Check that it is reachable and try again.',
  redirect: 'The endpoint redirected the request. Redirects are not followed.',
  'http-error': 'The endpoint returned an unsuccessful response.',
  'response-too-large': 'The endpoint response exceeded the 1 MiB limit.',
  'invalid-response': 'The endpoint returned an invalid or empty model catalog.',
  'empty-catalog': 'The endpoint returned an invalid or empty model catalog.',
  'activation-failed': 'OpenAI activation failed; the previous configuration and agents were restored.',
  'rollback-failed': 'The previous configuration was restored, but agent recovery needs attention.',
  'world-changed': 'The world changed before activation; no pending catalog was committed.',
  'configuration-changed': 'The refresh inputs or active world changed during discovery; run refresh again.',
  'saved-custom-model-would-be-removed': 'Change the saved writer or character preference before removing that model.',
  'model-switch-in-progress': 'Another model change is in progress. Try again shortly.',
  'pending-generation-missing': 'Save the custom OpenAI URL and key again before refreshing.',
  'no-active-world': 'Load a world before refreshing model connections.',
  'discovery-failed': 'The model endpoint could not be read. Check its URL and try again.',
  cancelled: 'The refresh was cancelled safely.',
  'unsafe-config-file': 'The model catalog configuration files are not safe to update.',
};
interface AiRoutes { chat: { deepseek: AiPath; openai: AiPath }; tts: AiPath; stt: AiPath; image: AiPath; signedIn: boolean }
const PATH_LABEL: Record<AiPath, string> = {
  own: 'Your own key',
  local: 'Local voice server',
  account: 'Your Worldlines account (ai.worldlines.gg)',
  service: 'Worldlines AI service',
  none: 'Not available: add a key or sign in',
};

/** One row of the connection self-test. */
interface ConnectionCheck {
  id: string;
  label: string;
  status: 'ok' | 'failed' | 'skipped';
  ms: number;
  detail: string;
}
interface ConnectionConfig extends Record<string, unknown> {
  officialOpenAI?: { configured?: boolean; available?: boolean };
  customOpenAI?: { activeModelCount?: number; activeConfigured?: boolean; pendingConfigured?: boolean };
}

export function ConnectionSettings({ onSaved }: { onSaved: () => void }) {
  const { t } = useLocale();
  const [config, setConfig] = useState<ConnectionConfig>({});
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [statusKey, setStatusKey] = useState<StatusKey | null>(null);
  const [statusValues, setStatusValues] = useState<Record<string, string | number>>({});
  const [available, setAvailable] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshingCatalog, setRefreshingCatalog] = useState(false);
  const [testing, setTesting] = useState(false);
  const [checks, setChecks] = useState<ConnectionCheck[] | null>(null);
  const [testError, setTestError] = useState(false);
  const [routes, setRoutes] = useState<AiRoutes | null>(null);
  const runTests = async () => {
    setTesting(true);
    setTestError(false);
    try {
      const res = await fetch('/api/connection-settings/test', { method: 'POST', headers: { 'X-AIRP-Settings': '1' } });
      if (!res.ok) throw new Error('test-failed');
      setChecks((await res.json()).checks);
    } catch {
      setTestError(true);
    } finally {
      setTesting(false);
    }
  };
  const statusLabel = (status: ConnectionCheck['status']) => status === 'ok' ? t('OK') : status === 'failed' ? t('Failed') : t('Skipped');
  const refresh = async () => {
    const res = await fetch('/api/connection-settings', { cache: 'no-store' });
    if (!res.ok) throw new Error('local-only');
    setConfig(await res.json());
    setAvailable(true);
    const paths = await fetch('/api/connection-settings/routes', { cache: 'no-store' }).catch(() => null);
    setRoutes(paths?.ok ? await paths.json() as AiRoutes : null);
  };
  useEffect(() => {
    void refresh().catch(() => setStatusKey('Open this page on localhost to configure server connections.'));
  }, []);
  const save = async () => {
    setSaving(true);
    setStatusKey(null);
    try {
      const res = await fetch('/api/connection-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-AIRP-Settings': '1' },
        body: JSON.stringify(draft),
      });
      if (!res.ok) throw new Error('save-failed');
      setDraft({});
      await refresh();
      onSaved();
      setStatusKey('Connections saved. TTS applies immediately; refresh OpenAI-compatible models to activate the pending connection.');
    } catch {
      setStatusKey('Could not save connections. Check the service URLs and server permissions.');
    } finally {
      setSaving(false);
    }
  };
  const refreshCatalog = async () => {
    setRefreshingCatalog(true);
    setStatusValues({});
    setStatusKey(null);
    try {
      const response = await fetch('/api/connection-settings/refresh-openai', {
        method: 'POST', headers: { 'X-AIRP-Settings': '1' },
      });
      let result = await response.json() as { status?: string; count?: number; error?: string };
      while (result.status === 'discovering' || result.status === 'waiting' || result.status === 'activating') {
        setStatusKey(result.status === 'discovering'
          ? 'OpenAI model catalog discovery is in progress.'
          : result.status === 'waiting'
            ? 'OpenAI model catalog refresh is waiting for agents to become idle.'
            : 'OpenAI model catalog is activating.');
        await new Promise(resolve => setTimeout(resolve, 1000));
        const state = await fetch('/api/connection-settings/refresh-openai', { cache: 'no-store' });
        result = await state.json() as { status?: string; count?: number; error?: string };
        if (!state.ok) throw new Error('refresh-status-failed');
      }
      if (response.ok && result.status === 'success') {
        setStatusKey('OpenAI model catalog refreshed: {count} models are available.');
        setStatusValues({ count: result.count ?? 0 });
        await refresh();
        onSaved();
      } else if (result.status === 'cancelled') {
        setStatusKey('OpenAI model catalog refresh was cancelled.');
      } else {
        setStatusKey('OpenAI model catalog refresh failed: {reason}');
        setStatusValues({ reason: t(REFRESH_ERROR_COPY[result.error ?? ''] ?? 'The model catalog refresh could not be started.') });
      }
    } catch {
      setStatusKey('OpenAI model catalog refresh failed: {reason}');
      setStatusValues({ reason: t('The model catalog refresh could not be started.') });
    } finally { setRefreshingCatalog(false); }
  };
  const cancelCatalogRefresh = async () => {
    try {
      const response = await fetch('/api/connection-settings/refresh-openai/cancel', {
        method: 'POST', headers: { 'X-AIRP-Settings': '1' },
      });
      const result = await response.json() as { status?: string };
      if (response.ok && result.status === 'cancelled') setStatusKey('OpenAI model catalog refresh was cancelled.');
    } catch {
      setStatusKey('OpenAI model catalog refresh failed: {reason}');
      setStatusValues({ reason: t('The model catalog refresh could not be started.') });
    }
  };
  // Brand names stay as-is; the two descriptive service names are localized.
  const serviceName = (label: string) => label === 'OpenAI-compatible' ? t('OpenAI-compatible') : label === 'OpenAI official' ? t('OpenAI official') : label === 'Flow media proxy' ? t('Flow media proxy') : label;
  return <section style={{ marginTop: 24 }}>
    <h3>{t('Server connections')}</h3>
    <p>{t('Keys stay on this server in .env.local. Blank key fields keep their current values. Flow configures media generation, not the writer model.')}</p>
    <p>{t('DeepSeek V4.1 Flash uses https://api.deepseek.com with model deepseek-flash. Save, restart existing agents, then select deepseek / deepseek-flash in Agents → Model.')}</p>
    {routes && <section aria-labelledby="ai-routes-heading" style={{ margin: '12px 0' }}>
      <h4 id="ai-routes-heading" style={{ margin: '0 0 6px' }}>{t('Where each capability goes')}</h4>
      <p style={{ margin: '0 0 8px' }}>{t('Your own keys come first. Without one, a signed-in Worldlines account is used and billed to it.')}</p>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <tbody>
          {([
            ['Writer and characters (DeepSeek)', routes.chat.deepseek],
            ['OpenAI models', routes.chat.openai],
            ['Character voice', routes.tts],
            ['Voice input', routes.stt],
            ['Pictures', routes.image],
          ] as const).map(([label, path]) => <tr key={label} data-path={path} style={{ borderTop: '1px solid var(--ux-color-line)' }}>
            <td style={{ padding: '6px 8px 6px 0' }}>{t(label)}</td>
            <td style={{ padding: '6px 0', color: path === 'none' ? 'var(--ux-color-rust)' : 'var(--ux-color-muted)' }}>{t(PATH_LABEL[path])}</td>
          </tr>)}
        </tbody>
      </table>
    </section>}
    {available && services.map(([label, key, url]) => <fieldset key={key} disabled={saving} style={{ margin: '16px 0', display: 'grid', gap: 8 }}>
      <legend>{serviceName(label)}</legend>
      {label === 'OpenAI-compatible' && <p>{t('The custom OpenAI URL and key must be saved together as one pending pair.')}</p>}
      {url && <label>{t('Service URL')}<input aria-label={t('{service} service URL', { service: serviceName(label) })} type="url" value={draft[url] ?? String(config[url] ?? '')} onChange={e => setDraft(d => ({ ...d, [url]: e.target.value }))} style={{ display: 'block', width: '100%', color: '#272321', background: '#f5efdf', padding: 8 }} /></label>}
      <label>{t('API key')} · {config[key] ? t('Configured') : t('Not configured')}<input aria-label={t('{service} API key', { service: serviceName(label) })} type="password" autoComplete="new-password" spellCheck={false} value={draft[key] ?? ''} placeholder={label === 'OpenAI-compatible' ? t('Enter the custom endpoint URL and key together when changing them.') : t('Leave blank to keep the current key')} onChange={e => setDraft(d => ({ ...d, [key]: e.target.value }))} style={{ display: 'block', width: '100%', color: '#272321', background: '#f5efdf', padding: 8 }} /></label>
    </fieldset>)}
    {available && <button disabled={saving} onClick={() => void save()}>{saving ? t('Saving…') : t('Save connections')}</button>}
    {available && <section style={{ marginTop: 14 }}>
      <p>{t('Official OpenAI model: {configured}', { configured: config.officialOpenAI?.configured ? t('Configured') : t('Not configured') })}</p>
      <p>{t('Custom OpenAI catalog: {count} models · {state}', { count: config.customOpenAI?.activeModelCount ?? 0, state: config.customOpenAI?.activeConfigured ? t('Active') : t('Not active') })}</p>
      <button disabled={saving || refreshingCatalog || !config.customOpenAI?.pendingConfigured} onClick={() => void refreshCatalog()}>
        {refreshingCatalog ? t('Refreshing model catalog…') : t('Refresh OpenAI-compatible models')}
      </button>
      {refreshingCatalog && <button disabled={saving} onClick={() => void cancelCatalogRefresh()}>{t('Cancel model catalog refresh')}</button>}
    </section>}
    <p role="status">{statusKey ? t(statusKey, statusValues) : ''}</p>
    {available && <section style={{ marginTop: 16 }}>
      <h4 style={{ margin: '0 0 6px' }}>{t('Connection test')}</h4>
      <p style={{ margin: '0 0 8px' }}>{t('Sends one tiny request to every configured service: the writer and character models, TTS, voice input and GPT Live. Takes up to 25 seconds.')}</p>
      <button disabled={testing || saving} onClick={() => void runTests()}>{testing ? t('Testing…') : t('Test connections')}</button>
      {testError && <p role="alert">{t('The test could not run. Open this page on localhost and check that the server is up.')}</p>}
      {checks && <table style={{ marginTop: 10, width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <tbody>
          {checks.map(check => <tr key={check.id} data-status={check.status} style={{ borderTop: '1px solid var(--ux-color-line)' }}>
            <td style={{ padding: '6px 8px 6px 0', whiteSpace: 'nowrap' }}>{check.label}</td>
            <td style={{ padding: '6px 8px', whiteSpace: 'nowrap', fontWeight: 600, color: check.status === 'failed' ? 'var(--ux-color-rust)' : check.status === 'ok' ? 'var(--ux-color-sage)' : 'var(--ux-color-muted)' }}>
              {statusLabel(check.status)}{check.ms > 0 ? ` · ${(check.ms / 1000).toFixed(1)}s` : ''}
            </td>
            <td style={{ padding: '6px 0', overflowWrap: 'anywhere', color: 'var(--ux-color-muted)' }}>{check.detail}</td>
          </tr>)}
        </tbody>
      </table>}
    </section>}
  </section>;
}
