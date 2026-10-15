/**
 * The four-tier rules for AUTHORED dice (check:worlds; the design notes).
 *
 * For one authored dice card — a `search:` spot or a card carrying `roll_dice`
 * with `dice_outcomes` / `on.roll_resolved` — work out, per tier, what the
 * world gives and what it costs (band rewards / harm / cost / bonus, plus the
 * world commands its `on.roll_resolved` bindings run at that rank), then check:
 *
 *   1. four tiers are declared (four bands, or bindings, or `dice_tiers: inherit`);
 *   2. a 失败 / 大失败 never hands over a key clue;
 *   3. a 大失败 costs something a 成功 does not;
 *   4. a 大成功 gives something a 成功 does not.
 *
 * 3 and 4 apply where the engine enforces consequences (跑团 worlds, `diceEnforced`).
 *
 * Pure: the caller reads the files. Conditions are judged per rank by their
 * roll atoms only (`roll.rank`, `roll.grade`, `roll.outcome`, `roll.passed`);
 * any other atom (a `has(...)`, a state) is assumed it MAY hold.
 */
import { bandGradesOf } from './skill-cards.js';
import { outcomeOfGrade, parseEffect, effectDirection, OUTCOME_TIERS, type OutcomeTier } from '../rules/outcome-tiers.js';

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);

export interface TierCommand {
  steps: Array<{ action: string; when?: string; args?: Record<string, unknown> }>;
}

export interface TierLedger {
  gives: Set<string>;
  /** Gives the author marked `partial: true` — a half clue, never a key clue's full proof. */
  partial: Set<string>;
  costs: Set<string>;
  bonuses: Set<string>;
}

const RANK: Record<OutcomeTier, number> = { crit_fail: 1, fail: 2, success: 3, crit_success: 4 };
const GRADE_OF_RANK = ['', 'failure', 'setback', 'success', 'great'];

