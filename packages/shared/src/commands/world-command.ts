/**
 * World-command declaration + static validator — `the design notes`.
 *
 * `01` owns what a `command/<id>.yaml` LOOKS like and how it is checked. It owns
 * neither the `on` field (`02`), nor condition semantics (`03`), nor effect
 * execution (`04`). This module is the whole of `01` in code, and it is PURE and
 * SYNCHRONOUS: no fs, no db, no network, no clock, no rng. Two callers share one
 * verdict and both have nothing but text in hand —
 *   1. `extensions/world-context.ts`'s `tool_call` hook (write-time gate), and
 *   2. the action layer, re-checking before it executes (a `bash` call can write
 *      a file the extension never saw).
 * That is why `parseWorldCommand` takes `(id, raw)` and not a store.
 *
 * FAIL LOUDLY, IN FULL. Every problem is collected instead of thrown on the
 * first, because `07` joins the array into one `block.reason` so the model fixes
 * the file in a SINGLE round trip. The 46 error codes are not decoration: each
 * one names a different repair (add a field / rename / quote / reduce / label a
 * bound), and a coarse `invalid` would leave the model guessing.
 *
 * THE ONE SILENT FAILURE THIS FILE EXISTS TO CATCH. `path: {{ p }}` is NOT a
 * YAML error — `yaml@2.9.0` reads a scalar starting with `{{` as a flow map and
 * returns `{"path":{"{ p }":null}}` with `doc.errors === []` (measured). It then
 * passes every schema check because it is a VALUE, not an unknown key, and ends
 * as an empty path at run time. `{{` at the start of a scalar is therefore a
 * structural error (`unquoted_template`), detected on the CST and not by asking
 * YAML to complain.
 */
import { LineCounter, isMap, isNode, isPair, isScalar, isSeq, parseDocument } from 'yaml';
import type { Document, Node as YamlNode } from 'yaml';
import type { ParsedFrontmatter } from '../schemas/frontmatter.js';
import { WORLD_COMMAND_EFFECTS, WORLD_COMMAND_EFFECT_ARGS } from './effects.js';
import type { WorldCommandEffectName } from './effects.js';
import { parseCommandWhen } from './condition.js';
import type { ConditionAst } from './condition.js';
import {
  ARG_KEY_RE,
  COMMAND_ID_RE,
  MAX_COMMAND_ARG_DEPTH,
  MAX_COMMAND_ARG_KEYS,
  MAX_COMMAND_DESC_LENGTH,
  MAX_COMMAND_EFFECTS,
  MAX_COMMAND_FILE_BYTES,
  MAX_COMMAND_ID_LENGTH,
  MAX_COMMAND_NAME_LENGTH,
  MAX_COMMAND_PARAMS,
  MAX_COMMAND_REFS,
  MAX_COMMAND_STEPS,
  MAX_COMMAND_STRING,
  MAX_COMMAND_WHEN_LENGTH,
  MAX_ENUM_VALUES,
  PARAM_NAME_RE,
  RESERVED_ROOTS,
  TEMPLATE_RE,
} from './limits.js';

/* ────────────────────────────────────────────────────────────────────────────
 * 1. The declared shape (`01` §8.1)
 * ──────────────────────────────────────────────────────────────────────────── */

export type WorldCommandParamType = 'string' | 'number' | 'boolean' | 'enum';

export interface WorldCommandParamSpec {
  type: WorldCommandParamType;
  /** `enum` only. 2..16 ASCII values, unique. */
  values?: readonly string[];
  /** Absent ⇒ the parameter is REQUIRED (`01` §2.3: there is no `required` key). */
  default?: string | number | boolean;
}

/** A literal, a template string, or a nested map. Depth ≤ `MAX_COMMAND_ARG_DEPTH`. */
export type WorldCommandArgNode =
  | string
  | number
  | boolean
  | { readonly [key: string]: WorldCommandArgNode };

export interface WorldCommandStep {
  /** An ISO effect name from `WORLD_COMMAND_EFFECTS` (`04`). */
  action: string;
  /** Condition expression; syntax owned by `03`, position owned here (`01` §2.6). */
  when?: string;
  /**
   * The compiled `when` (`03`'s `parseCommandWhen`), attached at write time so
   * the executor never re-parses. Absent when `when` is absent.
   *
   * MUST NOT participate in `canonicalCommandStepText` — it is a runtime
   * derivation, not the declared form, and folding it into the digest would drag
   * the evaluator's version into `05`'s provenance-only `plan`.
   */
  whenAst?: ConditionAst;
  args: Readonly<Record<string, WorldCommandArgNode>>;
  /** 1-based line of this step's `action:` node, for error copy. */
  line: number;
}

export interface WorldCommandSpec {
  /** Derived from the FILENAME, never from the content (`01` §2.1). */
  id: string;
  /** Required, ≤ `MAX_COMMAND_NAME_LENGTH`, no `{{ }}`. Human text. */
  name: string;
  /** Optional, ≤ `MAX_COMMAND_DESC_LENGTH`, no `{{ }}`. Human text. */
  desc?: string;
  params: Readonly<Record<string, WorldCommandParamSpec>>;
  /** Declaration order. MUST NOT be re-sorted: index = `05`'s step cursor. */
  steps: readonly WorldCommandStep[];
}

/* ────────────────────────────────────────────────────────────────────────────
 * 2. Diagnostics (`01` §7.1)
 * ──────────────────────────────────────────────────────────────────────────── */

