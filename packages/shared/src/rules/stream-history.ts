/**
 * The message drawer's history: everything said in a run, rebuilt from what the save already
 * keeps, so the drawer survives a reload and a reopened save.
 *
 * Nothing new is stored for it. Each source is a projection of something the engine already writes:
 *
 *   - the event log (`.airpworld/history.db` `events`): chalks the writer / a character made
 *     (`entity_created` kind chalk), rolls (`roll_resolved`), the player's choices (`choice_selected`), story
 *     events, CG captions, endings, loop resets (a divider), and — for a chat whose transcript is gone (a loop
 *     reset forgets every character's conversation) — the lines `character_talked.detail.summary` kept verbatim;
 *   - the chalk files themselves (their current text; chalks a template seated on a page are stamped when the
 *     player first entered that page this loop);
 *   - each character's own session (`sessions/char-<id>.jsonl`): what the player said and what they answered —
 *     never their thinking or their tools;
 *   - the writer's sessions: ONLY what the player asked (`[Player Request]`) — never the writer's replies,
 *     thinking or tools (the player sees the writer through chalks); a beat the writer's fast path answered never
 *     reaches a session, so its request comes from the fast-path log (`.airpworld/fast-path.log`) instead;
 *   - NPC cards' recorded `dialogue:`;
 *   - what people said, wrote or did on their own turn (character tick): the `story_event` each beat records
 *     (`detail.tick`, with the person's words as `claim`) — and, for words said WITH an intent (no event quotes
 *     them), the tick log (`world/README.md` frontmatter `tick.log`), only entries stamped with a time.
 *
 * The ids are the page's own (lib/message-stream.ts): a chalk is `chalk:<path>`, a tick line `tick:<key>:say`, an
 * NPC line `npc:<path>:<index>:<text>`, a story event `event:<event id>`, so a line the page already holds is the
 * same line, not a second one. Lines the page stamps locally (the dock, a roll's ceremony, the writer box) are
 * matched by what they say (the page's `streamFingerprint`).
 *
 * Pure and browser-safe: the server gathers the inputs (apps/server/src/engine/stream-history.ts), the page maps
 * a live world event with the same `streamItemsOfEvent`.
 */
import { parseCharacterSession } from './chat-transcript.js';
import { npcDialogueOf } from './npc.js';

export type StreamItemKind = 'writer' | 'character' | 'you' | 'dice' | 'event' | 'loop';

/** One entry of the drawer's timeline — the page's `StreamEntry`, as the server sends it. */
export interface StreamItem {
  id: string;
  kind: StreamItemKind;
  text: string;
  /** Epoch ms. */
  at: number;
  /** A character id (`character`), or whom the player spoke to (`you`: `writer` or a character id). */
  who?: string;
  /** Display name when the speaker is not a registered character (an NPC card, an event's subject). */
  name?: string;
  title?: string;
  /** Layer id it happened on (place dividers). */
  layer?: string | null;
  /** The chalk / card it belongs to (a writer chalk, the card a roll or a choice was made on). */
  chalkPath?: string;
  outcome?: 'pass' | 'fail' | 'crit' | 'fumble' | null;
  score?: string;
  /** Written, not said (a character's note on their turn). */
  note?: boolean;
  /** `loop`: the loop that begins here. */
  loop?: number;
  /** A line kept by a chat's summary: its transcript is gone (a loop reset forgot it). */
  recap?: boolean;
}

export interface StreamPage {
  /** Oldest first. */
  entries: StreamItem[];
  /** Older entries exist: pass `next` as `before` to read them. */
  more: boolean;
  next: string | null;
}

export const STREAM_PAGE_DEFAULT = 80;
export const STREAM_PAGE_MAX = 200;

/** The page's own text cut for an NPC line id (components/sidebar/NpcDialogue.tsx). */
const ID_TEXT = 24;
/** Where an item-action prompt's instructions begin (apps/web/src/lib/item-action-draft.ts). */
const ITEM_PROMPT_TAIL = '\n\nRead each referenced item';

