/**
 * Phantom registry — module scope, React-visible via useSyncExternalStore.
 *
 * A "phantom" is a *provisional* card shown while the writer is still producing
 * it (chalk) or while an image is still generating. It exists OUTSIDE `items`
 * on purpose: `chalk_writing` / `writer_delta` / `image_generation_progress`
 * arrive BEFORE the file lands, so there is no card to attach to yet
 *. When the real card lands, the phantom is reconciled
 * away — the seat never moves.
 *
 * Frozen shape: the design notes Owner 01; 03 reuses it without changing
 * the shape.
 */

import { useSyncExternalStore } from 'react';

export type PhantomKind = 'chalk' | 'image' | 'component';

/** World-space placement, produced by `phantomSeatFor` (owner 03). */
export interface PhantomSeat {
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
}

export interface PhantomEntry {
  toolCallId: string;
  kind: PhantomKind;
  source: 'writer' | 'character';
  /** Unknown until `chalk_landed` / `image_landed` (the card does not exist yet). */
  path?: string;
  /** Phantom seat = the成品 seat; `land` never changes it. */
  seat: PhantomSeat;
  /** chalk lane: accumulated wet-ink body (rendered translucent while writing). */
  text?: string;
  /** image lane: landed asset path (for `/api/asset?path=<asset>`). */
  asset?: string;
  /** image lane: whether the landing hit cache; `GhostCard` reads it for its seal. */
  reused?: boolean;
  /** One-line label inside the shell (image progress text); chalk lane ignores it. */
  label?: string;
  /** Progress heartbeat elapsed ms (03's idempotent merge updates it). */
  elapsedMs?: number;
  /** Owning layer; undefined = don't filter (tolerate older frames). */
  layer?: string;
  /** component lane: the resolved card kind (server's `card_writing.kind`),
   * which `skeletonShapeFor` turns into a shape. */
  cardKind?: string;
  /** component lane: optional title placeholder (= `card_writing.title`). */
  cardTitle?: string;
  phase: 'pending' | 'writing' | 'landed' | 'evicted';
  createdAt: number;
}

export interface PhantomInit {
  kind: PhantomKind;
  source: 'writer' | 'character';
  path?: string;
  seat: PhantomSeat;
  label?: string;
  elapsedMs?: number;
  layer?: string;
  /** component lane: the resolved card kind. */
  cardKind?: string;
  /** component lane: optional title placeholder. */
  cardTitle?: string;
}

/** `land` payload, shared by both lanes. **No `seat`** — landing never reseats. */
export interface PhantomLandPayload {
  path?: string;
  asset?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  reused?: boolean;
}

const entries = new Map<string, PhantomEntry>();
/** Ink that arrived BEFORE its `register` (writer_delta precedes chalk_writing). */
const pendingInk = new Map<string, string>();
/** Buffered deletes so an `evict` before `register` still takes effect. */
const pendingEvict = new Set<string>();

let snapshot: readonly PhantomEntry[] = [];
const listeners = new Set<() => void>();

function publish(): void {
  snapshot = [...entries.values()];
  for (const fn of listeners) fn();
}

/**
 * Add or merge a phantom (idempotent). A second call for the same id updates
 * only the fields this call supplied — it never reseats, never resets
 * `createdAt`, never changes `phase`.
 */
