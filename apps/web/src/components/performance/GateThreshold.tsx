import { useEffect, useRef, useState } from 'react';
import type { GateFeedback } from '../../lib/gate-feedback.js';
import { useLocale } from '../../lib/i18n.js';
import type { FocusCoordinator, FocusSurfaceLease } from '../../lib/focus-coordinator.js';
import './gate-threshold.css';

// Local presentation only: no writer call, world event, item move or dice roll.
export function GateThreshold({ focus }: { focus?: FocusCoordinator }) {
  const { t } = useLocale();
  const [beat, setBeat] = useState<GateFeedback | null>(null);
  const rootRef = useRef<HTMLElement | null>(null);
  const leaseRef = useRef<FocusSurfaceLease | null>(null);
  const requestClose = () => {
    const lease = leaseRef.current;
    if (lease && !lease.markClosing()) return;
    setBeat(null);
  };
  useEffect(() => {
    const onBeat = (e: Event) => setBeat((e as CustomEvent<GateFeedback | null>).detail);
    window.addEventListener('airp:gate-feedback', onBeat);
    return () => window.removeEventListener('airp:gate-feedback', onBeat);
  }, []);
  useEffect(() => {
    if (!beat || !focus) return;
    let previous: HTMLElement | null = null;
    let restored = false;
    const lease = focus.registerSurface({
      key: 'gate-threshold',
      owner: 'workspace',
      priority: 300,
      root: rootRef.current,
      close: () => setBeat(null),
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
  }, [beat, focus]);
  useEffect(() => {
    if (!beat) return;
    const paths = new Set([`${beat.target}/README.md`, ...beat.items.map(i => i.path)]);
    const nodes = [...document.querySelectorAll<HTMLElement>('[data-path]')].filter(n => paths.has(n.dataset.path ?? ''));
    nodes.forEach(n => n.classList.add('threshold-cue'));
    return () => nodes.forEach(n => n.classList.remove('threshold-cue'));
  }, [beat]);
  if (!beat) return null;
  return <aside ref={rootRef} className="gate-threshold" aria-label={t('A moment in the scene')}>
    <div className="gate-threshold__ink" role="status" aria-live="polite">
      {beat.title && <div className="gate-threshold__place">{beat.title}</div>}
      <p>{beat.text || t('Not yet. There is still something to attend to before going on.')}</p>
      {beat.items.length > 0 && <p className="gate-threshold__items">{t('Look toward → ')}{beat.items.map(i => i.title).join(' · ')}</p>}
    </div>
    <button type="button" onClick={requestClose}>{t('Return to the scene')} <span aria-hidden="true">↩</span></button>
  </aside>;
}
