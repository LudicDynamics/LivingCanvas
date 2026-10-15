/**
 * 03 — WorldEvent -> one-line English statement (doc 03 §3.2), the four doc-21
 * §5.4 merges (doc 03 §3.5), and the cap fold.
 *
 * Pure: no I/O, no clock, never throws. Both readers (writer extension and the
 * character's server-side path) share it — the difference between them is WHICH
 * events they read (doc 00 §6.1), never how a sentence is phrased (doc 03 §2.2
 * 口径 1: no `role` parameter).
 */
import type { Actor } from '../actions/actor.js';
import type { WorldEvent, WorldEventType } from '../schemas/events.js';
import { dirOfLayer, MAP_LAYER } from '../store/layers.js';
import { sanitiseForBlock } from './sanitise.js';
import { COMMAND_ID_RE } from '../commands/limits.js';

/** The raw read, owned by the injector (01). Declared HERE (not in
 *  inject/collect.ts) so the dependency is one-way: collect -> render. The
 *  reverse would be a runtime cycle (collect imports the runtime renderer). */
export interface EventSlice {
  /** Chronological, oldest -> newest. `getEventsSince` is ASC by seq. */
  events: WorldEvent[];
  /** True when the reader had no cursor row and this is the layer "latest N"
   *  fallback (doc-21 §5.2). */
  coldStart: boolean;
}

/** One surviving line of the window. Superset of 04's `NextStepEvent`
 *  (04 re-exports `Pick<EventWindowLine, 'type' | 'layer' | 'name' | 'actor'>`). */
export interface EventWindowLine {
  /** Representative type of the (possibly merged) group. */
  type: WorldEventType;
  /** The group's layer. NON-NULL for the three `layer_*` types. */
  layer: string | null;
  /** detail.name / detail.itemName when the type carries one. */
  name?: string;
  /** The group's author (`g.events[0].actor`). 04 gates its interactive-tail
   *  case on `actor.type !== 'writer'` (A-12). */
  actor: Actor;
  /** 1 unless rule 1 merged N same-turn + same-type + same-actor events. */
  count: number;
  /** Grouping key for tests: `event.subject ?? detail.path ?? detail.to ?? null`. */
  subject: string | null;
  /** The rendered English sentence. Bare — no bullet, no indent, no newline. */
  text: string;
  /** NEW — 10 §2.3. The producing world command id, when this WHOLE group came
   *  from one. Absent for every ordinary event (never set to ''), so
   *  `'command' in line` is false in the common case — same discipline as
   *  `name` (see the `OUT` step). */
  command?: string;
}

export interface EventWindow {
  /** Merged + capped bare sentences, chronological. Does NOT include `tail`. */
  lines: string[];
  /** `…and N more (older events omitted)`, WITHOUT indent/bullet; null when
   *  nothing was dropped. Split out because 02 renders it at another indent. */
  tail: string | null;
  /** The surviving window after all four merges, chronological (04 projects it). */
  events: EventWindowLine[];
  /** = lines removed by the cap. */
  dropped: number;
  /** Events whose detail failed to render and fell back to a generic sentence. */
  malformed: number;
}

/** Types for which rule-1 merging would LIE ("N independent actions", not one
 *  bulk action). `character_moved` is here because `carryFollowers` lands one
 *  per follower (A-11). */
export const MERGE_EXEMPT: readonly WorldEventType[] = [
  'roll_resolved',
  'choice_selected',
  'layer_entered',
  'layer_initialized',
  'layer_init_failed',
  'following_changed',
  'character_moved',
  // Each story event is its own thing that happened; "3 things happened" says nothing.
  'story_event',
  // Each picture shown / scene changed is its own moment (actions/scene-media.ts).
  'cg_shown',
  'background_swapped',
  'music_changed',
  // Each line / mark on the player's clue board is its own deduction.
  'player_board_changed',
  // One per loop; never "the world looped 2 times".
  'loop_reset',
];

/** detail fields that reach a sentence and may carry world-file / god-action
 *  text (00 §14). Sanitised once, BEFORE the templates (03 §3.1 rule 4). */
