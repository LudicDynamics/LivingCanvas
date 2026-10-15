import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocale } from '../../lib/i18n.js';
import { markTaught } from '../../lib/tutorial-cues.js';
import { placeGuideBubble, type GuideRect } from '../../lib/guide-placement.js';
import { avoidRects } from '../../lib/drawer-layout.js';
import type { TutorialCueId } from '@airp/shared/tutorial-cues';
import './onboarding-guide.css';

/**
 * TutorialCueCard — the teach-once cards.
 *
 * The engine marks a first-time TRPG moment (`cue` on an action's result); lib/tutorial-cues.ts decides it
 * was not taught yet and announces `airp:tutorial-cue` ({ id, title, body }). This card shows it with the
 * SAME bubble and the SAME placement as the onboarding guide and the first-run tutorial — beside the thing
 * it is about, clear of the drawer / the writer / a dialogue stage — but without a dim: it never blocks
 * play. One at a time; it waits while the first-run tutorial is on screen. 「知道了」 marks it taught.
 */

interface Cue { id: TutorialCueId; title: string; body: string }

/** What each cue is about, in preference order; the first visible one anchors the card. */
export const CUE_ANCHORS: Readonly<Record<TutorialCueId, readonly string[]>> = Object.freeze({
  // The player's own 「技能」 button: skills and the inspiration roll live behind it.
  'first-inspiration': ['[data-testid="inspiration-roll"]', '[data-avatar-skills="player"]', '.prototype-player-orb'],
  'first-skill': ['[data-avatar-skills="player"]', '.prototype-player-orb'],
  'first-follow': ['.character-rail__orb--following', '.character-rail__orb'],
  'first-passive': [".message-drawer[data-open='true'] .message-drawer__panel", '.message-drawer__peek'],
});

const BUBBLE_WIDTH = 268;

function visibleBox(selectors: readonly string[]): { box: GuideRect; node: Element } | null {
  for (const selector of selectors) {
    const node = document.querySelector<HTMLElement>(selector);
    if (!node) continue;
    const r = node.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || r.bottom <= 0 || r.top >= window.innerHeight) continue;
    return { box: { top: r.top, left: r.left, width: r.width, height: r.height }, node };
  }
  return null;
}

export function TutorialCueCard(): React.ReactElement | null {
  const { t } = useLocale();
  const [queue, setQueue] = useState<Cue[]>([]);
  const [anchor, setAnchor] = useState<{ box: GuideRect; node: Element } | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [height, setHeight] = useState(120);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const cue = queue[0] ?? null;

  useEffect(() => {
    const onCue = (event: Event) => {
      const d = (event as CustomEvent<Partial<Cue>>).detail;
      if (!d || typeof d.id !== 'string' || typeof d.title !== 'string' || typeof d.body !== 'string') return;
      const next = { id: d.id as TutorialCueId, title: d.title, body: d.body };
      setQueue((q) => (q.some((c) => c.id === next.id) ? q : [...q, next]));
    };
    window.addEventListener('airp:tutorial-cue', onCue);
    return () => window.removeEventListener('airp:tutorial-cue', onCue);
  }, []);

  // Follow the anchor (panels slide, the drawer rises) and wait out the first-run tutorial.
  useEffect(() => {
    if (!cue) return;
    let frame = 0;
    let count = 0;
    const tick = () => {
      if (count++ % 4 === 0) {
        setBlocked(document.querySelector('.forced-tutorial') !== null);
        const found = visibleBox(CUE_ANCHORS[cue.id] ?? []);
        setAnchor((prev) => (prev && found && Math.abs(prev.box.top - found.box.top) < 0.5 && Math.abs(prev.box.left - found.box.left) < 0.5
          && Math.abs(prev.box.width - found.box.width) < 0.5 && Math.abs(prev.box.height - found.box.height) < 0.5 ? prev : found));
      }
      frame = window.requestAnimationFrame(tick);
    };
    tick();
    return () => window.cancelAnimationFrame(frame);
  }, [cue]);

  // The natural height (the guide's own measure): the capped box would feed the cap back into the placement.
  useLayoutEffect(() => {
    const bubble = bubbleRef.current;
    const scroll = scrollRef.current;
    if (!bubble || !scroll) return;
    const h = bubble.offsetHeight - scroll.clientHeight + scroll.scrollHeight;
    if (h > 0 && Math.abs(h - height) >= 1) setHeight(h);
  });

  // One pointer on screen at a time: while a card shows, the four-step guide steps back (onboarding-guide.css).
  const showing = cue !== null && !blocked;
  useEffect(() => {
    const root = document.documentElement;
    if (showing) root.setAttribute('data-tutorial-cue', '');
    else root.removeAttribute('data-tutorial-cue');
    return () => root.removeAttribute('data-tutorial-cue');
  }, [showing]);

  if (!cue || blocked) return null;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // No anchor on screen: low centre, above the bottom panels.
  const box: GuideRect = anchor?.box ?? { top: vh - 120, left: vw / 2 - 1, width: 2, height: 2 };
  const place = placeGuideBubble({
    box,
    viewport: { width: vw, height: vh },
    bubble: { width: BUBBLE_WIDTH, height },
    gap: 14,
    margin: 12,
    avoid: avoidRects(anchor?.node ?? null),
  });
  const done = () => {
    markTaught(cue.id);
    setQueue((q) => q.slice(1));
  };
  return (
    <div className="onboarding-guide tutorial-cue" data-cue={cue.id} aria-live="polite">
      {anchor && (
        <div
          className="tutorial-cue__ring"
          aria-hidden="true"
          style={{ top: Math.round(box.top - 4), left: Math.round(box.left - 4), width: Math.round(box.width + 8), height: Math.round(box.height + 8) }}
        />
      )}
      <div
        ref={bubbleRef}
        className="onboarding-guide__bubble tutorial-cue__bubble"
        data-side={place.side}
        role="status"
        style={{ top: Math.round(place.top), left: Math.round(place.left), width: Math.round(place.width), maxHeight: Math.floor(place.maxHeight) }}
      >
        <div ref={scrollRef} className="onboarding-guide__scroll">
          <p className="tutorial-cue__title">{cue.title}</p>
          <p className="tutorial-cue__body">{cue.body}</p>
        </div>
        <button type="button" className="tutorial-cue__ok" data-testid="tutorial-cue-ok" onClick={done}>{t('Got it')}</button>
      </div>
    </div>
  );
}
