import WebSocket, { type RawData } from 'ws';

/**
 * The character brain of a voice-live call, answered HERE (voice-live
 * `RelayCharacterBrain`, its `the design notes`).
 *
 * voice-live may sit behind a gateway (ai.worldlines.gg `/v1/voice/live`) on a
 * machine that cannot reach this server — and on the hosted site, only the seat
 * that placed the call holds the player's world. So voice-live never dials us:
 * it sends the character's frames DOWN the call socket, wrapped as
 * `{"type": "brain", "frame": …}`, and this module plays them into our own
 * character engine over a loopback `/ws` — exactly the frames an
 * `AirpCharacterBrain` used to send from outside — and wraps the engine's
 * answers back UP the same call.
 *
 * Scope is the call's own character and nothing else: a frame for another
 * character, or any frame type outside the two lists below, is dropped. The
 * call cannot write as the writer, start someone else, or read the fan-out.
 */

/** voice-live → us: what a voice call may ask of its character. */
const DOWN = new Set(['character_start', 'character_prompt', 'character_abort', 'character_stop']);
/** us → voice-live: the character's own frames, the ones `AirpCharacterBrain` reads. */
const UP = new Set([
  'character_delta', 'character_message', 'agent_progress', 'tool_start', 'tool_end',
  'character_idle', 'error', 'turn_aborted',
]);

/** A wrapped brain frame starts like this (voice-live's `json.dumps`, with or without spaces). */
const BRAIN_FRAME = /^\{\s*"type"\s*:\s*"brain"/;

/** Bounded, like the call's own queue: frames that arrive before the loopback opens. */
const MAX_QUEUED = 32;

export interface BrainTap {
  /** An upstream text frame: true when it was a brain frame (consumed here, never shown to the browser). */
  take(data: Buffer): boolean;
  /** The call ended: stop the character's turn, close the loopback. */
  close(): void;
}

export function createBrainRelay(
  characterId: string,
  worldRoot: string,
  localUrl: string,
  sendUpstream: (text: string) => void,
  WebSocketImpl: typeof WebSocket = WebSocket,
  isCurrent: () => boolean = () => true,
): BrainTap {
  let local: WebSocket | null = null;
  let open = false;
  let started = false;
  let closed = false;
  const queued: string[] = [];

  const up = (frame: Record<string, unknown>): void => {
    if (!closed && isCurrent() && frame.savePath === worldRoot) sendUpstream(JSON.stringify({ type: 'brain', frame }));
  };

  const connect = (): WebSocket => {
    const socket = new WebSocketImpl(localUrl);
    socket.on('open', () => {
      if (!isCurrent()) {
        socket.close();
        return;
      }
      open = true;
      for (const frame of queued.splice(0)) {
        if (isCurrent()) socket.send(frame);
      }
    });
    socket.on('message', (data: RawData, isBinary: boolean) => {
      if (!isCurrent()) return;
      if (isBinary) return;
      let message: { type?: unknown; characterId?: unknown; savePath?: unknown } | null = null;
      try {
        message = JSON.parse(Buffer.isBuffer(data) ? data.toString('utf8') : String(data));
      } catch {
        return;
      }
      if (!message || message.characterId !== characterId || message.savePath !== worldRoot || !UP.has(String(message.type))) return;
      up(message as Record<string, unknown>);
    });
    socket.on('close', () => {
      if (local === socket) {
        local = null;
        open = false;
        started = false;
      }
      // A turn in flight would otherwise wait out voice-live's turn timeout.
      up({ type: 'error', characterId, savePath: worldRoot, message: 'the character engine closed the connection' });
    });
    socket.on('error', (err: Error) => {
      console.warn(`[AIRP VoiceLive] Character loopback failed (${err.name}).`);
    });
    return socket;
  };

  return {
    take(data: Buffer): boolean {
      if (!BRAIN_FRAME.test(data.toString('utf8', 0, 40))) return false;
      let frame: { type?: unknown; characterId?: unknown; savePath?: unknown } | undefined;
      try {
        frame = JSON.parse(data.toString('utf8'))?.frame;
      } catch {
        return true;
      }
      // voice-live does not know the save: the relay was opened for exactly one
      // (`worldRoot`), so a frame naming another save is dropped and every
      // forwarded frame carries this one (the canvas WS contract requires it).
      if (closed || !isCurrent() || !frame || frame.characterId !== characterId ||
        (frame.savePath !== undefined && frame.savePath !== worldRoot) || !DOWN.has(String(frame.type))) return true;
      if (frame.type === 'character_start') started = true;
      // A line said over the call is answered with thinking off (lifecycle.applyCharacterThinking).
      const text = JSON.stringify({ ...frame, savePath: worldRoot, ...(frame.type === 'character_prompt' ? { via: 'voice' } : {}) });
      local ??= connect();
      if (open) local.send(text);
      else if (queued.length < MAX_QUEUED) queued.push(text);
      return true;
    },
    close(): void {
      if (closed) return;
      closed = true;
      const socket = local;
      local = null;
      if (!socket) return;
      if (open && started) {
        try {
          socket.send(JSON.stringify({ type: 'character_stop', characterId, savePath: worldRoot, via: 'voice' }));
        } catch {
          /* already gone */
        }
      }
      try { socket.close(); } catch { /* already gone */ }
    },
  };
}
