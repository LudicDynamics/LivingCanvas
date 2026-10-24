import { z } from 'zod';
import { WorldIntroSchema } from './world-intro.js';
import { OpeningRepliesSchema, WorldExperienceSchema, WorldModelHintsSchema, WorldUiSchema } from '../rules/experience.js';
import { RunVariantsSchema } from '../store/run-variants.js';

export const WorldExtensionSchema = z.object({
  id: z.string(),
  version: z.string(),
  optional: z.boolean().default(false),
});

export const LayerConfigSchema = z.object({
  // Derived layers may have no README `name`; fall back to the id downstream.
  name: z.string().optional(),
  parent: z.string().nullable(),
  material: z.string().optional(),
  stub: z.boolean().optional(),
});

export const CharacterConfigSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  home: z.string(),
  role: z.enum(['companion', 'npc']).or(z.string()).optional(),
  avatar: z.string().optional(),
  avatarVideo: z.string().optional(),
  description: z.string().optional(),
});

/**
 * The time limit of a closed world: an ordinary card whose `status.data[key]`
 * counts the steps left. `tick` moves it; nothing else is special about it.
 */
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const WorldClockSchema = z.object({
  path: z.string().min(1),
  key: z.string().regex(/^[A-Za-z_][A-Za-z0-9_-]*$/),
  start: z.number().int().nonnegative(),
  label: z.string().min(1),
  /**
   * The clock as the STORY tells it
   * The engine still counts steps; the player sees
   * a time of night instead: `start` is when the run begins, `end` the deadline
   * (past midnight is fine — "23:00" → "01:00"), and each step is an equal slice.
   */
  time: z.object({ start: z.string().regex(HHMM), end: z.string().regex(HHMM) }).optional(),
  /**
   * The clock moves with the player's turns
   * every `perTurns` player turns, one step
   * (actions/turn-clock.ts has the exact definition of a turn). The count is
   * the clock card's `status.data.turns`.
   */
  perTurns: z.number().int().min(1).max(50).optional(),
});

/**
 * `when` for a clock-triggered ending: exactly `clock <op> <integer>`. Kept this
 * narrow on purpose — every other ending is reached by an `end` effect in a
 * command, where the full condition algebra already lives.
 */
export const CLOCK_WHEN_RE = /^\s*clock\s*(<=|<|==|>=|>)\s*(-?\d+)\s*$/;

export const WorldEndingSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  title: z.string().min(1),
  path: z.string().regex(/^endings\/[a-z][a-z0-9-]*\/README\.md$/),
  when: z.string().regex(CLOCK_WHEN_RE).optional(),
});

/**
 * One answer to a mystery. `tier`:
 *   - `surface` — the plain truth (明面): unlocks its `epilogue`;
 *   - `hidden`  — the deeper truth under it (隐藏): unlocks a hidden-ending card
 *     (`title` + `epilogue`); a mystery may have several hidden variants;
 *   - `wrong`   — a plausible distractor.
 * `clues`: world-relative paths. The answer counts only when it is right AND
 * one of these exists in the save — at the path itself, or carried at
 * `player/<same file name>` (a take moves an item into the bag by name).
 */
export const MYSTERY_TIERS = ['surface', 'hidden', 'wrong'] as const;
export type MysteryTier = (typeof MYSTERY_TIERS)[number];
const MYSTERY_ID = /^[a-z][a-z0-9-]*$/;
const CLUE_PATH = /^(world|player)\/[A-Za-z0-9_./-]+\.md$/;

export const WorldMysteryOptionSchema = z.object({
  id: z.string().regex(MYSTERY_ID),
  label: z.string().min(1),
  tier: z.enum(MYSTERY_TIERS),
  clues: z.array(z.string().regex(CLUE_PATH).refine((p) => !p.includes('..'), 'no ".." in a clue path')).default([]),
  /** Hidden answers: the hidden-ending card's title. */
  title: z.string().min(1).optional(),
  epilogue: z.string().min(1).optional(),
});

export const WorldMysterySchema = z.object({
  id: z.string().regex(MYSTERY_ID),
  question: z.string().min(1),
  hint: z.string().min(1).optional(),
  options: z.array(WorldMysteryOptionSchema).min(3).max(4),
}).superRefine((m, ctx) => {
  const ids = new Set<string>();
  m.options.forEach((o, i) => {
    if (ids.has(o.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['options', i, 'id'], message: `duplicate option id "${o.id}"` });
    ids.add(o.id);
    if (o.tier === 'wrong') return;
    if (o.clues.length === 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['options', i, 'clues'], message: `a ${o.tier} answer needs at least one clue path` });
    if (!o.epilogue) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['options', i, 'epilogue'], message: `a ${o.tier} answer needs an epilogue` });
    if (o.tier === 'hidden' && !o.title) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['options', i, 'title'], message: 'a hidden answer needs a title (its hidden-ending card)' });
  });
  if (!m.options.some((o) => o.tier === 'surface')) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['options'], message: 'a mystery needs a surface answer' });
  }
  if (!m.options.some((o) => o.tier === 'wrong')) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['options'], message: 'a mystery needs at least one wrong answer' });
  }
});

