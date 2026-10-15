import React, { useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PerformancePreset, PerformanceSettings as PerformanceSettingsState } from '../lib/performance-settings.js';
import type { FocusCoordinator, FocusSurfaceLease } from '../lib/focus-coordinator.js';
import { isFrameProbeEnabled, setFrameProbeEnabled } from '../lib/frame-probe.js';
import { useLocale } from '../lib/i18n.js';
import { setAmbientLife, useAmbientLife } from '../lib/ambient/settings.js';
import './performance-settings.css';

export type PerformanceSettingsVariant = 'header' | 'launcher';

export function PerformanceSettingsTrigger(props: {
  variant: PerformanceSettingsVariant;
  open: boolean;
  onOpen: (trigger: HTMLButtonElement) => void;
}): React.ReactElement {
  const { t } = useLocale();
  return (
    <button
      type="button"
      className={`performance-settings-trigger performance-settings-trigger--${props.variant}${props.variant === 'launcher' ? ' world-launcher__pill' : ''}`}
      aria-haspopup="dialog"
      aria-expanded={props.open}
      onClick={event => props.onOpen(event.currentTarget)}
    >
      {t('Performance settings')}
    </button>
  );
}

const FOCUSABLE = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'summary',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

type EditableSetting = Partial<Omit<PerformanceSettingsState, 'preset'>>;

