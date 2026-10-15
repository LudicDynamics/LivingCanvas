// NEW — apps/web/src/state/usePresence.ts (owner: the design notes)
// The ONE call site of `projectPresence`. React bindings (the 220ms settle
// timer, the frame wait, the navigation binding) live here; the projection and
// the stabilizer stay pure in `lib/presence.ts`.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createPresenceStabilizer,
  navigateToCharacter,
  projectPresence,
  type CharacterPresenceView,
  type CharacterPresenceSource,
  type PresenceTravelOutcome,
} from '../lib/presence.js';
import type { LayerState, PresenceEntry } from './useWorld.js';
import type { CameraApi } from './useCamera.js';

export interface UsePresenceApi {
  /** The single projection; canvas (02) and rail (03) both consume this one. */
  views: CharacterPresenceView[];
  /** Whether the settle window has elapsed (entry damping only matters after). */
  settled: boolean;
  /** "Go to them" (03's hover action); camera timing is not rewritten in UI. */
  navigateTo(characterId: string): Promise<PresenceTravelOutcome>;
}

export function usePresence(input: {
  characters: CharacterPresenceSource[];
  layer: string;
  presence: PresenceEntry[];
  readLayerState(): LayerState | null;
  /** P-10: depends only on "awaitable", never on 01's concrete return type. */
  enterLayer(next: string): Promise<unknown>;
  camera: Pick<CameraApi, 'flyTo'>;
  notify(message: string): void;
}): UsePresenceApi {
  const { characters, layer, presence, readLayerState, enterLayer, camera, notify } = input;

  const stabilizerRef = useRef<ReturnType<typeof createPresenceStabilizer> | null>(null);
  if (stabilizerRef.current === null) stabilizerRef.current = createPresenceStabilizer();

  const [frame, setFrame] = useState<{ views: CharacterPresenceView[]; settled: boolean }>(
    () => ({ views: [], settled: true }),
  );
  const [tick, setTick] = useState(0);

  // Content key, not array identity: App passes a fresh `presence: []` when a
  // layer payload has not landed yet, and an identity-keyed effect would loop.
  const inputKey = useMemo(
    () =>
      JSON.stringify({
        layer,
        c: (characters ?? []).map((c) => [c.id, c.presence?.layer ?? null, c.presence?.following ?? false]),
        p: (presence ?? []).map((p) => [p.characterId, p.x, p.y, p.following]),
      }),
    [characters, layer, presence],
  );

  useEffect(() => {
    const reduced = stabilizerRef.current!.reduce({
      characters,
      layer,
      presence,
      now: Date.now(),
    });
    setFrame({ views: projectPresence(reduced.input), settled: reduced.settled });
    // The timer only needs to WAKE us once frames stop arriving mid-hold; while
    // frames flow the effect re-runs and re-checks `now` on its own.
    if (!reduced.settled) {
      const id = setTimeout(() => setTick((t) => t + 1), 220);
      return () => clearTimeout(id);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- inputs are keyed by inputKey
  }, [inputKey, tick]);

  const viewsRef = useRef<CharacterPresenceView[]>(frame.views);
  useEffect(() => {
    viewsRef.current = frame.views;
  }, [frame]);

  // Two rAFs: the first lands React's commit, the second lets the layer-change
  // camera effects (Canvas save/restore, App's stack) write before flyTo (§3.5).
  const nextFrame = useCallback(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
    [],
  );

  const navigateTo = useCallback(
    (characterId: string): Promise<PresenceTravelOutcome> => {
      const view = viewsRef.current.find((v) => v.id === characterId) ?? {
        id: characterId,
        name: characterId,
        state: 'absent' as const,
        layer: null,
        following: false,
        position: null,
        arrivedByFollow: false,
      };
      // P-20: navigateToCharacter is the sole notifier; the rail never notifies.
      return navigateToCharacter({ view, enterLayer, readLayerState, camera, notify, nextFrame });
    },
    [camera, enterLayer, nextFrame, notify, readLayerState],
  );

  return { views: frame.views, settled: frame.settled, navigateTo };
}
