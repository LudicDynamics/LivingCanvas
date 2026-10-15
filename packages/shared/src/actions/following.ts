/**
 * doc 05 `set_following` — flips one character's "travels with the player"
 * flag. Like `move_to`, it writes only the `presence` row: no file moves, no
 * character process starts (05 §1).
 *
 * `following` is the terminal state, not a toggle (doc-20 §9). The player's UI
 * toggle computes `next = !current` itself (05 §6.4).
 */
import { MAP_LAYER } from '../store/layers.js';
import { fail } from './errors.js';
import { registerAction } from './service.js';
import type { ActionContext, ActionResult } from './types.js';
import {
  appendFollowingChanged,
  carryFollowers,
  readCharacterName,
  readLayerName,
  resolveHome,
  resolveTargetCharacter,
} from './presence.js';

export interface SetFollowingInput {
  /** Character id; omitted = yourself (character agents only, 05 §2.4). */
  character?: string;
  /** The state to write, not a toggle. */
  following: boolean;
}

export interface SetFollowingDetails {
  character: string;
  name: string;
  /** Echo of the input, for the caller to assert on. */
  following: boolean;
  /** The layer they are on now; the landing layer for a fresh `true` (05 §3.6). */
  layer: string;
  x: number;
  y: number;
  /** false = idempotent no-op; no event lands (05 §3.7). */
  changed: boolean;
  /** true = this call created the row a character never had (05 §3.6). */
  created: boolean;
  /** true = the landing point came from `world.json` `characters[].home`. */
  landedFromHome: boolean;
}

export async function setFollowing(
  ctx: ActionContext,
  input: SetFollowingInput
): Promise<ActionResult<SetFollowingDetails>> {
  const { store } = ctx;
  const character = await resolveTargetCharacter(ctx, input.character);
  const current = store.getPresenceOf(character);
  const name = await readCharacterName(store, character);

  // ---- No row yet: only `following=true` puts them into the world ----
  if (!current) {
    if (!input.following) {
      // Idempotent no-op. It must NOT insert a presence row: doing so would
      // conjure a phantom (0,0) avatar on `map` with no event to explain it,
      // and a character who was never in the world would silently "be" there
      // (REVIEW M-3 / doc-21 §1 first question).
      // `layer` is only an echo fallback — with no row, nothing is painted.
      return {
        text: `${name} is not in the world and is not following you.`,
        details: {
          character,
          name,
          following: false,
          layer: MAP_LAYER,
          x: 0,
          y: 0,
          changed: false,
          created: false,
          landedFromHome: false,
        },
      };
    }

    // A character who was never staged (the player may pick a backdrop avatar
    // from the character tab) lands on their `home`, so the click has a
    // visible effect in the very frame it happens (05 §3.6.1).
    const home = await resolveHome(store, character);
    const seat = await store.seatPresence(home.layer, { excludeCharacter: character });
    await store.upsertPresence({
      characterId: character,
      layer: home.layer,
      x: seat.x,
      y: seat.y,
      following: true,
    });
    const event = await appendFollowingChanged(ctx, {
      character,
      name,
      following: true,
      layer: home.layer,
    });
    // ONE event only: this is a single user action. A second `character_moved`
    // would be read out as noise ("Watson starts following you" + "Watson
    // walked onto the map"); the position is in `details` for the front end.
    return {
      text: home.fromHome
        ? `${name} starts following you from "${await readLayerName(store, home.layer)}".`
        : `${name} now follows you.`,
      details: {
        character,
        name,
        following: true,
        layer: home.layer,
        x: seat.x,
        y: seat.y,
        changed: true,
        created: true,
        landedFromHome: home.fromHome,
        event,
      },
    };
  }

  // ---- Existing row: flip the flag ONLY. Never the coordinates, never the
  // layer — moving is `move_to`'s job (05 §3.6.1). ----
  if (current.following === input.following) {
    return {
      text: `${name} is already ${input.following ? '' : 'not '}following you.`,
      details: {
        character,
        name,
        following: input.following,
        layer: current.layer,
        x: current.x,
        y: current.y,
        changed: false,
        created: false,
        landedFromHome: false,
      },
    };
  }

  await store.upsertPresence({
    characterId: character,
    layer: current.layer,
    x: current.x,
    y: current.y,
    following: input.following,
  });
  const event = await appendFollowingChanged(ctx, {
    character,
    name,
    following: input.following,
    layer: current.layer,
  });
  return {
    text: input.following ? `${name} now follows you.` : `${name} no longer follows you.`,
    details: {
      character,
      name,
      following: input.following,
      layer: current.layer,
      x: current.x,
      y: current.y,
      changed: true,
      created: false,
      landedFromHome: false,
      event,
    },
  };
}

registerAction('setFollowing', (ctx, input) =>
  setFollowing(ctx, input as unknown as SetFollowingInput)
);

/**
 * `carryFollowers` (01 §5 row 24) — the engine entry `enterLayer` calls after
 * landing `layer_entered`. It is an action method, not a tool: the player's
 * double-click on a door is its only trigger (05 §3.6.2). The wrapper keeps the
 * frozen `{ text, details }` shape while the exported helper hands the caller
 * the structured `{ moved, failures }`.
 */
registerAction('carryFollowers', async (ctx, input) => {
  const layer = input.layer;
  if (typeof layer !== 'string' || layer === '') {
    fail('invalid_argument', 'carryFollowers needs the layer the player just entered');
  }
  const { moved, failures } = await carryFollowers(ctx, layer);
  return {
    text:
      moved.length === 0 && failures.length === 0
        ? `No character was following into "${layer}".`
        : `${moved.length} character(s) followed into "${layer}".` +
          (failures.length > 0 ? ` ${failures.length} could not follow.` : ''),
    details: { layer, moved, failures },
  };
});