/** The tiered epilogue after the debrief: every secret / at least half / fewer. */
export const WorldReckoningSchema = z.object({
  epilogues: z.object({ all: z.string().min(1), most: z.string().min(1), few: z.string().min(1) }),
});

export type WorldMysteryOption = z.infer<typeof WorldMysteryOptionSchema>;
export type WorldMystery = z.infer<typeof WorldMysterySchema>;
export type WorldReckoning = z.infer<typeof WorldReckoningSchema>;

export type WorldClock = z.infer<typeof WorldClockSchema>;

export interface ClockTime {
  /** The story's time now, "HH:MM". */
  now: string;
  /** The deadline, "HH:MM". */
  deadline: string;
  remainingMinutes: number;
  elapsedMinutes: number;
}

const minutesOf = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const hhmmOf = (minutes: number): string => {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/**
 * Steps left → the time of night. Pure. Null when the clock has no `time`, or
 * no steps to spread the span over. The span wraps midnight when `end` is
 * earlier than `start`.
 */
export function clockTimeOf(clock: WorldClock, left: number): ClockTime | null {
  if (!clock.time || clock.start <= 0) return null;
  const from = minutesOf(clock.time.start);
  let span = minutesOf(clock.time.end) - from;
  if (span <= 0) span += 1440;
  const clamped = Math.min(Math.max(left, 0), clock.start);
  const remaining = Math.round((span * clamped) / clock.start);
  const elapsed = span - remaining;
  return { now: hhmmOf(from + elapsed), deadline: clock.time.end, remainingMinutes: remaining, elapsedMinutes: elapsed };
}
export type WorldEnding = z.infer<typeof WorldEndingSchema>;

/** Whether a clock-triggered ending's `when` holds for `left` steps remaining. */
export function clockEndingHolds(when: string, left: number): boolean {
  const m = CLOCK_WHEN_RE.exec(when);
  if (!m) return false;
  const n = Number(m[2]);
  switch (m[1]) {
    case '<=': return left <= n;
    case '<': return left < n;
    case '==': return left === n;
    case '>=': return left >= n;
    case '>': return left > n;
  }
  return false;
}

/** The two ways a layer is looked at (apps/web/src/lib/view-mode.ts). */
export const WORLD_VIEW_MODES = ['canvas', 'map'] as const;
export type WorldViewMode = (typeof WORLD_VIEW_MODES)[number];
export const DEFAULT_WORLD_VIEW: WorldViewMode = 'canvas';
export const WorldViewSchema = z.object({
  default: z.enum(WORLD_VIEW_MODES).default(DEFAULT_WORLD_VIEW),
}).strict();

/**
 * The view a world opens in. Fail-soft on purpose: it reads raw manifests too
 * (a save's world.json, a catalog entry), and a missing or unknown value is
 * the canvas every world had before the field existed.
 */
export function worldDefaultView(manifest: unknown): WorldViewMode {
  const view = manifest && typeof manifest === 'object' ? (manifest as { view?: unknown }).view : undefined;
  const value = view && typeof view === 'object' ? (view as { default?: unknown }).default : undefined;
  return value === 'map' || value === 'canvas' ? value : DEFAULT_WORLD_VIEW;
}

export const WorldManifestSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string().default('1.0.0'),
  schema: z.number().default(1),
  description: z.string(),
  author: z.string(),
  cover: z.string().optional(),
  player: z.object({
    id: z.string(),
    name: z.string(),
    avatar: z.string().optional(),
  }).optional(),
  tags: z.array(z.string()).default([]),
  genre: z.string(),
  material: z.string().default('parchment'),
  /** First playable layer. `map` remains the filesystem root fallback. */
  entry: z.string().min(1).default('map'),
  extensions: z.array(WorldExtensionSchema).default([]),
  // `layers` is DERIVED from the directory tree (see store/layers.ts), but the
  // manifest type still carries it for consumers. Not required in world.json:
  // declaring it created a second source that drifted.
  layers: z.record(z.string(), LayerConfigSchema).default({}),
  characters: z.array(CharacterConfigSchema).default([]),
  /**
   * The first act. `greeter` names the character who speaks
   * first; their line lives in `characters/<id>/README.md`'s `greeting:`, so
   * the words stay beside the character who says them. `greeting` here is the
   * fallback for a world with nobody to speak — it is shown in the narrator's
   * voice. Both are author-written: the writer never generates them, and
   * showing one starts no agent and lands no event (doc-21 §5.5).
   */
  opening: z.object({
    greeter: z.string().optional(),
    greeting: z.string().optional(),
    /**
     * Tappable first replies: up to three lines the player can
     * send to the greeter with one tap, shown above the reply box until the
     * first answer. A list in the world's language, or one list per interface
     * locale (`{ "zh-CN": [...], "en": [...] }`). Typing stays possible.
     */
    replies: OpeningRepliesSchema.optional().catch(undefined),
  }).optional(),
  /**
   * A guided experience: the first-run prologue. Any world may
   * carry one; the engine only reads these fields.
   *   - `kind: prologue` — minimal play chrome, no forced tutorial, and an ending
   *     card with two choices instead of play again;
   *   - `next` — the edition family the ending's first choice opens, in the prologue's language (`last-train`
   *     → `last-train-zh` / `-jp` / `-ko`, apps/web lib/first-run.ts prologueNextIdFor);
   *   - `maxTurns` — the length the beats are written for (the door fallback);
   *   - `turnEnd` — a `command/<id>.yaml` the engine runs after each player turn
   *     (`POST /api/turn-end`), so a beat lands by command, never by model memory.
   */
  experience: WorldExperienceSchema.optional().catch(undefined),
  /**
   * Play-screen switches a world may set (rules/experience.ts). `replyChips`: one-tap moves above the reply box —
   * `opening.replies` for the first answer, then this place's card options (doors first). Absent = on when the
   * world has `opening.replies` (or is a prologue); `false` turns both off. Typing always stays.
   */
  ui: WorldUiSchema.optional().catch(undefined),
  /**
   * Which model the world would like each agent on (rules/experience.ts worldModelFor): candidates in order, the
   * first this player may use (plan, provider config) wins; a player's own pick for the save beats it.
   */
  models: WorldModelHintsSchema.optional().catch(undefined),
  // World theme song key. Resolved to a URL by the server before it reaches the
  // client; the raw key never leaves the server.
  audio: z.object({ theme: z.string().optional() }).optional(),
  /**
   * Experimental sandbox marker (`templates/fpal`). Not a shipped edition: the
   * edition gates skip it and the world shelf lists it separately, so it can be
   * opened from the Launcher without joining the 21-edition corpus.
   */
  exp: z.boolean().default(false),
  /**
   * Closed worlds: `closed` has a time limit and
   * endings, and once an ending is reached only conversation remains. Absent
   * means `open` — every world written before this keeps its open ending.
   */
  mode: z.enum(['open', 'semi', 'closed']).optional(),
  /**
   * The view the play UI opens in:
   * `map` for a TRPG "跑图" world whose layers carry drawn maps, `canvas` (the
   * default, and what every world without the field gets) for open worlds.
   * Chosen when the world is made in the workshop; players can still switch.
   */
  view: WorldViewSchema.optional(),
  /**
   * World theme: world type, rule pack and structure flags, set
   * when a world is made in the workshop. Validated leniently here — the
   * registry (`rules/themes.ts` `resolveTheme`) reads it fail-soft, so a
   * malformed theme degrades to narrative × sandbox instead of refusing the world.
   */
  theme: z.object({
    players: z.string().optional(),
    type: z.string().optional(),
    rules: z.string().optional(),
    structure: z.record(z.string(), z.boolean()).optional(),
  }).passthrough().optional().catch(undefined),
  /**
   * Character skills: the rule system every
   * skill check uses — `coc` (d100 under a skill %) or `dnd` (d20 + modifier vs
   * DC). Lenient like `theme`: `rules/skills.ts` `worldRulesOf` reads it
   * fail-soft, and a world without it keeps today's dice.
   */
  rules: z.object({
    system: z.enum(['coc', 'dnd']),
    sanity: z.boolean().optional(),
    characterChecks: z.boolean().optional(),
    proficiency: z.number().int().min(0).max(10).optional(),
  }).passthrough().optional().catch(undefined),
  /**
   * Writer options of the world's author:
   * `fastPath: false` keeps every save of this world on the agent writer, even
   * though the server runs the fast path (on by default). Lenient like `theme`.
   */
  writer: z.object({
    fastPath: z.boolean().optional(),
  }).passthrough().optional().catch(undefined),
  clock: WorldClockSchema.optional(),
  endings: z.array(WorldEndingSchema).optional(),
  /**
   * Run variants: choices a
   * new run draws from a seed — e.g. which suspect is the culprit — each with an
   * overlay directory `variants/<id>/<option>/`.
   */
  variants: RunVariantsSchema.optional(),
  /**
   * The 复盘 / debrief: the world's secrets, asked
   * only AFTER an ending. Answers never change the ending reached; they score
   * 「解开秘密 N/M」 and unlock epilogues. Author data — the page receives the
   * questions without tiers or clues.
   */
  mysteries: z.array(WorldMysterySchema).max(8).optional(),
  reckoning: WorldReckoningSchema.optional(),
  /**
   * The lobby's "what is this world" card (schemas/world-intro.ts,
   * the design notes). Lenient here: a malformed block is dropped and the
   * server derives a card from the world's own data; check:worlds is strict.
   */
  intro: WorldIntroSchema.optional().catch(undefined),
  createdAt: z.string(),
  updatedAt: z.string(),
}).passthrough();

export type WorldExtension = z.infer<typeof WorldExtensionSchema>;
export type LayerConfig = z.infer<typeof LayerConfigSchema>;
export type CharacterConfig = z.infer<typeof CharacterConfigSchema>;
export type WorldManifest = z.infer<typeof WorldManifestSchema>;

export function validateWorldManifest(data: unknown): WorldManifest {
  return WorldManifestSchema.parse(data);
}
