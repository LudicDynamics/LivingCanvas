import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { usePhantoms, evict, drop } from '../../lib/phantom.js';
import type { PhantomEntry } from '../../lib/phantom.js';
import { ghostVisibleOn, LANDED_DWELL_MS, REUSED_DWELL_MS } from '../../lib/ghost.js';
import { GhostCard } from '../narrative/GhostCard.js';
import type { GhostCopy } from '../narrative/GhostCard.js';
import { ChalkMark } from '../performance/WriterInkLayer.js';
import { CardSkeleton } from '../narrative/CardSkeleton.js';

/**
 * The ONE mount point for provisional cards.
 *
 * A phantom is a **projection**: it appears the instant the engine announces it
 * and must vanish the instant the data-driven render takes over, or re-entering
 * a layer resurrects it (the "encore" accident, doc-06 §2.2). Both lanes share
 * this layer and the one registry (`lib/phantom.ts`): image ghosts become
 * `<GhostCard>`, chalk wet-ink becomes `<ChalkMark>` (owned by 01, which never
 * mounts itself — two `useSyncExternalStore` readers would fight over order).
 *
 * Ghost shells sit inside `Canvas`'s world transform layer, so `left/top` are
 * world pixels, exactly like `.object`. They are never clickable or draggable
 * (doc-10 E3), enforced by `.object--ghost { pointer-events: none }`.
 *
 * Owner: the design notes
 */
export interface PhantomLayerProps {
  currentLayer: string;
  /** The layer's live backdrop src — the signal that a landed image ghost's
   * projection may leave. */
  bgSrc: string | null;
  /** Player-facing ghost copy (i18n). */
  copy: GhostCopy;
}

/** Window an evicted ghost stays in the DOM (fading) before deregistration.
 *  Matches the `.ghost-card--evicted` opacity transition in index.css. */
const EVICT_FADE_MS = 700;
/** A skeleton's failure exit: a one-shot shell with no asset behind it, so it
 *  borrows the chalk lane's budget (WriterInkLayer's 320ms). Must match the
 *  `.card-skeleton--evicted` animation in index.css. */
const SKELETON_EVICT_MS = 320;

export const PhantomLayer: React.FC<PhantomLayerProps> = ({ currentLayer, bgSrc, copy }) => {
  const phantoms = usePhantoms();

  // Exit discipline (03 §3.3), image lane only: the chalk lane retires its own
  // ghost (WriterInkLayer, owner 01 — 320ms fade), so a second timer here would
  // fight it. A landed image ghost leaves when the layer's live backdrop IS its
  // asset (the real refetch won), or after a dwell when the writer never writes
  // `bg:`. Evicted image ghosts are deregistered once faded, so the registry
  // drains (browser criterion #1: "最终为空").
  useEffect(() => {
    const timers: number[] = [];
    const now = Date.now();
    for (const p of phantoms) {
      // Evicted phantoms deregister after their fade so the registry drains
      // (browser criterion #1: "最终为空"). Image and component each own a
      // budget; chalk retires its own ghost (WriterInkLayer, owner 01), so a
      // second timer here would fight it.
      if (p.phase === 'evicted') {
        const budget =
          p.kind === 'component' ? SKELETON_EVICT_MS : p.kind === 'image' ? EVICT_FADE_MS : undefined;
        if (budget !== undefined) timers.push(window.setTimeout(() => drop(p.toolCallId), budget));
        continue;
      }
      // Landed-dwell applies to the image lane only: a landed image ghost
      // leaves when the layer's live backdrop IS its asset (the real refetch
      // won), or after a dwell when the writer never writes `bg:`.
      if (p.kind !== 'image') continue;
      if (p.phase !== 'landed') continue;
      if (p.asset !== undefined && p.asset === bgSrc) {
        evict(p.toolCallId);
        continue;
      }
      const dwell = p.reused === true ? REUSED_DWELL_MS : LANDED_DWELL_MS;
      timers.push(
        window.setTimeout(() => evict(p.toolCallId), Math.max(0, p.createdAt + dwell - now))
      );
    }
    return () => {
      for (const t of timers) window.clearTimeout(t);
    };
  }, [phantoms, bgSrc]);

  const visible = phantoms.filter((p) => ghostVisibleOn(p.layer, currentLayer));
  if (visible.length === 0) return null;

  return (
    <>
      {visible.map((p: PhantomEntry) => (
        <div
          key={p.toolCallId}
          data-path={`phantom:${p.toolCallId}`}
          className="object--ghost"
          style={{ left: p.seat.x, top: p.seat.y, width: p.seat.w, zIndex: p.seat.z }}
          aria-hidden
        >
          {p.kind === 'component' ? (
            <CardSkeleton entry={p} />
          ) : p.kind === 'image' ? (
            <GhostCard entry={p} copy={copy} />
          ) : (
            <ChalkMark entry={p} />
          )}
        </div>
      ))}
    </>
  );
};
