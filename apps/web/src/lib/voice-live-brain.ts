/**
 * The character brain of a DIRECT voice-live call (page → ai.worldlines.gg →
 * voice-live), answered by this page's own world.
 *
 * voice-live never connects to the canvas: when it needs the character to
 * answer, it sends `{"type": "brain", "frame": …}` down the call. This module
 * puts that frame on the page's canvas socket (canvas-socket-bridge.ts) — the
 * same `character_*` protocol the dialogue uses — and wraps the character's
 * answers off the canvas fan-out back up the call. On the hosted site that
 * socket is this player's own seat, so the right world answers by construction.
 * Every frame stays scoped to the canonical world root captured when the voice
 * session started.
 *
 * Scope is the call's own character only, and only start / prompt / abort:
 * `character_stop` is dropped, because the canvas already manages the agent's
 * lifetime (opening and closing a dialogue, switching characters) and a call
 * hanging up must not stop an agent the page is still using. Hanging up still
 * ENDS the chat: `close()` sends `character_talk_end` (via: voice), which gives
 * the writer its summary without stopping her.
 */
import {
  sendCanvasSocketFrame,
  subscribeCanvasSocketFrames,
  type CanvasSocketFrame,
} from './canvas-socket-bridge.js';
import { chatEndFrame } from './chat-end.js';

/** voice-live → the canvas. */
const DOWN = new Set(['character_start', 'character_prompt', 'character_abort']);
/** The canvas → voice-live: the frames voice-live's RelayCharacterBrain reads. */
const UP = new Set([
  'character_delta', 'character_message', 'agent_progress', 'tool_start', 'tool_end',
  'character_idle', 'error', 'turn_aborted',
]);

export interface CanvasSocketBridge {
  send(frame: CanvasSocketFrame): boolean;
  subscribe(listener: (frame: CanvasSocketFrame) => void): () => void;
}

const defaultBridge: CanvasSocketBridge = { send: sendCanvasSocketFrame, subscribe: subscribeCanvasSocketFrames };

export interface BrainRelay {
  /** A text frame from the call: true when it was a brain frame (handled here, not a call event). */
  take(message: Record<string, unknown>): boolean;
  /** The call ended: stop listening. The agent itself is left to the canvas. */
  close(): void;
}

export function createBrainRelay(
  characterId: string,
  savePath: string,
  sendUpstream: (message: Record<string, unknown>) => void,
  bridge: CanvasSocketBridge = defaultBridge,
): BrainRelay {
  let closed = false;
  let started = false;
  const up = (frame: Record<string, unknown>): void => {
    if (!closed) sendUpstream({ type: 'brain', frame });
  };
  const unsubscribe = bridge.subscribe((frame) => {
    if (frame.characterId !== characterId || frame.savePath !== savePath || !UP.has(String(frame.type))) return;
    up(frame);
  });
  return {
    take(message) {
      if (message.type !== 'brain') return false;
      const frame = message.frame as Record<string, unknown> | undefined;
      if (closed || !frame || typeof frame !== 'object') return true;
      // voice-live does not know the save; the relay is for exactly one, and stamps it below.
      if (frame.characterId !== characterId || (frame.savePath !== undefined && frame.savePath !== savePath) || !DOWN.has(String(frame.type))) return true;
      if (frame.type === 'character_start' || frame.type === 'character_prompt') started = true;
      // Only the fields the canvas protocol defines for these frames travel on.
      const out: Record<string, unknown> = { type: frame.type, characterId, savePath };
      if (frame.type === 'character_prompt' && typeof frame.message === 'string') out.message = frame.message;
      if (frame.type === 'character_start' && typeof frame.recentContext === 'string') out.recentContext = frame.recentContext;
      if (!bridge.send(out)) {
        // Fail the turn now rather than letting it wait out voice-live's timeout.
        up({ type: 'error', characterId, savePath, message: 'The canvas is not connected.' });
      }
      return true;
    },
    close() {
      if (closed) return;
      closed = true;
      unsubscribe();
      // The call spoke with her: the chat ended, the agent stays.
      if (started) bridge.send({ ...chatEndFrame(characterId, 'voice'), savePath } as CanvasSocketFrame);
    },
  };
}
