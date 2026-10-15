/**
 * view-mode.ts — how the layer is looked at.
 *
 * `canvas` is the flat infinite canvas of chalk cards that shipped. `map` is
 * the team's tabletop view (2026-09-25: 「增加一个 fvtt 的逻辑，就是我们的产品采用
 * 一个 2d 45度角的地图的模式…增加一个模式，画布模式和地图模式」): the same
 * layer seen at 45°, the floor a grid of diamonds, and what stands on it drawn
 * upright.
 *
 * This is a SEPARATE axis from `layout-mode.ts`, on purpose. Layout decides the
 * shell around the stage (the companion rail, the writer FAB); view decides how
 * the stage itself is projected. `companion + map` is a real combination, so
 * making `map` a third layout value would forbid it. The name also avoids
 * `LayoutMode` from `@airp/shared/schemas/canvas`, which means grid/circle/row.
 *
 * The view is a projection of the SAME world, so this module holds no world
 * state at all: switching it changes one CSS matrix and the pointer maths
 * (`lib/camera.ts`), and nothing is written to the server.
 *
 * Same seam as layout: `localStorage` now, `WorldSettings` when that field
 * lands. Nothing else in the app reads the storage key. Which view a world
 * OPENS in is the world's own setting (`view.default`, see `enterWorldView`).
 */
import { useCallback, useEffect, useState } from 'react';
import type { ViewProjection } from './camera.js';

export type ViewMode = ViewProjection;

/** Player override for the view. Read through `readViewMode` only. */
export const VIEW_STORAGE_KEY = 'airp.view';

/** The event every consumer in this document listens to. */
export const VIEW_MODE_EVENT = 'airp:view-mode';

/** The canvas that shipped stays the default; the map is one click away. */
export const DEFAULT_VIEW_MODE: ViewMode = 'canvas';

export function isViewMode(value: unknown): value is ViewMode {
  return value === 'canvas' || value === 'map';
}

/** Stored override, or the default. Never throws: private mode denies storage. */
export function readViewMode(): ViewMode {
  try {
    const stored = localStorage.getItem(VIEW_STORAGE_KEY);
    return isViewMode(stored) ? stored : DEFAULT_VIEW_MODE;
  } catch {
    return DEFAULT_VIEW_MODE;
  }
}

/**
 * Map-first worlds: a world declares the view it opens in
 * (`world.json` `view.default`, chosen in the workshop; TRPG "跑图" worlds say
 * `map`). Entering a world applies that default — unless the player switched
 * the view in THAT world before, which is remembered per world under
 * `airp.view:<worldId>`. The world the player is in is module state, like the
 * stored view itself: one document plays one world at a time.
 */
let currentWorld: string | null = null;

/**
 * A manifest's `view.default`, fail-soft (mirrors `worldDefaultView` in
 * @airp/shared's world schema, which validates it on the server).
 */
export function worldDefaultViewOf(manifest: unknown): ViewMode {
  const view = manifest && typeof manifest === 'object' ? (manifest as { view?: unknown }).view : undefined;
  const value = view && typeof view === 'object' ? (view as { default?: unknown }).default : undefined;
  return isViewMode(value) ? value : DEFAULT_VIEW_MODE;
}

/** Per-world player override. */
export const worldViewKey = (worldId: string): string => `${VIEW_STORAGE_KEY}:${worldId}`;

/** The view a world opens in: the player's earlier choice there, else the world's default. */
export function viewOnEntering(worldId: string, worldDefault: ViewMode): ViewMode {
  try {
    const stored = localStorage.getItem(worldViewKey(worldId));
    if (isViewMode(stored)) return stored;
  } catch {
    /* private mode: fall through to the world's default */
  }
  return isViewMode(worldDefault) ? worldDefault : DEFAULT_VIEW_MODE;
}

function applyViewMode(mode: ViewMode): void {
  try {
    localStorage.setItem(VIEW_STORAGE_KEY, mode);
  } catch {
    /* private mode: the toggle still applies for this session via the event */
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(VIEW_MODE_EVENT, { detail: mode }));
  }
}

/**
 * Called when a world becomes the active one (and with `null` when none is).
 * Returns the view it opened in. Nothing is written per world: only a switch
 * by the player is an override.
 */