const SANITISED_FIELDS = [
  'name',
  'path',
  'itemName',
  'targetName',
  'choice',
  'desc',
  'near',
  'snapshot',
  'from',
  'to',
  'item',
  'target',
  'layer',
  'reason',
  'caption',
  'fromName',
  'toName',
  'label',
] as const;

const FIELD_CAP = 120;
/** The final sentence cap (03 §3.1 rule 4). */
const SENTENCE_CAP = 300;

type Detail = Record<string, any>;

interface Group {
  turn: string | null;
  type: WorldEventType;
  actor: Actor;
  events: WorldEvent[];
  count: number;
  /** True while this group is the tail of an unbroken (turn,type,actor) run. */
  open: boolean;
  layer: string | null;
  name?: string;
  subject: string | null;
  text: string;
}

function actorKey(actor: Actor): string {
  return `${actor.type}:${actor.id ?? ''}`;
}

function str(d: Detail, key: string): string | null {
  const v = d[key];
  return typeof v === 'string' ? v : null;
}

function num(d: Detail, key: string): number | null {
  const v = d[key];
  return typeof v === 'number' ? v : null;
}

function bool(d: Detail, key: string): boolean | null {
  const v = d[key];
  return typeof v === 'boolean' ? v : null;
}

/** The single generic fallback sentence (03 §3.5.2); `type` is sanitised too. */
function malformedSentence(type: string): string {
  return `An unrecorded kind of change happened (${sanitiseForBlock(type, {
    maxLength: FIELD_CAP,
  })}).`;
}

/** `'The player' | 'The narrator' | 'The world itself' | 'the character "<id>"' | 'The engine'`. */
export function actorPhrase(actor: Actor): string {
  switch (actor.type) {
    case 'player':
      return 'The player';
    case 'writer':
      return 'The narrator';
    case 'god':
      return 'The world itself';
    case 'character':
      return `the character "${actor.id ?? ''}"`;
    case 'engine':
      return 'The engine';
    case 'functional':
      return 'The canvas arranger';
  }
}

/**
 * The command that produced this event, or null. The ONE authority for
 * "the world did this by rule, not by hand" (10 §2.1).
 *
 * Reads `detail.command` ONLY. `detail.by` is NOT consulted: it is already
 * taken by `layer_initialized` as a closed enum (schemas/events.ts:99), and
 * reusing it would be a second truth source.
 *
 * Pure and total: never throws. `detail` is `Record<string, any>` off a JSON
 * column, and the injection block may never fail a turn (hooks/00 §11).
 * An illegal value is NOT an error — it degrades to "ordinary event".
 */
export function commandOf(event: WorldEvent): string | null {
  const raw = ((event?.detail ?? {}) as Detail)['command'];
  // The id grammar is `01`'s, reused rather than re-declared (10 §2.1: the
  // field is a judgement key, so "which strings are legal" has ONE home).
  return typeof raw === 'string' && COMMAND_ID_RE.test(raw) ? raw : null;
}

/**
 * The sentence subject. For an ordinary event this is EXACTLY `actorPhrase`
 * (so every existing golden holds byte-for-byte). For an event produced by a
 * world command it names the WORLD as executor and keeps the actor as cause
 * (10 §3.6):
 *
 *   subjectPhrase({type:'player'},    'investigate-clue') -> 'The world, after the player acted,'
 *   subjectPhrase({type:'writer'},    'investigate-clue') -> 'The world, after the narrator acted,'
 *   subjectPhrase({type:'god'},       'investigate-clue') -> 'The world, after the world itself acted,'
 *   subjectPhrase({type:'character', id:'watson'}, 'x')   -> 'The world, after the character "watson" acted,'
 *   subjectPhrase(a, null)                                -> actorPhrase(a)          // unchanged
 *
 * Pure; never throws. Only the PRESENCE of `command` matters — the id itself is
 * never printed (10 §2.1: it is a judgement key, not narrative).
 *
 * `10` §2.5 keeps a `lowerFirst` helper so every arm reads as one assembly
 * path; it is the IDENTITY for the `character` arm and only lowers the first
 * letter of the other five, so it is folded into the one line below rather
 * than declared as a second name.
 */
