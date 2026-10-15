/**
 * Interactive-field rules (doc 06 §2.3). ZERO dependencies on purpose:
 * no zod, no yaml, no node builtins. `schemas/frontmatter.ts` imports THIS,
 * never the other way around, so the same pure functions can be imported by
 * the extension, the web front-end, `rules/dice.ts` and the unit tests.
 *
 * Everything that decides "which option is number N", "is this option visible",
 * "what is this entity called" and "how the three blocks read as text" lives
 * here, and only here. `look_at`, the UI, `choose` and `roll_dice` all consume
 * these functions, so the numbering can never drift between them (06 §3.5).
 */

import { evalWhen, parseCondition, WHEN_PROFILE } from '../commands/condition.js';

/** Parse cap on the visible option list (06 §7.2). Parsing and display share it. */
export const CHOICE_LIMIT = 12;

/** `to`: the writer, the companion, or a character id (ASCII kebab-case). */
export const ADDRESSEE_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export interface NormalizedOption {
  /** 1-based position in the VISIBLE list (invisible options do not take a number). */
  index: number;
  label: string;
  id?: string;
  when?: string;
  hint?: string;
  /**
   * Who the option is said to: `writer` (a move that changes the world), a registered
   * character id, or `companion` (whoever follows the player now). Absent → inferred by `addresseeOf`.
   */
  to?: string;
  /** What is actually said to a character (defaults to the label). */
  say?: string;
  /** Who sees the option: `from-prologue` = only a player who came from the prologue. */
  for?: string;
  /**
   * How long the option lasts once used: `once` = gone after it was
   * chosen once in this run; `repeat` = never spent (a line said again, a take kept on offer). Neither → the kind
   * decides (a take is spent when its paths are gone, a search when the spot is rolled, a line after it was said).
   */
  once?: true;
  repeat?: true;
  /** Visibility at parse time. false = condition not met, or no status at all. */
  visible: boolean;
}

export interface NormalizedChoice {
  mode: 'single' | 'multi';
  allowFree: boolean;
  freeHint?: string;
  /** Every option (invisible included), in author order. */
  options: NormalizedOption[];
}

export interface InteractiveFields {
  status: { data: Record<string, string | number | boolean | null>; label?: string; chart?: 'bars' } | null;
  choice: NormalizedChoice | null;
  roll_dice: { type: string; desc: string; expect: string; result?: number; passed?: boolean } | null;
}

/** The canonical all-null block. Never null itself, so consumers never null-check. */
export const EMPTY_INTERACTIVE_FIELDS: InteractiveFields = { status: null, choice: null, roll_dice: null };

function isPlainObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/* `evalWhen` now comes from `commands/condition.ts` (03 §9.1): one parser and
 * one evaluator for every `when` in the repo, so the choice-visibility grammar
 * and the command-condition grammar cannot drift apart. `commands/condition.ts`
 * is zero-dependency, which is what lets this module keep its ZERO-dependency
 * contract (it imports nothing but pure functions). Behaviour is unchanged:
 * a missing `status.data` key is `undefined`, a malformed expression is false. */
export { evalWhen };

/**
 * Is this `when` well formed? Display and resolution MUST agree on the answer
 * (§3.5), so this asks the SAME parser `evalWhen` uses rather than a local
 * regex — a second grammar here is exactly how the two would drift.
 *
 * Used only to decide whether the author gets a warning; a malformed `when`
 * still evaluates to `false` (fail-closed).
 */
function isWellFormedWhen(when: string): boolean {
  return parseCondition(when, WHEN_PROFILE).ok;
}

/**
 * The ONLY extraction point from raw frontmatter (§3.3). `parseFrontmatter`
 * calls it; nothing else digs into the raw keys.
 *
 * A malformed sub-structure makes THAT key null (never a half-widget) and
 * appends one human-readable line to `errors` when a sink is supplied. Raw
 * frontmatter is never mutated or dropped (§3.3 ③).
 */
