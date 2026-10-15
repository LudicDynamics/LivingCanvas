/**
 * Companion hints — the beat.
 *
 * Called once per player beat from `runTurnEnd`, after the turn-end command
 * and the character tick: reads the world's `hints.json` (none → nothing at
 * all), asks the pure `planHint` for at most one line, writes the bookkeeping
 * (`hint_log` in world/README.md, no event — like `trigger_log`), and records
 * the line as a `story_event` addressed to the speaker with `hint: <id>`, so
 * the companion's agent knows next turn that it just said it. The page shows
 * the line itself (✦ in the dock, or a margin note on the writer's tray); no
 * event card, no model call.
 *
 * The speaker must be on the player's page (or following): a companion left
 * behind in another car does not shout across the train — the line becomes
 * the writer's margin note instead (§2.3).
 */
import type { ActionContext } from './types.js';
import { parseFrontmatter, stringifyFrontmatter } from '../schemas/frontmatter.js';
import { reachedEnding } from './closed-world-state.js';
import { recordStoryEvent } from './story-event.js';
import { playerPageOf } from './tick.js';
import { loadTriggerWorld, snapshotTriggerWorld } from '../commands/world-triggers.js';
import { optionStatesOf } from './option-state.js';
import type { HintTable } from '../rules/hints.js';
import {
  HINT_LOG_KEY,
  HINTS_FILE,
  hintPathsOf,
  hintViewOf,
  parseHintLog,
  parseHintTable,
  planHint,
  spentHintIds,
  type HintLog,
  type HintView,
} from '../rules/hints.js';

const README = 'world/README.md';

/** Hints whose suggested options are all done already (the same answer the page uses to hide them). */
async function spentHints(ctx: ActionContext, table: HintTable): Promise<Set<string>> {
  const cardPaths = new Set<string>();
  for (const h of table.hints) for (const s of h.suggest ?? []) if ('card' in s) cardPaths.add(s.card);
  if (cardPaths.size === 0) return new Set();
  const cards: { path: string; frontmatter: Record<string, unknown> | null }[] = [];
  for (const path of cardPaths) {
    if ((await ctx.store.statKind(path)) !== 'file') continue;
    try {
      cards.push({ path, frontmatter: (parseFrontmatter(await ctx.store.readFile(path)).frontmatter ?? null) as Record<string, unknown> | null });
    } catch { /* unreadable: its options count as not done */ }
  }
  const states = await optionStatesOf(ctx.store, cards).catch(() => ({} as Awaited<ReturnType<typeof optionStatesOf>>));
  return spentHintIds(table, (card, option) => states[card]?.done.includes(option) ?? false);
}

async function readLog(ctx: ActionContext): Promise<HintLog> {
  if ((await ctx.store.statKind(README)) !== 'file') return parseHintLog(null);
  const fm = parseFrontmatter(await ctx.store.readFile(README)).frontmatter ?? {};
  return parseHintLog((fm as Record<string, unknown>)[HINT_LOG_KEY]);
}

/** Bookkeeping write: re-reads the file so keys written meanwhile (tick, trigger_log) survive. */
async function writeLog(ctx: ActionContext, log: HintLog): Promise<void> {
  if ((await ctx.store.statKind(README)) !== 'file') return;
  const parsed = parseFrontmatter(await ctx.store.readFile(README));
  const fm = (parsed.frontmatter ?? {}) as Record<string, unknown>;
  await ctx.store.writeFileAtomic(README, stringifyFrontmatter({ ...fm, [HINT_LOG_KEY]: log }, parsed.body));
}

export interface HintBeatOptions {
  /** The page the player is looking at (the page's own report). */
  page?: string | null;
  /** The player asked (「卡住了」): `gap` and `idle` do not apply, no beat is counted. */
  stuck?: boolean;
  /** A character already spoke up this beat (character tick v2): count the beat, say nothing — the hint waits a beat. */
  hold?: boolean;
}

/**
 * Would a written hint be said this beat (character tick v2: hints win when the player is stuck)? Read-only:
 * the same plan `runHintBeat` makes, nothing written. False for a world without hints.json.
 */
export async function hintDueNow(ctx: ActionContext, opts: { page?: string | null } = {}): Promise<boolean> {
  const { store } = ctx;
  if ((await store.statKind(HINTS_FILE)) !== 'file') return false;
  const { table } = parseHintTable(await store.readFile(HINTS_FILE));
  if (!table) return false;
  const world = await loadTriggerWorld(store);
  if (!world || (await reachedEnding(store, world.manifest))) return false;
  const snap = await snapshotTriggerWorld(store, world);
  const paths = new Map(snap.paths);
  for (const p of hintPathsOf(table, world.characterIds)) if (!paths.has(p)) paths.set(p, await store.statKind(p));
  const page = await playerPageOf(store, world.manifest as unknown as Record<string, unknown>, opts.page);
  const plan = planHint(table, { page, values: snap.values, paths, characterIds: world.characterIds }, await readLog(ctx), { count: true, spent: await spentHints(ctx, table) });
  return plan.hint !== null;
}

/** One beat's hint, or null (no table, the story ended, nothing to say). Never throws for a world without hints. */
export async function runHintBeat(ctx: ActionContext, opts: HintBeatOptions = {}): Promise<HintView | null> {
  const { store } = ctx;
  if ((await store.statKind(HINTS_FILE)) !== 'file') return null;
  const { table } = parseHintTable(await store.readFile(HINTS_FILE));
  if (!table) return null;
  const world = await loadTriggerWorld(store);
  if (!world) return null;
  if (await reachedEnding(store, world.manifest)) return null;
  const snap = await snapshotTriggerWorld(store, world);
  const paths = new Map(snap.paths);
  for (const p of hintPathsOf(table, world.characterIds)) if (!paths.has(p)) paths.set(p, await store.statKind(p));
  const page = await playerPageOf(store, world.manifest as unknown as Record<string, unknown>, opts.page);
  const prior = await readLog(ctx);
  const plan = planHint(table, { page, values: snap.values, paths, characterIds: world.characterIds }, prior, { stuck: opts.stuck, count: !opts.stuck, hold: opts.hold === true && !opts.stuck, spent: await spentHints(ctx, table) });
  await writeLog(ctx, plan.log);
  const view = hintViewOf(plan);
  if (!view) return null;
  // The speaker has to be here to say it; otherwise the writer notes it in the margin.
  const config = world.manifest.characters?.find((c) => c.id === view.by);
  if (view.by !== 'writer') {
    const presence = config ? store.getPresenceOf(view.by) : null;
    const here = config ? (presence ? presence.layer === page || presence.following : (config.home ?? 'map') === page) : false;
    if (!here) view.by = 'writer';
  }
  await recordStoryEvent(ctx, {
    target: view.by === 'writer' ? page : `characters/${view.by}`,
    title: view.by === 'writer' ? 'Margin note' : (config?.name ?? view.by),
    text: view.say,
    hint: view.id,
  });
  return view;
}
