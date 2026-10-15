/**
 * board-model.ts — the map of one layer, as data.
 *
 * Map mode shows every layer as a PLACE: a generated 2D board at the layer's
 * own scale, with the layer's files turned into things on it — child layers
 * are places you walk into, characters are tokens, letters and objects are
 * pieces you can pick up. This module decides WHAT is on the board and WHERE;
 * `components/board/Board.tsx` only draws it.
 *
 * Pure and deterministic: the same world, layer and contents always give the
 * same board, so a player who learned where the lighthouse is finds it there
 * again. P1 lays everything out procedurally; painting it with an image model
 * is P2 and changes none of these positions.
 */

/** How close the board is. Declared per layer; see `boardKind`. */
export type BoardKind = 'region' | 'town' | 'interior' | 'detail';

export const BOARD_KINDS: readonly BoardKind[] = ['region', 'town', 'interior', 'detail'];

/** Board edge in tiles. Small on purpose: a layer holds a handful of things. */
export const BOARD_SIZE = 12;

export type TileKind = 'grass' | 'water' | 'road' | 'plaza' | 'floor' | 'wall' | 'rug' | 'shelf' | 'back';

export type PieceKind = 'place' | 'item' | 'character' | 'player' | 'exit';

export interface BoardPiece {
  kind: PieceKind;
  /** Stable key: a path, a character id, or `player` / `exit`. */
  id: string;
  label: string;
  /** Top-left tile of the footprint. */
  gx: number;
  gy: number;
  /** Footprint in tiles (places can be 2×2). */
  w: number;
  h: number;
  /** For a place: the layer to enter. For an item: its path. For a character: its id. For exit: the parent layer. */
  ref: string;
  /** A place whose door wants something the player does not carry yet. */
  locked?: boolean;
  /** A character's portrait, when the world ships one. */
  avatar?: string;
  /** An item's card type (`letter`, `note`, …), which picks its glyph. */
  itemType?: string;
}

export interface Board {
  kind: BoardKind;
  size: number;
  /** Row-major, `size × size`. */
  tiles: TileKind[];
  pieces: BoardPiece[];
  /** The newest line of narration on this layer, shown above the board. */
  narration: string | null;
}

/** What the board is built from — the same data the canvas shows. */
export interface BoardInput {
  worldId: string;
  layerId: string;
  /** The layer README's frontmatter; `map.kind` lives here. */
  readme: Record<string, unknown> | null | undefined;
  /** Every card on the layer. */
  items: readonly { path: string; kind?: string; frontmatter?: Record<string, any> | null; body?: string }[];
  /**
   * Characters. Those `here` stand on this layer; the others carry the layer
   * they are on, and a picture map shows them beside the place that leads there.
   */
  characters: readonly { id: string; name: string; avatar?: string; layer?: string | null; here?: boolean }[];
  /** The way out, or null at the top of the world. */
  parent: { id: string; name: string } | null;
}

// ---------------------------------------------------------------------------
// Deterministic helpers

