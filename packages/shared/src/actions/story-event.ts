/**
 * Story events — what a roll (or any world command) made HAPPEN, landed on a
 * character, an item or a place
 *
 *
 * An event is narration with an address. The command's other effects change the
 * world (a card edited, an item given, a door opened); this one says, in words,
 * what just happened and to whom:
 *   - the player sees it as an event card;
 *   - it is recorded in the layer where it happened, so every agent whose turn
 *     reads that layer's events — the writer, and the characters standing there —
 *     reads it next turn. For a CHARACTER that layer is where they are now, so
 *     "老莫 saw you read his logbook" reaches 老莫, and he answers accordingly.
 * No memory file is written: the character's own continuity summary keeps what
 * they were told, the same way it keeps what was said to them.
 */
import { parseFrontmatter } from '../schemas/frontmatter.js';
import { characterFormOf } from '../rules/character-form.js';
import { layerOfPath } from '../store/layers.js';
import { ActionError } from './errors.js';
import type { ActionContext } from './types.js';
import type { WorldEvent } from '../schemas/events.js';

export type StoryEventKind = 'character' | 'item' | 'place';

export interface StoryEventInput {
  /** `characters/<id>`, a layer directory (`world/...` or `map`), or an entity path. */
  target: string;
  title: string;
  text: string;
  /** A character-tick move (actions/tick.ts): who did what, and how it ended. */
  tick?: StoryEventTick;
  /** A companion hint (actions/hints.ts): the hint id. The line was SAID by the target, not done to it. */
  hint?: string;
  /** A passive check that succeeded (actions/passive.ts): which, whose number, the grade. */
  passive?: StoryEventPassive;
  /** The player's inspiration roll (actions/inspiration.ts): the tier and the hint it reached. */
  inspiration?: StoryEventInspiration;
}

export interface StoryEventPassive {
  id: string;
  file: string;
  skill: string;
  /** `player` or the companion who rolled it. */
  by: string;
  grade: string;
}

export interface StoryEventInspiration {
  grade: string;
  outcome: string;
  result: number;
  target: number;
  hint?: string;
}

export interface StoryEventTick {
  actor: string;
  move: string;
  verb: string;
  target: string;
  result: 'landed' | 'stopped' | 'void' | 'said';
  by?: string;
  /** v2: the person's own words — a claim, never a fact. */
  claim?: { say?: string; invite?: string; note?: string };
}

const CHARACTER_RE = /^characters\/([a-z0-9][a-z0-9-]*)\/?$/;

/** Where the event lands, what it is about, and the name to show. */
async function resolveTarget(
  ctx: ActionContext,
  target: string,
): Promise<{ kind: StoryEventKind; layer: string; name: string; path: string }> {
  const { store } = ctx;
  const manifest = await store.getManifest();
  const character = CHARACTER_RE.exec(target);
  if (character) {
    const id = character[1];
    const config = manifest.characters.find((c) => c.id === id);
    if (!config) {
      throw new ActionError({ code: 'not_found', message: `No character "${id}" in world.json characters.` });
    }
    const layer = store.getPresenceOf(id)?.layer ?? config.home ?? 'map';
    // A character in another form shows that form's name.
    let name = config.name ?? id;
    try {
      const formName = characterFormOf(parseFrontmatter(await store.readFile(`characters/${id}/README.md`)).frontmatter)?.name;
      if (formName) name = formName;
    } catch { /* no README: the world.json name */ }
    return { kind: 'character', layer, name, path: `characters/${id}` };
  }
  const path = target.replace(/\/+$/, '');
  if (path === 'map' || path === 'world') {
    return { kind: 'place', layer: 'map', name: await readmeName(ctx, 'world/README.md', 'map'), path: 'world' };
  }
  const kind = await store.statKind(path);
  if (kind === 'dir') {
    if ((await store.statKind(`${path}/README.md`)) !== 'file') {
      throw new ActionError({ code: 'not_found', message: `"${path}" is not a place (it has no README.md).` });
    }
    return { kind: 'place', layer: path, name: await readmeName(ctx, `${path}/README.md`, path), path };
  }
  if (kind === 'file') {
    return { kind: 'item', layer: layerOfPath(path, manifest.layers), name: await readmeName(ctx, path, path), path };
  }
  throw new ActionError({ code: 'not_found', message: `Event target not found: "${target}"` });
}

async function readmeName(ctx: ActionContext, path: string, fallback: string): Promise<string> {
  const fm = parseFrontmatter(await ctx.store.readFile(path)).frontmatter ?? {};
  for (const key of ['name', 'title']) {
    if (typeof fm[key] === 'string' && fm[key].trim()) return fm[key].trim();
  }
  return fallback.split('/').pop()?.replace(/\.md$/, '') ?? fallback;
}

/** Record one story event. Returns the appended world event. */
export async function recordStoryEvent(ctx: ActionContext, input: StoryEventInput): Promise<WorldEvent> {
  const title = String(input.title ?? '').trim();
  const text = String(input.text ?? '').trim();
  if (!title || !text) {
    throw new ActionError({ code: 'invalid_argument', message: 'A story event needs a title and a text.' });
  }
  const where = await resolveTarget(ctx, String(input.target ?? '').trim());
  return ctx.store.appendEvent({
    type: 'story_event',
    actor: ctx.actor,
    subject: where.path,
    layer: where.layer,
    turn: ctx.turn,
    detail: { target: where.path, kind: where.kind, name: where.name, title, text, ...(input.tick ? { tick: { ...input.tick } } : {}), ...(input.hint ? { hint: input.hint } : {}), ...(input.passive ? { passive: { ...input.passive } } : {}), ...(input.inspiration ? { inspiration: { ...input.inspiration } } : {}) },
  });
}