function subjectPhrase(actor: Actor, command: string | null): string {
  if (command === null) return actorPhrase(actor);
  const cause = actorPhrase(actor);
  return `The world, after ${cause.charAt(0).toLowerCase()}${cause.slice(1)} acted,`;
}

/** Pure. `path` is world-root relative, POSIX. Never stats, never reads. */
export function pathPhrase(path: string): string {
  if (path.startsWith('player/')) return "the player's bag";
  const m = /^characters\/([^/]+)\//.exec(path);
  if (m) return `the character "${m[1]}"`;
  return path;
}

/**
 * A layer id -> its human place name. Pure; `names` is the manifest map carried
 * in `opts` (never re-read here). Same fallback chain as
 * `presence.ts::readLayerName`; `map` (the virtual root) -> `the world map`.
 */
export function layerPhrase(layerId: string, names: Record<string, string>): string {
  const named = names[layerId];
  if (typeof named === 'string' && named.trim() !== '') return named.trim();
  if (layerId === MAP_LAYER) return 'the world map';
  const dir = dirOfLayer(layerId);
  const last = dir.split('/').pop();
  return last && last !== '' ? last : layerId;
}

/** Sanitise every dynamic field once (03 §3.1 rule 4), returning a new event. */
function sanitiseEvent(e: WorldEvent): WorldEvent {
  const detail = (e.detail ?? {}) as Detail;
  const clean: Detail = { ...detail };
  for (const f of SANITISED_FIELDS) {
    if (typeof clean[f] === 'string') {
      clean[f] = sanitiseForBlock(clean[f], { maxLength: FIELD_CAP });
    }
  }
  return { ...e, detail: clean };
}

/**
 * The template body. `ok: false` marks a structural hole (unknown type or a
 * missing contract field) that the caller counts into `malformed`.
 * `text === ''` means "deliberately not injected" (`world_snapshot`).
 */
