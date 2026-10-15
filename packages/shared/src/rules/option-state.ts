/**
 * Is an option DONE?
 *
 * An option disappears when what it does is done, not when it was clicked:
 *
 *   kind: take            → spent once none of its `paths` is still where it was declared (taken into the
 *                           backpack, or gone from the world);
 *   kind: search          → spent once that spot has a roll receipt (its dice chalk rolled, or searched this
 *                           loop and cleared away). A world that wants a second way in declares it (the
 *                           「绕远路」 card, opened by the miss) — nothing generic is offered instead;
 *   kind: read            → spent once every card it opens is a dice card already rolled (「用骰子拦住他」);
 *                           a plain read stays (mark it `once: true` when reading it again is clutter);
 *   kind: enter / a door  → never spent (navigation is repeatable);
 *   kind: talk            → never spent; once chosen it only stops counting as new;
 *   a line (to: <char>)   → spent once said in this run (each card's line is its own: per scene);
 *   `repeat: true`        → never spent;
 *   `once: true`          → spent once chosen in this run.
 *
 * ZERO dependencies (like `interactive.ts`): the server answers it from the store (`actions/option-state.ts`,
 * so the page and `look_at` agree), the page answers it from what it holds when the server did not.
 */
import type { NormalizedOption } from './interactive.js';

export type OptionDone = 'taken' | 'searched' | 'rolled' | 'said' | 'once';

export interface OptionFacts {
  /** Is this world path a file where it was declared? `null` = not known (the option stays). */
  onDisk(path: string): boolean | null;
  /**
   * Does this dice card have a roll receipt (`roll_dice.result`, or — gone now — it was created this loop)? `false` =
   * not rolled / not a dice card; `null` = not known (the option stays).
   */
  rolled(path: string): boolean | null;
  /** Was this option of this card chosen (or this line said) in this run? */
  chosen(cardPath: string, option: Pick<NormalizedOption, 'id' | 'label'>): boolean;
}

type Option = Pick<NormalizedOption, 'id' | 'label' | 'to' | 'say' | 'once' | 'repeat'>;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The option's stable key on its card: its id, else its label. */
export const optionKeyOf = (option: Pick<NormalizedOption, 'id' | 'label'>): string => option.id ?? option.label;

/** The declared `choice_actions` entry of this option, if any. */
export function declaredActionOf(frontmatter: Record<string, unknown> | null | undefined, option: Pick<NormalizedOption, 'id'>): Record<string, unknown> | null {
  const actions = frontmatter?.choice_actions;
  if (!option.id || !isObject(actions)) return null;
  const action = actions[option.id];
  return isObject(action) ? action : null;
}

const dirOf = (path: string): string => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : path);

/** Where a `kind: search` option's dice chalk lands (`actions/search.ts` `searchChalkPath`, the card's layer by default). */
export function searchChalkOf(cardPath: string, action: Record<string, unknown>): string | null {
  const spot = action.spot;
  if (typeof spot !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(spot)) return null;
  const layer = action.layer;
  const dir = typeof layer === 'string' && layer !== '' ? (layer === 'map' ? 'world' : layer) : dirOf(cardPath);
  return `${dir}/search-${spot}.md`;
}

/** Is this option a line said to a character (rather than a move for the writer)? Mirrors `addresseeOf`. */
function isLine(action: Record<string, unknown> | null, option: Option): boolean {
  if (option.to === 'writer') return false;
  if (option.to) return true;
  return action?.kind === 'character' && option.say !== undefined;
}

/** Pure: is this option done (and why), or still on offer (`null`)? */
export function optionDone(cardPath: string, frontmatter: Record<string, unknown> | null | undefined, option: Option, facts: OptionFacts): OptionDone | null {
  if (option.repeat) return null;
  const action = declaredActionOf(frontmatter, option);
  if (option.once && facts.chosen(cardPath, option)) return 'once';
  if (isLine(action, option)) return facts.chosen(cardPath, option) ? 'said' : null;
  if (!action) return null;
  if (action.kind === 'take' && Array.isArray(action.paths) && action.paths.length > 0) {
    const paths = action.paths.filter((p): p is string => typeof p === 'string');
    if (paths.length > 0 && paths.every((p) => facts.onDisk(p) === false)) return 'taken';
    return null;
  }
  if (action.kind === 'search') {
    const chalk = searchChalkOf(cardPath, action);
    return chalk && facts.rolled(chalk) === true ? 'searched' : null;
  }
  if (action.kind === 'read' && Array.isArray(action.paths) && action.paths.length > 0) {
    const paths = action.paths.filter((p): p is string => typeof p === 'string');
    if (paths.length > 0 && paths.every((p) => facts.rolled(p) === true)) return 'rolled';
    return null;
  }
  return null;
}

/** What the server says about one card's options (`GET /api/layer` `items[].options`, keyed by `optionKeyOf`). */
export interface CardOptionState {
  /** Done: not offered any more (tray, bubble, rail). */
  done: string[];
  /** Chosen at least once in this run (still offered when not done): they do not count as new. */
  used: string[];
}

/** The paths (on disk?) and dice cards (rolled?) a set of cards' options need answered (the server reads them once). */
export function optionFactsNeeded(cards: readonly { path: string; frontmatter?: Record<string, unknown> | null }[], optionsOf: (frontmatter: Record<string, unknown> | null | undefined) => Option[]): { paths: string[]; dice: string[] } {
  const paths = new Set<string>();
  const dice = new Set<string>();
  for (const card of cards) {
    for (const option of optionsOf(card.frontmatter)) {
      const action = declaredActionOf(card.frontmatter, option);
      if (!action) continue;
      if (action.kind === 'take' && Array.isArray(action.paths)) for (const p of action.paths) if (typeof p === 'string') paths.add(p);
      if (action.kind === 'read' && Array.isArray(action.paths)) for (const p of action.paths) if (typeof p === 'string') dice.add(p);
      if (action.kind === 'search') {
        const chalk = searchChalkOf(card.path, action);
        if (chalk) dice.add(chalk);
      }
    }
  }
  return { paths: [...paths], dice: [...dice] };
}

/** Pure: one card's option state from the facts. */
export function cardOptionState(cardPath: string, frontmatter: Record<string, unknown> | null | undefined, options: readonly Option[], facts: OptionFacts): CardOptionState {
  const done: string[] = [];
  const used: string[] = [];
  for (const option of options) {
    const key = optionKeyOf(option);
    if (optionDone(cardPath, frontmatter, option, facts)) done.push(key);
    else if (facts.chosen(cardPath, option)) used.push(key);
  }
  return { done, used };
}