export function PerformanceSettings(props: {
  settings: PerformanceSettingsState;
  setPerformancePreset: (preset: Exclude<PerformancePreset, 'custom'>) => void;
  updatePerformanceSettings: (patch: EditableSetting) => void;
  open: boolean;
  onClose: () => void;
  focus: FocusCoordinator;
  returnFocusRef: React.RefObject<HTMLElement | null>;
}): React.ReactElement | null {
  const { t } = useLocale();
  const generatedId = useId().replace(/:/g, '');
  const id = `performance-settings-${generatedId}`;
  const panelRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const leaseRef = useRef<FocusSurfaceLease | null>(null);
  const closeHandler = useRef(props.onClose);
  const returnTarget = useRef<HTMLElement | null>(null);
  closeHandler.current = props.onClose;
  // The checkbox mirrors the probe store; the HUD's Stop button also toggles
  // it, so the panel re-syncs whenever it re-renders (portal re-opens). Hooks
  // MUST stay above the `props.open` early return below.
  const [frameProbeOn, setFrameProbeOn] = useState(() => isFrameProbeEnabled());
  // 「世界小动作」: its own browser key (lib/ambient/settings.ts), not a performance field.
  const ambientLife = useAmbientLife();

  useLayoutEffect(() => {
    if (!props.open || !panelRef.current) return;
    const returnFocus = {
      capture() {
        returnTarget.current = props.returnFocusRef.current;
      },
      restore() {
        const target = returnTarget.current;
        if (!target || !target.isConnected || target.getClientRects().length === 0) return false;
        if (target.closest('[inert], [aria-hidden="true"]')) return false;
        target.focus();
        return document.activeElement === target;
      },
    };
    const lease = props.focus.registerSurface({
      key: 'performance-settings',
      owner: 'workspace',
      priority: 520,
      root: panelRef.current,
      close: () => closeHandler.current(),
      returnFocus,
    });
    leaseRef.current = lease;
    titleRef.current?.focus();
    return () => {
      if (leaseRef.current === lease) leaseRef.current = null;
      lease.unregister();
      queueMicrotask(() => returnFocus.restore());
    };
  }, [props.open, props.focus, props.returnFocusRef]);

  if (!props.open || typeof document === 'undefined') return null;

  const requestClose = () => {
    const lease = leaseRef.current;
    if (lease && !lease.markClosing()) return;
    closeHandler.current();
  };

  const focusTrap = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;
    const panel = panelRef.current;
    if (!panel) return;
    const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((element) => {
      if (element.getClientRects().length === 0 || element.closest('[inert]')) return false;
      const closedDetails = element.closest('details:not([open])');
      return closedDetails === null || (element.tagName === 'SUMMARY' && element.parentElement === closedDetails);
    });
    if (!items.length) {
      event.preventDefault();
      panel.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (!panel.contains(active) || active === titleRef.current) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && (active === first || active === panel)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || active === panel)) {
      event.preventDefault();
      first.focus();
    }
  };

  const profile = props.settings.preset === 'custom'
    ? t('Custom settings')
    : t(props.settings.preset === 'balanced' ? 'Balanced' : props.settings.preset === 'performance' ? 'Performance' : 'Quality');
  const update = <K extends keyof EditableSetting>(key: K, value: NonNullable<EditableSetting[K]>) => {
    props.updatePerformanceSettings({ [key]: value } as EditableSetting);
  };
  const syncFrameProbe = (on: boolean) => {
    setFrameProbeOn(on);
    setFrameProbeEnabled(on);
  };

  return createPortal(
    <div
      className="performance-settings-backdrop"
      onPointerDown={event => {
        event.stopPropagation();
        if (event.target === event.currentTarget) {
          event.preventDefault();
          requestClose();
        }
      }}
    >
      <section
        ref={panelRef}
        className="performance-settings-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        tabIndex={-1}
        onKeyDown={focusTrap}
      >
        <header className="performance-settings-panel__header">
          <div>
            <h2 ref={titleRef} id={`${id}-title`} tabIndex={-1}>{t('Performance settings')}</h2>
          </div>
          <button className="performance-settings-panel__close" type="button" onClick={requestClose}>{t('Close')}</button>
        </header>
        <div className="performance-settings-panel__scroll">
          <p className="performance-settings-panel__scope">{t('These settings belong to this browser, not a world save. They apply across worlds.')}</p>
          <p className="performance-settings-panel__immediate">{t('Changes take effect immediately.')}</p>
          <fieldset className="performance-settings-panel__profiles">
            <legend>{t('Performance profile')}</legend>
            <div className="performance-settings-panel__profile-grid">
              {(['balanced', 'performance', 'quality'] as const).map(preset => {
                const label = t(preset === 'balanced' ? 'Balanced' : preset === 'performance' ? 'Performance' : 'Quality');
                const description = t(preset === 'balanced'
                  ? 'Balanced — ambient effects on, kept light: fewer particles, no parallax, still portraits until you point at one, world-card videos on hover.'
                  : preset === 'performance'
                    ? 'Performance — reduces decoration to keep the experience light.'
                    : 'Quality — everything at full: all particles, parallax, every portrait video, world-card videos autoplay; system motion preferences still apply.');
                return (
                  <button
                    key={preset}
                    type="button"
                    className="performance-settings-panel__profile"
                    aria-pressed={props.settings.preset === preset}
                    onClick={() => props.setPerformancePreset(preset)}
                  >
                    <span className="performance-settings-panel__profile-name">{label}</span>
                    <span className="performance-settings-panel__profile-description">{description}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>
          <p className="performance-settings-panel__status" role="status">{t('Current profile: {profile}', { profile })}</p>
          <label className="performance-settings-panel__check performance-settings-panel__ambient">
            <span>
              {t('World life')}
              <small>{t('Characters idle on the canvas: pointers, little gestures and short lines. Only for show; talk to them for real answers.')}</small>
            </span>
            <input type="checkbox" checked={ambientLife} onChange={event => setAmbientLife(event.currentTarget.checked)} />
          </label>
          <details className="performance-settings-panel__details">
            <summary>{t('Adjust individual settings')}</summary>
            <div className="performance-settings-panel__controls">
              <label className="performance-settings-panel__check">
                <span>{t('Ambient effects')}</span>
                <input type="checkbox" checked={props.settings.effectsEnabled} onChange={event => update('effectsEnabled', event.currentTarget.checked)} />
              </label>
              <label className="performance-settings-panel__control">
                <span>{t('Particle density')}</span>
                <select value={props.settings.particleDensity} onChange={event => update('particleDensity', event.currentTarget.value as PerformanceSettingsState['particleDensity'])}>
                  <option value="full">{t('Standard · 48 particles')}</option>
                  <option value="reduced">{t('Reduced · 16 particles')}</option>
                </select>
              </label>
              <label className="performance-settings-panel__check">
                <span>{t('Parallax')}</span>
                <input type="checkbox" checked={props.settings.parallax} onChange={event => update('parallax', event.currentTarget.checked)} />
              </label>
              <label className="performance-settings-panel__control">
                <span>{t('Portrait videos')}</span>
                <select value={props.settings.avatarMotion} onChange={event => update('avatarMotion', event.currentTarget.value as PerformanceSettingsState['avatarMotion'])}>
                  <option value="all">{t('Scene focus plays')}</option>
                  <option value="focused">{t('Only the one you point at')}</option>
                </select>
              </label>
              <label className="performance-settings-panel__control">
                <span>{t('World card videos')}</span>
                <select value={props.settings.launcherVideo} onChange={event => update('launcherVideo', event.currentTarget.value as PerformanceSettingsState['launcherVideo'])}>
                  <option value="autoplay">{t('Autoplay')}</option>
                  <option value="hover">{t('On hover')}</option>
                </select>
              </label>
              <label className="performance-settings-panel__control">
                <span>{t('Shadows')}</span>
                <select value={props.settings.shadowQuality} onChange={event => update('shadowQuality', event.currentTarget.value as PerformanceSettingsState['shadowQuality'])}>
                  <option value="full">{t('Full')}</option><option value="reduced">{t('Reduced')}</option><option value="off">{t('Off')}</option>
                </select>
              </label>
              <label className="performance-settings-panel__control">
                <span>{t('Glass blur')}</span>
                <select value={props.settings.backdropBlur} onChange={event => update('backdropBlur', event.currentTarget.value as PerformanceSettingsState['backdropBlur'])}>
                  <option value="full">{t('Full')}</option><option value="reduced">{t('Reduced')}</option><option value="off">{t('Off')}</option>
                </select>
              </label>
              <label className="performance-settings-panel__check">
                <span>{t('Canvas grain')}</span>
                <input type="checkbox" checked={props.settings.canvasGrain} onChange={event => update('canvasGrain', event.currentTarget.checked)} />
              </label>
              <label className="performance-settings-panel__control">
                <span>{t('Dice rendering')}</span>
                <select value={props.settings.diceRendering} onChange={event => update('diceRendering', event.currentTarget.value as PerformanceSettingsState['diceRendering'])}>
                  <option value="3d">{t('3D dice')}</option><option value="numeric">{t('Numbers only')}</option>
                </select>
              </label>
              <label className="performance-settings-panel__check">
                <span>{t('Frame diagnostics (developer)')}</span>
                <input type="checkbox" checked={frameProbeOn} onChange={event => syncFrameProbe(event.currentTarget.checked)} />
              </label>
            </div>
          </details>
          <p className="performance-settings-panel__storage">{t('If browser storage is unavailable, these settings remain active only in this tab and reset when you reload or close it.')}</p>
        </div>
      </section>
    </div>,
    document.body,
  );
}
