import { useSyncExternalStore } from 'react';
import { useLocale } from '../../lib/i18n.js';
import { downloadLabel, phaseHeadline, worldLoadPhase, worldLoadStore } from '../../lib/world-load-progress.js';
import './world-loading.css';

/**
 * While a world opens (App.tsx `loadWorld`): a glass card over everything with a progress bar while the browser
 * build downloads the world's files (「已下载 12 / 114 · 3.1 / 8.0 MB」) and a spinner for the waits nobody can
 * measure — the request going out, the server making the save, entering the first scene (lib/world-load-progress.ts).
 * The headline is the live region (it changes once per phase); the numbers ride the progressbar's aria-valuetext.
 */
export function WorldLoading() {
  const { t } = useLocale();
  const state = useSyncExternalStore(worldLoadStore.subscribe, worldLoadStore.get, worldLoadStore.get);
  const phase = worldLoadPhase(state);
  const headline = phaseHeadline(phase, t);
  const detail = phase.kind === 'download' ? downloadLabel(phase, t) : null;
  return (
    <div className="world-loading" data-testid="world-loading" data-phase={phase.kind} aria-busy="true">
      <div className="world-loading__card">
        {phase.kind === 'download' ? (
          <div
            className="world-loading__bar"
            role="progressbar"
            aria-label={t('World download')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={phase.percent}
            aria-valuetext={detail ?? undefined}
          >
            <span className="world-loading__fill" style={{ width: `${phase.percent}%` }} />
          </div>
        ) : (
          <span className="world-loading__spinner" role="progressbar" aria-label={headline} />
        )}
        <p className="world-loading__headline" role="status" aria-live="polite">{headline}</p>
        {detail && <p className="world-loading__detail" aria-hidden="true">{detail}</p>}
      </div>
    </div>
  );
}
