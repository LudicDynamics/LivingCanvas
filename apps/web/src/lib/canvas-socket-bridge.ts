/**
 * The page's one canvas socket, shared with code that is not a React component.
 *
 * `useWorld` owns the socket and is the only thing that opens it; it binds the
 * current socket here and publishes each LIVE frame after its own handling
 * (never the reconnect replay: replayed turns are history, not answers). A
 * voice call's character brain (voice-live-brain.ts) uses this to put
 * `character_*` frames on the same socket the canvas uses and read the
 * character's answers off the same fan-out — so the answer comes from this
 * page's own world, on this page's own seat.
 */
import { sendSocket } from './airp-gateway.js';

export type CanvasSocketFrame = Record<string, unknown>;

let current: WebSocket | null = null;
const listeners = new Set<(frame: CanvasSocketFrame) => void>();

/** useWorld only: the socket now in use, or null while there is none. */
export function bindCanvasSocket(socket: WebSocket | null): void {
  current = socket;
}

/** useWorld only: one live frame, after useWorld consumed it. */
export function publishCanvasSocketFrame(frame: CanvasSocketFrame): void {
  for (const listener of listeners) {
    try {
      listener(frame);
    } catch {
      // A subscriber must never interrupt canonical WS ingestion.
    }
  }
}

export function subscribeCanvasSocketFrames(listener: (frame: CanvasSocketFrame) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** false when there is no open canvas socket right now. */
export function sendCanvasSocketFrame(frame: CanvasSocketFrame): boolean {
  try {
    return sendSocket(current, frame);
  } catch {
    return false;
  }
}