/** Closed union: 46 members, each with exactly one row in `01` §7.3. */
export type WorldCommandErrorCode =
  // A. file and YAML
  | 'invalid_command_id'
  | 'file_too_large'
  | 'yaml_syntax'
  | 'yaml_duplicate_key'
  | 'root_not_mapping'
  // B. unquoted template
  | 'unquoted_template'
  // C. top-level fields
  | 'unknown_key'
  | 'missing_key'
  | 'name_empty'
  | 'name_has_template'
  // D. params
  | 'params_not_mapping'
  | 'too_many_params'
  | 'invalid_param_name'
  | 'reserved_param_name'
  | 'invalid_param_type'
  | 'invalid_param_default'
  | 'enum_empty'
  | 'enum_too_many'
  | 'enum_duplicate'
  // E. do shape
  | 'do_not_list'
  | 'do_empty'
  | 'too_many_steps'
  | 'step_not_mapping'
  | 'step_missing_action'
  | 'unknown_action'
  | 'nested_do'
  | 'too_many_effects'
  // F. arguments
  | 'with_not_mapping'
  | 'unknown_arg'
  | 'missing_arg'
  | 'arg_not_string'
  | 'arg_literal_array'
  | 'arg_shape_mismatch'
  | 'arg_too_deep'
  | 'arg_reserved_key'
  // G. template references
  | 'malformed_template'
  | 'unknown_param_ref'
  | 'unknown_context_ref'
  | 'array_in_inline_template'
  // H. when
  | 'invalid_when'
  | 'non_ascii_machine_field'
  // I. run
  | 'invalid_run_target'
  | 'self_recursion'
  // J. shared bounds and safety ceilings
  | 'field_too_long'
  | 'too_many_refs'
  | 'unknown_array_bound';

export type WorldCommandWarningCode = 'unused_param';

/** One diagnostic. `line` / `column` are 1-based, present when the CST has a position. */
export interface WorldCommandDiagnostic {
  code: WorldCommandErrorCode | WorldCommandWarningCode;
  /** Model-facing English, ONE sentence: what is wrong + the correct form. */
  message: string;
  /** Dotted path into the file, e.g. `do[2].with.rewards`. */
  path: string;
  line?: number;
  column?: number;
}

export type WorldCommandParseResult =
  | { ok: true; command: WorldCommandSpec; warnings: WorldCommandDiagnostic[] }
  | { ok: false; errors: WorldCommandDiagnostic[]; warnings: WorldCommandDiagnostic[] };

/* ────────────────────────────────────────────────────────────────────────────
 * 3. `commandIdOfPath` (`01` §2.1)
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Derive `<id>` from a world-root-relative path.
 *
 * Returns null when the path is not exactly `command/<id>.yaml` with a legal
 * `<id>`. The caller is expected to have normalised the path first
 * (`07` uses `path.relative(...)`); this function stays strict on purpose — a
 * lenient matcher here would let `world/command/x.yaml` look like a command.
 */
export function commandIdOfPath(path: string): string | null {
  if (typeof path !== 'string') return null;
  const parts = path.split('/');
  if (parts.length !== 2) return null;
  const [dir, file] = parts;
  if (dir !== 'command') return null;
  if (file === undefined || !file.endsWith('.yaml')) return null;
  const id = file.slice(0, -'.yaml'.length);
  return COMMAND_ID_RE.test(id) ? id : null;
}

/* ────────────────────────────────────────────────────────────────────────────
 * 4. `canonicalCommandStepText` (`01` §8.1)
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Deterministic, pure, sync. Canonicalises ONE declared step WITHOUT resolving
 * any template — `05` digests the join of these into `CommandLogEntry.plan`.
 *
 * Three rules (`01` §8.1):
 *   1. `{{ x }}` normalises to `{{x}}` (inner whitespace removed, NOT evaluated);
 *   2. map keys sort by code unit; LIST ORDER IS PRESERVED — order is semantic,
 *      `fold-args` key order and the digest itself depend on it;
 *   3. scalars serialise as JSON literals; newlines normalise to `\n`.
 *
 * `whenAst` is deliberately EXCLUDED: the digest is of the DECLARED form, and an
 * AST would fold the evaluator's current version into a value whose whole job is
 * to be comparable against the current file (`01` §3.5, `05` §11.7).
 */
export function canonicalCommandStepText(step: WorldCommandStep): string {
  const parts = [`action:${step.action}`];
  if (step.when !== undefined) parts.push(`when:${canonicalScalar(step.when)}`);
  parts.push(`with:${canonicalNode(step.args, 0)}`);
  return parts.join('|');
}

/** Canonical text of an argument tree. Depth is only for recursion, not a limit here. */
function canonicalNode(node: unknown, depth: number): string {
  if (depth > MAX_COMMAND_ARG_DEPTH + 2) return JSON.stringify(String(node));
  if (Array.isArray(node)) {
    // Order preserved: never `Set`, never a sort (`01` §8.1 rule 2).
    return `[${node.map((item) => canonicalNode(item, depth + 1)).join(',')}]`;
  }
  if (node !== null && typeof node === 'object') {
    const record = node as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${canonicalNode(record[key], depth + 1)}`)
      .join(',')}}`;
  }
  return canonicalScalar(node);
}

/** Scalars serialise as JSON literals; `{{ x }}` collapses to `{{x}}` (not evaluated). */
function canonicalScalar(value: unknown): string {
  if (typeof value === 'string') {
    return JSON.stringify(
      value.replace(new RegExp(TEMPLATE_RE.source, 'g'), (_whole, ref: string) => `{{${ref}}}`)
    );
  }
  return JSON.stringify(value ?? null);
}

