/**
 * The server's answer to 「is this option done?」 (`rules/option-state.ts`, the design notes), read from the
 * save: a take's paths on disk, a search chalk's roll receipt, the run's `choice_selected` events. `GET /api/layer`
 * puts it on every card (so the page hides what is done) and `look_at` marks the same options for the writer —
 * one answer, so the writer's view and the page agree.
 */
import { parseFrontmatter } from '../schemas/frontmatter.js';
import { buildInteractiveFields, visibleChoiceOptions, type NormalizedOption } from '../rules/interactive.js';
import { cardOptionState, optionFactsNeeded, type CardOptionState, type OptionFacts } from '../rules/option-state.js';
import { eventsThisLoop } from './loop-history.js';
import type { WorldStore } from '../store/world-store.js';

type Store = Pick<WorldStore, 'statKind' | 'readFile' | 'getEventsSince'>;
type Card = { path: string; frontmatter?: Record<string, unknown> | null };

function visibleOptionsOf(frontmatter: Record<string, unknown> | null | undefined): NormalizedOption[] {
  try {
    const choice = buildInteractiveFields((frontmatter ?? {}) as Record<string, any>).choice;
    return choice ? visibleChoiceOptions(choice) : [];
  } catch {
    return [];
  }
}

/** Every card's option state, keyed by card path (cards without options are left out). */
export async function optionStatesOf(store: Store, cards: readonly Card[]): Promise<Record<string, CardOptionState>> {
  const withOptions = cards.filter((card) => visibleOptionsOf(card.frontmatter).length > 0);
  if (withOptions.length === 0) return {};
  const needed = optionFactsNeeded(withOptions, visibleOptionsOf);
  const onDisk = new Map<string, boolean>();
  for (const path of needed.paths) onDisk.set(path, (await store.statKind(path)) === 'file');
  const events = await eventsThisLoop(store);
  const created = new Set<string>();
  const chosen = new Set<string>();
  for (const event of events) {
    const detail = (event.detail ?? {}) as Record<string, unknown>;
    if (event.type === 'entity_created' && typeof detail.path === 'string') created.add(detail.path);
    if (event.type === 'choice_selected' && typeof detail.path === 'string' && typeof detail.choice === 'string') chosen.add(`${detail.path}\u0000${detail.choice}`);
  }
  const rolled = new Map<string, boolean>();
  for (const path of needed.dice) {
    if ((await store.statKind(path)) === 'file') {
      let done = false;
      try {
        const roll = (parseFrontmatter(await store.readFile(path)).frontmatter as Record<string, any> | null)?.roll_dice;
        done = typeof roll?.result === 'number';
      } catch { /* unreadable: not rolled */ }
      rolled.set(path, done);
    } else {
      // Searched this loop and cleared away: the spot answers 「already searched」 (`searchPlace`).
      rolled.set(path, created.has(path));
    }
  }
  const facts: OptionFacts = {
    onDisk: (path) => onDisk.get(path) ?? null,
    rolled: (path) => rolled.get(path) ?? null,
    chosen: (cardPath, option) => chosen.has(`${cardPath}\u0000${option.label}`),
  };
  const out: Record<string, CardOptionState> = {};
  for (const card of withOptions) {
    const state = cardOptionState(card.path, card.frontmatter, visibleOptionsOf(card.frontmatter), facts);
    if (state.done.length > 0 || state.used.length > 0) out[card.path] = state;
  }
  return out;
}
