/**
 * The four outcome tiers every check resolves to.
 *
 * 大成功 / 成功 / 失败 / 大失败 — `crit_success | success | fail | crit_fail`.
 * The engine already judged four grades (`failure | setback | success | great`,
 * rules/skills.ts + rules/themes.ts); this module names them once for players,
 * the writer and world data, and holds the consequence vocabulary: what a tier
 * owes (a cost, a bonus) and the per-category defaults the engine applies when
 * nobody paid it.
 *
 * Zero dependencies on purpose (like rules/dice.ts): the web bundle imports it.
 */

export type OutcomeTier = 'crit_success' | 'success' | 'fail' | 'crit_fail';
export const OUTCOME_TIERS: readonly OutcomeTier[] = ['crit_fail', 'fail', 'success', 'crit_success'];
/** The engine's grade names (rules/skills.ts `CheckGrade`), kept for `roll.grade` / `roll.rank`. */
export type OutcomeGrade = 'failure' | 'setback' | 'success' | 'great';

const GRADE_TO_TIER: Readonly<Record<OutcomeGrade, OutcomeTier>> = {
  failure: 'crit_fail',
  setback: 'fail',
  success: 'success',
  great: 'crit_success',
};
const TIER_TO_GRADE: Readonly<Record<OutcomeTier, OutcomeGrade>> = {
  crit_fail: 'failure',
  fail: 'setback',
  success: 'success',
  crit_success: 'great',
};

export function isOutcomeTier(raw: unknown): raw is OutcomeTier {
  return raw === 'crit_success' || raw === 'success' || raw === 'fail' || raw === 'crit_fail';
}

/** `great` / `great-success` (the card's legacy `dice_grade`) / `setback` … → a tier; null when unknown. */
export function outcomeOfGrade(grade: unknown): OutcomeTier | null {
  if (grade === 'great-success') return 'crit_success';
  return typeof grade === 'string' && grade in GRADE_TO_TIER ? GRADE_TO_TIER[grade as OutcomeGrade] : null;
}

export function gradeOfOutcome(tier: OutcomeTier): OutcomeGrade {
  return TIER_TO_GRADE[tier];
}

/** 1 (crit_fail) … 4 (crit_success) — the same numbers as `roll.rank`. */
export function outcomeRank(tier: OutcomeTier): number {
  return OUTCOME_TIERS.indexOf(tier) + 1;
}

/**
 * The tier of ANY roll: a judged grade wins (a skill check, or a declared
 * convention's band); otherwise a plain NdM roll reads its booleans — passed
 * with every die at max is a 大成功, failed with every die at 1 a 大失败.
 */