function renderEventChecked(
  event: WorldEvent,
  opts: { layerNames: Record<string, string> }
): { text: string; ok: boolean } {
  const d = (event.detail ?? {}) as Detail;
  const S = subjectPhrase(event.actor, commandOf(event));
  // Layer names come from world files (`opts.layerNames`), so the phrase is
  // folded at the seam before it enters a sentence (03 §3.3.1: `layerPhrase`
  // only picks the word; the projection step sanitises it).
  const L = (id: string): string =>
    sanitiseForBlock(layerPhrase(id, opts.layerNames), { maxLength: FIELD_CAP });
  const bad = (): { text: string; ok: boolean } => ({
    text: malformedSentence(event.type),
    ok: false,
  });

  switch (event.type) {
    case 'entity_created': {
      const path = str(d, 'path');
      if (path === null) return bad();
      const name = str(d, 'name') ?? pathPhrase(path);
      const P = pathPhrase(path);
      switch (str(d, 'kind')) {
        case 'chalk':
          return { text: `${S} wrote a new page: "${name}" (${P}).`, ok: true };
        case 'component':
          return { text: `${S} placed a prop: "${name}" (${P}).`, ok: true };
        case 'letter':
          return { text: `${S} left a letter: "${name}" (${P}).`, ok: true };
        case 'note':
          return { text: `${S} left a note: "${name}" (${P}).`, ok: true };
        default:
          // Open enum: an unknown kind falls to `other`, never a throw.
          return { text: `${S} created "${name}" (${P}).`, ok: true };
      }
    }

    case 'entity_edited': {
      const path = str(d, 'path');
      if (path === null) return bad();
      const name = str(d, 'name') ?? pathPhrase(path);
      const P = pathPhrase(path);
      return str(d, 'kind') === 'chalk'
        ? { text: `${S} revised "${name}" (${P}).`, ok: true }
        : { text: `${S} edited "${name}" (${P}).`, ok: true };
    }

    case 'entity_deleted': {
      const path = str(d, 'path');
      if (path === null) return bad();
      const name = str(d, 'name') ?? pathPhrase(path);
      return { text: `${S} deleted "${name}" (${pathPhrase(path)}).`, ok: true };
    }

    case 'entity_moved': {
      const from = str(d, 'from');
      const to = str(d, 'to');
      if (from === null || to === null) return bad();
      const name = str(d, 'name') ?? pathPhrase(from);
      let text = `${S} moved "${name}" from ${pathPhrase(from)} into ${pathPhrase(to)}.`;
      const near = str(d, 'near');
      if (near !== null) text += ` They are now ${near}.`;
      const dangling = num(d, 'dangling');
      if (dangling !== null && dangling > 0) {
        text += ` ${dangling} reference(s) elsewhere now point at nothing.`;
      }
      return { text, ok: true };
    }

    case 'character_moved': {
      // Subject is the character itself, never the actor (03 §3.2.2).
      const name = str(d, 'name');
      const to = str(d, 'to');
      if (name === null || to === null) return bad();
      const from = str(d, 'from');
      let text =
        from !== null
          ? `${name} moved from "${L(from)}" into "${L(to)}".`
          : `${name} shifted position in "${L(to)}".`;
      const near = str(d, 'near');
      if (near !== null) text += ` They are now ${near}.`;
      return { text, ok: true };
    }

    case 'following_changed': {
      const name = str(d, 'name');
      const following = bool(d, 'following');
      if (name === null || following === null) return bad();
      return following
        ? { text: `${name} started following the player.`, ok: true }
        : { text: `${name} stopped following the player.`, ok: true };
    }

    case 'character_talked': {
      const name = str(d, 'name');
      const turns = num(d, 'turns');
      if (name === null || turns === null) return bad();
      return {
        text: `${S} spoke with ${name} (${turns} exchange${turns === 1 ? '' : 's'}).`,
        ok: true,
      };
    }

    case 'choice_selected': {
      const path = str(d, 'path');
      const choice = str(d, 'choice');
      if (path === null || choice === null) return bad();
      const name = str(d, 'name') ?? pathPhrase(path);
      // `index` is deliberately not rendered (03 §3.2.3).
      return { text: `${S} chose "${choice}" on "${name}" (${pathPhrase(path)}).`, ok: true };
    }

    case 'roll_resolved': {
      const path = str(d, 'path');
      const name = str(d, 'name');
      const dice = str(d, 'dice');
      const desc = str(d, 'desc');
      const expect = str(d, 'expect');
      const result = num(d, 'result');
      const passed = bool(d, 'passed');
      if (
        path === null ||
        name === null ||
        dice === null ||
        desc === null ||
        expect === null ||
        result === null ||
        passed === null
      ) {
        return bad();
      }
      // The shared tier, when the roll carries one.
      const outcome = str(d, 'outcome');
      const tier = outcome === 'crit_success' ? ' — 大成功 crit_success' : outcome === 'crit_fail' ? ' — 大失败 crit_fail' : outcome === 'fail' ? ' — 失败 fail' : outcome === 'success' ? ' — 成功 success' : '';
      return {
        text: `${S} rolled ${dice}: "${desc}" got ${result} (${expect}, ${
          passed ? 'passed' : 'failed'
        })${tier}.`,
        ok: true,
      };
    }

    case 'use_item_on': {
      const item = str(d, 'item');
      const itemName = str(d, 'itemName');
      const target = str(d, 'target');
      const targetName = str(d, 'targetName');
      if (item === null || itemName === null || target === null || targetName === null) {
        return bad();
      }
      return {
        text: `${S} used "${itemName}" on "${targetName}" (${pathPhrase(target)}).`,
        ok: true,
      };
    }

    case 'layer_entered': {
      const layer = str(d, 'layer');
      const first = bool(d, 'first');
      if (layer === null || first === null) return bad();
      const name = str(d, 'name') ?? pathPhrase(layer);
      return first
        ? { text: `A new place opened: "${name}" (${pathPhrase(layer)}).`, ok: true }
        : { text: `The player entered "${name}" (${pathPhrase(layer)}).`, ok: true };
    }

    case 'layer_initialized': {
      const layer = str(d, 'layer');
      const name = str(d, 'name');
      const by = str(d, 'by');
      const files = Array.isArray(d.files) ? (d.files as unknown[]) : null;
      if (layer === null || name === null || by === null || files === null) return bad();
      return {
        text: `The layer "${name}" was instantiated by the ${by} (${files.length} file${
          files.length === 1 ? '' : 's'
        }).`,
        ok: true,
      };
    }

    case 'layer_init_failed': {
      const layer = str(d, 'layer');
      const name = str(d, 'name');
      const reason = str(d, 'reason');
      const fallback = str(d, 'fallback');
      if (layer === null || name === null || reason === null || fallback === null) return bad();
      return {
        text: `The layer "${name}" failed to materialize: ${reason} (fallback: ${
          fallback === 'template' ? 'a bare template' : 'nothing'
        }).`,
        ok: true,
      };
    }

    // The ONE type rendered as the empty string: never injected (doc-21 §4.5).
    case 'world_snapshot':
      return { text: '', ok: true };

    case 'world_rolled_back': {
      const snapshot = str(d, 'snapshot');
      if (snapshot === null) return bad();
      return { text: `The world was rolled back to the "${snapshot}" snapshot.`, ok: true };
    }

    case 'loop_reset': {
      const loop = typeof d.loop === 'number' ? d.loop : null;
      if (loop === null) return bad();
      return {
        text: `The world looped back to its first morning: loop ${loop} begins. Nobody but the player remembers the earlier loops; their notes and clue board came with them.${
          Array.isArray(d.stages) && d.stages.length > 0 ? ' This loop is not quite the same as the last: some places, people or things are new — read what is there now.' : ''
        }`,
        ok: true,
      };
    }

    case 'ending_reached': {
      const title = str(d, 'title');
      if (title === null) return bad();
      return { text: `The story reached its ending "${title}". Only conversation remains.`, ok: true };
    }

    case 'story_event': {
      const title = str(d, 'title');
      const text = str(d, 'text');
      const name = str(d, 'name');
      const kind = str(d, 'kind');
      if (title === null || text === null || name === null) return bad();
      // A hint is a line said to the player, not something that happened.
      if (str(d, 'hint') !== null) {
        return { text: kind === 'character' ? `${name} said to the player: "${text}"` : `The writer noted in the margin: "${text}"`, ok: true };
      }
      const about = kind === 'character' ? `to ${name}` : kind === 'item' ? `with ${name}` : `at ${name}`;
      return { text: `Something happened ${about} — ${title}: ${text}`, ok: true };
    }

    case 'cg_shown': {
      // The writer never sees the file path as narrative, only what the picture shows.
      const caption = str(d, 'caption');
      return {
        text: caption ? `A picture was shown to the player: ${caption}` : 'A picture was shown to the player.',
        ok: true,
      };
    }

    case 'background_swapped': {
      const name = str(d, 'name');
      if (name === null) return bad();
      return { text: `The look of ${name} changed for good.`, ok: true };
    }

    case 'music_changed': {
      const name = str(d, 'name');
      if (name === null) return bad();
      return { text: str(d, 'scope') === 'world' ? 'The world\'s theme music changed.' : `The music of ${name} changed.`, ok: true };
    }

    case 'player_board_changed': {
      const op = str(d, 'op');
      const TAG_WORDS: Record<string, string> = { suspect: 'suspicious', confirmed: 'confirmed', irrelevant: 'irrelevant' };
      if (op === 'linked' || op === 'unlinked') {
        const a = str(d, 'fromName') ?? str(d, 'from');
        const b = str(d, 'toName') ?? str(d, 'to');
        if (a === null || b === null) return bad();
        const label = str(d, 'label');
        return op === 'linked'
          ? { text: `${S} drew a line on their clue board between "${a}" and "${b}"${label ? ` labelled "${label}"` : ''}.`, ok: true }
          : { text: `${S} erased the line between "${a}" and "${b}" from their clue board.`, ok: true };
      }
      if (op === 'tagged' || op === 'untagged') {
        const name = str(d, 'name') ?? str(d, 'path');
        if (name === null) return bad();
        const tag = TAG_WORDS[str(d, 'tag') ?? ''] ?? null;
        return op === 'tagged' && tag
          ? { text: `${S} marked "${name}" as ${tag} on their clue board.`, ok: true }
          : { text: `${S} cleared their mark on "${name}".`, ok: true };
      }
      return bad();
    }

    default:
      // Type drift (a value outside the closed seventeen).
      return bad();
  }
}

