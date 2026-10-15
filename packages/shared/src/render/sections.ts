/**
 * The section table for the per-turn state block. One section =
 * one collector; `collect` returns `null` when the section is absent, and a
 * section's `text` is self-contained — it carries its OWN label line, because
 * `renderState` prints `text` verbatim and never prints `title` (02 §2.1,
 * agreed with 01 on 2026-09-12).
 *
 * The tables' KEY ORDER is the render order (02 §3.5). `next_step` is in no
 * table: 01 appends it after `dynamics` (00 §8).
 *
 * Fail-soft lives one level up: a collector may throw, and 01's
 * `collectSections` turns a throw into a missing section (00 §11 layer 1).
 */
import type { Actor } from '../actions/actor.js';
import { readLayerName, resolveHome } from '../actions/presence.js';
import { listBackpack, type BagItem } from '../actions/backpack.js';
import { cardsOfLayer, dirOfLayer } from '../store/layers.js';
import { isPlayerNotePath, CHARACTER_ENDPOINT } from '../rules/player-notes.js';
import { readPlayerBoard, playerBoardForLayer } from '../actions/player-notes.js';
import { readLoopStatus } from '../actions/loop.js';
import { tickPageMoves } from '../actions/tick.js';
import { entityName } from '../rules/interactive.js';
import { displayItemOf } from '../rules/html-item.js';
import { sanitiseForBlock } from './sanitise.js';
import {
  basenameOf,
  kindWordOf,
  leadingTitleOf,
  plainExcerpt,
  summaryOf,
  SUMMARY_CAP,
} from './layer-page.js';
import { castLine, presencePhrase, type Anchor } from './spatial.js';
import type { Section } from './state.js';
import type { SectionDeps } from '../inject/collect.js';

/**
 * 00 §3.1's closed key set; frozen — tests and logs assert on it (02 §2.2).
 */
export type SectionKey =
  | 'viewpoint'
  | 'layer_files'
  | 'cast'
  | 'bag'
  | 'recent_chalk'
  | 'dynamics'
  | 'standing'
  | 'player_board'
  | 'page_moves'
  | 'loop';

/** Item caps are configuration, not literals (00 §4.2). Changing one means changing 00 §4.2's table too. */
export interface SectionCaps {
  layerFiles: number; // 12
  bag: number; // 12
  cast: number; // 8
  recentChalk: number; // 8
  dynamics: number; // 12
}
export const SECTION_CAPS: SectionCaps = {
  layerFiles: 12,
  bag: 12,
  cast: 8,
  recentChalk: 8,
  dynamics: 12,
};

/** One section = one collector. `null` = absent — never a "(none)" line (00 §4.3). */
export interface SectionSpec {
  key: SectionKey;
  /** The bare label the collector writes into `text`; see 02 §3's exact outputs. */
  title: string;
  collect: (deps: SectionDeps) => Promise<Section | null>;
}

// --------------------------------------------------------------- ordering (02 §3.4)

/**
 * The leading integer of a filename (`02-counter.md` -> 2); null when the name
 * carries none. Board writing is conventionally `NN-title.md` (doc-05 §8.5:
 * the ordinal IS the time order), but the shipped templates do not use it, so
 * in practice this returns null and the code-point tie-break decides (02 §3.4).
 */
export function ordinalOf(path: string): number | null {
  const base = basenameOf(path);
  const m = base.match(/^(\d+)[-_]/);
  return m ? Number(m[1]) : null;
}

/**
 * Stable, locale-independent card order: ordinals first, ascending; then
 * everything unordered, by code point. NOT `localeCompare` — ICU data differs
 * across processes (server vs agent), and a list that reorders per process is
 * untestable and makes `items` jitter (02 §3.4).
 */
