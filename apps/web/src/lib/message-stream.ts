/**
 * message-stream.ts — the one timeline of everything said in a run.
 *
 * The canvas keeps the world (places, items, exits, options) and the newest
 * narration; every word — the writer's chalk, a character's reply, a line a
 * character said on their own turn, what the player said, a dice result, a
 * story event — lands here, in time order, and the bottom drawer
 * (components/chrome/MessageDrawer.tsx) reads it.
 *
 * Live, each entry is a projection of something the page already receives (a
 * chalk file on this layer, the dock's dialogue lines, the tick view, the dice
 * ceremony store, world events); this module gives them one order and one id
 * space.
 *
 * The history comes from the server: opening a save reads the
 * newest page of `GET /api/world/stream`, scrolling up reads older pages. The
 * server rebuilds it from the save (event log, chalk files, the sessions, NPC
 * cards, the tick log) with the page's own ids where it can (`chalk:<path>`,
 * `tick:<key>:say`, `npc:<path>:<n>:<text>`, `event:<event id>`), so those are
 * the same entry, not a second one; a line the page stamped on its own (a dock
 * line, a roll's ceremony, the writer box) is matched by what it says
 * (`streamFingerprint`) and becomes the server's entry. A server entry is
 * authoritative for its time.
 *
 * Before the history arrives — or for what the server cannot rebuild — a chalk
 * is stamped the first time this tab sees it: the chalks already on a layer
 * when it is first opened are seated just before "now", in file order
 * (`NN-slug.md`), and a chalk that lands later is stamped when it lands. The
 * rest is stamped on arrival. A copy lives for the tab session (sessionStorage,
 * per save, the newest `STREAM_CAP`), so a reload paints at once.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

export type StreamKind = 'writer' | 'character' | 'you' | 'dice' | 'event' | 'loop';

export interface StreamEntry {
  /** Stable id: `chalk:<path>`, `dock:<character>:<n>:<text>`, `tick:<id>`, `dice:<n>`, `event:<id>`, `you:<n>`. */
  id: string;
  kind: StreamKind;
  text: string;
  /** Epoch ms; the timeline sorts on it. */
  at: number;
  /** A character id (`character`) or the addressee of the player's words (`you`: `writer` or a character id). */
  who?: string;
  /** Display name, when the speaker is not a known character (an NPC card, an event's subject). */
  name?: string;
  /** A chalk's title, an event's title, a roll's description. */
  title?: string;
  /** The layer it happened on, for the place dividers. */
  layer?: string | null;
  /** The chalk file this entry is (writer entries only): the canvas jumps here by it. */
  chalkPath?: string;
  /** A dice result. */
  outcome?: 'pass' | 'fail' | 'crit' | 'fumble' | null;
  /** A dice result's numbers, e.g. `14 / ≥11`. */
  score?: string;
  /** Notes are written, not said (a tick note): drawn as paper. */
  note?: boolean;
  /** `loop`: the loop that begins here (a divider, the design notes). */
  loop?: number;
  /** A chat line kept by the chat's summary: the transcript itself is gone (a loop reset forgot it). */
  recap?: boolean;
  /** Came from the server's history (`GET /api/world/stream`): its time is the save's, not this tab's. */
  origin?: 'server';
}

export interface ChalkLike {
  path: string;
  filename?: string;
  body?: string;
  frontmatter?: Record<string, unknown> | null;
}

/** How many entries the tab-session copy keeps (the server holds the rest). */
export const STREAM_CAP = 300;
/** How many entries one save keeps in memory (history pages read by scrolling up included). */
export const STREAM_MEMORY_CAP = 3000;
/** A line the page stamped and the same line from the server are one line when this close in time. */
export const STREAM_MATCH_MS = 10 * 60_000;
/** A live line the server already sent (the history raced it) is that line when this close in time. */
export const STREAM_LIVE_MATCH_MS = 2 * 60_000;
/** One page of history. */
export const STREAM_PAGE = 80;
/** How many times a failed newest page is read again (`retryMs`). */
export const STREAM_RETRIES = 5;
/** A gap this long between two entries draws a time divider. */
export const STREAM_GAP_MS = 5 * 60_000;
/** An entry longer than this (characters or lines) folds to a few lines with 展开 / 收起. */
export const LONG_CHARS = 160;
export const LONG_LINES = 4;

// ── chalk order and which chalks stay on the canvas ──────────────────────────────

