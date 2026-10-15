/**
 * useAudio.ts — React binding over the audio engine singleton.
 *
 * Module-level mutable state + a listener set; each `useAudio()` mount
 * subscribes and re-reads on notification, so toggling mute or switching the
 * ambient tone from anywhere (header button, App layer effect) refreshes every
 * subscriber without context plumbing.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  initAudio,
  setAmbient as engineSetAmbient,
  setBGM as engineSetBGM,
  setTheme as engineSetTheme,
  setMuted as engineSetMuted,
  isMuted,
} from '../lib/audio.js';

let muted = isMuted();
let ambient: string | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((l) => l());
}

export function useAudio(): {
  muted: boolean;
  toggleMuted: () => void;
  ambient: string | null;
  setAmbient: (ref: string | null) => void;
  setBGM: (ref: string | null) => void;
  setTheme: (ref: string | null) => void;
} {
  const [, force] = useState(0);

  useEffect(() => {
    initAudio(); // engine exists from mount; stays suspended until first gesture
    const listener = () => force((n) => n + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const toggleMuted = useCallback(() => {
    muted = !muted;
    engineSetMuted(muted);
    notify();
  }, []);

  const setAmbient = useCallback((ref: string | null) => {
    ambient = ref;
    engineSetAmbient(ref);
    notify();
  }, []);

  // `setBGM` / `setTheme` are pass-throughs: no module state and no `notify()`
  // because nothing renders on them (00 §5.4, 03 §3.4).
  const setBGM = useCallback((ref: string | null) => {
    engineSetBGM(ref);
  }, []);

  const setTheme = useCallback((ref: string | null) => {
    engineSetTheme(ref);
  }, []);

  return { muted, toggleMuted, ambient, setAmbient, setBGM, setTheme };
}
