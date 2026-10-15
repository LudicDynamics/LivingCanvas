/**
 * The turn-end command: a world whose `experience`
 * names `turnEnd` gets that `command/<id>.yaml` run once after every player
 * turn (`POST /api/turn-end`, sent by the page when an answer or a writer turn
 * settles). It is how a guided experience lands a beat BY COMMAND — the
 * prologue counts turns in a declared state and its state triggers drop the
 * notebook after the first one and open the door by the eighth — instead of
 * hoping the model remembers to.
 *
 * The command runs through the ordinary executor as the player, then the
 * world's triggers are evaluated once (a command's own effects never fire
 * triggers: commandDepth). After an ending nothing runs.
 *
 * A world that declares `tick` also takes its
 * character beat here, after the turn-end command: the same page call is the
 * player's beat for both. A world with `hints.json` picks its
 * companion's hint last (actions/hints.ts).
 *
 * Contract: never throws for a world without a turn-end (returns `ran: false`);
 * a malformed command file is an ActionError the route reports.
 */
import type { ActionContext } from '../actions/types.js';
import { fail } from '../actions/errors.js';
import { reachedEnding } from '../actions/closed-world-state.js';
import { worldExperienceOf } from '../rules/experience.js';
import { collectHasPaths } from './condition.js';
import type { ConditionAst } from './condition.js';
import type { CommandTriggerHook } from './bindings.js';
import { runWorldCommand } from './execute.js';
import { parseWorldCommand } from './world-command.js';
import { runWorldTriggers, type FiredTrigger } from './world-triggers.js';
import { runTickBeat, type TickBeatOptions, type TickBeatResult } from '../actions/tick.js';
import { hintDueNow, runHintBeat } from '../actions/hints.js';
import type { HintView } from '../rules/hints.js';

export interface TurnEndResult {
  /** false: this world has no turn-end command, or its story has ended. */
  ran: boolean;
  command: string | null;
  effects: number;
  triggers: FiredTrigger[];
}

export async function runTurnEnd(
  ctx: ActionContext,
  opts: { tick?: TickBeatOptions } = {},
): Promise<{ text: string; details: { turnEnd: TurnEndResult; tick: TickBeatResult; hint: HintView | null } }> {
  const first = await runExperienceTurnEnd(ctx);
  const page = opts.tick?.page ?? null;
  // Never a written hint and a character's own line in the same beat:
  // the hint wins when it is due (the player is stuck); otherwise the people may speak and the hint waits.
  const quiet = await hintDueNow(ctx, { page }).catch(() => false);
  // The character beat: its own triggers run inside it.
  const tick = await runTickBeat(ctx, { ...(opts.tick ?? {}), quiet });
  // The companion's written hint, last.
  let hint = await runHintBeat(ctx, { page, hold: tick.spoke === true });
  // A character's nudge that points the way (a chatter move's `suggest`) hands its slips over like a hint does.
  if (!hint && tick.said && tick.suggest?.length) hint = tickNudgeHint(tick);
  return { text: first.text, details: { turnEnd: first.details.turnEnd, tick, hint } };
}

/** The tick nudge as the page's hint (the writer's slips): id `tick:<log id>`; the words are the person's own. */
function tickNudgeHint(tick: TickBeatResult): HintView | null {
  const entry = tick.view.recent.find((e) => e.id === tick.said);
  const say = entry?.words?.say ?? entry?.words?.invite;
  if (!entry || !say) return null;
  // Only what can be pressed on this page: a card here (its own directory is the page), or another place.
  const pageOf = (card: string) => { const dir = card.split('/').slice(0, -1).join('/'); return dir === 'world' ? 'map' : dir; };
  const suggest = (tick.suggest ?? []).filter((s) => ('card' in s ? pageOf(s.card) === entry.page : s.enter !== entry.page));
  if (suggest.length === 0) return null;
  return { id: `tick:${entry.id}`, by: entry.actor, say, suggest, replies: [], beat: tick.view.beat };
}

async function runExperienceTurnEnd(ctx: ActionContext): Promise<{ text: string; details: { turnEnd: TurnEndResult } }> {
  const manifest = await ctx.store.getManifest();
  const id = worldExperienceOf(manifest)?.turnEnd ?? null;
  const none = (text: string) => ({ text, details: { turnEnd: { ran: false, command: id, effects: 0, triggers: [] } } });
  if (!id) return none('This world has no turn-end command.');
  if (await reachedEnding(ctx.store, manifest as never)) return none('The story has ended.');
  const file = `command/${id}.yaml`;
  if ((await ctx.store.statKind(file)) !== 'file') fail('not_found', `experience.turnEnd names ${file}, which does not exist.`);
  const parsed = parseWorldCommand(id, await ctx.store.readFile(file));
  if (!parsed.ok) fail('invalid_argument', `${file} is malformed: ${parsed.errors.map((e) => e.message).join('; ')}`);
  const spec = parsed.command;
  const paths = new Map<string, 'file' | 'dir' | 'missing'>();
  for (const step of spec.steps) {
    if (!step.whenAst) continue;
    for (const p of collectHasPaths(step.whenAst as ConditionAst)) if (!paths.has(p)) paths.set(p, await ctx.store.statKind(p));
  }
  const run = await runWorldCommand(ctx, spec, {
    hook: 'trigger' as CommandTriggerHook,
    entry: 0,
    key: `turn-end:${id}:${ctx.turn ?? ''}`,
    argScope: { params: {}, trigger: {} },
    conditionValues: {},
    conditionPaths: paths,
  });
  if (!run.ok) fail('invalid_argument', `turn-end "${id}": ${run.error.message}`);
  const effects = run.result.effects.filter((e) => e.settle !== 'failed').length;
  const triggers = await runWorldTriggers(ctx, { kind: 'action', action: 'turnEnd' });
  return { text: `Turn ended (${id}).`, details: { turnEnd: { ran: true, command: id, effects, triggers } } };
}
