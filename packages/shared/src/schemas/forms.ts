/**
 * Card forms — the ONE source of truth for every canvas object's footprint and
 * visual identity. The server seats cards by these; the web layer renders by
 * these. Because both read this table, a kind's box can never drift between the
 * seating math and the painted box (the "two size tables" bug).
 *
 * Form vocabulary borrowed from the v2 prototype (canvas-stack-mingyue.html /
 * hearth.html) and NoDesign's `chrome: card | bare` axis (board-kinds.js):
 *
 *   'bare'   — a stroke of ink on the canvas: no card surface, no border, no
 *              shadow. Narrations (`chalk`) and character presences are ink.
 *   'paper'  — a sheet: paper tone + hairline + soft shadow.
 *   'cover'  — a scene gate: paper sheet with a material cover band on top,
 *              a hand-drawn ordinal seal and a pin.
 *   'note'   — a sticky note: yellow stock + ruled lines + a paperclip.
 *   'slab'   — stone/metal: inset shadow, so it reads as set INTO the scene.
 *   'board'  — a table top: deeper cream + a 80px grid.
 *   'panel'  — an instrument face: light ink wash + DM Mono.
 *   'scroll' — a long sheet: doubled top/bottom edges, no rounding.
 */

/**
 * The component resolver, pushed IN from `components/registry.ts` once that
 * module loads. This module MUST NOT import the registry: the registry imports
 * `CARD_FORMS`, and a back-edge would be an ESM cycle (review m-20). The
 * indirection keeps `CARD_FORMS` a leaf while still letting `cardKindOf` know
 * about component kinds.
 */
let componentKindResolver: ((fm: Record<string, any>, filename: string) => string) | null = null;

export function registerComponentKindResolver(
  fn: (fm: Record<string, any>, filename: string) => string
): void {
  componentKindResolver = fn;
}

export type CardChrome =
  | 'bare'
  | 'paper'
  | 'cover'
  | 'note'
  // Component material vocabulary (doc 10 §13.4 / appendix A.3): a locked door
  // is iron, a board is a table, a clock is an instrument, a map is a scroll.
  | 'slab'
  | 'board'
  | 'panel'
  | 'scroll';

export interface CardForm {
  /** English label (the repo is public; UI copy is English). */
  label: string;
  w: number;
  h: number;
  chrome: CardChrome;
}

/**
 * Every card's footprint. `h` only serves seating — the painted height comes
 * from the content — so this table is a seating/identity contract, not CSS.
 * The nineteen component kinds (doc 10 appendix A.2) sit beside the five
 * non-component kinds; adding a kind to the registry WITHOUT a row here throws
 * at module load (registry.ts), which is the guard against "two size tables".
 */
export const CARD_FORMS: Record<string, CardForm> = {
  // non-component kinds (doc 10 §9.2: not in the registry, but they need a form)
  chalk: { label: 'Narration', w: 460, h: 190, chrome: 'bare' },
  gate: { label: 'Scene', w: 288, h: 240, chrome: 'cover' },
  sprite: { label: 'Presence', w: 176, h: 196, chrome: 'bare' },
  // H1 / contract §4.3: desktop 16:9 (360 × 9/16 = 202.5 → 203). A DECLARED
  // seating height, not the painted height (drawing uses `item.w * 9/16`).
  html: { label: 'Web page', w: 360, h: 203, chrome: 'panel' },
  // The player's own sticky note. Not a
  // component: the writer can never author one.
  sticky: { label: 'Player note', w: 208, h: 168, chrome: 'note' },
  /** Defensive fallback only; every real kind is matched above. */
  default: { label: 'File', w: 240, h: 168, chrome: 'paper' },

  // core
  note: { label: 'Note', w: 200, h: 168, chrome: 'note' },
  letter: { label: 'Letter', w: 224, h: 176, chrome: 'paper' },
  // adventure
  lock: { label: 'Lock', w: 176, h: 176, chrome: 'slab' },
  container: { label: 'Container', w: 200, h: 200, chrome: 'slab' },
  trap: { label: 'Trap', w: 168, h: 168, chrome: 'slab' },
  mechanism: { label: 'Mechanism', w: 192, h: 160, chrome: 'slab' },
  map: { label: 'Map', w: 300, h: 200, chrome: 'scroll' },
  // mystery
  book: { label: 'Book', w: 208, h: 264, chrome: 'paper' },
  ledger: { label: 'Ledger', w: 260, h: 176, chrome: 'paper' },
  photo: { label: 'Photograph', w: 224, h: 240, chrome: 'paper' },
  cipher: { label: 'Cipher', w: 220, h: 168, chrome: 'paper' },
  // chronicle
  clock: { label: 'Clock', w: 160, h: 160, chrome: 'panel' },
  tape: { label: 'Recording', w: 240, h: 148, chrome: 'panel' },
  anchor: { label: 'Anchor', w: 168, h: 168, chrome: 'slab' },
  // craft
  instrument: { label: 'Instrument', w: 320, h: 200, chrome: 'board' },
  board: { label: 'Board', w: 288, h: 288, chrome: 'board' },
  // room
  diary: { label: 'Diary', w: 208, h: 240, chrome: 'paper' },
  thread: { label: 'Conversation', w: 300, h: 200, chrome: 'paper' },
  // A living figure: the ONE kind whose box ratio is pinned by its own CSS
  // (`aspect-ratio: 3 / 4` on `.portrait__media`), so the painted height equals
  // `h` exactly and this row does not drift on measurement (nook 03 §③-1).
  portrait: { label: 'Portrait', w: 288, h: 384, chrome: 'bare' },
};

