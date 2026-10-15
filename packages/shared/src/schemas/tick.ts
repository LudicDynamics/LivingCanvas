/**
 * Character tick: the world.json `tick` block.
 *
 * Every few player beats, one person on the page the player is looking at
 * shows an intent — a move from a CLOSED menu the author declared here, each
 * one a `command/<run>.yaml` the engine runs — and the player has a beat to
 * take first, enter first, guard or talk. Pure zod, browser-safe.
 *
 *   "tick": {
 *     "every": 3, "window": 1, "grace": 2, "budget": 6, "landCap": 4,
 *     "caps": { "tamper": 2 },
 *     "wip": true,
 *     "actors": {
 *       "ross": {
 *         "card": "world/ross.md",
 *         "goal": "…",
 *         "moves": [{ "id": "tamper-study", "verb": "mark", "target": "world/study",
 *                     "if": "world.culprit == \"ross\"", "unless": ["world/study/study-trace.md"],
 *                     "run": "tick-ross-tamper-study", "cap": "tamper",
 *                     "label": { "intent": "…", "landed": "…", "stopped": "…" },
 *                     "counter": ["enter", "talk", "guard"] }]
 *       }
 *     }
 *   }
 */
import { z } from 'zod';
import { HintSuggestSchema } from '../rules/hints.js';

/** Verbs (§2.1): they pick the intent icon and the pointer's gesture; the command does the work. */
export const TICK_VERBS = ['approach', 'take', 'hide', 'shift', 'flip', 'mark', 'lock', 'unlock', 'note', 'talk', 'advance', 'speak', 'invite'] as const;
export type TickVerb = (typeof TICK_VERBS)[number];

/**
 * v2: moves that change nothing in the world — only say a line
 * (`speak`), come to find the player (`invite`), or leave a signed note in a declared slot (`note` with
 * `slot` and no `run`). They are never an intent: they are the「插话」beats, written by the model only
 * (no model → no such beat), so they need no `run` and no `counter`.
 */
export const isChatterMove = (move: { verb: string; run?: string; slot?: string }): boolean =>
  move.verb === 'speak' || move.verb === 'invite' || (move.verb === 'note' && move.slot !== undefined && move.run === undefined);

/** How a player can stop an intent inside its window (§4.2). */
export const TICK_COUNTERS = ['take', 'enter', 'guard', 'talk'] as const;
export type TickCounter = (typeof TICK_COUNTERS)[number];

/** A guarded target cannot be picked again for this many beats (§4.2). */
export const TICK_GUARD_BEATS = 4;
/** How many resolved moves the save keeps (the page's marks, the writer's `page_moves`). */
export const TICK_LOG_KEEP = 24;

const ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
const PATH = /^(world|player|characters)\/[A-Za-z0-9_./-]+$/;

const safePath = (p: string) => PATH.test(p) && !p.split('/').some((s) => s === '' || s === '.' || s === '..');

