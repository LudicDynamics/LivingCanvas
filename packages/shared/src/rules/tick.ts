/**
 * Character tick — the pure rules.
 *
 * Time is the player's beat, never the wall clock. One beat:
 *
 *   1. a pending intent is resolved first — stopped by a counter the player
 *      played (take first / enter first / guard / talk), voided when the player
 *      left the page, landed once it has been SEEN for `window` beats;
 *   2. otherwise, after `grace`, on a page with actors, every `every` quiet
 *      beats: the next person in a seeded rotation who has a legal move shows
 *      one intent, picked by `weight × urgency` from a seeded draw.
 *
 * Turn order is a rotation, not "who is most eager": in a mystery, how often
 * someone acts must not give the culprit away (§1.3). Same save, same history
 * → same choices (FNV-1a of the run seed + beat), so a rollback replays alike.
 *
 * No I/O here: `actions/tick.ts` reads the world, asks these functions, and
 * runs the landed move's command. Browser-safe.
 */
import { TICK_GUARD_BEATS, TICK_LOG_KEEP, type TickChatterMove, type TickCounter, type TickMove, type TickVerb, type WorldTick } from '../schemas/tick.js';

/**
 * v2: what the person wrote, in their own voice — a claim, never a fact.
 * Only ever filled from a validated model answer (rules/tick-model.ts).
 */
export interface TickWords {
  /** One line said aloud (a bubble beside their pointer / portrait). */
  say?: string;
  /** A signed note left in the move's slot. */
  note?: { title: string; body: string };
  /** 「X 想跟你单独说两句」: they come to find the player. */
  invite?: string;
  /** A small emote. */
  mood?: string;
}

export interface TickPending {
  /** `<beat>:<actor>/<move>` — stable for the page's `seen` / `guard`. */
  id: string;
  actor: string;
  move: string;
  verb: TickVerb;
  target: string;
  /** The page (layer id) it shows on. */
  page: string;
  /** Beat it was shown on. */
  beat: number;
  /** Beat the page reported drawing it; null = not seen yet (its window does not run). */
  seen: number | null;
  /** Event seq when it was shown: counters are read from events after it. */
  seq: number;
  /** The actor's NPC dialogue length when it was shown (talk counter). */
  talk: number;
  /** v2: the person's own words for this intent (a validated model answer). */
  words?: TickWords;
}

/** `said`: a v2 chatter beat (speak / invite / note) — nothing to counter, it happened as it showed. */
export type TickMoveResult = 'landed' | 'stopped' | 'void' | 'said';

export interface TickLogEntry {
  id: string;
  actor: string;
  move: string;
  verb: TickVerb;
  target: string;
  page: string;
  /** Beat it was resolved on. */
  beat: number;
  result: TickMoveResult;
  /** What stopped it. */
  by?: TickCounter;
  /** The landed command failed (the log keeps the attempt; nothing changed). */
  error?: string;
  /** v2: the person's own words (said with the intent, or the chatter itself). */
  words?: TickWords;
  /** ISO time it was resolved (stamped when the state is written; older saves have none). The message drawer orders on it. */
  at?: string;
}

/**
 * The message drawer's key for one log entry: its id, made unique by its time. A chatter id
 * (`<beat>:<actor>/<move>`) comes back after a loop reset puts the beat counter back, so the id alone is not enough.
 */
export function tickStreamKey(entry: { id: string; at?: string }): string {
  return entry.at ? `${entry.id}@${entry.at}` : entry.id;
}

/** One character-initiated line (v2 pacing, §9.1). */
export interface TickLine {
  beat: number;
  actor: string;
}

/** v2: what the model cost this run (estimated credits). */
export interface TickModelUse {
  calls: number;
  credits: number;
}

