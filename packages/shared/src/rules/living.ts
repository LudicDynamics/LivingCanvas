/**
 * A living world's clock, calendar and residents — the PURE half
 *. No I/O, no model, no `Math.random`: the same
 * world data, seed and minute always give the same answer, which is what lets
 * the engine (`actions/living.ts`) advance residents off-screen cheaply and
 * lets tests pin every off-screen roll.
 *
 * Time is one integer: world minutes since day 1, 00:00. Everything else — the
 * day, phase, season, weekday, weather, today's events — is derived from it.
 */
import type { LivingDailyRule, LivingEvent, LivingResident, LivingVariant, LivingWhen, LivingWorld } from '../schemas/living.js';

export const MINUTES_PER_DAY = 1440;

const minutesOf = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const hhmmOf = (m: number): string => {
  const v = ((Math.floor(m) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
};

/* ────────────────────────────── seeded rolls ────────────────────────────── */

/** FNV-1a over a string: a stable 32-bit key for one off-screen roll. */
export function hashKey(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A uniform [0, 1) value for one named roll (mulberry32 of the hashed key). */
export function rollOf(seed: number, ...parts: Array<string | number>): number {
  let a = (hashKey(`${seed}|${parts.join('|')}`) + 0x6d2b79f5) >>> 0;
  a = Math.imul(a ^ (a >>> 15), a | 1);
  a ^= a + Math.imul(a ^ (a >>> 7), a | 61);
  return ((a ^ (a >>> 14)) >>> 0) / 4294967296;
}

/** Weighted pick; null when every weight is 0. */
export function weightedPick<T extends string>(weights: ReadonlyArray<[T, number]>, roll: number): T | null {
  const total = weights.reduce((s, [, w]) => s + Math.max(0, w), 0);
  if (total <= 0) return null;
  let at = roll * total;
  for (const [value, w] of weights) {
    if (w <= 0) continue;
    if (at < w) return value;
    at -= w;
  }
  return weights.filter(([, w]) => w > 0).at(-1)![0];
}

/* ────────────────────────────── the clock ────────────────────────────── */

/** Where a fresh save's clock starts. */
export function startMinute(living: LivingWorld): number {
  const day = living.start?.day ?? 1;
  return (day - 1) * MINUTES_PER_DAY + minutesOf(living.start?.time ?? '07:00');
}

export const dayOfMinute = (minute: number): number => Math.floor(minute / MINUTES_PER_DAY) + 1;

export interface LivingDate {
  day: number;
  season: string | null;
  /** 1-based day within the season. */
  dayOfSeason: number;
  /** 1-based year (one year = every season once). */
  year: number;
  weekday: string | null;
}

export function dateOf(living: LivingWorld, day: number): LivingDate {
  const dps = living.daysPerSeason ?? 28;
  const seasons = living.seasons ?? [];
  const index = Math.floor((day - 1) / dps);
  return {
    day,
    season: seasons.length ? seasons[index % seasons.length]!.id : null,
    dayOfSeason: ((day - 1) % dps) + 1,
    year: seasons.length ? Math.floor(index / seasons.length) + 1 : 1,
    weekday: living.weekdays?.length ? living.weekdays[(day - 1) % living.weekdays.length]!.id : null,
  };
}

/** The phase at a minute of the day: the last one whose start has passed (the last phase runs past midnight). */
export function phaseAt(living: LivingWorld, minuteOfDay: number): string {
  let current = living.phases[living.phases.length - 1]!.id;
  for (const p of living.phases) if (minutesOf(p.from) <= minuteOfDay) current = p.id;
  return current;
}

/** The day's weather, rolled once per day from the seed. */
export function weatherOf(living: LivingWorld, seed: number, day: number): string | null {
  if (!living.weather?.length) return null;
  const season = dateOf(living, day).season;
  const options = living.weather.filter((w) => !w.seasons || (season !== null && w.seasons.includes(season)));
  const picked = weightedPick(options.map((w) => [w.id, w.weight] as [string, number]), rollOf(seed, 'weather', day));
  return picked ?? living.weather[0]!.id;
}

function dateHolds(on: LivingEvent['on'], d: LivingDate): boolean {
  if (on.seasons && (d.season === null || !on.seasons.includes(d.season))) return false;
  if (on.days && !on.days.includes(d.dayOfSeason)) return false;
  if (on.weekdays && (d.weekday === null || !on.weekdays.includes(d.weekday))) return false;
  if (on.every) {
    const from = on.from ?? 1;
    if (d.day < from || (d.day - from) % on.every !== 0) return false;
  }
  return true;
}

/** Events on a day's calendar (their date and weather hold), in declaration order. */
export function eventsOnDay(living: LivingWorld, seed: number, day: number): LivingEvent[] {
  if (!living.events?.length) return [];
  const d = dateOf(living, day);
  const weather = weatherOf(living, seed, day);
  return living.events.filter((e) => dateHolds(e.on, d) && (!e.weather || (weather !== null && e.weather.includes(weather))));
}

export interface LivingNow extends LivingDate {
  minute: number;
  minuteOfDay: number;
  /** "HH:MM". */
  time: string;
  phase: string;
  weather: string | null;
  /** Ids of events on today's calendar. */
  today: string[];
  /** Ids of events running right now (today, and in their phases). */
  active: string[];
}

export function livingNow(living: LivingWorld, seed: number, minute: number): LivingNow {
  const day = dayOfMinute(minute);
  const minuteOfDay = minute - (day - 1) * MINUTES_PER_DAY;
  const phase = phaseAt(living, minuteOfDay);
  const today = eventsOnDay(living, seed, day);
  return {
    ...dateOf(living, day),
    minute,
    minuteOfDay,
    time: hhmmOf(minuteOfDay),
    phase,
    weather: weatherOf(living, seed, day),
    today: today.map((e) => e.id),
    active: today.filter((e) => !e.phases || e.phases.includes(phase)).map((e) => e.id),
  };
}

/**
 * Minutes from `minute` to the next start of `phase` (strictly later: asking
 * for "morning" during the morning means tomorrow's). Null for an unknown phase.
 */
export function minutesUntilPhase(living: LivingWorld, minute: number, phase: string): number | null {
  const p = living.phases.find((x) => x.id === phase);
  if (!p) return null;
  const day = dayOfMinute(minute);
  let target = (day - 1) * MINUTES_PER_DAY + minutesOf(p.from);
  if (target <= minute) target += MINUTES_PER_DAY;
  return target - minute;
}

/**
 * World minutes that pass for a real absence of `elapsedMs`: nothing for a
 * reload (under `minMinutes`), otherwise `ratio` world minutes per real minute,
 * capped at `maxDays` world days. What lies beyond the cap never happens.
 */
export function catchUpMinutes(living: LivingWorld, elapsedMs: number): number {
  const c = { ratio: 1, maxDays: 3, minMinutes: 30, ...(living.catchUp ?? {}) };
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
  const realMinutes = elapsedMs / 60000;
  if (realMinutes < c.minMinutes) return 0;
  return Math.max(0, Math.min(Math.floor(realMinutes * c.ratio), Math.floor(c.maxDays * MINUTES_PER_DAY)));
}

/* ─────────────────────────── conditions & names ─────────────────────────── */

/** An event id as a condition segment: `lantern-festival` → `events.lantern_festival`. */
export const eventRef = (id: string): string => `events.${id.replace(/-/g, '_')}`;

/** The `time.*` names a trigger condition may read. */
export const LIVING_TIME_REFS = ['time.day', 'time.hour', 'time.minute', 'time.phase', 'time.season', 'time.day_of_season', 'time.year', 'time.weekday', 'time.weather'] as const;

/**
 * Why a `time.*` / `events.*` condition reference cannot resolve in a world
 * (an authoring check for check:worlds), or null when it can.
 */
export function livingRefProblem(living: LivingWorld | undefined | null | unknown, ref: string): string | null {
  const events = living && typeof living === 'object' && Array.isArray((living as { events?: unknown }).events)
    ? ((living as { events: Array<{ id?: unknown }> }).events).map((e) => String(e?.id ?? ''))
    : [];
  if (!living) return `"${ref}" needs world.json living (docs/worlds/活着的世界.md)`;
  if (ref.startsWith('time.')) return (LIVING_TIME_REFS as readonly string[]).includes(ref) ? null : `"${ref}" is not a time name (${LIVING_TIME_REFS.join(', ')})`;
  if (ref.startsWith('events.')) return events.some((id) => eventRef(id) === ref) ? null : `"${ref}" names no living.events id`;
  return null;
}

/** `time.*` and `events.*` for the trigger layer. */
export function livingConditionValues(living: LivingWorld, now: LivingNow): Map<string, string | number | boolean | null> {
  const v = new Map<string, string | number | boolean | null>([
    ['time.day', now.day],
    ['time.hour', Math.floor(now.minuteOfDay / 60)],
    ['time.minute', now.minuteOfDay],
    ['time.phase', now.phase],
    ['time.season', now.season],
    ['time.day_of_season', now.dayOfSeason],
    ['time.year', now.year],
    ['time.weekday', now.weekday],
    ['time.weather', now.weather],
  ]);
  for (const e of living.events ?? []) v.set(eventRef(e.id), now.active.includes(e.id));
  return v;
}

/** A condition-callback: evaluates a trigger condition (`if:`) against the world. */
export type LivingCondition = (expr: string) => boolean;

/** Whether every filter of `when` holds now. */
export function whenHolds(when: LivingWhen, now: LivingNow, cond?: LivingCondition): boolean {
  if (when.phases && !when.phases.includes(now.phase)) return false;
  if (when.weekdays && (now.weekday === null || !when.weekdays.includes(now.weekday))) return false;
  if (when.seasons && (now.season === null || !when.seasons.includes(now.season))) return false;
  if (when.weather && (now.weather === null || !when.weather.includes(now.weather))) return false;
  if (when.events && !when.events.some((e) => now.active.includes(e))) return false;
  if (when.if !== undefined && !(cond ? cond(when.if) : false)) return false;
  return true;
}

export interface ResidentPlace {
  layer: string;
  /** What they are doing (schedule `text`, or the event's label). */
  text: string | null;
  /** Why: a gathering event, a schedule entry, or their home. */
  source: { kind: 'event'; id: string } | { kind: 'schedule'; index: number } | { kind: 'home' };
}

/**
 * Where a resident is now: a running event that gathers them wins, then the
 * first schedule entry that holds, then their home.
 */
export function residentPlace(
  living: LivingWorld,
  residentId: string,
  now: LivingNow,
  home: string,
  cond?: LivingCondition,
): ResidentPlace {
  for (const e of living.events ?? []) {
    if (!e.at || !e.gather || !now.active.includes(e.id)) continue;
    if (e.gather === 'all' ? living.residents?.[residentId] !== undefined : e.gather.includes(residentId)) {
      return { layer: e.at, text: e.label, source: { kind: 'event', id: e.id } };
    }
  }
  const resident: LivingResident | undefined = living.residents?.[residentId];
  const index = resident ? resident.schedule.findIndex((s) => whenHolds(s, now, cond)) : -1;
  if (resident && index >= 0) {
    const entry = resident.schedule[index]!;
    return { layer: entry.at, text: entry.text ?? null, source: { kind: 'schedule', index } };
  }
  return { layer: home, text: null, source: { kind: 'home' } };
}

/** The picture a layer should show now: the first variant that holds, else its base. */
export function variantBackground(variant: LivingVariant, now: LivingNow, cond?: LivingCondition): string {
  return variant.when.find((w) => whenHolds(w, now, cond))?.bg ?? variant.base;
}

/**
 * One overnight rule's outcome for one resident on one day. Null when its
 * `chance` says not today (or a `pick` has nothing to pick).
 */
export function dailyOutcome(
  rule: LivingDailyRule,
  seed: number,
  day: number,
  residentId: string,
  index: number,
): { value: string | number | boolean } | { by: number } | null {
  if (rule.chance !== undefined && rollOf(seed, 'chance', day, residentId, index) >= rule.chance) return null;
  if (rule.set !== undefined) return { value: rule.set };
  if (rule.by !== undefined) return { by: rule.by };
  const picked = weightedPick(Object.entries(rule.pick ?? {}), rollOf(seed, 'pick', day, residentId, index));
  return picked === null ? null : { value: picked };
}

/** The off-screen happening a resident's day yields for the digest (seeded), or null. */
export function awayLine(resident: LivingResident | undefined, seed: number, day: number, residentId: string): string | null {
  const lines = resident?.away ?? [];
  if (lines.length === 0) return null;
  return lines[Math.floor(rollOf(seed, 'away', day, residentId) * lines.length)]!.text;
}

const labelIn = (list: Array<{ id: string; label: string }> | undefined, value: string | null): string => (value === null ? '' : list?.find((x) => x.id === value)?.label ?? value);

export function phaseLabel(living: LivingWorld, phase: string): string { return labelIn(living.phases, phase); }
export function seasonLabel(living: LivingWorld, season: string | null): string { return labelIn(living.seasons, season); }
export function weekdayLabel(living: LivingWorld, weekday: string | null): string { return labelIn(living.weekdays, weekday); }
export function weatherLabel(living: LivingWorld, weather: string | null): string { return labelIn(living.weather, weather); }
export function eventLabel(living: LivingWorld, id: string): string { return labelIn(living.events, id); }

/** The world panel's one line, in the edition's own words (`display.text`). */
export function formatLivingNow(living: LivingWorld, now: LivingNow): string {
  const fill: Record<string, string> = {
    season: seasonLabel(living, now.season),
    day: String(now.day),
    day_of_season: String(now.dayOfSeason),
    weekday: weekdayLabel(living, now.weekday),
    phase: phaseLabel(living, now.phase),
    weather: weatherLabel(living, now.weather),
    time: now.time,
  };
  return living.display.text.replace(/\{([a-z_]+)\}/g, (m, k: string) => (k in fill ? fill[k]! : m)).replace(/\s{2,}/g, ' ').trim();
}