export const TickMoveSchema = z
  .object({
    id: z.string().regex(ID, 'a move id is lowercase ASCII kebab-case'),
    verb: z.enum(TICK_VERBS),
    /** A card on the page, a door (a layer directory shown on its parent page), or `characters/<id>`. */
    target: z.string().refine(safePath, 'target must be a world/…, player/… or characters/… path').optional(),
    /** Trigger condition algebra (world.*, player.*, <character>.*, clues.*, clock.left). */
    if: z.string().min(1).max(400).optional(),
    /** Not when any of these files exists. */
    unless: z.array(z.string().refine(safePath, 'unless entries are world/… or player/… paths')).max(12).optional(),
    /** When this holds, the move scores double. */
    urgent: z.string().min(1).max(400).optional(),
    weight: z.number().int().min(1).max(10).optional(),
    /** `command/<run>.yaml`, run as the engine when the move lands. */
    run: z.string().regex(ID).optional(),
    /** v2: a `note` chatter move writes the generated note here (a chalk the engine owns; never a condition). */
    slot: z.string().regex(/^world\/[A-Za-z0-9_/-]+\.md$/).optional(),
    label: z
      .object({
        intent: z.string().min(1).max(60),
        landed: z.string().min(1).max(240),
        stopped: z.string().min(1).max(240),
      })
      .strict()
      .optional(),
    counter: z.array(z.enum(TICK_COUNTERS)).max(4).optional(),
    /** Times this move may be shown in one run (default 1). */
    max: z.number().int().min(1).max(9).optional(),
    /** A shared landing cap (`tick.caps`). */
    cap: z.string().regex(ID).optional(),
    /** Required when a take / hide targets a key clue: the recovery path (§5.1). */
    protect: z.string().min(1).max(200).optional(),
    /**
     * v2: a speak / invite chatter move that nudges the player on: the writer's slips it points at
     * (a card option or a place to enter — the shape of a hints.json `suggest`). Shown only while the
     * option is offered; the words stay the person's own.
     */
    suggest: z.array(HintSuggestSchema).min(1).max(2).optional(),
  })
  .strict()
  .superRefine((m, ctx) => {
    if (isChatterMove(m)) {
      if (m.counter?.length || m.cap || m.protect) ctx.addIssue({ code: 'custom', message: `${m.id}: a ${m.verb} move changes nothing — no counter, cap or protect` });
      if (m.verb !== 'note' && m.slot) ctx.addIssue({ code: 'custom', path: ['slot'], message: 'only a note move has a slot' });
      if (m.verb === 'note' && m.suggest) ctx.addIssue({ code: 'custom', path: ['suggest'], message: 'a note never points the way (speak / invite only)' });
      return;
    }
    if (m.suggest) ctx.addIssue({ code: 'custom', path: ['suggest'], message: 'only a speak / invite chatter move has suggest' });
    if (!m.target) ctx.addIssue({ code: 'custom', path: ['target'], message: 'an intent needs a target on the page' });
    if (!m.run) ctx.addIssue({ code: 'custom', path: ['run'], message: 'an intent needs a run command' });
    if (!m.label) ctx.addIssue({ code: 'custom', path: ['label'], message: 'an intent needs its intent / landed / stopped words' });
    if (!m.counter || m.counter.length === 0) ctx.addIssue({ code: 'custom', path: ['counter'], message: 'an intent needs at least one counter' });
    if (m.slot) ctx.addIssue({ code: 'custom', path: ['slot'], message: 'a slot belongs to a note chatter move (no run)' });
  });
export type TickMoveRaw = z.infer<typeof TickMoveSchema>;
/** An intent move (v1): everything a world needs to show, counter and land it. */
export type TickMove = TickMoveRaw & { target: string; run: string; label: { intent: string; landed: string; stopped: string }; counter: TickCounter[] };
/** A chatter move (v2): speak / invite / note-in-a-slot. */
export type TickChatterMove = TickMoveRaw & { verb: 'speak' | 'invite' | 'note' };

export const TickActorSchema = z
  .object({
    /** An NPC card's path; a registered character (world.json `characters`) has none. */
    card: z.string().regex(/^world\/[A-Za-z0-9_/-]+\.md$/).optional(),
    /** One line for the writer (and a future chooser); never shown to the player. */
    goal: z.string().min(1).max(200),
    moves: z.array(TickMoveSchema).min(1).max(16),
  })
  .strict();
export type TickActorRaw = z.infer<typeof TickActorSchema>;
export interface TickActor {
  card?: string;
  goal: string;
  /** The intents (v1): every move with a run command. */
  moves: TickMove[];
  /** The chatter moves (v2): speak / invite / note-in-a-slot. */
  chatter: TickChatterMove[];
}

/**
 * v2 pacing. Lower than the first draft on purpose —
 * 「频率可以低一点，不然太假，这里面会有一个度」.
 */
export const TickPaceSchema = z
  .object({
    /** First beats on a page: no intent, no line. */
    pageGrace: z.number().int().min(1).max(12).optional(),
    /** Beats between two character-initiated lines (any character). */
    lineGap: z.number().int().min(2).max(12).optional(),
    /** Beats before the same person speaks up again. */
    cooldown: z.number().int().min(1).max(24).optional(),
    /** Chatter beats (speak / invite / note) per run. */
    chatter: z.number().int().min(0).max(20).optional(),
    /** On a beat chatter is allowed, the seeded chance it happens. */
    chatterChance: z.number().min(0).max(1).optional(),
  })
  .strict();
export interface TickPace {
  pageGrace: number;
  lineGap: number;
  cooldown: number;
  chatter: number;
  chatterChance: number;
}
export const TICK_PACE_DEFAULTS: TickPace = { pageGrace: 2, lineGap: 3, cooldown: 6, chatter: 4, chatterChance: 0.35 };