export function outcomeOfRoll(input: { grade?: unknown; passed: boolean; crit?: boolean; fumble?: boolean }): OutcomeTier {
  const graded = outcomeOfGrade(input.grade);
  if (graded) return graded;
  if (input.passed) return input.crit ? 'crit_success' : 'success';
  return input.fumble ? 'crit_fail' : 'fail';
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

export type OutcomeLocale = 'en' | 'zh-CN' | 'ja' | 'ko';
type Words = Readonly<Record<OutcomeLocale, string>>;
const W = (en: string, zh: string, ja: string, ko: string): Words => ({ en, 'zh-CN': zh, ja, ko });
export const outcomeLocaleOf = (raw: unknown): OutcomeLocale => (raw === 'zh-CN' || raw === 'ja' || raw === 'ko' ? raw : 'en');

export const OUTCOME_LABELS: Readonly<Record<OutcomeTier, Words>> = {
  crit_success: W('Critical success', '大成功', '大成功', '대성공'),
  success: W('Success', '成功', '成功', '성공'),
  fail: W('Failure', '失败', '失敗', '실패'),
  crit_fail: W('Critical failure', '大失败', '大失敗', '대실패'),
};

export function outcomeLabel(tier: OutcomeTier, locale: unknown): string {
  return OUTCOME_LABELS[tier][outcomeLocaleOf(locale)];
}

const PREFIX: Readonly<Record<'cost' | 'bonus' | 'pending', Words>> = {
  cost: W('Cost', '代价', '代償', '대가'),
  bonus: W('Extra', '额外收获', '追加の成果', '추가 성과'),
  pending: W('Cost due', '待付代价', '支払うべき代償', '치러야 할 대가'),
};
const COMPLICATION = W('things get worse', '局势恶化', '状況が悪化', '상황 악화');
const BOON = W('luck turns your way', '时运偏向你', '運が味方する', '운이 따른다');
const LOST = W('lost', '失去', '失った', '잃음');
const BROKEN = W('broken', '损坏', '壊れた', '부서짐');
const HARM = W('hurt', '受伤', '負傷', '부상');

/** "代价：潮水 −1" / "额外收获：…" — the one-line chip under the dice. */
export function consequenceLine(kind: 'cost' | 'bonus' | 'pending', what: string, locale: unknown): string {
  const lang = outcomeLocaleOf(locale);
  const sep = lang === 'en' || lang === 'ko' ? ': ' : '：';
  return `${PREFIX[kind][lang]}${sep}${what}`;
}

export function signed(n: number): string {
  return n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0';
}

// ---------------------------------------------------------------------------
// Consequence effects
// ---------------------------------------------------------------------------

export type HarmLevel = 'light' | 'serious' | 'grave';

/**
 * One consequence. Concrete effects name their target; the TOKENS
 * (`relationship`, `resource`, `sanity`) are resolved by the engine against the
 * world's declared states, and `complication` / `boon` are the honest fallback
 * when a world declares nothing a number can land on: a visible story event the
 * writer is told to play.
 */
export type ConsequenceEffect =
  | { clock: number }
  | { state: { target: string; id: string; by: number } }
  | { harm: HarmLevel }
  | { relationship: number }
  | { resource: number }
  | { sanity: number }
  | { item: { path: string; fate: 'lost' | 'broken' } }
  | { reveal: { title: string; body: string } }
  | { complication: string | true }
  | { boon: string | true };

export type EffectKind = 'clock' | 'state' | 'harm' | 'relationship' | 'resource' | 'sanity' | 'item' | 'reveal' | 'complication' | 'boon';

export function effectKind(effect: ConsequenceEffect): EffectKind {
  return Object.keys(effect)[0] as EffectKind;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim() !== '' && v.length <= max;

/** Parse one effect; returns an error string when it is not one. */
export function parseEffect(raw: unknown): { ok: true; value: ConsequenceEffect } | { ok: false; error: string } {
  if (!isObj(raw)) return { ok: false, error: 'an effect is a mapping with exactly one of clock, state, harm, relationship, resource, sanity, item, reveal, complication, boon' };
  const keys = Object.keys(raw).filter((k) => k !== 'label');
  if (keys.length !== 1) return { ok: false, error: `an effect has exactly one kind, got ${keys.join(', ') || 'none'}` };
  const [k] = keys;
  const v = raw[k];
  switch (k) {
    case 'clock':
    case 'relationship':
    case 'resource':
    case 'sanity':
      if (!isInt(v) || v === 0 || Math.abs(v) > 3) return { ok: false, error: `${k} must be a non-zero integer between -3 and 3` };
      return { ok: true, value: { [k]: v } as ConsequenceEffect };
    case 'state':
      if (!isObj(v) || !text(v.target, 80) || !text(v.id, 32) || !isInt(v.by) || v.by === 0 || Math.abs(v.by) > 3) {
        return { ok: false, error: 'state needs { target: player | world | characters/<id>, id, by: -3..3 (not 0) }' };
      }
      return { ok: true, value: { state: { target: v.target, id: v.id, by: v.by } } };
    case 'harm':
      if (v !== 'light' && v !== 'serious' && v !== 'grave') return { ok: false, error: 'harm must be light, serious or grave' };
      return { ok: true, value: { harm: v } };
    case 'item':
      if (!isObj(v) || !text(v.path, 300) || (v.fate !== 'lost' && v.fate !== 'broken')) return { ok: false, error: 'item needs { path, fate: lost | broken }' };
      return { ok: true, value: { item: { path: v.path, fate: v.fate } } };
    case 'reveal':
      if (!isObj(v) || !text(v.title, 200) || typeof v.body !== 'string' || v.body.length > 4000) return { ok: false, error: 'reveal needs { title, body }' };
      return { ok: true, value: { reveal: { title: v.title, body: v.body } } };
    case 'complication':
    case 'boon':
      if (v !== true && !text(v, 300)) return { ok: false, error: `${k} is true or one line of text` };
      return { ok: true, value: { [k]: v } as ConsequenceEffect };
    default:
      return { ok: false, error: `unknown effect "${k}"` };
  }
}

/** Is this effect a cost (something lost) or a bonus? Signed effects read their sign; harm / lost item / complication are costs. */
export function effectDirection(effect: ConsequenceEffect): 'cost' | 'bonus' {
  const k = effectKind(effect);
  if (k === 'harm' || k === 'item' || k === 'complication') return 'cost';
  if (k === 'reveal' || k === 'boon') return 'bonus';
  const by = k === 'state' ? (effect as { state: { by: number } }).state.by : (effect as Record<string, number>)[k];
  return by < 0 ? 'cost' : 'bonus';
}

/** What a tier owes: a cost after a 大失败, a bonus after a 大成功; nothing the engine enforces otherwise. */
export function dueOf(tier: OutcomeTier): 'cost' | 'bonus' | null {
  return tier === 'crit_fail' ? 'cost' : tier === 'crit_success' ? 'bonus' : null;
}

/**
 * The bounds the writer's `dice_consequence` respects: a 大失败 may cost up to
 * 3, a 失败 at most 1 (a small cost), a 大成功 gains up to 2; a 成功 owes
 * nothing beyond its intended result, so the tool refuses it.
 */
export function effectAllowed(tier: OutcomeTier, effect: ConsequenceEffect): string | null {
  if (tier === 'success') return 'a success owes no extra consequence; narrate the intended result';
  const dir = effectDirection(effect);
  const k = effectKind(effect);
  const magnitude = k === 'state' ? Math.abs((effect as { state: { by: number } }).state.by)
    : typeof (effect as Record<string, unknown>)[k] === 'number' ? Math.abs((effect as Record<string, number>)[k]) : 1;
  if (tier === 'crit_success') {
    if (dir !== 'bonus') return 'a critical success earns a bonus (clock +1, a state +1/+2, reveal, boon), never a cost';
    if (magnitude > 2) return 'a critical success gains at most 2';
    return null;
  }
  if (dir !== 'cost') return `a ${tier === 'fail' ? 'failure' : 'critical failure'} carries a cost, never a bonus`;
  if (tier === 'fail') {
    if (magnitude > 1) return 'a failure costs at most 1 (a small cost); save bigger costs for a critical failure';
    if (k === 'harm' && (effect as { harm: HarmLevel }).harm !== 'light') return 'a failure hurts at most lightly';
  }
  return null;
}

// ---------------------------------------------------------------------------
// World defaults: `world.json` → `dice.consequences`
// ---------------------------------------------------------------------------

export type DiceCategory = 'trpg' | 'story' | 'free';

export interface DiceConsequenceConfig {
  /** Candidate chains: the engine applies the FIRST that can land in this world. */
  crit_fail: ConsequenceEffect[];
  crit_success: ConsequenceEffect[];
}

export const DEFAULT_DICE_CONSEQUENCES: Readonly<Record<DiceCategory, DiceConsequenceConfig>> = {
  trpg: {
    crit_fail: [{ clock: -1 }, { harm: 'light' }, { sanity: -1 }, { complication: true }],
    crit_success: [{ clock: 1 }, { boon: true }],
  },
  // 剧情 / 自由 worlds: where a cost lives there is a design question for later
  //. They get the tiers, the visible display and the writer's
  // guidance — no engine-enforced cost or bonus, no fallback.
  story: { crit_fail: [], crit_success: [] },
  free: { crit_fail: [], crit_success: [] },
};

/** trpg / story / free from `intro.category`; a world with dice rules but no category plays as trpg. */
export function diceCategoryOf(manifest: { intro?: { category?: unknown } | null; rules?: unknown } | null | undefined): DiceCategory {
  const c = (manifest?.intro as { category?: unknown } | undefined)?.category;
  if (c === 'trpg' || c === 'story' || c === 'free') return c;
  return manifest?.rules ? 'trpg' : 'story';
}

function chainOf(raw: unknown): ConsequenceEffect[] | null {
  const list = Array.isArray(raw) ? raw : raw === undefined ? null : [raw];
  if (!list) return null;
  const out: ConsequenceEffect[] = [];
  for (const item of list) {
    const p = parseEffect(item);
    if (p.ok) out.push(p.value);
  }
  return out.length ? out : null;
}

/**
 * The world's consequence defaults: `dice.consequences.crit_fail / crit_success`
 * (an effect or a list of candidates) over the category's defaults. Lenient —
 * an unreadable entry falls back to the category; check:worlds is strict.
 */
export function diceConsequencesOf(manifest: Record<string, unknown> | null | undefined): DiceConsequenceConfig {
  const base = DEFAULT_DICE_CONSEQUENCES[diceCategoryOf(manifest as never)];
  const dice = isObj(manifest?.dice) ? manifest!.dice as Record<string, unknown> : null;
  const own = dice && isObj(dice.consequences) ? dice.consequences : null;
  return {
    crit_fail: chainOf(own?.crit_fail) ?? base.crit_fail,
    crit_success: chainOf(own?.crit_success) ?? base.crit_success,
  };
}

/**
 * Does the engine ENFORCE consequences here? 跑团 (trpg) worlds — the worlds
 * that declare states and clocks — and any world that declares its own
 * `dice.consequences`. Story / free worlds only show and narrate the tiers.
 */
export function diceEnforced(manifest: Record<string, unknown> | null | undefined): boolean {
  const dice = isObj(manifest?.dice) ? (manifest!.dice as Record<string, unknown>) : null;
  if (dice && isObj(dice.consequences)) return true;
  return diceCategoryOf(manifest as never) === 'trpg';
}

/** Problems in a world's `dice` block (check:worlds). */
export function diceConfigProblems(manifest: Record<string, unknown>): string[] {
  if (manifest.dice === undefined) return [];
  if (!isObj(manifest.dice)) return ['dice must be a mapping'];
  const c = (manifest.dice as Record<string, unknown>).consequences;
  if (c === undefined) return [];
  if (!isObj(c)) return ['dice.consequences must be a mapping of crit_fail / crit_success'];
  const out: string[] = [];
  for (const [tier, raw] of Object.entries(c)) {
    if (tier !== 'crit_fail' && tier !== 'crit_success') {
      out.push(`dice.consequences.${tier}: only crit_fail and crit_success have defaults`);
      continue;
    }
    for (const [i, item] of (Array.isArray(raw) ? raw : [raw]).entries()) {
      const p = parseEffect(item);
      if (!p.ok) out.push(`dice.consequences.${tier}[${i}]: ${p.error}`);
      else if (effectDirection(p.value) !== (tier === 'crit_fail' ? 'cost' : 'bonus')) out.push(`dice.consequences.${tier}[${i}]: a ${tier === 'crit_fail' ? 'critical failure costs' : 'critical success gains'} something`);
    }
  }
  return out;
}

/** Words for an effect once resolved: "潮水 −1", "失去：灯油", "受伤". */
export function effectWords(effect: ConsequenceEffect, locale: unknown, names: { label?: string } = {}): string {
  const lang = outcomeLocaleOf(locale);
  const k = effectKind(effect);
  const v = (effect as Record<string, unknown>)[k];
  switch (k) {
    case 'harm':
      return HARM[lang];
    case 'item': {
      const it = v as { path: string; fate: 'lost' | 'broken' };
      const name = names.label ?? it.path.split('/').pop()!.replace(/\.md$/, '');
      return `${(it.fate === 'lost' ? LOST : BROKEN)[lang]} ${name}`;
    }
    case 'reveal':
      return (v as { title: string }).title;
    case 'complication':
      return typeof v === 'string' ? v : COMPLICATION[lang];
    case 'boon':
      return typeof v === 'string' ? v : BOON[lang];
    case 'state':
      return `${names.label ?? (v as { id: string }).id} ${signed((v as { by: number }).by)}`;
    default:
      return `${names.label ?? k} ${signed(v as number)}`;
  }
}

/** The compact table the writer reads (extensions/instructions.ts + the roll text). */
export const OUTCOME_WRITER_TABLE = [
  '| tier | grade | what you MUST do after the roll |',
  '|---|---|---|',
  '| crit_success 大成功 | great | an extra reward on top of the result: a hidden clue (reveal), an item, ally trust +1, clock +1 — dice_consequence |',
  '| success 成功 | success | the intended result, nothing extra |',
  '| fail 失败 | setback | a partial result plus a small cost or complication (at most 1) — dice_consequence |',
  '| crit_fail 大失败 | failure | a real cost: clock −1/−2, hp / sanity down, an item lost or broken, suspicion up, a door locks, an enemy appears — dice_consequence |',
].join('\n');
