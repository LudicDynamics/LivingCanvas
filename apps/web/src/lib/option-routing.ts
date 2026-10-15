/**
 * option-routing — which option rides which face.
 *
 * Every option on the layer is said to someone (`addresseeOf`): a MOVE goes to the writer's tray (a slip), a
 * LINE goes to a character's bubble (said as `say`). The companion's hint of this beat adds slips it hands over
 * (marked with the companion's face) and lines to say back. Pure functions only — the components render them.
 */
import { addresseeOf, type NormalizedOption } from '@airp/shared/frontmatter';
import type { HintView } from '@airp/shared/hints';
import { optionDone, optionKeyOf, type CardOptionState, type OptionFacts } from '@airp/shared/option-state';

export interface RouteCard { path: string; frontmatter?: Record<string, any> | null }
export type RouteOption = Pick<NormalizedOption, 'index' | 'label' | 'id' | 'to' | 'say' | 'for' | 'once' | 'repeat'>;

/** One move on the writer's tray. */
export interface WriterSlip {
  key: string;
  label: string;
  glyph: string;
  /** A card option (`/api/choice`)… */
  path?: string;
  option?: string;
  /** …or a place to walk to… */
  enter?: string;
  /** …or a line for the writer (an opening reply `to: writer`). */
  text?: string;
  /** Who handed it over (a character id): the slip wears their face. */
  by?: string;
  /** Only for a player who came from the prologue (the fast-forward). */
  fromPrologue?: boolean;
  /** Chosen before in this run and still on offer (a door, a talk): shown, but not counted as new ink. */
  used?: boolean;
}

/** One line in a character's bubble. */
export interface CharacterLine {
  key: string;
  /** The character it is said to (resolved: never `companion`). */
  to: string;
  say: string;
  source: 'opening' | 'hint' | 'option';
  /** `repeat: true`: stays after it was said. */
  repeat?: boolean;
}

/** The hover preview shows at most this many slips, one line each; the sheet shows them all. */
export const TRAY_PEEK = 3;
export const TRAY_MAX = 8;
export const LINES_MAX = 3;

const GLYPH: Record<string, string> = { enter: '→', read: '📖', take: '✋', stage: '🎬', search: '🎲', talk: '💬', writer: '✎' };

/** What a click on this move does, as a glyph (the rail's table, plus search and talk). */
export function slipGlyph(frontmatter: Record<string, any> | null | undefined, option: Pick<RouteOption, 'id'>): string {
  const actions = frontmatter?.choice_actions;
  const kind = option.id && actions && typeof actions === 'object' ? (actions as Record<string, { kind?: unknown }>)[option.id]?.kind : undefined;
  if (typeof kind === 'string' && GLYPH[kind]) return GLYPH[kind];
  if (frontmatter?.dice_outcomes || frontmatter?.roll_dice) return '🎲';
  if (frontmatter?.type === 'gate' && typeof frontmatter?.target === 'string') return '→';
  return '✎';
}

/** A door first, then the other cards (newest first), then this layer's README, then sub-places' READMEs (seen from outside). */
function ordered(cards: readonly RouteCard[]): RouteCard[] {
  const rank = (c: RouteCard, i: number) => {
    const readme = c.path.endsWith('/README.md');
    if (readme && i > 0) return 3;
    if (c.frontmatter?.type === 'gate' && typeof c.frontmatter?.target === 'string') return 0;
    return readme ? 2 : 1;
  };
  return cards.map((c, i) => ({ c, i, r: rank(c, i) })).sort((a, b) => a.r - b.r || b.i - a.i).map((x) => x.c);
}

export interface RouteContext {
  /** Whoever follows the player now (`to: companion` resolves to them; none → those lines are dropped). */
  companion: string | null;
  /** This tab came from the prologue's ending into this world (options `for: from-prologue` show). */
  fromPrologue: boolean;
  /**
   * Keys used in this run (`slipKey`): a line said is gone (unless `repeat`), a move chosen stays but is no longer
   * new (`WriterSlip.used`) — whether a move is gone is `done`'s to say.
   */
  used?: ReadonlySet<string>;
  /** Is this option done? Done options are not offered anywhere. */
  done?: (card: RouteCard, option: RouteOption) => boolean;
  /** Chosen before (`optionUsedOf`: the server's events or `used`); absent → `used` alone. */
  isUsed?: (card: RouteCard, option: RouteOption) => boolean;
}

export const slipKey = (path: string, option: string) => `${path}#${option}`;

