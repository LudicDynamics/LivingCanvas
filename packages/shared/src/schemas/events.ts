import { z } from 'zod';

/**
 * The closed seventeen (doc-21 §4 / 00 §5.2; `ending_reached` added for closed
 * worlds, the design notes; `story_event` for events a roll lands on a
 * character / item / place, actions/story-event.ts). Adding one requires BOTH a detail
 * shape below AND a render template — the enum is deliberately closed so a
 * typo'd type fails at compile time instead of silently recording an event no
 * consumer knows how to render.
 */
export const WORLD_EVENT_TYPES = [
  'entity_created',
  'entity_edited',
  'entity_deleted',
  'entity_moved',
  'character_moved',
  'following_changed',
  'character_talked',
  'choice_selected',
  'roll_resolved',
  'use_item_on',
  'layer_entered',
  'layer_initialized',
  'layer_init_failed',
  'world_snapshot',
  'world_rolled_back',
  'ending_reached',
  'story_event',
  // Scene media (actions/scene-media.ts, the design notes): a CG shown
  // to the player, and a layer whose scene background changed for good.
  'cg_shown',
  'background_swapped',
  // The music of a place or the world theme changed (actions/music.ts).
  'music_changed',
  // The player's clue board changed: a line drawn / removed, a card marked
  // (actions/player-notes.ts, the design notes).
  'player_board_changed',
  // The world went back to its loop start; only the player remembers
  // (actions/loop.ts, the design notes).
  'loop_reset',
] as const;

export const WorldEventTypeSchema = z.enum(WORLD_EVENT_TYPES);
export type WorldEventType = (typeof WORLD_EVENT_TYPES)[number];

export const ActorTypeSchema = z.enum(['player', 'god', 'writer', 'character', 'engine', 'functional']);
export const ActorSchema = z.object({ type: ActorTypeSchema, id: z.string().optional() });
export type ActorValue = z.infer<typeof ActorSchema>;

/**
 * Frozen per-type `detail` shapes (00 §5.2 == doc-21 §4). Field names are the
 * contract: renderers and consumers read these keys, never re-derive them from
 * the world directory (doc-21 §3.3 — `detail` must be self-sufficient).
 *
 * Used for runtime validation on append (dev only, see `appendEvent`) and as
 * the single authority downstream docs cite when naming fields.
 */
