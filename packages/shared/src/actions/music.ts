/**
 * `set_music`: the writer — or the author in the
 * workshop's music picker — changes what plays, for good (a reload and a
 * rollback read the files):
 *
 *   - `layer: 'world'` → world.json `audio.theme` (the world-wide theme);
 *   - `layer: 'current'` (default) / `map` / `world/...` → that place's README
 *     frontmatter `bgm:` (and `ambient:`). A place with its own track rests the
 *     world theme while the player is there.
 *
 * `track` is a catalog id (rules/music.ts), `silence`, or `default` (drop the
 * place's declaration → it inherits the map README / the world theme; for the
 * world: back to its type's default theme). `ambient` is a catalog id, `none`
 * or `default`. Anything else is refused with the list of valid ids, so a
 * made-up name never reaches a file.
 *
 * One `music_changed` event per real change: the page refetches the layer (as
 * for every world event) and, for the world theme, the manifest — the audio
 * engine crossfades on its own. No change → no write, no event.
 */
import type { WorldEvent } from '../schemas/events.js';
import { parseFrontmatter, stringifyFrontmatter } from '../schemas/frontmatter.js';
import {
  AMBIENT_CATALOG,
  AMBIENT_NONE,
  AUDIO_DEFAULT,
  MUSIC_CATALOG,
  MUSIC_SILENCE,
  isAmbientId,
  isMusicId,
} from '../rules/music.js';
import { worldTypeOf } from '../rules/themes.js';
import { ActionError } from './errors.js';
import { layerReadmeOf } from './scene-media.js';
import { registerAction } from './service.js';
import type { ActionContext, ActionResult } from './types.js';

export interface SetMusicInput {
  /** `current` (default) = the player's place; `world` = the world theme; or `map` / `world/...`. */
  layer?: string;
  /** Catalog id | `silence` | `default`. */
  track?: string;
  /** Catalog id | `none` | `default`; omitted = leave the bed as it is. */
  ambient?: string;
  /** Why, in a few words (the event and the writer's log keep it). */
  reason?: string;
}

export interface SetMusicDetails {
  scope: 'world' | 'layer';
  /** `map` / `world/...` for a place; absent for the world theme. */
  layer?: string;
  /** The file written: `world.json` or the place's README. */
  file: string;
  /** The value now declared (`undefined` = no declaration: inherited / the type default). */
  music?: string | null;
  ambient?: string | null;
  previous: { music?: string | null; ambient?: string | null };
  changed: boolean;
  event?: WorldEvent;
}

const REASON_MAX = 160;

function invalid(message: string): never {
  throw new ActionError({ code: 'invalid_argument', message });
}

const musicIds = () => MUSIC_CATALOG.map((t) => t.id).join(', ');
const ambientIds = () => AMBIENT_CATALOG.map((t) => t.id).join(', ');

function trackOf(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  const v = String(raw).trim();
  if (v === '') return undefined;
  if (v === MUSIC_SILENCE || v === AUDIO_DEFAULT || isMusicId(v)) return v;
  return invalid(`set_music: track "${v}" is not in the music catalog. Use one of: ${musicIds()}; or "silence" / "default".`);
}

function ambientOf(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  const v = String(raw).trim();
  if (v === '') return undefined;
  if (v === AMBIENT_NONE || v === AUDIO_DEFAULT || isAmbientId(v)) return v;
  return invalid(`set_music: ambient "${v}" is not in the ambient catalog. Use one of: ${ambientIds()}; or "none" / "default".`);
}

function playerLayer(ctx: ActionContext): string {
  try {
    return ctx.store.readViewpoint()?.layer ?? 'map';
  } catch {
    return 'map';
  }
}

const declared = (fm: Record<string, unknown>, key: string): string | null | undefined =>
  key in fm ? (typeof fm[key] === 'string' ? (fm[key] as string) : null) : undefined;