type Detail = Record<string, unknown>;

/** The fields of a world event this module reads (the store's `WorldEvent`, or the page's copy of one). */
export interface StreamEventLike {
  seq?: number;
  id: string;
  type: string;
  actor?: { type?: string; id?: string } | null;
  layer?: string | null;
  subject?: string | null;
  detail?: Detail | null;
  createdAt?: string;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function timeOf(iso: unknown): number | null {
  if (typeof iso !== 'string') return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/** Paths the player may be pointed at: the world's pages and the bag; never the writer's or a character's own. */
export function playerSeesPath(path: unknown): path is string {
  if (typeof path !== 'string' || path === '' || path.includes('..')) return false;
  return path.startsWith('world/') || path.startsWith('player/');
}

/** Chalk text as the canvas shows it: authoring comments dropped. */
export function chalkStreamText(body: string): string {
  return body.replace(/<!--[\s\S]*?-->/g, '').trim();
}

function rollOutcome(d: Detail): StreamItem['outcome'] {
  const tier = d.outcome;
  if (tier === 'crit_success' || d.crit === true) return 'crit';
  if (tier === 'crit_fail' || d.fumble === true) return 'fumble';
  if (tier === 'success') return 'pass';
  if (tier === 'fail') return 'fail';
  return d.passed === true ? 'pass' : d.passed === false ? 'fail' : null;
}

/**
 * Pure: one world event → what the drawer shows for it. Chalks are not here (their text is a file, read by the
 * caller, `streamChalksOfEvents`); a chat's recap is not here (it depends on the transcript). Used by the server for
 * the history and by the page for a live event, so both name the entry alike.
 */
export function streamItemsOfEvent(ev: StreamEventLike): StreamItem[] {
  const at = timeOf(ev.createdAt);
  if (at === null || typeof ev.id !== 'string') return [];
  const d = (ev.detail ?? {}) as Detail;
  const layer = typeof ev.layer === 'string' ? ev.layer : null;
  switch (ev.type) {
    case 'roll_resolved': {
      const title = str(d.desc) || str(d.name);
      const result = typeof d.result === 'number' ? d.result : null;
      if (result === null) return [];
      const expect = str(d.expect);
      return [{
        id: `dice:${ev.id}`,
        kind: 'dice',
        text: title || str(d.dice) || String(result),
        ...(title ? { title } : {}),
        score: expect ? `${result} / ${expect}` : String(result),
        outcome: rollOutcome(d),
        at,
        layer,
        ...(playerSeesPath(d.path) ? { chalkPath: d.path } : {}),
      }];
    }
    case 'choice_selected': {
      // The player's own choice. A writer resolving a request with a choice is the writer's move, said in its chalk.
      if (ev.actor?.type !== 'player') return [];
      const choice = str(d.choice);
      if (!choice) return [];
      return [{ id: `choice:${ev.id}`, kind: 'you', who: 'writer', text: choice, at, layer, ...(playerSeesPath(d.path) ? { chalkPath: d.path } : {}) }];
    }
    case 'story_event': {
      // A hint is the companion's nudge, not a story line.
      if (typeof d.hint === 'string') return [];
      const tick = d.tick as { actor?: unknown; result?: unknown; claim?: { say?: unknown; invite?: unknown; note?: unknown } } | undefined;
      if (tick && typeof tick === 'object' && tick.result === 'said') {
        // A person's own beat (character tick v2): their words, as theirs — not an event card.
        const words = str(tick.claim?.say) || str(tick.claim?.invite) || str(tick.claim?.note);
        const who = str(tick.actor);
        if (!words || !who) return [];
        const name = str(d.title);
        const note = !str(tick.claim?.say) && !str(tick.claim?.invite);
        return [{ id: `event:${ev.id}`, kind: 'character', who, text: words, at, layer, ...(name ? { name } : {}), ...(note ? { note: true } : {}) }];
      }
      const text = str(d.text);
      if (!text) return [];
      const name = str(d.name);
      const title = str(d.title);
      return [{ id: `event:${ev.id}`, kind: 'event', text, at, layer, ...(name ? { name } : {}), ...(title ? { title } : {}), ...(playerSeesPath(d.target) ? { chalkPath: d.target } : {}) }];
    }
    case 'cg_shown': {
      const caption = str(d.caption);
      return caption ? [{ id: `cg:${ev.id}`, kind: 'event', text: caption, at, layer }] : [];
    }
    case 'ending_reached': {
      const title = str(d.title) || str(d.ending);
      return title ? [{ id: `ending:${ev.id}`, kind: 'event', text: title, title, at, layer }] : [];
    }
    case 'loop_reset': {
      const loop = typeof d.loop === 'number' && Number.isFinite(d.loop) ? d.loop : null;
      return loop === null ? [] : [{ id: `loop:${ev.id}`, kind: 'loop', text: String(loop), loop, at, layer: null }];
    }
    default:
      return [];
  }
}

/** A chalk file as it is now (null: gone, or no longer a chalk). */
export interface StreamChalkNow {
  text: string;
  title?: string;
}

/**
 * Pure: the chalks the event log says were made, oldest first. The newest making of a path that still stands —
 * no loop reset or delete after it, and the file is still a chalk — is `chalk:<path>` with the file's text (the
 * page's id: a chalk that grows updates in place). Every other making (an earlier loop's, a deleted one, a path
 * reused) is history: `chalk:<path>#<seq>` with the line the event kept.
 */
export function streamChalksOfEvents(events: readonly StreamEventLike[], now: (path: string) => StreamChalkNow | null): StreamItem[] {
  const made: Array<{ ev: StreamEventLike; at: number; path: string; index: number }> = [];
  const lastMade = new Map<string, number>();
  const endedAfter = new Map<string, number>(); // path → index of a delete after its last making
  let lastLoop = -1;
  events.forEach((ev, index) => {
    if (ev.type === 'loop_reset') { lastLoop = index; return; }
    const d = (ev.detail ?? {}) as Detail;
    if (ev.type === 'entity_deleted' && typeof d.path === 'string') { endedAfter.set(d.path, index); return; }
    if (ev.type !== 'entity_created' || d.kind !== 'chalk' || typeof d.path !== 'string') return;
    if (!d.path.startsWith('world/')) return; // a character's own page is theirs
    const at = timeOf(ev.createdAt);
    if (at === null) return;
    made.push({ ev, at, path: d.path, index });
    lastMade.set(d.path, index);
  });
  const out: StreamItem[] = [];
  for (const m of made) {
    const d = (m.ev.detail ?? {}) as Detail;
    const layer = typeof m.ev.layer === 'string' ? m.ev.layer : null;
    const standing = lastMade.get(m.path) === m.index && m.index > lastLoop && !((endedAfter.get(m.path) ?? -1) > m.index);
    const file = standing ? now(m.path) : null;
    if (file) {
      if (!file.text) continue;
      out.push({ id: `chalk:${m.path}`, kind: 'writer', text: file.text, ...(file.title ? { title: file.title } : {}), at: m.at, layer, chalkPath: m.path });
      continue;
    }
    const summary = str(d.summary);
    const name = str(d.name);
    const text = summary || name;
    if (!text) continue;
    const title = summary && name && !summary.startsWith(name) ? name : undefined;
    out.push({ id: `chalk:${m.path}#${m.ev.seq ?? m.ev.id}`, kind: 'writer', text, ...(title ? { title } : {}), at: m.at, layer });
  }
  return out;
}

/** `NN-slug.md` → NN (lib/message-stream.ts `chalkOrdinal`). */
function ordinalOf(path: string): number | null {
  const m = /^(\d+)-/.exec(path.split('/').pop() ?? '');
  return m ? Number(m[1]) : null;
}

/**
 * Pure: chalks that were on a page before anyone wrote this loop (a template's opening), stamped just after the
 * player first entered that page this loop, in file order. `made` = paths the event log already accounts for.
 */
export function streamSeatedChalks(
  visits: readonly { layer: string; at: number; chalks: ReadonlyArray<{ path: string } & StreamChalkNow> }[],
  made: ReadonlySet<string>,
): StreamItem[] {
  const out: StreamItem[] = [];
  for (const visit of visits) {
    const ordered = visit.chalks
      .filter((c) => !made.has(c.path) && c.text)
      .map((c, index) => ({ c, index, ord: ordinalOf(c.path) }))
      .sort((a, b) => (a.ord !== null && b.ord !== null ? a.ord - b.ord || a.index - b.index : a.ord !== null ? -1 : b.ord !== null ? 1 : a.index - b.index))
      .map((x) => x.c);
    ordered.forEach((c, i) => {
      out.push({ id: `chalk:${c.path}`, kind: 'writer', text: c.text, ...(c.title ? { title: c.title } : {}), at: visit.at + i + 1, layer: visit.layer, chalkPath: c.path });
    });
  }
  return out;
}

/**
 * Pure: one character's conversation, from their session file — the player's lines and what they answered (a
 * reply to a scene cue is their greeting; the cue itself is the engine's, never shown). Also the branch's entry
 * ids, so a `character_talked` whose `through` is not among them is known to be a chat this file no longer holds.
 */
export function streamItemsOfCharacterSession(characterId: string, jsonl: string): { items: StreamItem[]; entryIds: Set<string> } {
  const parsed = parseCharacterSession(jsonl);
  const items: StreamItem[] = [];
  for (const ex of parsed.exchanges) {
    // Keyed on the turn's opening entry: the reply's last entry moves while a turn is still being written.
    const turn = ex.userId ?? ex.entryId;
    const asked = timeOf(ex.at);
    if (ex.player && asked !== null) {
      items.push({ id: `chat:${characterId}:${turn}`, kind: 'you', who: characterId, text: ex.player, at: asked });
    }
    const answered = timeOf(ex.replyAt) ?? (asked !== null ? asked + 1 : null);
    if (ex.reply && answered !== null) {
      items.push({ id: `chat:${characterId}:${turn}:reply`, kind: 'character', who: characterId, text: ex.reply, at: answered });
    }
  }
  return { items, entryIds: new Set(parsed.entryIds) };
}

/**
 * Pure: a chat the transcript no longer holds (a loop reset forgot it) → the lines its summary kept verbatim, one
 * entry. Nothing when the chat is still in the file, or the summary kept no line (its prose is the writer's).
 */
export function streamRecapOfTalk(ev: StreamEventLike, transcriptHas: (characterId: string, entryId: string) => boolean): StreamItem[] {
  if (ev.type !== 'character_talked') return [];
  const d = (ev.detail ?? {}) as Detail;
  const character = str(d.character);
  const at = timeOf(ev.createdAt);
  if (!character || at === null) return [];
  const through = str(d.through);
  if (through && transcriptHas(character, through)) return [];
  const summary = d.summary as { notable_quotes?: unknown } | undefined;
  const quotes = Array.isArray(summary?.notable_quotes) ? summary.notable_quotes.map(str).filter(Boolean) : [];
  if (quotes.length === 0) return [];
  const name = str(d.name);
  return [{ id: `talk:${ev.id}`, kind: 'character', who: character, ...(name ? { name } : {}), text: quotes.join('\n'), at, recap: true }];
}

interface SessionLine {
  type?: unknown;
  id?: unknown;
  timestamp?: unknown;
  message?: { role?: unknown; content?: unknown };
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b): b is { type: string; text?: unknown } => !!b && typeof b === 'object' && (b as { type?: unknown }).type === 'text')
    .map((b) => (typeof b.text === 'string' ? b.text : ''))
    .join('');
}

