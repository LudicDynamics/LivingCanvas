// NEW — apps/web/src/lib/presence.ts (owner: the design notes)
// Pure module: no React, no DOM, no timers. Time enters through `now`; every
// side effect (enterLayer / flyTo / notify / nextFrame) is injected. The settle
// window lives here as a plain state machine so it can be unit-tested without a
// browser.
import type { CameraApi } from '../state/useCamera.js';
import type { LayerState, PresenceEntry } from '../state/useWorld.js';

/** Frozen derived enum (contract §4.1), verbatim. */
export type PresenceState = 'in-scene' | 'elsewhere' | 'absent';

/**
 * Projection input row — structurally compatible with `CharacterView`
 * (`App.tsx:75`, not exported; the design notes D-3). Only the fields the
 * projection actually reads are declared.
 */
export interface CharacterPresenceSource {
  id: string;
  name?: string;
  avatar?: string;
  role?: string;
  /** Contract §3.2: `/api/characters` presence. null = not in the world. */
  presence: { layer: string; following: boolean } | null;
}

/** Frozen projection element (contract §4.1), verbatim — no extra fields. */
export interface CharacterPresenceView {
  id: string;
  name: string;
  avatar?: string;
  role?: string;
  state: PresenceState;
  layer: string | null;
  following: boolean;
  position: { x: number; y: number } | null;
  arrivedByFollow: boolean;
}

/** The one threshold owner (contract §4.2). */
export const PRESENCE_SETTLE_MS = 220;

/**
 * What `projectPresence` consumes. The settle window (below) produces this
 * before projection; `arrivedByFollow` is the marker it adds — the ids that
 * were NOT in the current layer on the previous frame (contract P-21).
 */
export interface ProjectPresenceInput {
  characters: CharacterPresenceSource[];
  layer: string;
  presence: PresenceEntry[];
  /** Optional (P-21): ids the previous frame saw outside `layer`. */
  arrivedByFollow?: ReadonlySet<string>;
}

const NO_ARRIVALS: ReadonlySet<string> = new Set<string>();

function viewOf(
  source: CharacterPresenceSource,
  state: PresenceState,
  layer: string | null,
  following: boolean,
  position: { x: number; y: number } | null,
  arrivedByFollow: boolean,
): CharacterPresenceView {
  const view: CharacterPresenceView = {
    id: source.id,
    name: source.name ?? source.id,
    state,
    layer,
    following,
    position,
    arrivedByFollow,
  };
  if (source.avatar !== undefined) view.avatar = source.avatar;
  if (source.role !== undefined) view.role = source.role;
  return view;
}

/**
 * The single derivation of contract §2.2. Output order = input order; `position`
 * comes ONLY from `/api/layer` presence, never from `characters[].presence`.
 */
export function projectPresence(input: ProjectPresenceInput): CharacterPresenceView[] {
  const characters = Array.isArray(input.characters) ? input.characters : [];
  // Defensive: a missing `presence` array means the current layer list is not
  // known yet (first frame) — converge everything to `elsewhere` (04 §3.1 step 5).
  const rows = Array.isArray(input.presence) ? input.presence : [];
  const arrived = input.arrivedByFollow ?? NO_ARRIVALS;
  const layer = input.layer;

  return characters.map((character) => {
    // P-12: loose equality — an undefined key (`old backend`) is absent too.
    const presence = character.presence;
    if (presence == null) {
      return viewOf(character, 'absent', null, false, null, false);
    }
    // Step 6: following is a truth value read straight off the character row.
    const following = presence.following === true;
    if (presence.layer !== layer) {
      return viewOf(character, 'elsewhere', presence.layer, following, null, false);
    }
    const row = rows.find((entry) => entry.characterId === character.id);
    if (row === undefined) {
      // In transition: characters says it is here, /api/layer has not caught up.
      return viewOf(character, 'elsewhere', presence.layer, following, null, false);
    }
    return viewOf(
      character,
      'in-scene',
      layer,
      following,
      { x: row.x, y: row.y },
      following && arrived.has(character.id),
    );
  });
}

/** Ids that are both in `layer` per characters AND present in the layer list. */
function inSceneIdentitySet(
  characters: CharacterPresenceSource[],
  layer: string,
  rows: PresenceEntry[],
): Set<string> {
  const present = new Set(rows.map((row) => row.characterId));
  const out = new Set<string>();
  for (const character of characters) {
    const presence = character.presence;
    if (presence != null && presence.layer === layer && present.has(character.id)) {
      out.add(character.id);
    }
  }
  return out;
}

