import React, { useEffect, useRef, useState } from 'react';
import {
  frameProbeLive,
  isFrameProbeEnabled,
  setFrameProbeEnabled,
  snapshotFrameProbe,
} from '../../lib/frame-probe.js';
import { useLocale } from '../../lib/i18n.js';
import './frame-probe.css';

/**
 * FrameProbeHud — the on-screen face of `lib/frame-probe.ts`. Developer tool:
 * rendered only while the probe toggle is on (see PerformanceSettings panel).
 * Shows live frame health and exports the full per-second log as JSON so a
 * stutter report on a real machine can be analysed offline.
 */
export function FrameProbeHud(): React.ReactElement | null {
  const { t } = useLocale();
  const [live, setLive] = useState(() => frameProbeLive());
  const anchorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setLive(frameProbeLive()), 1000);
    return () => window.clearInterval(id);
  }, []);

  if (!isFrameProbeEnabled()) return null;

  const exportLog = () => {
    const snapshot = snapshotFrameProbe();
    const blob = new Blob([JSON.stringify(snapshot, null, 1)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = anchorRef.current?.ownerDocument.createElement('a');
    if (!anchor) return;
    anchor.href = url;
    anchor.download = `airp-frame-probe-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  return (
    <div className="frame-probe" ref={anchorRef} role="status" aria-label={t('Frame diagnostics')}>
      <div className="frame-probe__row frame-probe__row--primary">
        <span className={live.fps >= 50 ? 'frame-probe__fps frame-probe__fps--ok' : 'frame-probe__fps frame-probe__fps--bad'}>{live.fps} fps</span>
        <span>worst {live.worstGap}ms</span>
      </div>
      <div className="frame-probe__row">
        <span>{t('Frames over 50ms')}: {live.over50Recent}</span>
      </div>
      <div className="frame-probe__row frame-probe__row--actions">
        <button type="button" className="frame-probe__button" onClick={exportLog}>{t('Export log')}</button>
        <button type="button" className="frame-probe__button" onClick={() => setFrameProbeEnabled(false)}>{t('Stop')}</button>
      </div>
    </div>
  );
}
