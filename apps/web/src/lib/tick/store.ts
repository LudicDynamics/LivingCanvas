/**
 * The page's copy of the character tick: what
 * intent is showing, what just landed or was stopped, which doors were touched.
 *
 * The server owns everything; this module holds its last answer (`GET /api/tick`,
 * and the `tick` every beat / seen / guard returns) so the map and the canvas
 * can draw it without a second request each.
 */
import { useSyncExternalStore } from 'react';
import { EMPTY_TICK_VIEW, type TickView } from '@airp/shared/tick';
import { airpGateway } from '../airp-gateway.js';
import { acceptHint } from '../hint-store.js';

let view: TickView = EMPTY_TICK_VIEW;
/** The world this view belongs to (a view never outlives its save). */
let owner: string | null = null;
const listeners = new Set<() => void>();
const seenSent = new Set<string>();

function set(next: TickView): void {
  if (JSON.stringify(next) === JSON.stringify(view)) return;
  view = next;
  for (const fn of listeners) fn();
}

export function getTickView(): TickView {
  return view;
}

export function subscribeTick(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useTickView(): TickView {
  return useSyncExternalStore(subscribeTick, getTickView, getTickView);
}

/** A new save / world: forget the old one's intent. */
export function resetTick(world: string | null): void {
  if (owner === world) return;
  owner = world;
  seenSent.clear();
  set(EMPTY_TICK_VIEW);
}

/** Take whatever view the server just answered with. */
export function acceptTickView(next: TickView | null | undefined): void {
  if (next && typeof next === 'object' && typeof next.enabled === 'boolean') set(next);
}

export async function refreshTick(): Promise<void> {
  try {
    acceptTickView((await airpGateway.tick()).tick);
  } catch {
    // No world, or an old server: nothing to show.
  }
}

/** The player's beat: the world's turn-end (and its character beat). True when a move landed or was stopped. */
export async function sendBeat(layer: string | null): Promise<boolean> {
  try {
    const result = await airpGateway.turnEnd(layer);
    acceptTickView(result.tick?.view);
    // The companion's hint of this beat, if one was due.
    acceptHint(result.hint);
    return Boolean(result.tick?.resolved && result.tick.resolved.result !== 'void');
  } catch {
    // A beat that failed is simply not counted.
    return false;
  }
}

/** The intent is on screen: its window starts. Sent once per intent. */
export async function reportSeen(id: string): Promise<void> {
  if (seenSent.has(id)) return;
  seenSent.add(id);
  try {
    acceptTickView((await airpGateway.tickSeen(id)).tick);
  } catch {
    seenSent.delete(id);
  }
}

/** 「盯住」: spends the player's beat on watching the target. */
export async function guardIntent(id: string, layer: string | null): Promise<void> {
  // (A guard lands nothing on the page: only the event card, which arrives with the world event.)
  try {
    const result = await airpGateway.tickGuard(id, layer);
    acceptTickView(result.tick?.view);
  } catch {
    await refreshTick();
  }
}

/** A counter the page cannot play by itself (enter / take / talk): App does it with the real action. */
export const TICK_COUNTER_EVENT = 'airp:tick-counter';
export interface TickCounterRequest {
  kind: 'enter' | 'take' | 'talk';
  /** The intent's target (door layer, card path). */
  target: string;
  /** The actor's NPC card (talk), or `characters/<id>`. */
  actor: string;
}

export function requestTickCounter(request: TickCounterRequest): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<TickCounterRequest>(TICK_COUNTER_EVENT, { detail: request }));
}

/**
 * v2: a beat has started — the server sends the next beat's model call
 * beside the writer, so the people's own words are usually ready when the beat ends. Fire and forget.
 */
export async function prefetchBeat(layer: string | null): Promise<void> {
  try {
    await airpGateway.tickPrefetch(layer);
  } catch {
    // An old server, no world: the beat simply asks later (or goes by the rules).
  }
}

/**
 * Who is speaking through the character tick right now (a ✎ bubble, an invite card): their ambient
 * bubbles wait (one bubble per person at a time, §9 #7). Everyone else's ambient life goes on.
 */
let speaking: ReadonlySet<string> = new Set();
const speakingListeners = new Set<() => void>();

export function setTickSpeaking(ids: Iterable<string>): void {
  const next = new Set(ids);
  if (next.size === speaking.size && [...next].every((id) => speaking.has(id))) return;
  speaking = next;
  for (const fn of speakingListeners) fn();
}

export function getTickSpeaking(): ReadonlySet<string> {
  return speaking;
}

export function useTickSpeaking(): ReadonlySet<string> {
  return useSyncExternalStore(
    (fn) => {
      speakingListeners.add(fn);
      return () => {
        speakingListeners.delete(fn);
      };
    },
    getTickSpeaking,
    getTickSpeaking,
  );
}