/** Pure: the layer's options, split by face. */
export function routeOptions(
  cards: readonly RouteCard[],
  optionsOf: (card: RouteCard) => RouteOption[],
  ctx: RouteContext,
): { slips: WriterSlip[]; lines: CharacterLine[] } {
  const slips: WriterSlip[] = [];
  const lines: CharacterLine[] = [];
  const seenSlip = new Set<string>();
  const seenLine = new Set<string>();
  // A place's own README seen from outside (a sub-layer's door card here, after the first card) carries what is
  // said INSIDE it: its lines are for whoever is in there, not for this room's bubble.
  const outside = new Set(cards.filter((c, i) => i > 0 && c.path.endsWith('/README.md')).map((c) => c.path));
  for (const card of ordered(cards)) {
    for (const option of optionsOf(card)) {
      if (option.for === 'from-prologue' && !ctx.fromPrologue) continue;
      const id = option.id ?? String(option.index);
      const key = slipKey(card.path, id);
      if (ctx.done?.(card, option)) continue;
      const used = ctx.isUsed ? ctx.isUsed(card, option) : ctx.used?.has(key) === true;
      const to = addresseeOf(card.frontmatter, option);
      if (to.to === 'writer') {
        if (seenSlip.has(option.label)) continue;
        seenSlip.add(option.label);
        slips.push({ key, label: option.label, glyph: option.for === 'from-prologue' ? '⏩' : slipGlyph(card.frontmatter, option), path: card.path, option: option.id ?? option.label, ...(option.for === 'from-prologue' ? { fromPrologue: true } : {}), ...(used ? { used: true } : {}) });
      } else {
        // A bare `kind: character` (「和夏澄商量」, no `say`) is not a sentence: it stays in the left rail, where a click
        // opens that person, until the world writes what is said.
        if (option.to === undefined && option.say === undefined) continue;
        if (outside.has(card.path)) continue;
        // Said once in this scene: gone, unless the world wants it said again (`repeat: true`).
        if (used && !option.repeat) continue;
        const who = to.to === 'companion' ? ctx.companion : to.to;
        const say = to.say ?? option.label;
        if (!who || seenLine.has(`${who}\u0000${say}`)) continue;
        seenLine.add(`${who}\u0000${say}`);
        lines.push({ key, to: who, say, source: 'option', ...(option.repeat ? { repeat: true } : {}) });
      }
    }
  }
  // The fast-forward leads the tray: it is the first thing a returning player wants; moves
  // already made (a door walked through, a talk had) sink below the new ones.
  slips.sort((a, b) => Number(Boolean(b.fromPrologue)) - Number(Boolean(a.fromPrologue)) || Number(Boolean(a.used)) - Number(Boolean(b.used)));
  return { slips: slips.slice(0, TRAY_MAX), lines };
}

/** Pure: the slips a hint hands over, labelled from the card when it is on this layer (else the hint's own label). */
export function hintSlips(hint: HintView | null | undefined, cards: readonly RouteCard[], optionsOf: (card: RouteCard) => RouteOption[], here: string, used?: ReadonlySet<string>, done?: RouteContext['done']): WriterSlip[] {
  if (!hint) return [];
  const by = hint.by === 'writer' ? undefined : hint.by;
  const out: WriterSlip[] = [];
  for (const s of hint.suggest ?? []) {
    if ('enter' in s) {
      if (s.enter === here) continue;
      out.push({ key: `enter:${s.enter}`, label: s.label, glyph: '→', enter: s.enter, ...(by ? { by } : {}) });
      continue;
    }
    const key = slipKey(s.card, s.option);
    const card = cards.find((c) => c.path === s.card);
    const option = card ? optionsOf(card).find((o) => o.id === s.option) : undefined;
    // The card left the layer (taken), or the option is no longer offered, or what it does is done: nothing to hand over.
    if (!card || !option || done?.(card, option)) continue;
    // A line handed over and already said is gone; a move already made stays, but is not new.
    if (used?.has(key) && addresseeOf(card.frontmatter, option).to !== 'writer' && !option.repeat) continue;
    out.push({ key, label: s.label ?? option.label, glyph: slipGlyph(card.frontmatter, option), path: s.card, option: s.option, ...(by ? { by } : {}), ...(used?.has(key) ? { used: true } : {}) });
  }
  return out;
}

