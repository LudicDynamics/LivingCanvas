/**
 * The page's copy of the companion's last hint.
 *
 * The server picks at most one hint per beat (`POST /api/turn-end` → `hint`); this module keeps the last one
 * so the dock (✦ line, lines to say back), the writer's tray (the slips it hands over, the margin note) and
 * the rail can draw it without asking again. A new save forgets it.
 */
import { useSyncExternalStore } from 'react';
import type { HintView } from '@airp/shared/hints';

let hint: HintView | null = null;
let owner: string | null = null;
const listeners = new Set<() => void>();

const emit = () => { for (const fn of listeners) fn(); };

export function getHint(): HintView | null {
  return hint;
}

export function subscribeHint(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function useHint(): HintView | null {
  return useSyncExternalStore(subscribeHint, getHint, getHint);
}

/** Is this a hint the server sent (fail-soft: anything else is ignored)? */
export function isHintView(value: unknown): value is HintView {
  const v = value as Partial<HintView> | null;
  return !!v && typeof v === 'object' && typeof v.id === 'string' && typeof v.by === 'string' && typeof v.say === 'string'
    && Array.isArray(v.suggest) && Array.isArray(v.replies);
}

/** A beat answered: keep its hint (a beat without one keeps the last — its slips stay until used or moot). */
export function acceptHint(next: unknown): void {
  if (!isHintView(next)) return;
  if (hint && hint.id === next.id && hint.beat === next.beat) return;
  hint = next;
  emit();
}

/** A new save / world: forget the old hint. */
export function resetHint(world: string | null): void {
  if (owner === world) return;
  owner = world;
  if (hint === null) return;
  hint = null;
  emit();
}
