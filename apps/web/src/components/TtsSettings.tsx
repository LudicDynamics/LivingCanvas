import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { ConnectionSettings } from './ConnectionSettings.js';
import { browserDeployment, browserModeSetting, setBrowserModeSetting } from '../lib/browser-mode.js';
import { RemoteSettings } from './RemoteSettings.js';
import { NanamiTtsSettings } from './NanamiTtsSettings.js';
import { LocalKeySettings } from './chrome/LocalKeySettings.js';
import { getChannelVolume, setChannelVolume, type VolumeChannel } from '../lib/audio.js';
import { useLocale } from '../lib/i18n.js';
import { isStageBusy, subscribeStageBusy } from '../lib/milestones.js';
import { toggleCharacterVoice } from './chrome/VoiceToggle.js';
import { localTtsFeature, readTtsConfig, setTtsEnabled, setTtsLocalExperiment, ttsEnabled, ttsLocalExperiment, type TtsConfig } from '../lib/tts-readiness.js';
import type { FocusCoordinator, FocusSurfaceLease } from '../lib/focus-coordinator.js';

const clampPercent = (value: number): number => (
  Number.isNaN(value) ? 0 : Math.min(100, Math.max(0, Math.round(value)))
);

const volumeToPercent = (value: number): number => (
  Number.isNaN(value) ? 100 : Math.round(Math.min(1, Math.max(0, value)) * 100)
);

function readVolume(channel: VolumeChannel): number {
  try {
    return volumeToPercent(getChannelVolume(channel));
  } catch {
    // A broken audio binding must not prevent text settings from opening.
    return 100;
  }
}

function readVolumes(): Record<VolumeChannel, number> {
  return { music: readVolume('music'), voice: readVolume('voice') };
}