/** v2 per-run model caps in estimated credits. */
export const TickModelCapSchema = z
  .object({
    credits: z.number().min(0).max(200).optional(),
    guestCredits: z.number().min(0).max(200).optional(),
  })
  .strict();
export const TICK_MODEL_CAP_DEFAULTS = { credits: 20, guestCredits: 8 } as const;

export const WorldTickSchema = z
  .object({
    every: z.number().int().min(1).max(12).optional(),
    window: z.number().int().min(1).max(3).optional(),
    grace: z.number().int().min(0).max(12).optional(),
    budget: z.number().int().min(1).max(40).optional(),
    landCap: z.number().int().min(0).max(40).optional(),
    chooser: z.enum(['rules', 'model']).optional(),
    /** Direct clock / hp costs: only a trpg world may opt in (§5.2). */
    costs: z.boolean().optional(),
    caps: z.record(z.string().regex(ID), z.number().int().min(0).max(20)).optional(),
    /** 「制作中」: the page marks the feature as still being tuned. */
    wip: z.boolean().optional(),
    /** v2 pacing knobs (§9.1). */
    pace: TickPaceSchema.optional(),
    /** v2 per-run model caps (estimated credits). */
    modelCap: TickModelCapSchema.optional(),
    /** v2: words no generated line may contain in this world (on top of each person's never_say). */
    deny: z.array(z.string().min(1).max(40)).max(60).optional(),
    actors: z.record(z.string().regex(ID), TickActorSchema).refine((a) => Object.keys(a).length > 0, 'tick needs at least one actor'),
  })
  .strict();
export type WorldTickRaw = z.infer<typeof WorldTickSchema>;

/** The block with every default filled in. */
export interface WorldTick {
  every: number;
  window: number;
  grace: number;
  budget: number;
  landCap: number;
  chooser: 'rules' | 'model';
  costs: boolean;
  caps: Record<string, number>;
  wip: boolean;
  pace: TickPace;
  modelCap: { credits: number; guestCredits: number };
  deny: string[];
  actors: Record<string, TickActor>;
}

export const TICK_DEFAULTS = { every: 3, window: 1, grace: 2, budget: 6, landCap: 4 } as const;

/** Parse world.json `tick`; `tick: null` when absent or malformed (`errors` say why). */
export function parseWorldTick(raw: unknown): { tick: WorldTick | null; errors: string[] } {
  if (raw === undefined) return { tick: null, errors: [] };
  const parsed = WorldTickSchema.safeParse(raw);
  if (!parsed.success) return { tick: null, errors: parsed.error.issues.map((i) => `tick.${i.path.join('.')}: ${i.message}`) };
  const t = parsed.data;
  return {
    tick: {
      every: t.every ?? TICK_DEFAULTS.every,
      window: t.window ?? TICK_DEFAULTS.window,
      grace: t.grace ?? TICK_DEFAULTS.grace,
      budget: t.budget ?? TICK_DEFAULTS.budget,
      landCap: t.landCap ?? TICK_DEFAULTS.landCap,
      chooser: t.chooser ?? 'rules',
      costs: t.costs === true,
      caps: t.caps ?? {},
      wip: t.wip === true,
      pace: { ...TICK_PACE_DEFAULTS, ...(t.pace ?? {}) },
      modelCap: { ...TICK_MODEL_CAP_DEFAULTS, ...(t.modelCap ?? {}) },
      deny: t.deny ?? [],
      actors: Object.fromEntries(Object.entries(t.actors).map(([id, a]) => [id, {
        ...(a.card ? { card: a.card } : {}),
        goal: a.goal,
        moves: a.moves.filter((m) => !isChatterMove(m)) as TickMove[],
        chatter: a.moves.filter((m) => isChatterMove(m)) as TickChatterMove[],
      }])),
    },
    errors: [],
  };
}

/** The player's per-save setting. */
export const TICK_MODES = ['off', 'easy', 'standard'] as const;
export type TickMode = (typeof TICK_MODES)[number];

/** `easy` = one more beat to react and half the landings. */
export function tickForMode(tick: WorldTick, mode: TickMode): WorldTick {
  if (mode !== 'easy') return tick;
  return { ...tick, window: tick.window + 1, landCap: Math.floor(tick.landCap / 2) };
}
