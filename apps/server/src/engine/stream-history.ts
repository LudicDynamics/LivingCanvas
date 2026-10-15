/**
 * `GET /api/world/stream` — the message drawer's history.
 *
 * Gathers what the save already keeps and hands it to the pure builders in
 * `@airp/shared` (rules/stream-history.ts): the event log, the chalk files, each
 * character's session, the writer's sessions (the player's requests only; a beat
 * the fast path answered keeps its request in `.airpworld/fast-path.log`), NPC
 * cards' recorded dialogue and the character tick log. Read-only: nothing is
 * written, no agent is touched, no event is appended.
 *
 * Player view: chalks under `world/` only; a character's session gives the lines
 * the player and that character said to each other (the player was there); the
 * writer's replies, thinking and tool calls never leave, and neither does anything
 * under `characters/<id>/` (their memory and diary), `command/` or `endings/`.
 *
 * The whole timeline is rebuilt per request and then paged. A save holds a few
 * hundred events and a handful of session files; when that stops being cheap, the
 * place to cache is here, keyed on the max event seq and the session files' mtimes.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  displayItemOf,
  loadTickWorld,
  pageStreamItems,
  parseFrontmatter,
  readTickState,
  streamChalksOfEvents,
  streamItemsOfCharacterSession,
  streamItemsOfEvent,
  streamItemsOfNpcCard,
  streamItemsOfTick,
  streamItemsOfWriterSession,
  streamItemsOfFastPathLog,
  streamRecapOfTalk,
  streamSeatedChalks,
  chalkStreamText,
  tickActorNames,
  tickStreamKey,
  type LocalWorldStore,
  type StreamChalkNow,
  type StreamItem,
  type StreamPage,
  type StreamTickEntry,
  type WorldEvent,
} from '@airp/shared';
import { FAST_PATH_LOG } from './writer-fast-path.js';

const CHARACTER_SESSION = /^char-([a-z0-9][a-z0-9-]*)\.jsonl$/;

type StreamStore = Pick<LocalWorldStore, 'worldRoot' | 'readFile' | 'listFiles' | 'getEventsSince' | 'pageOfLayer' | 'queryCanvas'>;

async function chalkNow(store: StreamStore, relPath: string): Promise<StreamChalkNow | null> {
  try {
    const { frontmatter, body } = displayItemOf(relPath, await store.readFile(relPath));
    if (frontmatter?.type !== 'chalk') return null;
    const title = typeof frontmatter.title === 'string' && frontmatter.title.trim() ? frontmatter.title.trim() : undefined;
    const text = chalkStreamText(body ?? '') || title || '';
    return { text, ...(title ? { title } : {}) };
  } catch {
    return null;
  }
}

/** `map` is the world's root page (`world/`); any other layer id is its directory. */
function dirOfPage(layer: string): string {
  return layer === 'map' ? 'world' : layer;
}

async function sessionFiles(worldRoot: string): Promise<string[]> {
  try {
    return (await fs.readdir(path.join(worldRoot, '.airpworld', 'sessions'))).sort();
  } catch {
    return [];
  }
}

async function readSession(worldRoot: string, name: string): Promise<string> {
  try {
    return await fs.readFile(path.join(worldRoot, '.airpworld', 'sessions', name), 'utf8');
  } catch {
    return '';
  }
}

/** Chalks seated on the pages the player entered this loop, with the first time they did. */
async function seatedChalks(store: StreamStore, events: readonly WorldEvent[], made: ReadonlySet<string>): Promise<StreamItem[]> {
  let from = 0;
  events.forEach((e, i) => { if (e.type === 'loop_reset') from = i; });
  const loop = events.slice(from);
  const firstAt = new Map<string, number>();
  for (const e of loop) {
    // The player walked in, or the writer / a command took them there; a character entering is not the player.
    if (e.type !== 'layer_entered' || e.actor?.type === 'character') continue;
    const layer = typeof e.layer === 'string' && e.layer ? e.layer : typeof e.detail?.layer === 'string' ? String(e.detail.layer) : null;
    const at = Date.parse(e.createdAt);
    if (layer && Number.isFinite(at) && !firstAt.has(layer)) firstAt.set(layer, at);
  }
  // The page a run (or a loop) opened on may never have been "entered": the player was simply there. That is the
  // page last entered before the loop began, else the page the browser last reported.
  const start = loop.length ? Date.parse(loop[0].createdAt) : NaN;
  if (firstAt.size === 0 && Number.isFinite(start)) {
    let here: string | null = null;
    for (const e of events.slice(0, from)) {
      if (e.type === 'layer_entered' && e.actor?.type !== 'character' && typeof e.layer === 'string' && e.layer) here = e.layer;
    }
    if (!here) {
      try {
        const row = store.queryCanvas('SELECT layer FROM viewpoint LIMIT 1')[0] as { layer?: unknown } | undefined;
        here = typeof row?.layer === 'string' && row.layer ? row.layer : null;
      } catch { /* no viewpoint table: a world no page has opened */ }
    }
    if (here) firstAt.set(here, start);
  }
  const visits: Array<{ layer: string; at: number; chalks: Array<{ path: string } & StreamChalkNow> }> = [];
  for (const [layer, at] of firstAt) {
    const dir = dirOfPage(layer);
    let cards: string[] = [];
    try { cards = (await store.pageOfLayer(layer)).cards; } catch { continue; }
    const chalks: Array<{ path: string } & StreamChalkNow> = [];
    for (const file of cards) {
      if (!file.startsWith('world/') || file.slice(0, file.lastIndexOf('/')) !== dir || made.has(file)) continue;
      const now = await chalkNow(store, file);
      if (now) chalks.push({ path: file, ...now });
    }
    if (chalks.length) visits.push({ layer, at, chalks });
  }
  return streamSeatedChalks(visits, made);
}