/**
 * Holds the previous frame so the settle window can replay it literally
 * (contract §4.2 "侧栏成员状态翻转" / P-21). The only stateful collaborator —
 * `projectPresence` stays pure. Holds no timer: the hook outside drives `now`.
 */
export interface PresenceStabilizer {
  reduce(input: {
    characters: CharacterPresenceSource[];
    layer: string;
    presence: PresenceEntry[];
    now: number;
  }): { input: ProjectPresenceInput; settled: boolean };
}

export function createPresenceStabilizer(holdMs: number = PRESENCE_SETTLE_MS): PresenceStabilizer {
  let signature: string | null = null;
  let holdStart: number | null = null;
  let held: ProjectPresenceInput | null = null;
  let inSceneIds = new Set<string>();

  const reduce: PresenceStabilizer['reduce'] = (frame) => {
    const characters = Array.isArray(frame.characters) ? frame.characters : [];
    const rows = Array.isArray(frame.presence) ? frame.presence : [];
    const sceneIds = inSceneIdentitySet(characters, frame.layer, rows);
    // The identity set (same-scene ids) — NOT the coordinates: `move_to` shifts
    // are handled by the canvas slide, they must not start a silence window.
    const nextSignature = `${frame.layer}\u0000${[...sceneIds].sort().join(',')}`;

    if (signature === null) {
      // First frame: show immediately (nothing to damp from).
      signature = nextSignature;
      inSceneIds = sceneIds;
      held = { characters, layer: frame.layer, presence: rows };
      return { input: held, settled: true };
    }

    if (nextSignature !== signature) {
      signature = nextSignature;
      holdStart = frame.now;
    }

    if (holdStart !== null && frame.now - holdStart < holdMs) {
      return {
        input: held ?? { characters, layer: frame.layer, presence: rows },
        settled: false,
      };
    }

    holdStart = null;
    const arrived = new Set<string>();
    for (const id of sceneIds) if (!inSceneIds.has(id)) arrived.add(id);
    inSceneIds = sceneIds;
    held = { characters, layer: frame.layer, presence: rows, arrivedByFollow: arrived };
    return { input: held, settled: true };
  };

  return { reduce };
}

/** Navigation outcome — internal, never a WS/HTTP field. */
export type PresenceTravelOutcome = 'navigated' | 'absent' | 'failed';

/**
 * The single "go to them" entry (contract §3.4). Cross-layer travel is
 * `await enterLayer` → wait one frame → read the NEW layer snapshot → flyTo.
 * Never writes camera memory; no route is added.
 */
export async function navigateToCharacter(input: {
  view: CharacterPresenceView;
  enterLayer(next: string): Promise<unknown>;
  readLayerState(): LayerState | null;
  camera: Pick<CameraApi, 'flyTo'>;
  notify(message: string): void;
  nextFrame(): Promise<void>;
}): Promise<PresenceTravelOutcome> {
  const { view, enterLayer, readLayerState, camera, notify, nextFrame } = input;

  if (view.state === 'absent') {
    notify('They are not here right now.');
    return 'absent';
  }

  if (view.state === 'in-scene') {
    if (view.position === null) {
      // Step 4 guarantees this cannot happen; if it does, do not guess.
      console.warn('presence: in-scene view without a position', view.id);
      return 'failed';
    }
    camera.flyTo(view.position.x, view.position.y);
    return 'navigated';
  }

  const target = view.layer;
  if (target == null) {
    notify('They moved before you arrived.');
    return 'failed';
  }

  try {
    await enterLayer(target);
  } catch (error) {
    console.warn('presence: enterLayer failed', error);
    notify('We could not travel there right now.');
    return 'failed';
  }

  // One frame so the layer-change effects (Canvas save/restore, App's camera
  // stack) commit BEFORE flyTo, otherwise the camera is yanked back (§3.4).
  await nextFrame();

  const row = readLayerState()?.presence.find((entry) => entry.characterId === view.id);
  if (row === undefined) {
    notify('They moved before you arrived.');
    return 'failed';
  }
  camera.flyTo(row.x, row.y);
  return 'navigated';
}