/** `world/README.md` frontmatter `tick`: engine bookkeeping, reserved from commands and agents. */
export interface TickState {
  seed: string;
  beat: number;
  /** The page the player was on at the last beat, and how many beats they have spent there. */
  page: string | null;
  pageBeats: number;
  /** Beats on pages with actors since the last intent ended. */
  quiet: number;
  /** Seeded actor rotation and whose turn is next. */
  order: string[];
  turn: number;
  issued: number;
  landed: number;
  /** `<actor>/<move>` → times shown. */
  used: Record<string, number>;
  /** `tick.caps` id → times landed. */
  capLanded: Record<string, number>;
  /** Target → first beat it may be picked again. */
  guarded: Record<string, number>;
  pending: TickPending | null;
  log: TickLogEntry[];
  /** v2: the last character-initiated lines (newest last). */
  lines: TickLine[];
  /** v2: chatter beats used, and whose chatter turn is next. */
  chatter: number;
  chatterTurn: number;
  /** v2: model use this run. */
  model: TickModelUse;
}

export const TICK_STATE_KEY = 'tick';
const LINES_KEEP = 12;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const int = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : d);
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const counts = (v: unknown): Record<string, number> =>
  isObj(v) ? Object.fromEntries(Object.entries(v).filter(([, n]) => typeof n === 'number' && Number.isFinite(n)).map(([k, n]) => [k, Math.floor(n as number)])) : {};

export function freshTickState(seed: string, actorIds: readonly string[]): TickState {
  return {
    seed,
    beat: 0,
    page: null,
    pageBeats: 0,
    quiet: 0,
    order: tickActorOrder(seed, actorIds),
    turn: 0,
    issued: 0,
    landed: 0,
    used: {},
    capLanded: {},
    guarded: {},
    pending: null,
    log: [],
    lines: [],
    chatter: 0,
    chatterTurn: 0,
    model: { calls: 0, credits: 0 },
  };
}

const MOODS = new Set(['dots', 'question', 'exclaim', 'sigh', 'sweat', 'smile']);
const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
function parseWords(v: unknown): TickWords | undefined {
  if (!isObj(v)) return undefined;
  const note = isObj(v.note) && text(v.note.body, 400) ? { title: text(v.note.title, 60) ?? '', body: text(v.note.body, 400)! } : undefined;
  const out: TickWords = {
    ...(text(v.say, 200) ? { say: text(v.say, 200) } : {}),
    ...(note ? { note } : {}),
    ...(text(v.invite, 200) ? { invite: text(v.invite, 200) } : {}),
    ...(typeof v.mood === 'string' && MOODS.has(v.mood) ? { mood: v.mood } : {}),
  };
  return Object.keys(out).length > 0 ? out : undefined;
}

function parsePending(v: unknown): TickPending | null {
  if (!isObj(v) || !str(v.id) || !str(v.actor) || !str(v.move) || !str(v.target) || !str(v.page)) return null;
  return {
    id: str(v.id),
    actor: str(v.actor),
    move: str(v.move),
    verb: str(v.verb) as TickVerb,
    target: str(v.target),
    page: str(v.page),
    beat: int(v.beat),
    seen: typeof v.seen === 'number' && Number.isFinite(v.seen) ? Math.floor(v.seen) : null,
    seq: int(v.seq),
    talk: int(v.talk),
    ...(parseWords(v.words) ? { words: parseWords(v.words) } : {}),
  };
}

function parseEntry(v: unknown): TickLogEntry | null {
  if (!isObj(v) || !str(v.id) || !str(v.actor) || !str(v.target)) return null;
  const result = v.result === 'landed' || v.result === 'stopped' || v.result === 'void' || v.result === 'said' ? v.result : null;
  if (!result) return null;
  return {
    id: str(v.id),
    actor: str(v.actor),
    move: str(v.move),
    verb: str(v.verb) as TickVerb,
    target: str(v.target),
    page: str(v.page),
    beat: int(v.beat),
    result,
    ...(v.by === 'take' || v.by === 'enter' || v.by === 'guard' || v.by === 'talk' ? { by: v.by } : {}),
    ...(typeof v.error === 'string' ? { error: v.error.slice(0, 300) } : {}),
    ...(parseWords(v.words) ? { words: parseWords(v.words) } : {}),
    ...(typeof v.at === 'string' && v.at.length <= 40 && !Number.isNaN(Date.parse(v.at)) ? { at: v.at } : {}),
  };
}

