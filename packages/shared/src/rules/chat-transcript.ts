/**
 * A character's private conversation, as the writer may learn it
 *.
 *
 * Every character keeps its own pi-rp session (`.airpworld/sessions/char-<id>.jsonl`)
 * and no other character ever reads it. The writer learns what happened in two
 * ways: a short structured summary carried by the `character_talked` event when
 * a chat ends, and — on demand — the transcript itself through the writer-only
 * `read_conversation` tool. Both are built from the pure helpers here.
 *
 * Zero I/O and no node builtins: the server (summaries), the agent-process
 * extension (the tool) and the tests all import this file.
 */

/** One exchange: what the player said and what the character answered. */
export interface ChatExchange {
  /** The player's line; '' when the turn was opened by a scene cue. */
  player: string;
  /** The character's spoken reply (emotion tags and thinking stripped). */
  reply: string;
  /** True when the user turn was an engine scene cue, not the player speaking. */
  cue: boolean;
  /** ISO time of the user turn, when the session recorded one. */
  at?: string;
  /** Id of the last session entry this exchange covers. */
  entryId: string;
  /** Id of the user entry that opened it (absent when the slice began mid-turn). */
  userId?: string;
  /** ISO time of the last assistant entry that said something (the message drawer stamps the reply with it). */
  replyAt?: string;
}

export interface CharacterTranscript {
  exchanges: ChatExchange[];
  /** Id of the newest entry on the session's current branch (the next watermark). */
  lastEntryId: string | null;
  /** False when `after` was given but is no longer on the branch (the session was reset or rewound). */
  resumed: boolean;
  /** Every entry id on the current branch, oldest first (a `character_talked.detail.through` is one of them). */
  entryIds: string[];
}

/**
 * The engine's own cues to a character ("Scene note, not something the player
 * said…", apps/web/src/lib/opening.ts) in the four world languages. They open a
 * turn, but they are not the player talking, so they never count as an exchange.
 */
const SCENE_CUE_RE = /^\s*[(（]\s*(Scene note|场景提示|場面の指示|장면 지시)/;

export function isSceneCue(text: string): boolean {
  return SCENE_CUE_RE.test(text);
}

const EMO_TAG_RE = /\[emo:\s*[a-z]+\]\s*/g;

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b): b is { type: string; text?: unknown } => !!b && typeof b === 'object' && (b as { type?: unknown }).type === 'text')
    .map((b) => (typeof b.text === 'string' ? b.text : ''))
    .join('');
}

interface SessionEntry {
  type?: unknown;
  id?: unknown;
  parentId?: unknown;
  timestamp?: unknown;
  message?: { role?: unknown; content?: unknown };
  customType?: unknown;
  details?: unknown;
}

/**
 * A line said over a voice call that the call's fast brain answered, not the
 * agent (apps/server/src/engine/voice-fast-brain.ts): recorded into the
 * character's own session as one pi-rp `custom_message` (it reaches the agent's
 * context as a user-role note) carrying `details: { player, reply }`, so it
 * counts as an exchange here exactly like a line typed in the dialogue.
 */
export const VOICE_CALL_CUSTOM_TYPE = 'voice-call';

function voiceCallLines(entry: SessionEntry): { player: string; reply: string } | null {
  if (entry.type !== 'custom_message' || entry.customType !== VOICE_CALL_CUSTOM_TYPE) return null;
  const details = entry.details as { player?: unknown; reply?: unknown } | null | undefined;
  const player = typeof details?.player === 'string' ? details.player.trim() : '';
  const reply = typeof details?.reply === 'string' ? details.reply.replace(EMO_TAG_RE, '').trim() : '';
  return player || reply ? { player, reply } : null;
}

/**
 * Parse a pi-rp session file into exchanges. Only the CURRENT branch counts
 * (leaf = the last entry written, walked up through `parentId`), so an
 * abandoned branch never reads as something that was said. With `after`, only
 * the entries after that id on the branch; an `after` no longer on the branch
 * yields the whole branch and `resumed: false`.
 *
 * Pure and total: a malformed line is skipped, never thrown.
 */
export function parseCharacterSession(jsonl: string, opts: { after?: string | null } = {}): CharacterTranscript {
  const byId = new Map<string, SessionEntry>();
  let leaf: string | null = null;
  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue;
    let entry: SessionEntry;
    try {
      entry = JSON.parse(line) as SessionEntry;
    } catch {
      continue;
    }
    if (!entry || typeof entry.id !== 'string' || entry.type === 'session') continue;
    byId.set(entry.id, entry);
    leaf = entry.id;
  }
  const branch: Array<SessionEntry & { id: string }> = [];
  const seen = new Set<string>();
  for (let id: string | null = leaf; id !== null && byId.has(id) && !seen.has(id); ) {
    seen.add(id);
    const entry = byId.get(id) as SessionEntry & { id: string };
    branch.push(entry);
    id = typeof entry.parentId === 'string' ? entry.parentId : null;
  }
  branch.reverse();

  let start = 0;
  let resumed = true;
  if (opts.after) {
    const at = branch.findIndex((e) => e.id === opts.after);
    if (at === -1) resumed = false;
    else start = at + 1;
  }

  const exchanges: ChatExchange[] = [];
  let current: ChatExchange | null = null;
  for (const entry of branch.slice(start)) {
    const voice = voiceCallLines(entry);
    if (voice) {
      current = {
        player: voice.player,
        reply: voice.reply,
        cue: false,
        ...(typeof entry.timestamp === 'string' ? { at: entry.timestamp, replyAt: entry.timestamp } : {}),
        entryId: entry.id,
        userId: entry.id,
      };
      exchanges.push(current);
      current = null;
      continue;
    }
    if (entry.type !== 'message' || !entry.message) continue;
    const role = entry.message.role;
    if (role === 'user') {
      const text = textOf(entry.message.content).trim();
      const cue = isSceneCue(text);
      current = {
        player: cue ? '' : text,
        reply: '',
        cue,
        ...(typeof entry.timestamp === 'string' ? { at: entry.timestamp } : {}),
        entryId: entry.id,
        userId: entry.id,
      };
      exchanges.push(current);
    } else if (role === 'assistant') {
      const said = textOf(entry.message.content).replace(EMO_TAG_RE, '').trim();
      if (!current) {
        // A reply with no turn before it on this slice (the watermark sat
        // between a user line and its answer): keep the words.
        current = { player: '', reply: '', cue: true, entryId: entry.id };
        exchanges.push(current);
      }
      if (said) {
        current.reply = current.reply ? `${current.reply}\n${said}` : said;
        if (typeof entry.timestamp === 'string') current.replyAt = entry.timestamp;
      }
      current.entryId = entry.id;
    } else if (current) {
      current.entryId = entry.id;
    }
  }
  return { exchanges, lastEntryId: branch.length ? branch[branch.length - 1].id : null, resumed, entryIds: branch.map((e) => e.id) };
}

