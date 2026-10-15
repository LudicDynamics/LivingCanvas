/**
 * The layer-page text renderer (doc-03 §4.2 / §5.4). Pure functions only: given
 * parsed content and card boxes, produce the directory block and the view_canvas
 * composition summary. All I/O stays in `actions/look-at.ts`.
 *
 * The one thing this module MUST NOT do is re-derive which files belong to a
 * layer: `cardsOfLayer` / `childLayers` (store/layers.ts) already own that
 * question, and `GET /api/layer` reads the same pair. A second derivation would
 * be exactly the "two sources" split doc-03 §4.3 warns about.
 */
import { cardKindOf } from '../schemas/forms.js';
import { entityName } from '../rules/interactive.js';
import { boxesOverlap, dirPhrase, nearestNeighbours, type Box } from './spatial.js';

/** doc-03 §5.4: body text is cut at 4000 chars per entity. */
export const BODY_CAP = 4000;
/** doc-03 §4.2 rule 7: list summaries are cut at 90 chars. */
export const SUMMARY_CAP = 90;

/** doc-03 §4.2 rule 6 — the kind words the reader sees, not the internal kinds. */
const KIND_WORD: Record<string, string> = {
  chalk: 'narration',
  gate: 'scene door',
  letter: 'letter',
  note: 'note',
  sprite: 'presence',
  // H1 / contract §6.5: a `.html` card is a live web page, not a file.
  html: 'web page',
  default: 'file',
};

/**
 * The leading title line of a body, if the body opens with one.
 * Mirrors `apps/web/src/lib/md.ts` `leadingTitleOf` (doc-03 §5.4) — same regex,
 * borrowed for matching only. Naming rights stay with `entityName`.
 */