export function compareCards(a: string, b: string): number {
  const oa = ordinalOf(a);
  const ob = ordinalOf(b);
  if (oa !== null && ob !== null && oa !== ob) return oa - ob;
  if (oa !== null && ob === null) return -1;
  if (oa === null && ob !== null) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Pure path order for plain lists (the bag has no time semantics). */
export function comparePaths(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// --------------------------------------------------------------- row renderers (02 §2.3: pure, unit-testable)

/**
 * One `In this layer` / `In the player's bag` row. Paths are world-root
 * relative so they can be handed straight to `look_at`; the separators are the
 * frozen ` — ` (em dash) and ` · ` (middle dot) pair `renderLayerBlock` uses —
 * never a second convention (02 §3 preamble). No body text: a list says what
 * exists, `look_at` shows what it says (00 §7).
 */
export function layerLine(path: string, fm: Record<string, any> | null, body: string): string {
  const summary = sanitiseForBlock(summaryOf(fm, body), { maxLength: 300 });
  const title = sanitiseForBlock(entityName(fm, path), { maxLength: 120 });
  const kind = sanitiseForBlock(kindWordOf(fm, path), { maxLength: 120 });
  return `  ${path} — ${kind} · "${title}"${summary ? ` · ${summary}` : ''}`;
}

/** One `Recent writing` row: path, title, first line (no kind word). */
export function chalkLine(path: string, fm: Record<string, any> | null, body: string): string {
  const title = sanitiseForBlock(entityName(fm, path), { maxLength: 120 });
  const first = leadingTitleOf(body) || plainExcerpt(body);
  const cut = first.length > SUMMARY_CAP ? `${first.slice(0, SUMMARY_CAP).trimEnd()}…` : first;
  const summary = sanitiseForBlock(cut, { maxLength: 300 });
  return `  ${path} — "${title}"${summary ? ` · ${summary}` : ''}`;
}

/** One `bag` row — the backpack item shares the listing shape on purpose (02 §3.1). */
export function bagLine(item: BagItem): string {
  return layerLine(item.path, item.frontmatter, item.body);
}

// --------------------------------------------------------------- collection helpers

/** `…and <N> more`, indented two spaces so it lines up with the rows (02 §3). */
function moreLine(n: number): string {
  return `  …and ${n} more`;
}

/** One markdown object in a layer, with its parsed content. */
interface LayerItem {
  path: string;
  fm: Record<string, any> | null;
  body: string;
}

/** Everything one layer pass yields: the sorted items and the anchor set derived from them. */
interface LayerContent {
  items: LayerItem[];
  anchors: Anchor[];
}

/** Parse one file, degrading to "listed without a summary" when it is unreadable. */
async function readItem(deps: SectionDeps, path: string): Promise<LayerItem> {
  try {
    const raw = await deps.store.readFile(path);
    // H1 / contract §5.3b: the one fetch point. `.html` yields the virtual
    // frontmatter and an EMPTY body, so `layerLine` can never excerpt page source.
    const item = displayItemOf(path, raw);
    return { path, fm: item.frontmatter as Record<string, any> | null, body: item.body };
  } catch {
    // Still a real object in this layer — list it, just without a summary.
    return { path, fm: null, body: '' };
  }
}

/**
 * One pass over a layer at the turn boundary: its sorted cards, their parsed
 * content, and the `presencePhrase` anchor set. Sorted by `compareCards` BEFORE
 * any truncation — `readdir` order is not stable, so "first 12" would otherwise
 * differ per turn and make `items` (and tests) jitter (02 §3.4).
 *
 * Only PLACED cards become anchors, and they reuse this pass's frontmatter — no
 * file is parsed twice. Child-layer doors are deliberately excluded: a door is a
 * scene gate, whose business is `look_at`/`view_canvas` (02 §3.1, §10 note 3).
 */
async function readLayerContent(deps: SectionDeps, layer: string): Promise<LayerContent> {
  // Player notes are the player's, not the scene's: the writer reads them in
  // `player_board`, characters never.
  const paths = cardsOfLayer(layer, await deps.store.listFiles()).filter((p) => !isPlayerNotePath(p)).sort(compareCards);
  const items = await Promise.all(paths.map((path) => readItem(deps, path)));
  const fmByPath = new Map(items.map((i) => [i.path, i.fm]));
  const anchors = deps.store.getLayerCards(paths).map((card) => ({
    path: card.id,
    // `cards` stores the top-left rectangle — exactly what `dirPhrase` wants.
    box: { x: card.x, y: card.y, w: card.w, h: card.h },
    name: entityName(fmByPath.get(card.id) ?? null, card.id),
  }));
  return { items, anchors };
}

/** The shared `layer_files` body for one layer (02 §3.1) — one spec object, reused by both tables. */
async function collectLayerFiles(deps: SectionDeps): Promise<Section | null> {
  const layer = deps.layer;
  if (layer === null) return null;
  const all = (await readLayerContent(deps, layer)).items;
  if (all.length === 0) return null;
  const shown = all.slice(0, deps.caps.layerFiles);
  const lines = [`In this layer (${all.length}):`];
  for (const item of shown) lines.push(layerLine(item.path, item.fm, item.body));
  const hidden = all.length - shown.length;
  if (hidden > 0) lines.push(moreLine(hidden));
  return {
    key: 'layer_files',
    title: 'In this layer',
    text: lines.join('\n'),
    items: all.map((i) => i.path),
  };
}

/** Render one presence list — `Present` (writer) or `Also here` (character). */
async function collectCast(
  deps: SectionDeps,
  opts: { label: string; role: 'writer' | 'character' }
): Promise<Section | null> {
  const layer = deps.layer;
  if (layer === null) return null;
  // `getPresence` is already stably ordered by `character_id` (local-store.ts:1372).
  // The character's own view drops self; the writer's keeps everyone.
  const rows = deps.store
    .getPresence(layer)
    .filter((p) => opts.role === 'writer' || p.characterId !== deps.actor.id);
  if (rows.length === 0) return null;
  const anchors = (await readLayerContent(deps, layer)).anchors;
  const shown = rows.slice(0, deps.caps.cast);
  const lines = [`${opts.label} (${rows.length}):`];
  for (const p of shown) {
    lines.push(
      castLine(p.characterId, { x: p.x, y: p.y }, anchors, {
        following: p.following,
        role: opts.role,
      })
    );
  }
  const hidden = rows.length - shown.length;
  if (hidden > 0) lines.push(moreLine(hidden));
  return {
    key: 'cast',
    title: opts.label,
    text: lines.join('\n'),
    items: rows.map((p) => p.characterId),
  };
}

/**
 * The one shell 02 owns for `dynamics` (02 §3.1/§3.2): label, `  - ` bullets,
 * then the tail at a different indent. `win.lines` is already merged and
 * already capped by 03's `caps.dynamics` — this NEVER truncates a second time,
 * and never reads the event table or a cursor itself.
 */
function dynamicsShell(win: { lines: string[]; tail: string | null }): Section | null {
  if (win.lines.length === 0 && win.tail === null) return null;
  const lines = ['Recently, in the world:'];
  for (const l of win.lines) lines.push(`  - ${l}`);
  if (win.tail) lines.push(`  ${win.tail}`);
  return { key: 'dynamics', title: 'Recently, in the world', text: lines.join('\n') };
}

// --------------------------------------------------------------- writer sections (02 §3.1)

const layerFilesSection: SectionSpec = {
  key: 'layer_files',
  title: 'In this layer',
  collect: collectLayerFiles,
};

const viewpointSection: SectionSpec = {
  key: 'viewpoint',
  title: 'Viewpoint',
  collect: async (deps) => {
    const layer = deps.layer;
    const viewport = deps.viewport;
    // No view row, or no current layer: the whole section is absent (00 §11).
    if (layer === null || viewport === null) return null;

    const name = sanitiseForBlock(await readLayerName(deps.store, layer), { maxLength: 300 });
    const anchors = (await readLayerContent(deps, layer)).anchors;
    // `viewport.focus` is already the decoded view CENTRE (05 §2.3) — the same
    // `{x,y}` semantics as a presence point, so the cast vocabulary renders it
    // with no approximation (02 §3.1, §6). A missing camera degrades to
    // `in view`, which stays self-contained.
    const focus = viewport.focus === null ? null : presencePhrase(viewport.focus, anchors);
    const place = focus === null ? 'in view' : `${focus.dir} "${focus.anchorName}"`;

    const selected = viewport.selected
      .map((p) => sanitiseForBlock(p, { maxLength: 300 }))
      .filter((p) => p !== '');
    const selectedClause =
      selected.length === 0
        ? ''
        : ` The player has selected ${selected.map((p) => `"${p}"`).join(' and ')}.`;

    // The closing sentence is one of 00 §12.4's two sanctioned exceptions: it
    // resolves "this", which only means anything against the current target.
    const text =
      `Viewpoint: the player is in "${name}", ${place}.${selectedClause} ` +
      'When the player says "this", they mean the selected card first, then whatever is in view.';
    return { key: 'viewpoint', title: 'Viewpoint', text, items: [layer] };
  },
};

const castSection: SectionSpec = {
  key: 'cast',
  title: 'Present',
  collect: (deps) => collectCast(deps, { label: 'Present', role: 'writer' }),
};

const bagSection: SectionSpec = {
  key: 'bag',
  title: "In the player's bag",
  collect: async (deps) => {
    const items = (await listBackpack(deps.store)).sort((a, b) => comparePaths(a.path, b.path));
    if (items.length === 0) return null;
    const shown = items.slice(0, deps.caps.bag);
    const lines = [`In the player's bag (${items.length}):`];
    for (const item of shown) lines.push(bagLine(item));
    const hidden = items.length - shown.length;
    if (hidden > 0) lines.push(moreLine(hidden));
    return {
      key: 'bag',
      title: "In the player's bag",
      text: lines.join('\n'),
      items: items.map((i) => i.path),
    };
  },
};

const recentChalkSection: SectionSpec = {
  key: 'recent_chalk',
  title: 'Recent writing',
  collect: async (deps) => {
    // Over-fetch x3: the two filters below drop the files most likely to be
    // recent — `characters/**` (a character's README is not board writing) and
    // every layer's own `README.md` (a layer's config, not a written page).
    const recent = await deps.store.filesByMtime('', deps.caps.recentChalk * 3);
    const picked = recent
      .filter((p) => p.endsWith('.md'))
      .filter((p) => !p.startsWith('characters/'))
      .filter((p) => !isPlayerNotePath(p))
      .filter((p) => basenameOf(p) !== 'README.md')
      .slice(0, deps.caps.recentChalk);
    if (picked.length === 0) return null;
    const lines = [`Recent writing (${picked.length}):`];
    for (const path of picked) {
      const item = await readItem(deps, path);
      lines.push(chalkLine(path, item.fm, item.body));
    }
    // No `…and N more` here: 00 §4.2 defines "over the cap" for this section as
    // "take the latest 8" (02 §3.1, §10 note 2). Deliberately NOT deduplicated
    // against `layer_files` — that would couple the two collectors (02 §3.1).
    return { key: 'recent_chalk', title: 'Recent writing', text: lines.join('\n'), items: picked };
  },
};

const writerDynamicsSection: SectionSpec = {
  key: 'dynamics',
  title: 'Recently, in the world',
  // 01's memoised window; 03 already merged and capped it (02 §2.1).
  collect: async (deps) => dynamicsShell(await deps.eventWindow()),
};

/**
 * `player_board` caps. Kept beside the section rather than in `SectionCaps`
 * (00 §4.2's frozen table): the whole section is additionally hard-capped at
 * `text` characters so a busy board can never crowd out the scene.
 */
export const PLAYER_BOARD_CAPS = { notes: 6, links: 6, tags: 8, noteChars: 120, text: 1600 } as const;

const TAG_WORD: Record<string, string> = { suspect: 'suspicious', confirmed: 'confirmed', irrelevant: 'irrelevant' };

/** The player's sticky notes, clue-board lines and marks on the current page. */
async function collectPlayerBoard(deps: SectionDeps): Promise<Section | null> {
  const layer = deps.layer;
  if (layer === null) return null;
  const dir = dirOfLayer(layer);
  const notePaths = (await deps.store.listFiles(dir))
    .filter((p) => isPlayerNotePath(p) && p.slice(0, p.lastIndexOf('/')) === dir)
    .sort(compareCards);
  const board = await playerBoardForLayer(deps.store, layer, await readPlayerBoard(deps.store));
  const tagged = Object.entries(board.tags);
  if (notePaths.length === 0 && board.links.length === 0 && tagged.length === 0) return null;

  const names = new Map<string, string>();
  const nameOf = async (path: string): Promise<string> => {
    if (!names.has(path)) {
      const ch = CHARACTER_ENDPOINT.exec(path);
      if (ch) names.set(path, ch[1]);
      else {
        const item = await readItem(deps, path);
        names.set(path, entityName(item.fm, path));
      }
    }
    return sanitiseForBlock(names.get(path)!, { maxLength: 80 });
  };

  const lines = ["Player's notes & deductions (the player's own; react to them, never edit them, never confirm a guess just because they made it):"];
  if (notePaths.length > 0) {
    lines.push(`  Notes pinned here (${notePaths.length}):`);
    for (const path of notePaths.slice(0, PLAYER_BOARD_CAPS.notes)) {
      const item = await readItem(deps, path);
      const flat = item.body.replace(/\s+/g, ' ').trim();
      const cut = flat.length > PLAYER_BOARD_CAPS.noteChars ? `${flat.slice(0, PLAYER_BOARD_CAPS.noteChars).trimEnd()}…` : flat;
      lines.push(`    ${path} · "${sanitiseForBlock(cut, { maxLength: 200 })}"`);
    }
    if (notePaths.length > PLAYER_BOARD_CAPS.notes) lines.push(`    …and ${notePaths.length - PLAYER_BOARD_CAPS.notes} more`);
  }
  if (board.links.length > 0) {
    lines.push(`  Lines they drew (${board.links.length}):`);
    for (const link of board.links.slice(-PLAYER_BOARD_CAPS.links)) {
      const label = link.label ? ` · "${sanitiseForBlock(link.label, { maxLength: 40 })}"` : '';
      lines.push(`    "${await nameOf(link.from)}" ↔ "${await nameOf(link.to)}"${label}`);
    }
    if (board.links.length > PLAYER_BOARD_CAPS.links) lines.push(`    …and ${board.links.length - PLAYER_BOARD_CAPS.links} older`);
  }
  if (tagged.length > 0) {
    lines.push(`  Marks (${tagged.length}):`);
    for (const [path, tag] of tagged.slice(0, PLAYER_BOARD_CAPS.tags)) {
      lines.push(`    "${await nameOf(path)}" — ${TAG_WORD[tag] ?? tag}`);
    }
    if (tagged.length > PLAYER_BOARD_CAPS.tags) lines.push(`    …and ${tagged.length - PLAYER_BOARD_CAPS.tags} more`);
  }
  let text = lines.join('\n');
  if (text.length > PLAYER_BOARD_CAPS.text) text = `${text.slice(0, PLAYER_BOARD_CAPS.text - 1).trimEnd()}…`;
  return {
    key: 'player_board',
    title: "Player's notes & deductions",
    text,
    items: [...notePaths, ...board.links.map((l) => l.id), ...tagged.map(([p]) => p)],
  };
}

const playerBoardSection: SectionSpec = {
  key: 'player_board',
  title: "Player's notes & deductions",
  collect: collectPlayerBoard,
};

/**
 * Character tick: what the people on this page
 * just did — engine facts, landed or stopped — and the intent showing now, so
 * the writer neither invents moves nor contradicts them. Absent for a world
 * without `tick`, and on a quiet page. Capped at 600 characters.
 */
async function collectPageMoves(deps: SectionDeps): Promise<Section | null> {
  const layer = deps.layer;
  if (layer === null) return null;
  const text = await tickPageMoves(deps.store, layer);
  if (!text) return null;
  return { key: 'page_moves', title: 'On this page', text, items: [layer] };
}

const pageMovesSection: SectionSpec = {
  key: 'page_moves',
  title: 'On this page',
  collect: collectPageMoves,
};

/**
 * A looping world's recap: which loop this is
 * and what the player carried over. The engine writes it; HOW the loop plays
 * (who reacts to what, what varies) is the world's writer skill. Absent for a
 * world without `loop`, and in loop 1 while the player knows nothing yet.
 */
async function collectLoop(deps: SectionDeps): Promise<Section | null> {
  const status = await readLoopStatus(deps.store);
  if (!status || (status.loop <= 1 && status.known.length === 0)) return null;
  const lines = [
    status.loop > 1
      ? `Loop ${status.loop}: the world has reset to its first morning. Every character meets the player for the first time and remembers nothing of earlier loops; only the player remembers.`
      : 'Loop 1: the world will reset to its first morning when this loop ends; only the player will remember.',
  ];
  if (status.known.length > 0) {
    lines.push(`  What the player has learned (theirs to use; a character faced with it cannot pretend not to know):`);
    for (const k of status.known) {
      const label = sanitiseForBlock(k.label, { maxLength: 80 });
      lines.push(`    ${label}${typeof k.value === 'boolean' ? '' : `: ${sanitiseForBlock(String(k.value), { maxLength: 40 })}`}`);
    }
  }
  return { key: 'loop', title: 'Loop', text: lines.join('\n'), items: status.known.map((k) => k.id) };
}

const loopSection: SectionSpec = {
  key: 'loop',
  title: 'Loop',
  collect: collectLoop,
};

// --------------------------------------------------------------- character sections (02 §3.2)

const standingSection: SectionSpec = {
  key: 'standing',
  title: 'Standing',
  collect: async (deps) => {
    const id = deps.actor.id;
    if (!id) return null;

    // A presence row is the truth about where the character stands; `deps.layer`
    // is 01's reflection of the same read, but for a never-placed character 01
    // flattens `resolveHome`'s fallback to `map` and loses `fromHome`. So the
    // judge lives HERE, on the two raw reads (02 §3.2, 评审 A-4).
    const row = deps.store.getPresenceOf(id);
    let layer: string;
    if (row !== null) {
      layer = row.layer;
    } else {
      // `resolveHome` NEVER returns null: it falls back to `map` with
      // `fromHome:false`. `.fromHome` is the honest judge — reading "is a home
      // set" would tell every unplaced character "you are on the world map,
      // right where you belong".
      const home = await resolveHome(deps.store, id);
      if (!home.fromHome) return null;
      layer = home.layer;
    }

    const name = sanitiseForBlock(await readLayerName(deps.store, layer), { maxLength: 300 });
    const anchors = (await readLayerContent(deps, layer)).anchors;
    const here = row === null ? null : presencePhrase({ x: row.x, y: row.y }, anchors);
    const place = here === null ? 'somewhere in this layer' : `${here.dir} "${here.anchorName}"`;

    // Never hardcode "the player is here" (评审 A-5): the character's layer comes
    // from presence, the player's from the viewpoint, and the UI lets the player
    // open any character from anywhere. A missing view counts as elsewhere — a
    // false spatial premise gets written into the character's dialogue as fact.
    const playerClause =
      deps.viewport !== null && deps.viewport.layer === layer
        ? 'The player is here with you.'
        : 'The player is elsewhere right now.';

    return {
      key: 'standing',
      title: 'Standing',
      text: `Standing: you are in "${name}", ${place}. ${playerClause}`,
      items: [layer],
    };
  },
};

const alsoHereSection: SectionSpec = {
  key: 'cast',
  title: 'Also here',
  // Same rows and the same `collectCast` shape as the writer's `cast`, minus
  // self, and without ` · following you` (who trails the player is not a
  // character's business — 02 §3.2).
  collect: (deps) => collectCast(deps, { label: 'Also here', role: 'character' }),
};

// --------------------------------------------------------------- the two tables (02 §2.2)

/**
 * 00 §3.2's table. `layerFilesSection` and `writerDynamicsSection` are the
 * canonical spec objects, so `CHARACTER_SECTIONS` reuses the SAME objects —
 * that makes "shares with the writer" (00 §3.3) structural rather than two
 * wordings kept in sync by hand (02 §3.2).
 */
export const WRITER_SECTIONS: readonly SectionSpec[] = [
  viewpointSection,
  layerFilesSection,
  castSection,
  bagSection,
  recentChalkSection,
  playerBoardSection,
  pageMovesSection,
  loopSection,
  writerDynamicsSection,
];

/** 00 §3.3's table: `standing` replaces `viewpoint`; no `bag`; `cast` excludes self. */
export const CHARACTER_SECTIONS: readonly SectionSpec[] = [
  standingSection,
  layerFilesSection,
  alsoHereSection,
  writerDynamicsSection,
];

/** The table for `actor`; 06 wires this to `AIRP_AGENT_ROLE` (00 §3.3). */
export function sectionsFor(actor: Actor): readonly SectionSpec[] {
  return actor.type === 'character' ? CHARACTER_SECTIONS : WRITER_SECTIONS;
}
