import { useEffect, useRef, useState } from 'react';
import type { FocusCoordinator, FocusSurfaceLease } from '../lib/focus-coordinator.js';
import type { AutoWrite, WorldSettings } from '@airp/shared/world-settings';
import { useWriterState } from '../lib/writer-state.js';
import { useLocale } from '../lib/i18n.js';
import { refreshTick } from '../lib/tick/store.js';
import { agentSettingsPollDelay } from '../lib/agent-settings-poll.js';
type Model = { provider: string; id: string; name?: string };
type Status = { world: string; active: string[]; models: Model[]; officialOpenAI?: { configured: boolean; available: boolean }; writer: { model: Model | null; thinking: string }; characters: { id: string; model: Model | null; thinking: string }[]; preferences: Partial<Record<'writer' | 'character', { provider: string; model: string; thinking: string }>> };
export function AgentSettings({ settings, onSaveSettings, focus, onReplayTutorial, characterTick, worldKey }: {
  settings: WorldSettings;
  /** The open save (null before any world is open: nothing to poll — the server would answer 409 no_active_world). */
  worldKey?: string | null;
  onSaveSettings: (next: WorldSettings) => Promise<void>;
  focus?: FocusCoordinator;
  /** Clear this save's first-act marker; omitted in `classic`, which has none. */
  onReplayTutorial?: () => void | Promise<void>;
  /** This world declares a character tick; `wip` = still being tuned. */
  characterTick?: { wip: boolean } | null;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLElement | null>(null);
  const leaseRef = useRef<FocusSurfaceLease | null>(null);
  const setOpenState = (next: boolean): void => setOpen(next);
  useEffect(() => {
    if (!open || !focus) return;
    let previous: HTMLElement | null = null;
    let restored = false;
    const lease = focus.registerSurface({
      key: 'agent-settings',
      owner: 'workspace',
      priority: 320,
      root: panelRef.current,
      close: () => setOpenState(false),
      returnFocus: {
        capture: () => {
          if (previous) return;
          const active = document.activeElement;
          if (active instanceof HTMLElement && active !== document.body) previous = active;
        },
        restore: () => {
          if (restored) return false;
          restored = true;
          if (previous && document.contains(previous)) {
            previous.focus();
            return true;
          }
          return false;
        },
      },
    });
    leaseRef.current = lease;
    return () => {
      if (leaseRef.current === lease) leaseRef.current = null;
      lease.unregister();
      window.requestAnimationFrame(() => {
        if (!restored && previous && document.contains(previous)) {
          restored = true;
          previous.focus();
        }
      });
    };
  }, [focus, open]);
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [role, setRole] = useState<'writer' | 'character'>('writer');
  const [model, setModel] = useState('');
  const [thinking, setThinking] = useState('low');
  // Polled only while a world is open, backing off on failures (lib/agent-settings-poll.ts).
  const worldOpen = worldKey !== null;
  useEffect(() => {
    let cancelled = false, timer: ReturnType<typeof setTimeout> | undefined, failures = 0;
    const poll = async () => {
      let noWorld = false;
      try {
        const response = await fetch(`/api/agent-settings${open ? '' : '?brief=true'}`); const data = await response.json();
        if (!response.ok) { noWorld = data?.code === 'no_active_world'; throw new Error(data.error); }
        failures = 0;
        if (!cancelled) {
          setStatus(data);
        }
      } catch (e) { failures++; if (!cancelled) { setStatus(null); if (!noWorld) setError(String(e)); } }
      const delay = agentSettingsPollDelay({ open, worldOpen, failures, noWorld });
      if (!cancelled && delay !== null) timer = setTimeout(poll, delay);
    };
    if (worldOpen) void poll(); else setStatus(null);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [open, worldOpen, worldKey]);
  const current = status?.preferences[role];
  const actual = role === 'writer' ? status?.writer : status?.characters[0];
  useEffect(() => {
    setModel(current ? `${current.provider}/${current.model}` : actual?.model ? `${actual.model.provider}/${actual.model.id}` : 'deepseek/deepseek-v4-flash');
    setThinking(current?.thinking ?? actual?.thinking ?? 'low');
  }, [role, current?.model, current?.provider, current?.thinking, actual?.model?.id, actual?.model?.provider, actual?.thinking]);
  const save = async () => {
    const choice = status?.models.find(m => `${m.provider}/${m.id}` === model); if (!choice) return;
    setSaving(true); setError('');
    try {
      const response = await fetch('/api/agent-settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role, provider: choice.provider, model: choice.id, thinking, world: status?.world }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error); setStatus(data);
    } catch (e) { setError(String(e)); } finally { setSaving(false); }
  };
  const writer = useWriterState();
  const writing = writer.phase === 'writing';
  const seconds = writer.startedAt ? Math.max(0, Math.floor((Date.now() - writer.startedAt) / 1000)) : 0;
  const visibleModels = (status?.models ?? []).filter(m => m.provider !== 'openai' && (m.provider !== 'airp-openai-official' || m.id === 'gpt-6-luna'));
  const summary = !status
    ? t('Connecting')
    : writer.error
      ? t('Attention')
      : writing
        ? t('{seconds}s', { seconds })
    : t('Ready');
  const displayModel = (candidate: Model | null | undefined) => candidate?.provider === 'airp-openai-official' ? t('GPT-6 Luna') : candidate?.id ?? t('Unknown');
  return <div className="agent-settings" data-focus-owner={open ? 'workspace' : undefined}>
    <button onClick={() => setOpenState(!open)} aria-expanded={open}>{t('Agents · {summary}', { summary })}</button>
    {open && <section ref={panelRef} className="agent-settings-panel" aria-label={t('Agent models and progress')}>
      <p role="status">
        {!status ? t('Connecting to the engine') : writing ? writer.stage ?? t('Preparing the response') : t('Ready for your next action')}
        {writer.stopRequested ? t(' · Stop requested') : ''}
      </p>
      <p>{t('Writer')}: {displayModel(status?.writer.model)} · {status?.writer.thinking ?? '—'}<br />{status?.characters.map(c => <span key={c.id}>{c.id}: {displayModel(c.model)} · {c.thinking}<br /></span>)}</p>
      {writing && <p>{t('{seconds}s elapsed · You can browse while waiting.', { seconds })}</p>}
      {writer.error && <p role="alert">{writer.error.message}</p>}
      <label>{t('Auto-write')}<select value={settings.autoWrite} onChange={e => void onSaveSettings({ autoWrite: e.target.value as AutoWrite })}><option value="off">{t('Off · the writer waits for you')}</option><option value="scenes">{t('Scenes · write unwritten scenes on entry')}</option><option value="scenes-and-choices">{t('Scenes + choices · also advance on each choice')}</option></select></label>
      <label><input type="checkbox" checked={settings.chatBeats !== false} onChange={e => void onSaveSettings({ ...settings, chatBeats: e.target.checked })} />{t('After a character chat, the writer may add what you learned')}</label>
      {characterTick && <label>{characterTick.wip ? `${t('Character turns')} · ${t('Work in progress')}` : t('Character turns')}<select value={settings.characterTick ?? 'standard'} onChange={e => void onSaveSettings({ ...settings, characterTick: e.target.value as 'off' | 'easy' | 'standard' }).then(() => refreshTick())}><option value="standard">{t('Standard · people on the page act every few moves')}</option><option value="easy">{t('Easy · one more move to react, fewer land')}</option><option value="off">{t('Off · people only answer you')}</option></select></label>}
      {characterTick && settings.characterTick !== 'off' && <label><input type="checkbox" checked={settings.characterVoices !== false} onChange={e => void onSaveSettings({ ...settings, characterVoices: e.target.checked }).then(() => refreshTick())} />{t('People speak for themselves (✎ their own words, a few credits per run)')}</label>}
      <label>{t('Agent')}<select value={role} onChange={e => setRole(e.target.value as typeof role)}><option value="writer">{t('Writer')}</option><option value="character">{t('Characters')}</option></select></label>
      <label>{t('Model')}<select value={model} onChange={e => setModel(e.target.value)}><option value="">{t('Choose a model')}</option>{visibleModels.map(m => {
        const official = m.provider === 'airp-openai-official';
        const provider = official ? t('OpenAI official') : m.provider === 'openai-compatible' ? t('OpenAI-compatible') : m.provider;
        const disabled = official && !status?.officialOpenAI?.available;
        const name = official ? t('GPT-6 Luna') : m.name || m.id;
        return <option key={`${m.provider}/${m.id}`} value={`${m.provider}/${m.id}`} disabled={disabled}>{provider} / {name}{disabled ? ` · ${t('Official OpenAI key not configured')}` : ''}</option>;
      })}</select></label>
      <label>{t('Reasoning')}<select value={thinking} onChange={e => setThinking(e.target.value)}><option value="off">{t('Off · fastest')}</option><option value="low">{t('Low')}</option><option value="medium">{t('Medium')}</option><option value="high">{t('High')}</option></select></label>
      <p>{t('Saved for this world save. Character memory is kept. Model availability does not guarantee account access.')}</p>
      <button disabled={saving || !status || writing || !model || (model.startsWith('airp-openai-official/') && !status.officialOpenAI?.available)} onClick={() => void save()}>{saving ? t('Applying…') : t('Apply model')}</button>
      {writing && <p>{t('Wait for the current turn before changing models.')}</p>}
      {/* The first act is per-SAVE, so its replay lives with
          the other per-save settings. Clearing the marker is the whole action:
          the opening runs again the next time this save reaches its entry. */}
      {onReplayTutorial && (
        <button onClick={() => void onReplayTutorial()}>{t('Replay the tutorial')}</button>
      )}
      {error && <p role="alert">{error}</p>}
    </section>}
  </div>;
}