const REQUEST_RE = /\[(?:Player|Author) Request\] ([\s\S]*)$/;
const LAYER_RE = /^\[Current Layer\] (\S+)$/m;

/** A writer beat's text → what the player asked in it (null: not the player speaking to the writer). */
function askOfBeat(raw: string): { text: string; layer: string | null } | null {
  const m = REQUEST_RE.exec(raw);
  if (!m) return null;
  const tail = m[1].indexOf(ITEM_PROMPT_TAIL);
  const text = (tail >= 0 ? m[1].slice(0, tail) : m[1]).trim();
  if (!text) return null;
  return { text, layer: LAYER_RE.exec(raw)?.[1] ?? null };
}

/**
 * Pure: what the player asked the writer, from one writer session file. Only `[Player Request]` turns (and the
 * author's own `[Author Request]` in a workshop world); the writer's answers, thinking and tools never leave, and
 * engine turns (`[Player Event]`, `[Quiet Beat]`, an NPC brief) are not the player speaking.
 */
export function streamItemsOfWriterSession(jsonl: string): StreamItem[] {
  const items: StreamItem[] = [];
  for (const line of jsonl.split('\n')) {
    if (!line.includes('Request]')) continue;
    let entry: SessionLine;
    try { entry = JSON.parse(line) as SessionLine; } catch { continue; }
    if (entry?.type !== 'message' || entry.message?.role !== 'user' || typeof entry.id !== 'string') continue;
    const at = timeOf(entry.timestamp);
    if (at === null) continue;
    const ask = askOfBeat(textOf(entry.message.content));
    if (!ask) continue;
    items.push({ id: `ask:${entry.id}`, kind: 'you', who: 'writer', text: ask.text, at, layer: ask.layer });
  }
  return items;
}

