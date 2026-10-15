import { z } from 'zod';
import { parseDocument, stringify as stringifyYaml } from 'yaml';
import {
  buildInteractiveFields,
  entityName,
  type InteractiveFields,
} from '../rules/interactive.js';

/* ────────────────────────────────────────────────────────────────────────────
 * 1. Interactive fields: three keys, universal to every renderable entity
 * ──────────────────────────────────────────────────────────────────────────── */

/** `status.data` values: flat scalars only. Nesting is rejected (06 §3.4). */
export const InteractiveValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export type InteractiveValue = z.infer<typeof InteractiveValueSchema>;

/**
 * An entity's visible status (doc-20 §2.3). NOT a state system: it is one key in
 * this entity's frontmatter, and reading it means reading that file.
 */
export const StatusSchema = z
  .object({
    /** Key/value snapshot. Key order = author order; the front-end renders in it. */
    data: z.record(z.string(), InteractiveValueSchema),
    /** Optional human title (the folded table's header); defaults to "Status". */
    label: z.string().optional(),
    /**
     * Post-hackathon extension slot (status charts). B1 parses and passes it
     * through but always renders a folded table; writing it is not an error and
     * has no effect.
     */
    chart: z.enum(['bars']).optional(),
  })
  .passthrough();
export type Status = z.infer<typeof StatusSchema>;

/** One option. `then` is a post-hackathon slot that B1 never applies (06 §3.5). */
export const ChoiceOptionSchema = z
  .object({
    label: z.string().min(1),
    /** Stable key; indexes drift when `status` changes, ids do not. */
    id: z.string().min(1).optional(),
    /** Conditional option: `key == value` / `key != value`, read from own status. */
    when: z.string().min(1).optional(),
    /** One grey-line hint for the player; `look_at` prints it after an em dash. */
    hint: z.string().optional(),
    /** Post-hackathon slot: a follow-up change to this entity's own status. */
    then: z.record(z.string(), InteractiveValueSchema).optional(),
    /** Who it is said to: `writer`, a character id, or `companion`; absent → inferred (`addresseeOf`). */
    to: z.string().min(1).optional(),
    /** The line actually spoken to a character (defaults to the label). */
    say: z.string().min(1).optional(),
    /** `from-prologue`: shown only to a player who came from the prologue. */
    for: z.literal('from-prologue').optional(),
    /** Gone after it was chosen once in this run. */
    once: z.boolean().optional(),
    /** Never spent: stays on offer after use. */
    repeat: z.boolean().optional(),
  })
  .passthrough();
export type ChoiceOption = z.infer<typeof ChoiceOptionSchema>;

/** An option group. Both spellings are legal and normalize to one shape (06 §3.3). */
export const ChoiceSchema = z.union([
  /** Shorthand: a list of plain strings, or of full option maps. */
  z.array(z.union([z.string().min(1), ChoiceOptionSchema])),
  /** Full form, needed for mode / allow_free / free_hint. */
  z
    .object({
      /** B1 implements single only; 'multi' throws `unsupported` (06 §7). */
      mode: z.enum(['single', 'multi']).optional(),
      options: z.array(z.union([z.string().min(1), ChoiceOptionSchema])),
      /** Free-input fallback: the group stays, plus a "write your own" entry. */
      allow_free: z.boolean().optional(),
      /** Placeholder for the free-input box. */
      free_hint: z.string().optional(),
    })
    .passthrough(),
]);
export type Choice = z.infer<typeof ChoiceSchema>;

/**
 * A die an entity declares (doc-20 §2.2: entity declares, engine adjudicates).
 * Shape frozen by 07; `result`/`passed` are written back by the engine.
 */
export const RollDiceSchema = z
  .object({
    type: z.string().min(1).default('1d100'),
    desc: z.string().min(1),
    /**
     * Engine-readable comparison, MUST be quoted: ">50". Unquoted, YAML reads
     * `>50` as a block-scalar header and silently yields "". `.min(1)` makes a
     * bad declaration fail loudly instead of defaulting to `>50`.
     */
    expect: z.string().min(1),
    result: z.number().optional(),
    passed: z.boolean().optional(),
  })
  .passthrough();
export type RollDice = z.infer<typeof RollDiceSchema>;

