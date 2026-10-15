/**
 * doc 05 shared presence helper — the vocabulary `move_to` / `set_following` /
 * `enterLayer` all speak. Registers NO tool itself; `move-to.ts` and
 * `following.ts` are the thin action shells on top of it, `layer.ts` calls
 * `carryFollowers`.
 *
 * Presence lives only in `canvas.db`. Nothing in this file writes a world
 * directory: the two tools move a row, never a `characters/<id>/` folder, and
 * they never start a character process (05 §1 / §3.8).
 */
import type { WorldStore, PresenceRecord } from '../store/world-store.js';
import { dirOfLayer, layerOfDir, MAP_LAYER } from '../store/layers.js';
import { parseFrontmatter } from '../schemas/frontmatter.js';
import type { WorldEvent } from '../schemas/events.js';
import { AGENT_ROLE_ENV } from './actor.js';
import { ActionError, fail } from './errors.js';
import type { ActionContext } from './types.js';

export type { PresenceRecord };

/**
 * Path discipline for `destination` / `near` (05 §7.1 / 01 §7.3), the same
 * four verdicts as 04's `move.ts::assertEntityPath`. It runs in the action
 * layer because `store.statKind` swallows a `resolvePath` failure into
 * `'missing'`, which would turn an illegal path into a misleading `not_found`.
 * `.airpworld/assets/**` is rejected here too: a character does not stand in
 * the asset tree (the store would allow it, 00 §2.5).
 */
