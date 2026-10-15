/**
 * ViewModeSwitch — canvas ⇄ map, always in sight.
 *
 * It used to live in the canvas tools column, which is invisible until the
 * pointer finds the middle of the left edge — and in the companion layout
 * that edge belongs to the option rail. Nobody found it
 * So it is a two-segment switch at the top right, next to
 * the immersion toggle: both choices named, the current one lit.
 */
import React from 'react';
import { useLocale } from '../../lib/i18n.js';
import type { ViewMode } from '../../lib/view-mode.js';
import './view-mode-switch.css';

export function ViewModeSwitch({ mode, onChange }: { mode: ViewMode; onChange(mode: ViewMode): void }): React.ReactElement {
  const { t } = useLocale();
  const option = (value: ViewMode, label: string) => (
    <button
      type="button"
      className="view-mode-switch__option"
      aria-pressed={mode === value}
      onClick={() => { if (mode !== value) onChange(value); }}
    >
      {label}
    </button>
  );
  return (
    <div className="view-mode-switch prototype-chrome" role="group" aria-label={t('View')}>
      {option('canvas', t('Canvas'))}
      {option('map', t('Map'))}
    </div>
  );
}
