/**
 * Writer busy state — module scope, React-visible via useSyncExternalStore.
 *
 * The writer is "writing" from the moment it starts a turn until `writer_idle`
 * arrives. `WriterBar` disables input while writing (the design notes T3.4:
 * "writing 中再按 Enter → placeholder 变『作家正在写……』，输入无效（诚实，不排队
 * 不打断）"). The state must also reset on WS reconnect, or a `writer_idle` lost
 * to a disconnect leaves the input permanently disabled.
 *
 * Early release: the server marks the beat's
 * first page change with `agent_progress{landed:true}`. The input opens THEN —
 * the player's beat has its result — and the rest of that beat (more tools,
 * the closing line) is its `tail`: it never re-locks the input, its
 * `writer_idle` only closes the tail, and a prompt sent meanwhile waits on the
 * server behind it.
 */

import { useSyncExternalStore } from 'react';

export type WriterPhase = 'idle' | 'writing';

export interface WriterError {
  message: string;
  retryable: boolean;
}

export interface WriterState {
  phase: WriterPhase;
  reason: 'turn' | 'chalk' | null;
  stopRequested: boolean;
  stage: string | null;
  startedAt: number | null;
  toolCount: number;
  error: WriterError | null;
  lastPrompt: string | null;
  lastMessage: string | null;
  completionSeq: number;
  /** The landed beat is still finishing on the server; its frames must not re-lock the input. */
  tail: boolean;
}

export type WriterPromptAcceptance =
  | { accepted: true; requestId?: string }
  | {
      accepted: false;
      reason: 'transport-closed' | 'invalid' | 'busy';
      message: string;
    };

const READY_STAGE = 'Ready for your next action';
const INITIAL_STATE: WriterState = {
  phase: 'idle',
  reason: null,
  stopRequested: false,
  stage: null,
  startedAt: null,
  toolCount: 0,
  error: null,
  lastPrompt: null,
  lastMessage: null,
  completionSeq: 0,
  tail: false,
};
let state: WriterState = INITIAL_STATE;
const listeners = new Set<() => void>();

function set(next: WriterState): void {
  if (Object.keys(next).every((key) => next[key as keyof WriterState] === state[key as keyof WriterState])) return;
  state = next;
  for (const fn of listeners) fn();
}

function start(reason: 'turn' | 'chalk', prompt?: string): boolean {
  if (state.phase === 'writing' && prompt === undefined) {
    set({ ...state, reason });
    return true;
  }
  if (state.phase === 'writing' && prompt !== undefined) return false;
  set({
    ...state,
    phase: 'writing',
    reason,
    stopRequested: false,
    stage: state.stage ?? READY_STAGE,
    startedAt: state.startedAt ?? Date.now(),
    toolCount: 0,
    error: null,
    lastMessage: null,
    lastPrompt: prompt === undefined ? state.lastPrompt : prompt,
  });
  return true;
}

/**
 * Begin a writer turn after its prompt has been accepted by the transport.
 * This is the only public lifecycle entry for a prompt.
 */
export function beginWriterPrompt(prompt: string): boolean {
  const normalized = typeof prompt === 'string' ? prompt.trim() : '';
  if (!normalized || state.phase === 'writing') return false;
  return start('turn', normalized);
}

/**
 * Request cancellation without pretending the turn has ended. Repeated Stop
 * clicks are intentionally idempotent.
 */
export function requestWriterStop(): boolean {
  if (state.phase !== 'writing' || state.stopRequested) return false;
  set({ ...state, stopRequested: true });
  return true;
}

/** The last accepted prompt, when retrying a retryable terminal error. */
export function retryWriterPrompt(): string | null {
  return state.error?.retryable && state.lastPrompt ? state.lastPrompt : null;
}

/**
 * Reconnect/world reset guard. A lost terminal frame must release the lock;
 * socket-close preserves the prompt for a possible retry, while a new world
 * discards old world-scoped content.
 */
export function resetForReconnect(reason: 'socket_open' | 'socket_close' | 'world_change' = 'socket_open'): void {
  const error =
    reason === 'socket_close'
      ? { message: 'Connection lost. Please try again.', retryable: true }
      : reason === 'world_change'
        ? { message: 'The active world changed. Please try again.', retryable: true }
        : null;
  set({
    ...state,
    phase: 'idle',
    reason: null,
    stopRequested: false,
    stage: null,
    startedAt: null,
    toolCount: 0,
    error,
    lastPrompt: reason === 'world_change' ? null : state.lastPrompt,
    lastMessage: null,
    tail: false,
  });
}
/** Public reset seam for a fresh connection. */
export function reset(): void {
  resetForReconnect('socket_open');
}

