import WebSocket, { type RawData } from 'ws';
import { createSpokenStream, type SpokenStream } from '@airp/shared';
import type { FastBrain } from './voice-fast-brain.js';

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
 *
 * Two brains (`RelayOptions.fast`, engine/voice-fast-brain.ts):
 *   - fast (the default for calls): `character_prompt` / `character_abort` are
 *     answered by one streamed model call here; only `character_start` /
 *     `character_stop` still reach the agent (it starts, it is told the call
 *     ended), and nothing the loopback hears goes up: the call's answer is
 *     the fast brain's alone.
 *   - agent (`AIRP_VOICE_BRAIN=agent`): every frame goes to the agent as
 *     before, with a watchdog: a turn with no answer within
 *     `agentTurnTimeoutMs` (a busy agent, a `get_state` that never answers)
 *     fails on its own (a non-fatal `error` up, `character_abort` down) and
 *     whatever that turn still says afterwards is dropped, so it can never end
 *     or fail the next one.
 *
 * Either way what goes up for SPEECH is cleaned (createSpokenStream): stage
 * directions （…） (…) *…* 【…】 are never spoken. The dialogue and the
 * history keep the full text (the canvas fan-out, the session).
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

/** The agent path's watchdog: voice-live itself waits 90 s, which reads as a dead line. */
export const AGENT_TURN_TIMEOUT_MS = 25_000;
/** How long a hang-up waits for the fast brain's history records before the agent is stopped. */
const RECORD_WAIT_MS = 5_000;

export interface RelayOptions {
  /** Answer prompts with the fast brain (built here, once, with the `up` it must use). */
  fast?: (up: (frame: Record<string, unknown>) => void) => FastBrain;
  /** Agent path: no answer by then and the turn fails (non-fatal). */
  agentTurnTimeoutMs?: number;
  /** The speaker's name(s), so an unmarked "千鹤低下头。" is not spoken either. */
  names?: readonly string[];
}

const short = (text: unknown): string => {
  const s = String(text ?? '').split(/ Stderr:/)[0].trim();
  return s.length > 200 ? `${s.slice(0, 200)}…` : s;
};

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
  options: RelayOptions = {},
): BrainTap {
  let local: WebSocket | null = null;
  let open = false;
  let started = false;
  let closed = false;
  const queued: string[] = [];

  const up = (frame: Record<string, unknown>): void => {
    if (!closed && isCurrent() && frame.savePath === worldRoot) sendUpstream(JSON.stringify({ type: 'brain', frame }));
  };
  const fast = options.fast?.(up) ?? null;

  // Agent path: one turn's speech filter, its watchdog, and the drop-after-abort gate.
  let spoken: SpokenStream | null = null;
  let watchdog: ReturnType<typeof setTimeout> | null = null;
  /** True after an abort / a watchdog failure: frames of that turn are dropped until the next prompt. */
  let discarding = false;
  const clearWatchdog = () => {
    if (watchdog) clearTimeout(watchdog);
    watchdog = null;
  };
  const sendLocal = (text: string): void => {
    local ??= connect();
    if (open) local.send(text);
    else if (queued.length < MAX_QUEUED) queued.push(text);
  };
  const armWatchdog = () => {
    clearWatchdog();
    watchdog = setTimeout(() => {
      watchdog = null;
      if (closed || !isCurrent()) return;
      discarding = true;
      spoken = null;
      up({ type: 'error', characterId, savePath: worldRoot, message: 'the character is busy and did not answer in time' });
      try { sendLocal(JSON.stringify({ type: 'character_abort', characterId, savePath: worldRoot })); } catch { /* gone */ }
    }, options.agentTurnTimeoutMs ?? AGENT_TURN_TIMEOUT_MS);
  };
  /** An agent frame on its way up: speech-cleaned, turn-gated. */
  const agentUp = (message: Record<string, unknown>): void => {
    if (discarding) return;
    const type = message.type;
    if (type === 'character_delta' || type === 'character_message' || type === 'character_idle' || type === 'error' || type === 'turn_aborted') clearWatchdog();
    if (type === 'character_delta' && typeof message.delta === 'string') {
      spoken ??= createSpokenStream({ names: options.names });
      const delta = spoken.push(message.delta);
      if (delta) up({ ...message, delta });
      return;
    }
    if (type === 'character_message' && typeof message.text === 'string') {
      // voice-live speaks a message only when nothing streamed: its spoken form.
      const tail = spoken?.end() ?? '';
      if (tail) up({ type: 'character_delta', characterId, savePath: worldRoot, delta: tail });
      const whole = createSpokenStream({ names: options.names });
      up({ ...message, text: `${whole.push(message.text)}${whole.end()}` });
      spoken = null;
      return;
    }
    if (type === 'character_idle') {
      const tail = spoken?.end() ?? '';
      if (tail) up({ type: 'character_delta', characterId, savePath: worldRoot, delta: tail });
      spoken = null;
    }
    if (type === 'error') {
      spoken = null;
      up({ ...message, message: short(message.message) });
      return;
    }
    up(message);
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
      // The fast brain answers the call; the agent's own frames (and the fast
      // brain's fan-out echoing back through this loopback) never go up.
      if (fast) return;
      agentUp(message as Record<string, unknown>);
    });
    socket.on('close', () => {
      if (local === socket) {
        local = null;
        open = false;
        started = false;
      }
      if (fast) return;
      clearWatchdog();
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
      if (fast) {
        const f = frame as { type: string; message?: unknown; recentContext?: unknown };
        if (f.type === 'character_prompt') { fast.prompt(typeof f.message === 'string' ? f.message : ''); return true; }
        if (f.type === 'character_abort') { fast.abort(); return true; }
        if (f.type === 'character_start') fast.start(typeof f.recentContext === 'string' ? f.recentContext : undefined);
      } else if (frame.type === 'character_prompt') {
        discarding = false;
        spoken = null;
        armWatchdog();
      } else if (frame.type === 'character_abort') {
        clearWatchdog();
        discarding = true;
        spoken = null;
      }
      // A line said over the call is answered with thinking off (lifecycle.applyCharacterThinking).
      sendLocal(JSON.stringify({ ...frame, savePath: worldRoot, ...(frame.type === 'character_prompt' ? { via: 'voice' } : {}) }));
      return true;
    },
    close(): void {
      if (closed) return;
      closed = true;
      clearWatchdog();
      const socket = local;
      local = null;
      const finish = () => {
        if (!socket) return;
        if (open && started) {
          try {
            socket.send(JSON.stringify({ type: 'character_stop', characterId, savePath: worldRoot, via: 'voice' }));
          } catch {
            /* already gone */
          }
        }
        try { socket.close(); } catch { /* already gone */ }
      };
      if (!fast) { finish(); return; }
      // The last exchange may still be on its way into her history: stop her after it (bounded).
      let done = false;
      const once = () => { if (!done) { done = true; finish(); } };
      const cap = setTimeout(once, RECORD_WAIT_MS);
      void fast.close().finally(() => { clearTimeout(cap); once(); });
    },
  };
}