/** The record the fast-path log keeps of a beat the fast path answered (apps/server engine/writer-fast-path.ts). */
export interface FastPathAskRecord {
  /** Unique per beat (the beat's chalk `toolCallId`); the drawer's id is `ask:<id>`. */
  id: string;
  /** When the beat reached the writer (ISO). */
  at: string;
  /** The beat text, as the agent would have been prompted with it. */
  message: string;
}

/**
 * Pure: what the player asked the writer on beats the fast path answered, from
 * the fast-path log (`.airpworld/fast-path.log`). Such a beat never reaches the writer's session, so its request
 * is only here: a line `mode: on`, `route: fast` carries `request` (`FastPathAskRecord`). A beat handed to the
 * agent carries none (the agent's session holds that request), and neither does a shadow run (the agent answered
 * it) — so each request is read from exactly one place. Same parse as the writer's session.
 */
export function streamItemsOfFastPathLog(jsonl: string): StreamItem[] {
  const items: StreamItem[] = [];
  for (const line of jsonl.split('\n')) {
    if (!line.includes('"request"')) continue;
    let rec: { mode?: unknown; route?: unknown; request?: Partial<Record<keyof FastPathAskRecord, unknown>> | null };
    try { rec = JSON.parse(line); } catch { continue; }
    if (rec?.mode !== 'on' || rec.route !== 'fast' || !rec.request || typeof rec.request !== 'object') continue;
    const { id, message } = rec.request;
    const at = timeOf(rec.request.at);
    if (typeof id !== 'string' || !id || typeof message !== 'string' || at === null) continue;
    const ask = askOfBeat(message);
    if (!ask) continue;
    items.push({ id: `ask:${id}`, kind: 'you', who: 'writer', text: ask.text, at, layer: ask.layer });
  }
  return items;
}

