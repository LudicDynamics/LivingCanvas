/**
 * The player's sticky notes and clue board.
 *
 * Two narrow player-only seams, the same shape as `nook-note.ts`:
 *   - notes are FILES (`<layer dir>/player-note-<n>.md`, `type: player-note`,
 *     `author: player`) — world content, saved / snapshotted / reset with the
 *     save, painted by the canvas like any card;
 *   - links and tags are the BOARD (`player-board.json` at the world root) —
 *     the player's annotations ON the writer's cards, never written into them.
 *
 * Only the player actor gets in. The generic mutation paths refuse player-note
 * paths for everyone else (`assertPlayerNoteMutationAllowed`), so the writer
 * and characters can read a note but never change it.
 */
import { ActionError, fail } from './errors.js';
import type { ActionContext, ActionResult } from './types.js';
import type { WorldEvent } from '../schemas/events.js';
import { parseFrontmatter, stringifyFrontmatter } from '../schemas/frontmatter.js';
import { cardFormOf } from '../schemas/forms.js';
import { dirOf, dirOfLayer, isLayerDir, layerOfDir } from '../store/layers.js';
import { entityName } from '../rules/interactive.js';
import {
  CHARACTER_ENDPOINT,
  PLAYER_BOARD_PATH,
  PLAYER_NOTE_COLORS,
  PLAYER_NOTE_LIMITS,
  PLAYER_NOTE_SIZES,
  PLAYER_NOTE_TYPE,
  PLAYER_TAGS,
  isPlayerNotePath,
  nextPlayerNoteFile,
  noteTitleOf,
  parsePlayerBoard,
  playerLinkId,
  type PlayerBoard,
  type PlayerLink,
  type PlayerNoteColor,
  type PlayerNoteSize,
  type PlayerTag,
} from '../rules/player-notes.js';

// ------------------------------------------------------------------ inputs

export type PlayerNoteInput =
  | { op: 'create'; layer: string; text: string; color?: PlayerNoteColor; size?: PlayerNoteSize; x?: number; y?: number }
  | { op: 'update'; path: string; text?: string; color?: PlayerNoteColor; size?: PlayerNoteSize }
  | { op: 'delete'; path: string };

export type PlayerBoardInput =
  | { op: 'link'; from: string; to: string; label?: string }
  | { op: 'unlink'; id: string }
  | { op: 'tag'; path: string; tag: PlayerTag | null };

export interface PlayerNoteDetails {
  path: string;
  op: 'create' | 'update' | 'delete';
  layer: string;
  event: WorldEvent;
}

