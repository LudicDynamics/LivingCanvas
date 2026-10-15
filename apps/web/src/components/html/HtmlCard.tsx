import React, { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { AppearanceView } from '../../lib/appearance-view.js';
import {
  htmlFrameAllowedSnapshot,
  reportCardFrame,
  subscribeHtmlBudget,
} from '../../lib/html-card-budget.js';
import { probeCount } from '../../lib/frame-probe.js';
import { HtmlMedia } from './HtmlMedia.js';
import { designWidthOf } from './html-design.js';
import { CARD_FORMS } from '@airp/shared/forms';

export interface HtmlCardProps {
  item: { path: string; filename: string; frontmatter: Record<string, any> | null; body: string };
  /** The painted width (`LayerItem.w`). The page scales to it. */
  w?: number;
  appearance?: AppearanceView | null;
  puzzleClasses?: string;
  /** The layer this card is seated in. Passed EXPLICITLY (`Canvas` → `CanvasObject`):
   *  reading a DOM attribute would be an untestable coupling whose meaning differs
   * between the canvas and nook paths. */
  layer: string;
  /** `item.z` — the SEAT order. The budget ranks by this, never by DOM order. */
  z: number;
  onDragOver?: React.DragEventHandler<HTMLElement>;
  onDragLeave?: React.DragEventHandler<HTMLElement>;
  onDrop?: React.DragEventHandler<HTMLElement>;
}

/** `useLayoutEffect` on the client, a no-op under the server renderer (React
 *  warns about the layout variant there, and there is no layout to time). */
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * A page card: the `panel` shell every skeleton tier already understands,
 * wrapping a lazy live thumbnail. Both gates that decide whether an iframe is
 * mounted at all live HERE — in the viewport (`IntersectionObserver`) and
 * inside the per-layer budget (`lib/html-card-budget.ts`).
 */
export function HtmlCard({
  item,
  w = CARD_FORMS.html.w,
  appearance,
  puzzleClasses = '',
  layer,
  z,
  onDragOver,
  onDragLeave,
  onDrop,
}: HtmlCardProps): React.ReactElement {
  const { frontmatter } = item;
  const title = typeof frontmatter?.title === 'string' && frontmatter.title.trim()
    ? frontmatter.title
    : item.filename;
  const preview = typeof frontmatter?.preview === 'string' ? frontmatter.preview : '';
  const viewportRef = useRef<HTMLDivElement>(null);
  // No `IntersectionObserver` (an absent capability, not an invisible card):
  // treat the card as visible so the budget alone governs — the same fallback
  // `CharacterMedia.tsx:71-77` uses.
  const [visible, setVisible] = useState(() => typeof IntersectionObserver !== 'function');

  useIsomorphicLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element || typeof IntersectionObserver !== 'function') return;
    // Camera motion re-targets every card's geometry each frame, so during a
    // zoom or pan the edge cards flip `isIntersecting` in bursts and each flip
    // re-renders this card and can churn the live-iframe budget. Lead with the
    // first flip (a still camera must settle instantly), then coalesce the
    // rest on a short trailing window.
    let timer: number | null = null;
    let pending: boolean | null = null;
    const apply = () => {
      if (pending === null) return;
      const next = pending;
      pending = null;
      setVisible(next);
    };
    const settle = () => {
      timer = window.setTimeout(() => {
        timer = null;
        apply();
      }, 250);
    };
    const observer = new IntersectionObserver(entries => {
      const next = entries[0]?.isIntersecting ?? false;
      if (pending === next) return;
      pending = next;
      probeCount('cardFlip');
      if (timer !== null) return; // inside the coalescing window: trail
      apply(); // lead: a still camera settles instantly
      settle();
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer ?? undefined);
    };
  }, []);

  // ONE registry, one reader (§3.4). Reporting and reading are separate effects
  // so a `visible` flip re-ranks without remounting the observer.
  useIsomorphicLayoutEffect(
    () => reportCardFrame({ id: item.path, layer, z, visible }),
    [item.path, layer, z, visible],
  );

  // The third argument is the server-render snapshot: without it React's SSR
  // renderer throws, and the registered set is empty before hydration anyway.
  // Every budget change re-renders EVERY subscriber. Probe the subscribe
  // callback (not getSnapshot — React calls that on every render): the count
  // reads "notifications received by this card", so divide by card count.
  // Stable reference: an inline arrow would resubscribe on every render.
  const subscribeBudget = useCallback((onStoreChange: () => void) => subscribeHtmlBudget(() => {
    probeCount('budgetNotify');
    onStoreChange();
  }), []);
  const allowed = useSyncExternalStore(subscribeBudget, htmlFrameAllowedSnapshot, htmlFrameAllowedSnapshot);
  const active = visible && allowed.has(item.path);

  return (
    <figure
      className={`html-card ${puzzleClasses}`.trim()}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      aria-label={title}
      {...appearance?.attrs}
      style={appearance?.style}
    >
      <div ref={viewportRef} className="html-card__face">
        <HtmlMedia
          path={item.path}
          title={title}
          preview={preview}
          designWidth={designWidthOf(frontmatter)}
          cardWidth={w}
          variant="card"
          active={active}
        />
      </div>
    </figure>
  );
}
