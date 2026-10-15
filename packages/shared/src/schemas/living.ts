/**
 * A living world: world.json `living`.
 *
 * Time passes and residents keep their own days whether or not the player is
 * looking. This block is the author's data only — the calendar, the day's
 * phases, where each resident is when, what drifts overnight, which days are
 * festivals, which scene pictures change with the hour or the season. The
 * running clock lives in `world/README.md` (frontmatter `living`, engine
 * bookkeeping like `trigger_log`); the residents' moods and bonds are ordinary
 * declared states in their own READMEs.
 *
 * Strings under `label` / `text` / `title` are localized per edition; ids,
 * times, layers and numbers are the executable contract (check:worlds).
 */
import { z } from 'zod';

const ID = /^[a-z][a-z0-9-]*$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
/** A layer id as `characters[].home` writes it: `map` or `world/...`. */
const LAYER = /^(map|world(\/[a-z0-9][a-z0-9-]*)+)$/;
const ASSET = /^assets\/[A-Za-z0-9_./-]+\.(webp|png|jpe?g|mp4|webm)$/;

const id = z.string().regex(ID, 'an id is lowercase ASCII kebab-case');
const ids = z.array(id).min(1).max(24);
const label = z.string().trim().min(1).max(40);
const text = z.string().trim().min(1).max(160);

export const LivingPhaseSchema = z.object({ id, from: z.string().regex(HHMM), label }).strict();
export const LivingNamedSchema = z.object({ id, label }).strict();
export const LivingWeatherSchema = z.object({
  id,
  label,
  /** Relative weight of this weather on a day; 0 = never by chance. */
  weight: z.number().min(0).max(100),
  /** Only in these seasons (absent = every season). */
  seasons: ids.optional(),
}).strict();

/**
 * When something applies. Every listed filter must hold; an absent filter
 * always holds. `if` is a trigger condition (the design notes:
 * `player.*`, `world.*`, `<character>.*`, `time.*`, `events.*`).
 */
export const LivingWhenShape = {
  phases: ids.optional(),
  weekdays: ids.optional(),
  seasons: ids.optional(),
  weather: ids.optional(),
  events: ids.optional(),
  if: z.string().trim().min(1).max(200).optional(),
};
export const LivingWhenSchema = z.object(LivingWhenShape).strict();

export const LivingScheduleEntrySchema = z.object({
  ...LivingWhenShape,
  /** The layer the resident is in while this entry holds. */
  at: z.string().regex(LAYER, 'at is a layer: map or world/...'),
  /** What they are doing there (the writer and the character panel read it). */
  text: text.optional(),
}).strict();

/**
 * One overnight change to a declared state of the resident (applied once per
 * new day, seeded — never a model call). Exactly one of `pick` / `set` / `by`.
 * `chance` (0–1) makes it happen only on some days.
 */
export const LivingDailyRuleSchema = z.object({
  state: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/),
  pick: z.record(z.string().min(1).max(40), z.number().min(0).max(100)).optional(),
  set: z.union([z.number(), z.boolean(), z.string()]).optional(),
  by: z.number().optional(),
  chance: z.number().min(0).max(1).optional(),
}).strict().refine((r) => [r.pick, r.set, r.by].filter((v) => v !== undefined).length === 1, {
  message: 'a daily rule has exactly one of pick / set / by',
});

export const LivingResidentSchema = z.object({
  /** First entry that holds wins; none → the character's `home`. */
  schedule: z.array(LivingScheduleEntrySchema).min(1).max(24),
  daily: z.array(LivingDailyRuleSchema).max(8).optional(),
  /** Small off-screen happenings the digest may mention (one is picked per day, seeded). */
  away: z.array(z.object({ text }).strict()).max(16).optional(),
}).strict();

/**
 * A date on the calendar. All listed parts must hold: `seasons`, `days` (day of
 * the season, 1-based), `weekdays`, or `every` N days counted from day `from`.
 */
export const LivingDateSchema = z.object({
  seasons: ids.optional(),
  days: z.array(z.number().int().min(1).max(366)).min(1).max(31).optional(),
  weekdays: ids.optional(),
  every: z.number().int().min(1).max(366).optional(),
  from: z.number().int().min(1).optional(),
}).strict().refine((d) => d.seasons || d.days || d.weekdays || d.every, { message: 'a date names seasons, days, weekdays or every' });

export const LivingEventSchema = z.object({
  id,
  label,
  text: text.optional(),
  on: LivingDateSchema,
  /** The hours it runs (absent = all day). */
  phases: ids.optional(),
  /** It happens only in this weather (the ferry does not sail in a storm). */
  weather: ids.optional(),
  /** Where it happens; residents in `gather` go there while it runs. */
  at: z.string().regex(LAYER).optional(),
  gather: z.union([z.literal('all'), z.array(id).min(1).max(24)]).optional(),
}).strict();

export const LivingVariantSchema = z.object({
  /** The picture the layer has when no variant holds — the template's own `bg:`. */
  base: z.string().regex(ASSET),
  when: z.array(z.object({ ...LivingWhenShape, bg: z.string().regex(ASSET) }).strict()).min(1).max(12),
}).strict();

