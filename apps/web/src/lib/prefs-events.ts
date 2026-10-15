/**
 * "A preference that follows the account changed" (lib/account-data.ts pushes
 * it, debounced): the voice switches and volumes have no store of their own,
 * so their setters announce here (tts-readiness.ts dispatches the same name inline). Performance settings and the interface
 * language have their own subscriptions and need no event.
 */
export const PREFS_CHANGED_EVENT = 'airp:prefs-changed';

export function announcePrefsChanged(): void {
  // A setter must never fail over this (tests and the in-tab runtime stub `window`).
  try { if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') window.dispatchEvent(new Event(PREFS_CHANGED_EVENT)); } catch { /* no listeners to tell */ }
}
