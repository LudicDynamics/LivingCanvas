import React, { useState } from 'react';
import { evict } from '../../lib/phantom.js';
import type { PhantomEntry } from '../../lib/phantom.js';
import { airpGateway } from '../../lib/airp-gateway.js';
import { stageText } from '../../lib/ghost.js';

/**
 * The image ghost: a shimmer skeleton while the picture is
 * being made (`phase === 'pending'`), the real picture once it lands —
 * **same seat**, only the shell's weight changes (`phase === 'landed'`) — and a
 * short visible exit when the projection is torn down or the tool failed
 * (`phase === 'evicted'`). Non-interactive: `doc-10 E3` says a ghost may not be
 * clicked or dragged, which the `.object--ghost` shell (pointer-events: none)
 * enforces.
 *
 * Owner: the design notes Rendered by `PhantomLayer`, never mounted on its own.
 */

/** Player-facing copy comes from `i18n` (AGENTS §1.1) — never hardcoded here. */
export interface GhostCopy {
  reused: string;
  failed: string;
  unreachable: string;
}

export const GhostCard: React.FC<{ entry: PhantomEntry; copy: GhostCopy }> = ({ entry, copy }) => {
  const { phase, seat } = entry;
  // A landed ghost leaves either because the live backdrop took over (silent,
  // correct) or because the asset 404'd (must be *visible* — the design notes
  // §7). The frame carries no failure reason, so the picture's own `onError` is
  // the only honest signal that distinguishes the two.
  const [broken, setBroken] = useState(false);
  const pending = phase === 'pending' || phase === 'writing';
  const landed = phase === 'landed';
  const evicted = phase === 'evicted';
  const imgSrc = entry.asset ? airpGateway.assetUrl(entry.asset, undefined, 'image') : null;

  // `useWorld` stores the already-formatted stage line in `label` (it calls
  // stageText when registering the progress frame). Re-running stageText over
  // it would treat "Painting… · 20s" as a raw stage and emit the fallback copy,
  // so formatting is applied here only as a fallback when no label arrived.
  const line =
    entry.label && entry.label.length > 0 ? entry.label : stageText(undefined, entry.elapsedMs);

  const cls = landed ? 'ghost-card--landed' : evicted ? 'ghost-card--evicted' : 'ghost-card--pending';
  // Failure copy: a broken image, or a ghost torn down before it ever landed.
  const failText = broken || !entry.asset ? (broken ? copy.unreachable : copy.failed) : null;

  return (
    <div className={`ghost-card ${cls}`} style={{ height: seat.h }}>
      {pending && (
        <>
          <div className="ghost-card__skeleton" />
          <div className="ghost-card__stage">{line}</div>
        </>
      )}

      {landed && !broken && imgSrc && (
        <img
          className="ghost-card__img"
          src={imgSrc}
          alt=""
          onError={() => {
            setBroken(true);
            evict(entry.toolCallId);
          }}
        />
      )}
      {landed && (broken || !imgSrc) && <div className="ghost-card__stage">{broken ? copy.unreachable : line}</div>}

      {evicted && failText && <div className="ghost-card__stage">{failText}</div>}

      {landed && entry.reused === true && (
        <span className="ghost-card__badge">{copy.reused}</span>
      )}
    </div>
  );
};
