/**
 * doc 05 `move_to` — the ONLY way a character's presence changes scene. It
 * writes one row of `canvas.db`'s `presence` table; it touches no file under
 * `characters/<id>/`, and it never starts a character process (05 §1 / §4.1).
 *
 * `move` (doc 04) is the file mover; the two never merge: a character has no
 * movable entity, only a standing on the canvas (doc-20 §5).
 */
import { dirOfLayer } from '../store/layers.js';
import { ActionError } from './errors.js';
import { registerAction } from './service.js';
import type { ActionContext, ActionResult } from './types.js';
import {
  assertNearInLayer,
  readCharacterName,
  readLayerName,
  resolveDestinationLayer,
  resolveTargetCharacter,
} from './presence.js';

export interface MoveCharacterInput {
  /** Character id (`characters/<id>/`), not a path. Omitted = yourself (05 §2.4). */
  character?: string;
  /** A scene directory, or an entity path in this or another scene (05 §3.2). */
  destination: string;
  /** An entity path in the destination scene to stand next to (05 §3.3). */
  near?: string;
}

export interface MoveCharacterDetails {
  character: string;
  name: string;
  layer: string;
  /** The layer they were on before; absent when they had no presence row. */
  from?: string;
  x: number;
  y: number;
  near?: string;
  /** false = idempotent no-op; no event lands (05 §3.7). */
  moved: boolean;
  /** Seating bookkeeping for probes/diagnostics; never part of the event. */
  seat: { gx: number; gy: number; tries: number; exhausted: boolean };
}

export async function moveCharacter(
  ctx: ActionContext,
  input: MoveCharacterInput
): Promise<ActionResult<MoveCharacterDetails>> {
  const { store } = ctx;

  // ---- 1. who is moving (05 §2.4) ----
  const character = await resolveTargetCharacter(ctx, input.character);
  // ---- 2. which layer they are moving to (05 §3.2) ----
  const dest = await resolveDestinationLayer(store, input.destination);
  const current = store.getPresenceOf(character);
  // An entity destination IS an implicit `near` ("walk in and up to this
  // thing", 05 §3.3); an explicit `near` wins.
  const near = input.near ?? (dest.kind === 'entity' ? input.destination : undefined);
  // ---- 3. validate `near` (05 §3.3) ----
  if (near !== undefined) await assertNearInLayer(store, near, dest.layer);
  const name = await readCharacterName(store, character);
  const layerName = await readLayerName(store, dest.layer);

  // ---- 4. idempotence: already there, nothing to walk up to ----
  // "Is he present?" and "where exactly is he standing?" are two questions:
  // the layer answers the first, `near` the second. Re-seating on a bare
  // same-layer move would yank a character who is mid-conversation by the
  // fireplace back to the middle of the frame (doc-06 §2.5, 05 §3.5).
  if (current && current.layer === dest.layer && near === undefined) {
    return {
      text: `${name} is already in "${layerName}".`,
      details: {
        character,
        name,
        layer: dest.layer,
        x: current.x,
        y: current.y,
        moved: false,
        seat: { gx: 0, gy: 0, tries: 0, exhausted: false },
      },
    };
  }

  // ---- 5. seat + write, then land the event ----
  let seat;
  try {
    seat = await store.seatPresence(dest.layer, { near, excludeCharacter: character });
    // `following` omitted = keep the flag: relocating a follower must not
    // silently un-team them (05 §3.4).
    await store.upsertPresence({
      characterId: character,
      layer: dest.layer,
      x: seat.x,
      y: seat.y,
    });
  } catch (err) {
    throw new ActionError({
      code: 'write_failed',
      message: `Failed to move "${character}" to "${dest.layer}": ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  // `from` appears ONLY on a real crossing (05 §5.1 / §10.3-4). A first
  // appearance has no previous layer — filling `map` would be a lie — and a
  // same-layer reposition would render "walked from Baker Street to Baker
  // Street" (05 §3.5).
  const crossed = current !== null && current.layer !== dest.layer;
  let event;
  try {
    event = await store.appendEvent({
      type: 'character_moved',
      actor: ctx.actor,
      turn: ctx.turn,
      subject: dirOfLayer(dest.layer),
      layer: dest.layer,
      detail: {
        character,
        name,
        ...(crossed ? { from: current.layer } : {}),
        to: dest.layer,
        ...(near !== undefined ? { near } : {}),
      },
    });
  } catch (err) {
    throw new ActionError({
      code: 'event_failed',
      message: `Character "${character}" moved to "${dest.layer}" but the world event could not be recorded: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  const note = seat.seat.exhausted ? ' No collision-free spot was found; placed at the last candidate.' : '';
  return {
    text:
      (near !== undefined
        ? `${name} walked into "${layerName}" and now stands near "${near.split('/').pop()}".`
        : `${name} walked into "${layerName}".`) + note,
    details: {
      character,
      name,
      layer: dest.layer,
      ...(current ? { from: current.layer } : {}),
      x: seat.x,
      y: seat.y,
      ...(near !== undefined ? { near } : {}),
      moved: true,
      seat: seat.seat,
      event,
    },
  };
}

registerAction('moveCharacter', (ctx, input) =>
  moveCharacter(ctx, input as unknown as MoveCharacterInput)
);
