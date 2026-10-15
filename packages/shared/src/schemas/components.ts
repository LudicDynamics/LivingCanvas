import { z } from 'zod';

/**
 * Component schemas — the shared kernel plus one `.extend(...)` per kind, as
 * doc 10 §13.1 freezes them.
 *
 * `COMPONENT_KINDS` is the SINGLE kind list: `COMPONENT_SCHEMAS` below derives
 * from it and `components/registry.ts` dispatches in the same order. Two
 * hand-maintained lists would drift (the "two size tables" bug, one level up).
 */

export const COMPONENT_KINDS = [
  // core — every world has these two (doc 10 §14.4)
  'note',
  'letter',
  // adventure — mist-harbour / dungeon / exploration
  'lock',
  'container',
  'trap',
  'mechanism',
  'map',
  // mystery — deduction
  'book',
  'ledger',
  'photo',
  'cipher',
  // chronicle — timeline science fiction
  'clock',
  'tape',
  'anchor',
  // craft — handwork / academy / slice of life
  'instrument',
  'board',
  // room — a character's private nook
  'diary',
  'thread',
  'portrait',
] as const;

export type ComponentKind = (typeof COMPONENT_KINDS)[number];

/** What a component responds to as a `use_item_on` target (doc 10 §15.2). */
export const AcceptsSchema = z
  .object({
    itemKinds: z.array(z.string()).optional(),
    itemTags: z.array(z.string()).optional(),
    any: z.boolean().optional(),
    hint: z.string().optional(),
  })
  .passthrough();

export type Accepts = z.infer<typeof AcceptsSchema>;

/** `status.data` — the narrative snapshot every kind may carry. */
export const ComponentStatusSchema = z
  .object({ data: z.record(z.string(), z.unknown()) })
  .passthrough();

const GridSchema = z.object({ cols: z.number(), rows: z.number() }).passthrough();
const MarkSchema = z.object({ label: z.string(), x: z.number(), y: z.number() }).passthrough();
const LineSchema = z
  .object({ who: z.string(), text: z.string(), time: z.string().optional() })
  .passthrough();

/** The shared kernel: kind-agnostic, required by every docked component. */
export const ComponentCoreSchema = z
  .object({
    type: z.literal('component'),
    component: z.string(),
    title: z.string(),
    preview: z.string().optional(),
    body: z.string().optional(),
    age: z.enum(['now', 'recent', 'past', 'deep']).optional(),
  })
  .passthrough();

/**
 * `note` predates `type: component` (doc 10 §14.4 notes were `type: note`), so
 * its schema accepts BOTH spellings. It is the one kind whose `component` field
 * is optional: a bare markdown file with no frontmatter at all is a note too,
 * which is why `ComponentNoteSchema` cannot be the strict kernel shape.
 */
export const ComponentNoteSchema = z
  .object({
    type: z.enum(['note', 'component']),
    component: z.string().optional(),
    title: z.string(),
    tags: z.array(z.string()).optional(),
    icon: z.string().optional(),
  })
  .passthrough();

/** Core: a sealed letter — title / preview / body / sign (doc 10 E2). */
export const LetterKindSchema = ComponentCoreSchema.extend({
  component: z.literal('letter'),
  sign: z.string().optional(),
  seal: z.string().optional(),
  addressed_to: z.string().optional(),
});

/** Adventure: a door, chest or hatch that opens to the right thing. */
export const LockKindSchema = ComponentCoreSchema.extend({
  component: z.literal('lock'),
  accepts: AcceptsSchema.optional(),
  status: ComponentStatusSchema.optional(),
});

/** Adventure: a box, cabinet, drawer or puzzle box. */
export const ContainerKindSchema = ComponentCoreSchema.extend({
  component: z.literal('container'),
  accepts: AcceptsSchema.optional(),
  holds: z.array(z.string()).optional(),
  status: ComponentStatusSchema.optional(),
});

/** Adventure: anything that springs — tripwire, needle, collapse. */
export const TrapKindSchema = ComponentCoreSchema.extend({
  component: z.literal('trap'),
  accepts: AcceptsSchema.optional(),
  status: ComponentStatusSchema.optional(),
});

/** Adventure: lamp / sluice / gear / lever — a switch with few positions. */
export const MechanismKindSchema = ComponentCoreSchema.extend({
  component: z.literal('mechanism'),
  accepts: AcceptsSchema.optional(),
  states: z.array(z.string()).optional(),
  status: ComponentStatusSchema.optional(),
});