/** Single-event sentence. Pure — the caller has already sanitised `detail`. */
export function renderEvent(
  event: WorldEvent,
  opts: { layerNames: Record<string, string> }
): string {
  return renderEventChecked(event, opts).text;
}

/** Merged sentence for a group with count > 1 (03 §3.5.1). */
function countPhrase(g: Group): string {
  const S = subjectPhrase(g.actor, commandOf(g.events[0]));
  const first = (g.events[0].detail ?? {}) as Detail;
  switch (g.type) {
    case 'entity_moved': {
      const tos = g.events.map((e) => str((e.detail ?? {}) as Detail, 'to'));
      const same = tos.length > 0 && tos.every((t) => t !== null && t === tos[0]);
      return `${S} moved ${g.count} items into ${same ? pathPhrase(tos[0] as string) : 'their bag'}.`;
    }
    case 'entity_created': {
      const allChalk = g.events.every((e) => str((e.detail ?? {}) as Detail, 'kind') === 'chalk');
      return allChalk ? `${S} wrote ${g.count} new pages.` : `${S} created ${g.count} things.`;
    }
    case 'entity_deleted':
      return `${S} deleted ${g.count} things.`;
    case 'entity_edited':
      return `${S} edited ${g.count} entries.`;
    case 'character_talked': {
      const name = str(first, 'name') ?? 'them';
      const total = g.events.reduce((n, e) => n + (num((e.detail ?? {}) as Detail, 'turns') ?? 0), 0);
      return `${S} spoke with ${name} (${total} exchanges).`;
    }
    default:
      return `${S} did this ${g.count} times.`;
  }
}