/** Pure: an NPC card's recorded exchange (rows without a time cannot be placed and are left out). */
export function streamItemsOfNpcCard(path: string, frontmatter: Record<string, unknown> | null | undefined, layer: string | null): StreamItem[] {
  if (!frontmatter || frontmatter.type !== 'npc' || !path.startsWith('world/')) return [];
  const name = str(frontmatter.name) || (path.split('/').pop() ?? path).replace(/\.md$/, '');
  const items: StreamItem[] = [];
  npcDialogueOf(frontmatter).forEach((row, index) => {
    const text = row.text.trim();
    const at = timeOf(row.at);
    if (!text || at === null) return;
    items.push({ id: `npc:${path}:${index}:${text.slice(0, ID_TEXT)}`, kind: row.by === 'player' ? 'you' : 'character', name, text, at, layer });
  });
  return items;
}

/** One tick log entry as the drawer needs it (rules/tick.ts `TickLogEntry`). */
export interface StreamTickEntry {
  key: string;
  at?: string;
  actor: string;
  name: string;
  page: string;
  words?: { say?: string; invite?: string; note?: { title: string; body: string } };
  /** A chatter beat (`said`): its words are in its `story_event`, not here. */
  chatter: boolean;
}

/**
 * Pure: the words a person said WITH an intent (a move that landed or was stopped) — the one thing of a beat no
 * event quotes. A chatter beat and every move's outcome come from their `story_event` (`streamItemsOfEvent`).
 * The page records the same from the tick view (App.tsx), under the same ids.
 */