/** Parse the saved record; a missing / malformed one starts afresh. */
export function parseTickState(raw: unknown, seed: string, actorIds: readonly string[]): TickState {
  if (!isObj(raw)) return freshTickState(seed, actorIds);
  const savedSeed = str(raw.seed) || seed;
  const order = Array.isArray(raw.order) ? raw.order.filter((id): id is string => typeof id === 'string' && actorIds.includes(id)) : [];
  return {
    seed: savedSeed,
    beat: int(raw.beat),
    page: typeof raw.page === 'string' ? raw.page : null,
    pageBeats: int(raw.pageBeats),
    quiet: int(raw.quiet),
    // A world that gained / lost an actor since: the rotation is drawn again.
    order: order.length === actorIds.length ? order : tickActorOrder(savedSeed, actorIds),
    turn: int(raw.turn),
    issued: int(raw.issued),
    landed: int(raw.landed),
    used: counts(raw.used),
    capLanded: counts(raw.capLanded),
    guarded: counts(raw.guarded),
    pending: parsePending(raw.pending),
    log: Array.isArray(raw.log) ? raw.log.map(parseEntry).filter((e): e is TickLogEntry => e !== null).slice(-TICK_LOG_KEEP) : [],
    lines: Array.isArray(raw.lines)
      ? raw.lines.filter((l): l is Record<string, unknown> => isObj(l) && typeof l.actor === 'string').map((l) => ({ beat: int(l.beat), actor: str(l.actor) })).slice(-LINES_KEEP)
      : [],
    chatter: int(raw.chatter),
    chatterTurn: int(raw.chatterTurn),
    model: isObj(raw.model) ? { calls: int(raw.model.calls), credits: typeof raw.model.credits === 'number' && Number.isFinite(raw.model.credits) ? Math.max(0, raw.model.credits) : 0 } : { calls: 0, credits: 0 },
  };
}

/** The record as it is written to frontmatter (plain JSON-able data). */
export function serializeTickState(state: TickState): Record<string, unknown> {
  return JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
}

// ---- seeded draws -------------------------------------------------------------