export function buildInteractiveFields(
  raw: Record<string, any> | null | undefined,
  errors?: string[]
): InteractiveFields {
  const note = (msg: string): void => {
    if (errors) errors.push(msg);
  };
  if (!isPlainObject(raw)) return EMPTY_INTERACTIVE_FIELDS;

  const status = buildStatus(raw.status, note);
  const choice = buildChoice(raw.choice, status ? status.data : null, note);
  const roll_dice = buildRollDice(raw.roll_dice, note);
  return { status, choice, roll_dice };
}

function buildStatus(value: unknown, note: (msg: string) => void): InteractiveFields['status'] {
  if (value === undefined || value === null) return null;
  if (!isPlainObject(value)) {
    note('status must be a mapping with a "data" mapping');
    return null;
  }

  let label: string | undefined;
  if (value.label !== undefined) {
    if (typeof value.label === 'string') label = value.label;
    else {
      note('status.label must be a string');
      return null;
    }
  }

  let chart: 'bars' | undefined;
  if (value.chart !== undefined) {
    if (value.chart === 'bars') chart = 'bars';
    else {
      note(`status.chart must be "bars" when present, got ${JSON.stringify(value.chart)}`);
      return null;
    }
  }

  // Canonical form is `status: { data: {...} }`; the flat form `status: {k: v}`
  // (no `data` key) is tolerated and read as the data itself (03 §5.3).
  const nested = isPlainObject(value.data);
  const source = nested ? value.data : value;
  const data: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(source)) {
    if (!nested && (k === 'label' || k === 'chart' || k === 'data')) continue;
    if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      data[k] = v;
    } else {
      note(`status.data.${k} must be a scalar (string | number | boolean | null)`);
      return null;
    }
  }
  return {
    data,
    ...(label !== undefined ? { label } : {}),
    ...(chart !== undefined ? { chart } : {}),
  };
}