/** The three universal interactive keys. An empty object is legal. */
export const InteractiveFieldsSchema = z
  .object({
    choice: ChoiceSchema.optional(),
    roll_dice: RollDiceSchema.optional(),
    status: StatusSchema.optional(),
  })
  .passthrough();
export type InteractiveFieldsRaw = z.infer<typeof InteractiveFieldsSchema>;

/* ────────────────────────────────────────────────────────────────────────────
 * 2. The entity itself: a small core (doc-10 E12); render kind is decided elsewhere
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * The minimal core every stored entity shares. Shape only, no semantics:
 * `type` is a free string, never an enum, because a new type is a slot, not a
 * global closed list. `cardKindOf` / `resolveComponentKind` (forms.ts, doc 10)
 * answer "what is this, who renders it" — this file deliberately does not
 * grow a second kind convention (00 §8).
 *
 * The four strings are `.nullish()`: a bare key (`title:`) parses as YAML null,
 * and that must yield `entity.title === null` rather than invalidating the whole
 * entity (06 §9.2).
 */
export const BaseEntitySchema = z
  .object({
    /** chalk | component | note | letter | gate | readme | asset | … (free string). */
    type: z.string().nullish(),
    /** Renderer key when `type === 'component'` (doc 10 registry key). */
    component: z.string().nullish(),
    /** Card title (chalk / component / letter / note). */
    title: z.string().nullish(),
    /** Human name (README / gate; other files fall back to their filename). */
    name: z.string().nullish(),
  })
  .passthrough();

/**
 * Universal frontmatter = core ∩ interactive fields, unknown keys preserved.
 *
 * doc-20 §2 writes `BaseEntitySchema.and(InteractiveFieldsSchema).passthrough()`,
 * but in zod 3.25 `.and()` returns a ZodIntersection with no `.passthrough()`
 * (06 §11 conflict 4). `z.intersection` of two `.passthrough()` schemas is the
 * equivalent that also keeps unknown keys (bg / bgStyle / accepts / marks).
 */
export const EntityFrontmatterSchema = z.intersection(
  BaseEntitySchema.passthrough(),
  InteractiveFieldsSchema.passthrough()
);
export type EntityFrontmatter = z.infer<typeof EntityFrontmatterSchema>;

/* ────────────────────────────────────────────────────────────────────────────
 * 3. Parse entry
 * ──────────────────────────────────────────────────────────────────────────── */

export interface ParsedFrontmatter {
  /**
   * The raw frontmatter, with NO schema filtering (bg / bgStyle / future
   * `accepts` / `marks` / `rows` all live here). Null when the block is missing
   * or the YAML does not parse.
   */
  frontmatter: Record<string, any> | null;
  /** The body, byte-identical to the input after the closing `---`. */
  body: string;
  /** Typed narrowing (core + interactive fields). Null when frontmatter is null. */
  entity: EntityFrontmatter | null;
  /**
   * The normalized interactive block. NEVER null (all three keys are null when
   * the entity has none). The front-end / look_at / choose / roll_dice read it.
   */
  interactive: InteractiveFields;
  /** Non-fatal problems (YAML syntax, field shape, bad `when`). Empty when clean. */
  errors: string[];
}

/**
 * Frontmatter block split. The regex never changed (06 §12 open item 10):
 * it tolerates `\r?\n` and an optional closing newline, but requires the block
 * to start at byte 0 and the closing fence to be preceded by at least one
 * character — so a zero-content block (`---\n---\n`) does not match and the
 * whole input is treated as the body (identical to the old parser).
 */
const FM_BLOCK = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/** Interactive keys whose shape errors `buildInteractiveFields` reports itself. */
const INTERACTIVE_KEYS = new Set(['choice', 'status', 'roll_dice']);