/** Adventure: a map or chart — it points the way, it changes nothing. */
export const MapKindSchema = ComponentCoreSchema.extend({
  component: z.literal('map'),
  marks: z.array(MarkSchema).optional(),
  region: z.string().optional(),
});

/** Mystery: a book with pages. */
export const BookKindSchema = ComponentCoreSchema.extend({
  component: z.literal('book'),
  pages: z.array(z.string()).optional(),
  author: z.string().optional(),
});

/** Mystery: an account book — columns and reconcilable numbers. */
export const LedgerKindSchema = ComponentCoreSchema.extend({
  component: z.literal('ledger'),
  columns: z.array(z.string()).optional(),
  rows: z.array(z.array(z.string())).optional(),
});

/** Mystery: a photograph or portrait — an image plus a caption. */
export const PhotoKindSchema = ComponentCoreSchema.extend({
  component: z.literal('photo'),
  image: z.string().optional(),
  caption: z.string().optional(),
});

/** Mystery: ciphertext — the second layer reveals `cleartext` once decoded. */
export const CipherKindSchema = ComponentCoreSchema.extend({
  component: z.literal('cipher'),
  cleartext: z.string().optional(),
  accepts: AcceptsSchema.optional(),
  status: ComponentStatusSchema.optional(),
});

/** Chronicle: a clock or timer — the visible carrier of world time. */
export const ClockKindSchema = ComponentCoreSchema.extend({
  component: z.literal('clock'),
  status: ComponentStatusSchema.optional(),
});

/** Chronicle: a recording — playback is reading, not time travel. */
export const TapeKindSchema = ComponentCoreSchema.extend({
  component: z.literal('tape'),
  duration: z.number().optional(),
  status: ComponentStatusSchema.optional(),
});

/** Chronicle: an anchor kept across timelines. */
export const AnchorKindSchema = ComponentCoreSchema.extend({
  component: z.literal('anchor'),
  accepts: AcceptsSchema.optional(),
  status: ComponentStatusSchema.optional(),
});

/** Craft: an instrument (the piano of doc 20 §2.1). */
export const InstrumentKindSchema = ComponentCoreSchema.extend({
  component: z.literal('instrument'),
  accepts: AcceptsSchema.optional(),
  status: ComponentStatusSchema.optional(),
});

/** Craft: a board or sandbox game — its second layer renders the grid. */
export const BoardKindSchema = ComponentCoreSchema.extend({
  component: z.literal('board'),
  grid: GridSchema.optional(),
  accepts: AcceptsSchema.optional(),
  status: ComponentStatusSchema.optional(),
});

/** Room: a diary — private dated text, optionally continued. */
export const DiaryKindSchema = ComponentCoreSchema.extend({
  component: z.literal('diary'),
  date: z.string().optional(),
  mood: z.string().optional(),
});

/** Room: one conversation, written down as a two-hander. */
export const ThreadKindSchema = ComponentCoreSchema.extend({
  component: z.literal('thread'),
  lines: z.array(LineSchema).optional(),
});

/**
 * Room: a living portrait — a looping silent clip of someone, plus the still
 * it falls back to. `video` / `poster` are WORLD-ROOT-RELATIVE paths (contract
 * §5.4: the frontend turns them into `/api/asset?path=…`); deliberately NOT the
 * legacy `avatar`-style `/api/asset?…` spelling.
 */
export const PortraitKindSchema = ComponentCoreSchema.extend({
  component: z.literal('portrait'),
  video: z.string().optional(),
  poster: z.string().optional(),
  caption: z.string().optional(),
});

/**
 * One schema per registered kind, keyed by the kind id. The registry and this
 * map MUST stay in step; the test asserts their key sets are equal.
 */
export const COMPONENT_SCHEMAS: Record<string, z.ZodTypeAny> = {
  note: ComponentNoteSchema,
  letter: LetterKindSchema,
  lock: LockKindSchema,
  container: ContainerKindSchema,
  trap: TrapKindSchema,
  mechanism: MechanismKindSchema,
  map: MapKindSchema,
  book: BookKindSchema,
  ledger: LedgerKindSchema,
  photo: PhotoKindSchema,
  cipher: CipherKindSchema,
  clock: ClockKindSchema,
  tape: TapeKindSchema,
  anchor: AnchorKindSchema,
  instrument: InstrumentKindSchema,
  board: BoardKindSchema,
  diary: DiaryKindSchema,
  thread: ThreadKindSchema,
  portrait: PortraitKindSchema,
};