export interface PlayerBoardDetails {
  op: PlayerBoardInput['op'];
  layer: string;
  board: { links: PlayerLink[]; tags: Record<string, PlayerTag> };
  /** false when the request changed nothing (re-marking a card with the same tag). */
  changed: boolean;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function assertPlayer(ctx: ActionContext): void {
  if (ctx.actor.type !== 'player' || ctx.actor.id !== undefined) {
    throw new ActionError({ code: 'player_owned', message: 'player notes and the clue board are the player\'s alone' });
  }
}

function cleanText(raw: unknown): string {
  if (typeof raw !== 'string') fail('invalid_argument', 'text must be a string');
  // No frontmatter fence, no control characters: the body is the note, nothing else.
  const text = raw.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim();
  if (text === '') fail('invalid_argument', 'a note cannot be empty');
  if (text.length > PLAYER_NOTE_LIMITS.text) fail('invalid_argument', `a note is at most ${PLAYER_NOTE_LIMITS.text} characters`);
  return text.replace(/^---$/gm, '—');
}

/** Pure request-shape parse shared by the route and the tests. Throws `invalid_argument`. */
export function parsePlayerNoteInput(body: unknown): PlayerNoteInput {
  if (!isRecord(body)) fail('invalid_argument', 'body must be an object');
  const color = body.color;
  const size = body.size;
  if (color !== undefined && !(PLAYER_NOTE_COLORS as readonly unknown[]).includes(color)) fail('invalid_argument', `color must be one of ${PLAYER_NOTE_COLORS.join(', ')}`);
  if (size !== undefined && !(PLAYER_NOTE_SIZES as readonly unknown[]).includes(size)) fail('invalid_argument', `size must be one of ${PLAYER_NOTE_SIZES.join(', ')}`);
  const style = { ...(color !== undefined ? { color: color as PlayerNoteColor } : {}), ...(size !== undefined ? { size: size as PlayerNoteSize } : {}) };
  switch (body.op) {
    case 'create': {
      if (typeof body.layer !== 'string' || body.layer === '') fail('invalid_argument', 'layer must be a non-empty string');
      const pos = finite(body.x) && finite(body.y) ? { x: Math.round(body.x), y: Math.round(body.y) } : {};
      return { op: 'create', layer: body.layer, text: cleanText(body.text), ...style, ...pos };
    }
    case 'update': {
      if (typeof body.path !== 'string' || !isPlayerNotePath(body.path)) fail('invalid_argument', 'path must be a player note');
      return { op: 'update', path: body.path, ...(body.text !== undefined ? { text: cleanText(body.text) } : {}), ...style };
    }
    case 'delete': {
      if (typeof body.path !== 'string' || !isPlayerNotePath(body.path)) fail('invalid_argument', 'path must be a player note');
      return { op: 'delete', path: body.path };
    }
    default:
      fail('invalid_argument', 'op must be one of: create, update, delete');
  }
}

/** Pure request-shape parse for the board route. Throws `invalid_argument`. */
export function parsePlayerBoardInput(body: unknown): PlayerBoardInput {
  if (!isRecord(body)) fail('invalid_argument', 'body must be an object');
  switch (body.op) {
    case 'link': {
      if (typeof body.from !== 'string' || typeof body.to !== 'string' || !body.from || !body.to) fail('invalid_argument', 'from and to must be card paths');
      if (body.from === body.to) fail('invalid_argument', 'a line needs two different cards');
      let label: string | undefined;
      if (body.label !== undefined && body.label !== null) {
        if (typeof body.label !== 'string') fail('invalid_argument', 'label must be a string');
        label = body.label.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
        if (label.length > PLAYER_NOTE_LIMITS.label) fail('invalid_argument', `a label is at most ${PLAYER_NOTE_LIMITS.label} characters`);
        if (label === '') label = undefined;
      }
      return { op: 'link', from: body.from, to: body.to, ...(label ? { label } : {}) };
    }
    case 'unlink':
      if (typeof body.id !== 'string' || body.id === '') fail('invalid_argument', 'id must be a link id');
      return { op: 'unlink', id: body.id };
    case 'tag':
      if (typeof body.path !== 'string' || body.path === '') fail('invalid_argument', 'path must be a card path');
      if (body.tag !== null && !(PLAYER_TAGS as readonly unknown[]).includes(body.tag)) fail('invalid_argument', `tag must be one of ${PLAYER_TAGS.join(', ')} or null`);
      return { op: 'tag', path: body.path, tag: body.tag as PlayerTag | null };
    default:
      fail('invalid_argument', 'op must be one of: link, unlink, tag');
  }
}

// ------------------------------------------------------------------ notes

/** Serialise note writes per world: ordinal allocation must not race. */
const LOCKS = new Map<string, Promise<void>>();
async function inQueue<T>(key: string, run: () => Promise<T>): Promise<T> {
  const previous = LOCKS.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  LOCKS.set(key, current);
  await previous;
  try {
    return await run();
  } finally {
    release();
    if (LOCKS.get(key) === current) LOCKS.delete(key);
  }
}

function noteFile(text: string, fm: Record<string, unknown>): string {
  return stringifyFrontmatter(fm, `${text}\n`);
}

async function readNote(ctx: ActionContext, path: string): Promise<{ fm: Record<string, unknown>; body: string }> {
  if ((await ctx.store.statKind(path)) !== 'file') fail('not_found', `note not found: "${path}"`);
  const parsed = parseFrontmatter(await ctx.store.readFile(path));
  const fm = parsed.frontmatter ?? {};
  if (fm.type !== PLAYER_NOTE_TYPE) fail('invalid_argument', `"${path}" is not a player note`);
  return { fm, body: parsed.body.trim() };
}

export async function writePlayerNote(ctx: ActionContext, input: PlayerNoteInput): Promise<ActionResult<PlayerNoteDetails>> {
  assertPlayer(ctx);
  const { store, actor } = ctx;
  return inQueue(`${store.worldRoot}\u0000notes`, async () => {
    if (input.op === 'create') {
      const dir = dirOfLayer(input.layer);
      if (!isLayerDir(dir) || (await store.statKind(dir)) !== 'dir') fail('not_found', `layer "${input.layer}" does not exist`);
      const own = (await store.listFiles(dir)).filter((f) => dirOf(f) === dir);
      const notes = own.filter((f) => isPlayerNotePath(f));
      if (notes.length >= PLAYER_NOTE_LIMITS.perLayer) fail('invalid_argument', `this place already holds ${PLAYER_NOTE_LIMITS.perLayer} notes`);
      const filename = nextPlayerNoteFile(own.map((f) => f.slice(f.lastIndexOf('/') + 1)));
      const path = `${dir}/${filename}`;
      const fm: Record<string, unknown> = {
        type: PLAYER_NOTE_TYPE,
        author: 'player',
        title: noteTitleOf(input.text),
        color: input.color ?? 'yellow',
        size: input.size ?? 'm',
        created: (ctx.now ?? (() => new Date().toISOString()))(),
      };
      await store.writeFile(path, noteFile(input.text, fm));
      const layer = layerOfDir(dir);
      // Seat it with its declared form, then pin it where the player asked.
      const form = cardFormOf(fm, filename);
      try {
        await store.seatUnplaced(layer, [{ path, kind: 'sticky', w: form.w, h: form.h }]);
        if ('x' in input && input.x !== undefined && input.y !== undefined) await store.placeCard(layer, path, { x: input.x, y: input.y });
      } catch {
        // Seating is best-effort: the layer read seats any rowless card anyway.
      }
      const event = await store.appendEvent({
        type: 'entity_created',
        actor,
        detail: { path, name: String(fm.title), kind: 'note', summary: input.text.slice(0, 120), playerNote: true },
        subject: path,
        layer,
        turn: ctx.turn,
      });
      return { text: `The player pinned a note (${path}).`, details: { path, op: 'create', layer, event } };
    }

    const path = input.path;
    const { fm, body } = await readNote(ctx, path);
    const layer = (await store.resolveLayer(path)) ?? layerOfDir(dirOf(path));
    if (input.op === 'delete') {
      const name = entityName(fm, path);
      store.dropCard(path);
      await store.deleteFile(path);
      await dropBoardEndpoint(ctx, path);
      const event = await store.appendEvent({
        type: 'entity_deleted', actor, detail: { path, name, playerNote: true }, subject: path, layer, turn: ctx.turn,
      });
      return { text: `The player took down a note (${path}).`, details: { path, op: 'delete', layer, event } };
    }

    const text = input.text ?? body;
    const next: Record<string, unknown> = {
      ...fm,
      author: 'player',
      title: noteTitleOf(text),
      ...(input.color ? { color: input.color } : {}),
      ...(input.size ? { size: input.size } : {}),
    };
    await store.writeFileAtomic(path, noteFile(text, next));
    const event = await store.appendEvent({
      type: 'entity_edited', actor, detail: { path, name: String(next.title), kind: 'note', playerNote: true }, subject: path, layer, turn: ctx.turn,
    });
    return { text: `The player rewrote a note (${path}).`, details: { path, op: 'update', layer, event } };
  });
}

// ------------------------------------------------------------------ board

export async function readPlayerBoard(store: ActionContext['store']): Promise<PlayerBoard> {
  try {
    if ((await store.statKind(PLAYER_BOARD_PATH)) !== 'file') return parsePlayerBoard(null);
    return parsePlayerBoard(await store.readFile(PLAYER_BOARD_PATH));
  } catch {
    return parsePlayerBoard(null);
  }
}

async function saveBoard(ctx: ActionContext, board: PlayerBoard): Promise<void> {
  await ctx.store.writeFileAtomic(PLAYER_BOARD_PATH, `${JSON.stringify(board, null, 2)}\n`);
}

/** A deleted note takes its lines and its tag with it. */
async function dropBoardEndpoint(ctx: ActionContext, path: string): Promise<void> {
  const board = await readPlayerBoard(ctx.store);
  const links = board.links.filter((l) => l.from !== path && l.to !== path);
  const hadTag = path in board.tags;
  if (links.length === board.links.length && !hadTag) return;
  delete board.tags[path];
  await saveBoard(ctx, { ...board, links });
}

/** Which layer an endpoint stands on, plus its display name. null = not a valid endpoint. */
async function endpointOf(ctx: ActionContext, path: string): Promise<{ layer: string | null; name: string } | null> {
  const { store } = ctx;
  const ch = CHARACTER_ENDPOINT.exec(path);
  if (ch) {
    const manifest = await store.getManifest();
    const character = manifest.characters.find((c) => c.id === ch[1]);
    if (!character) return null;
    const presence = store.getPresenceOf(ch[1]);
    return { layer: presence?.layer ?? null, name: (character as { name?: string }).name ?? ch[1] };
  }
  if (!/\.(md|html?)$/i.test(path) || path.split('/').some((s) => s === '..' || s === '.' || s === '')) return null;
  if ((await store.statKind(path)) !== 'file') return null;
  const layer = await store.resolveLayer(path);
  if (layer === null || layer.startsWith('characters/')) return null;
  let name = path;
  try {
    name = entityName(parseFrontmatter(await store.readFile(path)).frontmatter, path);
  } catch {
    // unreadable: keep the path
  }
  // A door is listed on its PARENT page.
  const onLayer = path.endsWith('/README.md') ? layerOfDir(dirOf(dirOf(path)) || 'world') : layer;
  return { layer: onLayer, name };
}

export async function updatePlayerBoard(ctx: ActionContext, input: PlayerBoardInput): Promise<ActionResult<PlayerBoardDetails>> {
  assertPlayer(ctx);
  const { store, actor } = ctx;
  return inQueue(`${store.worldRoot}\u0000board`, async () => {
    const board = await readPlayerBoard(store);
    let layer: string;
    let event: WorldEvent | null = null;

    if (input.op === 'link') {
      const [a, b] = await Promise.all([endpointOf(ctx, input.from), endpointOf(ctx, input.to)]);
      if (!a) fail('not_found', `"${input.from}" is not a card on the canvas`);
      if (!b) fail('not_found', `"${input.to}" is not a card on the canvas`);
      // A character stands wherever their presence row says; a card's page decides.
      const cardLayer = (input.from.startsWith('characters/') ? b.layer : a.layer) ?? b.layer ?? a.layer;
      if (cardLayer === null) fail('invalid_argument', 'neither end of the line is on a page');
      const bothOn = [a, b].every((e, i) => ([input.from, input.to][i].startsWith('characters/') ? (e.layer === null || e.layer === cardLayer) : e.layer === cardLayer));
      if (!bothOn) fail('invalid_argument', 'both ends of a line must be on the same page');
      layer = cardLayer;
      const id = playerLinkId(layer, input.from, input.to);
      const existing = board.links.find((l) => l.id === id);
      if (!existing && board.links.length >= PLAYER_NOTE_LIMITS.links) fail('invalid_argument', `the board already holds ${PLAYER_NOTE_LIMITS.links} lines`);
      const link: PlayerLink = { id, layer, from: input.from, to: input.to, ...(input.label ? { label: input.label } : {}) };
      board.links = existing ? board.links.map((l) => (l.id === id ? link : l)) : [...board.links, link];
      await saveBoard(ctx, board);
      event = await store.appendEvent({
        type: 'player_board_changed',
        actor,
        detail: { op: 'linked', from: input.from, to: input.to, fromName: a.name, toName: b.name, ...(input.label ? { label: input.label } : {}) },
        subject: id,
        layer,
        turn: ctx.turn,
      });
    } else if (input.op === 'unlink') {
      const link = board.links.find((l) => l.id === input.id);
      if (!link) fail('not_found', `no line "${input.id}"`);
      layer = link.layer;
      board.links = board.links.filter((l) => l.id !== input.id);
      await saveBoard(ctx, board);
      const [a, b] = await Promise.all([endpointOf(ctx, link.from), endpointOf(ctx, link.to)]);
      event = await store.appendEvent({
        type: 'player_board_changed',
        actor,
        detail: { op: 'unlinked', from: link.from, to: link.to, fromName: a?.name ?? link.from, toName: b?.name ?? link.to },
        subject: link.id,
        layer,
        turn: ctx.turn,
      });
    } else {
      const target = await endpointOf(ctx, input.path);
      if (!target) fail('not_found', `"${input.path}" is not a card on the canvas`);
      layer = target.layer ?? 'map';
      const before = board.tags[input.path] ?? null;
      if (input.tag === null) delete board.tags[input.path];
      else {
        if (before === null && Object.keys(board.tags).length >= PLAYER_NOTE_LIMITS.tags) fail('invalid_argument', `the board already holds ${PLAYER_NOTE_LIMITS.tags} marks`);
        board.tags[input.path] = input.tag;
      }
      if (before !== input.tag) {
        await saveBoard(ctx, board);
        event = await store.appendEvent({
          type: 'player_board_changed',
          actor,
          detail: input.tag === null
            ? { op: 'untagged', path: input.path, name: target.name, ...(before ? { tag: before } : {}) }
            : { op: 'tagged', path: input.path, name: target.name, tag: input.tag },
          subject: input.path,
          layer,
          turn: ctx.turn,
        });
      }
    }

    return {
      text: 'The player updated their clue board.',
      details: { op: input.op, layer, board: await playerBoardForLayer(ctx.store, layer, board), changed: event !== null, ...(event ? { event } : {}) },
    };
  });
}

/** The board as one page shows it: its lines, and the marks on cards that are on it. */
export async function playerBoardForLayer(
  store: ActionContext['store'],
  layer: string,
  known?: PlayerBoard,
): Promise<{ links: PlayerLink[]; tags: Record<string, PlayerTag> }> {
  const board = known ?? (await readPlayerBoard(store));
  const links = board.links.filter((l) => l.layer === layer);
  const dir = dirOfLayer(layer);
  const tags: Record<string, PlayerTag> = {};
  for (const [path, tag] of Object.entries(board.tags)) {
    // Characters travel; their mark goes with them. Cards: this page's own and its doors.
    if (CHARACTER_ENDPOINT.test(path) || dirOf(path) === dir || (path.endsWith('/README.md') && dirOf(dirOf(path)) === dir)) tags[path] = tag;
  }
  return { links, tags };
}
