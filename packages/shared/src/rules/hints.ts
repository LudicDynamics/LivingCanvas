/**
 * Companion hints — the pure rules.
 *
 * A world may carry `hints.json` at its root: a table of WRITTEN lines the
 * companion (or the writer, as a margin note) says when the player seems to
 * need a nudge — always right for where the player is, because each line is
 * gated on the world's own state. No model call: the line is shown as written.
 *
 *   {
 *     "by": "xia-cheng",          // default speaker: a character id, or "writer"
 *     "gap": 2,                   // at least this many beats between two hints
 *     "hints": [{
 *       "id": "lt-notebook",
 *       "when": { "layer": "world/seated-car", "lacks": ["player/su-he-notebook.md"], "idle": 1 },
 *       "say": "笔记本还摊在座位上……你先看看？",
 *       "suggest": [{ "card": "world/seated-car/su-he-notebook.md", "option": "take" }],
 *       "replies": ["这是她的笔记本？"],
 *       "priority": 80
 *     }]
 *   }
 *
 * Once per beat (POST /api/turn-end, after the triggers) the engine asks
 * `planHint` for at most ONE hint: its condition holds, it has held for `idle`
 * beats, it is not used up (`once`, `cooldown`), the last hint was at least
 * `gap` beats ago, and — in an escalation `group` — every lower `level` was
 * already said. Highest `priority` wins; a tie goes to the earlier entry.
 *
 * `hints.json` is the writer's: a character never reads it (rules/character-view.ts).
 * A hint that depends on a run's hidden truth lives in a run-variant overlay
 * (`variants/<id>/<option>/hints.json`, a whole table — the usual overlay rule).
 *
 * No I/O: `actions/hints.ts` reads the world and writes the log. Browser-safe.
 */
import { z } from 'zod';
import { collectHasPaths, COMMAND_PROFILE, evaluateCondition, parseCondition, type ConditionProfile, type Scalar } from '../commands/condition.js';

export const HINTS_FILE = 'hints.json';
/** `world/README.md` key holding the hint bookkeeping (like `trigger_log`: engine-only, no event). */
export const HINT_LOG_KEY = 'hint_log';
export const HINT_DEFAULT_GAP = 2;
export const HINT_DEFAULT_PRIORITY = 50;
export const HINT_SAY_MAX = 140;

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const LAYER_RE = /^(map|world(\/[A-Za-z0-9_-]+)+)$/;
const CARD_RE = /^(world|player)\/[A-Za-z0-9_/.-]+\.md$/;
const PATH_RE = /^(world|player|characters)\/[A-Za-z0-9_/.-]+$/;

const LayerList = z.union([z.string().regex(LAYER_RE), z.array(z.string().regex(LAYER_RE)).min(1).max(12)]);

export const HintSuggestSchema = z.union([
  /** A writer slip for an option on a card (`choice.options[].id`). */
  z.object({ card: z.string().regex(CARD_RE), option: z.string().regex(ID_RE), label: z.string().trim().min(1).max(80).optional() }).strict(),
  /** A writer slip that walks to a place. */
  z.object({ enter: z.string().regex(LAYER_RE), label: z.string().trim().min(1).max(80) }).strict(),
]);
export type HintSuggest = z.infer<typeof HintSuggestSchema>;