export function leadingTitleOf(body: string | null | undefined): string {
  const text = String(body ?? '').trim();
  const match = text.match(/^<b>([\s\S]*?)<\/b>/) || text.match(/^#+\s+([^\n]+)/);
  return match ? match[1].replace(/[*`]/g, '').trim() : '';
}

/** Body with a leading title line removed (doc-03 §4.1 rule 4). */
function stripLeadingTitle(body: string): string {
  return body
    .replace(/^<b>([\s\S]*?)<\/b>\s*\n*/, '')
    .replace(/^#+\s+[^\n]*\n*/, '')
    .trim();
}

/**
 * Flatten markdown to a one-line excerpt (doc-03 §4.2 rule 7 / §13.1): no
 * headings, no emphasis markers, no list bullets, whitespace collapsed.
 */
export function plainExcerpt(body: string | null | undefined): string {
  return String(body ?? '')
    .trim()
    .replace(/^<b>([\s\S]*?)<\/b>\s*\n*/, '')
    .replace(/^#+\s+[^\n]*\n*/, '')
    .trim()
    .replace(/[*`]/g, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** `preview` wins over the body excerpt (doc-10 E6; doc-03 §4.2 rule 7). */
export function summaryOf(fm: Record<string, any> | null, body: string): string {
  const preview = fm && typeof fm.preview === 'string' ? plainExcerpt(fm.preview) : '';
  const text = preview || plainExcerpt(body);
  return text.length > SUMMARY_CAP ? `${text.slice(0, SUMMARY_CAP).trimEnd()}…` : text;
}

/**
 * Cut an entity body at `BODY_CAP` with the frozen tail note (doc-03 §5.4).
 * Truncation is NOT an error — the text stays useful and the note names the
 * read path for the rest.
 */
export function capBody(body: string, path: string): { text: string; truncated: boolean } {
  const text = String(body ?? '').trim();
  if (text.length <= BODY_CAP) return { text, truncated: false };
  return {
    text: `${text.slice(0, BODY_CAP).trimEnd()}\n… [truncated at ${BODY_CAP} of ${text.length} characters — read "${path}" for the rest]`,
    truncated: true,
  };
}

/**
 * The player-visible body of one entity: leading-title line dropped, letter
 * front matter folded in per the doc-10 four-part form (doc-03 §4.1 ex. B).
 */
export function entityBody(
  fm: Record<string, any> | null,
  body: string,
  title: string,
  path: string
): { text: string; truncated: boolean } {
  if (fm && cardKindOf(fm, basenameOf(path)) === 'letter') {
    const parts: string[] = [];
    if (typeof fm.preview === 'string' && fm.preview.trim()) parts.push(fm.preview.trim());
    if (typeof fm.sign === 'string' && fm.sign.trim()) parts.push(`— ${fm.sign.trim()}`);
    const full =
      typeof fm.body === 'string' && fm.body.trim() ? String(fm.body) : stripLeadingTitle(body.trim());
    if (full.trim()) parts.push(full.trim());
    return capBody(parts.join('\n\n'), path);
  }

  let source = String(body ?? '').trim();
  if (leadingTitleOf(source).toLowerCase() === title.toLowerCase()) source = stripLeadingTitle(source);
  return capBody(source, path);
}

/** Basename of a world-relative POSIX path. */
export function basenameOf(path: string): string {
  return path.split('/').pop() ?? path;
}

/** The kind word shown in a file listing. */
export function kindWordOf(fm: Record<string, any> | null, path: string): string {
  const kind = cardKindOf(fm, basenameOf(path));
  return KIND_WORD[kind] ?? KIND_WORD.default;
}

/** Doc-03 §6.2 size class: wide / small / (unmarked = standard). */
export function sizeWordOf(w: number): string {
  return w >= 420 ? 'wide ' : w <= 210 ? 'small ' : '';
}

export interface LayerItem {
  path: string;
  fm: Record<string, any> | null;
  body: string;
  /** Present only when a `cards` row exists. */
  box?: Box;
  /** `cards.z_index`; 0 when unplaced. */
  z: number;
}

export interface LayerPageInput {
  /** Layer id (`map` or `world/<...>`). */
  layerId: string;
  /** Directory the block header prints (`world` for the map). */
  dir: string;
  layerName: string;
  stub: boolean;
  /** This layer's own files, minus its README. */
  cards: LayerItem[];
  /** Direct child layers, as their README paths. */
  doors: LayerItem[];
  /** README frontmatter of this layer, for the backdrop line. */
  readmeFm: Record<string, any> | null;
}

function titleOf(item: LayerItem): string {
  return entityName(item.fm, item.path);
}

/** The entity block (doc-03 §4.1). `interactiveText` is 06's formatter output. */
export function renderEntityBlock(
  path: string,
  fm: Record<string, any> | null,
  body: string,
  interactiveText: string
): { text: string; truncated: boolean } {
  const title = entityName(fm, path);
  const { text, truncated } = entityBody(fm, body, title, path);
  const lines = [`[${path}]`, title];
  if (text) lines.push('', text);
  if (interactiveText) lines.push('', interactiveText);
  return { text: lines.join('\n'), truncated };
}

/** The directory block (doc-03 §4.2). */
export function renderLayerBlock(page: LayerPageInput): string {
  const lines = [[`[${page.dir}]`], `${page.layerName}${page.stub ? ' — not written yet' : ''}`];

  lines.push('', `Files here (${page.cards.length}):`);
  if (page.cards.length === 0) lines.push('  (none)');
  for (const card of page.cards) {
    const summary = summaryOf(card.fm, card.body);
    lines.push(
      `  ${card.path} — ${kindWordOf(card.fm, card.path)} · "${titleOf(card)}"${summary ? ` · ${summary}` : ''}`
    );
  }

  lines.push('', `Exits (${page.doors.length}):`);
  if (page.doors.length === 0) lines.push('  (none)');
  for (const door of page.doors) {
    // A stub door's `name` is the synthetic dir basename, so it is never absent.
    const summary = summaryOf(door.fm, door.body);
    const notWritten = !door.fm ? ' (not written yet)' : '';
    lines.push(
      `  ${door.path} — door to ${door.fm ? (door.fm.name ?? page.layerName) : titleOf(door)}${notWritten}${summary ? ` · ${summary}` : ''}`
    );
  }

  const placed = [...page.cards, ...page.doors].filter(
    (item): item is LayerItem & { box: Box } => item.box !== undefined
  );
  if (placed.length > 1) {
    lines.push('', 'Layout (each item, relative to its nearest neighbour):');
    for (const row of nearestNeighbours(placed.map((item) => ({ path: item.path, box: item.box })))) {
      lines.push(`  ${row.path} — ${row.dir} ${row.other}`);
    }
  }

  const overlaps: Array<[string, string]> = [];
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      if (boxesOverlap(placed[i].box, placed[j].box)) {
        overlaps.push([placed[i].path, placed[j].path]);
      }
    }
  }
  if (overlaps.length) {
    lines.push(
      '',
      `Overlapping pairs (${overlaps.length}) — the player sees these stacked:`,
      ...overlaps.map(([a, b]) => `  ${a} / ${b}`)
    );
  }

  const unplaced = [...page.cards, ...page.doors].filter((item) => item.box === undefined);
  if (unplaced.length) {
    lines.push(
      '',
      `Not yet placed (${unplaced.length}) — the engine seats these when the layer is first painted:`,
      ...unplaced.map((item) => `  ${item.path}`)
    );
  }

  return lines.join('\n');
}

export interface CanvasLink {
  from: string;
  to: string;
  style?: string | null;
  label?: string | null;
}

export interface CanvasPresence {
  characterId: string;
  x: number;
  y: number;
  following: boolean;
}

export interface CanvasComposition {
  layerId: string;
  dir: string;
  layerName: string;
  stub: boolean;
  readmeFm: Record<string, any> | null;
  items: LayerItem[];
  links: CanvasLink[];
  presence: CanvasPresence[];
  viewport: { width: number; height: number };
}

/** The view_canvas composition report (doc-03 §6.2). */
export function renderCanvasBlock(composition: CanvasComposition): string {
  const placed = composition.items
    .filter((item): item is LayerItem & { box: Box } => item.box !== undefined)
    .sort((a, b) => a.z - b.z);
  const unplaced = composition.items.filter((item) => item.box === undefined);

  // The backdrop line is deliberately `bg`-less until the parser stops eating
  // inline comments (doc-03 §14 conflict 2 / §6.2 note 1): printing the raw
  // value would leak a trailing quote and the whole comment. `material` alone
  // is honest.
  const material =
    composition.readmeFm && typeof composition.readmeFm.material === 'string'
      ? composition.readmeFm.material
      : '(world default)';
  const lines = [
    `[canvas ${composition.dir}]`,
    `${composition.layerName} — ${composition.stub ? 'not written yet (stub scene)' : 'composed scene'}`,
    `backdrop: (not reported — see doc-03 §6.2 note 1; the parser keeps inline comments in the value) · material: ${material}`,
    '',
    `On the canvas (${placed.length}), back to front:`,
  ];
  if (placed.length === 0) lines.push('  (nothing seated yet)');
  for (const item of placed) {
    lines.push(
      `  z${item.z} ${item.path} — ${sizeWordOf(item.box.w)}${kindWordOf(item.fm, item.path)} ${item.box.w}×${item.box.h} · "${titleOf(item)}"`
    );
  }

  if (placed.length > 1) {
    const anchor = placed[0];
    lines.push('', `Relative to ${anchor.path}:`);
    for (const item of placed.slice(1)) {
      lines.push(`  ${item.path} — ${dirPhrase(item.box, anchor.box)}`);
    }
  }

  if (unplaced.length) {
    lines.push('', `Not yet placed (${unplaced.length})`, ...unplaced.map((item) => `  ${item.path}`));
  }

  lines.push('', `Links (${composition.links.length}):`);
  if (composition.links.length === 0) lines.push('  (none)');
  else {
    for (const link of composition.links) {
      lines.push(`  ${link.from} → ${link.to}${link.label ? ` · ${link.label}` : ''}`);
    }
  }

  lines.push('', `Characters present (${composition.presence.length}):`);
  if (composition.presence.length === 0) lines.push('  (none)');
  else {
    for (const who of composition.presence) {
      lines.push(
        `  ${who.characterId} — at ${who.x},${who.y}${who.following ? ' · following' : ''}`
      );
    }
  }

  return lines.join('\n');
}