export function register(toolCallId: string, init: PhantomInit): void {
  const existing = entries.get(toolCallId);
  if (existing) {
    if (init.label !== undefined) existing.label = init.label;
    if (init.elapsedMs !== undefined) existing.elapsedMs = init.elapsedMs;
    if (init.layer !== undefined) existing.layer = init.layer;
    if (init.path !== undefined) existing.path = init.path;
    if (init.cardKind !== undefined) existing.cardKind = init.cardKind;
    if (init.cardTitle !== undefined) existing.cardTitle = init.cardTitle;
    publish();
    return;
  }
  if (pendingEvict.has(toolCallId)) {
    pendingEvict.delete(toolCallId);
    return; // it failed before it ever appeared
  }
  const entry: PhantomEntry = {
    toolCallId,
    kind: init.kind,
    source: init.source,
    seat: init.seat,
    phase: 'pending',
    createdAt: Date.now(),
  };
  if (init.path !== undefined) entry.path = init.path;
  if (init.label !== undefined) entry.label = init.label;
  if (init.elapsedMs !== undefined) entry.elapsedMs = init.elapsedMs;
  if (init.layer !== undefined) entry.layer = init.layer;
  if (init.cardKind !== undefined) entry.cardKind = init.cardKind;
  if (init.cardTitle !== undefined) entry.cardTitle = init.cardTitle;
  // P0 ordering: ink may have arrived before this register — pour it in.
  const buffered = pendingInk.get(toolCallId);
  if (buffered !== undefined) {
    entry.text = buffered;
    entry.phase = 'writing';
    pendingInk.delete(toolCallId);
  }
  entries.set(toolCallId, entry);
  publish();
}

/** Append wet-ink (writer_delta). Unknown id → buffered until `register`. */
export function appendInk(toolCallId: string, delta: string): void {
  const entry = entries.get(toolCallId);
  if (!entry) {
    pendingInk.set(toolCallId, (pendingInk.get(toolCallId) ?? '') + delta);
    return;
  }
  entry.text = (entry.text ?? '') + delta;
  if (entry.phase === 'pending') entry.phase = 'writing';
  publish();
}

/** Replace `text` wholesale — the backstop path (extractor lagged; never append). */
export function setInk(toolCallId: string, text: string): void {
  const entry = entries.get(toolCallId);
  if (!entry) {
    pendingInk.set(toolCallId, text);
    return;
  }
  entry.text = text;
  if (entry.phase === 'pending') entry.phase = 'writing';
  publish();
}

/**
 * Mark a phantom landed: phase='landed', record payload; **seat unchanged**.
 *
 * Guard: a failed `write` still gets a
 * `chalk_landed` after its `tool_end{isError}`, which evicted the phantom. A
 * second `land` would overwrite `'evicted'` back to `'landed'`, so the
 * evicted-drop never fires and the skeleton sticks forever. Landing an already
 * evicted phantom is a no-op. The chalk/image lanes are unaffected: on the
 * normal path `land` always precedes `evict`.
 */
export function land(toolCallId: string, payload: PhantomLandPayload): void {
  const entry = entries.get(toolCallId);
  if (!entry) return;
  if (entry.phase === 'evicted') return;
  if (payload.path !== undefined) entry.path = payload.path;
  if (payload.asset !== undefined) entry.asset = payload.asset;
  if (payload.reused !== undefined) entry.reused = payload.reused;
  entry.phase = 'landed';
  publish();
}

/** Evict (failed tool, or after the real card took over). Idempotent. */
export function evict(toolCallId: string): void {
  const entry = entries.get(toolCallId);
  if (!entry) {
    if (pendingInk.has(toolCallId)) pendingInk.delete(toolCallId);
    else pendingEvict.add(toolCallId); // failed before it appeared
    return;
  }
  if (entry.phase === 'evicted') return;
  entry.phase = 'evicted';
  publish();
}

/** Remove a phantom outright (the real card is on canvas now). */
export function drop(toolCallId: string): void {
  if (entries.delete(toolCallId)) publish();
}

/**
 * Drop every phantom whose `path` is now on the canvas — the idempotent
 * handover entry. Called after a layer refetch.
 */
export function reconcileLanded(paths: Iterable<string>): void {
  const onCanvas = new Set(paths);
  let changed = false;
  for (const [id, entry] of entries) {
    if (entry.path && onCanvas.has(entry.path)) {
      entries.delete(id);
      changed = true;
    }
  }
  if (changed) publish();
}

/** Current snapshot. Reference is stable unless content changed. */
export function getPhantomsSnapshot(): readonly PhantomEntry[] {
  return snapshot;
}

export function subscribePhantoms(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function usePhantoms(): readonly PhantomEntry[] {
  return useSyncExternalStore(subscribePhantoms, getPhantomsSnapshot);
}
