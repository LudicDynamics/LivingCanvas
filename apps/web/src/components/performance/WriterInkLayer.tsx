/**
 * WriterInkLayer.tsx — the chalk lane's wet-ink shell.
 *
 * `ChalkMark` renders ONE `kind:'chalk'` phantom's CONTENT. It is NOT
 * self-mounting: the single `usePhantoms()` renderer is
 * `canvas/PhantomLayer.tsx` (owner 03), which owns the world-space shell
 * (absolute seat position, z-index) and dispatches here. A chalk phantom lives
 * OUTSIDE `items` on purpose — at `chalk_writing` no file exists yet
 *.
 *
 * Confirmed text uses the final card's typography immediately. Do not reparse
 * the whole Markdown document every 24ms to animate individual characters:
 * that also produces a growing, inaccurately seated provisional footprint.
 */
import React, { useEffect } from 'react';
import { drop, type PhantomEntry } from '../../lib/phantom.js';
import { MarkdownText } from '../../lib/md.js';

/** Fade-out budget after a failed chalk: ~320ms then the node is gone
 *. */
const EVICT_FADE_MS = 320;


export interface ChalkMarkProps {
  entry: PhantomEntry;
}

/**
 * Wet-ink content: a `.chalk .chalk--bare .chalk--ghost` shell with an ink-tip
 * while the paper is still blank and a `.ink-spread` dry-down once landed.
 * Rendered translucent — it is a promise, not a card.
 * Positioning is the caller's job (`PhantomLayer`).
 */
export const ChalkMark: React.FC<ChalkMarkProps> = ({ entry }) => {
  const { phase } = entry;
  const text = entry.text ?? '';
  const evicted = phase === 'evicted';
  const landed = phase === 'landed';
  const ink = phase === 'pending' || phase === 'writing';

  // A failed chalk must leave no half-written ghost on the canvas: hold the
  // faded node for the exit animation, then retire it from the registry.
  useEffect(() => {
    if (!evicted) return;
    const t = window.setTimeout(() => drop(entry.toolCallId), EVICT_FADE_MS);
    return () => window.clearTimeout(t);
  }, [evicted, entry.toolCallId]);

  const classes = ['chalk', 'chalk--bare', 'chalk--ghost'];
  if (landed) classes.push('ink-spread');
  if (evicted) classes.push('ghost--evicting');

  return (
    <div className={classes.join(' ')} style={{ '--chalk-size': '26px' } as React.CSSProperties} data-phase={phase} aria-hidden>
      {text.length > 0 ? (
        <MarkdownText text={text} className="chalk__body" />
      ) : null}
      {ink && text.length === 0 ? <span className="ink-tip" /> : null}
    </div>
  );
};