/* ────────────────────────────────────────────────────────────────────────────
 * 5. `parseWorldCommand` (`01` §3.1, steps S1 … S12)
 * ──────────────────────────────────────────────────────────────────────────── */

/** Mutable accumulator of diagnostics, so every check can add instead of returning. */
interface Sink {
  errors: WorldCommandDiagnostic[];
  warnings: WorldCommandDiagnostic[];
}

function error(
  sink: Sink,
  code: WorldCommandErrorCode,
  message: string,
  path: string,
  pos?: { line: number; column: number }
): void {
  sink.errors.push({ code, message, path, ...(pos ?? {}) });
}

/**
 * Parse and validate `command/<id>.yaml`.
 *
 * PURE and SYNCHRONOUS (`01` §8.2). `id` comes from the caller's file path; it
 * is NEVER read from the content. `raw` is the WHOLE file. Collects every
 * problem instead of throwing on the first (`07` needs one round trip).
 */
export function parseWorldCommand(id: string, raw: string): WorldCommandParseResult {
  const sink: Sink = { errors: [], warnings: [] };

  // ── S1: the id comes from the filename.
  if (!COMMAND_ID_RE.test(id)) {
    error(
      sink,
      'invalid_command_id',
      `The filename "${id}.yaml" is not a valid command id. Command ids are ASCII kebab-case, 1-${MAX_COMMAND_ID_LENGTH} chars, e.g. "command/award-clue.yaml".`,
      ''
    );
    return { ok: false, errors: sink.errors, warnings: sink.warnings };
  }

  // ── S2: byte-level checks. Measured in bytes, not code points: the limit is a
  // resource ceiling, and a multi-byte character costs more than one.
  const bytes = Buffer.byteLength(raw, 'utf8');
  if (bytes > MAX_COMMAND_FILE_BYTES) {
    error(
      sink,
      'file_too_large',
      `command/${id}.yaml is ${bytes} bytes; the limit is ${MAX_COMMAND_FILE_BYTES}. Split it into separate commands and declare them as separate entries under the entity's on.<hook> array.`,
      ''
    );
    return { ok: false, errors: sink.errors, warnings: sink.warnings };
  }

  // ── S3: parseDocument, NOT parse. We need the positional `errors` list, and a
  // duplicate key is otherwise SILENT (measured: `toJS()` still succeeds and the
  // last one wins). `logLevel: 'silent'` keeps yaml off stderr (the extension's
  // stdio is an RPC channel) — same reason `parseFrontmatter` does it.
  const lc = new LineCounter();
  const doc = parseDocument(raw, { logLevel: 'silent', lineCounter: lc });
  if (doc.errors.length > 0) {
    for (const e of doc.errors) {
      const isDuplicate = e.code === 'DUPLICATE_KEY';
      const first = e.linePos?.[0];
      error(
        sink,
        isDuplicate ? 'yaml_duplicate_key' : 'yaml_syntax',
        isDuplicate
          ? `line ${first?.line ?? 0}, column ${first?.col ?? 0}: duplicate key. YAML silently keeps only the LAST one and drops the rest - remove all but one.`
          : `line ${first?.line ?? 0}, column ${first?.col ?? 0}: YAML parse error - ${e.message.split('\n')[0]}. Fix this line first; nothing below it could be checked.`,
        '',
        posOf(first)
      );
    }
    return { ok: false, errors: sink.errors, warnings: sink.warnings };
  }

  // ── S5: unquoted `{{` — BEFORE the schema, or it surfaces as an unreadable
  // `invalid_type`. The check is structural and runs on the CST (§5.1 below).
  const unquoted = findUnquotedTemplate(doc, lc);
  if (unquoted !== undefined) {
    error(
      sink,
      'unquoted_template',
      `line ${unquoted.line}, column ${unquoted.column}: unquoted "{{". A YAML value that STARTS with "{{" is read as a flow map, not text - quote it: "{{ ref }}". Inline use (a{{ x }}b) and block scalars (|) need no quotes.`,
      '',
      unquoted
    );
  }

  // ── S4: the root must be a mapping.
  const root = doc.contents;
  if (root === null || !isMap(root)) {
    error(
      sink,
      'root_not_mapping',
      `command/${id}.yaml must be a mapping of top-level keys (name, desc, params, do), but its root is a ${nodeKind(root)}.`,
      ''
    );
    return { ok: false, errors: sink.errors, warnings: sink.warnings };
  }

  const js = toPlainObject(doc);
  if (js === null) {
    error(sink, 'root_not_mapping', `command/${id}.yaml did not parse into an object.`, '');
    return { ok: false, errors: sink.errors, warnings: sink.warnings };
  }

  // ── S6a: strict top-level keys. `dice_outcomes`'s passthrough history is the
  // whole reason: a mistyped key must not be silently preserved.
  const TOP_LEVEL = ['name', 'desc', 'params', 'do'] as const;
  for (const key of Object.keys(js)) {
    if (!(TOP_LEVEL as readonly string[]).includes(key)) {
      const near = nearest(key, TOP_LEVEL as readonly string[]);
      error(
        sink,
        'unknown_key',
        `unknown field "${key}". Allowed top-level keys: name, desc, params, do.${near === null ? '' : ` Did you mean "${near}"?`}`,
        key
      );
    }
  }
  if (!('name' in js) || !('do' in js)) {
    const missing = !('name' in js) ? 'name' : 'do';
    error(
      sink,
      'missing_key',
      `command/${id}.yaml is missing "${missing}". A command needs "name" (a human-readable name) and a non-empty "do".`,
      missing
    );
  }

  // ── S6b: `name` / `desc`. Human text, no templates, length-capped.
  const name = typeof js['name'] === 'string' ? (js['name'] as string) : undefined;
  if (name !== undefined) {
    if (name.trim() === '') {
      error(sink, 'name_empty', `"name" must not be empty. Give the command a human-readable name, e.g. "Award the investigation note".`, 'name');
    }
    if (name.includes('{{')) {
      error(sink, 'name_has_template', `"name" must be plain text; it is shown to the author, never evaluated. Move "{{ ... }}" into the step args.`, 'name');
    }
    if (name.length > MAX_COMMAND_NAME_LENGTH) {
      error(sink, 'field_too_long', `name is ${name.length} characters; the limit is ${MAX_COMMAND_NAME_LENGTH}.`, 'name');
    }
  } else if ('name' in js) {
    error(sink, 'missing_key', `command/${id}.yaml is missing "name". A command needs "name" (a human-readable name) and a non-empty "do".`, 'name');
  }

  const desc = typeof js['desc'] === 'string' ? (js['desc'] as string) : undefined;
  if (desc !== undefined && desc.length > MAX_COMMAND_DESC_LENGTH) {
    error(sink, 'field_too_long', `desc is ${desc.length} characters; the limit is ${MAX_COMMAND_DESC_LENGTH}.`, 'desc');
  }

  // ── S6c: `params`.
  const params = parseParams(js['params'], sink);

  // ── S6d: `do` — shape, strict keys, effect names, args.
  const steps = parseSteps(js['do'], params, sink);

  // ── S8: template references (roots, declared params, context members).
  const refs = collectRefs(js);
  if (refs.length > MAX_COMMAND_REFS) {
    error(sink, 'too_many_refs', `has ${refs.length} template references; the limit is ${MAX_COMMAND_REFS}.`, '');
  }
  for (const ref of refs) {
    checkRef(ref, params, sink);
  }

  // ── S11: the static effect-count ceiling. Every step is ≥1 effect; a
  // `list-args` step can be more. This bounds the DECLARATION, and it is the
  // number `09`'s cost argument rests on (invariant I-2).
  if (steps.length > MAX_COMMAND_EFFECTS) {
    error(sink, 'too_many_effects', `expands to ${steps.length} effects; the limit is ${MAX_COMMAND_EFFECTS}.`, '');
  }

  // ── Warnings: a declared parameter nobody reads is usually a typo. Not an
  // error (`07` lets an author wire a command up incrementally) but it MUST be
  // visible — silence is what hard gate 4 forbids.
  for (const pname of Object.keys(params)) {
    if (!refs.some((r) => r === pname || r.startsWith(`${pname}.`) || r.startsWith(`${pname}[`))) {
      sink.warnings.push({
        code: 'unused_param',
        message: `parameter "${pname}" is declared but never referenced. Not an error - but an unreferenced parameter is usually a typo.`,
        path: `params.${pname}`,
      });
    }
  }

  if (sink.errors.length > 0) {
    return { ok: false, errors: sink.errors, warnings: sink.warnings };
  }
  const command: WorldCommandSpec = {
    id,
    name: name ?? id,
    ...(desc === undefined ? {} : { desc }),
    params,
    steps,
  };
  return { ok: true, command, warnings: sink.warnings };
}

