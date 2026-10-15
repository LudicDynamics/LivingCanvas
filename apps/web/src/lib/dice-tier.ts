/**
 * The four outcome tiers on screen.
 *
 * One projection for every place a roll is shown — the ceremony, the dice card
 * on the canvas, the debrief tally — so 大成功 / 成功 / 失败 / 大失败 always
 * read the same: a tier id (CSS hook `data-outcome`), its label, and the one
 * consequence chip the engine recorded.
 */
import { isOutcomeTier, outcomeOfGrade, outcomeOfRoll, type OutcomeTier } from '@airp/shared/outcome-tiers';

export type { OutcomeTier };

export interface ConsequenceChip {
  /** applied: paid; pending: owed, the writer has until its turn ends. */
  status: 'applied' | 'pending' | 'none';
  /** cost / bonus — the chip's colour. */
  direction: 'cost' | 'bonus' | null;
  /** What was paid ("潮水 −1"), in the world's language; null when nothing to say yet. */
  line: string | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** The tier of a roll payload: the server's `outcome`, else derived from grade / booleans. */
export function outcomeOfPayload(raw: unknown): OutcomeTier | null {
  if (!isRecord(raw)) return null;
  if (isOutcomeTier(raw.outcome)) return raw.outcome;
  const skill = isRecord(raw.skill) ? raw.skill : null;
  const grade = skill?.grade ?? raw.outcomeGrade;
  if (typeof raw.passed !== 'boolean') return outcomeOfGrade(grade);
  return outcomeOfRoll({ grade, passed: raw.passed, crit: raw.crit === true, fumble: raw.fumble === true });
}

/**
 * The `consequence` summary the server attaches (details / frame) — the same
 * shape as the card's record (`due` + `applied`), so both read through
 * `chipOfRecord`; the prefix ("Cost: …") is the UI locale's, the "what" the world's.
 */
export function consequenceChipOf(raw: unknown): ConsequenceChip | null {
  return isRecord(raw) ? chipOfRecord(raw) : null;
}

/**
 * A resolved card's tier + chip from its frontmatter: the `dice_consequence`
 * record first, then the receipt's `outcome`, then the legacy `dice_grade`.
 */
export function cardTierOf(fm: Record<string, unknown> | null | undefined): { outcome: OutcomeTier; chip: ConsequenceChip | null } | null {
  if (!fm) return null;
  const rec = isRecord(fm.dice_consequence) ? fm.dice_consequence : null;
  const receipt = isRecord(fm.dice_receipt) ? fm.dice_receipt : null;
  const rd = isRecord(fm.roll_dice) ? fm.roll_dice : null;
  const outcome = (rec && isOutcomeTier(rec.outcome) ? rec.outcome : null)
    ?? outcomeOfPayload(receipt)
    ?? outcomeOfGrade(fm.dice_grade)
    ?? (rd && typeof rd.passed === 'boolean' ? (rd.passed ? 'success' : 'fail') : null);
  if (!outcome) return null;
  return { outcome, chip: rec ? chipOfRecord(rec) : null };
}

const MINUS = '−';

/** The chip from a raw `dice_consequence` record (the card has no server-made line). */
export function chipOfRecord(rec: Record<string, unknown>): ConsequenceChip | null {
  const applied = Array.isArray(rec.applied) ? rec.applied.filter(isRecord) : [];
  const due = rec.due === 'cost' || rec.due === 'bonus' ? rec.due : null;
  const relevant = applied.filter((a) => due === null || a.direction === due);
  const shown = relevant.length ? relevant : applied;
  if (due && relevant.length === 0) return { status: 'pending', direction: due, line: null };
  if (!shown.length) return null;
  const direction = shown[0].direction === 'cost' || shown[0].direction === 'bonus' ? shown[0].direction : null;
  const what = shown.map((a) => String(a.what ?? '')).filter(Boolean).join(' · ').replace(/-(\d)/g, `${MINUS}$1`);
  return { status: 'applied', direction, line: what || null };
}

export interface DiceTally {
  rolls: number;
  byTier: Record<OutcomeTier, number>;
  /** The 大成功 / 大失败 and what each cost or gave, in order. */
  crits: Array<{ outcome: 'crit_success' | 'crit_fail'; name: string; what: string | null }>;
}

/** The debrief tally from the settlement's rolls (closed-run summary). Pure. */
export function diceTally(rolls: ReadonlyArray<{ name: string; passed: boolean | null; outcome?: string | null; consequence?: { what: string } | null }>): DiceTally {
  const byTier: Record<OutcomeTier, number> = { crit_success: 0, success: 0, fail: 0, crit_fail: 0 };
  const crits: DiceTally['crits'] = [];
  let counted = 0;
  for (const r of rolls) {
    const outcome = isOutcomeTier(r.outcome) ? r.outcome : typeof r.passed === 'boolean' ? (r.passed ? 'success' : 'fail') : null;
    if (!outcome) continue;
    counted += 1;
    byTier[outcome] += 1;
    if (outcome === 'crit_success' || outcome === 'crit_fail') crits.push({ outcome, name: r.name, what: r.consequence?.what ?? null });
  }
  return { rolls: counted, byTier, crits };
}

/** Each tier has its own sound at the settle mark: foley + optional stinger. */
export const TIER_SOUND: Readonly<Record<OutcomeTier, { foley: 'crit-chime' | 'unlock' | 'page-turn' | 'fumble-break'; intensity: number; stinger?: 'smile' | 'shock' }>> = {
  crit_success: { foley: 'crit-chime', intensity: 1, stinger: 'smile' },
  success: { foley: 'unlock', intensity: 0.7 },
  fail: { foley: 'page-turn', intensity: 0.6 },
  crit_fail: { foley: 'fumble-break', intensity: 1, stinger: 'shock' },
};

/**
 * The four tiers of a coc d100 skill check as ranges (the design notes beat 4: listed before the roll, the one
 * rolled lit after): 1–⌊target/5⌋ critical, …–target success, …–95 failure, 96–100 critical failure — the same
 * bands the cards' own words give. Null for anything else (dnd, a plain dice card, an odd target).
 */
export function cocTierRows(skill: unknown): { tier: OutcomeTier; from: number; to: number }[] | null {
  if (!isRecord(skill) || skill.system !== 'coc') return null;
  const target = Number(skill.target ?? skill.value);
  if (!Number.isInteger(target) || target < 5 || target > 94) return null;
  const extreme = Math.floor(target / 5);
  return [
    { tier: 'crit_success', from: 1, to: extreme },
    { tier: 'success', from: extreme + 1, to: target },
    { tier: 'fail', from: target + 1, to: 95 },
    { tier: 'crit_fail', from: 96, to: 100 },
  ];
}
