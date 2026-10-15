/**
 * The inspiration roll — the pure rules.
 *
 *: players kept rolling Spot Hidden and Occult to ask "what am I
 * missing / how do I get Kuri out" — they wanted a hint. The inspiration roll is
 * that hint, made honest: the player rolls it from the character sheet when
 * stuck; the TIER decides how clear the hint is; and the hint itself only ever
 * comes from the world's written `hints.json` lines whose conditions hold now
 * (what the player has seen and holds, the place they are in, the step the
 * world designed next) — never from the run's hidden truth, never from a model.
 *
 *   大成功 great   → the sharpest line (a ladder's top rung, `inspire.sharp`) + the slips it suggests
 *   成功 success   → the line the companion would say next (a ladder's next rung) + its slips
 *   失败 setback   → a vague line (`inspire.vague`, else a generic one); no slips; the hint is not used up
 *   大失败 failure → no hint, a small cost the world decides (`inspiration.fumble`, else the trpg default
 *                    chain; story / free worlds pay in time instead: a longer wait)
 *
 * Frequency: one roll per clock step in a world with a clock, otherwise one per
 * few player actions; a per-loop cap. No I/O: `actions/inspiration.ts` reads and writes.
 */
import { hintHolds, type HintEntry, type HintSuggest, type HintTable, type HintWorldState, type HintLog } from './hints.js';
import { parseEffect, type ConsequenceEffect } from './outcome-tiers.js';
import type { CheckGrade, SkillLocalized } from './skills.js';
import { skillLocaleOf } from './skills.js';

export const INSPIRATION_LOG_KEY = 'inspiration_log';
export const INSPIRATION_DEFAULT_VALUE = 50;
export const INSPIRATION_DEFAULT_MAX = 5;
export const INSPIRATION_DEFAULT_ACTIONS = 3;

const L = (en: string, zh: string, ja: string, ko: string): SkillLocalized => ({ en, 'zh-CN': zh, ja, ko });
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

export const INSPIRATION_LABEL = L('Inspiration', '灵感', 'ひらめき', '영감');

// ---------------------------------------------------------------------------
// world.json `inspiration`
// ---------------------------------------------------------------------------

export interface InspirationConfig {
  /** false: the world turned it off (`"inspiration": false`). */
  enabled: boolean;
  /** The roll's name in this world (default: 灵感 / Inspiration). */
  label?: string;
  /** A sheet skill the roll uses instead of the plain inspiration number. */
  skill?: string;
  /** coc: the % (default 50); dnd: the modifier (default: the sheet's INT). */
  value?: number;
  /** `clock`: one roll per clock step; `actions`: one per `cooldown` player actions. */
  per: 'clock' | 'actions';
  /** Clock steps (per: clock) or player actions (per: actions) between two rolls. */
  cooldown: number;
  /** Rolls per loop (or per run). */
  max: number;
  /** The cost of a fumble, first that lands; null = the world's default (trpg chain / story: a longer wait). */
  fumble: ConsequenceEffect[] | null;
}

/** Fail-soft: missing → the defaults; check:worlds is strict (`inspirationConfigProblems`). */
export function inspirationConfigOf(manifest: Record<string, unknown> | null | undefined): InspirationConfig {
  const raw = manifest?.inspiration;
  const hasClock = isObj(manifest?.clock);
  const o = isObj(raw) ? raw : {};
  const per = o.per === 'clock' || o.per === 'actions' ? o.per : hasClock ? 'clock' : 'actions';
  const cooldown = isInt(o.cooldown) && o.cooldown >= 1 && o.cooldown <= 20 ? o.cooldown : per === 'clock' ? 1 : INSPIRATION_DEFAULT_ACTIONS;
  const max = isInt(o.max) && o.max >= 1 && o.max <= 30 ? o.max : INSPIRATION_DEFAULT_MAX;
  let fumble: ConsequenceEffect[] | null = null;
  if (o.fumble !== undefined) {
    fumble = [];
    for (const item of Array.isArray(o.fumble) ? o.fumble : [o.fumble]) {
      const p = parseEffect(item);
      if (p.ok) fumble.push(p.value);
    }
  }
  return {
    enabled: raw !== false,
    ...(typeof o.label === 'string' && o.label.trim() ? { label: o.label.trim().slice(0, 20) } : {}),
    ...(typeof o.skill === 'string' && /^[a-z][a-z0-9_]{0,31}$/.test(o.skill) ? { skill: o.skill } : {}),
    ...(typeof o.value === 'number' && Number.isInteger(o.value) ? { value: o.value } : {}),
    per: per === 'clock' && !hasClock ? 'actions' : per,
    cooldown,
    max,
    fumble,
  };
}

