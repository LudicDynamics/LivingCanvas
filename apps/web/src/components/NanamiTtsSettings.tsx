import { useEffect, useState, type FormEvent } from 'react';
import { useLocale } from '../lib/i18n.js';
import {
  buildNanamiTtsPayload,
  NanamiSettingsValidationError,
  timeoutSecondsFromConfig,
  type NanamiTtsDraft,
  type NanamiValidationKey,
} from '../lib/nanami-tts-settings.js';

type StatusKey = NanamiValidationKey
  | 'Open this page on localhost to manage Nanami local voice.'
  | 'Could not save Nanami local voice settings.'
  | 'Nanami local voice settings saved. New dialogue uses them immediately.';

export function NanamiTtsSettings({ onSaved }: { onSaved: () => void }) {
  const { t } = useLocale();
  const [config, setConfig] = useState<Record<string, string | boolean>>({});
  const [draft, setDraft] = useState<NanamiTtsDraft>({});
  const [available, setAvailable] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusKey, setStatusKey] = useState<StatusKey | null>(null);
  const [characterId, setCharacterId] = useState('vera');
  const [characterVoice, setCharacterVoice] = useState('setsuna');
  const [characters, setCharacters] = useState<Array<{ id: string; name?: string }>>([]);
  const mappings = draft.characterVoices ?? String(config.AIRP_TTS_CHARACTER_VOICES ?? '');
  const assignVoice = () => {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(characterId) || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(characterVoice)) {
      setStatusKey('Voice ID must use letters, numbers, underscores, or hyphens.'); return;
    }
    const pairs = mappings.split(',').filter(Boolean).filter(pair => pair.split('=')[0] !== characterId);
    setDraft(previous => ({ ...previous, characterVoices: [...pairs, `${characterId}=${characterVoice}`].join(',') }));
  };

  const refresh = async () => {
    const response = await fetch('/api/connection-settings', { cache: 'no-store' });
    if (!response.ok) throw new Error('local-only');
    setConfig(await response.json());
    setAvailable(true);
  };
  useEffect(() => {
    void refresh().catch(() => setStatusKey('Open this page on localhost to manage Nanami local voice.'));
    void fetch('/api/characters').then(response => response.ok ? response.json() : null)
      .then(data => { if (Array.isArray(data?.characters)) setCharacters(data.characters); }).catch(() => {});
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setStatusKey(null);
    let payload: Record<string, string>;
    try {
      payload = buildNanamiTtsPayload(draft);
    } catch (error) {
      if (error instanceof NanamiSettingsValidationError) setStatusKey(error.key);
      else setStatusKey('Could not save Nanami local voice settings.');
      return;
    }
    setSaving(true);
    try {
      const response = await fetch('/api/connection-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-AIRP-Settings': '1' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error('save-failed');
      setDraft({});
      await refresh();
      onSaved();
      setStatusKey('Nanami local voice settings saved. New dialogue uses them immediately.');
    } catch {
      setStatusKey('Could not save Nanami local voice settings.');
    } finally {
      setSaving(false);
    }
  };

  const value = (field: keyof NanamiTtsDraft, key: string, fallback: string) =>
    draft[field] ?? String(config[key] ?? fallback);

  return <section className="nanami-tts-settings">
    <h3>{t('Local character voices')}</h3>
    <p>{t('Female voices default to Nanami. Character overrides apply across worlds; online keeps the original voice.')}</p>
    {available && <form onSubmit={event => void submit(event)}>
      <fieldset disabled={saving}>
        <legend>{t('Local TTS service')}</legend>
        <label>{t('Base URL')}
          <input aria-label={t('Nanami local TTS base URL')} type="url" placeholder="http://your-tts-host:8090" value={value('baseUrl', 'AIRP_TTS_LOCAL_BASE_URL', '')} onChange={event => setDraft(previous => ({ ...previous, baseUrl: event.target.value }))} />
        </label>
        <p>{t('Enter the service base URL without /v1/tts. Clear it and save to disable local voice.')}</p>
        <label>{t('Voice ID')}
          <input aria-label={t('Nanami local voice ID')} type="text" maxLength={64} pattern="[A-Za-z0-9][A-Za-z0-9_-]{0,63}" spellCheck={false} value={value('voice', 'AIRP_TTS_LOCAL_VOICE', 'setsuna')} onChange={event => setDraft(previous => ({ ...previous, voice: event.target.value }))} />
        </label>
        <label>{t('Character ID')}
          <input list="local-tts-character-ids" value={characterId} onChange={event => setCharacterId(event.target.value)} />
          <datalist id="local-tts-character-ids">{characters.map(character => <option key={character.id} value={character.id}>{character.name ?? character.id}</option>)}</datalist>
        </label>
        <label>{t('Character voice ID')}
          <input value={characterVoice} onChange={event => setCharacterVoice(event.target.value)} placeholder="setsuna" />
        </label>
        <button type="button" onClick={assignVoice}>{t('Add character override')}</button>
        <p>{t('Only voice IDs installed on the local service can be used. Save below to apply.')}</p>
        {mappings.split(',').filter(Boolean).map(pair => <div key={pair}>
          <code>{pair}</code> <button type="button" onClick={() => setDraft(previous => ({ ...previous, characterVoices: mappings.split(',').filter(p => p !== pair).join(',') }))}>{t('Use default')}</button>
        </div>)}
        <label>{t('Timeout (seconds)')}
          <input aria-label={t('Nanami local TTS timeout in seconds')} type="number" min="1" max="120" step="0.001" value={draft.timeoutSeconds ?? timeoutSecondsFromConfig(config.AIRP_TTS_LOCAL_TIMEOUT_MS)} onChange={event => setDraft(previous => ({ ...previous, timeoutSeconds: event.target.value }))} />
        </label>
        <label>{t('API key (optional)')} · {t(config.AIRP_TTS_LOCAL_API_KEY ? 'Configured' : 'Not configured')}
          <input aria-label={t('Nanami local TTS API key')} type="password" autoComplete="new-password" spellCheck={false} value={draft.apiKey ?? ''} placeholder={t('Leave blank to keep the current key')} onChange={event => setDraft(previous => ({ ...previous, apiKey: event.target.value }))} />
        </label>
      </fieldset>
      <button type="submit" disabled={saving || Object.keys(draft).length === 0}>{t(saving ? 'Saving…' : 'Save character voices')}</button>
    </form>}
    <p role="status">{statusKey ? t(statusKey) : ''}</p>
  </section>;
}