export function assertWorldPath(path: string, label = 'destination'): string {
  const rel = path.replace(/^\.\//, '').replace(/\/+$/, '');
  if (rel.startsWith('/') || /^[A-Za-z]:/.test(rel)) {
    fail('invalid_path', `${label} must be world-relative, got "${path}"`);
  }
  if (rel.includes('\\')) {
    fail('invalid_path', `${label} must use POSIX separators, got "${path}"`);
  }
  const segs = rel.split('/').filter((s) => s !== '');
  if (segs.includes('..')) {
    fail('invalid_path', `${label} must not contain "..", got "${path}"`);
  }
  if (segs.some((s) => s.startsWith('.')) || segs.includes('node_modules')) {
    fail('invalid_path', `${label} is inside a reserved directory: "${path}"`);
  }
  return rel;
}

/**
 * The `character` argument's resolution (05 §2.4). The ONLY identity source is
 * `AIRP_AGENT_ROLE` (00 §3): an omitted `character` means "myself" and is legal
 * only for a character agent. A writer has no `actor.id`, so `character ??
 * ctx.actor.id` would silently move a character literally named `undefined`.
 */
export async function resolveTargetCharacter(
  ctx: ActionContext,
  character?: string
): Promise<string> {
  const { store, actor } = ctx;
  if (character !== undefined) {
    if (typeof character !== 'string' || character.trim() === '') {
      fail(
        'invalid_argument',
        `Character id must be a non-empty string, got ${JSON.stringify(character)}`
      );
    }
    if (character.includes('/') || character.includes('\\') || character.startsWith('.')) {
      fail('invalid_argument', `Character must be a character id, not a path: "${character}"`);
    }
    const entries = await store.listFiles(`characters/${character}`);
    if (entries.length === 0) {
      fail('not_found', `Character not found: "characters/${character}"`);
    }
    // A directory that exists but is missing from world.json is a manifest gap,
    // not a reason to refuse: presence is grounded in the real directory
    // (00 §8: no permission gate; doc-20 §1.1: abilities are not gated by role).
    const manifest = await store.getManifest();
    if (!manifest.characters.some((c) => c.id === character)) {
      console.warn(
        `[presence] character "${character}" has a directory but is not listed in world.json characters[]`
      );
    }
    return character;
  }

  if (actor.type === 'character' && actor.id) return actor.id;
  fail(
    'invalid_argument',
    'move_to / set_following need an explicit "character" when the caller is not a character ' +
      `agent (AIRP_AGENT_ROLE=${JSON.stringify(process.env[AGENT_ROLE_ENV] ?? '')}). ` +
      'Writers and the player UI must name the character.'
  );
}

/**
 * The character's display name for event `detail` (05 §3.3 / doc-21 §3.3).
 * Read fresh — never stored in `presence` (a second source of truth would go
 * stale after a rename). A missing / unreadable / directory README degrades to
 * the id, because a missing name must not keep a character off the canvas.
 */
export async function readCharacterName(store: WorldStore, characterId: string): Promise<string> {
  try {
    const raw = await store.readFile(`characters/${characterId}/README.md`);
    const { frontmatter } = parseFrontmatter(raw);
    const name = frontmatter?.name;
    if (typeof name === 'string' && name.trim() !== '') return name.trim();
  } catch {
    // Fall through to the id (05 §7.3).
  }
  return characterId;
}

/** Human-readable layer name for the returned `text` (05 §7.2). */
export async function readLayerName(store: WorldStore, layer: string): Promise<string> {
  try {
    const name = (await store.getManifest()).layers[layer]?.name;
    if (typeof name === 'string' && name.trim() !== '') return name.trim();
  } catch {
    // Stub / nameless layer: fall back to the directory name below.
  }
  return layer === MAP_LAYER ? MAP_LAYER : dirOfLayer(layer).split('/').pop() || layer;
}

/**
 * The three `destination` forms in ONE resolution (05 §3.2): a scene directory,
 * an entity in the current scene, or an entity in another scene. The returned
 * `kind` tells `moveCharacter` whether to imply `near = destination`.
 *
 * Path discipline is checked HERE, not left to the store (05 §7.1 / 01 §7.3):
 * `store.statKind` swallows a `resolvePath` failure into `'missing'`, so
 * without this a destination of `/etc/passwd` or `a/../../x` would report
 * `not_found` instead of the required `invalid_path`. A leading `./` and a
 * trailing `/` are normalized, not rejected (00 §2.1).
 */
export async function resolveDestinationLayer(
  store: WorldStore,
  destination: string
): Promise<{ layer: string; kind: 'layer' | 'entity' }> {
  if (!destination) fail('invalid_argument', 'destination must not be empty');
  const norm = assertWorldPath(destination);
  // `map` is the layer id actually stored in `presence.layer`; callers reading
  // a presence back must be able to hand it straight in (05 §3.2).
  if (norm === MAP_LAYER) return { layer: MAP_LAYER, kind: 'layer' };
  const kind = await store.statKind(norm);
  if (kind === 'dir') {
    const layers = (await store.getManifest()).layers;
    const id = layerOfDir(norm);
    if (!layers[id]) {
      fail('not_found', `Destination is a directory but not a scene: "${destination}"`);
    }
    return { layer: id, kind: 'layer' };
  }
  if (kind === 'missing') {
    fail('not_found', `Destination not found: "${destination}"`);
  }

  // A file: it must sit inside the layer tree (`player/**` and
  // `characters/<id>/**` are not scenes — a character cannot stand in a bag).
  const layer = await store.resolveLayer(norm);
  if (layer === null) {
    fail(
      'invalid_argument',
      `Destination must be a scene directory or an entity inside world/: "${destination}" ` +
        '(player/ and characters/<id>/ are not scenes)'
    );
  }
  return { layer, kind: 'entity' };
}

/**
 * `near` validation, word-for-word the same three verdicts as 04 §2.3
 * (`not_found` / `near_out_of_layer` ×2) — one concept must not grow two sets of
 * codes (05 §3.3).
 */
export async function assertNearInLayer(
  store: WorldStore,
  near: string,
  layer: string
): Promise<void> {
  const norm = assertWorldPath(near, 'near');
  const kind = await store.statKind(norm);
  if (kind === 'missing') {
    fail('not_found', `near not found: "${near}"`);
  }
  if (kind === 'dir') {
    fail('near_out_of_layer', `near must be an entity path, not a layer directory: "${near}"`);
  }
  const nearLayer = await store.resolveLayer(norm);
  if (nearLayer !== layer) {
    fail('near_out_of_layer', `near "${near}" is not in the destination layer "${layer}"`);
  }
}

/**
 * `world.json` `characters[].home` → the layer a never-placed character lands
 * on when they start following (05 §3.6.1). Missing home, or a home that is not
 * a real layer, degrades to `map` — the one layer that always exists
 * (`layers.ts` root) — with `fromHome:false` so the caller can say so.
 */
export async function resolveHome(
  store: WorldStore,
  characterId: string
): Promise<{ layer: string; fromHome: boolean }> {
  try {
    const manifest = await store.getManifest();
    const home = manifest.characters.find((c) => c.id === characterId)?.home;
    if (typeof home === 'string' && home !== '' && manifest.layers[home]) {
      return { layer: home, fromHome: true };
    }
    if (typeof home === 'string' && home !== '') {
      console.warn(
        `[presence] character "${characterId}" home "${home}" is not a layer; falling back to "${MAP_LAYER}"`
      );
    }
  } catch {
    // No manifest at all: `map` is still the honest answer.
  }
  return { layer: MAP_LAYER, fromHome: false };
}

/**
 * Move every FOLLOWING character into the layer the player just entered
 * (05 §3.6.2). Callers: `enterLayer`, AFTER it lands `layer_entered`, inside the
 * same `turn` — the reader must see "the player entered X, then Watson came
 * along", never the reverse.
 *
 * One follower's failure never blocks the others (05 §5.5): the failure is
 * collected in `failures` so `enterLayer` can surface it — a character left
 * behind must be visible, never silent.
 */
export async function carryFollowers(
  ctx: ActionContext,
  toLayer: string
): Promise<{ moved: PresenceRecord[]; failures: Array<{ character: string; reason: string }> }> {
  const followers = ctx.store
    .getPresence()
    .filter((p) => p.following && p.layer !== toLayer);
  const moved: PresenceRecord[] = [];
  const failures: Array<{ character: string; reason: string }> = [];

  for (const f of followers) {
    try {
      const seat = await ctx.store.seatPresence(toLayer, { excludeCharacter: f.characterId });
      // `following` omitted = keep this column untouched (05 §3.6.2 detail 1).
      const row = await ctx.store.upsertPresence({
        characterId: f.characterId,
        layer: toLayer,
        x: seat.x,
        y: seat.y,
      });
      await ctx.store.appendEvent({
        type: 'character_moved',
        actor: { type: 'engine' },
        turn: ctx.turn,
        subject: dirOfLayer(toLayer),
        layer: toLayer,
        detail: {
          character: f.characterId,
          name: await readCharacterName(ctx.store, f.characterId),
          from: f.layer,
          to: toLayer,
        },
      });
      moved.push(row);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(`[presence] follower "${f.characterId}" could not follow into "${toLayer}": ${reason}`);
      failures.push({ character: f.characterId, reason });
    }
  }
  return { moved, failures };
}

/**
 * The `following_changed` event (05 §5.2). `detail` carries exactly the three
 * frozen keys `{ character, name, following }` — no `layer`, no `x`/`y`: the
 * sentence "Watson starts following you" has no place in it, and the field-name
 * table in 00 §5.2 is a contract.
 */
export async function appendFollowingChanged(
  ctx: ActionContext,
  a: { character: string; name: string; following: boolean; layer: string | null }
): Promise<WorldEvent> {
  try {
    return await ctx.store.appendEvent({
      type: 'following_changed',
      actor: ctx.actor,
      turn: ctx.turn,
      subject: `characters/${a.character}/README.md`,
      layer: a.layer ?? undefined,
      detail: { character: a.character, name: a.name, following: a.following },
    });
  } catch (err) {
    throw new ActionError({
      code: 'event_failed',
      message: `Following state for "${a.character}" was changed but the world event could not be recorded: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}
