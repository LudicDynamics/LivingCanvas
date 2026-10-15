/**
 * Places one floating panel into the free slot (lib/floating-layout.ts) and
 * lets the player drag it by a handle, remembering the spot for this browser
 * session. Measuring happens on open, on window resize and when the panel's own
 * size changes — never inside the drag loop: the drag writes `left/top`
 * straight to the element and commits to React state once, on release
 * (the developer handbook: no high-frequency pointermove in React state, no layout reads
 * while dragging).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type React from 'react';
import {
  clampToViewport,
  isCompactViewport,
  overlapArea,
  placeFloatingFit,
  restorePosition,
  writerSheetSlots,
  type Obstacle,
  type Placement,
  type Rect,
  type Size,
} from './floating-layout.js';

const DRAG_THRESHOLD_PX = 4;

export interface ObstacleSpec { selector: string; soft?: boolean }

export interface FloatingPanel {
  /** Spread onto the panel. Hidden until the first placement so it never flashes in the old corner. */
  style: React.CSSProperties;
  /** Spread onto the grab handle. Presses on buttons inside the handle are left alone. */
  handleProps: { onPointerDown(e: React.PointerEvent<HTMLElement>): void };
  /** The player dragged it somewhere this session. */
  moved: boolean;
  /** Back to the automatic slot. */
  reset(): void;
  placement: Placement | null;
  /**
   * When the panel sits over a soft rail: the height that rail may keep so it
   * ends above the panel (it scrolls). Null when nothing needs to shrink.
   */
  railLimit: number | null;
  compact: boolean;
}

function readSaved(key: string): { x: number; y: number } | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && Number.isFinite(parsed.x) && Number.isFinite(parsed.y) ? parsed : null;
  } catch { return null; }
}
function writeSaved(key: string, value: { x: number; y: number } | null): void {
  try {
    if (value) window.sessionStorage.setItem(key, JSON.stringify(value));
    else window.sessionStorage.removeItem(key);
  } catch { /* not remembered */ }
}

/** The visual viewport: on a phone the software keyboard shrinks it, and the sheet must stay above the keyboard. */
function viewportSize(): Size {
  const vv = window.visualViewport;
  if (!vv) return { w: window.innerWidth, h: window.innerHeight };
  return { w: Math.min(window.innerWidth, vv.width + vv.offsetLeft), h: Math.min(window.innerHeight, vv.height + vv.offsetTop) };
}

function measureObstacles(specs: readonly ObstacleSpec[], panel: HTMLElement | null): Obstacle[] {
  const out: Obstacle[] = [];
  for (const spec of specs) {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(spec.selector))) {
      if (panel && (panel.contains(el) || el.contains(panel))) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const cs = window.getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      // A soft rail may already be shrunk above this panel: measure its natural
      // height, or the next layout would see no overlap and let it grow back.
      const h = spec.soft ? Math.max(r.height, el.scrollHeight) : r.height;
      out.push({ x: r.left, y: r.top, w: r.width, h, soft: spec.soft, name: spec.selector });
    }
  }
  return out;
}

