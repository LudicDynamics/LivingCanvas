/**
 * "Is a performance playing right now?" — the ONE answer the forced tutorial
 * (and anything else that must not talk over the stage) reads
 *
 *
 * A performance is anything the player is meant to WATCH, not act on:
 *
 *   writer     the writer is working on a turn (lib/writer-state.ts), or a prompt
 *              was handed to it and its first frame has not come back yet
 *   dice       the dice ceremony is on screen (lib/dice-ceremony.ts)
 *   milestone  an "item obtained" / "entered a new scene" presentation is up or
 *              queued to play (components/chrome/MilestoneStage.tsx), including a
 *              scene picture replayed from the bag
 *   cg         a world CG is on screen (components/chrome/CgReveal.tsx)
 *   character  a character is answering the player (from the send until its
 *              `character_idle` / `error` / `turn_aborted` frame)
 *   voice      a character line is being SPOKEN: from the moment its voice is
 *              asked for (`/api/tts`) until the clip has finished playing
 *              (lib/use-spoken-lines.ts) — the companion's greeting included,
 *              so the tutorial's first step waits until the greeting has been
 * heard
 *   ending     the finale's staged reveal is playing (components/chrome/
 *              ClosedRun.tsx: title card → ending picture → settlement), until
 *              its last beat lands, the player skips it, or it closes
 *
 * The writer and the dice keep their own stores; the other four report here
 * through `setPerforming`. Each report can be held at most `PERFORMING_MAX_MS`
 * (a lost terminal frame or an unmount that never ran must not wedge whoever
 * waits on it); the writer has its own reconnect reset.
 *
 * Module state + `useSyncExternalStore`, same shape as lib/writer-state.ts.
 */
import { useSyncExternalStore } from 'react';
import { getCeremonySnapshot, subscribeCeremony } from './dice-ceremony.js';
import { getWriterState, subscribeWriterState } from './writer-state.js';

export type PerformanceSource = 'milestone' | 'cg' | 'character' | 'voice' | 'ending';

/** A reported performance older than this no longer counts (a wedge guard, not a pace). */
export const PERFORMING_MAX_MS = 60_000;

const since = new Map<PerformanceSource, number>();
const expiry = new Map<PerformanceSource, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of [...listeners]) fn();
}

/** A source starts or stops performing. Idempotent; a stop of a non-performing source is a no-op. */
export function setPerforming(source: PerformanceSource, busy: boolean, now: number = Date.now()): void {
  const timer = expiry.get(source);
  if (timer) clearTimeout(timer);
  expiry.delete(source);
  if (!busy) {
    if (since.delete(source)) notify();
    return;
  }
  const had = since.has(source);
  if (!had) since.set(source, now);
  const handle = setTimeout(() => {
    expiry.delete(source);
    if (since.delete(source)) notify();
  }, PERFORMING_MAX_MS) as unknown as { unref?: () => void };
  handle.unref?.();
  expiry.set(source, handle as unknown as ReturnType<typeof setTimeout>);
  if (!had) notify();
}

/** The sources performing now, in a stable order. */
export function performingSources(): PerformanceSource[] {
  return (['milestone', 'cg', 'character', 'voice', 'ending'] as const).filter(source => since.has(source));
}

export function subscribePerforming(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Test seam: forget every report. */
export function resetPerformingForTest(): void {
  voiceLines = 0;
  for (const timer of expiry.values()) clearTimeout(timer);
  expiry.clear();
  since.clear();
  notify();
}

export interface PerformanceSignals {
  /** `writerState.phase === 'writing'`. */
  writerWorking: boolean;
  /** A prompt went to the writer and its first frame is not back yet. */
  writerSubmitPending?: boolean;
  /** The dice ceremony is on screen. */
  diceCeremony: boolean;
  /** `performingSources()` — milestone / cg / character / voice / ending. */
  sources: readonly PerformanceSource[];
}

/** Pure: is anything performing? */
export function performanceInProgress(signals: PerformanceSignals): boolean {
  return signals.writerWorking || signals.writerSubmitPending === true || signals.diceCeremony || signals.sources.length > 0;
}

/** Everything performing right now, read from the stores (no React). */
export function readPerformance(writerSubmitPending = false): boolean {
  return performanceInProgress({
    writerWorking: getWriterState().phase === 'writing',
    writerSubmitPending,
    diceCeremony: getCeremonySnapshot() !== null,
    sources: performingSources(),
  });
}

function subscribeAll(listener: () => void): () => void {
  const a = subscribePerforming(listener);
  const b = subscribeWriterState(listener);
  const c = subscribeCeremony(listener);
  return () => { a(); b(); c(); };
}

/** React: whether a performance is playing (re-renders on every store's change). */
export function usePerformanceInProgress(writerSubmitPending = false): boolean {
  return useSyncExternalStore(subscribeAll, () => readPerformance(writerSubmitPending), () => false);
}

// ── character answers ────────────────────────────────────────────────────────
// The send is the start; the character's terminal frame is the end. The App's
// identity router only forwards frames for the open character, so this listens
// on the raw `airp:character-frame` event (every character's frames pass it).

const CHARACTER_FRAME_DOM = 'airp:character-frame';
let characterListening = false;

function onCharacterFrame(event: Event): void {
  const frame = (event as CustomEvent).detail as { type?: unknown } | null;
  const type = frame && typeof frame === 'object' ? frame.type : undefined;
  if (type === 'character_idle' || type === 'error' || type === 'turn_aborted') setPerforming('character', false);
}

/** The player just sent a character a message: their answer is a performance until it settles. */
export function characterAnswerStarted(): void {
  if (!characterListening && typeof window !== 'undefined') {
    characterListening = true;
    window.addEventListener(CHARACTER_FRAME_DOM, onCharacterFrame);
  }
  setPerforming('character', true);
}

/** The answer settled some other way (the dock saw it end, the dialogue closed). */
export function characterAnswerSettled(): void {
  setPerforming('character', false);
}

// ── spoken lines ─────────────────────────────────────────────────────────────
// Several speakers can be busy at once (the dock and an NPC dialogue, or a new
// batch of lines queued behind the one still playing): counted, so the first to
// finish does not end the others' performance.

let voiceLines = 0;

/**
 * A batch of character lines starts being spoken (its voice is being fetched or
 * is playing). Returns the end call — idempotent, so a `finally` can always run it.
 */
export function voiceLineBegan(): () => void {
  voiceLines += 1;
  setPerforming('voice', true);
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    voiceLines = Math.max(0, voiceLines - 1);
    if (voiceLines === 0) setPerforming('voice', false);
  };
}
