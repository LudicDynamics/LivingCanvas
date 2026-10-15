/**
 * App's side of the character tick.
 *
 * In a world that declares `tick`: every settled player input becomes one beat
 * (`POST /api/turn-end` with the layer on screen), coalesced so a choice and the
 * writer turn it starts are ONE beat; the view is read on entering a layer; and
 * the counters the intent menu cannot play by itself (enter / take / talk) are
 * played here with the page's real actions.
 *
 * A world without `tick` gets nothing from this hook: no request, no listener work.
 */
import { useEffect, useMemo, useRef } from 'react';
import { CEREMONY_SELECTOR, TUTORIAL_SELECTOR } from '../ambient/gate.js';
import { getWriterState, subscribeWriterState } from '../writer-state.js';
import { createBeatCoalescer, PLAYER_ACT_EVENT, type BeatCoalescer } from './beat.js';
import { prefetchBeat, refreshTick, resetTick, sendBeat, TICK_COUNTER_EVENT, type TickCounterRequest } from './store.js';

export interface CharacterTickOptions {
  /** The world declares `tick`. */
  enabled: boolean;
  /**
   * Send the player's beats even without a tick: the world carries a companion hint table,
   * picked server-side on each beat. Defaults to `enabled`.
   */
  beats?: boolean;
  /** The save (a new one forgets the old intent). */
  worldKey: string | null;
  /** The layer on screen. */
  layer: string | null;
  /** The opening greeting still waits for its first answer: no beat yet (§1.2). */
  paused: boolean;
  onEnter(target: string): void;
  onTake(path: string): void;
  onTalk(card: string): void;
  /** A move landed or was stopped: re-read the layer (its cards may have changed). */
  onResolved(): void;
}

export interface CharacterTick {
  /** Something that belongs to the current beat happened (another surface's answer settled). */
  signal(source: string): void;
}

export function useCharacterTick(opts: CharacterTickOptions): CharacterTick {
  const live = useRef(opts);
  live.current = opts;
  /** v2: this beat's model call was already asked for (once per beat, at its first sign). */
  const prefetched = useRef(false);
  const startOfBeat = () => {
    if (prefetched.current || !live.current.enabled) return;
    prefetched.current = true;
    void prefetchBeat(live.current.layer);
  };

  const coalescer = useMemo<BeatCoalescer>(() => createBeatCoalescer({
    busy: () => {
      if (live.current.paused) return true;
      if (getWriterState().phase === 'writing') return true;
      if (typeof document === 'undefined') return false;
      return Boolean(document.querySelector(CEREMONY_SELECTOR) || document.querySelector(TUTORIAL_SELECTOR));
    },
    send: () => {
      prefetched.current = false;
      if (live.current.enabled || live.current.beats) void sendBeat(live.current.layer).then((resolved) => { if (resolved) live.current.onResolved(); });
    },
    setTimer: (fn, ms) => window.setTimeout(fn, ms),
    clearTimer: (handle) => window.clearTimeout(handle as number),
  }), []);

  // A new save: forget the old view, read this one's.
  useEffect(() => {
    resetTick(opts.enabled ? opts.worldKey : null);
    coalescer.cancel();
    if (opts.enabled) void refreshTick();
  }, [opts.enabled, opts.worldKey, coalescer]);

  // Entering a layer: the intent there (if any) is what the page should show.
  useEffect(() => {
    if (opts.enabled && opts.layer) void refreshTick();
  }, [opts.enabled, opts.layer]);

  // The player's own moves (world events forwarded by useWorld), and the writer finishing a turn.
  const beating = opts.enabled || opts.beats === true;
  useEffect(() => {
    if (!beating) return;
    const onAct = () => {
      startOfBeat();
      coalescer.signal('act');
    };
    window.addEventListener(PLAYER_ACT_EVENT, onAct);
    // A character's answer landing (the dock's frames, forwarded by useWorld) belongs to the beat too.
    const onCharacter = (event: Event) => {
      const type = (event as CustomEvent<{ type?: unknown }>).detail?.type;
      if (type === 'character_idle') coalescer.signal('character');
    };
    window.addEventListener('airp:character-frame', onCharacter);
    let writing = getWriterState().phase === 'writing';
    const off = subscribeWriterState(() => {
      const state = getWriterState();
      const now = state.phase === 'writing';
      // The writer starting = the player just said something: the beat has begun (v2 prefetch).
      if (!writing && now) startOfBeat();
      if (writing && !now) {
        if (!state.error) coalescer.signal('writer');
        else coalescer.poke();
      }
      writing = now;
    });
    return () => {
      window.removeEventListener(PLAYER_ACT_EVENT, onAct);
      window.removeEventListener('airp:character-frame', onCharacter);
      off();
    };
  }, [beating, coalescer]);

  // The counters the menu hands over: played with the page's own actions.
  useEffect(() => {
    if (!opts.enabled) return;
    const onCounter = (event: Event) => {
      const request = (event as CustomEvent<TickCounterRequest>).detail;
      if (!request) return;
      if (request.kind === 'enter') live.current.onEnter(request.target);
      else if (request.kind === 'take') live.current.onTake(request.target);
      else if (request.kind === 'talk') live.current.onTalk(request.actor);
    };
    window.addEventListener(TICK_COUNTER_EVENT, onCounter);
    return () => window.removeEventListener(TICK_COUNTER_EVENT, onCounter);
  }, [opts.enabled]);

  return useMemo(() => ({
    signal: (source: string) => {
      if (live.current.enabled || live.current.beats) coalescer.signal(source);
    },
  }), [coalescer]);
}