function buildChoice(
  value: unknown,
  statusData: Record<string, unknown> | null,
  note: (msg: string) => void
): NormalizedChoice | null {
  if (value === undefined || value === null) return null;

  let mode: 'single' | 'multi' = 'single';
  let allowFree = false;
  let freeHint: string | undefined;
  let optionList: unknown[];

  if (Array.isArray(value)) {
    optionList = value;
  } else if (isPlainObject(value)) {
    if (value.mode !== undefined) {
      if (value.mode === 'single' || value.mode === 'multi') mode = value.mode;
      else {
        note(`choice.mode must be "single" or "multi", got ${JSON.stringify(value.mode)}`);
        return null;
      }
    }
    if (value.allow_free !== undefined) {
      if (typeof value.allow_free === 'boolean') allowFree = value.allow_free;
      else {
        note('choice.allow_free must be a boolean');
        return null;
      }
    }
    if (value.free_hint !== undefined) {
      if (typeof value.free_hint === 'string') freeHint = value.free_hint;
      else {
        note('choice.free_hint must be a string');
        return null;
      }
    }
    if (!Array.isArray(value.options)) {
      note('choice must be a list of options or a mapping with an "options" list');
      return null;
    }
    optionList = value.options;
  } else {
    note(`choice must be a list of options or a mapping with an "options" list, got ${JSON.stringify(value)}`);
    return null;
  }

  const options: NormalizedOption[] = [];
  let visibleCount = 0;
  for (const item of optionList) {
    let label: string | undefined;
    let id: string | undefined;
    let when: string | undefined;
    let hint: string | undefined;
    let to: string | undefined;
    let say: string | undefined;
    let audience: string | undefined;
    let once = false;
    let repeat = false;

    if (typeof item === 'string') {
      label = item;
    } else if (isPlainObject(item)) {
      if (typeof item.label === 'string' && item.label.length > 0) label = item.label;
      else {
        note('every choice option must have a non-empty "label"');
        return null;
      }
      if (item.id !== undefined) {
        if (typeof item.id === 'string' && item.id.length > 0) id = item.id;
        else {
          note(`choice option "${label}" has a non-string "id"`);
          return null;
        }
      }
      if (item.when !== undefined) {
        if (typeof item.when === 'string' && item.when.length > 0) when = item.when;
        else {
          note(`choice option "${label}" has an empty "when"`);
          return null;
        }
      }
      if (item.hint !== undefined) {
        if (typeof item.hint === 'string') hint = item.hint;
        else {
          note(`choice option "${label}" has a non-string "hint"`);
          return null;
        }
      }
      // `to` / `say` / `for`: a malformed one is dropped with a note, never the whole widget —
      // the option still works, it is only routed by inference.
      if (item.to !== undefined) {
        if (typeof item.to === 'string' && ADDRESSEE_RE.test(item.to)) to = item.to;
        else note(`choice option "${label}" has an invalid "to" (writer, companion or a character id)`);
      }
      if (item.say !== undefined) {
        if (typeof item.say === 'string' && item.say.trim() !== '') say = item.say.trim();
        else note(`choice option "${label}" has an empty "say"`);
      }
      if (item.for !== undefined) {
        if (item.for === 'from-prologue') audience = item.for;
        else note(`choice option "${label}" has an unknown "for" (only from-prologue)`);
      }
      if (item.once !== undefined) {
        if (typeof item.once === 'boolean') once = item.once;
        else note(`choice option "${label}" has a non-boolean "once"`);
      }
      if (item.repeat !== undefined) {
        if (typeof item.repeat === 'boolean') repeat = item.repeat;
        else note(`choice option "${label}" has a non-boolean "repeat"`);
      }
      if (once && repeat) {
        note(`choice option "${label}" declares both "once" and "repeat"; "repeat" wins`);
        once = false;
      }
    } else {
      note('every choice option must be a string or a mapping with a "label"');
      return null;
    }

    if (when !== undefined && !isWellFormedWhen(when)) {
      note(`choice option "${label}" has a malformed when "${when}"; the option stays hidden (fail-closed)`);
    }

    // Visibility is decided once, here, so display and resolution share it (§3.5).
    const visible = when === undefined ? true : evalWhen(when, statusData);
    options.push({
      index: visible ? ++visibleCount : 0,
      label,
      ...(id !== undefined ? { id } : {}),
      ...(when !== undefined ? { when } : {}),
      ...(hint !== undefined ? { hint } : {}),
      ...(to !== undefined ? { to } : {}),
      ...(say !== undefined ? { say } : {}),
      ...(audience !== undefined ? { for: audience } : {}),
      ...(once ? { once: true as const } : {}),
      ...(repeat ? { repeat: true as const } : {}),
      visible,
    });
  }

  if (visibleCount > CHOICE_LIMIT) {
    note(`choice declares ${visibleCount} visible options; only the first ${CHOICE_LIMIT} are selectable`);
  }

  return { mode, allowFree, ...(freeHint !== undefined ? { freeHint } : {}), options };
}

function buildRollDice(value: unknown, note: (msg: string) => void): InteractiveFields['roll_dice'] {
  if (value === undefined || value === null) return null;
  if (!isPlainObject(value)) {
    note('roll_dice must be a mapping with "type", "desc" and "expect"');
    return null;
  }

  let type = '1d100';
  if (value.type !== undefined) {
    if (typeof value.type === 'string' && value.type.length > 0) type = value.type;
    else {
      note('roll_dice.type must be a non-empty string');
      return null;
    }
  }

  const desc = typeof value.desc === 'string' && value.desc.length > 0 ? value.desc : 'Check';

  if (typeof value.expect !== 'string' || value.expect.length === 0) {
    note('roll_dice is missing a non-empty "expect" comparison');
    return null;
  }

  let result: number | undefined;
  if (value.result !== undefined) {
    if (typeof value.result === 'number') result = value.result;
    else {
      note('roll_dice.result must be a number');
      return null;
    }
  }

  let passed: boolean | undefined;
  if (value.passed !== undefined) {
    if (typeof value.passed === 'boolean') passed = value.passed;
    else {
      note('roll_dice.passed must be a boolean');
      return null;
    }
  }

  return {
    type,
    desc,
    expect: value.expect,
    ...(result !== undefined ? { result } : {}),
    ...(passed !== undefined ? { passed } : {}),
  };
}

