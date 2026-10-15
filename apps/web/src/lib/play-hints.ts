import { useSyncExternalStore } from 'react';

export const PLAY_HINT_REQUEST = 'Give me one small next-step hint based only on what I have actually discovered and the items I carry. Read the full current scene README, including its intent, and the relevant existing records once. Say what I can try, where, and why; distinguish drafting, reviewing, and confirming an action. If an earlier action is incomplete, identify the missing step without calling it completed. Do not reveal undiscovered answers, invent clues, advance time, send anything, consume items, unlock gates, or change game state. Only write or update one short hint Chalk, then wait for my decision.';

const PLAY_HINTS_KEY = 'airp:play-hints';
let enabled = readEnabled();
const listeners = new Set<() => void>();

function readEnabled(): boolean {
  try {
    const value = localStorage.getItem(PLAY_HINTS_KEY);
    return value === null || (value !== 'on' && value !== 'off') ? true : value === 'on';
  } catch {
    return true;
  }
}

export function setPlayHintsEnabled(next: boolean): void {
  enabled = next;
  try { localStorage.setItem(PLAY_HINTS_KEY, next ? 'on' : 'off'); } catch { /* Storage is optional. */ }
  listeners.forEach((listener) => listener());
}

export function getPlayHintsEnabled(): boolean {
  return enabled;
}

export function subscribePlayHints(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePlayHintsEnabled(): boolean {
  return useSyncExternalStore(subscribePlayHints, getPlayHintsEnabled, getPlayHintsEnabled);
}

export type ContinueHintAvailability =
  | 'hidden-disabled'
  | 'hidden-not-settled'
  | 'hidden-error'
  | 'hidden-world'
  | 'hidden-frozen'
  | 'hidden-submit-pending'
  | 'available';

export interface ContinueHintFacts {
  enabled: boolean;
  phase: 'idle' | 'writing';
  stage: string | null;
  error: { message: string; retryable: boolean } | null;
  completionSeq: number;
  visibleSeq: number | null;
  worldReady: boolean;
  worldFrozen: boolean;
  submitPending: boolean;
  preparedSeq: number | null;
}

export function deriveContinueHintAvailability(facts: ContinueHintFacts): ContinueHintAvailability {
  if (!facts.enabled) return 'hidden-disabled';
  if (facts.phase !== 'idle' || facts.stage === null || facts.completionSeq === 0 || facts.visibleSeq !== facts.completionSeq) return 'hidden-not-settled';
  if (facts.error !== null) return 'hidden-error';
  if (!facts.worldReady) return 'hidden-world';
  if (facts.worldFrozen) return 'hidden-frozen';
  if (facts.submitPending) return 'hidden-submit-pending';
  if (facts.preparedSeq === facts.completionSeq) return 'hidden-submit-pending';
  return 'available';
}