/** Canonical writer ingress; all UI projections consume this snapshot. */
export function acceptWriterFrame(frame: Record<string, unknown>): void {
  if (frame.source !== 'writer') return;

  if (frame.type === 'agent_progress' && frame.landed === true) {
    // The tail of a landed beat, or a newer prompt already waiting behind it:
    // either way nothing here may change the lock.
    if (state.tail) return;
    if (state.phase !== 'writing') {
      set({ ...state, tail: true });
      return;
    }
    set({
      ...state,
      phase: 'idle',
      reason: null,
      stopRequested: false,
      // The player may act now: say so, not the server's "finishing" stage.
      stage: READY_STAGE,
      startedAt: null,
      toolCount: 0,
      error: null,
      completionSeq: state.completionSeq + 1,
      tail: true,
    });
    return;
  }

  if (frame.type === 'agent_progress') {
    const busy = typeof frame.busy === 'boolean' ? frame.busy : undefined;
    // A tail that lost its `landed` mark (never expected) still may not re-lock.
    if (busy === true && state.tail && state.phase !== 'writing') return;
    const entering = busy === true && state.phase !== 'writing';
    set({
      ...state,
      // busy:false is only progress; writer_idle is the terminal fact.
      phase: busy === true ? 'writing' : state.phase,
      reason: busy === true ? 'turn' : state.reason,
      stopRequested: entering ? false : state.stopRequested,
      stage: typeof frame.stage === 'string' ? frame.stage : state.stage,
      startedAt: typeof frame.startedAt === 'number' ? frame.startedAt : (entering ? Date.now() : state.startedAt),
      error: busy === true ? null : state.error,
      lastMessage: entering ? null : state.lastMessage,
    });
    return;
  }

  if (frame.type === 'writer_delta' || frame.type === 'writer_message' || frame.type === 'chalk_writing' || frame.type === 'tool_start') {
    if (state.phase !== 'writing' && !state.tail) start(frame.type === 'chalk_writing' ? 'chalk' : 'turn');
  }
  if (frame.type === 'tool_start') {
    if (state.tail) return;
    set({ ...state, toolCount: state.toolCount + 1 });
  } else if (frame.type === 'tool_end') {
    set({ ...state, toolCount: Math.max(0, state.toolCount - 1) });
  } else if (frame.type === 'writer_message' && typeof frame.text === 'string') {
    // The tail's closing line fills the landed beat's receipt — unless a newer
    // prompt is already running, whose receipt it is not.
    if (state.tail && state.phase === 'writing') return;
    set({ ...state, lastMessage: frame.text, error: null });
  } else if (frame.type === 'error' || frame.type === 'turn_aborted') {
    if (state.phase !== 'writing') return;
    // An error in a landed beat's tail is not the waiting prompt's failure —
    // unless the player pressed Stop, which ends both on the server.
    if (state.tail && !state.stopRequested) return;
    const message =
      typeof frame.message === 'string'
        ? frame.message
        : frame.type === 'turn_aborted'
          ? 'The writer stopped this turn.'
          : 'The writer could not finish this turn.';
    set({
      ...state,
      phase: 'idle',
      reason: null,
      stopRequested: false,
      stage: null,
      startedAt: null,
      toolCount: 0,
      error: { message, retryable: frame.retryable !== false },
      lastMessage: null,
      completionSeq: state.completionSeq + 1,
    });
  } else if (frame.type === 'writer_idle') {
    // The landed beat truly ended: close its tail and leave any newer prompt alone.
    if (state.tail) {
      set({ ...state, tail: false });
      return;
    }
    if (state.phase !== 'writing') return;
    set({
      ...state,
      phase: 'idle',
      reason: null,
      stopRequested: false,
      stage: typeof frame.stage === 'string' ? frame.stage : READY_STAGE,
      startedAt: null,
      toolCount: 0,
      error: null,
      completionSeq: state.completionSeq + 1,
    });
  }
}

export function getWriterState(): WriterState {
  return state;
}
export function getWriterPublicState(): WriterState {
  return state;
}

export function subscribeWriterState(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function useWriterPhase(): WriterPhase {
  return useSyncExternalStore(subscribeWriterState, getWriterState).phase;
}

export function useWriterState(): WriterState {
  return useSyncExternalStore(subscribeWriterState, getWriterState);
}