/* ────────────────────────────────────────────────────────────────────────────
 * 5.1 The unquoted-`{{` detector (`01` §3.2, measured)
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Walk the CST for a Pair whose KEY is not a Scalar node.
 *
 * That shape means "this was a scalar but YAML read it as a flow map", i.e. the
 * source said `path: {{ p }}`. A real flow map (`path: { p }`) has a SCALAR key
 * (`p`), so this rule does not misfire on it, and it does not depend on YAML
 * raising anything — which it does not.
 */
function findUnquotedTemplate(
  doc: Document,
  lc: LineCounter
): { line: number; column: number } | undefined {
  let hit: { line: number; column: number } | undefined;
  const seen = new Set<YamlNode>();

  const visit = (node: unknown): void => {
    if (hit !== undefined || !isNode(node) || seen.has(node)) return;
    seen.add(node);
    if (isMap(node)) {
      for (const item of node.items) {
        if (!isPair(item)) continue;
        if (!isScalar(item.key)) {
          // The key is a Map/Seq ⇒ an unquoted template at scalar position.
          // `isPair`'s key is `unknown`, so narrow before reading `range`.
          const key = item.key as { range?: [number, number, number] } | null;
          const at = key?.range?.[0];
          hit = at === undefined ? { line: 0, column: 0 } : linePosOf(lc, at);
          return;
        }
        visit(item.value);
      }
      return;
    }
    if (isSeq(node)) {
      // Recurse only. A block-map item (`- action: give`) is legitimately a Map,
      // so "item is not a Scalar" is NOT a signal; the Map branch's key check is
      // what catches a bare `- {{ p }}` (whose item is a Map keyed by a Map).
      for (const item of node.items) visit(item);
    }
  };

  visit(doc.contents);
  return hit;
}

function linePosOf(lc: LineCounter, offset: number): { line: number; column: number } {
  const pos = lc.linePos(offset);
  return { line: pos.line, column: pos.col };
}