/**
 * The visible options, renumbered from 1, capped at `CHOICE_LIMIT`.
 * The UI, `look_at` and `choose` all call THIS, so the number a player sees and
 * the number `choose` accepts are produced by one function (§3.5 / 03 §5.2).
 */
export function visibleChoiceOptions(choice: NormalizedChoice): NormalizedOption[] {
  return choice.options.filter((o) => o.visible).slice(0, CHOICE_LIMIT);
}

/** JSON with sorted keys, so two declarations written in a different key order compare equal. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson((value as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * What an option IS to the player, across cards
 *
 * Two options are the same when they
 * read the same and lead to the same place: the label plus the declared
 * `choice_actions` entry (kind, paths, target…). An option with no declared
 * action goes to the writer about its card, so it only matches another one
 * under the same card title.
 *
 * Used by the options rail (one entry per identity) and by `check:worlds`
 * (no two cards on a layer may declare the same option).
 */
export function choiceOptionIdentity(
  frontmatter: Record<string, unknown> | null | undefined,
  option: Pick<NormalizedOption, 'id' | 'label'>,
  cardTitle: string,
): string {
  const actions = frontmatter?.choice_actions;
  const declared = option.id && actions && typeof actions === 'object'
    ? (actions as Record<string, unknown>)[option.id]
    : undefined;
  const label = option.label.trim();
  if (declared && typeof declared === 'object') return `action\u0000${label}\u0000${stableJson(declared)}`;
  return `writer\u0000${cardTitle.trim()}\u0000${label}`;
}

/**
 * Resolve a caller's choice against the visible list (§3.2).
 * Order, first hit wins: `id` → exact label → case-insensitive label → index.
 * Text is intentionally preferred over a bare number: an option whose own text
 * is `"2"` must still be reachable, and a number always means "index".
 */
export function resolveChoice(
  choice: NormalizedChoice,
  input: string | number
): { option: NormalizedOption } | { error: 'not_found' | 'out_of_range' } {
  const visible = visibleChoiceOptions(choice);

  if (typeof input === 'string') {
    const byId = visible.find((o) => o.id !== undefined && o.id === input);
    if (byId) return { option: byId };

    const exact = visible.filter((o) => o.label === input);
    if (exact.length === 1) return { option: exact[0] };
    if (exact.length > 1) return { error: 'not_found' };

    const lower = input.toLowerCase();
    const ci = visible.filter((o) => o.label.toLowerCase() === lower);
    if (ci.length === 1) return { option: ci[0] };
    if (ci.length > 1) return { error: 'not_found' };
  }

  let index: number | null = null;
  if (typeof input === 'number') {
    if (!Number.isInteger(input)) return { error: 'out_of_range' };
    index = input;
  } else if (/^\d+$/.test(input.trim())) {
    index = Number(input.trim());
  }

  if (index !== null) {
    if (index < 1 || index > visible.length) return { error: 'out_of_range' };
    return { option: visible[index - 1] };
  }

  return { error: 'not_found' };
}

/** title → name → basename minus `.md` (§3.7). Shared by events, look_at and errors. */
export function entityName(fm: Record<string, any> | null | undefined, path: string): string {
  if (isPlainObject(fm)) {
    if (typeof fm.title === 'string' && fm.title.trim() !== '') return fm.title.trim();
    if (typeof fm.name === 'string' && fm.name.trim() !== '') return fm.name.trim();
  }
  const base = String(path ?? '').split('/').pop() ?? '';
  return base.endsWith('.md') ? base.slice(0, -3) : base;
}

/**
 * `[Status]` / `[Choices]` / `[Dice]`, in that fixed order, blocks joined by a
 * blank line (03 §5.3). Returns '' when all three are absent — `look_at`
 * appends this verbatim, so an empty string means "no block".
 * Input is RAW frontmatter; this builds the normalized fields itself. `done` = option keys (id, else label)
 * that are done in this save (`actions/option-state.ts`).
 */