export function streamItemsOfTick(entries: readonly StreamTickEntry[]): StreamItem[] {
  const items: StreamItem[] = [];
  for (const e of entries) {
    const at = timeOf(e.at);
    if (at === null || e.chatter) continue;
    const base = { who: e.actor, name: e.name, layer: e.page, at };
    if (e.words?.say) items.push({ id: `tick:${e.key}:say`, kind: 'character', text: e.words.say, ...base });
    if (e.words?.invite) items.push({ id: `tick:${e.key}:invite`, kind: 'character', text: e.words.invite, ...base });
    if (e.words?.note) items.push({ id: `tick:${e.key}:note`, kind: 'character', title: e.words.note.title, text: e.words.note.body, note: true, ...base });
  }
  return items;
}

/** Timeline order: time, then id (stable across requests, so a page boundary never repeats or skips). */
export function compareStreamItems(a: Pick<StreamItem, 'at' | 'id'>, b: Pick<StreamItem, 'at' | 'id'>): number {
  return a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function streamCursorOf(item: Pick<StreamItem, 'at' | 'id'>): string {
  return `${item.at}:${item.id}`;
}

export function parseStreamCursor(raw: unknown): { at: number; id: string } | null {
  if (typeof raw !== 'string' || raw.length > 2000) return null;
  const cut = raw.indexOf(':');
  if (cut <= 0) return null;
  const at = Number(raw.slice(0, cut));
  return Number.isFinite(at) ? { at, id: raw.slice(cut + 1) } : null;
}

/**
 * Pure: merge every source (an id seen twice keeps the first), order it, and cut one page — the newest `limit`
 * entries strictly before `before` (or the newest of all), oldest first.
 */
export function pageStreamItems(sources: ReadonlyArray<readonly StreamItem[]>, opts: { before?: string | null; limit?: number } = {}): StreamPage {
  const byId = new Map<string, StreamItem>();
  for (const list of sources) for (const item of list) if (item.text.trim() && !byId.has(item.id)) byId.set(item.id, item);
  const all = [...byId.values()].sort(compareStreamItems);
  const before = parseStreamCursor(opts.before);
  const end = before ? all.findIndex((item) => compareStreamItems(item, before) >= 0) : -1;
  const upto = end < 0 ? all.length : end;
  const limit = Math.max(1, Math.min(STREAM_PAGE_MAX, Math.floor(opts.limit ?? STREAM_PAGE_DEFAULT) || STREAM_PAGE_DEFAULT));
  const from = Math.max(0, upto - limit);
  const entries = all.slice(from, upto);
  const more = from > 0;
  return { entries, more, next: more && entries.length ? streamCursorOf(entries[0]) : null };
}