export const HintEntrySchema = z.object({
  id: z.string().regex(ID_RE),
  /** Speaker for this line (overrides the table's `by`). */
  by: z.string().regex(ID_RE).optional(),
  when: z.object({
    /** The page the player is on must be (one of) these. */
    layer: LayerList.optional(),
    /** A trigger-style condition: has(), player.x, world.x, <character>.x, clock.left. */
    expr: z.string().min(1).max(600).optional(),
    /** Every one of these files exists in the save. */
    has: z.array(z.string().regex(PATH_RE)).min(1).max(12).optional(),
    /** None of these files exists in the save (the condition grammar has no `!`). */
    lacks: z.array(z.string().regex(PATH_RE)).min(1).max(12).optional(),
    /** Beats the condition must have held, with the player not doing it, before the line is said. */
    idle: z.number().int().min(0).max(20).optional(),
    /** The player has been on (all of) these pages in this run. */
    visited: LayerList.optional(),
    /** The player has NOT yet been on any of these pages in this run. */
    unvisited: LayerList.optional(),
  }).strict().default({}),
  say: z.string().trim().min(1).max(HINT_SAY_MAX),
  suggest: z.array(HintSuggestSchema).max(2).optional(),
  /** Lines for the speaker's bubble this beat (what the player might say back). */
  replies: z.array(z.string().trim().min(1).max(80)).max(3).optional(),
  priority: z.number().int().min(0).max(1000).optional(),
  once: z.boolean().optional(),
  /** Beats before a repeatable (`once: false`) hint may be said again. */
  cooldown: z.number().int().min(0).max(100).optional(),
  /** An escalation ladder: same `group`, `level` 1 → 2 → 3, each said only after the one below. */
  group: z.string().regex(ID_RE).optional(),
  level: z.number().int().min(1).max(5).optional(),
  /**
   * How the player's inspiration roll reads this hint:
   * `only` — never said by the companion's beat, only through an inspiration roll; `skip` — never through one;
   * `vague` — the line a failed roll gets (a fuzzy nudge, never wrong enough to hurt); `sharp` — the line a
   * critical gets (the next step and why, still only from what the player has seen).
   */
  inspire: z.object({
    only: z.boolean().optional(),
    skip: z.boolean().optional(),
    vague: z.string().trim().min(1).max(HINT_SAY_MAX).optional(),
    sharp: z.string().trim().min(1).max(HINT_SAY_MAX).optional(),
  }).strict().optional(),
}).strict();
export type HintEntry = z.infer<typeof HintEntrySchema>;

export const HintTableSchema = z.object({
  by: z.string().regex(ID_RE).optional(),
  gap: z.number().int().min(0).max(20).optional(),
  hints: z.array(HintEntrySchema).max(80),
}).strict().superRefine((table, ctx) => {
  const seen = new Set<string>();
  for (const [i, h] of table.hints.entries()) {
    if (seen.has(h.id)) ctx.addIssue({ code: 'custom', path: ['hints', i, 'id'], message: `duplicate hint id "${h.id}"` });
    seen.add(h.id);
    if ((h.group === undefined) !== (h.level === undefined)) ctx.addIssue({ code: 'custom', path: ['hints', i], message: 'group and level go together' });
    if (h.inspire?.only && h.inspire?.skip) ctx.addIssue({ code: 'custom', path: ['hints', i, 'inspire'], message: 'inspire.only and inspire.skip contradict each other' });
  }
});
export type HintTable = z.infer<typeof HintTableSchema>;

/** Parse a hints.json text; `table` null with `errors` when it does not hold. */
export function parseHintTable(raw: unknown): { table: HintTable | null; errors: string[] } {
  let value = raw;
  if (typeof raw === 'string') {
    try { value = JSON.parse(raw); } catch (e) { return { table: null, errors: [`hints.json is not JSON: ${e instanceof Error ? e.message : String(e)}`] }; }
  }
  const parsed = HintTableSchema.safeParse(value);
  if (!parsed.success) return { table: null, errors: parsed.error.issues.map((i) => `hints.${i.path.join('.')}: ${i.message}`) };
  return { table: parsed.data, errors: [] };
}

/** The condition profile hints read: the trigger roots (player, world, clock, characters). */
export function hintConditionProfile(characterIds: readonly string[]): ConditionProfile {
  return { ...COMMAND_PROFILE, roots: ['player', 'world', 'clock', 'clues', ...characterIds.map((id) => id.replace(/-/g, '_'))] };
}

export function parseHintExpr(expr: string, characterIds: readonly string[]) {
  return parseCondition(expr, hintConditionProfile(characterIds));
}