/** `NN-slug.md` → NN; anything else (a search chalk `search-<id>.md`) has no ordinal. */
export function chalkOrdinal(path: string): number | null {
  const name = path.split('/').pop() ?? '';
  const m = /^(\d+)-/.exec(name);
  return m ? Number(m[1]) : null;
}

/**
 * Pure: chalks oldest → newest. File ordinal first (`chalk.ts` allocates
 * `NN-` upward); chalks without one were made during play (search / dice
 * chalks), so they sort after the numbered ones, in the server's item order.
 */
export function orderChalks<T extends ChalkLike>(chalks: readonly T[]): T[] {
  return chalks
    .map((chalk, index) => ({ chalk, index, ord: chalkOrdinal(chalk.path) }))
    .sort((a, b) => {
      if (a.ord !== null && b.ord !== null) return a.ord - b.ord || a.index - b.index;
      if (a.ord !== null) return -1;
      if (b.ord !== null) return 1;
      return a.index - b.index;
    })
    .map((x) => x.chalk);
}

/** The default number of newest chalks the canvas keeps. */
export const CANVAS_CHALK_KEEP = 3;
/** Per-browser override, `1`–`6`. */
export const CHALK_KEEP_STORAGE_KEY = 'airp.canvas.chalk-keep';

export function readChalkKeep(storage: Pick<Storage, 'getItem'> | null = safeStorage('local')): number {
  try {
    const raw = Number(storage?.getItem(CHALK_KEEP_STORAGE_KEY));
    return Number.isInteger(raw) && raw >= 1 && raw <= 6 ? raw : CANVAS_CHALK_KEEP;
  } catch {
    return CANVAS_CHALK_KEEP;
  }
}

/**
 * Pure: is this chalk still asking the player for something? A roll not made
 * yet, or an option that is not done (a `repeat` option — 「先不掷骰」 — never
 * counts: it is always on offer and would pin the card forever).
 */
export function chalkIsOpen<O extends { repeat?: boolean }>(
  chalk: ChalkLike,
  optionsOf: (chalk: ChalkLike) => readonly O[],
  isDone: (chalk: ChalkLike, option: O) => boolean,
): boolean {
  const roll = (chalk.frontmatter as { roll_dice?: { result?: unknown } } | null | undefined)?.roll_dice;
  if (roll && typeof roll === 'object' && typeof roll.result !== 'number') return true;
  return optionsOf(chalk).some((option) => !option.repeat && !isDone(chalk, option));
}

/**
 * Pure: which chalks the canvas (and the map) still draws — the newest `keep`
 * plus every chalk still asking for something. Everything else has moved to
 * the drawer: it is not deleted, the stream holds it.
 */
export function canvasChalks(ordered: readonly ChalkLike[], keep: number, isOpen: (chalk: ChalkLike) => boolean): Set<string> {
  const shown = new Set<string>();
  ordered.slice(Math.max(0, ordered.length - keep)).forEach((c) => shown.add(c.path));
  for (const chalk of ordered) if (isOpen(chalk)) shown.add(chalk.path);
  return shown;
}

// ── reading the stream ───────────────────────────────────────────────────────────

export type StreamRow =
  | { type: 'divider'; key: string; layer: string | null; at: number; place: boolean }
  | { type: 'loop'; key: string; loop: number; at: number }
  | { type: 'entry'; key: string; entry: StreamEntry };

/**
 * Pure: the timeline with its dividers — a place divider whenever the layer
 * changes, a time divider after a quiet gap. Entries are sorted by `at`
 * (stable on ties, so a burst keeps its arrival order).
 */
export function streamRows(entries: readonly StreamEntry[], gapMs = STREAM_GAP_MS): StreamRow[] {
  const sorted = entries.map((e, i) => ({ e, i })).sort((a, b) => a.e.at - b.e.at || a.i - b.i).map((x) => x.e);
  const rows: StreamRow[] = [];
  let layer: string | null | undefined;
  let last = -Infinity;
  for (const entry of sorted) {
    if (entry.kind === 'loop') {
      // A loop reset: one line across the timeline; the next entry names its place again.
      rows.push({ type: 'loop', key: `l:${entry.id}`, loop: entry.loop ?? (Number(entry.text) || 0), at: entry.at });
      layer = undefined;
      last = entry.at;
      continue;
    }
    const here = entry.layer ?? layer ?? null;
    const placeChanged = layer === undefined || (entry.layer != null && entry.layer !== layer);
    if (placeChanged || entry.at - last >= gapMs) {
      rows.push({ type: 'divider', key: `d:${entry.id}`, layer: here, at: entry.at, place: placeChanged });
    }
    layer = here;
    last = entry.at;
    rows.push({ type: 'entry', key: entry.id, entry });
  }
  return rows;
}