async function npcLines(store: StreamStore): Promise<StreamItem[]> {
  let files: string[] = [];
  try { files = await store.listFiles('world'); } catch { return []; }
  const out: StreamItem[] = [];
  for (const file of files) {
    if (!file.endsWith('.md')) continue;
    let raw: string;
    try { raw = await store.readFile(file); } catch { continue; }
    if (!raw.includes('dialogue:')) continue;
    const { frontmatter } = parseFrontmatter(raw);
    const dir = file.slice(0, file.lastIndexOf('/'));
    out.push(...streamItemsOfNpcCard(file, frontmatter as Record<string, unknown> | null, dir === 'world' ? 'map' : dir));
  }
  return out;
}

async function tickLines(store: StreamStore): Promise<StreamItem[]> {
  const world = await loadTickWorld(store as LocalWorldStore).catch(() => null);
  if (!world) return [];
  const state = await readTickState(store as LocalWorldStore, world).catch(() => null);
  if (!state) return [];
  const names = await tickActorNames(store as LocalWorldStore, world).catch(() => new Map<string, string>());
  const entries: StreamTickEntry[] = state.log.map((e) => ({
    key: tickStreamKey(e),
    ...(e.at ? { at: e.at } : {}),
    actor: e.actor,
    name: names.get(e.actor) ?? e.actor,
    page: e.page,
    ...(e.words ? { words: e.words } : {}),
    chatter: e.result === 'said',
  }));
  return streamItemsOfTick(entries);
}

/** Every source of the drawer's timeline, unpaged. */
export async function streamHistoryItems(store: StreamStore): Promise<StreamItem[][]> {
  const events = await store.getEventsSince(0);

  // Chalks the log says were made, with each standing file's text.
  const standing = new Map<string, StreamChalkNow | null>();
  for (const e of events) {
    const p = e.type === 'entity_created' && e.detail?.kind === 'chalk' ? e.detail.path : null;
    if (typeof p === 'string' && p.startsWith('world/') && !standing.has(p)) standing.set(p, await chalkNow(store, p));
  }
  const chalks = streamChalksOfEvents(events, (p) => standing.get(p) ?? null);
  const made = new Set(chalks.map((c) => c.chalkPath).filter((p): p is string => typeof p === 'string'));
  const seated = await seatedChalks(store, events, made);

  // Conversations, from the session files.
  const files = await sessionFiles(store.worldRoot);
  const chats: StreamItem[] = [];
  const transcripts = new Map<string, Set<string>>();
  const asks: StreamItem[] = [];
  for (const name of files) {
    const char = CHARACTER_SESSION.exec(name);
    if (char) {
      const { items, entryIds } = streamItemsOfCharacterSession(char[1], await readSession(store.worldRoot, name));
      chats.push(...items);
      transcripts.set(char[1], entryIds);
      continue;
    }
    // Everything else in the folder is the writer's (`<time>_<id>.jsonl`, a retired loop's `….loop-N.done`).
    if (name.startsWith('.') || !/\.(jsonl|done)$/.test(name)) continue;
    asks.push(...streamItemsOfWriterSession(await readSession(store.worldRoot, name)));
  }
  // Beats the writer's fast path answered never reached a session: their requests are in its log.
  asks.push(...streamItemsOfFastPathLog(await fs.readFile(path.join(store.worldRoot, FAST_PATH_LOG), 'utf8').catch(() => '')));
  const recaps = events.flatMap((e) => streamRecapOfTalk(e, (character, id) => transcripts.get(character)?.has(id) ?? false));

  return [
    chalks,
    seated,
    events.flatMap((e) => streamItemsOfEvent(e)),
    chats,
    recaps,
    asks,
    await npcLines(store),
    await tickLines(store),
  ];
}

export async function readStreamHistory(store: StreamStore, opts: { before?: string | null; limit?: number } = {}): Promise<StreamPage> {
  return pageStreamItems(await streamHistoryItems(store), opts);
}
