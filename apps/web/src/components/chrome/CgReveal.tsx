/**
 * CG reveal: the `show_cg` effect's picture,
 * full-screen, one at a time.
 *
 * - Opens on `airp:cg-shown` (`useWorld` dispatches it for a `cg_shown` world
 *   event once the dice ceremony has settled; the epilogue gallery dispatches a
 *   replay). Events replayed on reconnect are history and are not re-shown.
 * - Fades in once the picture has loaded; reduced motion shows it at once, and
 *   the performance settings decide how much the scene behind is blurred.
 * - Click anywhere, the close button, Enter/Space or Esc closes it; the next
 *   queued CG follows. Focus returns to where it was.
 * - Depth: `--depth-cg-reveal` — above the canvas, dock, dialogue and ending
 *   card, below the forced tutorial and the system notices over it.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { airpGateway } from '../../lib/airp-gateway.js';
import { useLocale } from '../../lib/i18n.js';
import { useStill } from '../../lib/motion.js';
import { usePerformanceSettings } from '../../lib/performance-settings.js';
import { rememberCg } from '../../lib/share-art.js';
import { CG_SHOWN_DOM, cgOf, cgPresentation, enqueueCg, type CgItem } from '../../lib/cg-reveal.js';
import { setPerforming } from '../../lib/stage-performance.js';
import './cg-reveal.css';

export function CgReveal(): React.ReactElement | null {
  const { t } = useLocale();
  const reducedMotion = useStill();
  const settings = usePerformanceSettings();
  const [queue, setQueue] = useState<CgItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const current = queue[0] ?? null;
  // A CG on screen is a performance: the forced tutorial waits for it.
  const showing = current !== null;
  useEffect(() => { setPerforming('cg', showing); }, [showing]);
  useEffect(() => () => setPerforming('cg', false), []);

  useEffect(() => {
    const onShown = (e: Event) => {
      const item = cgOf((e as CustomEvent).detail);
      if (item) setQueue((q) => enqueueCg(q, item));
    };
    window.addEventListener(CG_SHOWN_DOM, onShown);
    return () => window.removeEventListener(CG_SHOWN_DOM, onShown);
  }, []);

  // A new picture starts unloaded; focus moves into the reveal (and back after).
  useEffect(() => {
    setLoaded(false);
    setFailed(false);
    if (!current) return;
    if (!returnFocusRef.current && document.activeElement instanceof HTMLElement) {
      returnFocusRef.current = document.activeElement;
    }
    rootRef.current?.focus({ preventScroll: true });
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = useCallback(() => {
    setQueue((q) => {
      const rest = q.slice(1);
      if (rest.length === 0) {
        const back = returnFocusRef.current;
        returnFocusRef.current = null;
        if (back?.isConnected) queueMicrotask(() => back.focus({ preventScroll: true }));
      }
      return rest;
    });
  }, []);

  if (!current) return null;
  const { fadeMs, blur } = cgPresentation(reducedMotion, settings);
  const src = airpGateway.assetUrl(current.path, undefined, 'image');
  const label = current.caption ?? t('Scene');
  return (
    <div
      ref={rootRef}
      className="cg-reveal"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      tabIndex={-1}
      data-blur={blur}
      data-shown={loaded || failed ? 'true' : undefined}
      style={{ '--cg-fade-ms': `${fadeMs}ms` } as React.CSSProperties}
      onClick={close}
      onKeyDown={(e) => {
        if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          close();
        }
      }}
    >
      <figure className="cg-reveal__frame">
        {!failed ? (
          <img
            key={current.id}
            className="cg-reveal__image"
            src={src}
            alt={current.caption ?? ''}
            onLoad={(e) => {
              setLoaded(true);
              // kept for the share card (lib/share-art.ts): the latest CG this player unlocked
              void rememberCg(e.currentTarget, current.path, current.caption);
            }}
            onError={() => setFailed(true)}
            draggable={false}
          />
        ) : (
          <p className="cg-reveal__missing">{t('This picture could not be loaded.')}</p>
        )}
        {current.caption && <figcaption className="cg-reveal__caption">{current.caption}</figcaption>}
      </figure>
      <button
        type="button"
        className="cg-reveal__close"
        onClick={(e) => { e.stopPropagation(); close(); }}
        aria-label={t('Close')}
      >
        {queue.length > 1 ? t('Next') : t('Continue')}
      </button>
    </div>
  );
}
