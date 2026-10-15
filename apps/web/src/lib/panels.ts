/**
 * The player / world / character panels.
 *
 * There is no HUD: declared
 * states surface only as the author's prose, and only when the player asks —
 * a click on their own avatar (player panel) or a hover on the world's small
 * top badge (world panel). The server already maps them (`GET /api/world/panels`
 * → `mappedStates`, hidden ones never leave it); this module only reads them
 * and says the few lines around them.
 */
import { useEffect, useState } from 'react';
import type { MappedState } from '@airp/shared/states';
import type { ClosedRunState } from './closed-run.js';

export type { MappedState };

export type WorldMode = 'open' | 'semi' | 'closed';

export interface WorldPanels {
  player: { states: MappedState[] };
  world: {
    name: string;
    mode: WorldMode;
    states: MappedState[];
    places: { visited: number; total: number } | null;
  };
  characters: Record<string, MappedState[]>;
}

export const EMPTY_PANELS: WorldPanels = {
  player: { states: [] },
  world: { name: '', mode: 'open', states: [], places: null },
  characters: {},
};

/** The hover close delay: long enough to cross the gap into the panel (PictureMap uses the same 250ms). */
export const HOVER_CLOSE_MS = 250;

function isMapped(value: unknown): value is MappedState {
  const v = value as MappedState | null;
  return Boolean(v) && typeof v?.id === 'string' && typeof v.text === 'string' && v.text.length > 0;
}

function mappedList(value: unknown): MappedState[] {
  return Array.isArray(value) ? value.filter(isMapped).map((s) => ({ id: s.id, label: String(s.label ?? ''), text: s.text })) : [];
}

/** Fail-soft read of the route body: anything malformed reads as "nothing to say". */
export function normalizePanels(body: unknown): WorldPanels {
  const b = (body ?? {}) as Record<string, any>;
  const w = (b.world ?? {}) as Record<string, any>;
  const mode: WorldMode = w.mode === 'closed' || w.mode === 'semi' ? w.mode : 'open';
  const places = w.places && Number.isFinite(w.places.visited) && Number.isFinite(w.places.total) && w.places.total > 0
    ? { visited: Math.max(0, Math.min(w.places.visited, w.places.total)), total: w.places.total }
    : null;
  const characters: Record<string, MappedState[]> = {};
  if (b.characters && typeof b.characters === 'object') {
    for (const [id, list] of Object.entries(b.characters as Record<string, unknown>)) {
      const states = mappedList(list);
      if (states.length > 0) characters[id] = states;
    }
  }
  return {
    player: { states: mappedList(b.player?.states) },
    world: { name: typeof w.name === 'string' ? w.name : '', mode, states: mappedList(w.states), places },
    characters,
  };
}

/**
 * How the story ends, said without spoiling anything: `clock` (a closed world
 * ends when its time runs out), `moment` (it has endings but no clock showing —
 * the story ends at a key moment), or null for an open world, which does not end.
 */
export function endingKind(mode: WorldMode, hasClock: boolean): 'clock' | 'moment' | null {
  if (mode === 'closed' && hasClock) return 'clock';
  if (mode === 'closed' || mode === 'semi') return 'moment';
  return null;
}

/**
 * Where the world hover hangs: on the closed-run clock badge while it shows
 * (a clock and no ending yet), otherwise on the world title in the header.
 */
export function worldHoverAnchor(run: Pick<ClosedRunState, 'mode' | 'clock' | 'ending'>): 'clock' | 'title' {
  return (run.mode === 'closed' || run.mode === 'semi') && run.clock && !run.ending ? 'clock' : 'title';
}

export async function fetchWorldPanels(): Promise<WorldPanels> {
  const res = await fetch('/api/world/panels');
  if (!res.ok) return EMPTY_PANELS;
  return normalizePanels(await res.json());
}

/**
 * `worldKey` changes on every world load. Re-reads on the same forwarded world
 * events the closed-run clock rides (`airp:world-event`: an `entity_edited` on
 * player/README.md or world/README.md is how a state change arrives).
 */
export function useWorldPanels(worldKey: string): WorldPanels {
  const [panels, setPanels] = useState<WorldPanels>(EMPTY_PANELS);
  useEffect(() => {
    let live = true;
    const refresh = () => {
      void fetchWorldPanels().then((next) => { if (live) setPanels(next); }).catch(() => undefined);
    };
    setPanels(EMPTY_PANELS);
    if (worldKey) refresh();
    window.addEventListener('airp:world-event', refresh);
    return () => {
      live = false;
      window.removeEventListener('airp:world-event', refresh);
    };
  }, [worldKey]);
  return panels;
}