export function TtsSettings({ focus }: { focus?: FocusCoordinator } = {}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState(false);
  // A scene card on screen: the voice notice waits (kept, not dropped) and shows after it.
  const stageBusy = useSyncExternalStore(subscribeStageBusy, isStageBusy, () => false);
  const panelRef = useRef<HTMLElement | null>(null);
  const leaseRef = useRef<FocusSurfaceLease | null>(null);
  const setOpenState = (next: boolean): void => setOpen(next);
  useEffect(() => {
    if (!open || !focus) return;
    let previous: HTMLElement | null = null;
    let restored = false;
    const lease = focus.registerSurface({
      key: 'tts-settings',
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
  const openSettings = () => setOpenState(true);
  const requestClose = () => {
    const lease = leaseRef.current;
    if (lease && !lease.markClosing()) return;
    setOpenState(false);
  };
  useEffect(() => {
    const warn = () => setNotice(true);
    window.addEventListener('airp:tts-unavailable', warn);
    return () => window.removeEventListener('airp:tts-unavailable', warn);
  }, []);
  // No model key / account / gateway (the server refused a prompt at once): say so, with the way to fix it.
  const [modelNotice, setModelNotice] = useState(false);
  useEffect(() => {
    const warn = () => setModelNotice(true);
    window.addEventListener('airp:model-unavailable', warn);
    return () => window.removeEventListener('airp:model-unavailable', warn);
  }, []);
  return <>
    <button type="button" onClick={openSettings}>{t('Voice & connections')}</button>
    {notice && !open && !stageBusy && createPortal(<aside className="tts-notice" role="status">
      {t('Voice is unavailable. Check voice settings; text dialogue still works.')}
      <button type="button" onClick={() => { setNotice(false); openSettings(); }}>{t('Settings')}</button>
      <button type="button" aria-label={t('Dismiss voice notice')} onClick={() => setNotice(false)}>×</button>
    </aside>, document.body)}
    {modelNotice && !open && createPortal(<aside className="tts-notice" role="alert" data-notice="no-model">
      {t('No model is set up yet. Add a model API key in Settings to talk to the characters.')}
      <button type="button" onClick={() => { setModelNotice(false); openSettings(); }}>{t('Open model settings')}</button>
      <button type="button" aria-label={t('Dismiss')} onClick={() => setModelNotice(false)}>×</button>
    </aside>, document.body)}
    {open && createPortal(<div className="prototype-dialog-backdrop" onClick={requestClose}>
      <section ref={panelRef} className="prototype-world-picker settings-panel" role="dialog" aria-modal="true" aria-label={t('Voice settings')} data-focus-owner="workspace" onClick={e => e.stopPropagation()}>
        <button type="button" onClick={requestClose} aria-label={t('Close voice settings')} autoFocus>{t('Close')}</button>
        <h2>{t('Character voice')}</h2>
        <VoiceSettingsBody onOpenAccount={requestClose} />
      </section>
    </div>, document.body)}
  </>;
}

/**
 * The voice / connection settings themselves (levels, character voice, Nanami, DashScope, the browser-version key
 * switch, browser mode, remote). Drawn in the 「语音与连接」 dialog above and in the account popup's 设置 tab
 * (components/account/AccountDialog.tsx), so there is ONE copy of them.
 */
export function VoiceSettingsBody({ onOpenAccount }: { onOpenAccount?: () => void }) {
  const { t } = useLocale();
  const [enabled, setEnabled] = useState(ttsEnabled);
  // The in-play VoiceToggle flips the same switch; keep this checkbox in step.
  useEffect(() => {
    const sync = (): void => setEnabled(ttsEnabled());
    window.addEventListener('airp:prefs-changed', sync);
    return () => window.removeEventListener('airp:prefs-changed', sync);
  }, []);
  const [localVoice, setLocalVoice] = useState(ttsLocalExperiment);
  const [localTtsOn] = useState(localTtsFeature);
  const [config, setConfig] = useState<TtsConfig | null>(null);
  // Studio voice settings are hidden unless local TTS is on (this browser's toggle or the server's AIRP_LOCAL_TTS).
  const showLocalTts = localTtsOn || config?.localTts === true;
  const [error, setError] = useState('');
  const [volumes, setVolumes] = useState<Record<VolumeChannel, number>>(readVolumes);
  const refresh = async () => {
    try { setConfig(await readTtsConfig(true)); setError(''); }
    catch { setError(t('Voice service is unavailable. Text dialogue still works.')); }
  };
  const onVolumeInput = (channel: VolumeChannel, rawValue: string) => {
    const percent = clampPercent(Number(rawValue));
    setVolumes(previous => ({ ...previous, [channel]: percent }));
    setChannelVolume(channel, percent / 100);
  };
  useEffect(() => { void refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <>
    <fieldset aria-labelledby="audio-levels-heading">
      <legend id="audio-levels-heading">{t('Audio levels')}</legend>
      <div className="settings-volume">
        <span><label htmlFor="music-volume">{t('Music volume')}</label><output id="music-volume-value" htmlFor="music-volume">{t('{value}%', { value: volumes.music })}</output></span>
        <input id="music-volume" type="range" role="slider" min="0" max="100" step="1" value={volumes.music} aria-valuemin={0} aria-valuemax={100} aria-valuenow={volumes.music} aria-describedby="music-volume-value" onChange={e => onVolumeInput('music', e.currentTarget.value)} />
      </div>
      <div className="settings-volume">
        <span><label htmlFor="voice-volume">{t('Voice volume')}</label><output id="voice-volume-value" htmlFor="voice-volume">{t('{value}%', { value: volumes.voice })}</output></span>
        <input id="voice-volume" type="range" role="slider" min="0" max="100" step="1" value={volumes.voice} aria-valuemin={0} aria-valuemax={100} aria-valuenow={volumes.voice} aria-describedby="voice-volume-value" onChange={e => onVolumeInput('voice', e.currentTarget.value)} />
      </div>
    </fieldset>
    <label><input type="checkbox" checked={enabled} onChange={e => { setEnabled(e.target.checked); toggleCharacterVoice(e.target.checked); }} /> {t('Enable character voice on this browser')}</label>
    {!enabled && <p role="status">{t('Voice playback is off; text dialogue remains available.')}</p>}
    <p role="status">{error || (config ? config.configured ? t('Configured · availability is checked when speaking') : t('TTS is not configured. Text dialogue remains available.') : t('Checking configuration…'))}</p>
    {config && <><p>{t('Online model')}: {config.model}</p><p>{t('Online fallback voice')}: {config.defaultVoice} · {t('Characters may override it')}</p></>}
    {localTtsOn && config?.experimentalLocal && <label><input type="checkbox" checked={localVoice} onChange={e => { setLocalVoice(e.target.checked); setTtsLocalExperiment(e.target.checked); }} /> {t('Studio voice (experimental): some characters speak in a studio voice; when it fails, the online voice reads the line')}</label>}
    {config && !config.configured && <p>{showLocalTts ? t('Add a DashScope API key below, or configure Nanami local voice. Text dialogue remains available.') : t('Add a DashScope API key below. Text dialogue remains available.')}</p>}
    <button type="button" onClick={() => { void refresh(); }}>{t('Recheck voice configuration')}</button>
    {showLocalTts && <NanamiTtsSettings onSaved={() => { void refresh(); }} />}
    <ConnectionSettings onSaved={() => { void refresh(); }} />
    {/* Browser version: the same switch as the account panel (renders nothing elsewhere). */}
    <LocalKeySettings />
    {/* A static site (canvas.worldlines.gg) has no other mode: no toggle. */}
    {!browserDeployment.always && <BrowserModeToggle t={t} />}
    <RemoteSettings onOpenAccount={onOpenAccount} />
  </>;
}

/** 「浏览器模式（实验）」: run the server and agents inside this tab (lib/browser-mode.ts). Applies on reload. */
function BrowserModeToggle({ t }: { t: (key: string) => string }) {
  const [on, setOn] = useState(browserModeSetting);
  const changed = on !== (new URLSearchParams(window.location.search).get('mode') === 'browser' || !!(window as { __airpBrowserMode?: unknown }).__airpBrowserMode);
  return <fieldset>
    <legend>{t('Browser mode (experimental)')}</legend>
    <label><input type="checkbox" checked={on} onChange={e => { setOn(e.target.checked); setBrowserModeSetting(e.target.checked); }} /> {t('Run the story engine inside this browser tab')}</label>
    {changed && <button type="button" onClick={() => window.location.reload()}>{t('Reload to apply')}</button>}
  </fieldset>;
}
