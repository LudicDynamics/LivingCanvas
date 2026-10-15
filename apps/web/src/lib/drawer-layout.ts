/**
 * drawer-layout.ts — the one layout rule for the message drawer and the people.
 *
 *  - `useNarrowLayout`: the breakpoint below which the dialogue stage and the drawer share ONE bottom
 *    area (the dock's own breakpoint, character-dock.css `max-width: 1100px`).
 *  - `requestDrawer` / `onDrawerRequest`: a guide or tutorial step whose target lives inside the drawer
 *    asks App to pull it up (on the right page) before pointing, instead of passing the step over.
 *  - `useBottomStack`: publishes how tall the bottom panel stack is (`--airp-bottom-stack` on <html>),
 *    so what docks "above the input" on a phone (a character's ✎ line, a move's toast, an invite)
 *    sits above whichever panel is actually up.
 *  - `avoidRects`: the panels a pointer bubble must not cover (the guide, the tutorial and the
 *    teach-once cards share it, lib/guide-placement.ts `avoid`).
 */
import { useEffect, useState } from 'react';
import type { GuideRect } from './guide-placement.js';

export const NARROW_LAYOUT_QUERY = '(max-width: 1100px)';

export function useNarrowLayout(): boolean {
  const [narrow, setNarrow] = useState(() => {
    try { return window.matchMedia(NARROW_LAYOUT_QUERY).matches; } catch { return false; }
  });
  useEffect(() => {
    let query: MediaQueryList;
    try { query = window.matchMedia(NARROW_LAYOUT_QUERY); } catch { return; }
    const on = () => setNarrow(query.matches);
    on();
    query.addEventListener?.('change', on);
    return () => query.removeEventListener?.('change', on);
  }, []);
  return narrow;
}

export type DrawerTab = 'stream' | 'options';
export const DRAWER_REQUEST_EVENT = 'airp:drawer-open';

export function requestDrawer(tab: DrawerTab): void {
  try { window.dispatchEvent(new CustomEvent(DRAWER_REQUEST_EVENT, { detail: { tab } })); } catch { /* no window */ }
}

export function onDrawerRequest(fn: (request: { tab: DrawerTab }) => void): () => void {
  const listener = (event: Event) => {
    const tab = (event as CustomEvent<{ tab?: unknown }>).detail?.tab;
    fn({ tab: tab === 'options' ? 'options' : 'stream' });
  };
  window.addEventListener(DRAWER_REQUEST_EVENT, listener);
  return () => window.removeEventListener(DRAWER_REQUEST_EVENT, listener);
}

export const DRAWER_CLOSE_EVENT = 'airp:drawer-close';

/** The opposite case: a step's target is on a dialogue stage the drawer covers (narrow screens) — lower it. */
export function requestDrawerDown(): void {
  try { window.dispatchEvent(new CustomEvent(DRAWER_CLOSE_EVENT)); } catch { /* no window */ }
}

export function onDrawerDownRequest(fn: () => void): () => void {
  window.addEventListener(DRAWER_CLOSE_EVENT, fn);
  return () => window.removeEventListener(DRAWER_CLOSE_EVENT, fn);
}

/** Where a guide step's target lives when it is inside the drawer: the page to pull up. */
export const DRAWER_HOSTED_TARGETS: Readonly<Record<string, DrawerTab>> = Object.freeze({
  options: 'options',
});

/** The bottom panels, in the order they stack. Their tops decide `--airp-bottom-stack`. */
export const BOTTOM_PANELS = [
  ".message-drawer[data-open='true'] .message-drawer__panel",
  '.message-drawer__peek',
  '.character-dock__stage',
] as const;

/** Pure: the stack height = distance from the viewport bottom to the highest visible bottom panel. */
export function bottomStackOf(tops: readonly (number | null)[], viewportHeight: number): number {
  const visible = tops.filter((top): top is number => top !== null && top < viewportHeight);
  if (visible.length === 0) return 0;
  return Math.max(0, Math.round(viewportHeight - Math.min(...visible)));
}

function visibleRect(selector: string): DOMRect | null {
  const node = document.querySelector<HTMLElement>(selector);
  if (!node) return null;
  const r = node.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return null;
  const cs = getComputedStyle(node);
  if (cs.display === 'none' || cs.visibility === 'hidden') return null;
  return r;
}

/**
 * Keeps `--airp-bottom-stack` on <html> current. A light poll (every 10th frame, only while on), not a
 * ResizeObserver chain: the panels mount, unmount and animate, and a missed mutation would strand the var.
 */
export function useBottomStack(on: boolean): void {
  useEffect(() => {
    const root = document.documentElement;
    if (!on) { root.style.removeProperty('--airp-bottom-stack'); return; }
    let frame = 0;
    let count = 0;
    let last = -1;
    const tick = () => {
      if (count++ % 10 === 0) {
        const tops = BOTTOM_PANELS.map((s) => visibleRect(s)?.top ?? null);
        const stack = bottomStackOf(tops, window.innerHeight);
        if (stack !== last) { last = stack; root.style.setProperty('--airp-bottom-stack', `${stack}px`); }
      }
      frame = window.requestAnimationFrame(tick);
    };
    tick();
    return () => { window.cancelAnimationFrame(frame); root.style.removeProperty('--airp-bottom-stack'); };
  }, [on]);
}

/** The panels a pointer bubble keeps clear of, minus any that hold the target itself. */
export const AVOID_PANELS = [
  ".message-drawer[data-open='true'] .message-drawer__panel",
  '.writer-fab__sheet',
  '.character-dock__stage',
  '.player-panel',
  '.avatar-sheet',
] as const;

export function avoidRects(target: Element | null): GuideRect[] {
  const out: GuideRect[] = [];
  for (const selector of AVOID_PANELS) {
    const node = document.querySelector<HTMLElement>(selector);
    if (!node || (target && node.contains(target))) continue;
    const r = visibleRect(selector);
    if (r) out.push({ top: r.top, left: r.left, width: r.width, height: r.height });
  }
  return out;
}
