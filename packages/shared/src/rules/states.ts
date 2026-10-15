/**
 * Declared states.
 *
 * A state is one typed value an author declares in the frontmatter of
 * `player/README.md`, `characters/<id>/README.md` or `world/README.md`:
 *
 * ```yaml
 * states:
 *   - id: hp
 *     label: 伤势
 *     type: number
 *     initial: 3
 *     range: [0, 3]
 *     shown_as:
 *       - { min: 3, text: 毫发无伤 }
 *       - { min: 2, text: 受了伤 }
 *       - { min: 1, text: 伤得很重 }
 *       - { max: 0, text: 奄奄一息 }
 * ```
 *
 * The declaration lives beside the thing it describes; the CURRENT value lives
 * in that same file's existing `status.data[id]` (absent ⇒ `initial`). There is
 * no HUD: a state is either rendered as prose in the player / character / world
 * panel (`mappedStates`), or not at all (`hidden: true`).
 *
 * Pure: no I/O. The engine side (reading files, writing values) is
 * `commands/world-triggers.ts`.
 */
import { z } from 'zod';
import { rulePackStateDecls } from './themes.js';

export const STATE_TYPES = ['number', 'flag', 'enum'] as const;
export type StateType = (typeof STATE_TYPES)[number];

/**
 * A state id is a condition-reference segment (`player.hp`), so it must lex as
 * one identifier in the command condition grammar: no hyphen, no dot.
 */
export const STATE_ID_RE = /^[a-z][a-z0-9_]{0,31}$/;

/** One prose band for a number: the first band whose bounds hold wins. */
export const StateBandSchema = z
  .object({
    min: z.number().optional(),
    max: z.number().optional(),
    text: z.string().min(1).max(80),
  })
  .strict();
export type StateBand = z.infer<typeof StateBandSchema>;

export const StateDeclSchema = z
  .object({
    id: z.string().regex(STATE_ID_RE, 'a state id is lowercase ASCII letters, digits and "_" (it is read as player.<id>)'),
    label: z.string().min(1).max(40),
    type: z.enum(STATE_TYPES),
    initial: z.union([z.number(), z.boolean(), z.string()]),
    /** number only: inclusive `[min, max]`; every write is clamped into it. */
    range: z.tuple([z.number(), z.number()]).optional(),
    /** enum only: the allowed values. */
    values: z.array(z.string().min(1).max(40)).min(2).max(12).optional(),
    /**
     * How the panel says it. number → ordered bands; enum → value → text;
     * flag → `{ "true": text, "false": text }`. Absent: number and enum show
     * the raw value after the label, a flag shows its label only while true.
     * Up to 12 bands, as many as an enum's values (a clock card names each of
     * its hours: 七日旅店's nine).
     */
    shown_as: z.union([z.array(StateBandSchema).min(1).max(12), z.record(z.string(), z.string().min(1).max(80))]).optional(),
    /** Never shown in any panel. Still readable by triggers and commands. */
    hidden: z.boolean().optional(),
  })
  .strict()
  .superRefine((s, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    if (s.type === 'number') {
      if (typeof s.initial !== 'number' || !Number.isFinite(s.initial)) issue('initial', 'a number state needs a numeric initial');
      if (s.range && s.range[0] > s.range[1]) issue('range', 'range is [min, max] with min <= max');
      if (s.range && typeof s.initial === 'number' && (s.initial < s.range[0] || s.initial > s.range[1])) issue('initial', 'initial is outside range');
      if (s.values) issue('values', 'values is for enum states');
      if (s.shown_as && !Array.isArray(s.shown_as)) issue('shown_as', 'a number state is shown as a list of bands ({ min?, max?, text })');
    } else if (s.type === 'flag') {
      if (typeof s.initial !== 'boolean') issue('initial', 'a flag state needs initial: true or false');
      if (s.range || s.values) issue('type', 'a flag takes neither range nor values');
      if (s.shown_as && (Array.isArray(s.shown_as) || Object.keys(s.shown_as).some((k) => k !== 'true' && k !== 'false'))) {
        issue('shown_as', 'a flag is shown as { "true": text, "false": text }');
      }
    } else {
      if (!s.values) issue('values', 'an enum state needs values');
      if (typeof s.initial !== 'string' || (s.values && !s.values.includes(s.initial))) issue('initial', 'initial must be one of values');
      if (s.range) issue('range', 'range is for number states');
      if (s.shown_as && (Array.isArray(s.shown_as) || Object.keys(s.shown_as).some((k) => !s.values?.includes(k)))) {
        issue('shown_as', 'an enum is shown as { <value>: text } over its values');
      }
    }
  });