/** Pure: the hint's slips first (they are this beat's nudge), then the layer's, one per label. */
export function mergeSlips(first: readonly WriterSlip[], rest: readonly WriterSlip[], max = TRAY_MAX): WriterSlip[] {
  const out: WriterSlip[] = [];
  const keys = new Set<string>();
  const labels = new Set<string>();
  for (const s of [...first, ...rest]) {
    if (keys.has(s.key) || labels.has(s.label)) continue;
    keys.add(s.key);
    labels.add(s.label);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Pure: the written lines for one character's bubble (D5: written first). The opening's replies while the
 * greeting waits; else the hint's replies (when this character said the hint) and the layer's options said to
 * them. Used lines are gone. At most `LINES_MAX`.
 */
export function linesFor(
  character: string,
  input: { opening?: readonly string[] | null; hint?: HintView | null; routed: readonly CharacterLine[]; used?: ReadonlySet<string> },
): CharacterLine[] {
  if (input.opening && input.opening.length) return input.opening.map((say) => ({ key: `opening:${say}`, to: character, say, source: 'opening' as const }));
  const out: CharacterLine[] = [];
  const said = new Set<string>();
  const push = (line: CharacterLine) => {
    if ((input.used?.has(line.key) && !line.repeat) || said.has(line.say)) return;
    said.add(line.say);
    out.push(line);
  };
  if (input.hint && input.hint.by === character) for (const say of input.hint.replies ?? []) push({ key: `hint:${input.hint.id}:${say}`, to: character, say, source: 'hint' });
  for (const line of input.routed) if (line.to === character) push(line);
  return out.slice(0, LINES_MAX);
}

/** Pure: an NPC card's own written lines (frontmatter `replies:`), minus the used ones. */
export function npcLinesOf(path: string, frontmatter: Record<string, unknown> | null | undefined, used?: ReadonlySet<string>): string[] {
  const raw = frontmatter?.replies;
  if (!Array.isArray(raw)) return [];
  return raw.filter((l): l is string => typeof l === 'string' && l.trim() !== '').map((l) => l.trim())
    .filter((l) => !used?.has(`npc:${path}:${l}`)).slice(0, LINES_MAX);
}

// ── is it done?: the server's answer, else the page's own reading ─────────────────

export interface DoneInput {
  /** `GET /api/layer` `optionStates` (keyed by card path): the save's answer. Absent → the page's reading only. */
  states?: Readonly<Record<string, CardOptionState>> | null;
  /** The cards on this page (README first): what is on disk here, and the search chalks. */
  cards: readonly RouteCard[];
  /** Paths in the backpack (`player/…`). */
  carried: ReadonlySet<string>;
  /** This page's directory (`world` for the map). */
  dir: string;
  /** The run's used keys (`slipKey`). */
  used?: ReadonlySet<string>;
}

const dirOf = (path: string): string => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : path);

/**
 * Pure: the `done` predicate for `routeOptions` / `hintSlips` / the left rail. Done when the server says so, or when
 * what the page holds already shows it (the fallback, for an older server with no `optionStates`) —
 * a take whose files left this page or sit in the backpack, a search (or a read of a dice card) rolled here, a line said,
 * a `once` chosen. Anything the page cannot see stays on offer.
 */
export function optionDoneOf(input: DoneInput): (card: RouteCard, option: RouteOption) => boolean {
  const here = new Map(input.cards.map((c) => [c.path, c]));
  const carriedNames = new Set([...input.carried].map((p) => p.split('/').pop()));
  // The server read the save: files and dice are its to say (a card on disk may not be drawn on this page).
  // The page only adds what the server cannot know — the lines said and the `once` moves made in this tab.
  const served = input.states !== undefined && input.states !== null;
  const facts: OptionFacts = {
    onDisk: (path) => {
      if (served) return null;
      if (here.has(path)) return true;
      if (input.carried.has(path) || carriedNames.has(path.split('/').pop())) return false;
      return dirOf(path) === input.dir ? false : null;
    },
    rolled: (path) => {
      if (served) return null;
      const card = here.get(path);
      if (!card) return null;
      const roll = (card.frontmatter as { roll_dice?: { result?: unknown } } | null | undefined)?.roll_dice;
      return typeof roll?.result === 'number';
    },
    chosen: (cardPath, option) => input.used?.has(slipKey(cardPath, option.id ?? String((option as Partial<RouteOption>).index))) === true,
  };
  return (card, option) => {
    if (option.repeat) return false;
    if (input.states?.[card.path]?.done.includes(optionKeyOf(option))) return true;
    return optionDone(card.path, card.frontmatter, option, facts) !== null;
  };
}

/** Pure: chosen before in this run (the server's events, or this page's clicks)? */
export function optionUsedOf(states: Readonly<Record<string, CardOptionState>> | null | undefined, used: ReadonlySet<string> | undefined): (card: RouteCard, option: RouteOption) => boolean {
  return (card, option) => states?.[card.path]?.used.includes(optionKeyOf(option)) === true
    || used?.has(slipKey(card.path, option.id ?? String(option.index))) === true;
}

// ── the run's used set (「点过的那个不再出现（同一局、同一 id）」, §2.6) ──────────────────────────────

const USED_PREFIX = 'airp.chips-used:';
const USED_KEEP = 200;

export function readUsed(run: string | null, storage: Pick<Storage, 'getItem'> | null = safeLocal()): Set<string> {
  if (!run) return new Set();
  try {
    const raw = storage?.getItem(USED_PREFIX + run);
    const list = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(list) ? list.filter((k): k is string => typeof k === 'string') : []);
  } catch {
    return new Set();
  }
}

export function markUsed(run: string | null, key: string, storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeLocal()): Set<string> {
  const next = readUsed(run, storage);
  if (!run) return next;
  next.add(key);
  try { storage?.setItem(USED_PREFIX + run, JSON.stringify([...next].slice(-USED_KEEP))); } catch { /* private mode: this tab only */ }
  return next;
}

function safeLocal(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
}

// ── saying a line from elsewhere (the left rail's full list) ─────────────────────────────────

/** The left rail asks App to say a line to a character (`to` may be `companion`). */
export const SAY_LINE_EVENT = 'airp:say-line';
export interface SayLineRequest { to: string; say: string; key: string }
export function requestSayLine(request: SayLineRequest): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<SayLineRequest>(SAY_LINE_EVENT, { detail: request }));
}