export function enterWorldView(worldId: string | null, worldDefault: ViewMode = DEFAULT_VIEW_MODE): ViewMode {
  currentWorld = worldId;
  if (!worldId) return readViewMode();
  const mode = viewOnEntering(worldId, worldDefault);
  applyViewMode(mode);
  return mode;
}

/**
 * Persist and broadcast. The event is what reaches every consumer in the same
 * document — `storage` only fires in OTHER tabs — and it is what wakes the
 * camera loop, which otherwise sleeps while the view is at rest. Inside a
 * world, the choice is also remembered for that world.
 */
export function setViewMode(mode: ViewMode): void {
  if (currentWorld) {
    try {
      localStorage.setItem(worldViewKey(currentWorld), mode);
    } catch {
      /* private mode */
    }
  }
  // …and for this layer of this run: the player's switch outlives the act.
  if (currentRun && currentLayer) {
    try {
      localStorage.setItem(layerViewKey(currentRun, currentLayer), mode);
    } catch {
      /* private mode */
    }
  }
  applyViewMode(mode);
}

// ── per run, per layer ─────────────────────────────

/**
 * A layer may declare the view it opens in (README frontmatter `view: canvas | map`): an author writes it on the
 * layer where an act begins. The player's own switch on a layer is remembered for THIS run under
 * `airp.view:<run>:<layer>` and always wins there.
 */
let currentRun: string | null = null;
let currentLayer: string | null = null;

export const layerViewKey = (run: string, layer: string): string => `${VIEW_STORAGE_KEY}:${run}:${layer}`;

/** A layer README's declared view, fail-soft; `map` without a map picture is no view at all (stay on the canvas). */
export function layerDeclaredViewOf(frontmatter: Record<string, unknown> | null | undefined): ViewMode | null {
  const view = frontmatter?.view;
  if (!isViewMode(view)) return null;
  if (view === 'map') {
    const map = frontmatter?.map as { plan?: { picture?: unknown } } | undefined;
    if (typeof map?.plan?.picture !== 'string' || !map.plan.picture) return null;
  }
  return view;
}

/**
 * Pure: the view on entering a layer.
 *   1. the player switched on this layer in this run → theirs;
 *   2. the layer declares a view → the layer's;
 *   3. otherwise → keep the current view (a choice made on an undeclared layer carries on).
 * The world's first layer starts from the world's view (`current` is already `view.default` / the old per-world
 * memory there, `enterWorldView`), so rule 3 gives layer > world > canvas.
 */
export function viewOnLayer(input: { stored: unknown; declared: ViewMode | null; current: ViewMode }): ViewMode {
  if (isViewMode(input.stored)) return input.stored;
  if (input.declared) return input.declared;
  return input.current;
}

/** Entering a layer (App, once its README is known). Returns the view it applied. */
export function enterLayerView(run: string | null, layer: string | null, declared: ViewMode | null): ViewMode {
  currentRun = run;
  currentLayer = layer;
  const current = readViewMode();
  if (!run || !layer) return current;
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(layerViewKey(run, layer));
  } catch {
    /* private mode */
  }
  const next = viewOnLayer({ stored, declared, current });
  if (next !== current) applyViewMode(next);
  return next;
}

/**
 * Subscribe outside React (the camera's frame loop is not a component). Returns
 * the unsubscribe. The listener gets the new mode, already validated.
 */
export function subscribeViewMode(listener: (mode: ViewMode) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const onChange = (event: Event): void => {
    const next = (event as CustomEvent<unknown>).detail;
    listener(isViewMode(next) ? next : readViewMode());
  };
  window.addEventListener(VIEW_MODE_EVENT, onChange);
  return () => window.removeEventListener(VIEW_MODE_EVENT, onChange);
}

/** The current view plus a setter. Re-renders every consumer on change. */
export function useViewMode(): [ViewMode, (mode: ViewMode) => void] {
  const [mode, setMode] = useState<ViewMode>(() => readViewMode());
  useEffect(() => subscribeViewMode(setMode), []);
  const set = useCallback((next: ViewMode) => setViewMode(next), []);
  return [mode, set];
}