/** 32-bit FNV-1a (same as run variants): identical in Node and the browser. */
export function tickHash(text: string): number {
  let h = 0x811c9dc5;
  for (const ch of new TextEncoder().encode(text)) {
    h ^= ch;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32 over a hash: a tiny deterministic stream. */
export function tickRng(seed: string): () => number {
  let a = tickHash(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The rotation: the actors shuffled once by the run seed. */
export function tickActorOrder(seed: string, actorIds: readonly string[]): string[] {
  const rng = tickRng(`${seed}:tick:order`);
  const out = [...actorIds].sort();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ---- where things are ------------------------------------------------------------

/** The layer id of a world directory (`world` → `map`). */
export const layerIdOfDir = (dir: string): string => (dir === 'world' ? 'map' : dir);

/**
 * The page a target is shown on: a card's own layer, a door's PARENT layer
 * (a layer directory is a door on the page above it). `characters/<id>` has no
 * fixed page — the caller asks presence.
 */
export function pageOfTickTarget(target: string): string | null {
  if (target.startsWith('characters/')) return null;
  const clean = target.replace(/\/+$/, '').replace(/\/README\.md$/, '');
  const parts = clean.split('/');
  if (parts.length < 2) return null;
  return layerIdOfDir(parts.slice(0, -1).join('/'));
}

/** A target that is a door (a layer directory), not a card. */
export const isDoorTarget = (target: string): boolean => !target.startsWith('characters/') && !/\.[a-z]+$/i.test(target);

/** The layer a door target opens (`world/study` → `world/study`). */
export const doorLayerOf = (target: string): string => layerIdOfDir(target.replace(/\/+$/, '').replace(/\/README\.md$/, ''));

export const tickMoveKey = (actor: string, move: string): string => `${actor}/${move}`;

// ---- choosing -----------------------------------------------------------------

export interface LegalMove {
  actor: string;
  move: TickMove;
  /** `urgent` holds now. */
  urgent: boolean;
}

/**
 * Whether a move may be shown now, on what the engine already knows (the
 * world-reading parts — target on this page, `if`, `unless` — are the caller's).
 */
export function tickMoveAllowed(state: TickState, tick: WorldTick, actor: string, move: TickMove): boolean {
  if ((state.used[tickMoveKey(actor, move.id)] ?? 0) >= (move.max ?? 1)) return false;
  if (move.cap !== undefined && (state.capLanded[move.cap] ?? 0) >= (tick.caps[move.cap] ?? Infinity)) return false;
  const until = state.guarded[move.target];
  if (until !== undefined && state.beat < until) return false;
  return true;
}

/**
 * The next intent: the rotation's next person with a legal move, then a
 * weighted draw among their moves (`weight × 2` when urgent). Null = nobody here
 * can do anything right now.
 */
export function chooseTickIntent(
  state: TickState,
  legal: readonly LegalMove[],
): { pick: LegalMove; turn: number } | null {
  const n = state.order.length;
  for (let k = 0; k < n; k += 1) {
    const actor = state.order[(state.turn + k) % n];
    const mine = legal.filter((m) => m.actor === actor);
    if (mine.length === 0) continue;
    const rng = tickRng(`${state.seed}:tick:${state.beat}`);
    const weights = mine.map((m) => (m.move.weight ?? 1) * (m.urgent ? 2 : 1));
    const total = weights.reduce((a, b) => a + b, 0);
    let roll = rng() * total;
    let pick = mine[mine.length - 1];
    for (let i = 0; i < mine.length; i += 1) {
      roll -= weights[i];
      if (roll < 0) {
        pick = mine[i];
        break;
      }
    }
    return { pick, turn: (state.turn + k + 1) % n };
  }
  return null;
}

// ---- one beat --------------------------------------------------------------------

export interface TickBeatInput {
  /** The page (layer id) the player is on now. */
  page: string;
  /** At least one actor stands on this page. */
  actorsHere: boolean;
  /** Every move that may be shown now (already filtered by `tickMoveAllowed` and the world reads). */
  legal: readonly LegalMove[];
  /** The counter the player played against the pending intent since it showed, if any. */
  counter: TickCounter | null;
  /** The player left the page by the pending intent's own door (`enter` first). */
  enteredTarget: boolean;
  /** This beat IS the player guarding the pending intent with this id. */
  guard: string | null;
  /** Current event seq and the chosen actor's NPC dialogue length (for the next counter read). */
  seq: number;
  talkOf(actor: string): number;
  /** The pending intent's move, to read its `counter` list. */
  moveOf(actor: string, move: string): TickMove | null;
}

export type TickOutcome =
  | { kind: 'none' }
  | { kind: 'issued'; pending: TickPending }
  | { kind: 'resolved'; entry: TickLogEntry; move: TickMove | null };

function resolve(state: TickState, p: TickPending, result: TickMoveResult, by?: TickCounter): TickLogEntry {
  const entry: TickLogEntry = {
    id: p.id,
    actor: p.actor,
    move: p.move,
    verb: p.verb,
    target: p.target,
    page: p.page,
    beat: state.beat,
    result,
    ...(by ? { by } : {}),
    ...(p.words ? { words: p.words } : {}),
  };
  state.log = [...state.log, entry].slice(-TICK_LOG_KEEP);
  state.pending = null;
  state.quiet = 0;
  return entry;
}

/** Advance the record by one player beat. Returns the new record (the input is not mutated) and what happened. */
export function stepTickBeat(prev: TickState, tick: WorldTick, input: TickBeatInput): { state: TickState; outcome: TickOutcome } {
  const state: TickState = JSON.parse(JSON.stringify(prev));
  state.beat += 1;
  if (state.page !== input.page) {
    state.page = input.page;
    state.pageBeats = 0;
  }
  state.pageBeats += 1;
  for (const [target, until] of Object.entries(state.guarded)) if (until <= state.beat) delete state.guarded[target];

  const p = state.pending;
  if (p) {
    const move = input.moveOf(p.actor, p.move);
    const allows = (c: TickCounter) => !move || move.counter.includes(c);
    if (input.guard !== null && input.guard === p.id && allows('guard')) {
      state.guarded[p.target] = state.beat + TICK_GUARD_BEATS;
      return { state, outcome: { kind: 'resolved', entry: resolve(state, p, 'stopped', 'guard'), move } };
    }
    if (p.page !== input.page) {
      // The player is not here: nothing happens out of their sight. Through its own door = "you got there first".
      const entry = input.enteredTarget && allows('enter') ? resolve(state, p, 'stopped', 'enter') : resolve(state, p, 'void');
      return { state, outcome: { kind: 'resolved', entry, move } };
    }
    if (p.seen === null) return { state, outcome: { kind: 'none' } };
    if (input.counter && allows(input.counter)) {
      return { state, outcome: { kind: 'resolved', entry: resolve(state, p, 'stopped', input.counter), move } };
    }
    if (state.beat - p.seen >= tick.window) {
      const entry = resolve(state, p, 'landed');
      state.landed += 1;
      if (move?.cap) state.capLanded[move.cap] = (state.capLanded[move.cap] ?? 0) + 1;
      return { state, outcome: { kind: 'resolved', entry, move } };
    }
    return { state, outcome: { kind: 'none' } };
  }

  // Nothing pending: count quiet beats only where someone could act.
  if (!input.actorsHere) return { state, outcome: { kind: 'none' } };
  state.quiet += 1;
  if (state.beat <= tick.grace) return { state, outcome: { kind: 'none' } };
  // The first beats on a page are never an ambush (v2: `pace.pageGrace`, default 2).
  if (state.pageBeats <= Math.max(1, tick.pace?.pageGrace ?? 1)) return { state, outcome: { kind: 'none' } };
  if (state.quiet < tick.every) return { state, outcome: { kind: 'none' } };
  if (state.issued >= tick.budget || state.landed >= tick.landCap) return { state, outcome: { kind: 'none' } };
  const legal = input.legal.filter((m) => tickMoveAllowed(state, tick, m.actor, m.move));
  const chosen = chooseTickIntent(state, legal);
  if (!chosen) return { state, outcome: { kind: 'none' } };
  const { pick, turn } = chosen;
  state.turn = turn;
  state.issued += 1;
  const key = tickMoveKey(pick.actor, pick.move.id);
  state.used[key] = (state.used[key] ?? 0) + 1;
  const pending: TickPending = {
    id: `${state.beat}:${key}`,
    actor: pick.actor,
    move: pick.move.id,
    verb: pick.move.verb,
    target: pick.move.target,
    page: input.page,
    beat: state.beat,
    seen: null,
    seq: input.seq,
    talk: input.talkOf(pick.actor),
  };
  state.pending = pending;
  return { state, outcome: { kind: 'issued', pending } };
}

/** The page drew the intent: its window starts now. Idempotent; false for a stale id. */
export function markTickSeen(state: TickState, id: string): boolean {
  if (!state.pending || state.pending.id !== id) return false;
  if (state.pending.seen === null) state.pending.seen = state.beat;
  return true;
}

// ---- what the page sees ------------------------------------------------------------

export interface TickIntentView {
  /** v2: the person's own words for it (a claim). */
  words?: TickWords;
  id: string;
  actor: string;
  name: string;
  /** The actor's NPC card, or `characters/<id>` (whom to talk to). */
  card: string;
  verb: TickVerb;
  target: string;
  page: string;
  label: string;
  counter: TickCounter[];
  seen: boolean;
}

export interface TickEntryView {
  id: string;
  actor: string;
  name: string;
  /** The actor's NPC card, or `characters/<id>`. */
  card: string;
  verb: TickVerb;
  target: string;
  page: string;
  beat: number;
  result: TickMoveResult;
  by?: TickCounter;
  /** The words for it: landed / stopped text (void has none); for `said`, empty. */
  text: string;
  label: string;
  /** v2: what the person said / wrote / asked (a claim). */
  words?: TickWords;
  /** v2: a chatter beat (speak / invite / note), not an intent. */
  chatter?: boolean;
  /** ISO time it was resolved, when the save recorded one (`tickStreamKey`). */
  at?: string;
}

export interface TickView {
  /** This world declares `tick` and the save has it on. */
  enabled: boolean;
  mode: 'off' | 'easy' | 'standard';
  wip: boolean;
  beat: number;
  pending: TickIntentView | null;
  /** Newest last. */
  recent: TickEntryView[];
  /** Targets a landed move touched (a door 「有人动过」, a card marked). */
  touched: { target: string; actor: string; name: string }[];
  /** v2: the people write their own words (the save's 「角色自己说话」 is on). */
  voices?: boolean;
  /** v2: an open 「X 想跟你单独说两句」 (one at a time; withdrawn after `TICK_INVITE_BEATS`). */
  invite?: { id: string; actor: string; name: string; card: string; text: string; page: string; beat: number } | null;
}

export const EMPTY_TICK_VIEW: TickView = { enabled: false, mode: 'off', wip: false, beat: 0, pending: null, recent: [], touched: [] };

/** An unanswered invite withdraws itself after this many beats. */
export const TICK_INVITE_BEATS = 2;

// ---- v2 pacing --------------------------------------

/** Beats since anyone last spoke up (Infinity = never). */
export const beatsSinceLine = (state: TickState, beat: number = state.beat): number => {
  const last = state.lines[state.lines.length - 1];
  return last ? beat - last.beat : Infinity;
};

/** This person may speak up now: `gap` beats since anyone's line, `cooldown` since their own. */
export function tickLineAllowed(state: TickState, tick: WorldTick, actor: string, gap: number): boolean {
  if (beatsSinceLine(state) < gap) return false;
  for (let i = state.lines.length - 1; i >= 0; i -= 1) {
    const l = state.lines[i];
    if (l.actor === actor) return state.beat - l.beat >= tick.pace.cooldown;
  }
  return true;
}

/** An intent's own line: never back to back with another (2 beats), and the person's cooldown. */
export const tickIntentLineAllowed = (state: TickState, tick: WorldTick, actor: string): boolean => tickLineAllowed(state, tick, actor, 2);

export function recordTickLine(state: TickState, actor: string): void {
  state.lines = [...state.lines, { beat: state.beat, actor }].slice(-LINES_KEEP);
}

/** The open invite, if any (one at a time, gone after `TICK_INVITE_BEATS`, or once the player talked to them). */
export function openTickInvite(state: TickState): TickLogEntry | null {
  for (let i = state.log.length - 1; i >= 0; i -= 1) {
    const e = state.log[i];
    if (e.result !== 'said' || !e.words?.invite) continue;
    return state.beat - e.beat < TICK_INVITE_BEATS ? e : null;
  }
  return null;
}

export interface ChatterPlan {
  actor: string;
  moves: TickChatterMove[];
}

/**
 * Whether this quiet beat gets a chatter line, and whose (v2 §9.1). Call after `stepTickBeat` came back
 * `none` with nothing pending. Rules, in order: actors here; past `grace` and the page's `pageGrace`;
 * chatter left this run; not the beat before an intent is due; `lineGap` since anyone spoke; the seeded
 * `chatterChance`; then the chatter rotation's next person here, out of cooldown, with a chatter move.
 * Deterministic: same save, same history → same answer.
 */
export function planTickChatter(
  state: TickState,
  tick: WorldTick,
  input: { present: readonly string[]; movesOf(actor: string): TickChatterMove[] },
): ChatterPlan | null {
  const pace = tick.pace;
  if (state.pending || input.present.length === 0) return null;
  if (state.beat <= tick.grace || state.pageBeats <= pace.pageGrace) return null;
  if (state.chatter >= pace.chatter) return null;
  // Not the beat right before an intent is due: the intent is the next beat's moment.
  const intentsLeft = state.issued < tick.budget && state.landed < tick.landCap;
  if (intentsLeft && state.quiet === tick.every - 1) return null;
  if (beatsSinceLine(state) < pace.lineGap) return null;
  if (tickRng(`${state.seed}:chatter:${state.beat}`)() >= pace.chatterChance) return null;
  const n = state.order.length;
  const inviteOpen = openTickInvite(state) !== null;
  for (let k = 0; k < n; k += 1) {
    const actor = state.order[(state.chatterTurn + k) % n];
    if (!input.present.includes(actor)) continue;
    if (!tickLineAllowed(state, tick, actor, pace.lineGap)) continue;
    const moves = input
      .movesOf(actor)
      .filter((m) => (state.used[tickMoveKey(actor, m.id)] ?? 0) < (m.max ?? 9))
      .filter((m) => !(m.verb === 'invite' && inviteOpen));
    if (moves.length === 0) continue;
    return { actor, moves };
  }
  return null;
}

/** A chatter beat happened: spend it, move the rotation on, remember the line. */
export function recordTickChatter(state: TickState, actor: string, move: TickChatterMove, words: TickWords, page: string): TickLogEntry {
  state.chatter += 1;
  const n = state.order.length;
  const at = state.order.indexOf(actor);
  state.chatterTurn = n > 0 ? (at + 1) % n : 0;
  const key = tickMoveKey(actor, move.id);
  state.used[key] = (state.used[key] ?? 0) + 1;
  recordTickLine(state, actor);
  const entry: TickLogEntry = {
    id: `${state.beat}:${key}`,
    actor,
    move: move.id,
    verb: move.verb,
    target: move.verb === 'note' && move.slot ? move.slot : move.target ?? `characters/${actor}`,
    page,
    beat: state.beat,
    result: 'said',
    words,
  };
  state.log = [...state.log, entry].slice(-TICK_LOG_KEEP);
  return entry;
}

export function tickMoveOf(tick: WorldTick, actor: string, move: string): TickMove | null {
  return tick.actors[actor]?.moves.find((m) => m.id === move) ?? null;
}

export function tickChatterMoveOf(tick: WorldTick, actor: string, move: string): TickChatterMove | null {
  return tick.actors[actor]?.chatter?.find((m) => m.id === move) ?? null;
}

export function tickViewOf(
  state: TickState,
  tick: WorldTick,
  mode: 'off' | 'easy' | 'standard',
  nameOf: (actor: string) => string,
): TickView {
  const p = state.pending;
  const pm = p ? tickMoveOf(tick, p.actor, p.move) : null;
  const recent = state.log.slice(-8).map((e): TickEntryView => {
    const m = tickMoveOf(tick, e.actor, e.move);
    return {
      id: e.id,
      actor: e.actor,
      name: nameOf(e.actor),
      card: tick.actors[e.actor]?.card ?? `characters/${e.actor}`,
      verb: e.verb,
      target: e.target,
      page: e.page,
      beat: e.beat,
      result: e.result,
      ...(e.by ? { by: e.by } : {}),
      text: e.result === 'landed' ? m?.label.landed ?? '' : e.result === 'stopped' ? m?.label.stopped ?? '' : '',
      label: m?.label.intent ?? '',
      ...(e.words ? { words: e.words } : {}),
      ...(e.result === 'said' ? { chatter: true } : {}),
      ...(e.at ? { at: e.at } : {}),
    };
  });
  const inv = openTickInvite(state);
  const touched = state.log
    .filter((e) => e.result === 'landed' && !e.error && (e.verb === 'mark' || e.verb === 'lock' || e.verb === 'flip'))
    .map((e) => ({ target: e.target, actor: e.actor, name: nameOf(e.actor) }));
  return {
    enabled: mode !== 'off',
    mode,
    wip: tick.wip,
    beat: state.beat,
    pending: p && pm
      ? { id: p.id, actor: p.actor, name: nameOf(p.actor), card: tick.actors[p.actor]?.card ?? `characters/${p.actor}`, verb: p.verb, target: p.target, page: p.page, label: pm.label.intent, counter: [...pm.counter], seen: p.seen !== null, ...(p.words ? { words: p.words } : {}) }
      : null,
    recent,
    touched,
    invite: inv && inv.words?.invite
      ? { id: inv.id, actor: inv.actor, name: nameOf(inv.actor), card: tick.actors[inv.actor]?.card ?? `characters/${inv.actor}`, text: inv.words.invite, page: inv.page, beat: inv.beat }
      : null,
  };
}