export interface HintLog {
  /** Beats counted so far (this run). */
  beat: number;
  /** Beat of the last hint said. */
  last?: number;
  /** Hint id → beat it was last said. */
  used: Record<string, number>;
  /** Hint id → first beat its condition held (cleared when it stops holding). */
  since: Record<string, number>;
  /** Pages the player has been on, in order of first visit. */
  seen: string[];
}

export const EMPTY_HINT_LOG: HintLog = Object.freeze({ beat: 0, used: {}, since: {}, seen: [] }) as HintLog;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const intMap = (v: unknown): Record<string, number> => {
  const out: Record<string, number> = {};
  if (!isRecord(v)) return out;
  for (const [k, n] of Object.entries(v)) if (ID_RE.test(k) && Number.isInteger(n)) out[k] = n as number;
  return out;
};

/** The stored log, fail-soft (a malformed one starts over). */
export function parseHintLog(raw: unknown): HintLog {
  if (!isRecord(raw)) return { beat: 0, used: {}, since: {}, seen: [] };
  const beat = Number.isInteger(raw.beat) && (raw.beat as number) >= 0 ? (raw.beat as number) : 0;
  const last = Number.isInteger(raw.last) ? (raw.last as number) : undefined;
  const seen = Array.isArray(raw.seen) ? raw.seen.filter((s): s is string => typeof s === 'string' && LAYER_RE.test(s)).slice(0, 64) : [];
  return { beat, ...(last !== undefined ? { last } : {}), used: intMap(raw.used), since: intMap(raw.since), seen };
}

