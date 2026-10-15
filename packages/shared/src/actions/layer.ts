/**
 * doc 11 / doc 12 — the layer lifecycle actions.
 *
 *   enterLayer            (C entry: the player double-clicks a scene gate)
 *   recordLayerInitialized (E entry: a scene/nook initializer finished)
 *   recordLayerInitFailed  (E entry: it failed and fell back to a template)
 *
 * `layer_entered` exists only because changing scene is narratively meaningful
 * (doc-21 §4.4) — it is the ONE viewpoint-class event. Everything else about
 * "where the camera is" lives in `canvas.db` and is never an event.
 *
 * `recordLayerInitFailed` is the sole exception to "failure appends nothing"
 * (doc-21 §3.6): the failure IS the fact consumers need.
 */
import type { WorldEvent } from '../schemas/events.js';
import type { PresenceRecord } from '../store/world-store.js';
import { parseFrontmatter } from '../schemas/frontmatter.js';
import { ActionError } from './errors.js';
import { registerAction } from './service.js';
import { actorLabel } from './actor.js';
import { carryFollowers } from './presence.js';
import { runPassiveChecks, type PassiveRun } from './passive.js';
import { commandDetail } from './types.js';
import type { ActionContext, ActionResult } from './types.js';

/** The layer id a directory maps to, mirroring store/layers.ts (`world/` → `map`). */
function layerIdOf(dir: string): string {
  return dir === 'world' ? 'map' : dir;
}

/** The human name of a layer: its README `name`, else the directory basename. */
async function layerNameOf(ctx: ActionContext, layer: string, dir: string): Promise<string> {
  try {
    const raw = await ctx.store.readFile(`${dir}/README.md`);
    const { frontmatter } = parseFrontmatter(raw);
    const name = frontmatter?.name;
    if (typeof name === 'string' && name.trim() !== '') return name;
  } catch {
    // A stub layer has no README — fall through to the directory name.
  }
  return dir.split('/').pop() ?? layer;
}

// ————————————————————————— enterLayer —————————————————————————

export interface EnterLayerInput {
  /** The layer id (== its directory, world-relative; `map` for `world/`). */
  layer: string;
}

/**
 * The followers that travelled with the player (05 §3.6.2 / the design notes).
 * `failures` is never swallowed: a character left behind MUST be visible to the
 * caller, which surfaces it to the player.
 */
export interface CarryFollowersResult {
  moved: PresenceRecord[];
  failures: Array<{ character: string; reason: string }>;
}

export interface EnterLayerDetails {
  layer: string;
  name: string;
  first: boolean;
  event: WorldEvent;
  followers: CarryFollowersResult;
  /** Passive checks rolled on the way in: only what was found. */
  passive?: PassiveRun;
}

export async function enterLayer(
  ctx: ActionContext,
  input: EnterLayerInput
): Promise<ActionResult<EnterLayerDetails>> {
  const { layer } = input;
  if (!layer || layer.trim() === '') {
    throw new ActionError({ code: 'invalid_argument', message: 'A layer id is required.' });
  }

  // `first: true` means this scene has never existed before (doc-21 §4.4): a
  // stub layer is one whose directory has no README yet (doc-11 §3.1). The
  // frontend can then suppress its own duplicate `layer_initialized` line.
  const dir = layer === 'map' ? 'world' : layer;
  const readme = await ctx.store.statKind(`${dir}/README.md`);
  const first = readme === 'missing';

  const name = await layerNameOf(ctx, layer, dir);

  const event = await ctx.store.appendEvent({
    type: 'layer_entered',
    actor: ctx.actor,
    detail: { layer, name, first, ...commandDetail(ctx) },
    subject: layer,
    layer,
    turn: ctx.turn,
  });

  // Order is NOT swappable (05 §3.6.2): `layer_entered` lands first so the
  // history reads "the player entered X, then Watson came along" — never the
  // reverse. An engine failure here must not fail the entry: the player IS in
  // the new layer and `layer_entered` is already on record, so throwing would
  // fork the world from the UI. It is folded into `failures` instead.
  let followers: CarryFollowersResult = { moved: [], failures: [] };
  try {
    followers = await carryFollowers(ctx, layer);
  } catch (err) {
    followers = {
      moved: [],
      failures: [{ character: '*', reason: err instanceof Error ? err.message : String(err) }],
    };
  }

  // Passive checks (the player's, after the followers arrived so a companion's number counts). Never throws.
  const passive = await runPassiveChecks(ctx, { trigger: 'enter', layer });

  return {
    text: first
      ? `${actorLabel(ctx.actor)} stepped into "${name}" for the first time (${layer}).`
      : `${actorLabel(ctx.actor)} moved to "${name}" (${layer}).`,
    details: { layer, name, first, event, followers, ...(passive.found.length > 0 ? { passive } : {}) },
  };
}

