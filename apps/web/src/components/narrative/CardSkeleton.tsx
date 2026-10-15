import React from 'react';
import type { PhantomEntry } from '../../lib/phantom.js';
import { skeletonShapeFor } from '../../lib/card-skeleton.js';

/**
 * The one renderer for `kind:'component'` phantoms.
 *
 * A component card is born from a writer `write`; the front end registers a
 * `component` phantom the moment the server announces it, and this component
 * sketches a *structure-only* skeleton — grey bars plus a material vocabulary
 * per chrome tier — until the real card lands. It shows NO text (the design notes
 * 00 §2.3), is never clickable/draggable (the `.object--ghost` shell enforces
 * that), and never enters `items` / drag / footprint (00 §6.4).
 *
 * Zero state, zero effects, zero timers, zero DOM reads: death is data-driven
 * (`land` → `reconcileLanded` in `useWorld`), and the single owner of the evict
 * timer is `PhantomLayer`. The breathing is one CSS keyframe (AGENTS §7.6).
 *
 * Owner: the design notes
 */
export interface CardSkeletonProps {
  entry: PhantomEntry;
}
/** Renders the entry's skeleton, or nothing when the tier is `bare`. */
export const CardSkeleton: React.FC<CardSkeletonProps> = ({ entry }) => {
  const shape = skeletonShapeFor(entry.cardKind);
  // `bare` (chalk / sprite / portrait) draws nothing — defence in depth: the
  // registering side already rejects it.
  if (!shape.visible) return null;
  const chrome = shape.chrome;
  const phaseCls =
    entry.phase === 'landed' ? 'landed' : entry.phase === 'evicted' ? 'evicted' : 'writing';
  return (
    <div
      className={`card-skeleton card-skeleton--${chrome} card-skeleton--${phaseCls}`}
      data-card-kind={entry.cardKind}
      data-card-chrome={chrome}
      data-phase={entry.phase}
      style={{ height: entry.seat.h }}
      aria-hidden
    >
      {shape.decor.band && <span className="card-skeleton__band" />}
      {shape.decor.clip && <span className="card-skeleton__clip" />}
      {shape.decor.block && <span className="card-skeleton__block" />}
      {shape.decor.edges && (
        <>
          <span className="card-skeleton__edge card-skeleton__edge--top" />
          <span className="card-skeleton__edge card-skeleton__edge--bottom" />
        </>
      )}
      {shape.lines.length > 0 && (
        <div className="card-skeleton__lines">
          {shape.lines.map((l, i) => (
            <span key={i} className="card-skeleton__line" style={{ width: `${l.w}%`, height: l.h }} />
          ))}
        </div>
      )}
      {shape.decor.seal && <span className="card-skeleton__seal" />}
    </div>
  );
};