function posOf(p: { line: number; col: number } | undefined): { line: number; column: number } | undefined {
  return p === undefined ? undefined : { line: p.line, column: p.col };
}

/* ────────────────────────────────────────────────────────────────────────────
 * 5.2 `params` (`01` §2.3)
 * ──────────────────────────────────────────────────────────────────────────── */

function parseParams(raw: unknown, sink: Sink): Record<string, WorldCommandParamSpec> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    error(
      sink,
      'params_not_mapping',
      `"params" must be a mapping of parameter name to its declaration, e.g.\nparams:\n  grade:\n    type: enum\n    values: [success, failure]`,
      'params'
    );
    return {};
  }
  const record = raw as Record<string, unknown>;
  const names = Object.keys(record);
  if (names.length > MAX_COMMAND_PARAMS) {
    error(
      sink,
      'too_many_params',
      `declares ${names.length} parameters; the limit is ${MAX_COMMAND_PARAMS}. Content that varies per entity belongs in the entity's own frontmatter - read it with "{{ trigger.fm.* }}".`,
      'params'
    );
  }

  const out: Record<string, WorldCommandParamSpec> = {};
  for (const pname of names) {
    if (!PARAM_NAME_RE.test(pname)) {
      error(
        sink,
        'invalid_param_name',
        `parameter name "${pname}" is invalid. Use letters, digits and underscore, starting with a letter, max 32 chars.`,
        `params.${pname}`
      );
      continue;
    }
    if (RESERVED_ROOTS.includes(pname)) {
      error(
        sink,
        'reserved_param_name',
        `parameter "${pname}" collides with a built-in namespace. Reserved: ${RESERVED_ROOTS.join(', ')}.`,
        `params.${pname}`
      );
      continue;
    }
    const spec = record[pname];
    if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
      error(sink, 'invalid_param_type', `parameter "${pname}" has no "type"; allowed types are string, number, boolean, enum.`, `params.${pname}.type`);
      continue;
    }
    const specRec = spec as Record<string, unknown>;
    const type = specRec['type'];
    if (type !== 'string' && type !== 'number' && type !== 'boolean' && type !== 'enum') {
      error(
        sink,
        'invalid_param_type',
        `parameter "${pname}" has type "${String(type)}"; allowed types are string, number, boolean, enum.`,
        `params.${pname}.type`
      );
      continue;
    }

    // enum-only fields. `values` must be present, 2..16, ASCII, unique.
    if (type === 'enum') {
      const values = specRec['values'];
      if (!Array.isArray(values) || values.length === 0) {
        error(sink, 'enum_empty', `parameter "${pname}" is type enum but has no "values". List at least 2 allowed values.`, `params.${pname}.values`);
      } else {
        if (values.length > MAX_ENUM_VALUES) {
          error(sink, 'enum_too_many', `parameter "${pname}" has ${values.length} enum values; the limit is ${MAX_ENUM_VALUES}.`, `params.${pname}.values`);
        }
        const seen = new Set<string>();
        for (const value of values) {
          if (typeof value !== 'string' || !ARG_KEY_RE.test(value)) {
            error(sink, 'non_ascii_machine_field', `"params.${pname}.values" is a machine field and must be printable ASCII.`, `params.${pname}.values`);
            continue;
          }
          if (seen.has(value)) {
            error(sink, 'enum_duplicate', `parameter "${pname}" repeats the enum value "${value}".`, `params.${pname}.values`);
          }
          seen.add(value);
        }
      }
    }

    // `default` decides requiredness. Its type must match the declaration —
    // otherwise the `when` write-time re-verification substitutes a placeholder
    // of the wrong shape and "syntax is decidable" stops being true.
    const dflt = specRec['default'];
    if (dflt !== undefined) {
      const ok =
        (type === 'string' && typeof dflt === 'string') ||
        (type === 'number' && typeof dflt === 'number') ||
        (type === 'boolean' && typeof dflt === 'boolean') ||
        (type === 'enum' && typeof dflt === 'string' && Array.isArray(specRec['values']) && (specRec['values'] as unknown[]).includes(dflt));
      if (!ok) {
        error(
          sink,
          'invalid_param_default',
          `the default for "${pname}" must be a ${type} - got ${typeof dflt}. An enum default must be one of its own "values".`,
          `params.${pname}.default`
        );
      }
    }

    out[pname] = {
      type,
      ...(Array.isArray(specRec['values']) ? { values: specRec['values'] as string[] } : {}),
      ...(dflt === undefined ? {} : { default: dflt as string | number | boolean }),
    };
  }
  return out;
}

/* ────────────────────────────────────────────────────────────────────────────
 * 5.3 `do` (`01` §2.4)
 * ──────────────────────────────────────────────────────────────────────────── */

const STEP_KEYS = ['action', 'when', 'with'] as const;