export const EventDetailSchemas = {
  entity_created: z.object({
    path: z.string(),
    name: z.string(),
    kind: z.enum(['chalk', 'component', 'note', 'letter', 'other']),
    summary: z.string().optional(),
  }),
  entity_edited: z.object({ path: z.string(), name: z.string(), kind: z.string() }),
  entity_deleted: z.object({ path: z.string(), name: z.string() }),
  entity_moved: z.object({
    from: z.string(),
    to: z.string(),
    name: z.string(),
    near: z.string().optional(),
    rewrote: z.number().int().min(0),
    dangling: z.number().int().min(0),
  }),
  character_moved: z.object({
    character: z.string(),
    name: z.string(),
    from: z.string().optional(),
    to: z.string(),
    near: z.string().optional(),
  }),
  following_changed: z.object({ character: z.string(), name: z.string(), following: z.boolean() }),
  character_talked: z.object({
    character: z.string(),
    name: z.string(),
    turns: z.number().int().min(1),
    // What the writer learns of the private chat.
    summary: z
      .object({
        text: z.string(),
        clues_learned: z.array(z.string()),
        promises_made: z.array(z.string()),
        relationship_change: z.string(),
        player_intent: z.string(),
        notable_quotes: z.array(z.string()).max(2),
        important: z.boolean(),
      })
      .optional(),
    // The last session entry this chat covered: the next summary starts after it.
    through: z.string().optional(),
    via: z.enum(['dialogue', 'voice', 'idle']).optional(),
  }),
  // `index` is 1-BASED — the same number look_at prints and the caller passes.
  // Never converted.
  choice_selected: z.object({
    path: z.string(),
    name: z.string(),
    choice: z.string(),
    index: z.number().int().min(1),
  }),
  roll_resolved: z.object({
    path: z.string(),
    name: z.string(),
    dice: z.string(),
    desc: z.string(),
    expect: z.string(),
    result: z.number(),
    passed: z.boolean(),
  }),
  use_item_on: z.object({
    item: z.string(),
    itemName: z.string(),
    target: z.string(),
    targetName: z.string(),
  }),
  layer_entered: z.object({ layer: z.string(), name: z.string(), first: z.boolean() }),
  layer_initialized: z.object({
    layer: z.string(),
    name: z.string(),
    by: z.enum(['writer', 'player', 'engine']),
    files: z.array(z.string()),
  }),
  layer_init_failed: z.object({
    layer: z.string(),
    reason: z.string(),
    fallback: z.enum(['template', 'none']),
  }),
  world_snapshot: z.object({ snapshot: z.string(), reason: z.string() }),
  world_rolled_back: z.object({ snapshot: z.string(), to: z.string() }),
  // A closed world reached one of its endings.
  // `path` is the ending page, `title` its name at that moment.
  ending_reached: z.object({ ending: z.string(), title: z.string(), path: z.string() }),
  // Something happened to a character, an item or a place (actions/story-event.ts).
  story_event: z.object({
    target: z.string(),
    kind: z.enum(['character', 'item', 'place']),
    name: z.string(),
    title: z.string(),
    text: z.string(),
    // A companion hint: the hint id — the target SAID `text` to the player.
    hint: z.string().optional(),
    // A passive check that succeeded: which, whose number, the grade.
    passive: z.object({ id: z.string(), file: z.string(), skill: z.string(), by: z.string(), grade: z.string() }).optional(),
    // The player's inspiration roll: the tier and the hint it reached.
    inspiration: z.object({ grade: z.string(), outcome: z.string(), result: z.number(), target: z.number(), hint: z.string().optional() }).optional(),
    // A character-tick move: the actor, the move and how it ended.
    tick: z
      .object({
        actor: z.string(),
        move: z.string(),
        verb: z.string(),
        target: z.string(),
        result: z.enum(['landed', 'stopped', 'void', 'said']),
        by: z.string().optional(),
        // v2: the person's own words — a claim, never a fact.
        claim: z.object({ say: z.string().optional(), invite: z.string().optional(), note: z.string().optional() }).optional(),
      })
      .optional(),
  }),
  // A full-screen picture shown to the player (`show_cg`). `first`: this save had not seen it.
  cg_shown: z.object({ path: z.string(), caption: z.string().optional(), first: z.boolean() }),
  // A layer README's `bg:` now points at `path` (`swap_background`); `from` is the old one.
  background_swapped: z.object({ layer: z.string(), name: z.string(), path: z.string(), from: z.string().optional() }),
  music_changed: z.object({
    scope: z.enum(['world', 'layer']),
    layer: z.string().optional(),
    name: z.string(),
    music: z.string().nullable().optional(),
    ambient: z.string().optional(),
    reason: z.string().optional(),
  }),
  player_board_changed: z.object({
    op: z.enum(['linked', 'unlinked', 'tagged', 'untagged']),
    from: z.string().optional(),
    to: z.string().optional(),
    fromName: z.string().optional(),
    toName: z.string().optional(),
    label: z.string().optional(),
    path: z.string().optional(),
    name: z.string().optional(),
    tag: z.enum(['suspect', 'confirmed', 'irrelevant']).optional(),
  }),
  loop_reset: z.object({
    loop: z.number().int().positive(),
    kept: z.object({
      notes: z.number().int().nonnegative(),
      links: z.number().int().nonnegative(),
      states: z.array(z.string()),
      files: z.array(z.string()),
    }),
    dropped: z.array(z.string()),
    reason: z.string().optional(),
  }),
} as const satisfies Record<WorldEventType, z.ZodTypeAny>;

/** A stored event, camelCase (the JS side never sees snake_case). */
export const WorldEventSchema = z.object({
  seq: z.number().int().positive(),
  id: z.string(), // evt-<seq>
  projectId: z.string(),
  type: WorldEventTypeSchema,
  actor: ActorSchema,
  layer: z.string().nullable(),
  subject: z.string().nullable(),
  turn: z.string().nullable(),
  detail: z.record(z.string(), z.any()),
  createdAt: z.string(),
});
export type WorldEvent = z.infer<typeof WorldEventSchema>;
export type WorldEventDetail<T extends WorldEventType> = z.infer<(typeof EventDetailSchemas)[T]>;

/** What callers hand to `store.appendEvent`. */
export interface AppendEventArgs<T extends WorldEventType = WorldEventType> {
  type: T;
  actor: ActorValue;
  /** Self-sufficient (doc-21 §3.3): MUST carry `path` + the name AT THAT MOMENT. Never the body. */
  detail: WorldEventDetail<T> & Record<string, any>;
  subject?: string;
  layer?: string;
  turn?: string;
}

/**
 * One reference that could not be rewritten. Lives HERE (not in actions/refs.ts)
 * because `WorldStore.move` returns it and `store/` must not import from
 * `actions/` (that would be a cycle). `actions/refs.ts` re-exports it.
 */
export interface DanglingRef {
  file: string;
  /** The path or bare mention that used to point at the moved entity. */
  target: string;
  reason: 'ambiguous' | 'unreadable';
}

/** doc-20 §5 — the shape `WorldStore.move` returns. */
export interface MoveResult {
  ok: true; // failure throws; there is no ok:false path
  from: string;
  to: string;
  name: string;
  rewrote: string[];
  dangling: DanglingRef[];
  event: WorldEvent;
}
