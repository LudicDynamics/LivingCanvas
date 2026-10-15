/**
 * Esc inside the account popup (components/account/AccountDialog.tsx; smoke test 2026-10-05). App owns ONE Escape
 * router (App.tsx `dispatchEscape`, document capture phase): it asks the focus coordinator for the topmost
 * surface and closes it. So the popup joins that router as a surface, and every view nested inside it (the large
 * CG view, a share-card dialog) joins as a surface ABOVE it — Esc goes back one level first, then closes.
 *
 * Outside the popup (no coordinator in context) `useAccountLayer` does nothing and returns false: the caller keeps
 * its own key handling.
 */
import { createContext, useContext, useEffect, useRef } from 'react';
import type { FocusCoordinator } from '../../lib/focus-coordinator.js';

/** The popup itself: above the lobby (400), create-world (410) and the in-world dialogs (≤ 520). */
export const ACCOUNT_DIALOG_PRIORITY = 530;
/** A view nested inside the popup. */
export const ACCOUNT_LAYER_PRIORITY = 540;

export const AccountLayerContext = createContext<FocusCoordinator | null>(null);

/**
 * Register a nested view of the account popup while `open`; Esc then calls `close`. Returns whether the App
 * router owns this view's Esc (true inside the popup with a coordinator).
 */
export function useAccountLayer(key: string, open: boolean, close: () => void, root?: HTMLElement | null): boolean {
  const focus = useContext(AccountLayerContext);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open || !focus) return;
    const lease = focus.registerSurface({
      key: `account-layer:${key}`,
      owner: 'workspace',
      priority: ACCOUNT_LAYER_PRIORITY,
      root: root ?? null,
      close: () => closeRef.current(),
    });
    return () => lease.unregister();
  }, [focus, open, key, root]);
  return Boolean(focus);
}