function parseSteps(
  raw: unknown,
  params: Record<string, WorldCommandParamSpec>,
  sink: Sink
): WorldCommandStep[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    error(sink, 'do_not_list', `"do" must be a list of steps. Each step starts with "- ".`, 'do');
    return [];
  }
  if (raw.length === 0) {
    error(sink, 'do_empty', `"do" must contain at least one step.`, 'do');
    return [];
  }
  if (raw.length > MAX_COMMAND_STEPS) {
    error(sink, 'too_many_steps', `has ${raw.length} steps; the limit is ${MAX_COMMAND_STEPS}.`, 'do');
  }

  const out: WorldCommandStep[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const at = `do[${i}]`;
    const node = raw[i];
    if (node === null || typeof node !== 'object' || Array.isArray(node)) {
      error(sink, 'step_not_mapping', `line 0: do[${i}] must be a mapping starting with "action", e.g.\n- action: give`, at);
      continue;
    }
    const step = node as Record<string, unknown>;

    // Strict step keys. `nested_do` gets its own code because the repair is
    // different ("hand the whole array to an effect that iterates").
    if ('do' in step) {
      error(
        sink,
        'nested_do',
        `do[${i}] has "do" inside a step. Steps are flat - put the inner steps at the top level, or hand the whole array to an effect that iterates it.`,
        at
      );
    }
    for (const key of Object.keys(step)) {
      if ((STEP_KEYS as readonly string[]).includes(key) || key === 'do') continue;
      const near = nearest(key, STEP_KEYS as readonly string[]);
      error(
        sink,
        'unknown_key',
        `unknown field "${key}" in do[${i}]. Allowed step keys: action, when, with.${near === null ? '' : ` Did you mean "${near}"?`}`,
        `${at}.${key}`
      );
    }

    // `action` MUST be a registered effect name. This is the single most
    // dangerous omission in the module: an unknown action would otherwise be a
    // silent no-op, which is exactly what `dice_outcomes` did for 36 files.
    const action = step['action'];
    if (action === undefined) {
      error(
        sink,
        'step_missing_action',
        `do[${i}] has no "action". Allowed effects: ${WORLD_COMMAND_EFFECTS.join(', ')}. Add one, e.g.\n- action: give`,
        at
      );
      continue;
    }
    if (typeof action !== 'string' || !(WORLD_COMMAND_EFFECTS as readonly string[]).includes(action)) {
      const near = typeof action === 'string' ? nearest(action, WORLD_COMMAND_EFFECTS as readonly string[]) : null;
      error(
        sink,
        'unknown_action',
        `unknown effect "${String(action)}". Allowed effects: ${WORLD_COMMAND_EFFECTS.join(', ')}.${near === null ? '' : ` Did you mean "${near}"?`} Effects are verbs (give, move, edit, enter), never action-method names (createEntity, moveEntity).`,
        `${at}.action`
      );
      continue;
    }

    // `when`: length, ASCII, then syntax — compiled HERE so the executor reads
    // an AST instead of re-parsing (and so a malformed expression is a
    // write-time verdict, not a runtime surprise).
    let when: string | undefined;
    let whenAst: ConditionAst | undefined;
    const rawWhen = step['when'];
    if (rawWhen !== undefined) {
      if (typeof rawWhen !== 'string') {
        error(sink, 'invalid_when', `do[${i}].when is not evaluable - expected a string. Expected a range or comparison, e.g. "13..60", "roll.result >= 61".`, `${at}.when`);
      } else if (rawWhen.length > MAX_COMMAND_WHEN_LENGTH) {
        error(sink, 'field_too_long', `do[${i}].when is ${rawWhen.length} characters; the limit is ${MAX_COMMAND_WHEN_LENGTH}.`, `${at}.when`);
      } else if (!ARG_KEY_RE.test(rawWhen)) {
        error(sink, 'non_ascii_machine_field', `"do[${i}].when" is a machine field and must be ASCII. Only "name" and "desc" may contain non-ASCII text.`, `${at}.when`);
      } else {
        // Parameterised `when` is validated against canonical placeholders: the
        // declared type makes the substitution cover every possible value, so
        // the syntax verdict is complete, not approximate (`01` §3.4).
        const compiled = parseCommandWhen(substituteForSyntaxCheck(rawWhen, params));
        if (!compiled.ok) {
          error(sink, 'invalid_when', `do[${i}].when is not evaluable - ${compiled.error}. Expected a range or comparison, e.g. "13..60", "roll.result >= 61", "status.lid == open".`, `${at}.when`);
        } else {
          when = rawWhen;
          whenAst = compiled.value;
        }
      }
    }

    // `with`: a strict-keyed mapping whose shape must match the effect's table.
    const rawWith = step['with'];
    const args = parseArgs(action as WorldCommandEffectName, rawWith, at, i, sink);

    out.push({
      action,
      ...(when === undefined ? {} : { when }),
      ...(whenAst === undefined ? {} : { whenAst }),
      args,
      line: 0,
    });
  }
  return out;
}

/*
 * The argument surface comes from `effects.ts` (`WORLD_COMMAND_EFFECT_ARGS`) —
 * `04 §2.6` is explicit that the EFFECT table owns which forms it accepts and
 * "`01` 不猜". A local copy here would be the R.4/R.11 drift class, and this one
 * is load-bearing: `arg_shape_mismatch` is what tells an author their `rewards:`
 * should have been `path:`.
 */