/** Pure: does this text fold (展开 / 收起)? */
export function isLongText(text: string): boolean {
  return text.length > LONG_CHARS || text.split('\n').length > LONG_LINES;
}

/** Pure: the newest entry, for the drawer's one-line peek (a loop divider is not something said). */
export function latestEntry(entries: readonly StreamEntry[]): StreamEntry | null {
  let best: StreamEntry | null = null;
  for (const e of entries) if (e.kind !== 'loop' && (!best || e.at >= best.at)) best = e;
  return best;
}

/** Pure: one line of text for the peek (first non-empty line, markdown marks dropped). */
export function oneLine(text: string): string {
  const line = text.split('\n').map((l) => l.trim()).find((l) => l !== '') ?? '';
  return line.replace(/[*_`#>]+/g, '').replace(/\s+/g, ' ').trim();
}

/** `HH:MM`, local time. */
export function clockOf(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** `HH:MM` today, `M/D HH:MM` on another day (the history reaches back past today). */
export function stampOf(at: number, now: number = Date.now()): string {
  const d = new Date(at);
  const today = new Date(now);
  const sameDay = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
  return sameDay ? clockOf(at) : `${d.getMonth() + 1}/${d.getDate()} ${clockOf(at)}`;
}

/**
 * Pure: what an entry says, for matching a line the page stamped with the same line from the server. Ids decide
 * for chalks and loop dividers; the rest is kind + speaker + the words (emotion tags, spaces and punctuation
 * dropped — the dock and the session can differ in those), a roll is kind + result + its description.
 */
export function streamFingerprint(entry: Pick<StreamEntry, 'kind' | 'who' | 'name' | 'text' | 'title' | 'score'>): string | null {
  if (entry.kind === 'writer' || entry.kind === 'loop') return null;
  const norm = (text: string) => text.replace(/\[emo:\s*[a-z]+\]/g, '').replace(/[\s\p{P}\p{S}]+/gu, '').slice(0, 40);
  if (entry.kind === 'dice') return `dice|${(entry.score ?? '').split('/')[0].trim()}|${norm(entry.title || entry.text)}`;
  const words = norm(entry.text);
  if (!words) return null;
  return `${entry.kind}|${entry.who ?? entry.name ?? ''}|${words}`;
}

/** What the drawer knows about the history above what it shows. */
export interface StreamHistory {
  /** `idle` before the first page; `loading` while a page is on its way. */
  status: 'idle' | 'loading' | 'ready' | 'error';
  /** Older entries exist on the server. */
  more: boolean;
}

/** The answer of `GET /api/world/stream`. */
export interface StreamPageAnswer {
  ok?: boolean;
  savePath?: string;
  entries?: unknown;
  more?: unknown;
  next?: unknown;
}

const STREAM_KINDS: readonly StreamKind[] = ['writer', 'character', 'you', 'dice', 'event', 'loop'];

/** Pure: one entry of the server's answer, checked field by field (anything unexpected is dropped). */
export function streamEntryOf(raw: unknown): StreamEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Record<string, unknown>;
  if (typeof e.id !== 'string' || typeof e.text !== 'string' || typeof e.at !== 'number' || !Number.isFinite(e.at)) return null;
  if (!STREAM_KINDS.includes(e.kind as StreamKind)) return null;
  const out: StreamEntry = { id: e.id, kind: e.kind as StreamKind, text: e.text, at: e.at, origin: 'server' };
  const str = (v: unknown): v is string => typeof v === 'string' && v !== '';
  if (str(e.who)) out.who = e.who;
  if (str(e.name)) out.name = e.name;
  if (str(e.title)) out.title = e.title;
  if (typeof e.layer === 'string' || e.layer === null) out.layer = e.layer as string | null;
  if (str(e.chalkPath)) out.chalkPath = e.chalkPath;
  if (e.outcome === 'pass' || e.outcome === 'fail' || e.outcome === 'crit' || e.outcome === 'fumble') out.outcome = e.outcome;
  if (str(e.score)) out.score = e.score;
  if (e.note === true) out.note = true;
  if (typeof e.loop === 'number' && Number.isFinite(e.loop)) out.loop = e.loop;
  if (e.recap === true) out.recap = true;
  return out;
}

// ── the store ────────────────────────────────────────────────────────────────────

export interface MessageStream {
  /** Which save the stream belongs to; switching loads that save's session copy. */
  scope(key: string | null): void;
  /** Add an entry, or update the text / title of one with the same id (its time stays). */
  record(entry: Omit<StreamEntry, 'at'> & { at?: number }): void;
  /** Stamp and mirror this layer's chalks (see the file header). */
  observeChalks(layer: string, chalks: readonly ChalkLike[]): void;
  /** Merge one page of the server's history (see the file header). */
  hydrate(entries: readonly StreamEntry[]): void;
  /** Read the newest page of history for the scoped save (again: a reopened save). */
  loadLatest(): Promise<void>;
  /** Read the page above the oldest one read; nothing while one is on its way or there is none. */
  loadOlder(): Promise<void>;
  history(): StreamHistory;
  entries(): readonly StreamEntry[];
  subscribe(fn: () => void): () => void;
}

const STORAGE_PREFIX = 'airp.stream:';

function safeStorage(kind: 'local' | 'session'): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

function chalkTitle(chalk: ChalkLike): string | undefined {
  const title = chalk.frontmatter?.title;
  return typeof title === 'string' && title.trim() ? title.trim() : undefined;
}

export type StreamFetch = (url: string) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

export function createMessageStream(options: {
  now?: () => number;
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  /** The history reader (`GET /api/world/stream`); omitted = `fetch`. */
  fetch?: StreamFetch;
  /**
   * The newest page is read again after this long (× the attempt, up to `STREAM_RETRIES`) when it fails: opening a
   * save races the server switching to it (409, or the previous save's answer). 0 = never.
   */
  retryMs?: number;
} = {}): MessageStream {
  const now = options.now ?? Date.now;
  const storage = options.storage === undefined ? safeStorage('session') : options.storage;
  const fetchPage: StreamFetch = options.fetch ?? ((url) => fetch(url));
  const retryMs = options.retryMs ?? 1500;
  let retries = 0;
  let key: string | null = null;
  let list: StreamEntry[] = [];
  let seenLayers = new Set<string>();
  /** A local id that turned out to be a server entry → that entry's id (the dock re-records its lines). */
  let aliases = new Map<string, string>();
  /** Server entries a line of this tab already matched (one local line per server line). */
  let claimed = new Set<string>();
  let history: StreamHistory = { status: 'idle', more: false };
  /** Where the page above starts: undefined before the first page, null when the top has been read. */
  let cursor: string | null | undefined;
  /** Bumped by `scope`: an answer for an older scope is dropped. */
  let generation = 0;
  const listeners = new Set<() => void>();

  const notify = (): void => { for (const fn of [...listeners]) fn(); };
  const emit = (): void => {
    if (key) {
      const newest = list.length > STREAM_CAP ? [...list].sort((a, b) => a.at - b.at).slice(-STREAM_CAP) : list;
      try { storage?.setItem(STORAGE_PREFIX + key, JSON.stringify({ list: newest, layers: [...seenLayers] })); } catch { /* full / private: memory only */ }
    }
    notify();
  };

  const trim = (): void => {
    if (list.length > STREAM_MEMORY_CAP) list = [...list].sort((a, b) => a.at - b.at).slice(list.length - STREAM_MEMORY_CAP);
  };

  const put = (entry: StreamEntry): boolean => {
    const at = list.findIndex((e) => e.id === entry.id);
    if (at >= 0) {
      const old = list[at];
      if (old.text === entry.text && old.title === entry.title && old.outcome === entry.outcome) return false;
      list = [...list.slice(0, at), { ...old, ...entry, at: old.at, ...(old.origin ? { origin: old.origin } : {}) }, ...list.slice(at + 1)];
      return true;
    }
    list = [...list, entry];
    trim();
    return true;
  };

  /** The nearest entry saying the same thing within `windowMs` — among the server's (`server`) or the tab's own. */
  const sameLine = (entry: StreamEntry, server: boolean, windowMs: number, skip: ReadonlySet<string> = new Set()): number => {
    const fp = streamFingerprint(entry);
    if (!fp) return -1;
    let best = -1;
    let gap = Infinity;
    list.forEach((e, i) => {
      if ((e.origin === 'server') !== server || skip.has(e.id) || streamFingerprint(e) !== fp) return;
      const d = Math.abs(e.at - entry.at);
      if (d <= windowMs && d < gap) { best = i; gap = d; }
    });
    return best;
  };

  const merge = (page: readonly StreamEntry[]): boolean => {
    let changed = false;
    for (const raw of page) {
      const entry: StreamEntry = { ...raw, origin: 'server' };
      const same = list.findIndex((e) => e.id === entry.id);
      if (same >= 0) {
        const old = list[same];
        if (old.origin !== 'server' || old.at !== entry.at || old.text !== entry.text || old.title !== entry.title) {
          // The server knows when it happened (a chalk this tab first saw on reload) and what it says now.
          list = [...list.slice(0, same), { ...old, ...entry }, ...list.slice(same + 1)];
          changed = true;
        }
        continue;
      }
      const local = sameLine(entry, false, STREAM_MATCH_MS);
      if (local >= 0) {
        aliases.set(list[local].id, entry.id);
        claimed.add(entry.id);
        list = [...list.slice(0, local), entry, ...list.slice(local + 1)];
      } else {
        list = [...list, entry];
      }
      changed = true;
    }
    trim();
    return changed;
  };

  const load = async (before: string | null): Promise<void> => {
    if (!key || history.status === 'loading') return;
    const mine = generation;
    const scopeKey = key;
    history = { ...history, status: 'loading' };
    notify();
    let answer: StreamPageAnswer | null = null;
    try {
      const q = new URLSearchParams({ limit: String(STREAM_PAGE) });
      if (before) q.set('before', before);
      const res = await fetchPage(`/api/world/stream?${q.toString()}`);
      answer = res.ok ? ((await res.json()) as StreamPageAnswer) : null;
    } catch {
      answer = null;
    }
    if (mine !== generation) return; // the page switched saves meanwhile
    // The scope is a save path and the server read another save: the active world moved under us.
    const foreign = typeof answer?.savePath === 'string' && scopeKey.includes('/') && answer.savePath !== scopeKey;
    if (!answer?.ok || !Array.isArray(answer.entries) || foreign) {
      history = { ...history, status: 'error' };
      notify();
      if (before === null && retryMs > 0 && retries < STREAM_RETRIES) {
        retries += 1;
        setTimeout(() => { if (mine === generation) void load(null); }, retryMs * retries);
      }
      return;
    }
    if (before === null) retries = 0;
    const page = answer.entries.map(streamEntryOf).filter((e): e is StreamEntry => e !== null);
    const changed = merge(page);
    const more = answer.more === true && typeof answer.next === 'string';
    // Reading the newest page again (a reopened save) keeps how far scrolling up got, unless nothing was read yet.
    if (before !== null || cursor === undefined) cursor = more ? (answer.next as string) : null;
    history = { status: 'ready', more: typeof cursor === 'string' };
    if (changed) emit();
    else notify();
  };

  return {
    scope(next) {
      if (next === key) return;
      key = next;
      generation += 1;
      list = [];
      seenLayers = new Set();
      aliases = new Map();
      claimed = new Set();
      history = { status: 'idle', more: false };
      cursor = undefined;
      retries = 0;
      if (next) {
        try {
          const raw = storage?.getItem(STORAGE_PREFIX + next);
          const parsed = raw ? JSON.parse(raw) : null;
          if (parsed && Array.isArray(parsed.list)) list = parsed.list.filter((e: unknown) => e && typeof (e as StreamEntry).id === 'string');
          if (parsed && Array.isArray(parsed.layers)) seenLayers = new Set(parsed.layers.filter((l: unknown) => typeof l === 'string'));
        } catch { /* a broken copy starts empty */ }
      }
      for (const fn of [...listeners]) fn();
    },
    record(entry) {
      const text = entry.text.trim();
      if (!text) return;
      const alias = aliases.get(entry.id);
      if (alias && list.some((e) => e.id === alias)) return; // already the server's line
      const live: StreamEntry = { ...entry, text, at: entry.at ?? now() };
      if (!list.some((e) => e.id === live.id)) {
        // The history may already hold this very line (it was read while the line was arriving).
        const server = sameLine(live, true, STREAM_LIVE_MATCH_MS, claimed);
        if (server >= 0) {
          aliases.set(live.id, list[server].id);
          claimed.add(list[server].id);
          return;
        }
      }
      if (put(live)) emit();
    },
    observeChalks(layer, chalks) {
      const ordered = orderChalks(chalks);
      const first = !seenLayers.has(layer);
      seenLayers.add(layer);
      const t = now();
      let changed = first;
      ordered.forEach((chalk, index) => {
        const id = `chalk:${chalk.path}`;
        const known = list.some((e) => e.id === id);
        const at = known ? 0 : first ? t - (ordered.length - index) : t + index;
        const text = (chalk.body ?? '').replace(/<!--[\s\S]*?-->/g, '').trim() || chalkTitle(chalk) || '';
        if (!text) return;
        if (put({ id, kind: 'writer', text, title: chalkTitle(chalk), layer, chalkPath: chalk.path, at })) changed = true;
      });
      if (changed) emit();
    },
    hydrate(page) {
      if (merge(page)) emit();
    },
    loadLatest: () => load(null),
    loadOlder: () => (history.more && cursor ? load(cursor) : Promise.resolve()),
    history: () => history,
    entries: () => list,
    subscribe(fn) {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
  };
}

/** The page's one stream (App scopes it to the open save). */
export const messageStream: MessageStream = createMessageStream();

export function useMessageStream(stream: MessageStream = messageStream): readonly StreamEntry[] {
  return useSyncExternalStore(stream.subscribe, stream.entries, stream.entries);
}

/** The history's state (a page loading, more above) for the drawer. */
export function useStreamHistory(stream: MessageStream = messageStream): StreamHistory {
  return useSyncExternalStore(stream.subscribe, stream.history, stream.history);
}

/** How long a retiring chalk keeps fading on the canvas before it leaves. */
export const RETIRE_MS = 700;

/**
 * The chalks that just left `shown` on this page: kept on the canvas (faded,
 * `data-chalk-retiring`) for `RETIRE_MS`, so a chalk going into the drawer is
 * seen going. A page change (`scope`) never fades anything — the old page's
 * chalks are simply not here.
 */
export function useRetiringChalks(shown: ReadonlySet<string>, scope: string): ReadonlySet<string> {
  const [retiring, setRetiring] = useState<ReadonlySet<string>>(() => new Set());
  const prev = useRef<{ scope: string; shown: ReadonlySet<string> }>({ scope, shown });
  const timers = useRef<Set<number>>(new Set());
  const key = [...shown].sort().join('\u0000');
  useEffect(() => {
    const before = prev.current;
    prev.current = { scope, shown };
    if (before.scope !== scope) { setRetiring(new Set()); return; }
    const gone = [...before.shown].filter((path) => !shown.has(path));
    if (gone.length === 0) return;
    setRetiring((current) => new Set([...current, ...gone]));
    const timer = window.setTimeout(() => {
      timers.current.delete(timer);
      setRetiring((current) => new Set([...current].filter((path) => !gone.includes(path))));
    }, RETIRE_MS);
    timers.current.add(timer);
  }, [key, scope]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { for (const timer of timers.current) window.clearTimeout(timer); }, []);
  // The render where a chalk leaves `shown` comes before the effect above: count it as retiring already, so the
  // card is never unmounted and remounted between the two (the fade would not play).
  const before = prev.current;
  if (before.scope !== scope) return retiring;
  const leaving = [...before.shown].filter((path) => !shown.has(path));
  return leaving.length === 0 ? retiring : new Set([...retiring, ...leaving]);
}

// ── the dock's conversation ──────────────────────────────────────────────────────

/**
 * Pure: what the dialogue stage still shows — the latest
 * exchange: the player's last line and what came after it, at most `max`
 * lines; with no player line yet, the newest line alone.
 */
export function latestExchange<L extends { who: 'player' | 'character' }>(lines: readonly L[], max = 3): L[] {
  if (lines.length === 0) return [];
  let start = -1;
  for (let i = lines.length - 1; i >= 0; i -= 1) if (lines[i].who === 'player') { start = i; break; }
  const from = start < 0 ? lines.length - 1 : start;
  return lines.slice(Math.max(from, lines.length - max));
}

/** One settled dock line into the stream: the character's words, or the player's words to them. */
export function recordDockLine(characterId: string, line: { id: number; who: 'player' | 'character'; text: string }, stream: MessageStream = messageStream): void {
  const text = line.text.trim();
  if (!text) return;
  stream.record({
    id: `dock:${characterId}:${line.id}:${text.slice(0, 24)}`,
    kind: line.who === 'player' ? 'you' : 'character',
    who: characterId,
    text,
  });
}