/** A real exchange: the player said something and the character answered. */
export function isRealExchange(e: ChatExchange): boolean {
  return !e.cue && e.player.trim() !== '' && e.reply.trim() !== '';
}

export function countRealExchanges(exchanges: readonly ChatExchange[]): number {
  return exchanges.filter(isRealExchange).length;
}

/**
 * Plain-text transcript, oldest first: `Player: …` / `<name>: …`. Keeps the
 * NEWEST `lastN` exchanges and, past `maxChars`, drops whole older exchanges
 * (never cuts a line in half, except a single exchange longer than the budget).
 */
export function renderTranscript(
  exchanges: readonly ChatExchange[],
  name: string,
  opts: { lastN?: number; maxChars?: number } = {}
): { text: string; shown: number; omitted: number } {
  const lastN = Math.max(1, Math.floor(opts.lastN ?? 20));
  const maxChars = Math.max(200, Math.floor(opts.maxChars ?? 12_000));
  const picked = exchanges.filter((e) => e.player || e.reply).slice(-lastN);
  const blocks = picked.map((e) => {
    const lines: string[] = [];
    if (e.cue && !e.player) lines.push('(scene cue — the character spoke first)');
    if (e.player) lines.push(`Player: ${e.player}`);
    if (e.reply) lines.push(`${name}: ${e.reply}`);
    return lines.join('\n');
  });
  const kept: string[] = [];
  let used = 0;
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const cost = blocks[i].length + 2;
    if (kept.length > 0 && used + cost > maxChars) break;
    kept.unshift(cost > maxChars ? `${blocks[i].slice(0, maxChars - 1)}…` : blocks[i]);
    used += cost;
  }
  return { text: kept.join('\n\n'), shown: kept.length, omitted: exchanges.filter((e) => e.player || e.reply).length - kept.length };
}

// ------------------------------------------------------------------ summaries

/** What the writer learns when a chat ends (stored in `character_talked.detail.summary`). */
export interface ChatSummary {
  /** Two to four sentences: what happened in the chat. */
  text: string;
  clues_learned: string[];
  promises_made: string[];
  relationship_change: string;
  player_intent: string;
  /** At most two short lines worth keeping verbatim. */
  notable_quotes: string[];
  /** The summariser judged the chat to matter to the story beyond clues and promises. */
  important: boolean;
}

export const CHAT_SUMMARY_LIMITS = Object.freeze({
  text: 600,
  item: 160,
  items: 5,
  quote: 120,
  quotes: 2,
});

function clip(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function clipList(value: unknown, max: number, count: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => clip(v, max)).filter((v) => v !== '' && !/^\(?none\)?\.?$/i.test(v)).slice(0, count);
}

/**
 * Untrusted model output (or a stored detail) → a bounded `ChatSummary`, or
 * null when there is no summary text at all. Pure and total.
 */
export function normalizeChatSummary(raw: unknown): ChatSummary | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const text = clip(r.text ?? r.summary, CHAT_SUMMARY_LIMITS.text);
  if (!text) return null;
  const none = (v: string) => (/^\(?(none|no change|unchanged|n\/a)\)?\.?$/i.test(v) ? '' : v);
  return {
    text,
    clues_learned: clipList(r.clues_learned, CHAT_SUMMARY_LIMITS.item, CHAT_SUMMARY_LIMITS.items),
    promises_made: clipList(r.promises_made, CHAT_SUMMARY_LIMITS.item, CHAT_SUMMARY_LIMITS.items),
    relationship_change: none(clip(r.relationship_change, CHAT_SUMMARY_LIMITS.item)),
    player_intent: none(clip(r.player_intent, CHAT_SUMMARY_LIMITS.item)),
    notable_quotes: clipList(r.notable_quotes, CHAT_SUMMARY_LIMITS.quote, CHAT_SUMMARY_LIMITS.quotes),
    important: r.important === true,
  };
}

/** A chat worth a quiet writer beat: something was learned or promised, or it was flagged. */
export function chatSummaryWantsBeat(summary: ChatSummary | null | undefined): boolean {
  return !!summary && (summary.clues_learned.length > 0 || summary.promises_made.length > 0 || summary.important);
}
