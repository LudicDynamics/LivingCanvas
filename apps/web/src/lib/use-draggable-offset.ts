/**
 * A chrome control the player can drag out of the way
 *
 *
 * The control keeps its CSS home position; the drag is an offset on top of it,
 * remembered per browser. A press that moves less than `DRAG_THRESHOLD_PX` is
 * still a click — the bag button opens the bag as before — and the offset is
 * clamped so the control can never be dragged off screen.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

const DRAG_THRESHOLD_PX = 6;
/** How much of the control must stay on screen, in px. */
const KEEP_VISIBLE_PX = 40;

interface Offset { x: number; y: number }

function readOffset(key: string): Offset {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) return { x: parsed.x, y: parsed.y };
  } catch {
    /* storage blocked or malformed: start at home */
  }
  return { x: 0, y: 0 };
}

export interface DraggableOffset {
  /** Spread onto the element that moves. `translate`, not `transform`: chrome panels animate `transform` in and out, and would erase the offset. */
  style: { translate?: string; touchAction: 'none' };
  /** Spread onto the element the player grabs (the button). */
  handlers: { onPointerDown(e: React.PointerEvent<HTMLElement>): void };
  /** True right after a drag: the caller skips the click that ends it. */
  consumeDrag(): boolean;
  reset(): void;
}

export function useDraggableOffset(storageKey: string): DraggableOffset {
  const [offset, setOffset] = useState<Offset>(() => readOffset(storageKey));
  const dragged = useRef(false);
  const offsetRef = useRef(offset);
  offsetRef.current = offset;

  useEffect(() => {
    try { window.localStorage.setItem(storageKey, JSON.stringify(offset)); } catch { /* not remembered */ }
  }, [storageKey, offset]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    const target = e.currentTarget;
    const startX = e.clientX;
    const startY = e.clientY;
    const origin = offsetRef.current;
    const rect = target.getBoundingClientRect();
    let moving = false;
    dragged.current = false;

    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!moving && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      moving = true;
      // Keep at least KEEP_VISIBLE_PX of the control inside the window.
      const minDx = KEEP_VISIBLE_PX - rect.right;
      const maxDx = window.innerWidth - KEEP_VISIBLE_PX - rect.left;
      const minDy = KEEP_VISIBLE_PX - rect.bottom;
      const maxDy = window.innerHeight - KEEP_VISIBLE_PX - rect.top;
      setOffset({
        x: origin.x + Math.min(maxDx, Math.max(minDx, dx)),
        y: origin.y + Math.min(maxDy, Math.max(minDy, dy)),
      });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      dragged.current = moving;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }, []);

  const consumeDrag = useCallback(() => {
    const was = dragged.current;
    dragged.current = false;
    return was;
  }, []);

  const reset = useCallback(() => setOffset({ x: 0, y: 0 }), []);

  return {
    style: {
      ...(offset.x !== 0 || offset.y !== 0 ? { translate: `${offset.x}px ${offset.y}px` } : {}),
      touchAction: 'none',
    },
    handlers: { onPointerDown },
    consumeDrag,
    reset,
  };
}