/** FNV-1a, 32-bit. Stable across platforms, which `Math.random` is not. */
export function hashOf(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Give each id a slot from `candidates`, the same slot every time.
 *
 * An id starts at the slot its own hash names and walks forward to the first
 * free one. Ids are processed in hash order, not input order, so the answer
 * does not depend on how the layer happened to list its files; and adding a
 * new thing only ever moves something it directly collides with.
 */
export function assignSlots<T>(ids: readonly string[], candidates: readonly T[], seed: string): Map<string, T> {
  const out = new Map<string, T>();
  if (candidates.length === 0) return out;
  const taken = new Set<number>();
  const ordered = [...new Set(ids)].sort((a, b) => hashOf(`${seed}:${a}`) - hashOf(`${seed}:${b}`) || a.localeCompare(b));
  for (const id of ordered) {
    if (taken.size >= candidates.length) break;
    let slot = hashOf(`${seed}:${id}`) % candidates.length;
    while (taken.has(slot)) slot = (slot + 1) % candidates.length;
    taken.add(slot);
    out.set(id, candidates[slot]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reading the layer

const CARD_TYPE = (item: BoardInput['items'][number]): string =>
  String(item.frontmatter?.type ?? item.kind ?? '').toLowerCase();

function isGate(item: BoardInput['items'][number]): boolean {
  return CARD_TYPE(item) === 'gate' || item.kind === 'gate';
}

function isChalk(item: BoardInput['items'][number]): boolean {
  return CARD_TYPE(item) === 'chalk';
}

function isScenery(item: BoardInput['items'][number]): boolean {
  const type = CARD_TYPE(item);
  return type === 'portrait' || type === 'sprite' || type === 'readme' || item.kind === 'portrait';
}

function titleOf(item: BoardInput['items'][number]): string {
  const fm = item.frontmatter ?? {};
  const name = fm.title ?? fm.name;
  if (typeof name === 'string' && name.trim()) return name.trim();
  return (item.path.split('/').pop() ?? item.path).replace(/\.md$/, '');
}

/** Where a gate card leads: its `target`, else the directory it is the README of. */
function gateTarget(item: BoardInput['items'][number]): string {
  const target = item.frontmatter?.target;
  if (typeof target === 'string' && target.trim()) return target.trim();
  return item.path.replace(/\/README\.md$/, '');
}

/**
 * The layer's scale. The author declares it (`map: { kind: town }` in the
 * layer README) because depth says nothing: a world may start in a room and
 * step out into a whole harbour. Without a declaration: a layer that is mostly
 * doors is a town; a layer with things and no doors is a room.
 */
export function boardKind(readme: BoardInput['readme'], doors: number, things: number): BoardKind {
  const map = readme?.map;
  const declared = map && typeof map === 'object' ? (map as { kind?: unknown }).kind : undefined;
  if (typeof declared === 'string' && (BOARD_KINDS as readonly string[]).includes(declared)) return declared as BoardKind;
  if (doors >= 2 && doors >= things) return 'town';
  return 'interior';
}

// ---------------------------------------------------------------------------
// The four layouts. Each returns the tiles and the candidate slots per piece
// kind; `buildBoard` then drops the layer's contents into those slots.

interface Layout {
  tiles: TileKind[];
  places: { gx: number; gy: number; w: number; h: number }[];
  items: { gx: number; gy: number }[];
  characters: { gx: number; gy: number }[];
  player: { gx: number; gy: number };
  exit: { gx: number; gy: number };
}

const N = BOARD_SIZE;
const idx = (x: number, y: number) => y * N + x;

function townLayout(): Layout {
  const tiles: TileKind[] = Array(N * N).fill('grass');
  const roads = [3, 8];
  for (let y = 0; y < N; y += 1) for (let x = 0; x < N; x += 1) {
    if (roads.includes(x) || roads.includes(y)) tiles[idx(x, y)] = 'road';
    if (x >= 4 && x <= 7 && y >= 4 && y <= 7) tiles[idx(x, y)] = 'plaza';
  }
  // 2×2 building plots in the blocks between the roads, the central block kept as a plaza.
  const anchors = [0, 4, 6, 9];
  const places = anchors.flatMap(gy => anchors.map(gx => ({ gx, gy, w: 2, h: 2 })))
    .filter(p => !(p.gx >= 4 && p.gx <= 6 && p.gy >= 4 && p.gy <= 6));
  // Things lie on the plaza's rim; people stand in it.
  const items = [[4, 4], [7, 4], [4, 7], [7, 7], [5, 4], [4, 6], [7, 5], [6, 7]].map(([gx, gy]) => ({ gx, gy }));
  const characters = [[5, 5], [6, 5], [5, 6], [6, 6]].map(([gx, gy]) => ({ gx, gy }));
  return { tiles, places, items, characters, player: { gx: 5, gy: 8 }, exit: { gx: 3, gy: 11 } };
}

function interiorLayout(): Layout {
  const tiles: TileKind[] = Array(N * N).fill('floor');
  for (let y = 0; y < N; y += 1) for (let x = 0; x < N; x += 1) {
    if (x === 0 || y === 0 || x === N - 1 || y === N - 1) tiles[idx(x, y)] = 'wall';
    else if (x >= 4 && x <= 7 && y >= 4 && y <= 7) tiles[idx(x, y)] = 'rug';
  }
  // Doors sit in the back and side walls; the front wall (y = N-1) is the way out.
  const places = [
    [2, 0], [5, 0], [8, 0], [0, 3], [0, 7], [N - 1, 3], [N - 1, 7], [2, 0],
  ].filter((v, i, all) => all.findIndex(o => o[0] === v[0] && o[1] === v[1]) === i)
    .map(([gx, gy]) => ({ gx, gy, w: 1, h: 1 }));
  // Furniture and objects ring the rug.
  const items = [[2, 2], [9, 2], [2, 9], [9, 9], [5, 2], [2, 5], [9, 5], [5, 9], [7, 2], [2, 7]]
    .map(([gx, gy]) => ({ gx, gy }));
  const characters = [[5, 5], [6, 5], [5, 6], [6, 6]].map(([gx, gy]) => ({ gx, gy }));
  return { tiles, places, items, characters, player: { gx: 6, gy: 8 }, exit: { gx: 6, gy: N - 1 } };
}

function regionLayout(seed: string): Layout {
  const tiles: TileKind[] = Array(N * N).fill('grass');
  // A coast along one edge, chosen by the seed, so regions do not all look alike.
  const coast = hashOf(`${seed}:coast`) % 4;
  for (let y = 0; y < N; y += 1) for (let x = 0; x < N; x += 1) {
    const d = [y, N - 1 - x, N - 1 - y, x][coast];
    const wobble = hashOf(`${seed}:${x}:${y}`) % 2;
    if (d + wobble < 2) tiles[idx(x, y)] = 'water';
  }
  const lattice = [2, 5, 8];
  const places = lattice.flatMap(gy => lattice.map(gx => ({ gx, gy, w: 2, h: 2 })))
    .filter(p => !(p.gx === 5 && p.gy === 5))
    .filter(p => tiles[idx(p.gx, p.gy)] !== 'water' && tiles[idx(p.gx + 1, p.gy + 1)] !== 'water');
  const items = [[5, 5], [6, 5], [5, 6], [6, 6]].map(([gx, gy]) => ({ gx, gy }));
  const characters = [[5, 7], [6, 7], [4, 6], [7, 6]].map(([gx, gy]) => ({ gx, gy }));
  // Landmarks cover rows 2-3, 5-6 and 8-9; the player starts on the road below them.
  return { tiles, places, items, characters, player: { gx: 4, gy: 10 }, exit: { gx: 6, gy: N - 1 } };
}

function detailLayout(): Layout {
  const tiles: TileKind[] = Array(N * N).fill('back');
  // A cabinet seen from the front-top: three rows of three compartments.
  const cells = [1, 4, 7];
  for (const cy of cells) for (const cx of cells) {
    for (let y = cy; y < cy + 3 && y < N; y += 1) for (let x = cx; x < cx + 3 && x < N; x += 1) tiles[idx(x, y)] = 'shelf';
  }
  const places = cells.flatMap(gy => cells.map(gx => ({ gx: gx + 1, gy: gy + 1, w: 1, h: 1 })));
  const items = cells.flatMap(gy => cells.map(gx => ({ gx, gy: gy + 2 })));
  const characters = [[10, 10], [10, 9]].map(([gx, gy]) => ({ gx, gy }));
  return { tiles, places, items, characters, player: { gx: 10, gy: 11 }, exit: { gx: 5, gy: N - 1 } };
}

function layoutFor(kind: BoardKind, seed: string): Layout {
  if (kind === 'town') return townLayout();
  if (kind === 'region') return regionLayout(seed);
  if (kind === 'detail') return detailLayout();
  return interiorLayout();
}

// ---------------------------------------------------------------------------

/** The newest narration on the layer: the last chalk in file order, first paragraph. */
function narrationOf(items: BoardInput['items']): string | null {
  const chalks = items.filter(isChalk).sort((a, b) => a.path.localeCompare(b.path));
  const last = chalks[chalks.length - 1];
  const text = (last?.body ?? '').trim().split(/\n\s*\n/)[0]?.trim();
  return text ? text : null;
}

/** The paths a door asks the player to carry (`requires.items`). */
export function doorRequires(item: BoardInput['items'][number]): string[] {
  const items = item.frontmatter?.requires?.items;
  return Array.isArray(items) ? items.filter((entry: unknown): entry is string => typeof entry === 'string') : [];
}

/**
 * The board for one layer. `carried` is what the player holds: a door that
 * asks for something not in it is drawn locked — but still clickable, because
 * the door's own refusal is what tells the player what is missing.
 */
export function buildBoard(input: BoardInput, carried: ReadonlySet<string> = new Set()): Board {
  const gates = input.items.filter(isGate);
  const things = input.items.filter(item => !isGate(item) && !isChalk(item) && !isScenery(item));
  const kind = boardKind(input.readme, gates.length, things.length);
  const seed = `${input.worldId}:${input.layerId}`;
  const layout = layoutFor(kind, seed);
  const pieces: BoardPiece[] = [];

  const placeSlots = assignSlots(gates.map(gate => gate.path), layout.places, `${seed}:places`);
  for (const gate of gates) {
    const slot = placeSlots.get(gate.path);
    if (!slot) continue;
    const target = gateTarget(gate);
    const locked = doorRequires(gate).some(path => !carried.has(path));
    pieces.push({ kind: 'place', id: gate.path, label: titleOf(gate), ...slot, ref: target, locked });
  }

  const itemSlots = assignSlots(things.map(item => item.path), layout.items, `${seed}:items`);
  for (const item of things) {
    const slot = itemSlots.get(item.path);
    if (!slot) continue;
    pieces.push({ kind: 'item', id: item.path, label: titleOf(item), ...slot, w: 1, h: 1, ref: item.path, itemType: CARD_TYPE(item) });
  }

  const present = input.characters.filter(c => c.here !== false);
  const characterSlots = assignSlots(present.map(c => c.id), layout.characters, `${seed}:characters`);
  for (const character of present) {
    const slot = characterSlots.get(character.id);
    if (!slot) continue;
    pieces.push({ kind: 'character', id: character.id, label: character.name, ...slot, w: 1, h: 1, ref: character.id, avatar: character.avatar });
  }

  pieces.push({ kind: 'player', id: 'player', label: '', ...layout.player, w: 1, h: 1, ref: '' });
  if (input.parent) {
    pieces.push({ kind: 'exit', id: 'exit', label: input.parent.name, ...layout.exit, w: 1, h: 1, ref: input.parent.id });
  }

  return { kind, size: N, tiles: layout.tiles, pieces, narration: narrationOf(input.items) };
}

// ---------------------------------------------------------------------------
// Pins on a real picture
//
//
// Most layers already ship a scene image, and many of them ARE maps — 雾坞镇's
// harbour image was `map.png` in the source repository. So when a layer has
// an image, map mode shows that image and puts the places ON it, where they
// are drawn. The procedural board above is only the fallback for a layer with
// no picture at all.

/**
 * What a pin on the picture is. Beyond the board's pieces, a picture map has
 * two kinds of its own
 * a `note` is a piece of narration
 * (a chalk card) as a paper slip you can open and read, and a `dice` is a chalk
 * that asks for a roll.
 */
export type MapPinKind = PieceKind | 'note' | 'dice' | 'npc';

/** A clickable thing on the picture, at a fraction of its width and height. */
export interface MapPin {
  kind: MapPinKind;
  id: string;
  label: string;
  /** 0–1 across the image, 0–1 down it. */
  x: number;
  y: number;
  ref: string;
  locked?: boolean;
  avatar?: string;
  itemType?: string;
  /** What hovering it shows: the place's or the object's own text. */
  detail?: string;
  /** A locked door's own words about what it needs. */
  blocked?: string;
  /** A character who is not here but inside the place this pin stands beside. */
  away?: boolean;
  /** An item the author marked `portable: false`: it can be read, not taken. */
  portable?: boolean;
}

export interface PinnedMap {
  pins: MapPin[];
  narration: string | null;
  /** Every piece of narration on the layer, oldest first: the story so far. */
  story: { title: string; text: string }[];
}

type Point2 = readonly [number, number];

/**
 * Where the author says things are on this layer's picture:
 *
 *   map:
 *     pins:
 *       old-lighthouse: [0.22, 0.27]   # a child layer, by folder name
 *       player: [0.16, 0.88]
 *
 * Read from the layer README. Anything malformed is ignored rather than
 * trusted: a pin outside the picture is not a pin.
 */
export function declaredPins(readme: BoardInput['readme']): Map<string, Point2> {
  const out = new Map<string, Point2>();
  const map = readme?.map;
  const pins = map && typeof map === 'object' ? (map as { pins?: unknown }).pins : undefined;
  if (!pins || typeof pins !== 'object') return out;
  for (const [key, value] of Object.entries(pins as Record<string, unknown>)) {
    if (!Array.isArray(value) || value.length !== 2) continue;
    const [x, y] = value.map(Number);
    if (Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= 1 && y >= 0 && y <= 1) out.set(key, [x, y]);
  }
  return out;
}

/**
 * The layer's drawn MAP, when the author planned one
 * The scene picture is where you stand; the
 * plan is the place seen from above — an overworld, a town, a floor plan — with
 * its own pins, because the same door sits somewhere else on each picture.
 *
 *   map:
 *     plan:
 *       picture: assets/maps/harbor-chart.webp
 *       pins: { old-lighthouse: [0.2, 0.22], ... }
 *
 * `picture` (not `image`) on purpose: the plan is written before the picture is
 * generated, and the world checker requires every `image` to exist already.
 * Returns the picture path and a readme whose `map.pins` are the plan's, so the
 * rest of the model reads pins one way whichever picture is showing.
 */
export function mapPlan(readme: BoardInput['readme']): { picture: string; readme: Record<string, unknown> } | null {
  const map = readme?.map;
  const plan = map && typeof map === 'object' ? (map as { plan?: unknown }).plan : undefined;
  if (!plan || typeof plan !== 'object') return null;
  const { picture, pins } = plan as { picture?: unknown; pins?: unknown };
  if (typeof picture !== 'string' || !/^assets\/[\w./-]+\.(webp|png|jpe?g)$/i.test(picture) || picture.includes('..')) return null;
  return { picture, readme: { ...readme, map: { ...(map as object), pins: pins ?? {} } } };
}

/** The folder a gate leads into — the name `map.pins` uses for it. */
function folderOf(target: string): string {
  return target.split('/').filter(Boolean).pop() ?? target;
}

/** First paragraph of a card's text, for a hover panel. */
function firstParagraph(body: string | undefined): string | undefined {
  const text = (body ?? '').trim().split(/\n\s*\n/)[0]?.trim();
  return text ? text : undefined;
}

/** The layer id a directory path belongs to (the root's directory is `world`). */
function baseOf(layerId: string): string {
  return layerId === 'map' ? 'world' : layerId.replace(/\/+$/, '');
}

/** Fallback spots, kept away from the edges and the caption. */
const PLACE_SPOTS: Point2[] = [
  [0.28, 0.4], [0.5, 0.36], [0.72, 0.4], [0.24, 0.62], [0.5, 0.58], [0.76, 0.62], [0.36, 0.78], [0.64, 0.78],
];
const CHARACTER_SPOTS: Point2[] = [[0.42, 0.86], [0.52, 0.88], [0.62, 0.86], [0.32, 0.88]];
const ITEM_SPOTS: Point2[] = [[0.18, 0.72], [0.82, 0.72], [0.14, 0.52], [0.86, 0.52], [0.3, 0.9], [0.7, 0.9]];
/**
 * Where narration slips fall when the author did not pin them: a lattice over
 * the picture, minus whatever is already too close to another pin. Offset from
 * the place/item spots so the two families interleave instead of colliding.
 */
const NOTE_LATTICE: Point2[] = [0.1, 0.26, 0.42, 0.58, 0.74, 0.9].flatMap(x => [0.2, 0.34, 0.48, 0.66, 0.8].map(y => [x, y] as Point2));
/** Closer than this (in picture fractions) and two pins read as one. */
const PIN_CLEARANCE = 0.07;

/** A chalk that asks for a roll (`roll_dice`), drawn as a die rather than a slip. */
function asksForDice(item: BoardInput['items'][number]): boolean {
  const dice = item.frontmatter?.roll_dice;
  return !!dice && typeof dice === 'object';
}

/** The stem a file is pinned by in `map.pins`: `02-two-wakes.md` → `02-two-wakes`. */
function stemOf(path: string): string {
  return folderOf(path.replace(/\.md$/, ''));
}

/**
 * The pins for a layer that has a picture. Places the author pinned sit where
 * they said; the rest take fallback spots, deterministically, so an unpinned
 * layer is still usable and still the same every visit.
 */
export function pinMap(input: BoardInput, carried: ReadonlySet<string> = new Set()): PinnedMap {
  const declared = declaredPins(input.readme);
  const seed = `${input.worldId}:${input.layerId}`;
  const pins: MapPin[] = [];

  const gates = input.items.filter(isGate);
  const unpinned = gates.filter(gate => !declared.has(folderOf(gateTarget(gate))));
  const fallback = assignSlots(unpinned.map(gate => gate.path), PLACE_SPOTS, `${seed}:pins`);
  for (const gate of gates) {
    const target = gateTarget(gate);
    const at = declared.get(folderOf(target)) ?? fallback.get(gate.path);
    if (!at) continue;
    const blocked = gate.frontmatter?.blocked;
    pins.push({
      kind: 'place', id: gate.path, label: titleOf(gate), x: at[0], y: at[1], ref: target,
      locked: doorRequires(gate).some(path => !carried.has(path)),
      detail: firstParagraph(gate.body),
      blocked: typeof blocked === 'string' && blocked.trim() ? blocked.trim() : undefined,
    });
  }

  const things = input.items.filter(item => !isGate(item) && !isChalk(item) && !isScenery(item));
  const itemSpots = assignSlots(things.map(item => item.path), ITEM_SPOTS, `${seed}:item-pins`);
  for (const item of things) {
    const at = declared.get(stemOf(item.path)) ?? itemSpots.get(item.path);
    if (!at) continue;
    // An NPC card is someone to talk to: its own pin
    // kind, a portrait when the card has one, else its initial.
    if (CARD_TYPE(item) === 'npc') {
      const avatar = item.frontmatter?.avatar;
      pins.push({
        kind: 'npc', id: item.path, label: titleOf(item), x: at[0], y: at[1], ref: item.path, itemType: 'npc',
        detail: firstParagraph(item.body), portable: false,
        ...(typeof avatar === 'string' && avatar.trim() ? { avatar: avatar.trim() } : {}),
      });
      continue;
    }
    pins.push({
      kind: 'item', id: item.path, label: titleOf(item), x: at[0], y: at[1], ref: item.path, itemType: CARD_TYPE(item), detail: firstParagraph(item.body),
      portable: item.frontmatter?.portable !== false,
    });
  }

  // People are placed where they ARE
  // Someone on this layer stands at their declared pin, else a spot of
  // their own. Someone inside one of this layer's places stands beside that
  // place's pin — on 雾坞镇's harbour map, 老莫 by the lighthouse — and clicking
  // them goes there. Anyone further away is not on this map.
  const here = input.characters.filter(c => c.here !== false);
  const people = assignSlots(here.map(c => c.id), CHARACTER_SPOTS, `${seed}:character-pins`);
  for (const character of here) {
    const at = declared.get(character.id) ?? people.get(character.id);
    if (!at) continue;
    pins.push({ kind: 'character', id: character.id, label: character.name, x: at[0], y: at[1], ref: character.id, avatar: character.avatar });
  }
  const base = baseOf(input.layerId);
  const placePins = pins.filter(pin => pin.kind === 'place');
  const besideCount = new Map<string, number>();
  for (const character of input.characters.filter(c => c.here === false && typeof c.layer === 'string')) {
    const layer = baseOf(character.layer as string);
    if (!layer.startsWith(`${base}/`)) continue;
    const child = `${base}/${layer.slice(base.length + 1).split('/')[0]}`;
    const place = placePins.find(pin => baseOf(pin.ref) === child);
    if (!place) continue;
    const n = besideCount.get(place.id) ?? 0;
    besideCount.set(place.id, n + 1);
    // Beside the place, fanned to the right so two people never stack.
    const x = Math.min(0.97, place.x + 0.045 + n * 0.04);
    const y = Math.max(0.03, place.y - 0.07);
    pins.push({
      kind: 'character', id: character.id, label: character.name, x, y, ref: character.id,
      avatar: character.avatar, away: true, detail: place.label,
    });
  }

  const player = declared.get('player');
  if (player) pins.push({ kind: 'player', id: 'player', label: '', x: player[0], y: player[1], ref: '' });

  // New text is a thing on the map too: every chalk is a paper slip (or a die,
  // when it asks for a roll) that opens the same reader the canvas card does.
  // Pinned by file stem when the author says where; otherwise a lattice spot
  // clear of every pin placed so far — the same spot every visit.
  const chalks = input.items.filter(isChalk);
  const free = NOTE_LATTICE.filter(([x, y]) => pins.every(pin => Math.hypot(pin.x - x, pin.y - y) >= PIN_CLEARANCE));
  const noteSpots = assignSlots(chalks.filter(chalk => !declared.has(stemOf(chalk.path))).map(chalk => chalk.path), free, `${seed}:note-pins`);
  for (const chalk of chalks) {
    const at = declared.get(stemOf(chalk.path)) ?? noteSpots.get(chalk.path);
    if (!at) continue;
    pins.push({
      kind: asksForDice(chalk) ? 'dice' : 'note', id: chalk.path, label: titleOf(chalk), x: at[0], y: at[1], ref: chalk.path,
      itemType: 'chalk', detail: firstParagraph(chalk.body), portable: false,
    });
  }

  // The way out is not a spot on the picture; the board draws it in a corner.
  const story = input.items.filter(isChalk)
    .sort((a, b) => a.path.localeCompare(b.path))
    .map(chalk => ({ title: titleOf(chalk), text: (chalk.body ?? '').trim() }))
    .filter(entry => entry.text);
  return { pins, narration: narrationOf(input.items), story };
}