/**
 * Resolve a card's kind from parsed frontmatter + filename. Order matters.
 *
 * When the component registry has loaded, its resolver owns the answer: it
 * knows every registered kind AND the non-component kinds (chalk / gate /
 * sprite), so `type: component, component: lock` no longer collapses to `note`
 * (review D2 / 00 §10 #6). Before the registry loads — or in a build that never
 * imports it — the local branches below are the fallback, matching the
 * historical behaviour exactly.
 */
export function cardKindOf(
  frontmatter: Record<string, any> | null | undefined,
  filename: string
): string {
  if (componentKindResolver) return componentKindResolver(frontmatter || {}, filename);
  const fm = frontmatter || {};
  if (fm.type === 'chalk') return 'chalk';
  if (fm.type === 'gate' || filename === 'README.md') return 'gate';
  if (fm.type === 'player-note' && /^player-note-\d{1,6}\.md$/.test(filename)) return 'sticky';
  if (fm.component === 'letter' || fm.type === 'letter') return 'letter';
  if (fm.type === 'note') return 'note';
  if (fm.type === 'sprite' || fm.type === 'character') return 'sprite';
  return 'note';
}

/** Footprint for a card. Server seating and the web box BOTH call this. */
export function cardFormOf(
  frontmatter: Record<string, any> | null | undefined,
  filename: string
): CardForm {
  return CARD_FORMS[cardKindOf(frontmatter, filename)] ?? CARD_FORMS.default;
}

/**
 * NEW. Short, deterministic hash of a DECLARED footprint. Changes IFF the
 * declared (kind, w, h) triple changes, so it is the ONLY thing `reseatLayer`
 * compares to decide "the kind was resized in code" (contract §5.1 第 4 条 /
 * §9 第 8 条). Pure FNV-1a on `${kind}:${w}x${h}` — dependency-free on purpose:
 * forms.ts is imported by the web bundle (cardFormOf), and node:crypto there
 * would break it.
 *
 * `kind` is part of the hash input (MINOR-10): `map` (300x200, chrome scroll)
 * and `thread` (300x200, chrome paper) share a box but paint at different
 * heights, so hashing `(w,h)` alone would miss a resize. Consequence accepted
 * by the contract: renaming a kind re-seats its cards once (the alternative —
 * silent non-reseat — is worse).
 */
export function cardFormVersionOf(kind: string, w: number, h: number): string {
  let hash = 0x811c9dc5;
  for (const ch of `${kind}:${w}x${h}`) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * Chalk style variants — narration is the one kind with "many styles". Every
 * field is optional; the default is bare serif ink (transparent background, no
 * card surface). Special styles are opt-in via frontmatter:
 *
 *   font: hand            → hand-written stroke (Caveat / Long Cang)
 *   big: true | size: big → display scale
 *   color/tone: rust|blue|sage → ink colour variant
 *   card: true            → force a paper card surface (rare)
 *   collapsed: true       → folded to a one-line summary
 *   aged: true            → faded / weathered (a memory going quiet)
 */
export interface ChalkStyle {
  hand: boolean;
  big: boolean;
  tone: 'ink' | 'rust' | 'blue' | 'sage';
  card: boolean;
  collapsed: boolean;
  aged: boolean;
}

const CHALK_TONES = ['ink', 'rust', 'blue', 'sage'] as const;

export function chalkStyleOf(fm: Record<string, any> | null | undefined): ChalkStyle {
  const f = fm || {};
  const rawTone = f.color ?? f.tone;
  const tone = (CHALK_TONES as readonly string[]).includes(rawTone)
    ? (rawTone as ChalkStyle['tone'])
    : 'ink';
  return {
    hand: f.font === 'hand' || f.hand === true,
    big: f.big === true || f.size === 'big' || f.size === 'large',
    tone,
    card: f.card === true || f.chrome === 'paper',
    collapsed: f.collapsed === true,
    aged: f.aged === true,
  };
}

/** Layer material skins (the world tapestry). Drives the scene backdrop. */
export const MATERIAL_SKINS: Record<string, string> = {
  parchment: 'mat-parchment',
  warm: 'mat-warm',
  stub: 'mat-stub',
  kraft: 'mat-kraft',
};

export function materialSkinOf(material: string | null | undefined): string {
  return MATERIAL_SKINS[material || ''] ?? 'mat-warm';
}