/**
 * The one entry point the injector memoises (01). Pure. Never throws.
 * `layerNames` = `{ [layerId]: displayName }`, built ONCE at the turn boundary
 * from `store.getManifest().layers` — so `layerPhrase` names a layer without
 * the renderer doing I/O (03 §3.3).
 */
export function renderEventWindow(
  slice: EventSlice,
  opts: { caps: number; actor: Actor; layerNames: Record<string, string> }
): EventWindow {
  const layerNames = opts.layerNames ?? {};
  let malformed = 0;

  // Step 0 + 1: sanitise every dynamic field; drop `world_snapshot` (rendered
  // as the empty string) so it occupies neither a slot nor a rule-1 count.
  const window: WorldEvent[] = [];
  for (const raw of slice?.events ?? []) {
    let clean: WorldEvent;
    try {
      clean = sanitiseEvent(raw);
    } catch {
      // Defensive: a malformed event object must not take the window down.
      malformed += 1;
      continue;
    }
    const { text, ok } = renderEventChecked(clean, { layerNames });
    if (text === '') continue;
    if (!ok) malformed += 1;
    window.push(clean);
  }

  // Step 2: MERGE-BY-TURN (doc-21 §5.4 rule 1). Key is (turn, type, actor,
  // command) — never `subject` (four consecutive `entity_moved` carry four
  // subjects). The `command` term is added by 10 §2.3: without it a hand-written
  // creation and a command-produced one would merge into one group carrying a
  // single `command`, i.e. "the command wrote 2 pages" when one was not its
  // doing. Same rule as `MERGE_EXEMPT` — a merge MUST NOT lie about its source.
  const groups: Group[] = [];
  for (const e of window) {
    const mergeable = e.turn !== null && !MERGE_EXEMPT.includes(e.type);
    const prev = groups[groups.length - 1];
    const sameKey =
      mergeable &&
      prev !== undefined &&
      prev.open &&
      prev.turn === e.turn &&
      prev.type === e.type &&
      actorKey(prev.actor) === actorKey(e.actor) &&
      commandOf(prev.events[0]) === commandOf(e);
    if (sameKey) {
      prev.count += 1;
      prev.events.push(e);
    } else {
      if (prev !== undefined) prev.open = false; // leaving the run closes it
      groups.push({
        turn: e.turn,
        type: e.type,
        actor: e.actor,
        events: [e],
        count: 1,
        open: true,
        layer: null,
        subject: null,
        text: '',
      });
    }
  }

  // Step 3: RENDER-GROUP. Fields first (countPhrase needs them), sentence after.
  for (const g of groups) {
    const d = (g.events[0].detail ?? {}) as Detail;
    const layers = new Set(g.events.map((e) => e.layer));
    g.layer = layers.size === 1 ? g.events[0].layer : null;
    const name = str(d, 'name') ?? str(d, 'itemName');
    g.name = name === null ? undefined : name;
    g.actor = g.events[0].actor;
    g.subject = g.events[0].subject ?? str(d, 'path') ?? str(d, 'to') ?? null;
    g.text = finalise(
      g.count > 1 ? countPhrase(g) : renderEventChecked(g.events[0], { layerNames }).text
    );
    // A story event that landed on THIS reader is not background. The generic
    // footer tells a character "you need not bring changes up", and on a live
    // turn 老莫 read "Something happened to 老莫 — he saw you open his logbook"
    // and still offered the player the logbook. Said to him in the second person,
    // with what it asks of him, it is something he just lived through.
    if (g.type === 'story_event' && opts.actor?.type === 'character') {
      const sd = (g.events[0].detail ?? {}) as Detail;
      if (str(sd, 'target') === `characters/${opts.actor.id ?? ''}` && str(sd, 'hint') !== null) {
        g.text = finalise(
          `You just said this to the player: "${str(sd, 'text') ?? ''}" ` +
            'It was your own suggestion; do not repeat it word for word, and never contradict it.'
        );
      } else if (str(sd, 'target') === `characters/${opts.actor.id ?? ''}`) {
        g.text = finalise(
          `This just happened to YOU — ${str(sd, 'title') ?? ''}: ${str(sd, 'text') ?? ''} ` +
            'It shapes how you feel and what you say to the player now: let it show, and never act as if it had not happened.'
        );
      }
    }
  }

  // A chat summary reaches the WRITER only:
  // a character never learns what the player said to someone else, even when
  // its window is not layer-scoped. One group = one chat (each close is its
  // own `req:` turn, so these never merge in practice).
  if (opts.actor?.type !== 'character') {
    for (const g of groups) {
      if (g.type !== 'character_talked' || g.count !== 1) continue;
      const clause = chatSummaryClause((g.events[0].detail ?? {}) as Detail);
      if (clause) g.text = `${g.text.replace(/\.$/, ':')} ${clause}`.slice(0, CHAT_SENTENCE_CAP);
    }
  }

  // Step 4: FOLD-EDITED (rule 2) — consecutive same-subject `entity_edited`
  // keeps only the last; iterate to a fixed point.
  let folded = true;
  while (folded) {
    folded = false;
    for (let i = 0; i + 1 < groups.length; i += 1) {
      const g = groups[i];
      const g2 = groups[i + 1];
      if (
        g.type === 'entity_edited' &&
        g2.type === 'entity_edited' &&
        g2.subject !== null &&
        g.subject === g2.subject
      ) {
        groups.splice(i, 1);
        folded = true;
        break;
      }
    }
  }

  // Step 5: COLLAPSE-CREATE-MOVE (rule 3). Join key is
  // `created.detail.path === moved.detail.from` — same entity, not same subject
  // (their `subject`s are the creation path vs the destination; never equal).
  for (let i = 0; i + 1 < groups.length; i += 1) {
    const g = groups[i];
    const g2 = groups[i + 1];
    if (g.type !== 'entity_created' || g2.type !== 'entity_moved') continue;
    const createdPath = str((g.events[0].detail ?? {}) as Detail, 'path');
    const movedFrom = str((g2.events[0].detail ?? {}) as Detail, 'from');
    if (createdPath === null || movedFrom === null || createdPath !== movedFrom) continue;
    const movedDetail = (g2.events[0].detail ?? {}) as Detail;
    g.name = str(movedDetail, 'name') ?? g.name;
    g.type = 'entity_moved';
    // The destination sentence's subject is the MOVED event's actor.
    g.actor = g2.events[0].actor;
    g.text = finalise(
      `${actorPhrase(g.actor)} moved "${g.name ?? ''}" into ${pathPhrase(str(movedDetail, 'to') ?? '')}.`
    );
    g.subject = str(movedDetail, 'to');
    groups.splice(i + 1, 1);
  }

  // Step 6: CAP (rule 4) — keep the newest `caps`, fold the rest into `tail`.
  const caps = Math.max(0, opts.caps);
  const dropped = Math.max(0, groups.length - caps);
  // `slice(-0)` would return the WHOLE array, so caps === 0 needs its own arm.
  const kept = dropped === 0 ? groups : caps === 0 ? [] : groups.slice(-caps);
  const tail = dropped > 0 ? `…and ${dropped} more (older events omitted)` : null;

  // Step 7: OUT.
  const events: EventWindowLine[] = kept.map((g) => {
    const line: EventWindowLine = {
      type: g.type,
      layer: g.layer,
      actor: g.actor,
      count: g.count,
      subject: g.subject,
      text: g.text,
    };
    if (g.name !== undefined) line.name = g.name;
    // `commandOf` on the group's FIRST event, exactly like `type` / `actor` /
    // `name` / `subject` above. Absent (never '') for ordinary events, so
    // `'command' in line` is false in the common case.
    const command = commandOf(g.events[0]);
    if (command !== null) line.command = command;
    return line;
  });

  return {
    lines: kept.map((g) => g.text),
    tail,
    events,
    dropped,
    malformed,
  };
}

