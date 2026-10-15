/**
 * choice-rail-model — what the left rail shows, as pure functions
 *.
 *
 * Kept out of the component so the grouping and the glyph table can be tested
 * without a renderer, the same split the rest of `lib/` uses.
 */
import { buildInteractiveFields, choiceOptionIdentity, visibleChoiceOptions, type NormalizedOption } from '@airp/shared/frontmatter';

/** A card that may carry options; the layer README counts (it carries `choice` too). */
export interface ChoiceRailCard {
  path: string;
  filename?: string;
  frontmatter?: Record<string, any> | null;
  body?: string;
}

export interface RailGroup {
  path: string;
  title: string;
  options: NormalizedOption[];
  frontmatter: Record<string, any> | null | undefined;
}

/** The card's own name, for the group heading. */
export function titleOf(card: ChoiceRailCard): string {
  const fm = card.frontmatter;
  const title = fm?.title ?? fm?.name;
  if (typeof title === 'string' && title.trim()) return title;
  const leaf = card.path.split('/').pop() ?? card.path;
  return leaf.replace(/\.md$/, '');
}

/**
 * What a click will do — declared kinds first (`choice_actions`), then a
 * card-level dice roll, else the writer.
 *
 * Named rather than left inside `choiceGlyph` because two callers need it: the
 * glyph table, and the onboarding guide, whose third step has to find the one
 * option on this layer that actually leads somewhere.
 */
export type ChoiceKind = 'enter' | 'read' | 'take' | 'character' | 'stage' | 'dice' | 'writer';

export function choiceKind(frontmatter: Record<string, any> | null | undefined, option: NormalizedOption): ChoiceKind {
  // A line said to someone: the speech glyph, whatever card it sits on.
  if (option.to && option.to !== 'writer') return 'character';
  const actions = frontmatter?.choice_actions;
  const declared = option.id && actions && typeof actions === 'object'
    ? (actions as Record<string, unknown>)[option.id]
    : undefined;
  const kind = declared && typeof declared === 'object' ? (declared as { kind?: unknown }).kind : undefined;
  if (kind === 'enter') return 'enter';
  if (kind === 'read') return 'read';
  if (kind === 'take') return 'take';
  if (kind === 'character' || kind === 'talk') return 'character';
  if (kind === 'stage') return 'stage';
  if (kind === 'search') return 'dice';
  if (frontmatter?.dice_outcomes || frontmatter?.roll_dice) return 'dice';
  return 'writer';
}

const CHOICE_GLYPHS: Record<ChoiceKind, string> = {
  enter: '→',
  read: '📖',
  take: '✋',
  character: '💬',
  stage: '🎬',
  dice: '🎲',
  writer: '✎',
};

/** The glyph that says what a click will do. */
export function choiceGlyph(frontmatter: Record<string, any> | null | undefined, option: NormalizedOption): string {
  return CHOICE_GLYPHS[choiceKind(frontmatter, option)];
}

/**
 * Every card on the layer that has at least one visible option, in reading
 * order. Broken widget data degrades to "no options" — exactly what the card
 * itself does, never a half-rendered group.
 *
 * One entry per option IDENTITY, not per card (`choiceOptionIdentity`: label +
 * where it leads): two cards that declare the same option — Holmes' layer
 * README and its opening chalk both carried 「221B · Stop the next incident」 —
 * list it once, under the first card in reading order. A group whose every
 * option is already listed is dropped.
 */
export function railGroups(cards: readonly ChoiceRailCard[], opts: { fromPrologue?: boolean; isDone?: (card: ChoiceRailCard, option: NormalizedOption) => boolean } = {}): RailGroup[] {
  const groups: RailGroup[] = [];
  const seen = new Set<string>();
  const listed = new Set<string>();
  for (const card of cards) {
    if (!card || seen.has(card.path)) continue;
    seen.add(card.path);
    let options: NormalizedOption[] = [];
    try {
      const interactive = buildInteractiveFields(card.frontmatter ?? {});
      options = interactive.choice ? visibleChoiceOptions(interactive.choice) : [];
    } catch {
      options = [];
    }
    const title = titleOf(card);
    options = options.filter(option => {
      // The prologue's fast-forward is only for a player who came from it.
      if (option.for === 'from-prologue' && !opts.fromPrologue) return false;
      // Done (a take whose things are in the bag, a rolled search…, the design notes): not on offer any more.
      if (opts.isDone?.(card, option)) return false;
      const identity = choiceOptionIdentity(card.frontmatter, option, title);
      if (listed.has(identity)) return false;
      listed.add(identity);
      return true;
    });
    if (options.length === 0) continue;
    groups.push({ path: card.path, title, options, frontmatter: card.frontmatter });
  }
  return groups;
}

/** A layer as the manifest declares it: a display name and who contains it. */
export interface RailLayer {
  name?: string;
  parent?: string | null;
}

/** How a place stands relative to where the player is now. */
export type PlaceRelation = 'parent' | 'child' | 'here' | 'elsewhere';

export interface RailPlace {
  id: string;
  name: string;
  relation: PlaceRelation;
}

/** Root layers answer to `map`, whose own directory is `world/` (world.ts alias). */
const ROOT_LAYER = 'map';

/** A readable name for a layer with none declared: `old-harbour` → `old harbour`. */
function placeName(id: string, declared?: string): string {
  const trimmed = typeof declared === 'string' ? declared.trim() : '';
  if (trimmed !== '') return trimmed;
  return id === ROOT_LAYER ? id : id.replace(/[-_]+/g, ' ');
}

/**
 * Everywhere the player can go, ordered by how near it is
 *
 *
 * Order, not filter: the way OUT comes first, then the rooms inside this one,
 * then everywhere else the world declares. Listing all of them is the ask — a
 * world's layers are its map, and hunting for the one door that leads onward
 * was the thing this rail exists to end. The current layer is included, marked
 * `here`, so the list reads as a position rather than a menu; the caller
 * renders it as a label rather than a button.
 *
 * Pure, and total over whatever the manifest holds: an unknown parent is simply
 * not linked rather than a crash.
 */
export function railPlaces(
  layers: Readonly<Record<string, RailLayer>> | undefined,
  current: string,
): RailPlace[] {
  if (!layers) return [];
  const ids = Object.keys(layers);
  if (ids.length === 0) return [];
  const relationOf = (id: string): PlaceRelation => {
    if (id === current) return 'here';
    const parentOfCurrent = layers[current]?.parent ?? (current === ROOT_LAYER ? null : ROOT_LAYER);
    if (id === parentOfCurrent) return 'parent';
    const parentOfId = layers[id]?.parent ?? (id === ROOT_LAYER ? null : ROOT_LAYER);
    if (parentOfId === current) return 'child';
    return 'elsewhere';
  };
  const RANK: Record<PlaceRelation, number> = { here: 0, parent: 1, child: 2, elsewhere: 3 };
  return ids
    .map(id => ({ id, name: placeName(id, layers[id]?.name), relation: relationOf(id) }))
    .sort((a, b) => (RANK[a.relation] - RANK[b.relation]) || a.name.localeCompare(b.name));
}

/** The arrow that says which way a place lies. `here` gets a dot, not a door. */
export const PLACE_GLYPHS: Record<PlaceRelation, string> = {
  here: '•',
  parent: '←',
  child: '→',
  elsewhere: '↗',
};
