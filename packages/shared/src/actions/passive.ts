/**
 * Passive checks — the dark roll.
 *
 * Called when the PLAYER enters a place (`enterLayer`) or reads a card through
 * a declared option (the server's `runDeclaredChoice`). For every `passive:`
 * declaration that applies and was not tried this loop: pick the roller (the
 * player, or a companion with the player who lends a better number), roll the
 * skill with the world's rules, and log it in `world/README.md` `passive_log`
 * (engine bookkeeping, no event — like `hint_log`). On a success the find is
 * created (a roll happened first: 「没掷骰，就没有物品」 still holds) and the line
 * lands as a story event — said by the companion when the number was theirs.
 * A failure leaves nothing visible; a fumble costs nothing.
 *
 * Never throws: a passive roll must not break entering a place.
 */
import { parseFrontmatter, stringifyFrontmatter } from '../schemas/frontmatter.js';
import { checkSpec, rollCheck, type CheckGrade } from '../rules/skills.js';
import { hintPathsOf, hintHolds, type HintEntry } from '../rules/hints.js';
import { parsePassive, parsePassiveLog, passiveKey, PASSIVE_LOG_KEY, type PassiveDecl, type PassiveFind, type PassiveLogEntry } from '../rules/passive.js';
import { loadTriggerWorld, snapshotTriggerWorld } from '../commands/world-triggers.js';
import { reachedEnding } from './closed-world-state.js';
import { createEntity } from './create.js';
import { recordStoryEvent } from './story-event.js';
import { rulesOfWorld } from './skill-cards.js';
import { rollerFor } from './assist.js';
import { eventsThisLoop } from './loop-history.js';
import type { TutorialCueId } from '../rules/tutorial-cues.js';
import type { ActionContext } from './types.js';

const README = 'world/README.md';

export interface PassiveResult {
  id: string;
  file: string;
  skill: string;
  label: string;
  /** `player` or the companion's id. */
  by: string;
  /** The companion's name ('' for the player). */
  name: string;
  grade: CheckGrade;
  say?: string;
  finds: Array<{ path: string; title: string }>;
}

export interface PassiveRun {
  /** Successes only: a failure is never shown. */
  found: PassiveResult[];
  /** How many declarations were rolled this call (successes and failures). */
  rolled: number;
  /** The teach-once cue when something was found. */
  cue?: TutorialCueId;
}

const EMPTY: PassiveRun = { found: [], rolled: 0 };

async function readLog(ctx: ActionContext): Promise<Record<string, PassiveLogEntry>> {
  if ((await ctx.store.statKind(README)) !== 'file') return {};
  const fm = parseFrontmatter(await ctx.store.readFile(README)).frontmatter ?? {};
  return parsePassiveLog((fm as Record<string, unknown>)[PASSIVE_LOG_KEY]);
}

async function writeLog(ctx: ActionContext, log: Record<string, PassiveLogEntry>): Promise<void> {
  if ((await ctx.store.statKind(README)) !== 'file') return;
  const parsed = parseFrontmatter(await ctx.store.readFile(README));
  const fm = (parsed.frontmatter ?? {}) as Record<string, unknown>;
  await ctx.store.writeFileAtomic(README, stringifyFrontmatter({ ...fm, [PASSIVE_LOG_KEY]: log }, parsed.body));
}

/** The declaration's `when` against the world now (the same reading as the companion's hints). */
async function holds(ctx: ActionContext, decl: PassiveDecl, page: string): Promise<boolean> {
  if (!decl.when) return true;
  const world = await loadTriggerWorld(ctx.store);
  if (!world) return false;
  const probe = { id: 'passive', say: '-', when: { ...decl.when } } as unknown as HintEntry;
  const snap = await snapshotTriggerWorld(ctx.store, world);
  const paths = new Map(snap.paths);
  for (const p of hintPathsOf({ hints: [probe] }, world.characterIds)) if (!paths.has(p)) paths.set(p, await ctx.store.statKind(p));
  return hintHolds(probe, { page, values: snap.values, paths, seen: [], characterIds: world.characterIds });
}