/** A chat summary line may run longer than an ordinary sentence: it is several facts at once. */
const CHAT_SENTENCE_CAP = 1400;

/**
 * `character_talked.detail.summary` → one clause for the writer, or '' when the
 * event carries none (older events, a failed summary). Every field is
 * sanitised here: the summary is model output about player words.
 */
export function chatSummaryClause(d: Detail): string {
  const s = d?.summary;
  if (!s || typeof s !== 'object') return '';
  const clean = (v: unknown, max: number) => (typeof v === 'string' ? sanitiseForBlock(v, { maxLength: max }).trim() : '');
  const list = (v: unknown, max: number) => (Array.isArray(v) ? v.map((x) => clean(x, max)).filter(Boolean) : []);
  const text = clean(s.text, 600);
  if (!text) return '';
  const parts = [text.replace(/([^.!?。！？])$/, '$1.')];
  const clues = list(s.clues_learned, 160);
  if (clues.length) parts.push(`Clues learned: ${clues.join('; ')}.`);
  const promises = list(s.promises_made, 160);
  if (promises.length) parts.push(`Promises: ${promises.join('; ')}.`);
  const rel = clean(s.relationship_change, 160);
  if (rel) parts.push(`Relationship: ${rel}.`);
  const intent = clean(s.player_intent, 160);
  if (intent) parts.push(`The player wants: ${intent}.`);
  const quotes = list(s.notable_quotes, 120).slice(0, 2);
  if (quotes.length) parts.push(`Said: ${quotes.map((q) => `"${q}"`).join(' / ')}.`);
  const id = typeof d.character === 'string' ? d.character : '';
  if (id) parts.push(`(Full chat: read_conversation("${id}").)`);
  return parts.join(' ').replace(/\.\./g, '.');
}

/**
 * Final length backstop (03 §3.1 rule 4). Deliberately length-ONLY: running the
 * full `sanitiseForBlock` over an assembled sentence would strip the quotes the
 * templates print around `${name}` (see every §3.2 golden). Every DYNAMIC
 * substring already passed `sanitiseForBlock` field-wise in `sanitiseEvent`, so
 * there is no unfiltered content left for the fold to catch — only length.
 */
function finalise(text: string): string {
  return text.length > SENTENCE_CAP ? text.slice(0, SENTENCE_CAP) : text;
}