export type StateDecl = z.infer<typeof StateDeclSchema>;
export type StateValue = number | boolean | string;

export const StateListSchema = z.array(StateDeclSchema).max(16).superRefine((list, ctx) => {
  const seen = new Set<string>();
  list.forEach((s, i) => {
    if (seen.has(s.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [i, 'id'], message: `duplicate state id "${s.id}"` });
    seen.add(s.id);
  });
});

/**
 * A rule pack's default states, per scope. `character` applies to every
 * character README that declares none of its own (the theme registry decides
 * whether a world gets a pack at all — the design notes).
 */
export const StatePackSchema = z
  .object({
    player: StateListSchema.optional(),
    world: StateListSchema.optional(),
    character: StateListSchema.optional(),
  })
  .strict();
export type StatePack = z.infer<typeof StatePackSchema>;

export interface StateParse {
  states: StateDecl[];
  /** Human-readable problems; a bad entry is dropped, the rest still parse. */
  errors: string[];
}

/** Read `frontmatter.states` fail-soft: bad entries are dropped with a message. */
export function parseStateDecls(frontmatter: Record<string, unknown> | null | undefined): StateParse {
  const raw = frontmatter?.states;
  if (raw === undefined || raw === null) return { states: [], errors: [] };
  if (!Array.isArray(raw)) return { states: [], errors: ['states must be a list'] };
  const states: StateDecl[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  raw.forEach((entry, i) => {
    const r = StateDeclSchema.safeParse(entry);
    if (!r.success) {
      errors.push(`states[${i}]: ${r.error.issues.map((x) => `${x.path.join('.') || '(entry)'} ${x.message}`).join('; ')}`);
      return;
    }
    if (seen.has(r.data.id)) {
      errors.push(`states[${i}]: duplicate state id "${r.data.id}"`);
      return;
    }
    seen.add(r.data.id);
    states.push(r.data);
  });
  return { states, errors };
}

/** Coerce a raw `status.data` value to the state's type; `null` when it cannot be. */
function coerce(decl: StateDecl, raw: unknown): StateValue | null {
  if (decl.type === 'number') {
    const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : null;
  }
  if (decl.type === 'flag') {
    if (typeof raw === 'boolean') return raw;
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return null;
  }
  return typeof raw === 'string' && decl.values?.includes(raw) ? raw : null;
}

/** Keep a number inside its declared range. Other types pass through. */
export function clampState(decl: StateDecl, value: StateValue): StateValue {
  if (decl.type !== 'number' || typeof value !== 'number' || !decl.range) return value;
  return Math.min(decl.range[1], Math.max(decl.range[0], value));
}

/** The current value: `status.data[id]` when it fits the type, else `initial`. Always clamped. */
export function currentStateValue(decl: StateDecl, statusData: Record<string, unknown> | null | undefined): StateValue {
  const v = coerce(decl, statusData?.[decl.id]);
  return clampState(decl, v ?? decl.initial);
}

/**
 * Validate and normalise a value about to be written. Throws a plain Error
 * with an author-facing message when the value does not fit the type.
 */
export function normalizeStateWrite(decl: StateDecl, value: unknown): StateValue {
  const v = coerce(decl, value);
  if (v === null) {
    const want = decl.type === 'enum' ? `one of ${decl.values?.join(', ')}` : decl.type === 'flag' ? 'true or false' : 'a number';
    throw new Error(`state "${decl.id}" is ${decl.type}; ${JSON.stringify(value)} is not ${want}`);
  }
  return clampState(decl, v);
}

/** The prose for one value, or null when there is nothing to say (a false flag with no text). */
export function stateProse(decl: StateDecl, value: StateValue): string | null {
  const shown = decl.shown_as;
  if (decl.type === 'number') {
    if (Array.isArray(shown)) {
      const n = value as number;
      const band = shown.find((b) => (b.min === undefined || n >= b.min) && (b.max === undefined || n <= b.max));
      return band ? band.text : null;
    }
    return `${decl.label} ${value}`;
  }
  if (decl.type === 'flag') {
    if (shown && !Array.isArray(shown)) return shown[String(value)] ?? null;
    return value === true ? decl.label : null;
  }
  if (shown && !Array.isArray(shown)) return shown[String(value)] ?? String(value);
  return `${decl.label}：${value}`;
}

/** One line for a panel. */
export interface MappedState {
  id: string;
  label: string;
  text: string;
}

/**
 * What a panel shows for one README: every non-hidden declared state as prose,
 * in declaration order. Numbers never appear unless the author chose no bands.
 */
export function mappedStates(frontmatter: Record<string, unknown> | null | undefined): MappedState[] {
  const { states } = parseStateDecls(frontmatter);
  const status = frontmatter?.status as { data?: Record<string, unknown> } | undefined;
  const data = status && typeof status === 'object' ? status.data : undefined;
  const out: MappedState[] = [];
  for (const decl of states) {
    if (decl.hidden) continue;
    const text = stateProse(decl, currentStateValue(decl, data));
    if (text) out.push({ id: decl.id, label: decl.label, text });
  }
  return out;
}

/** Declared state ids of one README — status keys a panel/table must not print raw. */
export function declaredStateIds(frontmatter: Record<string, unknown> | null | undefined): Set<string> {
  return new Set(parseStateDecls(frontmatter).states.map((s) => s.id));
}

/* ────────────────────────────────────────────────────────────────────────────
 * Hidden hit points
 * ──────────────────────────────────────────────────────────────────────────── */

/** How bad a hurt is. The engine maps it to hp; the writer only ever names the severity. */
export const HARM_SEVERITIES = ['light', 'serious', 'grave'] as const;
export type HarmSeverity = (typeof HARM_SEVERITIES)[number];

/**
 * hp lost per severity, scaled to the declared range (span = max − min):
 * light = span/4, serious = span/2, grave = span − 1 (each at least 1, rounded
 * down). A grave wound never kills from full health on its own — death comes
 * from wounds that pile up, or from an explicit trigger (a fumble in the fog).
 */
export function harmAmount(decl: StateDecl, severity: HarmSeverity): number {
  const span = decl.range ? decl.range[1] - decl.range[0] : typeof decl.initial === 'number' ? decl.initial : 3;
  const safe = Math.max(1, span);
  if (severity === 'grave') return Math.max(1, safe - 1);
  if (severity === 'serious') return Math.max(1, Math.floor(safe / 2));
  return Math.max(1, Math.floor(safe / 4));
}

/* ────────────────────────────────────────────────────────────────────────────
 * Example rule packs — data, validated by tests.
 * ──────────────────────────────────────────────────────────────────────────── */

/** A pack with its empty scopes dropped (StatePackSchema takes each scope as optional). */
function packOf(id: string): StatePack {
  const decls = rulePackStateDecls(id, 'zh-CN');
  return Object.fromEntries(Object.entries(decls).filter(([, list]) => list.length > 0)) as StatePack;
}

/**
 * The rule packs' default states in Chinese. The source of truth is the theme
 * registry (`RULE_PACKS[].states` in rules/themes.ts, all three languages);
 * these are the same data, kept as named exports for docs and tests.
 *
 * Narrative worlds: only hit points, said as prose.
 */
export const NARRATIVE_HP_PACK: StatePack = packOf('narrative');

/** CoC style: d100 skills are numbers the player may see; hp and sanity are bands; characters carry trust. */
export const COC_STATE_PACK: StatePack = packOf('coc');

/** DND style: d20 attributes shown as modifiers, hp as prose, the world's alarm as an enum. */
export const DND_STATE_PACK: StatePack = packOf('dnd');