function parseArgs(
  action: WorldCommandEffectName,
  raw: unknown,
  at: string,
  stepIndex: number,
  sink: Sink
): Record<string, WorldCommandArgNode> {
  const spec = WORLD_COMMAND_EFFECT_ARGS[action];
  const argsPath = `${at}.with`;
  if (raw === undefined || raw === null) {
    for (const key of spec.required ?? []) {
      error(sink, 'missing_arg', `do[${stepIndex}]: "${action}" requires the argument "${key}".`, argsPath);
    }
    if (spec.oneOf !== undefined && spec.oneOf.length > 1) {
      error(sink, 'missing_arg', `do[${stepIndex}]: "${action}" requires exactly one of: ${spec.oneOf.join(', ')}.`, argsPath);
    }
    return {};
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    error(sink, 'with_not_mapping', `do[${stepIndex}].with must be a mapping, e.g.\nwith:\n  rewards: "{{ trigger.entry.rewards }}"`, argsPath);
    return {};
  }
  const record = raw as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length > MAX_COMMAND_ARG_KEYS) {
    error(sink, 'arg_shape_mismatch', `do[${stepIndex}].with has ${keys.length} keys; the limit is ${MAX_COMMAND_ARG_KEYS}.`, argsPath);
  }

  for (const key of keys) {
    if (['action', 'when', 'with', 'do'].includes(key)) {
      error(sink, 'arg_reserved_key', `do[${stepIndex}].with must not contain "${key}"; action / when / with / do are reserved at the step level.`, `${argsPath}.${key}`);
      continue;
    }
    if (!spec.names.includes(key)) {
      error(sink, 'unknown_arg', `do[${stepIndex}]: "${action}" does not take the argument "${key}". It takes: ${spec.names.join(', ')}.`, `${argsPath}.${key}`);
      continue;
    }
    const value = record[key];
    // A literal array is content, and content lives in the entity. Only the
    // declared `list-args` names may carry an array, and only as a whole
    // `{{ }}` reference (which parses as a string here).
    if (Array.isArray(value)) {
      if (spec.arrays?.includes(key)) {
        error(sink, 'arg_literal_array', `do[${stepIndex}].with.${key} is a literal array. Content lives in the entity, not the command - pass it as "{{ trigger.entry.${key} }}".`, `${argsPath}.${key}`);
      } else {
        error(sink, 'arg_shape_mismatch', `do[${stepIndex}]: "${action}" expects a scalar for "${key}", but it is an array. Use a scalar, or pass the array whole as "{{ ... }}".`, `${argsPath}.${key}`);
      }
      continue;
    }
    // Scalars and nested maps are both legal nodes; a nested map is what
    // `edit`'s `frontmatter` needs, so only depth is checked here.
    const depth = argDepth(value, 0);
    if (depth > MAX_COMMAND_ARG_DEPTH) {
      error(sink, 'arg_too_deep', `do[${stepIndex}].with.${key} nests ${depth} levels; the limit is ${MAX_COMMAND_ARG_DEPTH}.`, `${argsPath}.${key}`);
    }
    if (typeof value !== 'string' && (value === null || typeof value !== 'object' || Array.isArray(value))) {
      error(sink, 'arg_not_string', `do[${stepIndex}].with.${key} must be a string. Quote a template: ${key}: "{{ p }}"`, `${argsPath}.${key}`);
      continue;
    }
    checkArgKeys(value, `${argsPath}.${key}`, sink);
  }

  for (const key of spec.required ?? []) {
    if (!(key in record)) {
      error(sink, 'missing_arg', `do[${stepIndex}]: "${action}" requires the argument "${key}".`, argsPath);
    }
  }
  if (spec.oneOf !== undefined && spec.oneOf.length > 1) {
    const present = spec.oneOf.filter((k) => k in record);
    if (present.length === 0) {
      error(sink, 'missing_arg', `do[${stepIndex}]: "${action}" requires exactly one of: ${spec.oneOf.join(', ')}.`, argsPath);
    } else if (present.length > 1) {
      error(sink, 'arg_shape_mismatch', `do[${stepIndex}]: "${action}" takes exactly one of: ${spec.oneOf.join(', ')} - got ${present.join(' and ')}.`, argsPath);
    }
  }
  return record as Record<string, WorldCommandArgNode>;
}

/** Machine-field key check (`01` §2.7): argument KEYS are ASCII, values may not be. */
function checkArgKeys(node: unknown, path: string, sink: Sink): void {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) checkArgKeys(item, path, sink);
    return;
  }
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (!ARG_KEY_RE.test(key)) {
      error(sink, 'non_ascii_machine_field', `"${path}.${key}" is a machine field and must be printable ASCII.`, `${path}.${key}`);
    }
    checkArgKeys(value, `${path}.${key}`, sink);
  }
}

function argDepth(node: unknown, depth: number): number {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return depth;
  let max = depth;
  for (const value of Object.values(node as Record<string, unknown>)) {
    const d = argDepth(value, depth + 1);
    if (d > max) max = d;
  }
  return max;
}

/* ────────────────────────────────────────────────────────────────────────────
 * 5.4 Template references (`01` §2.5 / §3.1 S8)
 * ──────────────────────────────────────────────────────────────────────────── */

/** Every `{{ path }}` in the file, in document order, duplicates preserved. */
function collectRefs(root: unknown): string[] {
  const refs: string[] = [];
  const scan = (node: unknown): void => {
    if (typeof node === 'string') {
      const re = new RegExp(TEMPLATE_RE.source, 'g');
      for (let m = re.exec(node); m !== null; m = re.exec(node)) refs.push(m[1]!);
      return;
    }
    if (node === null || typeof node !== 'object') return;
    for (const value of Object.values(node as Record<string, unknown>)) scan(value);
  };
  scan(root);
  return refs;
}

/** Known context roots (`01` §2.5). `params` is handled as the shorthand form. */
const CONTEXT_ROOTS = ['trigger', 'roll', 'choice', 'item', 'entry'] as const;