// ————————————— recordLayerInitialized / Failed —————————————

export interface RecordLayerInitializedInput {
  layer: string;
  by: 'writer' | 'player' | 'engine';
  /** The files the initializer landed (world-relative). */
  files: string[];
}

export interface RecordLayerInitializedDetails {
  layer: string;
  name: string;
  files: string[];
  event: WorldEvent;
}

export async function recordLayerInitialized(
  ctx: ActionContext,
  input: RecordLayerInitializedInput
): Promise<ActionResult<RecordLayerInitializedDetails>> {
  const { layer, by, files } = input;
  if (!layer || layer.trim() === '') {
    throw new ActionError({ code: 'invalid_argument', message: 'A layer id is required.' });
  }
  const dir = layer === 'map' ? 'world' : layer;
  const name = await layerNameOf(ctx, layer, dir);

  // Initialization always runs as the engine, regardless of who triggered it:
  // the fact recorded is "this scene came into being", not "X typed something".
  const event = await ctx.store.appendEvent({
    type: 'layer_initialized',
    actor: { type: 'engine' },
    detail: { layer, name, by, files: files ?? [] },
    subject: layer,
    layer,
    turn: ctx.turn,
  });

  return {
    text: `"${name}" (${layer}) was instantiated by ${by}: ${(files ?? []).length} file(s).`,
    details: { layer, name, files: files ?? [], event },
  };
}

export interface RecordLayerInitFailedInput {
  layer: string;
  reason: string;
  fallback: 'template' | 'none';
}

export interface RecordLayerInitFailedDetails {
  layer: string;
  reason: string;
  fallback: 'template' | 'none';
  event: WorldEvent;
}

export async function recordLayerInitFailed(
  ctx: ActionContext,
  input: RecordLayerInitFailedInput
): Promise<ActionResult<RecordLayerInitFailedDetails>> {
  const { layer, reason, fallback } = input;
  if (!layer || layer.trim() === '') {
    throw new ActionError({ code: 'invalid_argument', message: 'A layer id is required.' });
  }
  const dir = layer === 'map' ? 'world' : layer;
  const name = await layerNameOf(ctx, layer, dir);

  // The ONE action that appends an event while reporting failure (doc-21 §3.6).
  const event = await ctx.store.appendEvent({
    type: 'layer_init_failed',
    actor: { type: 'engine' },
    detail: { layer, name, reason, fallback },
    subject: layer,
    layer,
    turn: ctx.turn,
  });

  return {
    text: `"${name}" (${layer}) failed to materialize: ${reason} (fallback: ${fallback}).`,
    details: { layer, reason, fallback, event },
  };
}

registerAction('enterLayer', (ctx, input) => enterLayer(ctx, input as unknown as EnterLayerInput));
registerAction('recordLayerInitialized', (ctx, input) =>
  recordLayerInitialized(ctx, input as unknown as RecordLayerInitializedInput)
);
registerAction('recordLayerInitFailed', (ctx, input) =>
  recordLayerInitFailed(ctx, input as unknown as RecordLayerInitFailedInput)
);
