/**
 * Ambient life: the small idle things characters do
 * on the canvas while nobody talks to them — a one-line bark in a bubble, an
 * emote, two people murmuring to each other.
 *
 * A world MAY ship `ambient/<id>.json` at its root, one file per person, where
 * `<id>` is a `characters/<id>/` folder or the file stem of an NPC card under
 * `world/`. Barks are flavor, never facts: no agent reads this folder, nothing
 * here is logged or sent to a model, and a world with no `ambient/` still gets
 * the built-in wordless emotes.
 *
 * This module is the ONE shape owner: the server route sanitises with it and
 * `check:worlds` reports its problems. Pure, no I/O.
 */

/** Longest bark, in characters (code points), per locale. */
export const AMBIENT_BARK_MAX = 40;
/** Most barks in one list; more is a sign the file has become a script. */
export const AMBIENT_LIST_MAX = 24;
/** Built-in wordless emotes. Every world gets these; an entry may prefer some. */
export const AMBIENT_EMOTES = ['dots', 'question', 'exclaim', 'music', 'heart', 'sigh'] as const;
export type AmbientEmote = (typeof AMBIENT_EMOTES)[number];
/** The player's own clock, coarse: a bark list can be kept for one part of the day. */
export const AMBIENT_TIMES = ['morning', 'day', 'evening', 'night'] as const;
export type AmbientTime = (typeof AMBIENT_TIMES)[number];
/** Interface locales a per-locale bark map may name. */
export const AMBIENT_LOCALES = ['en', 'zh-CN', 'ja', 'ko'] as const;

/** A bark list: the edition's own language, or one list per interface locale. */
export type AmbientBarks = string[] | Partial<Record<(typeof AMBIENT_LOCALES)[number], string[]>>;

export interface AmbientCondition {
  /** Layer id (`world/cab`, `map`): this layer or anything under it. */
  layer?: string;
  /** Part of the player's day. */
  time?: AmbientTime;
  /** A card path that must be on the current canvas (e.g. after a clue appeared). */
  card?: string;
  barks: AmbientBarks;
}

export interface AmbientChat {
  /** The other person's ambient id (a character folder or NPC card stem). */
  with: string;
  /** Alternating lines, starting with THIS person. 2–4 lines. */
  barks: AmbientBarks;
}

export interface AmbientEntry {
  barks?: AmbientBarks;
  emotes?: AmbientEmote[];
  when?: AmbientCondition[];
  chats?: AmbientChat[];
}

