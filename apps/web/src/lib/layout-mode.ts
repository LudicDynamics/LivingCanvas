/**
 * layout-mode.ts — which shell the player sees.
 *
 * `classic` is the shipped galgame shell: a full-screen `CharacterModal` for
 * dialogue and the bottom `WriterBar` dock. `companion` is the team's three-column
 * shell: the right rail becomes ONE carrier with two states (avatars ⇄ portrait
 * + compact dialogue) and the writer moves into a bottom-right FAB.
 *
 * The mode BELONGS in `WorldSettings` so a world can ship its
 * own default and the server can serve it. That schema lives in
 * `packages/shared`, which this batch does not own, so P1 reads the mode from
 * `localStorage` instead. The seam is this module: when the settings field
 * lands, `useLayoutMode` starts from `world.settings.layout` and keeps the
 * stored value only as the player's override. Nothing else in the app reads
 * the storage key.
 */
import { useCallback, useEffect, useState } from 'react';

export type LayoutMode = 'classic' | 'companion';

/** Player override for the shell. Read through `readLayoutMode` only. */
export const LAYOUT_STORAGE_KEY = 'airp.layout';

/** the team's shell is the default; `classic` stays one click away. */
export const DEFAULT_LAYOUT_MODE: LayoutMode = 'companion';

export function isLayoutMode(value: unknown): value is LayoutMode {
  return value === 'classic' || value === 'companion';
}

/** Stored override, or the default. Never throws: private mode denies storage. */
export function readLayoutMode(): LayoutMode {
  try {
    const stored = localStorage.getItem(LAYOUT_STORAGE_KEY);
    return isLayoutMode(stored) ? stored : DEFAULT_LAYOUT_MODE;
  } catch {
    return DEFAULT_LAYOUT_MODE;
  }
}

/**
 * Persist and broadcast. The event is what makes a toggle in one part of the
 * shell reach every `useLayoutMode` in the same document — `storage` only
 * fires in OTHER tabs, so a same-tab listener would never see the change.
 */
export function setLayoutMode(mode: LayoutMode): void {
  try {
    localStorage.setItem(LAYOUT_STORAGE_KEY, mode);
  } catch {
    /* private mode: the toggle still applies for this session via the event */
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('airp:layout-mode', { detail: mode }));
  }
}

/** The current shell plus a setter. Re-renders every consumer on change. */
export function useLayoutMode(): [LayoutMode, (mode: LayoutMode) => void] {
  const [mode, setMode] = useState<LayoutMode>(() => readLayoutMode());
  useEffect(() => {
    const onChange = (event: Event): void => {
      const next = (event as CustomEvent<unknown>).detail;
      setMode(isLayoutMode(next) ? next : readLayoutMode());
    };
    window.addEventListener('airp:layout-mode', onChange);
    return () => window.removeEventListener('airp:layout-mode', onChange);
  }, []);
  const set = useCallback((next: LayoutMode) => setLayoutMode(next), []);
  return [mode, set];
}