const asList = (v: string | string[] | undefined): string[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

export interface HintWorldState {
  /** The page the player is on now. */
  page: string;
  /** `player.x`, `world.x`, `<character>.x`, `clock.left`. */
  values: ReadonlyMap<string, Scalar>;
  /** Pre-resolved `has()` answers. */
  paths: ReadonlyMap<string, 'file' | 'dir' | 'missing'>;
  /** Pages visited this run (the log's `seen`, this page included). */
  seen: readonly string[];
  characterIds: readonly string[];
}

/** Does this hint's condition hold right now? Pure. A malformed or unresolved expression is "not yet". */
export function hintHolds(hint: HintEntry, state: HintWorldState): boolean {
  const w = hint.when ?? {};
  const layers = asList(w.layer);
  if (layers.length && !layers.includes(state.page)) return false;
  if (asList(w.visited).some((l) => !state.seen.includes(l))) return false;
  if (asList(w.unvisited).some((l) => state.seen.includes(l))) return false;
  if ((w.has ?? []).some((p) => (state.paths.get(p) ?? 'missing') === 'missing')) return false;
  if ((w.lacks ?? []).some((p) => (state.paths.get(p) ?? 'missing') !== 'missing')) return false;
  if (w.expr) {
    const parsed = parseHintExpr(w.expr, state.characterIds);
    if (!parsed.ok) return false;
    const r = evaluateCondition(parsed.value, { values: state.values as Map<string, Scalar>, paths: state.paths as Map<string, 'file' | 'dir' | 'missing'> });
    if (!r.ok || !r.value) return false;
  }
  return true;
}

export interface HintPlan {
  hint: HintEntry | null;
  /** The speaker: the hint's `by`, else the table's, else `writer`. */
  by: string;
  log: HintLog;
}

/**
 * One beat (pure): count it, note the page, update when each condition started holding, and pick at most one
 * hint. `stuck` (the player asked) ignores `gap` and `idle`; `hold` picks nothing (a character spoke this beat); `spent` hints
 * (every option they suggest is already done, `spentHintIds`) are passed over without being used up. `count: false` re-plans without counting a beat
 * (entering a layer when the beat itself is counted elsewhere).
 */
export function planHint(
  table: HintTable,
  state: Omit<HintWorldState, 'seen'>,
  prior: HintLog,
  opts: { stuck?: boolean; count?: boolean; hold?: boolean; spent?: ReadonlySet<string> } = {},
): HintPlan {
  const beat = prior.beat + (opts.count === false ? 0 : 1);
  const seen = prior.seen.includes(state.page) ? [...prior.seen] : [...prior.seen, state.page].slice(-64);
  const full: HintWorldState = { ...state, seen };
  const since: Record<string, number> = {};
  const holding = new Set<string>();
  for (const h of table.hints) {
    if (!hintHolds(h, full)) continue;
    holding.add(h.id);
    since[h.id] = prior.since[h.id] ?? beat;
  }
  const used = { ...prior.used };
  const gap = table.gap ?? HINT_DEFAULT_GAP;
  // `hold`: someone else already spoke up this beat (a character's tick line) — count it, say nothing yet.
  const gapOk = !opts.hold && (opts.stuck || prior.last === undefined || beat - prior.last >= gap);
  let pick: HintEntry | null = null;
  if (gapOk) {
    for (const h of table.hints) {
      if (!holding.has(h.id)) continue;
      // An inspiration-only line waits for the player's roll (rules/inspiration.ts).
      if (h.inspire?.only) continue;
      // Everything it points at is already done (「看过大衣后不再出」): pointing at a spent option is noise.
      if (opts.spent?.has(h.id)) continue;
      const once = h.once !== false;
      if (once && used[h.id] !== undefined) continue;
      if (!once && used[h.id] !== undefined && beat - used[h.id] < (h.cooldown ?? 0)) continue;
      if (!opts.stuck && beat - since[h.id] < (h.when?.idle ?? 0)) continue;
      if (h.group !== undefined && h.level !== undefined) {
        const lower = table.hints.filter((o) => o.group === h.group && (o.level ?? 0) < h.level!);
        if (lower.some((o) => used[o.id] === undefined)) continue;
      }
      if (!pick || (h.priority ?? HINT_DEFAULT_PRIORITY) > (pick.priority ?? HINT_DEFAULT_PRIORITY)) pick = h;
    }
  }
  const log: HintLog = { beat, used, since, seen, ...(prior.last !== undefined ? { last: prior.last } : {}) };
  if (pick) {
    log.used[pick.id] = beat;
    log.last = beat;
  }
  return { hint: pick, by: pick?.by ?? table.by ?? 'writer', log };
}

/** What the page shows for a hint said this beat (turn-end's `hint`). */
export interface HintView {
  id: string;
  /** A character id, or `writer` (a margin note). */
  by: string;
  say: string;
  suggest: HintSuggest[];
  replies: string[];
  beat: number;
}

export function hintViewOf(plan: HintPlan): HintView | null {
  if (!plan.hint) return null;
  return {
    id: plan.hint.id,
    by: plan.by,
    say: plan.hint.say,
    suggest: plan.hint.suggest ?? [],
    replies: plan.hint.replies ?? [],
    beat: plan.log.beat,
  };
}

/**
 * Pure: hints whose suggestions are ALL options already done (`done(card, option)`), so they are not said.
 * A hint without suggestions, or with any `enter` slip (navigation is never spent), is never in this set.
 */
export function spentHintIds(table: HintTable, done: (card: string, option: string) => boolean): Set<string> {
  const out = new Set<string>();
  for (const h of table.hints) {
    const slips = h.suggest ?? [];
    if (slips.length === 0) continue;
    if (slips.every((s) => 'card' in s && done(s.card, s.option))) out.add(h.id);
  }
  return out;
}

/** Every `has(...)` path a table's conditions read (for one stat pass). */
export function hintPathsOf(table: HintTable, characterIds: readonly string[]): string[] {
  const out = new Set<string>();
  for (const h of table.hints) {
    for (const p of [...(h.when?.has ?? []), ...(h.when?.lacks ?? [])]) out.add(p);
    if (!h.when?.expr) continue;
    const parsed = parseHintExpr(h.when.expr, characterIds);
    if (parsed.ok) for (const p of collectHasPaths(parsed.value)) out.add(p);
  }
  return [...out];
}