export function useFloatingPanel(options: {
  open: boolean;
  panelRef: React.RefObject<HTMLElement | null>;
  anchorRef: React.RefObject<HTMLElement | null>;
  obstacles: readonly ObstacleSpec[];
  storageKey: string;
  /** Re-place when this changes (e.g. the tools menu opened and the panel grew). */
  layoutKey?: unknown;
}): FloatingPanel {
  const { open, panelRef, anchorRef, obstacles, storageKey, layoutKey } = options;
  const [rect, setRect] = useState<Rect | null>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [railLimit, setRailLimit] = useState<number | null>(null);
  const [moved, setMoved] = useState(() => readSaved(storageKey) !== null);
  const [compact, setCompact] = useState(() => typeof window !== 'undefined' && isCompactViewport(viewportSize()));
  const obstaclesRef = useRef(obstacles);
  obstaclesRef.current = obstacles;

  const layout = useCallback(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const viewport = viewportSize();
    setCompact(isCompactViewport(viewport));
    // Natural size first: a width this hook narrowed last time must not stick.
    panel.style.width = '';
    const size = { w: panel.offsetWidth, h: panel.offsetHeight };
    const saved = restorePosition(readSaved(storageKey), size, viewport);
    const anchorEl = anchorRef.current;
    const a = anchorEl?.getBoundingClientRect();
    const anchor: Rect = a ? { x: a.left, y: a.top, w: a.width, h: a.height } : { x: viewport.w - 80, y: viewport.h - 80, w: 56, h: 56 };
    const found = measureObstacles(obstaclesRef.current, panel);
    const auto = placeFloatingFit({ viewport, size, obstacles: found, slots: writerSheetSlots(viewport, anchor) });
    const placed = saved ?? auto;
    // Written here as well as through React: if the width did not change, React
    // sees an equal style and would not put back the width cleared above.
    panel.style.width = `${placed.w}px`;
    let limit: number | null = null;
    for (const o of found) {
      if (!o.soft || overlapArea(placed, o) === 0 || o.y >= placed.y) continue;
      const keep = Math.max(56, Math.floor(placed.y - o.y - 8));
      limit = limit === null ? keep : Math.min(limit, keep);
    }
    setRailLimit(limit);
    if (saved) {
      setRect(saved);
      setPlacement({ ...saved, slot: 'dragged', hard: 0, soft: 0 });
    } else {
      setRect(auto);
      setPlacement(auto);
    }
  }, [anchorRef, panelRef, storageKey]);

  useLayoutEffect(() => {
    if (!open) { setRect(null); setPlacement(null); setRailLimit(null); return; }
    layout();
  }, [open, layout, layoutKey]);

  useEffect(() => {
    if (!open) return;
    let frame = 0;
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(layout); };
    window.addEventListener('resize', schedule);
    window.addEventListener('orientationchange', schedule);
    window.visualViewport?.addEventListener('resize', schedule);
    // The writer button slides back to its corner when the companion stage
    // folds away (writer-fab.css margin transition): place again once it lands.
    const onTransitionEnd = (event: TransitionEvent) => {
      const anchor = anchorRef.current;
      if (anchor && event.target instanceof Node && event.target.contains(anchor)) schedule();
    };
    document.addEventListener('transitionend', onTransitionEnd, true);
    const panel = panelRef.current;
    const observer = typeof ResizeObserver !== 'undefined' && panel ? new ResizeObserver(schedule) : null;
    if (observer && panel) observer.observe(panel);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('orientationchange', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
      document.removeEventListener('transitionend', onTransitionEnd, true);
      observer?.disconnect();
    };
  }, [open, layout, panelRef, anchorRef]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button, input, textarea, select, a')) return;
    const panel = panelRef.current;
    if (!panel) return;
    // Measure once, at the press.
    const start = panel.getBoundingClientRect();
    const viewport = viewportSize();
    const size = { w: start.width, h: start.height };
    const startX = e.clientX;
    const startY = e.clientY;
    let moving = false;
    let last: Rect = { x: start.left, y: start.top, ...size };
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!moving && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      moving = true;
      last = clampToViewport({ x: start.left + dx, y: start.top + dy, ...size }, viewport);
      panel.style.left = `${last.x}px`;
      panel.style.top = `${last.y}px`;
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (!moving) return;
      writeSaved(storageKey, { x: last.x, y: last.y });
      setMoved(true);
      layout();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }, [layout, panelRef, storageKey]);

  const reset = useCallback(() => {
    writeSaved(storageKey, null);
    setMoved(false);
    layout();
  }, [layout, storageKey]);

  return {
    style: rect
      ? { position: 'fixed', left: rect.x, top: rect.y, right: 'auto', bottom: 'auto', width: rect.w }
      : { position: 'fixed', visibility: 'hidden', right: 8, bottom: 8 },
    handleProps: { onPointerDown },
    moved,
    reset,
    placement,
    railLimit,
    compact,
  };
}