export const LivingWorldSchema = z.object({
  /** Seeds every off-screen roll (weather, moods, digest lines). Absent: derived once per save. */
  seed: z.number().int().min(0).max(2 ** 31 - 1).optional(),
  start: z.object({ day: z.number().int().min(1).max(9999).default(1), time: z.string().regex(HHMM).default('07:00') }).strict().optional(),
  /** The day's phases, in order of `from`; the last one runs past midnight until the first begins. */
  phases: z.array(LivingPhaseSchema).min(2).max(8),
  seasons: z.array(LivingNamedSchema).min(1).max(8).optional(),
  daysPerSeason: z.number().int().min(1).max(120).default(28),
  weekdays: z.array(LivingNamedSchema).min(2).max(10).optional(),
  weather: z.array(LivingWeatherSchema).min(1).max(8).optional(),
  pace: z.object({
    /** World minutes each of the player's own actions takes (moving, choosing, rolling). */
    perAction: z.number().int().min(0).max(240).default(0),
  }).strict().optional(),
  catchUp: z.object({
    /** World minutes per real minute between sessions (1 = the island keeps real time). */
    ratio: z.number().min(0).max(1440).default(1),
    /** At most this many world days pass while the player is away; the rest never happens. */
    maxDays: z.number().min(0).max(30).default(3),
    /** A gap shorter than this (real minutes) is a reload, not an absence. */
    minMinutes: z.number().min(0).max(10080).default(30),
  }).strict().optional(),
  digest: z.object({
    title: label,
    /** Hand the facts to the writer for one short recap (one model call); false = the engine's own words only. */
    writer: z.boolean().default(true),
    /** Only an absence of at least this many world hours earns a digest. */
    minHours: z.number().min(0).max(720).default(6),
  }).strict().optional(),
  /** The world panel's line: `{season} {day} {weekday} {phase} {weather}` are filled in. */
  display: z.object({ label, text: z.string().trim().min(1).max(80) }).strict(),
  residents: z.record(id, LivingResidentSchema).optional(),
  events: z.array(LivingEventSchema).max(32).optional(),
  variants: z.record(z.string().regex(LAYER), LivingVariantSchema).optional(),
}).strict().superRefine((w, ctx) => {
  const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
  const unique = (list: Array<{ id: string }> | undefined, key: string) => {
    const seen = new Set<string>();
    list?.forEach((x, i) => { if (seen.has(x.id)) issue([key, i, 'id'], `duplicate ${key} id "${x.id}"`); seen.add(x.id); });
    return seen;
  };
  const phases = unique(w.phases, 'phases');
  const seasons = unique(w.seasons, 'seasons');
  const weekdays = unique(w.weekdays, 'weekdays');
  const weather = unique(w.weather, 'weather');
  const events = unique(w.events, 'events');
  for (let i = 1; i < w.phases.length; i += 1) {
    if (w.phases[i]!.from <= w.phases[i - 1]!.from) issue(['phases', i, 'from'], 'phases are in order of their start time');
  }
  const known = (list: string[] | undefined, set: Set<string>, what: string, path: (string | number)[]) => {
    for (const x of list ?? []) if (!set.has(x)) issue(path, `unknown ${what} "${x}"`);
  };
  const checkWhen = (when: Partial<Record<'phases' | 'weekdays' | 'seasons' | 'weather' | 'events', string[]>>, path: (string | number)[]) => {
    known(when.phases, phases, 'phase', [...path, 'phases']);
    known(when.weekdays, weekdays, 'weekday', [...path, 'weekdays']);
    known(when.seasons, seasons, 'season', [...path, 'seasons']);
    known(when.weather, weather, 'weather', [...path, 'weather']);
    known(when.events, events, 'event', [...path, 'events']);
  };
  w.weather?.forEach((x, i) => known(x.seasons, seasons, 'season', ['weather', i, 'seasons']));
  if (w.weather && !w.weather.some((x) => x.weight > 0)) issue(['weather'], 'at least one weather needs a weight above 0');
  for (const [rid, r] of Object.entries(w.residents ?? {})) r.schedule.forEach((e, i) => checkWhen(e, ['residents', rid, 'schedule', i]));
  w.events?.forEach((e, i) => {
    known(e.on.seasons, seasons, 'season', ['events', i, 'on', 'seasons']);
    known(e.on.weekdays, weekdays, 'weekday', ['events', i, 'on', 'weekdays']);
    known(e.phases, phases, 'phase', ['events', i, 'phases']);
    known(e.weather, weather, 'weather', ['events', i, 'weather']);
    if (e.gather && !e.at) issue(['events', i, 'gather'], 'gather needs at');
    if (e.on.days && w.daysPerSeason && e.on.days.some((d) => d > w.daysPerSeason)) issue(['events', i, 'on', 'days'], `a season has ${w.daysPerSeason} days`);
  });
  for (const [layer, v] of Object.entries(w.variants ?? {})) v.when.forEach((x, i) => checkWhen(x, ['variants', layer, 'when', i]));
});

export type LivingWorld = z.infer<typeof LivingWorldSchema>;
export type LivingWhen = z.infer<typeof LivingWhenSchema>;
export type LivingScheduleEntry = z.infer<typeof LivingScheduleEntrySchema>;
export type LivingDailyRule = z.infer<typeof LivingDailyRuleSchema>;
export type LivingResident = z.infer<typeof LivingResidentSchema>;
export type LivingEvent = z.infer<typeof LivingEventSchema>;
export type LivingVariant = z.infer<typeof LivingVariantSchema>;

/** Parse world.json `living`; null when absent, `errors` when malformed (the runtime then ignores it). */
export function parseLivingWorld(raw: unknown): { living: LivingWorld | null; errors: string[] } {
  if (raw === undefined || raw === null) return { living: null, errors: [] };
  const r = LivingWorldSchema.safeParse(raw);
  if (r.success) return { living: r.data, errors: [] };
  return { living: null, errors: r.error.issues.map((i) => `living.${i.path.join('.')}: ${i.message}`) };
}