export const AMBIENT_DIR = 'ambient';
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TOP_KEYS = new Set(['barks', 'emotes', 'when', 'chats']);
const WHEN_KEYS = new Set(['layer', 'time', 'card', 'barks']);
const CHAT_KEYS = new Set(['with', 'barks']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Character count the way a reader sees it (code points, not UTF-16 units). */
export function ambientLength(text: string): number {
  return [...text].length;
}

/** `ambient/<id>.json` → `<id>`, or null when the path is not an ambient file. */
export function ambientIdOf(relPath: string): string | null {
  const match = /^ambient\/([^/]+)\.json$/.exec(relPath);
  return match && ID.test(match[1]) ? match[1] : null;
}

function barkListProblems(where: string, value: unknown, min = 1): string[] {
  if (!Array.isArray(value)) return [`${where}: a bark list is an array of strings`];
  const problems: string[] = [];
  if (value.length < min) problems.push(`${where}: needs at least ${min} line${min === 1 ? '' : 's'}`);
  if (value.length > AMBIENT_LIST_MAX) problems.push(`${where}: at most ${AMBIENT_LIST_MAX} lines`);
  value.forEach((line, i) => {
    if (typeof line !== 'string' || !line.trim()) problems.push(`${where}[${i}]: a bark is a non-empty string`);
    else if (ambientLength(line) > AMBIENT_BARK_MAX) problems.push(`${where}[${i}]: ${ambientLength(line)} characters; a bark is at most ${AMBIENT_BARK_MAX}`);
    else if (/\n/.test(line)) problems.push(`${where}[${i}]: a bark is one line`);
  });
  return problems;
}

function barksProblems(where: string, value: unknown, min = 1): string[] {
  if (Array.isArray(value)) return barkListProblems(where, value, min);
  if (!isRecord(value)) return [`${where}: barks are a list, or one list per locale (${AMBIENT_LOCALES.join(', ')})`];
  const keys = Object.keys(value);
  if (keys.length === 0) return [`${where}: names no locale`];
  const problems: string[] = [];
  for (const key of keys) {
    if (!(AMBIENT_LOCALES as readonly string[]).includes(key)) problems.push(`${where}: unknown locale "${key}"`);
    else problems.push(...barkListProblems(`${where}.${key}`, value[key], min));
  }
  return problems;
}

/** Every problem with one `ambient/<id>.json` document; empty = valid. */
export function ambientEntryProblems(raw: unknown): string[] {
  if (!isRecord(raw)) return ['an ambient file is a JSON object'];
  const problems: string[] = [];
  for (const key of Object.keys(raw)) if (!TOP_KEYS.has(key)) problems.push(`unknown key "${key}"`);
  if (raw.barks !== undefined) problems.push(...barksProblems('barks', raw.barks));
  if (raw.emotes !== undefined) {
    if (!Array.isArray(raw.emotes) || raw.emotes.length === 0) problems.push('emotes: a non-empty list');
    else raw.emotes.forEach((e, i) => {
      if (!(AMBIENT_EMOTES as readonly unknown[]).includes(e)) problems.push(`emotes[${i}]: "${String(e)}" is not one of ${AMBIENT_EMOTES.join(', ')}`);
    });
  }
  if (raw.when !== undefined) {
    if (!Array.isArray(raw.when)) problems.push('when: a list of conditions');
    else raw.when.forEach((c, i) => {
      const where = `when[${i}]`;
      if (!isRecord(c)) { problems.push(`${where}: an object`); return; }
      for (const key of Object.keys(c)) if (!WHEN_KEYS.has(key)) problems.push(`${where}: unknown key "${key}"`);
      if (c.layer === undefined && c.time === undefined && c.card === undefined) problems.push(`${where}: names a layer, a time or a card`);
      if (c.layer !== undefined && (typeof c.layer !== 'string' || !/^(?:map|world(?:\/[a-z0-9][a-z0-9-]*)*)$/.test(c.layer))) problems.push(`${where}.layer: a layer id (map, world/…)`);
      if (c.time !== undefined && !(AMBIENT_TIMES as readonly unknown[]).includes(c.time)) problems.push(`${where}.time: one of ${AMBIENT_TIMES.join(', ')}`);
      if (c.card !== undefined && (typeof c.card !== 'string' || !/^(?:world|player)\/[A-Za-z0-9/_.-]+\.md$/.test(c.card))) problems.push(`${where}.card: a world/… or player/… .md path`);
      problems.push(...barksProblems(`${where}.barks`, c.barks));
    });
  }
  if (raw.chats !== undefined) {
    if (!Array.isArray(raw.chats)) problems.push('chats: a list');
    else raw.chats.forEach((c, i) => {
      const where = `chats[${i}]`;
      if (!isRecord(c)) { problems.push(`${where}: an object`); return; }
      for (const key of Object.keys(c)) if (!CHAT_KEYS.has(key)) problems.push(`${where}: unknown key "${key}"`);
      if (typeof c.with !== 'string' || !ID.test(c.with)) problems.push(`${where}.with: an ambient id (kebab-case)`);
      problems.push(...barksProblems(`${where}.barks`, c.barks, 2));
      const lists = Array.isArray(c.barks) ? [c.barks] : isRecord(c.barks) ? Object.values(c.barks) : [];
      if (lists.some((l) => Array.isArray(l) && l.length > 4)) problems.push(`${where}.barks: a chat is 2–4 lines`);
    });
  }
  if (raw.barks === undefined && raw.when === undefined && raw.chats === undefined && raw.emotes === undefined) {
    problems.push('declares nothing (barks, when, chats or emotes)');
  }
  return problems;
}

function cleanList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((line): line is string => typeof line === 'string' && line.trim() !== '' && !/\n/.test(line) && ambientLength(line) <= AMBIENT_BARK_MAX)
    .map((line) => line.trim())
    .slice(0, AMBIENT_LIST_MAX);
}

function cleanBarks(value: unknown): AmbientBarks | undefined {
  if (Array.isArray(value)) {
    const list = cleanList(value);
    return list.length ? list : undefined;
  }
  if (!isRecord(value)) return undefined;
  const out: Partial<Record<(typeof AMBIENT_LOCALES)[number], string[]>> = {};
  for (const locale of AMBIENT_LOCALES) {
    const list = cleanList(value[locale]);
    if (list.length) out[locale] = list;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Lenient read for the play path: keep what is valid, drop the rest, so one bad
 * line in a hand-made world never silences the whole person. Null = nothing usable.
 */
export function sanitizeAmbientEntry(raw: unknown): AmbientEntry | null {
  if (!isRecord(raw)) return null;
  const entry: AmbientEntry = {};
  const barks = cleanBarks(raw.barks);
  if (barks) entry.barks = barks;
  if (Array.isArray(raw.emotes)) {
    const emotes = raw.emotes.filter((e): e is AmbientEmote => (AMBIENT_EMOTES as readonly unknown[]).includes(e));
    if (emotes.length) entry.emotes = [...new Set(emotes)];
  }
  if (Array.isArray(raw.when)) {
    const when: AmbientCondition[] = [];
    for (const c of raw.when) {
      if (!isRecord(c)) continue;
      const list = cleanBarks(c.barks);
      if (!list) continue;
      const cond: AmbientCondition = { barks: list };
      if (typeof c.layer === 'string' && c.layer) cond.layer = c.layer;
      if ((AMBIENT_TIMES as readonly unknown[]).includes(c.time)) cond.time = c.time as AmbientTime;
      if (typeof c.card === 'string' && c.card) cond.card = c.card;
      if (cond.layer || cond.time || cond.card) when.push(cond);
    }
    if (when.length) entry.when = when;
  }
  if (Array.isArray(raw.chats)) {
    const chats: AmbientChat[] = [];
    for (const c of raw.chats) {
      if (!isRecord(c) || typeof c.with !== 'string' || !ID.test(c.with)) continue;
      const list = cleanBarks(c.barks);
      if (list) chats.push({ with: c.with, barks: list });
    }
    if (chats.length) entry.chats = chats;
  }
  return Object.keys(entry).length ? entry : null;
}