export function formatInteractiveText(raw: Record<string, any> | null | undefined, done?: ReadonlySet<string>): string {
  const fields = buildInteractiveFields(raw);
  const blocks: string[] = [];

  if (fields.status) {
    const lines = ['[Status]'];
    if (fields.status.label !== undefined) lines.push(fields.status.label);
    for (const [k, v] of Object.entries(fields.status.data)) {
      lines.push(`${k}: ${v === null ? 'null' : String(v)}`);
    }
    if (lines.length > 1 + (fields.status.label !== undefined ? 1 : 0)) blocks.push(lines.join('\n'));
  }

  if (fields.choice) {
    const visible = visibleChoiceOptions(fields.choice);
    if (visible.length > 0) {
      const lines = ['[Choices]'];
      // A done option keeps its number (`choose` numbers the same list) but says so: the page
      // no longer offers it, and the writer should not offer it again either.
      for (const o of visible) lines.push(`${o.index}. ${o.label}${o.hint !== undefined ? ` — ${o.hint}` : ''}${done?.has(o.id ?? o.label) ? ' (done — no longer offered)' : ''}`);
      // Only a MALFORMED `when` earns a diagnostic line: a condition that is
      // simply false is invisible by design, and showing it would leak a locked
      // door's label to the player (03 §5.3 / §13.9). A broken one must be
      // visible, or the author never learns to fix it.
      for (const o of fields.choice.options) {
        if (!o.visible && o.when !== undefined && !isWellFormedWhen(o.when)) {
          lines.push(`(hidden: "${o.label}" — malformed when "${o.when}")`);
        }
      }
      blocks.push(lines.join('\n'));
    }
  }

  if (fields.roll_dice) {
    const d = fields.roll_dice;
    const state =
      d.result === undefined
        ? 'not rolled'
        : `rolled ${d.result} — ${d.passed === true ? 'passed' : 'failed'}`;
    blocks.push(`[Dice]\n${d.desc} · ${d.type} · success ${d.expect} · ${state}`);
  }

  return blocks.join('\n\n');
}

// ── who an option is said to ────────────────────────

/**
 * Where an option goes: to the WRITER (a move — the world changes; it rides the writer's tray) or to a
 * CHARACTER (a line — `say` is what is spoken; it rides that character's bubble). `companion` is resolved
 * by the page to whoever follows the player now.
 */
export type Addressee = { to: 'writer'; say: null } | { to: string; say: string };

const WRITER_KINDS = new Set(['enter', 'take', 'read', 'search', 'stage', 'writer', 'talk']);

/**
 * Pure, total: who `option` (on the card whose frontmatter this is) is said to. An explicit `to` wins;
 * otherwise the verb decides, never the names in the label (§1.1 「看动词，不看名词」):
 *   - a declared world move (enter / take / read / search / stage / talk), or a dice card → the writer;
 *   - `kind: character` → that character, saying `say` (else the label);
 *   - nothing declared → the writer (what `choiceKind` always fell back to).
 */
export function addresseeOf(
  frontmatter: Record<string, unknown> | null | undefined,
  option: Pick<NormalizedOption, 'id' | 'label' | 'to' | 'say'>,
): Addressee {
  const actions = frontmatter?.choice_actions;
  const declared = option.id && isPlainObject(actions) ? (actions as Record<string, unknown>)[option.id] : undefined;
  const action = isPlainObject(declared) ? declared : null;
  const say = (option.say ?? option.label).trim();
  if (option.to === 'writer') return { to: 'writer', say: null };
  if (option.to) return { to: option.to, say };
  if (action && action.kind === 'character' && typeof action.character === 'string' && action.character) {
    return { to: action.character, say };
  }
  if (action && typeof action.kind === 'string' && WRITER_KINDS.has(action.kind)) return { to: 'writer', say: null };
  return { to: 'writer', say: null };
}

/** Does this option speak a line (rather than make a move)? */
export const isLineOption = (frontmatter: Record<string, unknown> | null | undefined, option: Pick<NormalizedOption, 'id' | 'label' | 'to' | 'say'>): boolean =>
  addresseeOf(frontmatter, option).to !== 'writer';
