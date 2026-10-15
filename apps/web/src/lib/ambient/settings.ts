/**
 * 「世界小动作」 — the browser-level switch for ambient life.
 *
 * Default ON. Its own storage key, deliberately NOT a field of
 * performance-settings: that envelope validates its exact field set, so a new
 * field would reset every stored performance choice. Reduced motion is applied
 * downstream (AmbientLayer), not stored here.
 */
import { useSyncExternalStore } from 'react';

export const AMBIENT_LIFE_KEY = 'airp:ambient-life';

let cached: boolean | null = null;
const listeners = new Set<() => void>();

function storage(): Storage | null {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

export function readAmbientLife(): boolean {
  if (cached !== null) return cached;
  try {
    cached = storage()?.getItem(AMBIENT_LIFE_KEY) !== 'off';
  } catch {
    cached = true;
  }
  return cached;
}

export function setAmbientLife(on: boolean): void {
  if (readAmbientLife() === on) return;
  cached = on;
  try {
    storage()?.setItem(AMBIENT_LIFE_KEY, on ? 'on' : 'off');
  } catch {
    // Kept for this tab only.
  }
  for (const fn of [...listeners]) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useAmbientLife(): boolean {
  return useSyncExternalStore(subscribe, readAmbientLife, () => true);
}

/** Tests only: forget the cached value so a fresh storage is read. */
export function resetAmbientLifeForTest(): void {
  cached = null;
}