/** Create a find unless something is already there or it was created (and moved / used) before this loop. */
async function landFind(ctx: ActionContext, find: PassiveFind, source: { file: string; id: string; skill: string; by: string; grade: CheckGrade }): Promise<boolean> {
  if ((await ctx.store.statKind(find.path)) !== 'missing') return false;
  if ((await eventsThisLoop(ctx.store)).some((e) => e.type === 'entity_created' && e.detail?.path === find.path)) return false;
  await createEntity({ ...ctx, actor: { type: 'engine' } }, {
    path: find.path,
    frontmatter: { type: 'note', title: find.title, portable: find.portable, passive_find: { source: source.file, id: source.id, skill: source.skill, by: source.by, grade: source.grade } },
    body: find.body,
  });
  return true;
}

export interface PassiveInput {
  trigger: 'enter' | 'look';
  /** enter: the layer entered. */
  layer?: string;
  /** look: the cards the player read. */
  paths?: string[];
}

export async function runPassiveChecks(ctx: ActionContext, input: PassiveInput): Promise<PassiveRun> {
  try {
    if (ctx.actor.type !== 'player') return EMPTY;
    const { store } = ctx;
    const w = await rulesOfWorld(store);
    if (!w) return EMPTY;
    if (await reachedEnding(store)) return EMPTY;
    const targets: Array<{ file: string; page: string; readme: boolean }> = [];
    if (input.trigger === 'enter' && input.layer) {
      targets.push({ file: input.layer === 'map' ? README : `${input.layer}/README.md`, page: input.layer, readme: true });
    } else if (input.trigger === 'look') {
      for (const p of input.paths ?? []) {
        if (!/^world\/.+\.md$/.test(p) || /\/README\.md$/.test(p)) continue;
        targets.push({ file: p, page: (await store.resolveLayer(p)) ?? 'map', readme: false });
      }
    }
    if (targets.length === 0) return EMPTY;
    let log: Record<string, PassiveLogEntry> | null = null;
    const found: PassiveResult[] = [];
    let rolled = 0;
    for (const t of targets) {
      if ((await store.statKind(t.file)) !== 'file') continue;
      const { passives } = parsePassive((parseFrontmatter(await store.readFile(t.file)).frontmatter ?? null) as Record<string, unknown> | null, t.readme);
      for (const decl of passives) {
        if (decl.on !== input.trigger) continue;
        log ??= await readLog(ctx);
        const key = passiveKey(t.file, decl.id);
        if (log[key]) continue;
        if (!(await holds(ctx, decl, t.page))) continue;
        // Nobody here has the skill: nothing is rolled and nothing is logged (a companion may come later).
        const who = await rollerFor(store, w, decl.skill, t.page);
        if (!who) continue;
        const spec = checkSpec({ system: w.rules.system, value: who.value, difficulty: decl.difficulty });
        const outcome = rollCheck(spec, ctx.rng ?? Math.random);
        rolled += 1;
        log[key] = { grade: outcome.grade, by: who.actor };
        if (!outcome.passed) continue;
        const great = outcome.grade === 'great' && decl.great ? decl.great : null;
        const say = great?.say ?? decl.say;
        const finds: Array<{ path: string; title: string }> = [];
        const source = { file: t.file, id: decl.id, skill: decl.skill, by: who.actor, grade: outcome.grade };
        for (const find of [decl.find, great?.find]) {
          if (find && (await landFind(ctx, find, source))) finds.push({ path: find.path, title: find.title });
        }
        const text = say ?? finds.map((f) => f.title).join(' / ');
        if (!text) continue;
        const companion = who.actor !== 'player';
        await recordStoryEvent({ ...ctx, actor: { type: 'engine' } }, {
          target: companion ? `characters/${who.actor}` : t.page === 'map' ? 'map' : t.page,
          title: companion ? `${who.name} · ${who.label}` : who.label,
          text,
          passive: { id: decl.id, file: t.file, skill: decl.skill, by: who.actor, grade: outcome.grade },
        });
        found.push({ id: decl.id, file: t.file, skill: decl.skill, label: who.label, by: who.actor, name: who.name, grade: outcome.grade, ...(say ? { say } : {}), finds });
      }
    }
    if (log && rolled > 0) await writeLog(ctx, log);
    return { found, rolled, ...(found.length ? { cue: 'first-passive' as const } : {}) };
  } catch {
    return EMPTY;
  }
}