/** Problems in world.json `inspiration` (check:worlds). */
export function inspirationConfigProblems(manifest: Record<string, unknown>): string[] {
  const raw = manifest.inspiration;
  if (raw === undefined || raw === false) return [];
  if (!isObj(raw)) return ['inspiration must be false or a mapping'];
  const out: string[] = [];
  const known = new Set(['skill', 'value', 'per', 'cooldown', 'max', 'fumble', 'label']);
  for (const k of Object.keys(raw)) if (!known.has(k)) out.push(`inspiration.${k}: unknown key`);
  if (raw.skill !== undefined && (typeof raw.skill !== 'string' || !/^[a-z][a-z0-9_]{0,31}$/.test(raw.skill))) out.push('inspiration.skill must be a sheet skill id');
  if (raw.value !== undefined && (!isInt(raw.value) || raw.value < -5 || raw.value > 99)) out.push('inspiration.value must be an integer (coc 1–99, dnd a modifier)');
  if (raw.per !== undefined && raw.per !== 'clock' && raw.per !== 'actions') out.push('inspiration.per must be clock or actions');
  if (raw.per === 'clock' && !isObj(manifest.clock)) out.push('inspiration.per is clock, but the world has no clock');
  if (raw.cooldown !== undefined && (!isInt(raw.cooldown) || raw.cooldown < 1 || raw.cooldown > 20)) out.push('inspiration.cooldown must be 1–20');
  if (raw.max !== undefined && (!isInt(raw.max) || raw.max < 1 || raw.max > 30)) out.push('inspiration.max must be 1–30');
  if (raw.fumble !== undefined) {
    for (const [i, item] of (Array.isArray(raw.fumble) ? raw.fumble : [raw.fumble]).entries()) {
      const p = parseEffect(item);
      if (!p.ok) out.push(`inspiration.fumble[${i}]: ${p.error}`);
      else if ('reveal' in p.value || 'boon' in p.value) out.push(`inspiration.fumble[${i}]: a fumble costs something, it never gives`);
      else if (Object.values(p.value).some((v) => typeof v === 'number' && (v > 0 || v < -1))) out.push(`inspiration.fumble[${i}]: a fumble's cost is small (−1)`);
      else if ('harm' in p.value && p.value.harm !== 'light') out.push(`inspiration.fumble[${i}]: a fumble hurts at most lightly`);
      else if ('state' in p.value && (p.value.state.by > 0 || p.value.state.by < -1)) out.push(`inspiration.fumble[${i}]: a fumble's cost is small (−1)`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Frequency
// ---------------------------------------------------------------------------

export interface InspirationLog {
  /** Rolls this loop. */
  uses: number;
  /** Event seq of the last roll's record (the player actions after it count toward the wait). */
  last_seq?: number;
  /** `clock.left` at the last roll. */
  last_clock?: number;
  /** A fumble doubled the next wait. */
  penalty?: boolean;
}

export function parseInspirationLog(raw: unknown): InspirationLog {
  if (!isObj(raw)) return { uses: 0 };
  return {
    uses: isInt(raw.uses) && raw.uses >= 0 ? raw.uses : 0,
    ...(isInt(raw.last_seq) ? { last_seq: raw.last_seq } : {}),
    ...(isInt(raw.last_clock) ? { last_clock: raw.last_clock } : {}),
    ...(raw.penalty === true ? { penalty: true } : {}),
  };
}

export type InspirationGate =
  | { ok: true; left: number }
  | { ok: false; reason: 'max'; left: 0 }
  | { ok: false; reason: 'cooldown'; wait: number; unit: 'clock' | 'actions'; left: number };

/** Can the player roll now? `clockLeft` (null: no clock) and the player actions since the last roll. Pure. */
export function inspirationGate(cfg: InspirationConfig, log: InspirationLog, now: { clockLeft: number | null; actionsSince: number }): InspirationGate {
  const left = Math.max(0, cfg.max - log.uses);
  if (left === 0) return { ok: false, reason: 'max', left: 0 };
  if (log.uses === 0) return { ok: true, left };
  const need = cfg.cooldown * (log.penalty ? 2 : 1);
  if (cfg.per === 'clock' && now.clockLeft !== null && log.last_clock !== undefined) {
    const passed = log.last_clock - now.clockLeft;
    if (passed < need) return { ok: false, reason: 'cooldown', wait: need - passed, unit: 'clock', left };
    return { ok: true, left };
  }
  if (now.actionsSince < need) return { ok: false, reason: 'cooldown', wait: need - now.actionsSince, unit: 'actions', left };
  return { ok: true, left };
}

// ---------------------------------------------------------------------------
// Which line, how clear
// ---------------------------------------------------------------------------

export interface InspirationPick {
  hint: HintEntry | null;
  /** The words to show; null → the caller's generic line for this tier. */
  text: string | null;
  suggest: HintSuggest[];
}

/**
 * Pure: the written line an inspiration roll of `grade` reaches. Candidates are the hints whose
 * conditions hold right now (layer, has / lacks, visited, expr — the same fences the companion's hints
 * keep), minus `inspire.skip` and spent ones. Unused lines first, then priority. In a ladder (`group`),
 * a success takes the next rung, a critical the top rung that holds; a failure prefers a line with a
 * `vague` reading.
 */
export function pickInspiration(
  table: HintTable | null,
  state: HintWorldState,
  log: Pick<HintLog, 'used'>,
  grade: CheckGrade,
  spent: ReadonlySet<string> = new Set(),
): InspirationPick {
  const none: InspirationPick = { hint: null, text: null, suggest: [] };
  if (!table || grade === 'failure') return none;
  const holding = table.hints.filter((h) => h.inspire?.skip !== true && !spent.has(h.id) && hintHolds(h, state));
  // One representative per ladder.
  const groups = new Map<string, HintEntry[]>();
  const singles: HintEntry[] = [];
  for (const h of holding) {
    if (h.group === undefined) { singles.push(h); continue; }
    groups.set(h.group, [...(groups.get(h.group) ?? []), h]);
  }
  const reps: HintEntry[] = [...singles];
  for (const rungs of groups.values()) {
    const sorted = [...rungs].sort((a, b) => (a.level ?? 0) - (b.level ?? 0));
    if (grade === 'great') reps.push(sorted[sorted.length - 1]);
    else reps.push(sorted.find((h) => log.used[h.id] === undefined) ?? sorted[sorted.length - 1]);
  }
  const order = new Map(table.hints.map((h, i) => [h.id, i]));
  const score = (h: HintEntry): number[] => [
    grade === 'setback' && h.inspire?.vague ? 1 : 0,
    log.used[h.id] === undefined ? 1 : 0,
    h.priority ?? 50,
    -(order.get(h.id) ?? 0),
  ];
  const better = (a: number[], b: number[]) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i]; return false; };
  let pick: HintEntry | null = null;
  for (const h of reps) if (!pick || better(score(h), score(pick))) pick = h;
  if (!pick) return none;
  if (grade === 'setback') return { hint: pick, text: pick.inspire?.vague ?? null, suggest: [] };
  return { hint: pick, text: grade === 'great' ? pick.inspire?.sharp ?? pick.say : pick.say, suggest: pick.suggest ?? [] };
}

// ---------------------------------------------------------------------------
// Generic words (when the world wrote nothing for this moment)
// ---------------------------------------------------------------------------

export const INSPIRATION_WORDS = {
  /** A failed roll and no `vague` line: a nudge that is never wrong enough to hurt. */
  vague: L(
    'Something tugs at you — maybe it is in what you already hold, or somewhere you passed too quickly.',
    '总觉得漏了什么——也许就在你已经拿到的东西里，或者在你走得太快的地方。',
    '何かが引っかかる——もう手にしたものの中か、急いで通り過ぎた場所にあるのかもしれない。',
    '뭔가 걸린다 — 이미 가진 것 안에, 아니면 너무 서둘러 지나친 곳에 있을지도 모른다.',
  ),
  /** A success with nothing written for here: go somewhere new. `{place}` is a place name. */
  elsewhere: L(
    'Nothing more here, you think. {place} — you have not been there yet.',
    '这里大概想不出更多了。{place}——你还没去过。',
    'ここではもう何も浮かばない。{place}——まだ行っていない。',
    '여기서는 더 떠오르지 않는다. {place} — 아직 가 보지 않았다.',
  ),
  /** A success with nothing written and nowhere new. */
  review: L(
    'You go over what you have, one thing at a time. The answer is in there somewhere — read them again, and ask the people here.',
    '你把手上的东西一样一样过了一遍。答案就在里面——再读一遍，再问问这里的人。',
    '手元のものを一つずつ見直す。答えはこの中にある——もう一度読み、ここにいる人に聞いてみよう。',
    '가진 것을 하나씩 다시 짚어 본다. 답은 그 안에 있다 — 다시 읽고, 여기 있는 사람들에게 물어보자.',
  ),
  /** A fumble. */
  fumble: L(
    'Your thoughts tangle into knots. Nothing comes — and the time is gone.',
    '思绪乱成一团，什么也没想出来——时间却白白过去了。',
    '考えがこんがらがって、何も浮かばない——時間だけが過ぎた。',
    '생각이 엉켜 아무것도 떠오르지 않는다 — 시간만 흘렀다.',
  ),
  /** A fumble in a world that charges nothing: the next roll waits twice as long. */
  fumbleWait: L(
    'Your head aches. It will be a while before anything comes to you again.',
    '想得头都疼了。要过好一阵，才能再想出点什么。',
    '頭が痛くなってきた。しばらくは何も浮かびそうにない。',
    '머리가 지끈거린다. 한동안은 아무것도 떠오르지 않을 것 같다.',
  ),
} as const;

export function inspirationWords(key: keyof typeof INSPIRATION_WORDS, locale: unknown, vars: Record<string, string> = {}): string {
  return INSPIRATION_WORDS[key][skillLocaleOf(locale)].replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');
}

export function inspirationLabel(locale: unknown): string {
  return INSPIRATION_LABEL[skillLocaleOf(locale)];
}