export function parseFrontmatter(rawContent: string): ParsedFrontmatter {
  const emptyInteractive = (): InteractiveFields => buildInteractiveFields(null);
  const match = rawContent.match(FM_BLOCK);
  if (!match) {
    return { frontmatter: null, body: rawContent, entity: null, interactive: emptyInteractive(), errors: [] };
  }

  const [, yamlBlock, body] = match;
  const errors: string[] = [];

  /**
   * parseDocument, not parse: we want the `errors` list (failure must be visible).
   * logLevel 'silent' keeps yaml off stderr (the extension's stdio is an RPC channel).
   * maxAliasCount on `toJS` below guards against a billion-laughs alias bomb.
   */
  const doc = parseDocument(yamlBlock, { logLevel: 'silent' });
  for (const e of doc.errors) errors.push(e.message.split('\n')[0]);

  let raw: Record<string, any> | null = null;
  try {
    const js = doc.toJS({ maxAliasCount: 100 });
    raw =
      js === null || js === undefined
        ? {}
        : typeof js === 'object' && !Array.isArray(js)
          ? js
          : (errors.push('Frontmatter must be a YAML mapping, got a list'), null);
  } catch (e) {
    errors.push(String((e as Error)?.message ?? e));
  }

  // Broken YAML means "no frontmatter", same path as a missing block: half a
  // frontmatter would render as the wrong card kind, which is worse than none.
  if (errors.length > 0) {
    return { frontmatter: null, body, entity: null, interactive: emptyInteractive(), errors };
  }

  const interactive = buildInteractiveFields(raw, errors);

  const entity = EntityFrontmatterSchema.safeParse(raw);
  if (!entity.success) {
    for (const issue of entity.error.issues) {
      // Interactive sub-shapes are reported by buildInteractiveFields to avoid
      // two messages for one problem.
      if (INTERACTIVE_KEYS.has(String(issue.path[0] ?? ''))) continue;
      errors.push(`${issue.path.join('.') || '(root)'}: ${issue.message}`);
    }
  }

  return {
    frontmatter: raw, // unfiltered: bg / bgStyle / accepts / marks all survive
    body,
    entity: entity.success ? entity.data : null,
    interactive,
    errors,
  };
}

export { entityName, buildInteractiveFields };
export { addresseeOf, isLineOption, choiceOptionIdentity, visibleChoiceOptions, type Addressee, type NormalizedOption } from '../rules/interactive.js';

/**
 * Re-serialize a frontmatter mapping and body into a whole file. Peer-requested
 * neutral writer (doc 10 handlers rewrite `status.data` through it); doc 02's
 * dedicated `stringifyEntityFrontmatter` is a separate concern. A null/undefined
 * mapping returns the body verbatim (no empty fences).
 *
 * `body` is emitted immediately after the closing fence's newline, so a body
 * taken from `parseFrontmatter` round-trips byte-for-byte (FM_BLOCK consumes at
 * most one newline after the fence; a leading blank line is part of the body).
 */
export function stringifyFrontmatter(frontmatter: Record<string, any> | null | undefined, body: string): string {
  if (frontmatter === null || frontmatter === undefined) return body;
  const yaml = stringifyYaml(frontmatter).trimEnd();
  return `---\n${yaml}\n---\n${body}`;
}

/**
 * Legacy chalk writer. Kept exported because `apps/server/src/routes/world.ts`
 * still imports it (doc 02 §9.1 / doc 06 §9.3). Its one production caller is
 * the old `/dice` route, which 07's `patchRollDiceResult` replaces.
 */
export function stringifyChalk(frontmatter: Record<string, any>, body: string): string {
  const lines: string[] = ['---'];
  for (const [k, v] of Object.entries(frontmatter)) {
    if (k === 'choice' && Array.isArray(v)) {
      lines.push('choice:');
      for (const item of v) lines.push(`  - "${item}"`);
    } else if (k === 'status' && typeof v === 'object' && v?.data) {
      lines.push('status:');
      lines.push('  data:');
      for (const [sk, sv] of Object.entries(v.data)) {
        lines.push(`    ${sk}: "${sv}"`);
      }
    } else if (k === 'roll_dice' && typeof v === 'object' && v) {
      lines.push('roll_dice:');
      for (const [rk, rv] of Object.entries(v)) {
        lines.push(`    ${rk}: "${rv}"`);
      }
    } else {
      lines.push(`${k}: ${JSON.stringify(v)}`);
    }
  }
  lines.push('---');
  lines.push('');
  lines.push(body);
  return lines.join('\n');
}

/** Compatibility spelling used by the canvas widgets. */
export const InteractionFieldsSchema = InteractiveFieldsSchema;