function atomHolds(atom: string, rank: number): boolean {
  const a = atom.trim().replace(/^\(+|\)+$/g, '');
  let m = /^roll\.(?:rank|outcome_rank)\s*(==|!=|>=|<=|>|<)\s*(\d+)$/.exec(a);
  if (m) {
    const n = Number(m[2]);
    return m[1] === '==' ? rank === n : m[1] === '!=' ? rank !== n : m[1] === '>=' ? rank >= n : m[1] === '<=' ? rank <= n : m[1] === '>' ? rank > n : rank < n;
  }
  m = /^roll\.(grade|outcome)\s*(==|!=)\s*["']?([a-z_-]+)["']?$/.exec(a);
  if (m) {
    const actual = m[1] === 'grade' ? GRADE_OF_RANK[rank] : OUTCOME_TIERS[rank - 1];
    return (actual === m[3]) === (m[2] === '==');
  }
  m = /^roll\.passed\s*(==|!=)\s*(true|false)$/.exec(a);
  if (m) return ((rank >= 3) === (m[2] === 'true')) === (m[1] === '==');
  if (/^roll\.passed$/.test(a)) return rank >= 3;
  if (/^!\s*roll\.passed$/.test(a)) return rank < 3;
  return true;
}

/** Could `when` hold at this rank? Absent → always. */
export function conditionMayHold(when: unknown, rank: number): boolean {
  if (typeof when !== 'string' || when.trim() === '') return true;
  return when.split('||').some((group) => group.split('&&').every((atom) => atomHolds(atom, rank)));
}

function bindingsOf(on: unknown): Array<{ when?: string; run?: string; do?: unknown[] }> {
  const raw = isObj(on) ? on.roll_resolved : undefined;
  const list = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  return list.filter(isObj) as Array<{ when?: string; run?: string; do?: unknown[] }>;
}

const COST_ACTIONS = new Set(['consume', 'end']);

function addCommandEffects(ledger: TierLedger, steps: TierCommand['steps'], rank: number, label: string): void {
  for (const step of steps) {
    if (!conditionMayHold(step.when, rank)) continue;
    const args = step.args ?? {};
    const tag = `${label}:${step.action}${step.when ? `[${step.when}]` : ''}:${JSON.stringify(args).slice(0, 80)}`;
    if (step.action === 'give') {
      const fm = isObj(args.frontmatter) ? args.frontmatter : {};
      if (typeof args.path === 'string') (fm.partial === true ? ledger.partial : ledger.gives).add(args.path);
      if (Array.isArray(args.rewards)) for (const r of args.rewards) if (isObj(r) && typeof r.path === 'string') ledger.gives.add(r.path);
      ledger.bonuses.add(tag);
    } else if (step.action === 'tick') {
      const by = Number(args.by ?? -1);
      (by < 0 ? ledger.costs : ledger.bonuses).add(tag);
    } else if (step.action === 'add_state') {
      const by = Number(args.by ?? 0);
      // A state where up is worse (suspicion) cannot be told apart here; any move counts on both sides.
      (by < 0 ? ledger.costs : ledger.bonuses).add(tag);
      if (by > 0) ledger.costs.add(tag);
    } else if (step.action === 'set_state') {
      ledger.costs.add(tag);
    } else if (COST_ACTIONS.has(step.action) || step.action === 'event') {
      ledger.costs.add(tag);
    }
  }
}

/** Per-tier ledger of one authored card. */
export function tierLedgers(
  card: Record<string, any>,
  commands: ReadonlyMap<string, TierCommand>,
): Record<OutcomeTier, TierLedger> {
  const out = Object.fromEntries(OUTCOME_TIERS.map((t) => [t, { gives: new Set<string>(), partial: new Set<string>(), costs: new Set<string>(), bonuses: new Set<string>() }])) as Record<OutcomeTier, TierLedger>;
  const bands = Array.isArray(card.dice_outcomes) ? card.dice_outcomes : [];
  const grades = bands.length ? bandGradesOf(card) : null;
  bands.forEach((band: unknown, i: number) => {
    const tier = outcomeOfGrade(grades?.[i]);
    if (!tier || !isObj(band)) return;
    const l = out[tier];
    for (const r of Array.isArray(band.rewards) ? band.rewards : []) if (isObj(r) && typeof r.path === 'string') (r.partial === true ? l.partial : l.gives).add(r.path);
    if (typeof band.harm === 'string') l.costs.add(`harm:${band.harm}`);
    for (const key of ['cost', 'bonus'] as const) {
      const raw = band[key];
      if (raw === undefined) continue;
      if (raw === 'inherit') (key === 'cost' ? l.costs : l.bonuses).add(`${key}:inherit`);
      for (const item of Array.isArray(raw) ? raw : [raw]) {
        const p = parseEffect(item);
        if (p.ok) (effectDirection(p.value) === 'cost' ? l.costs : l.bonuses).add(`${key}:${JSON.stringify(item)}`);
      }
    }
  });
  for (const tier of OUTCOME_TIERS) {
    const rank = RANK[tier];
    for (const b of bindingsOf(card.on)) {
      if (!conditionMayHold(b.when, rank)) continue;
      if (typeof b.run === 'string') {
        const cmd = commands.get(b.run);
        if (cmd) addCommandEffects(out[tier], cmd.steps, rank, b.run);
      }
      if (Array.isArray(b.do)) {
        addCommandEffects(out[tier], b.do.filter(isObj).map((s) => ({ action: String(s.action), when: typeof s.when === 'string' ? s.when : undefined, args: isObj(s.with) ? s.with : {} })), rank, 'inline');
      }
    }
  }
  return out;
}

/** The rule check for one card. `keys`: the world's key clue paths. */
export function diceTierProblems(
  where: string,
  card: Record<string, any>,
  keys: ReadonlySet<string>,
  commands: ReadonlyMap<string, TierCommand>,
  /** False in a story / free world: tiers are shown and narrated, costs are a later design. */
  enforced = true,
): string[] {
  const problems: string[] = [];
  const inherit = card.dice_tiers === 'inherit';
  const bands = Array.isArray(card.dice_outcomes) ? card.dice_outcomes : null;
  const hasBindings = bindingsOf(card.on).length > 0;
  if (!inherit && !(bands && bands.length === 4) && !hasBindings) {
    problems.push(`${where}: declare all four tiers (four dice_outcomes bands, on.roll_resolved by roll.rank, or dice_tiers: inherit)`);
    return problems;
  }
  const l = tierLedgers(card, commands);
  for (const tier of ['fail', 'crit_fail'] as const) {
    const leaked = [...l[tier].gives].filter((p) => keys.has(p));
    if (leaked.length) problems.push(`${where}: a ${tier === 'fail' ? '失败 fail' : '大失败 crit_fail'} hands over the key clue ${leaked.join(', ')}; give a half clue and a cost instead`);
  }
  if (!inherit && enforced) {
    const extraCost = [...l.crit_fail.costs].some((c) => !l.success.costs.has(c));
    if (!extraCost) problems.push(`${where}: a 大失败 crit_fail has no cost of its own (harm, cost:, or a rank-1 command that ticks / moves a state)`);
    // Extra = a give / bonus the 成功 lacks, or a cost the 成功 pays that the 大成功 skips (雾坞: "costs no tide").
    const extraGift = [...l.crit_success.gives].some((g) => !l.success.gives.has(g))
      || [...l.crit_success.bonuses].some((b) => !l.success.bonuses.has(b))
      || [...l.success.costs].some((c) => !l.crit_success.costs.has(c));
    if (!extraGift) problems.push(`${where}: a 大成功 crit_success gives nothing a 成功 success does not (an extra reward, bonus:, or a rank-4 command)`);
  }
  return problems;
}