function checkRef(ref: string, params: Record<string, WorldCommandParamSpec>, sink: Sink): void {
  const head = ref.split(/[.[]/)[0]!;
  if (head === 'params') {
    const rest = ref.slice('params'.length).replace(/^\./, '');
    const pname = rest.split(/[.[]/)[0]!;
    if (rest === '' || !(pname in params)) {
      error(sink, 'unknown_param_ref', `"{{ ${ref} }}" is not declared. Declared parameters: ${listParams(params)}. Declare it under "params", or read the entity's own field with "{{ trigger.fm.${pname || 'key'} }}".`, '');
    }
    return;
  }
  // Bare `{{ name }}` is the shorthand for `{{ params.name }}` when the name is
  // a declared parameter. Anything else must be a context root.
  if (head in params) return;
  if ((CONTEXT_ROOTS as readonly string[]).includes(head)) return;
  const near = nearest(head, [...Object.keys(params), ...CONTEXT_ROOTS]);
  if (near !== null && head in params === false && Object.keys(params).includes(near)) {
    error(sink, 'unknown_param_ref', `"{{ ${ref} }}" is not declared. Declared parameters: ${listParams(params)}.${near === null ? '' : ` Did you mean "${near}"?`} Declare it under "params", or read the entity's own field with "{{ trigger.fm.${head} }}".`, '');
    return;
  }
  error(
    sink,
    'unknown_context_ref',
    `"{{ ${ref} }}" is not a known context value. Known roots: params, ${CONTEXT_ROOTS.join(', ')}.`,
    ''
  );
}

function listParams(params: Record<string, WorldCommandParamSpec>): string {
  const names = Object.keys(params);
  return names.length === 0 ? '(none)' : names.join(', ');
}

/**
 * Replace parameter references with canonical placeholders so a parameterised
 * `when` can be syntax-checked at write time (`01` §3.4).
 *
 * The declared type is what makes this complete rather than approximate: every
 * value of that type has the same shape, so one placeholder covers them all.
 */
function substituteForSyntaxCheck(when: string, params: Record<string, WorldCommandParamSpec>): string {
  const re = new RegExp(TEMPLATE_RE.source, 'g');
  return when.replace(re, (_whole, ref: string) => {
    const head = ref.split(/[.[]/)[0]!;
    const name = head === 'params' ? ref.slice('params'.length).replace(/^\./, '').split(/[.[]/)[0]! : head;
    const spec = params[name];
    if (spec === undefined) {
      // An unknown reference is reported by `checkRef`; keep the expression
      // parseable so this pass does not report it twice.
      return '0';
    }
    switch (spec.type) {
      case 'string':
        return '"x"';
      case 'number':
        return '0';
      case 'boolean':
        return 'true';
      case 'enum':
        return spec.values?.[0] === undefined ? '"x"' : JSON.stringify(spec.values[0]);
    }
  });
}

/* ────────────────────────────────────────────────────────────────────────────
 * 6. Small helpers
 * ──────────────────────────────────────────────────────────────────────────── */

/** `toPlainObject` — `doc.toJS()` with the alias bomb guarded, mapping-only. */
function toPlainObject(doc: Document): Record<string, unknown> | null {
  try {
    const js = doc.toJS({ maxAliasCount: 100 });
    if (js === null || js === undefined) return {};
    if (typeof js !== 'object' || Array.isArray(js)) return null;
    return js as Record<string, unknown>;
  } catch {
    return null;
  }
}

function nodeKind(node: unknown): string {
  if (node === null || node === undefined) return 'empty document';
  if (isSeq(node)) return 'list';
  if (isScalar(node)) return typeof node.value;
  return 'mapping';
}

/**
 * Closest candidate by edit distance ≤ 2, or null. Omitting the whole
 * suggestion sentence beats printing an empty shell (`01` §7.3 `near`).
 */
function nearest(word: string, candidates: readonly string[]): string | null {
  let best: string | null = null;
  let bestDistance = 3;
  for (const candidate of candidates) {
    const d = editDistance(word, candidate);
    if (d < bestDistance) {
      bestDistance = d;
      best = candidate;
    }
  }
  return best;
}

function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  let prev = Array.from({ length: cols }, (_v, j) => j);
  for (let i = 1; i < rows; i += 1) {
    const next = new Array<number>(cols);
    next[0] = i;
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      next[j] = Math.min(prev[j]! + 1, next[j - 1]! + 1, prev[j - 1]! + cost);
    }
    prev = next;
  }
  return prev[cols - 1]!;
}

/* ────────────────────────────────────────────────────────────────────────────
 * 7. Frontmatter-side entry (`on.<hook>` binding check helpers)
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Read `command_log`-adjacent declarations from an already-parsed frontmatter.
 *
 * Kept here rather than in `bindings.ts` so `01`'s module owns the ONLY reading
 * of `command/<id>.yaml`; `bindings.ts` owns `on`. This helper exists because
 * `parseWorldCommand`'s callers hold a `ParsedFrontmatter`, and `commandIdOfPath`
 * is the only thing `01` needs from it.
 */
export function declaredCommandId(parsed: ParsedFrontmatter, fallbackPath: string): string | null {
  const fromPath = commandIdOfPath(fallbackPath);
  if (fromPath !== null) return fromPath;
  const id = parsed.frontmatter?.['id'];
  return typeof id === 'string' && COMMAND_ID_RE.test(id) ? id : null;
}

/**
 * The declared `do[]` size ceiling, re-exported from `limits.ts` so importers of
 * this module do not need a second import for the validator's own bound.
 */
export { MAX_COMMAND_STEPS };
