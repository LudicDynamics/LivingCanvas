/**
 * Player notes and the clue board.
 *
 * Pure vocabulary shared by the action layer, the server routes, the writer's
 * injection and the web canvas. Dependency-free on purpose: `forms.ts` (which
 * the web bundle imports) and the component resolver read `isPlayerNoteFile`.
 *
 * Ownership is decided by the PATH, never by frontmatter alone: a player note
 * is `<layer dir>/player-note-<n>.md` directly inside a layer. A file that only
 * claims `type: player-note` somewhere else is an ordinary card — so nobody can
 * forge a "player note" by writing frontmatter, and the guard can refuse a
 * native write/edit without reading the file.
 */

/** Frontmatter `type` of a player note. */
export const PLAYER_NOTE_TYPE = 'player-note';
/** Card kind the canvas paints a player note with (CARD_FORMS row). */
export const PLAYER_NOTE_KIND = 'sticky';
/** File name prefix; the rest is a decimal ordinal. */
export const PLAYER_NOTE_PREFIX = 'player-note-';

export const PLAYER_NOTE_COLORS = ['yellow', 'pink', 'blue', 'green'] as const;
export type PlayerNoteColor = (typeof PLAYER_NOTE_COLORS)[number];
export const PLAYER_NOTE_SIZES = ['s', 'm', 'l'] as const;
export type PlayerNoteSize = (typeof PLAYER_NOTE_SIZES)[number];

/** Player tags on any card: 可疑 / 已确认 / 无关. */
export const PLAYER_TAGS = ['suspect', 'confirmed', 'irrelevant'] as const;
export type PlayerTag = (typeof PLAYER_TAGS)[number];

/** Limits (also the request-body limits the routes enforce). */
export const PLAYER_NOTE_LIMITS = {
  /** Characters in one note. */
  text: 500,
  /** Notes on one layer. */
  perLayer: 40,
  /** Characters in one link label. */
  label: 24,
  /** Links in the whole save. */
  links: 200,
  /** Tagged cards in the whole save. */
  tags: 300,
} as const;

/** The save-level board file (links + tags), world-root relative. */
export const PLAYER_BOARD_PATH = 'player-board.json';

const NOTE_FILE = /^player-note-(\d{1,6})\.md$/;
const NOTE_PATH = /^world(?:\/[^/]+)*\/player-note-\d{1,6}\.md$/;

/** True when `filename` (a basename) is a player-note file name. */
export function isPlayerNoteFile(filename: string): boolean {
  return NOTE_FILE.test(filename);
}

/** True when `path` (world-root relative) is a player note: `world/**\/player-note-<n>.md`. */
export function isPlayerNotePath(path: string): boolean {
  return typeof path === 'string' && NOTE_PATH.test(path) && !path.split('/').some((s) => s === '..' || s === '.');
}

/** The ordinal of a player-note basename, or null. */
export function playerNoteOrdinal(filename: string): number | null {
  const m = NOTE_FILE.exec(filename);
  return m ? Number(m[1]) : null;
}

/** Next free note file name among `existing` basenames (`player-note-1.md`, …). */
export function nextPlayerNoteFile(existing: readonly string[]): string {
  let max = 0;
  for (const name of existing) {
    const n = playerNoteOrdinal(name);
    if (n !== null && n > max) max = n;
  }
  return `${PLAYER_NOTE_PREFIX}${max + 1}.md`;
}

/** True when frontmatter + file name make a player note the canvas paints as a sticky. */
export function isPlayerNoteCard(fm: Record<string, unknown> | null | undefined, filename: string): boolean {
  return (fm?.type === PLAYER_NOTE_TYPE) && isPlayerNoteFile(filename);
}

export function isPlayerTag(value: unknown): value is PlayerTag {
  return typeof value === 'string' && (PLAYER_TAGS as readonly string[]).includes(value);
}

export function noteColorOf(fm: Record<string, unknown> | null | undefined): PlayerNoteColor {
  const c = fm?.color;
  return typeof c === 'string' && (PLAYER_NOTE_COLORS as readonly string[]).includes(c) ? (c as PlayerNoteColor) : 'yellow';
}

export function noteSizeOf(fm: Record<string, unknown> | null | undefined): PlayerNoteSize {
  const s = fm?.size;
  return typeof s === 'string' && (PLAYER_NOTE_SIZES as readonly string[]).includes(s) ? (s as PlayerNoteSize) : 'm';
}

/** A note's display title: its first non-empty line, capped. */
export function noteTitleOf(text: string): string {
  const first = text.split('\n').map((l) => l.trim()).find((l) => l !== '') ?? '';
  return first.length > 40 ? `${first.slice(0, 40).trimEnd()}…` : first;
}

// ------------------------------------------------------------------ the board

export interface PlayerLink {
  id: string;
  /** The layer both endpoints sit on. */
  layer: string;
  from: string;
  to: string;
  label?: string;
}

export interface PlayerBoard {
  version: 1;
  links: PlayerLink[];
  /** card path (or `characters/<id>`) → tag */
  tags: Record<string, PlayerTag>;
}

export function emptyPlayerBoard(): PlayerBoard {
  return { version: 1, links: [], tags: {} };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Tolerant parse of `player-board.json`: anything malformed is dropped row by
 * row, never thrown — a hand-edited board must not break the canvas or a turn.
 */
export function parsePlayerBoard(raw: unknown): PlayerBoard {
  let value = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return emptyPlayerBoard();
    }
  }
  const board = emptyPlayerBoard();
  if (!isRecord(value)) return board;
  if (Array.isArray(value.links)) {
    const seen = new Set<string>();
    for (const row of value.links) {
      if (!isRecord(row)) continue;
      const { id, layer, from, to, label } = row;
      if (typeof id !== 'string' || typeof layer !== 'string' || typeof from !== 'string' || typeof to !== 'string') continue;
      if (seen.has(id) || from === to) continue;
      seen.add(id);
      const link: PlayerLink = { id, layer, from, to };
      if (typeof label === 'string' && label.trim() !== '') link.label = label.trim().slice(0, PLAYER_NOTE_LIMITS.label);
      board.links.push(link);
      if (board.links.length >= PLAYER_NOTE_LIMITS.links) break;
    }
  }
  if (isRecord(value.tags)) {
    for (const [path, tag] of Object.entries(value.tags)) {
      if (isPlayerTag(tag)) board.tags[path] = tag;
    }
  }
  return board;
}

/** Stable link id for an (unordered) endpoint pair on one layer. */
export function playerLinkId(layer: string, from: string, to: string): string {
  const [a, b] = from < to ? [from, to] : [to, from];
  let h = 0x811c9dc5;
  for (const ch of `${layer}|${a}|${b}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `pl-${h.toString(16).padStart(8, '0')}`;
}

/** The board slice for one layer: its links and the tags of cards on it. */
export function playerBoardOfLayer(
  board: PlayerBoard,
  layer: string,
  onLayer?: (path: string) => boolean,
): { links: PlayerLink[]; tags: Record<string, PlayerTag> } {
  const links = board.links.filter((l) => l.layer === layer);
  const tags: Record<string, PlayerTag> = {};
  for (const [path, tag] of Object.entries(board.tags)) {
    if (!onLayer || onLayer(path)) tags[path] = tag;
  }
  return { links, tags };
}

/** `characters/<id>` — a character presence as a board endpoint. */
export const CHARACTER_ENDPOINT = /^characters\/([a-z0-9][a-z0-9-]*)$/;
