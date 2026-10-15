/**
 * `apps/web/src/lib/live-call.ts` — the React binding for the one realtime call
 *.
 *
 * The state machine, the WebRTC resources, the frame listener and the throttled
 * snapshots live in `live-call-store.ts`. This file holds no state and has no
 * side effects at all — no `fetch`, no listener, no timer (the design notes
 * §9.4). It exists so the store can stay React-free while the two entries keep
 * one import path.
 *
 * The three-argument `useSyncExternalStore` form is deliberate: a two-argument
 * call throws `Missing getServerSnapshot` under `renderToStaticMarkup`, which is
 * the only rendering assertion this repo has. The
 * third argument is the same reader as the second because there is no
 * server/client divergence to express: SSR can only ever see an idle call.
 */

import { useSyncExternalStore } from 'react';
import {
  callCarries,
  liveCallStore,
  type LiveCallLines,
  type LiveCallState,
  type LiveCallStore,
  type StartCallOptions,
  type VoiceProvider,
} from './live-call-store.js';

export type { LiveCallLines, LiveCallState, LiveCallStore, StartCallOptions, VoiceProvider };
export { callCarries };

/** The global snapshot (phase / error / characterId / owner / transcripts). */
export function useLiveCallState(): LiveCallState {
  return useSyncExternalStore(
    liveCallStore.subscribe,
    liveCallStore.getSnapshot,
    liveCallStore.getSnapshot,
  );
}

/** The character's real lines, committed on the store's lazy tick. */
export function useLiveCallLines(): LiveCallLines {
  return useSyncExternalStore(
    liveCallStore.subscribe,
    liveCallStore.getLines,
    liveCallStore.getLines,
  );
}

/** Readiness gate; false means no entry may be rendered. */
export function useLiveCallAvailable(): boolean {
  return useSyncExternalStore(
    liveCallStore.subscribe,
    liveCallStore.isAvailable,
    liveCallStore.isAvailable,
  );
}

/** Which voice backend a call would use — for the settings panel to name. */
export function useVoiceProvider(): VoiceProvider {
  return useSyncExternalStore(
    liveCallStore.subscribe,
    liveCallStore.getProvider,
    liveCallStore.getProvider,
  );
}

/** The store's methods are module-level stable references; this object is too,
 * so an effect that depends on it never re-fires on a re-render. */
const ACTIONS: Pick<LiveCallStore, 'start' | 'stop'> = {
  start: liveCallStore.start,
  stop: liveCallStore.stop,
};

export function useLiveCallActions(): Pick<LiveCallStore, 'start' | 'stop'> {
  return ACTIONS;
}
