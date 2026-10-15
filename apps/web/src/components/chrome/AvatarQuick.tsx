import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Activity, Sparkle } from 'lucide-react';
import { useLocale } from '../../lib/i18n.js';
import { placeGuideBubble, type GuideRect } from '../../lib/guide-placement.js';
import { avoidRects } from '../../lib/drawer-layout.js';
import './avatar-quick.css';

/**
 * 「状态」「技能」 beside every avatar: the skills used to sit three levels down
 * (avatar → player panel → character sheet), and an avatar does not say that it can be pressed. Two small,
 * always-visible buttons — icon + a short word — on the player's own avatar and on each companion with the
 * player (following, or on this page). One press opens the panel; one level.
 *
 * The panel uses the pointer bubbles' placement (lib/guide-placement.ts): beside the button, clear of the
 * drawer, the writer sheet and a dialogue stage.
 */
export type QuickTab = 'state' | 'skills';

export interface AvatarQuickProps {
  /** `player` or a character id. */
  who: string;
  name: string;
  hasState: boolean;
  hasSkills: boolean;
  /** The tab open for THIS avatar, or null. */
  open: QuickTab | null;
  onOpen(tab: QuickTab | null): void;
  variant: 'player' | 'companion';
}

export function AvatarQuick({ who, name, hasState, hasSkills, open, onOpen, variant }: AvatarQuickProps): React.ReactElement | null {
  const { t } = useLocale();
  if (!hasState && !hasSkills) return null;
  const button = (tab: QuickTab, label: string, icon: React.ReactNode) => (
    <button
      type="button"
      className="avatar-quick__button"
      data-avatar-tab={tab}
      // The teach-once cards and tests find these by who and tab.
      {...(tab === 'skills' ? { 'data-avatar-skills': who } : { 'data-avatar-state': who })}
      aria-expanded={open === tab}
      aria-label={`${name} · ${label}`}
      title={`${name} · ${label}`}
      onClick={(event) => { event.stopPropagation(); onOpen(open === tab ? null : tab); }}
    >
      <span className="avatar-quick__icon" aria-hidden="true">{icon}</span>
      <span className="avatar-quick__word">{label}</span>
    </button>
  );
  return (
    <div className={`avatar-quick avatar-quick--${variant}`} data-avatar-quick={who} role="group" aria-label={name}>
      {hasState && button('state', t('Status'), <Activity size={13} />)}
      {hasSkills && button('skills', t('Skills'), <Sparkle size={13} />)}
    </div>
  );
}

const PANEL_WIDTH = 320;

/** The one-level panel the buttons open, placed beside the button that opened it. */
export function AvatarSheetPanel({ who, tab, title, onClose, children }: {
  who: string;
  tab: QuickTab;
  title: string;
  onClose(): void;
  children: React.ReactNode;
}): React.ReactElement {
  const { t } = useLocale();
  const ref = useRef<HTMLElement | null>(null);
  const [box, setBox] = useState<GuideRect | null>(null);
  const [height, setHeight] = useState(240);
  const selector = tab === 'skills' ? `[data-avatar-skills="${CSS.escape(who)}"]` : `[data-avatar-state="${CSS.escape(who)}"]`;

  // Follow the button (the rail scrolls, the drawer rises).
  useEffect(() => {
    let frame = 0;
    let count = 0;
    const tick = () => {
      if (count++ % 4 === 0) {
        const node = document.querySelector(selector);
        const r = node?.getBoundingClientRect();
        const next = r && r.width > 0 ? { top: r.top, left: r.left, width: r.width, height: r.height } : null;
        setBox((prev) => (prev && next && Math.abs(prev.top - next.top) < 0.5 && Math.abs(prev.left - next.left) < 0.5 ? prev : next));
      }
      frame = window.requestAnimationFrame(tick);
    };
    tick();
    return () => window.cancelAnimationFrame(frame);
  }, [selector]);

  useLayoutEffect(() => {
    const h = ref.current?.scrollHeight ?? 0;
    if (h > 0 && Math.abs(h - height) >= 1) setHeight(h);
  });

  // Escape and a press elsewhere close it (its own buttons toggle).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } };
    const onDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!target || ref.current?.contains(target) || target.closest('[data-avatar-quick]') || target.closest('[role="dialog"]')) return;
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown, true);
    return () => { window.removeEventListener('keydown', onKey, true); document.removeEventListener('pointerdown', onDown, true); };
  }, [onClose]);

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const place = placeGuideBubble({
    box: box ?? { top: vh / 2, left: vw / 2, width: 1, height: 1 },
    viewport: { width: vw, height: vh },
    bubble: { width: PANEL_WIDTH, height },
    gap: 10,
    margin: 12,
    avoid: avoidRects(null),
  });
  return (
    <section
      ref={ref}
      className="avatar-sheet"
      data-testid="avatar-sheet"
      data-avatar-sheet={who}
      data-tab={tab}
      aria-label={title}
      style={{ top: Math.round(place.top), left: Math.round(place.left), width: Math.round(place.width), maxHeight: Math.floor(place.maxHeight) }}
    >
      <header className="avatar-sheet__head">
        <b>{title}</b>
        <button type="button" className="avatar-sheet__close" aria-label={t('Close')} title={t('Close')} onClick={onClose}>×</button>
      </header>
      <div className="avatar-sheet__body">{children}</div>
    </section>
  );
}