export async function setMusic(ctx: ActionContext, input: SetMusicInput): Promise<ActionResult<SetMusicDetails>> {
  const { store } = ctx;
  if (ctx.actor.type === 'character') {
    throw new ActionError({ code: 'unsupported', message: 'set_music is for the writer: characters do not choose the music' });
  }
  const track = trackOf(input?.track);
  const ambient = ambientOf(input?.ambient);
  if (track === undefined && ambient === undefined) invalid('set_music: name a `track` (or an `ambient`) to change');
  const reason = typeof input?.reason === 'string' && input.reason.trim() ? input.reason.trim().slice(0, REASON_MAX) : undefined;
  const where = String(input?.layer ?? 'current').trim() || 'current';

  // ——— the world theme ———
  if (where === 'world') {
    if (ambient !== undefined) invalid('set_music: a world has no ambient bed — set `ambient` on a place (layer "current" / "map")');
    const manifest = await store.getManifest();
    const previous = manifest.audio?.theme;
    let next: string | undefined = track;
    if (track === AUDIO_DEFAULT) {
      next = worldTypeOf((manifest as { theme?: { type?: string } }).theme?.type)?.audioTheme;
      if (!next) invalid('set_music: this world has no type default theme — name a track from the catalog');
    }
    if (next === previous) {
      return { text: `The world theme is already "${previous}".`, details: { scope: 'world', file: 'world.json', music: previous ?? null, previous: { music: previous ?? null }, changed: false } };
    }
    await store.updateManifest({ audio: { ...(manifest.audio ?? {}), theme: next } });
    const event = await store.appendEvent({
      type: 'music_changed',
      actor: ctx.actor,
      subject: 'world.json',
      turn: ctx.turn,
      detail: { scope: 'world', name: manifest.name ?? 'the world', music: next ?? null, ...(reason ? { reason } : {}) },
    });
    return {
      text: next === MUSIC_SILENCE ? 'The world theme is now silence.' : `The world theme is now "${next}".`,
      details: { scope: 'world', file: 'world.json', music: next ?? null, previous: { music: previous ?? null }, changed: true, event },
    };
  }

  // ——— one place ———
  const place = layerReadmeOf(where === 'current' ? playerLayer(ctx) : where);
  if (!place) invalid(`set_music: layer "${where}" must be "current", "world", "map" or a world/... layer`);
  if ((await store.statKind(place.readme)) !== 'file') {
    throw new ActionError({ code: 'not_found', message: `set_music: layer "${place.layer}" has no README.md` });
  }
  const parsed = parseFrontmatter(await store.readFile(place.readme));
  const fm: Record<string, unknown> = { ...(parsed.frontmatter ?? {}) };
  const previous = { music: declared(fm, 'bgm'), ambient: declared(fm, 'ambient') };
  const apply = (key: 'bgm' | 'ambient', value: string | undefined) => {
    if (value === undefined) return;
    if (value === AUDIO_DEFAULT) delete fm[key];
    else fm[key] = value;
  };
  apply('bgm', track);
  apply('ambient', ambient);
  const now = { music: declared(fm, 'bgm'), ambient: declared(fm, 'ambient') };
  const name = typeof fm.name === 'string' && fm.name.trim()
    ? fm.name.trim()
    : typeof fm.title === 'string' && fm.title.trim() ? fm.title.trim() : place.layer.split('/').pop() ?? place.layer;
  if (now.music === previous.music && now.ambient === previous.ambient) {
    return {
      text: `${name} already has that music.`,
      details: { scope: 'layer', layer: place.layer, file: place.readme, ...now, previous, changed: false },
    };
  }
  await store.writeFileAtomic(place.readme, stringifyFrontmatter(fm, parsed.body));
  const event = await store.appendEvent({
    type: 'music_changed',
    actor: ctx.actor,
    subject: place.readme,
    layer: place.layer,
    turn: ctx.turn,
    detail: {
      scope: 'layer',
      layer: place.layer,
      name,
      ...(track !== undefined ? { music: track } : {}),
      ...(ambient !== undefined ? { ambient } : {}),
      ...(reason ? { reason } : {}),
    },
  });
  const said = [
    track === undefined ? null : track === AUDIO_DEFAULT ? 'music back to the world theme' : track === MUSIC_SILENCE ? 'music silent' : `music "${track}"`,
    ambient === undefined ? null : ambient === AUDIO_DEFAULT ? 'ambient inherited' : ambient === AMBIENT_NONE ? 'no ambient' : `ambient "${ambient}"`,
  ].filter(Boolean).join(', ');
  return {
    text: `${name}: ${said}.`,
    details: { scope: 'layer', layer: place.layer, file: place.readme, ...now, previous, changed: true, event },
  };
}

registerAction('setMusic', (ctx, input) => setMusic(ctx, input as SetMusicInput));
